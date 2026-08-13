import { EventEmitter } from "node:events";

import bigInt from "big-integer";
import { Api } from "telegram";
import { NewMessage } from "telegram/events";
import { CustomFile } from "telegram/client/uploads";

import { nextBackoffDelay } from "../lib/backoff";
import { normalizeMessage } from "./message-normalizer";
import { SessionController } from "./session-controller";
import type {
  AuthStatus,
  ConnectionCredentials,
  HistoryRequest,
  NormalizedMessage,
  RuntimeClientOptions,
  RuntimeStatusListener,
  SendRequest,
  TelegramClientLike
} from "./types";
import { formatError, peerInputFromValue } from "./utils";

interface RuntimeEvents {
  message: [NormalizedMessage];
  status: [AuthStatus];
}

type RuntimeEventName = keyof RuntimeEvents;

class TypedEmitter {
  private readonly emitter = new EventEmitter();

  emit<EventName extends RuntimeEventName>(eventName: EventName, ...payload: RuntimeEvents[EventName]): void {
    this.emitter.emit(eventName, ...payload);
  }

  on<EventName extends RuntimeEventName>(eventName: EventName, listener: (...payload: RuntimeEvents[EventName]) => void): () => void {
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }
}

export class TelegramRuntimeClient {
  private currentClient?: TelegramClientLike;
  private readonly events = new TypedEmitter();
  private manualDisconnect = false;
  private readonly onIncomingMessage = (event: unknown) => {
    const message = typeof event === "object" && event !== null && "message" in (event as Record<string, unknown>)
      ? (event as Record<string, unknown>).message
      : event;
    this.events.emit("message", normalizeMessage(message));
  };
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly sessionController = new SessionController();
  private shuttingDown = false;

  constructor(private readonly options: RuntimeClientOptions) {
    this.sessionController.onStatus((status) => {
      this.events.emit("status", status);

      if (status.state === "connected") {
        this.reconnectAttempt = 0;
      }

      if (status.state === "error" && !this.manualDisconnect) {
        this.scheduleReconnect();
      }
    });
  }

  async close(): Promise<void> {
    this.shuttingDown = true;
    this.clearReconnectTimer();
    this.detachClient();
    await this.sessionController.disconnect();
  }

  async disconnect(options: { clearSession?: boolean } = {}): Promise<void> {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.detachClient();
    await this.sessionController.disconnect(options);
  }

  async getHistory(request: HistoryRequest): Promise<NormalizedMessage[]> {
    const client = await this.ensureClient();
    const entity = await this.resolveEntity(client, request.peer);
    if (!client.getMessages) {
      throw new Error("Telegram client does not support history reads.");
    }

    const options: Record<string, unknown> = {
      limit: request.limit,
      offsetId: request.offsetId
    };

    if (request.unreadOnly) {
      const { readInboxMaxId, unreadCount } = await this.getUnreadHistoryWindow(client, request.peer);
      if (unreadCount <= 0) {
        return [];
      }

      options.limit = Math.min(request.limit, unreadCount);
      options.minId = readInboxMaxId;
    }

    const messages = await client.getMessages(entity, options);
    const normalizedMessages = Array.from(messages, (message) => normalizeMessage(message, request.includeRaw));

    if (!request.unreadOnly) {
      return normalizedMessages;
    }

    return normalizedMessages.filter((message) => !message.outgoing);
  }

  getStatus(): AuthStatus {
    return this.sessionController.getStatus();
  }

  onMessage(listener: (message: NormalizedMessage) => void): () => void {
    return this.events.on("message", listener);
  }

  onStatus(listener: RuntimeStatusListener): () => void {
    const unsubscribe = this.events.on("status", listener);
    listener(this.getStatus());
    return unsubscribe;
  }

  async send(request: SendRequest): Promise<NormalizedMessage> {
    const client = await this.ensureClient();
    const entity = await this.resolveEntity(client, request.peer);

    if (request.media) {
      if (!client.sendFile) {
        throw new Error("Telegram client does not support media sends.");
      }

      const file =
        typeof request.media.file === "string"
          ? request.media.file
          : new CustomFile(
              request.media.fileName ?? "telegram-upload.bin",
              request.media.file.length,
              "",
              request.media.file
            );

      const response = await client.sendFile(entity, {
        caption: request.caption,
        file
      });

      return normalizeMessage(response);
    }

    if (!client.sendMessage) {
      throw new Error("Telegram client does not support text sends.");
    }

    const response = await client.sendMessage(entity, {
      message: request.text ?? ""
    });

    return normalizeMessage(response);
  }

  start(): void {
    if (!this.options.sessionString) {
      return;
    }

    this.manualDisconnect = false;
    this.clearReconnectTimer();
    void this.ensureClient().catch(() => {
      this.scheduleReconnect();
    });
  }

