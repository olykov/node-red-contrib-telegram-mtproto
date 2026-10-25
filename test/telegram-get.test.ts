import { afterEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";

import { parseHistoryRequest, parseMessageRequest, parseTopicRequest } from "../src/nodes/input-parsers";
import { normalizeMessage } from "../src/telegram/message-normalizer";
import { TelegramRuntimeClient } from "../src/telegram/runtime-client";
import { SessionController } from "../src/telegram/session-controller";
import type { TelegramClientLike } from "../src/telegram/types";

function createRuntime(client: Partial<TelegramClientLike>): TelegramRuntimeClient {
  vi.spyOn(SessionController.prototype, "getClient").mockReturnValue(client as TelegramClientLike);
  vi.spyOn(SessionController.prototype, "getStatus").mockReturnValue({ state: "connected", label: "Connected" });
  vi.spyOn(SessionController.prototype, "onStatus").mockReturnValue(() => undefined);
  return new TelegramRuntimeClient({
    apiHash: "test",
    apiId: 1,
    phone: "+10000000000",
    sessionString: "test",
    reconnectMinMs: 1000,
    reconnectMaxMs: 10000
  });
}

afterEach(() => vi.restoreAllMocks());

describe("telegram-api-get", () => {
  it("lists all dialogs and filters by title or username without losing chat IDs", async () => {
    const getDialogs = vi.fn().mockResolvedValue([
      { id: { toString: () => "-1001234567890" }, title: "Project Updates", entity: { username: "project_updates" }, isChannel: true },
      { id: { toString: () => "42" }, title: "Alex", entity: {}, isUser: true },
      { id: { toString: () => "-1009876543210" }, title: "Team", entity: {}, isGroup: true }
    ]);
    const runtime = createRuntime({ getDialogs });

    expect(await runtime.getChats()).toEqual([
      { chat_id: "-1001234567890", title: "Project Updates", type: "channel", username: "project_updates" },
      { chat_id: "42", title: "Alex", type: "user", username: undefined },
      { chat_id: "-1009876543210", title: "Team", type: "group", username: undefined }
    ]);
    expect(await runtime.getChats("PROJECT_UPDATES")).toHaveLength(1);
    expect(getDialogs).toHaveBeenCalledWith({});
  });

  it("reads forum topics and returns a usable next-page cursor", async () => {
    const topic = new Api.ForumTopic({ id: 123, title: "Ideas", date: 1000, topMessage: 456 } as any);
    const invoke = vi.fn().mockResolvedValue({
      count: 2,
      topics: [topic],
      messages: [{ id: 456, date: 2000 }]
    });
    const getInputEntity = vi.fn().mockResolvedValue({ className: "InputPeerChannel" });
    const runtime = createRuntime({ invoke, getInputEntity });

    const result = await runtime.getTopics({ peer: "-1001234567890", query: "idea" });

    expect(result).toEqual({
      topics: [{ thread_id: 123, title: "Ideas", closed: false, pinned: false }],
      count: 2,
      next_cursor: { offset_date: 2000, offset_id: 456, offset_topic: 123 }
    });
    expect(getInputEntity).toHaveBeenCalledWith("-1001234567890");
    const request = invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.channels.GetForumTopics);
    expect(request.originalArgs).toMatchObject({ q: "idea", offsetDate: 0, offsetId: 0, offsetTopic: 0, limit: 100 });
  });

  it("keeps history reads available for existing flows", async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: "42" });
    const getMessages = vi.fn().mockResolvedValue([{ id: 7, message: "Hello", date: 1700000000 }]);
    const runtime = createRuntime({ getEntity, getMessages });

    const history = await runtime.getHistory({ peer: "42", limit: 10, includeRaw: false, unreadOnly: false });

    expect(history[0]).toMatchObject({ id: 7, text: "Hello" });
    expect(getMessages).toHaveBeenCalledWith({ id: "42" }, { limit: 10, offsetId: undefined });
  });

  it("filters history by sender through Telegram", async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: "42" });
    const getMessages = vi.fn().mockResolvedValue([]);
    const runtime = createRuntime({ getEntity, getMessages });
    const msg = { payload: { sender_id: "123" }, telegram: { peer: "42", senderId: undefined as string | undefined } };
    const request = parseHistoryRequest(msg, {
      includeRaw: false, limit: 10, unreadOnly: false
    });

    await runtime.getHistory(request);
    expect(getMessages).toHaveBeenCalledWith({ id: "42" }, { limit: 10, offsetId: undefined, fromUser: "123" });
    expect(msg.telegram.senderId).toBe("123");
  });

  it.each([
    ["photo", Api.InputMessagesFilterPhotos],
    ["video", Api.InputMessagesFilterVideo],
    ["voice", Api.InputMessagesFilterVoice],
    ["audio", Api.InputMessagesFilterMusic],
    ["file", Api.InputMessagesFilterDocument],
    ["video_note", Api.InputMessagesFilterRoundVideo],
    ["animation", Api.InputMessagesFilterGif]
  ] as const)("uses Telegram's native %s filter", async (contentType, Filter) => {
    const getEntity = vi.fn().mockResolvedValue({ id: "42" });
    const getMessages = vi.fn().mockResolvedValue([]);
    const runtime = createRuntime({ getEntity, getMessages });
    const request = parseHistoryRequest({ payload: { content_type: contentType } }, {
      includeRaw: false, limit: 10, peer: "42", unreadOnly: false
    });

    await runtime.getHistory(request);

    expect(getMessages.mock.calls[0][1].filter).toBeInstanceOf(Filter);
  });

  it("keeps query, sender and media selection when payload is replaced between pages", async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: "42" });
    const getMessages = vi.fn().mockResolvedValue([{ id: 100, message: "Release" }]);
    const runtime = createRuntime({ getEntity, getMessages });
    const defaults = { includeRaw: false, limit: 100, peer: "42", unreadOnly: false };
    const msg: Record<string, unknown> = {
      payload: { query: "  release  ", sender_id: "123", content_type: "video" }
    };

    const firstPage = await runtime.getHistory(parseHistoryRequest(msg, defaults));
    expect(firstPage).toHaveLength(1);
    msg.payload = null;
    (msg.telegram as Record<string, unknown>).offsetId = 100;
    const nextRequest = parseHistoryRequest(msg, defaults);
    await runtime.getHistory(nextRequest);

    expect(nextRequest).toMatchObject({ query: "release", senderId: "123", contentType: "video", offsetId: 100 });
    for (const [, options] of getMessages.mock.calls) {
      expect(options).toMatchObject({ search: "release", fromUser: "123", limit: 100 });
      expect(options.filter).toBeInstanceOf(Api.InputMessagesFilterVideo);
    }
    expect(getMessages.mock.calls[1][1].offsetId).toBe(100);
  });

  it("allows a blank query to clear an existing query without changing page length", async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: "42" });
    const getMessages = vi.fn().mockResolvedValue([
      { id: 8, message: "Text" },
      { id: 7, message: "Caption", media: { className: "MessageMediaPhoto" } }
    ]);
    const runtime = createRuntime({ getEntity, getMessages });
    const msg = { payload: { query: "   " }, telegram: { peer: "42", query: "previous" } };
    const request = parseHistoryRequest(msg, { includeRaw: false, limit: 10, unreadOnly: false });

    expect(await runtime.getHistory(request)).toHaveLength(2);
    expect(msg.telegram.query).toBeUndefined();
    expect(getMessages.mock.calls[0][1]).not.toHaveProperty("search");
    expect(getMessages.mock.calls[0][1]).not.toHaveProperty("filter");
  });

  it.each([
    [{ query: 123 }, "query must be a string"],
    [{ content_type: "unknown" }, "content_type must be one of"],
    [{ content_type: "text" }, "content_type must be one of"],
    [{ content_type: ["photo", "video"] }, "content_type must be one of"]
  ])("rejects unsupported history filters: %j", (payload, error) => {
    expect(() => parseHistoryRequest({ payload }, {
      includeRaw: false, limit: 10, peer: "42", unreadOnly: false
    })).toThrow(String(error));
  });

  it("reads one message by ID or Telegram link without downloading media", async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: "chat" });
    const getMessages = vi.fn().mockResolvedValue([{
      id: 123,
      message: "Reply",
      replyTo: { replyToMsgId: 100 },
      media: { className: "MessageMediaPhoto" }
    }]);
    const runtime = createRuntime({ getEntity, getMessages });

    expect(parseMessageRequest({ payload: { link: "https://t.me/c/1234567890/123" } })).toEqual({ peer: "-1001234567890", messageId: 123 });
    expect(parseMessageRequest({ payload: { link: "https://t.me/example_chat/123" } })).toEqual({ peer: "@example_chat", messageId: 123 });
    expect(parseMessageRequest({ payload: { link: "https://t.me/example_chat/45/123" } })).toEqual({ peer: "@example_chat", messageId: 123 });
    expect(parseMessageRequest({ payload: { chat_id: "42", message_id: 123 } })).toEqual({ peer: "42", messageId: 123 });
    expect(await runtime.getMessage({ peer: "42", messageId: 123 })).toMatchObject({
      id: 123, contentType: "photo", replyToMessageId: 100
    });
    expect(getMessages).toHaveBeenCalledWith({ id: "chat" }, { ids: 123 });
    expect(() => parseMessageRequest({ payload: { link: "https://example.com/example_chat/123" } })).toThrow("t.me URL");
  });

  it("reports useful media types without fetching files", () => {
    expect(normalizeMessage({ id: 1, message: "Text" }).contentType).toBe("text");
    expect(normalizeMessage({ id: 2, media: {
      className: "MessageMediaDocument",
      document: { attributes: [{ className: "DocumentAttributeAudio", voice: true }] }
    } }).contentType).toBe("voice");
    expect(normalizeMessage({ id: 3, media: {
      className: "MessageMediaDocument",
      document: { attributes: [{ className: "DocumentAttributeVideo", roundMessage: false }] }
    } }).contentType).toBe("video");
  });

  it("requires a chat and valid cursor offsets for topic reads", () => {
    expect(() => parseTopicRequest({ payload: {} })).toThrow("No Telegram chat provided");
    expect(() => parseTopicRequest({ payload: { chat_id: "-1001234567890", cursor: { offset_date: 1, offset_id: -1, offset_topic: 2 } } }))
      .toThrow("non-negative integer offsets");
    expect(parseTopicRequest({ payload: { chat_id: "-1001234567890", query: " Ideas " } }))
      .toEqual({ peer: "-1001234567890", query: "Ideas", cursor: undefined });
  });
});
