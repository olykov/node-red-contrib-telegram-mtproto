import { HISTORY_CONTENT_TYPES } from "../telegram/types";
import type { HistoryContentType, HistoryRequest, MessageRequest, SendRequest, TopicRequest } from "../telegram/types";

function normalizePeerValue(value: unknown): string | number | Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function normalizeInteger(value: unknown, fallback: number, min = 1, max = 100): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(numericValue), min), max);
}

export function parseSendRequest(msg: Record<string, unknown>, defaultPeer?: unknown): SendRequest {
  const telegram = (msg.telegram as Record<string, unknown> | undefined) ?? {};
  const payload = msg.payload;
  const peer = normalizePeerValue(telegram.peer ?? msg.peer ?? defaultPeer);

  if (!peer) {
    throw new Error("No Telegram peer provided. Configure a default peer or set msg.telegram.peer.");
  }

  let text: string | undefined;
  let caption: string | undefined;
  let media: SendRequest["media"];

  if (Buffer.isBuffer(payload)) {
    media = {
      file: payload,
      fileName: typeof telegram.fileName === "string" ? telegram.fileName : "telegram-upload.bin"
    };
    caption = typeof telegram.caption === "string" ? telegram.caption : undefined;
  } else if (typeof payload === "string") {
    const payloadText = payload.trim();
    if (typeof telegram.mediaPath === "string" && telegram.mediaPath.trim()) {
      media = { file: telegram.mediaPath.trim() };
      caption = payloadText || (typeof telegram.caption === "string" ? telegram.caption : undefined);
    } else {
      text = payloadText;
    }
  } else if (payload && typeof payload === "object") {
    const payloadRecord = payload as Record<string, unknown>;
    const mediaCandidate = payloadRecord.mediaPath ?? payloadRecord.filePath ?? telegram.mediaPath;
    const bufferCandidate = payloadRecord.mediaBuffer ?? telegram.mediaBuffer;
    const textCandidate = payloadRecord.text ?? payloadRecord.message ?? payloadRecord.caption;

    if (typeof mediaCandidate === "string" && mediaCandidate.trim()) {
      media = { file: mediaCandidate.trim() };
    } else if (Buffer.isBuffer(bufferCandidate)) {
      media = {
        file: bufferCandidate,
        fileName:
          (typeof payloadRecord.fileName === "string" && payloadRecord.fileName) ||
          (typeof telegram.fileName === "string" && telegram.fileName) ||
          "telegram-upload.bin"
      };
    }

    if (typeof textCandidate === "string" && textCandidate.trim()) {
      if (media) {
        caption = textCandidate.trim();
      } else {
        text = textCandidate.trim();
      }
    }
  }

  if (!caption && typeof telegram.caption === "string" && telegram.caption.trim()) {
    caption = telegram.caption.trim();
  }

  if (!media && !text) {
    throw new Error("Nothing to send. Provide text in msg.payload or media in msg.payload/msg.telegram.");
  }

  return {
    caption,
    media,
    peer,
    text
  };
}