  async testConnection(): Promise<AuthStatus> {
    await this.ensureClient();
    return this.getStatus();
  }

  private attachClient(client: TelegramClientLike): void {
    if (this.currentClient === client) {
      return;
    }

    this.detachClient();
    this.currentClient = client;
    client.addEventHandler?.(this.onIncomingMessage, new NewMessage({}));

    const disconnectedPromise = client.disconnected;
    if (disconnectedPromise && typeof disconnectedPromise.then === "function") {
      void disconnectedPromise.then(
        () => {
          this.handleDisconnect(client, "Telegram disconnected.");
        },
        (error) => {
          this.handleDisconnect(client, formatError(error));
        }
      );
    }
  }

  private handleDisconnect(client: TelegramClientLike, error: string): void {
    if (this.shuttingDown || this.manualDisconnect || this.currentClient !== client) {
      return;
    }

    this.currentClient = undefined;
    this.sessionController.markDisconnected(error);
    this.scheduleReconnect();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private credentials(): ConnectionCredentials {
    return {
      apiHash: this.options.apiHash,
      apiId: this.options.apiId,
      phone: this.options.phone,
      sessionString: this.options.sessionString
    };
  }

  private detachClient(): void {
    if (this.currentClient) {
      this.currentClient.removeEventHandler?.(this.onIncomingMessage);
      this.currentClient = undefined;
    }
  }

  private async ensureClient(): Promise<TelegramClientLike> {
    const existingClient = this.sessionController.getClient();
    const status = this.getStatus();

    if (existingClient && status.state === "connected") {
      this.attachClient(existingClient);
      return existingClient;
    }

    if (!this.options.sessionString) {
      throw new Error("No stored Telegram session. Use the config node editor to connect and deploy.");
    }

    this.manualDisconnect = false;

    try {
      const client = await this.sessionController.connect(this.credentials());
      this.attachClient(client);
      return client;
    } catch (error) {
      throw new Error(formatError(error));
    }
  }

  private async resolveEntity(client: TelegramClientLike, value: unknown): Promise<unknown> {
    if (!client.getEntity) {
      throw new Error("Telegram client does not support peer resolution.");
    }

    const input = peerInputFromValue(value);
    try {
      return await client.getEntity(input);
    } catch (error) {
      if (typeof input === "number" || typeof input === "string") {
        return client.getEntity(this.buildPeerFallback(input));
      }

      throw error;
    }
  }

  private async resolveInputEntity(client: TelegramClientLike, value: unknown): Promise<unknown> {
    if (!client.getInputEntity) {
      throw new Error("Telegram client does not support unread history reads.");
    }

    const input = peerInputFromValue(value);
    try {
      return await client.getInputEntity(input);
    } catch (error) {
      if (typeof input === "number" || typeof input === "string") {
        return client.getInputEntity(this.buildPeerFallback(input));
      }

      throw error;
    }
  }

  private async getUnreadHistoryWindow(
    client: TelegramClientLike,
    peer: unknown
  ): Promise<{ readInboxMaxId: number; unreadCount: number }> {
    if (!client.invoke) {
      throw new Error("Telegram client does not support unread history reads.");
    }

    const inputPeer = await this.resolveInputEntity(client, peer);
    const response = await client.invoke(
      new Api.messages.GetPeerDialogs({
        peers: [new Api.InputDialogPeer({ peer: inputPeer as Api.TypeInputPeer })]
      })
    );
    const dialogs =
      typeof response === "object" && response !== null && "dialogs" in response && Array.isArray((response as { dialogs?: unknown[] }).dialogs)
        ? (response as { dialogs: unknown[] }).dialogs
        : [];
    const dialog = dialogs[0] as Record<string, unknown> | undefined;

    if (!dialog) {
      return { readInboxMaxId: 0, unreadCount: 0 };
    }

    const readInboxMaxId = Number(dialog.readInboxMaxId);
    const unreadCount = Number(dialog.unreadCount);

    return {
      readInboxMaxId: Number.isFinite(readInboxMaxId) ? Math.max(0, Math.trunc(readInboxMaxId)) : 0,
      unreadCount: Number.isFinite(unreadCount) ? Math.max(0, Math.trunc(unreadCount)) : 0
    };
  }

  private buildPeerFallback(input: number | string): Api.TypePeer | string | number {
    if (typeof input === "string" && input.startsWith("@")) {
      return input;
    }

    if (typeof input === "string" && !/^-?\d+$/.test(input)) {
      return input;
    }

    const normalizedId = bigInt(String(input));
    return new Api.PeerUser({ userId: normalizedId });
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.manualDisconnect || !this.options.sessionString || this.reconnectTimer) {
      return;
    }

    const delay = nextBackoffDelay(
      this.reconnectAttempt,
      this.options.reconnectMinMs,
      this.options.reconnectMaxMs
    );

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureClient().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }
}
