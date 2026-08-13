import type { NormalizedMedia, NormalizedMessage, NormalizedPeer } from "./types";
import { normalizePeer, safeRaw, toSerializableId } from "./utils";

function detectPeerFromMessage(message: Record<string, unknown>, includeRaw: boolean): NormalizedPeer | undefined {
  const directPeer = normalizePeer(message.chat, includeRaw) ?? normalizePeer(message.peer, includeRaw);
  if (directPeer) {
    return directPeer;
  }

  const peerId = message.peerId;
  if (!peerId || typeof peerId !== "object") {
    return undefined;
  }

  const peerRecord = peerId as Record<string, unknown>;
  const id = toSerializableId(peerRecord.userId ?? peerRecord.chatId ?? peerRecord.channelId ?? peerRecord.id);
  let type: string | undefined;

  if ("userId" in peerRecord) {
    type = "user";
  } else if ("channelId" in peerRecord) {
    type = "channel";
  } else if ("chatId" in peerRecord) {
    type = "chat";
  }

  return {
    id,
    raw: includeRaw ? safeRaw(peerId) : undefined,
    ref: id,
    type
  };
}

function normalizeMedia(media: unknown): NormalizedMedia | undefined {
  if (!media || typeof media !== "object") {
    return undefined;
  }

  const mediaRecord = media as Record<string, unknown>;
  const className = String(mediaRecord.className ?? mediaRecord._ ?? "media");

  const document = typeof mediaRecord.document === "object" ? (mediaRecord.document as Record<string, unknown>) : undefined;
  const attributes = Array.isArray(document?.attributes) ? (document?.attributes as Array<Record<string, unknown>>) : [];
  const fileNameAttribute = attributes.find((attribute) => String(attribute.className ?? attribute._).includes("Filename"));
  const fileName =
    (typeof fileNameAttribute?.fileName === "string" && fileNameAttribute.fileName) ||
    (typeof document?.fileName === "string" && document.fileName) ||
    undefined;

  return {
    fileName,
    mimeType: typeof document?.mimeType === "string" ? document.mimeType : undefined,
    size: typeof document?.size === "number" ? document.size : undefined,
    type: className
  };
}

export function normalizeMessage(message: unknown, includeRaw = false): NormalizedMessage {
  const messageRecord = (message ?? {}) as Record<string, unknown>;
  const peer = detectPeerFromMessage(messageRecord, includeRaw);
  const replyTo = typeof messageRecord.replyTo === "object" ? (messageRecord.replyTo as Record<string, unknown>) : undefined;
  const messageId =
    typeof messageRecord.id === "number" || typeof messageRecord.id === "string"
      ? messageRecord.id
      : toSerializableId(messageRecord.id);

  return {
    chatId: peer?.id,
    date:
      messageRecord.date instanceof Date
        ? messageRecord.date.toISOString()
        : typeof messageRecord.date === "string"
          ? messageRecord.date
          : undefined,
    id: messageId,
    media: normalizeMedia(messageRecord.media),
    messageId,
    outgoing: Boolean(messageRecord.out),
    peer,
    raw: includeRaw ? safeRaw(message) : undefined,
    replyToMessageId:
      typeof replyTo?.replyToMsgId === "number"
        ? replyTo.replyToMsgId
        : typeof messageRecord.replyToMsgId === "number"
          ? messageRecord.replyToMsgId
          : undefined,
    senderId: toSerializableId(messageRecord.senderId),
    text:
      (typeof messageRecord.message === "string" && messageRecord.message) ||
      (typeof messageRecord.text === "string" && messageRecord.text) ||
      ""
  };
}

export function normalizeEntity(value: unknown, includeRaw = false): NormalizedPeer {
  return normalizePeer(value, includeRaw) ?? { raw: includeRaw ? safeRaw(value) : undefined };
}
