import { randomUUID } from "node:crypto";

import { parseHistoryRequest, parseSendRequest } from "./input-parsers";
import { SessionController } from "../telegram/session-controller";
import { TelegramRuntimeClient } from "../telegram/runtime-client";
import type { AuthStatus } from "../telegram/types";
import { formatError } from "../telegram/utils";

type NodeRedRuntime = any;
type NodeInstance = any;
type HttpRequest = any;
type HttpResponse = any;

interface TempAuthRecord {
  controller: SessionController;
  touchedAt: number;
}

const TEMP_AUTH_TTL_MS = 30 * 60 * 1000;
const tempAuthRecords = new Map<string, TempAuthRecord>();

function sanitizeAdminError(error: unknown): { error: string } {
  return { error: formatError(error) };
}

function now(): number {
  return Date.now();
}

function getOrCreateTempAuth(authToken?: string): { authToken: string; record: TempAuthRecord } {
  const token = authToken && tempAuthRecords.has(authToken) ? authToken : randomUUID();
  const existing = tempAuthRecords.get(token);
  if (existing) {
    existing.touchedAt = now();
    return { authToken: token, record: existing };
  }

  const record: TempAuthRecord = {
    controller: new SessionController(),
    touchedAt: now()
  };

  tempAuthRecords.set(token, record);
  return { authToken: token, record };
}

function getTempAuth(authToken: string): TempAuthRecord {
  const record = tempAuthRecords.get(authToken);
  if (!record) {
    throw new Error("Telegram authentication session not found. Start Connect again.");
  }

  record.touchedAt = now();
  return record;
}

async function removeTempAuth(authToken: string): Promise<void> {
  const record = tempAuthRecords.get(authToken);
  if (!record) {
    return;
  }

  tempAuthRecords.delete(authToken);
  await record.controller.disconnect({ clearSession: true });
}

function cleanupExpiredTempAuthSessions(): void {
  const expirationThreshold = now() - TEMP_AUTH_TTL_MS;
  for (const [authToken, record] of tempAuthRecords.entries()) {
    if (record.touchedAt >= expirationThreshold) {
      continue;
    }

    void removeTempAuth(authToken);
  }
}

const cleanupInterval = setInterval(cleanupExpiredTempAuthSessions, 5 * 60 * 1000);
cleanupInterval.unref();

function statusToIndicator(status: AuthStatus): { fill: string; shape: string; text: string } {
  switch (status.state) {
    case "connected":
      return { fill: "green", shape: "dot", text: "connected" };
    case "connecting":
      return { fill: "blue", shape: "ring", text: "connecting" };
    case "awaiting_code":
      return { fill: "yellow", shape: "ring", text: "awaiting code" };
    case "awaiting_password":
      return { fill: "yellow", shape: "ring", text: "awaiting 2FA" };
    case "error":
      return { fill: "red", shape: "ring", text: status.error ?? "error" };
    default:
      return { fill: "grey", shape: "ring", text: "disconnected" };
  }
}

function mergeTelegramMetadata(msg: Record<string, unknown>, payload: unknown, telegramData: Record<string, unknown>): Record<string, unknown> {
  const nextTelegram = {
    ...((msg.telegram as Record<string, unknown> | undefined) ?? {}),
    ...telegramData
  };

  msg.payload = payload;
  msg.telegram = nextTelegram;
  return msg;
}

function asyncHandler(handler: (req: HttpRequest, res: HttpResponse) => Promise<void>) {
  return (req: HttpRequest, res: HttpResponse) => {
    void handler(req, res).catch((error) => {
      const { error: message } = sanitizeAdminError(error);
      const statusCode = error instanceof Error && error.message.includes("not found") ? 404 : 400;
      res.status(statusCode).json({ error: message });
    });
  };
}

function getPermissionMiddleware(RED: NodeRedRuntime, permission: string) {
  return RED.auth?.needsPermission ? RED.auth.needsPermission(permission) : (_req: HttpRequest, _res: HttpResponse, next: () => void) => next();
}

function getConfigNode(RED: NodeRedRuntime, id: string): NodeInstance {
  const node = RED.nodes.getNode(id);
  if (!node || !node.client) {
    throw new Error("Telegram config node not found. Deploy the flow and try again.");
  }

  return node;
}

