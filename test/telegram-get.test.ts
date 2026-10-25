import { afterEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";

import { parseTopicRequest } from "../src/nodes/input-parsers";
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

  it("requires a chat and valid cursor offsets for topic reads", () => {
    expect(() => parseTopicRequest({ payload: {} })).toThrow("No Telegram chat provided");
    expect(() => parseTopicRequest({ payload: { chat_id: "-1001234567890", cursor: { offset_date: 1, offset_id: -1, offset_topic: 2 } } }))
      .toThrow("non-negative integer offsets");
    expect(parseTopicRequest({ payload: { chat_id: "-1001234567890", query: " Ideas " } }))
      .toEqual({ peer: "-1001234567890", query: "Ideas", cursor: undefined });
  });
});
