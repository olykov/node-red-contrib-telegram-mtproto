import type { HistoryRequest, SendRequest } from "../telegram/types";

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

  return {
    includeRaw: Boolean(telegram.includeRaw ?? defaults.includeRaw),
    limit: normalizeInteger(telegram.limit ?? msg.limit, defaults.limit),
    offsetId: offsetId === undefined ? undefined : normalizeInteger(offsetId, 0, 0, Number.MAX_SAFE_INTEGER),
    peer,
    unreadOnly: Boolean(telegram.unreadOnly ?? msg.unreadOnly ?? defaults.unreadOnly)
  };
}
