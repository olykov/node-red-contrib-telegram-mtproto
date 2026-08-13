import { EventEmitter } from "node:events";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

import { createDeferred, type Deferred } from "../lib/deferred";
import type {
  AuthState,
  AuthStatus,
  ConnectionCredentials,
  SessionControllerOptions,
  TelegramClientLike
} from "./types";
import { formatError, sanitizeCredentials, statusLabel } from "./utils";

function defaultClientFactory(credentials: ConnectionCredentials): TelegramClientLike {
  return new TelegramClient(
    new StringSession(credentials.sessionString ?? ""),
    credentials.apiId,
    credentials.apiHash,
    {
      connectionRetries: 5
    }
  ) as unknown as TelegramClientLike;
}

export class SessionController {
  private readonly clientFactory: (credentials: ConnectionCredentials) => TelegramClientLike;
  private client?: TelegramClientLike;
  private codeDeferred?: Deferred<string>;
  private connectPromise?: Promise<TelegramClientLike>;
  private currentCredentials?: ConnectionCredentials;
  private readonly events = new EventEmitter();
  private passwordDeferred?: Deferred<string>;
  private status: AuthStatus = {
    label: "Disconnected",
    state: "disconnected"
  };

  constructor(options: SessionControllerOptions = {}) {
    this.clientFactory = options.clientFactory ?? defaultClientFactory;
  }

  async connect(credentials: ConnectionCredentials): Promise<TelegramClientLike> {
    this.startConnect(credentials);

    if (!this.connectPromise) {
      throw new Error("Telegram connection could not be started.");
    }

    return this.connectPromise;
  }

  async disconnect(options: { clearSession?: boolean } = {}): Promise<void> {
    this.rejectPendingInputs(new Error("Telegram authentication was cancelled."));

    await this.disconnectClient();

    const nextSessionString = options.clearSession ? undefined : this.status.sessionString;

    if (options.clearSession && this.currentCredentials) {
      this.currentCredentials = {
        ...this.currentCredentials,
        sessionString: undefined
      };
    }

    this.updateStatus("disconnected", undefined, nextSessionString);
  }

  getClient(): TelegramClientLike | undefined {
    return this.client;
  }

  getStatus(): AuthStatus {
    return { ...this.status };
  }

  markDisconnected(error?: string): void {
    this.rejectPendingInputs(new Error("Telegram client disconnected."));
    if (error) {
      this.updateStatus("error", error);
      return;
    }

    this.updateStatus("disconnected");
  }

  onStatus(listener: (status: AuthStatus) => void): () => void {
    this.events.on("status", listener);
    listener(this.getStatus());

    return () => {
      this.events.off("status", listener);
    };
  }

  startConnect(credentials: ConnectionCredentials): AuthStatus {
    this.currentCredentials = sanitizeCredentials(credentials);

    if (!this.connectPromise) {
      const nextConnectPromise = this.doConnect(this.currentCredentials).finally(() => {
        if (this.connectPromise === nextConnectPromise) {
          this.connectPromise = undefined;
        }
      });
      this.connectPromise = nextConnectPromise;
      void nextConnectPromise.catch(() => undefined);
    }

    return this.getStatus();
  }

  async submitCode(code: string): Promise<AuthStatus> {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new Error("Telegram login code cannot be empty.");
    }

    if (!this.codeDeferred) {
      throw new Error("Telegram is not currently waiting for a login code.");
    }

    this.codeDeferred.resolve(normalizedCode);
    this.codeDeferred = undefined;
    this.updateStatus("connecting");

    return this.getStatus();
  }

  async submitPassword(password: string): Promise<AuthStatus> {
    const normalizedPassword = password.trim();
    if (!normalizedPassword) {
      throw new Error("Telegram 2FA password cannot be empty.");
    }

    if (!this.passwordDeferred) {
      throw new Error("Telegram is not currently waiting for a 2FA password.");
    }

    this.passwordDeferred.resolve(normalizedPassword);
    this.passwordDeferred = undefined;
    this.updateStatus("connecting");

    return this.getStatus();
  }

  async waitForState(states: AuthState[], timeoutMs = 1000): Promise<AuthStatus> {
    if (states.includes(this.status.state)) {
      return this.getStatus();
    }

    return new Promise<AuthStatus>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(this.getStatus());
      }, timeoutMs);

      const listener = (status: AuthStatus) => {
        if (!states.includes(status.state)) {
          return;
        }

        cleanup();
        resolve({ ...status });
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.events.off("status", listener);
      };

      this.events.on("status", listener);
    });
  }

  private async disconnectClient(): Promise<void> {
    const activeClient = this.client;
    this.client = undefined;

    if (activeClient) {
      try {
        await activeClient.disconnect();
      } catch {
        // Best-effort cleanup for reconnect/login cancellation.
      }
    }
  }

  private async doConnect(credentials: ConnectionCredentials): Promise<TelegramClientLike> {
    await this.disconnectClient();

    const client = this.clientFactory(credentials);
    this.client = client;
    this.updateStatus("connecting");

    try {
      await client.start({
        onError: (error) => {
          this.updateStatus("error", formatError(error));
        },
        password: async () => {
          this.passwordDeferred = createDeferred<string>();
          this.updateStatus("awaiting_password");
          return this.passwordDeferred.promise;
        },
        phoneCode: async () => {
          this.codeDeferred = createDeferred<string>();
          this.updateStatus("awaiting_code");
          return this.codeDeferred.promise;
        },
        phoneNumber: async () => credentials.phone
      });

      const sessionString = client.session.save();
      this.currentCredentials = {
        ...credentials,
        sessionString
      };
      this.updateStatus("connected", undefined, sessionString);

      return client;
    } catch (error) {
      const formattedError = formatError(error);
      await this.disconnectClient();
      this.updateStatus("error", formattedError);
      throw error;
    } finally {
      this.codeDeferred = undefined;
      this.passwordDeferred = undefined;
    }
  }

  private rejectPendingInputs(error: Error): void {
    if (this.codeDeferred) {
      this.codeDeferred.reject(error);
      this.codeDeferred = undefined;
    }

    if (this.passwordDeferred) {
      this.passwordDeferred.reject(error);
      this.passwordDeferred = undefined;
    }
  }

  private updateStatus(state: AuthState, error?: string, sessionString?: string): void {
    this.status = {
      error,
      label: statusLabel(state, error),
      sessionString: sessionString ?? this.status.sessionString,
      state
    };

    this.events.emit("status", this.getStatus());
  }
}