export function parseHistoryRequest(
  msg: Record<string, unknown>,
  defaults: { includeRaw: boolean; limit: number; peer?: unknown; unreadOnly: boolean }
): HistoryRequest {
  const telegram = (msg.telegram as Record<string, unknown> | undefined) ?? {};
  const peer = normalizePeerValue(telegram.peer ?? msg.peer ?? defaults.peer);

  if (!peer) {
    throw new Error("No Telegram peer provided. Configure a default peer or set msg.telegram.peer.");
  }

  const offsetId = telegram.offsetId ?? msg.offsetId;
  const payload = (msg.payload && typeof msg.payload === "object" ? msg.payload : {}) as Record<string, unknown>;
  const senderId = payload.sender_id ?? telegram.senderId;
  if (senderId !== undefined && !/^\d+$/.test(String(senderId).trim())) {
    throw new Error("Telegram sender_id must be a user ID.");
  }
  const query = payload.query ?? telegram.query;
  if (query !== undefined && typeof query !== "string") {
    throw new Error("Telegram history query must be a string.");
  }
  const contentType = payload.content_type ?? telegram.contentType;
  if (contentType !== undefined && !HISTORY_CONTENT_TYPES.includes(contentType as HistoryContentType)) {
    throw new Error(`Telegram history content_type must be one of: ${HISTORY_CONTENT_TYPES.join(", ")}.`);
  }
  const normalizedQuery = typeof query === "string" ? query.trim() || undefined : undefined;
  telegram.senderId = senderId === undefined ? undefined : String(senderId).trim();
  telegram.query = normalizedQuery;
  telegram.contentType = contentType;
  msg.telegram = telegram;

  return {
    contentType: contentType as HistoryContentType | undefined,
    includeRaw: Boolean(telegram.includeRaw ?? defaults.includeRaw),
    limit: normalizeInteger(telegram.limit ?? msg.limit, defaults.limit),
    offsetId: offsetId === undefined ? undefined : normalizeInteger(offsetId, 0, 0, Number.MAX_SAFE_INTEGER),
    peer,
    query: normalizedQuery,
    senderId: senderId === undefined ? undefined : String(senderId).trim(),
    unreadOnly: Boolean(telegram.unreadOnly ?? msg.unreadOnly ?? defaults.unreadOnly)
  };
}

export function parseMessageRequest(msg: Record<string, unknown>, defaultPeer?: unknown): MessageRequest {
  const payload = (msg.payload && typeof msg.payload === "object" ? msg.payload : {}) as Record<string, unknown>;
  const link = payload.link;
  let peer = normalizePeerValue(payload.chat_id ?? defaultPeer);
  let messageId: unknown = payload.message_id;

  if (link !== undefined) {
    if (typeof link !== "string") {
      throw new Error("Telegram message link must be a t.me URL.");
    }
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new Error("Telegram message link must be a t.me URL.");
    }
    if (url.protocol !== "https:" || url.hostname !== "t.me") {
      throw new Error("Telegram message link must be a t.me URL.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "c" && parts.length >= 3 && /^\d+$/.test(parts[1])) {
      peer = `-100${parts[1]}`;
      messageId = parts[parts.length - 1];
    } else if ((parts.length === 2 || parts.length === 3) && /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(parts[0])) {
      peer = `@${parts[0]}`;
      messageId = parts[parts.length - 1];
    } else {
      throw new Error("Unsupported Telegram message link.");
    }
  }

  const numericId = Number(messageId);
  if (!peer || !Number.isSafeInteger(numericId) || numericId <= 0) {
    throw new Error("Provide a Telegram chat_id and positive message_id, or a t.me message link.");
  }
  return { peer, messageId: numericId };
}

export function parseTopicRequest(msg: Record<string, unknown>, defaultPeer?: unknown): TopicRequest {
  const payload = (msg.payload && typeof msg.payload === "object" ? msg.payload : {}) as Record<string, unknown>;
  const telegram = (msg.telegram as Record<string, unknown> | undefined) ?? {};
  const peer = normalizePeerValue(payload.chat_id ?? telegram.peer ?? msg.peer ?? defaultPeer);
  if (!peer) {
    throw new Error("No Telegram chat provided. Set msg.payload.chat_id or configure a default peer.");
  }

  const query = payload.query ?? telegram.query;
  if (query !== undefined && typeof query !== "string") {
    throw new Error("Telegram topic query must be a string.");
  }

  const value = payload.cursor;
  let cursor: TopicRequest["cursor"];
  if (value !== undefined) {
    const fields = value as Record<string, unknown>;
    const offsetDate = Number(fields?.offset_date);
    const offsetId = Number(fields?.offset_id);
    const offsetTopic = Number(fields?.offset_topic);
    if (![offsetDate, offsetId, offsetTopic].every((item) => Number.isSafeInteger(item) && item >= 0)) {
      throw new Error("Telegram topic cursor must contain non-negative integer offsets.");
    }
    cursor = { offset_date: offsetDate, offset_id: offsetId, offset_topic: offsetTopic };
  }

  return { peer, query: typeof query === "string" ? query.trim() || undefined : undefined, cursor };
}