function waitForStableAuthState(controller: SessionController): Promise<AuthStatus> {
  return controller.waitForState(["awaiting_code", "awaiting_password", "connected", "error"], 1200);
}

module.exports = function registerTelegramApiNodes(RED: NodeRedRuntime) {
  const adminRead = getPermissionMiddleware(RED, "flows.read");
  const adminWrite = getPermissionMiddleware(RED, "flows.write");

  RED.httpAdmin.post(
    "/telegram-api/auth/connect",
    adminWrite,
    asyncHandler(async (req, res) => {
      const { authToken, record } = getOrCreateTempAuth(req.body?.authToken);
      await record.controller.disconnect();
      record.controller.startConnect({
        apiHash: req.body?.apiHash,
        apiId: req.body?.apiId,
        phone: req.body?.phone,
        sessionString: req.body?.sessionString
      });

      const status = await waitForStableAuthState(record.controller);
      res.json({ authToken, status });
    })
  );

  RED.httpAdmin.get(
    "/telegram-api/auth/:authToken/status",
    adminRead,
    asyncHandler(async (req, res) => {
      const { controller } = getTempAuth(req.params.authToken);
      res.json({
        authToken: req.params.authToken,
        status: controller.getStatus()
      });
    })
  );

  RED.httpAdmin.post(
    "/telegram-api/auth/:authToken/code",
    adminWrite,
    asyncHandler(async (req, res) => {
      const { controller } = getTempAuth(req.params.authToken);
      await controller.submitCode(String(req.body?.code ?? ""));
      const status = await waitForStableAuthState(controller);
      res.json({
        authToken: req.params.authToken,
        status
      });
    })
  );

  RED.httpAdmin.post(
    "/telegram-api/auth/:authToken/password",
    adminWrite,
    asyncHandler(async (req, res) => {
      const { controller } = getTempAuth(req.params.authToken);
      await controller.submitPassword(String(req.body?.password ?? ""));
      const status = await waitForStableAuthState(controller);
      res.json({
        authToken: req.params.authToken,
        status
      });
    })
  );

  RED.httpAdmin.post(
    "/telegram-api/auth/:authToken/disconnect",
    adminWrite,
    asyncHandler(async (req, res) => {
      await removeTempAuth(req.params.authToken);
      res.json({
        authToken: req.params.authToken,
        status: {
          label: "Disconnected",
          state: "disconnected"
        }
      });
    })
  );

  RED.httpAdmin.get(
    "/telegram-api/config/:id/status",
    adminRead,
    asyncHandler(async (req, res) => {
      const node = getConfigNode(RED, req.params.id);
      res.json({ status: node.client.getStatus() });
    })
  );

  RED.httpAdmin.post(
    "/telegram-api/config/:id/test",
    adminWrite,
    asyncHandler(async (req, res) => {
      const node = getConfigNode(RED, req.params.id);
      const status = await node.client.testConnection();
      res.json({ status });
    })
  );

  RED.httpAdmin.post(
    "/telegram-api/config/:id/disconnect",
    adminWrite,
    asyncHandler(async (req, res) => {
      const node = getConfigNode(RED, req.params.id);
      await node.client.disconnect();
      res.json({ status: node.client.getStatus() });
    })
  );

  function TelegramApiConfigNode(this: NodeInstance, config: Record<string, unknown>) {
    RED.nodes.createNode(this, config);

    const credentials = this.credentials ?? {};
    this.client = new TelegramRuntimeClient({
      apiHash: String(credentials.apiHash ?? ""),
      apiId: Number(credentials.apiId ?? 0),
      phone: String(credentials.phone ?? ""),
      reconnectMaxMs: Math.max(Number(config.reconnectMaxMs ?? 30000), 1000),
      reconnectMinMs: Math.max(Number(config.reconnectMinMs ?? 2000), 250),
      sessionString: typeof credentials.sessionString === "string" ? credentials.sessionString : undefined
    });

    this.downloadDir = typeof config.downloadDir === "string" ? config.downloadDir : "";
    this.getStatus = () => this.client.getStatus();

    if (credentials.sessionString && credentials.apiId && credentials.apiHash && credentials.phone) {
      this.client.start();
    }

    this.on("close", (_removed: boolean, done: (error?: Error) => void) => {
      this.client
        .close()
        .then(() => done())
        .catch((error: unknown) => done(new Error(formatError(error))));
    });
  }

  function TelegramApiInNode(this: NodeInstance, config: Record<string, unknown>) {
    RED.nodes.createNode(this, config);

    const account = RED.nodes.getNode(config.account);
    if (!account?.client) {
      this.status({ fill: "red", shape: "ring", text: "config missing" });
      return;
    }

    const includeRaw = Boolean(config.includeRaw);
    const unreadOnly = Boolean(config.unreadOnly);
    const removeStatusListener = account.client.onStatus((status: AuthStatus) => {
      this.status(statusToIndicator(status));
    });
    const removeMessageListener = account.client.onMessage((message: Record<string, unknown>) => {
      if (unreadOnly && message.outgoing) {
        return;
      }

      const telegramData = includeRaw ? message : { ...message, raw: undefined };
      this.send({
        payload: message.text ?? "",
        telegram: telegramData
      });
    });

    this.on("close", () => {
      removeMessageListener();
      removeStatusListener();
    });
  }

  function TelegramApiSendNode(this: NodeInstance, config: Record<string, unknown>) {
    RED.nodes.createNode(this, config);

    const account = RED.nodes.getNode(config.account);
    if (!account?.client) {
      this.status({ fill: "red", shape: "ring", text: "config missing" });
      return;
    }

    const defaultPeer = typeof config.peer === "string" ? config.peer.trim() : undefined;
    const removeStatusListener = account.client.onStatus((status: AuthStatus) => {
      this.status(statusToIndicator(status));
    });

    this.on("input", async (msg: Record<string, unknown>, send: (message: unknown) => void, done: (error?: Error) => void) => {
      try {
        const request = parseSendRequest(msg, defaultPeer);
        const response = await account.client.send(request);
        send(mergeTelegramMetadata(msg, response.text, response as unknown as Record<string, unknown>));
        done();
      } catch (error) {
        this.status({ fill: "red", shape: "ring", text: "send failed" });
        done(new Error(formatError(error)));
      }
    });

    this.on("close", () => {
      removeStatusListener();
    });
  }

  function TelegramApiHistoryNode(this: NodeInstance, config: Record<string, unknown>) {
    RED.nodes.createNode(this, config);

    const account = RED.nodes.getNode(config.account);
    if (!account?.client) {
      this.status({ fill: "red", shape: "ring", text: "config missing" });
      return;
    }

    const defaultPeer = typeof config.peer === "string" ? config.peer.trim() : undefined;
    const defaultLimit = Math.max(Number(config.limit ?? 10), 1);
    const includeRaw = Boolean(config.includeRaw);
    const unreadOnly = Boolean(config.unreadOnly);
    const removeStatusListener = account.client.onStatus((status: AuthStatus) => {
      this.status(statusToIndicator(status));
    });

    this.on("input", async (msg: Record<string, unknown>, send: (message: unknown) => void, done: (error?: Error) => void) => {
      try {
        const request = parseHistoryRequest(msg, {
          includeRaw,
          limit: defaultLimit,
          peer: defaultPeer,
          unreadOnly
        });
        const messages = await account.client.getHistory(request);
        send(
          mergeTelegramMetadata(msg, messages, {
            history: messages,
            peer: messages[0]?.peer ?? { ref: String(request.peer) }
          })
        );
        done();
      } catch (error) {
        this.status({ fill: "red", shape: "ring", text: "history failed" });
        done(new Error(formatError(error)));
      }
    });

    this.on("close", () => {
      removeStatusListener();
    });
  }

  RED.nodes.registerType("telegram-api-config", TelegramApiConfigNode, {
    credentials: {
      apiHash: { type: "password" },
      apiId: { type: "text" },
      phone: { type: "text" },
      sessionString: { type: "password" }
    }
  });
  RED.nodes.registerType("telegram-api-in", TelegramApiInNode);
  RED.nodes.registerType("telegram-api-send", TelegramApiSendNode);
  RED.nodes.registerType("telegram-api-history", TelegramApiHistoryNode);
};
