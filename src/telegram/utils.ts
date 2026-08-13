import type { AuthStatus, NormalizedPeer } from "./types";

export function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown Telegram error";
  }
}

export function toSerializableId(value: unknown): string | undefined {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidateKeys = ["id", "userId", "chatId", "channelId", "value"];
  for (const key of candidateKeys) {
    if (key in value) {
      const nextValue = (value as Record<string, unknown>)[key];
      const serialized = toSerializableId(nextValue);
      if (serialized) {
        return serialized;
      }
    }
  }

  return undefined;
}

export function safeRaw(value: unknown): unknown {
  if (!value) {
    return undefined;
  }

  if (typeof value === "object" && value !== null && "toJSON" in value && typeof (value as { toJSON: () => unknown }).toJSON === "function") {
    try {
      return (value as { toJSON: () => unknown }).toJSON();
    } catch {
      return undefined;
    }
  }

  try {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => {
        if (typeof item === "bigint") {
          return item.toString();
        }

        return item;
      })
    );
  } catch {
    return undefined;
  }
}

function detectPeerType(value: unknown): string | undefined {
  const classNameValue =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>).className ?? (value as Record<string, unknown>)._
      : undefined;
  const className = typeof classNameValue === "string" && classNameValue ? classNameValue : undefined;

  if (!className) {
    return undefined;
  }

  if (className.includes("User")) {
    return "user";
  }

  if (className.includes("Channel")) {
    return "channel";
  }

  if (className.includes("Chat")) {
    return "chat";
  }

  return className;
}

export function normalizePeer(value: unknown, includeRaw = false): NormalizedPeer | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const username = typeof record.username === "string" && record.username.trim() ? record.username.trim() : undefined;
  const titleCandidates = [record.title, record.name, record.firstName].filter((item) => typeof item === "string") as string[];
  const title = titleCandidates.find((item) => item.trim());
  const id = toSerializableId(record.id ?? record.userId ?? record.chatId ?? record.channelId);
  const ref = username ? `@${username}` : id;

  return {
    id,
    raw: includeRaw ? safeRaw(value) : undefined,
    ref,
    title,
    type: detectPeerType(value),
    username
  };
}

export function peerInputFromValue(value: unknown): string | number | Record<string, unknown> {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value && typeof value === "object") {
    const normalized = normalizePeer(value);
    if (normalized?.username) {
      return `@${normalized.username}`;
    }

    if (normalized?.id) {
      return normalized.id;
    }

    return value as Record<string, unknown>;
  }

  throw new Error("Telegram peer must be a username, numeric id, or peer object.");
}

export function sanitizeCredentials(input: {
  apiHash?: unknown;
  apiId?: unknown;
  phone?: unknown;
  sessionString?: unknown;
}): {
  apiHash: string;
  apiId: number;
  phone: string;
  sessionString?: string;
} {
  const apiId = Number(input.apiId);
  const apiHash = typeof input.apiHash === "string" ? input.apiHash.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const sessionString = typeof input.sessionString === "string" ? input.sessionString.trim() : "";

  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("A valid Telegram api_id is required.");
  }

  if (!apiHash) {
    throw new Error("A valid Telegram api_hash is required.");
  }

  if (!phone) {
    throw new Error("A phone number is required for Telegram user login.");
  }

  return {
    apiHash,
    apiId,
    phone,
    sessionString: sessionString || undefined
  };
}

export function statusLabel(state: AuthStatus["state"], error?: string): string {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "awaiting_code":
      return "Awaiting login code";
    case "awaiting_password":
      return "Awaiting 2FA password";
    case "connected":
      return "Connected";
    case "error":
      return error ? `Error: ${error}` : "Error";
    default:
      return "Disconnected";
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
