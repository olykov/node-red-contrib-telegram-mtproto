# node-red-contrib-telegram-mtproto

Node-RED palette for driving a real Telegram user account over MTProto with [GramJS](https://gram.js.org/), rather than the Telegram Bot API.

## Provenance

Initial code was imported from [`alessandromatera/telegram-api`](https://github.com/alessandromatera/telegram-api/tree/22ace21) at commit `22ace21` under the MIT license.

## What it includes

- `telegram-api-config`: stores `api_id`, `api_hash`, phone number, reconnect settings, and the encrypted session string
- `telegram-api-in`: emits incoming messages as normalized Node-RED messages, optionally ignoring outgoing/self live events
- `telegram-api-send`: sends text or media to a peer
- `telegram-api-history`: fetches recent messages for a peer, optionally only unread incoming messages
- `telegram-api-get`: reads message history, lists chats by name, or lists forum topics in a chat

## Runtime requirements

- Node.js 20+
- Node-RED 4+
- A Telegram API app created at [my.telegram.org](https://my.telegram.org)

## Install from GitHub

```bash
cd ~/.node-red
npm install git+https://github.com/olykov/node-red-contrib-telegram-mtproto.git
```

Then restart Node-RED and add the `telegram user` nodes from the palette.

## Install locally for development

```bash
npm install
npm run build
cd ~/.node-red
npm install /absolute/path/to/node-red-contrib-telegram-mtproto
```

## Get your API ID and API hash

Telegram requires your own app credentials for MTProto user-account access.

1. Sign in to Telegram with an official app using the phone number you want to use.
2. Open [my.telegram.org](https://my.telegram.org) and log in with that same phone number.
3. Open [API development tools](https://my.telegram.org/apps).
4. Fill in the app form with any name, short name, and basic platform details.
5. Save the form and copy the generated `api_id` and `api_hash`.

Notes:

- Telegram’s official docs for this flow are here: [Creating your Telegram Application](https://core.telegram.org/api/obtaining_api_id).
- Telegram says each phone number can only have one `api_id` connected to it, so reuse the same credentials for this palette.
- Keep `api_hash` private. Treat it like a password.

## Login flow

1. Open the `telegram-api-config` node.
2. Enter `API ID`, `API Hash`, and your phone number.
3. Click `Connect`.
4. Enter the login code Telegram sends you.
5. If 2FA is enabled, enter the password.
6. Save and deploy after the session is captured.

The runtime reconnects with the stored session string after restart. If you open an existing config later, `Test Connection` checks the deployed runtime session. If you need a fresh session, re-enter the `API Hash` and run `Connect` again.

## Example Node-RED flow

Import this JSON from the Node-RED editor (`Menu -> Import -> Clipboard`) to get a starter flow with:

- one `telegram-api-config` node
- one `telegram-api-send` example that sends to Saved Messages
- one `telegram-api-in` listener that prints incoming messages
- one `telegram-api-history` example that reads the last 5 messages from Saved Messages

After importing:

1. Open the `My Telegram` config node.
2. Enter your `API ID`, `API Hash`, and phone number.
3. Click `Connect`, complete the login flow, then `Deploy`.
4. Use the inject nodes to test sending and reading history.

```json
[
  {
    "id": "a1f4d7c2e9b00101",
    "type": "tab",
    "label": "Telegram User Example",
    "disabled": false,
    "info": ""
  },
  {
    "id": "b2f4d7c2e9b00102",
    "type": "telegram-api-config",
    "name": "My Telegram",
    "reconnectMinMs": "2000",
    "reconnectMaxMs": "30000",
    "downloadDir": ""
  },
  {
    "id": "c3f4d7c2e9b00103",
    "type": "inject",
    "z": "a1f4d7c2e9b00101",
    "name": "Send test message",
    "props": [
      {
        "p": "payload"
      }
    ],
    "repeat": "",
    "crontab": "",
    "once": false,
    "onceDelay": 0.1,
    "topic": "",
    "payload": "hello from Node-RED",
    "payloadType": "str",
    "x": 170,
    "y": 100,
    "wires": [
      [
        "d4f4d7c2e9b00104"
      ]
    ]
  },
  {
    "id": "d4f4d7c2e9b00104",
    "type": "telegram-api-send",
    "z": "a1f4d7c2e9b00101",
    "name": "Send to Saved Messages",
    "account": "b2f4d7c2e9b00102",
    "peer": "@savedmessages",
    "x": 470,
    "y": 100,
    "wires": [
      [
        "e5f4d7c2e9b00105"
      ]
    ]
  },
  {
    "id": "e5f4d7c2e9b00105",
    "type": "debug",
    "z": "a1f4d7c2e9b00101",
    "name": "Send result",
    "active": true,
    "tosidebar": true,
    "console": false,
    "tostatus": false,
    "complete": "true",
    "targetType": "full",
    "x": 760,
    "y": 100,
    "wires": []
  },
  {
    "id": "f6f4d7c2e9b00106",
    "type": "telegram-api-in",
    "z": "a1f4d7c2e9b00101",
    "name": "Incoming messages",
    "account": "b2f4d7c2e9b00102",
    "includeRaw": false,
    "unreadOnly": false,
    "x": 190,
    "y": 200,
    "wires": [
      [
        "07f4d7c2e9b00107"
      ]
    ]
  },
  {
    "id": "07f4d7c2e9b00107",
    "type": "debug",
    "z": "a1f4d7c2e9b00101",
    "name": "Incoming debug",
    "active": true,
    "tosidebar": true,
    "console": false,
    "tostatus": false,
    "complete": "true",
    "targetType": "full",
    "x": 470,
    "y": 200,
    "wires": []
  },
  {
    "id": "18f4d7c2e9b00108",
    "type": "inject",
    "z": "a1f4d7c2e9b00101",
    "name": "Read last 5",
    "props": [
      {
        "p": "payload"
      }
    ],
    "repeat": "",
    "crontab": "",
    "once": false,
    "onceDelay": 0.1,
    "topic": "",
    "payload": "",
    "payloadType": "date",
    "x": 150,
    "y": 300,
    "wires": [
      [
        "29f4d7c2e9b00109"
      ]
    ]
  },
  {
    "id": "29f4d7c2e9b00109",
    "type": "telegram-api-history",
    "z": "a1f4d7c2e9b00101",
    "name": "Saved Messages History",
    "account": "b2f4d7c2e9b00102",
    "peer": "@savedmessages",
    "limit": "5",
    "includeRaw": false,
    "x": 460,
    "y": 300,
    "wires": [
      [
        "3af4d7c2e9b0010a"
      ]
    ]
  },
  {
    "id": "3af4d7c2e9b0010a",
    "type": "debug",
    "z": "a1f4d7c2e9b00101",
    "name": "History debug",
    "active": true,
    "tosidebar": true,
    "console": false,
    "tostatus": false,
    "complete": "true",
    "targetType": "full",
    "x": 750,
    "y": 300,
    "wires": []
  }
]
```

You can replace `@savedmessages` with any username or numeric peer id once the flow is working.

## Message contract

Incoming and action nodes use this shape:

- `msg.payload`: the main payload for the node
- `msg.telegram`: normalized Telegram metadata

Common metadata fields:

- `msg.telegram.peer`: `{ id, type, username, title, ref }`
- `msg.telegram.chatId`
- `msg.telegram.senderId`
- `msg.telegram.messageId`
- `msg.telegram.media`
- `msg.telegram.raw` when the node is configured with `Include Raw`

`telegram-api-in` node options:

- `Unread Only`: ignores outgoing/self live events and only emits unread incoming live messages
- This is a live event filter only. It does not backfill unread messages that arrived before the node started

## Send node input patterns

Text only:

```json
{
  "payload": "hello from Node-RED",
  "telegram": {
    "peer": "@username"
  }
}
```

Media by local path:

```json
{
  "payload": {
    "caption": "daily report",
    "mediaPath": "/tmp/report.pdf"
  },
  "telegram": {
    "peer": "@username"
  }
}
```

Media by Buffer:

```js
msg.payload = Buffer.from("...");
msg.telegram = {
  peer: "@username",
  fileName: "image.jpg",
  caption: "generated by a flow"
};
return msg;
```

History node input supports:

- `msg.telegram.peer` to override the configured peer
- `msg.telegram.limit` or `msg.limit` to control how many messages are returned
- `msg.telegram.offsetId` or `msg.offsetId` to paginate older history
- `msg.telegram.unreadOnly` or `msg.unreadOnly` to return only unread incoming messages

## Read chats, topics, history, and a message

Use one `telegram-api-get` node and choose its **Get** operation:

| Get | Input | `msg.payload` output |
| --- | --- | --- |
| Chats | Optional `{ "query": "project" }` | `{ "chats": [{ "chat_id": "…", "title": "…", "type": "group" }], "count": 1 }` |
| Topics | `{ "chat_id": "-1001234567890" }`, optional `query` and `cursor` | `{ "topics": [{ "thread_id": 123, "title": "Ideas", "closed": false, "pinned": false }], "count": 1, "next_cursor": null }` |
| History | `msg.telegram.peer` or the configured default peer; existing history inputs also apply | Array of normalized messages |
| Message | `{ "chat_id": "-1001234567890", "message_id": 123 }` or `{ "link": "https://t.me/c/1234567890/123" }` | `{ "message": { "id": 123, "text": "…", "content_type": "text", "reply_to_message_id": null } }` or `{ "message": null }` |

Chats lists the account's dialogs, including archived chats. The optional query matches chat titles and usernames without case sensitivity. Topics works only for Telegram forum chats. If `next_cursor` is present, pass it as `msg.payload.cursor` with the same `chat_id` to fetch the next page. History accepts optional `msg.payload.sender_id` to filter by Telegram user ID on the server. Normalized messages include `contentType` (`text`, `photo`, `video`, `video_note`, `voice`, `audio`, `sticker`, `animation`, `file`, `link_preview`, or `other`) and `replyToMessageId`. Media is not downloaded. The existing `telegram-api-history` node remains available for imported flows.

### History search filters

The History operation and the existing `telegram-api-history` node accept these optional inputs:

| Payload input | Retained pagination input | Telegram behavior |
| --- | --- | --- |
| `msg.payload.query` | `msg.telegram.query` | Text search using GramJS `search` |
| `msg.payload.sender_id` | `msg.telegram.senderId` | Sender selection using GramJS `fromUser` |
| `msg.payload.content_type` | `msg.telegram.contentType` | Native Telegram media filter |

Supported `content_type` values are `photo`, `video`, `voice`, `audio`, `file`, `video_note`, and `animation`. One type can be selected per request. All three filters can be combined. A payload value overrides its retained value. An empty or whitespace-only query clears the retained text query.

```javascript
msg.telegram = { peer: "@example_chat", limit: 100 };
msg.payload = { query: "release", content_type: "video", sender_id: "123456789" };
return msg;
```

After each page, the caller may replace `msg.payload` and set `msg.telegram.offsetId` to the last returned message ID. The filters remain in `msg.telegram`. Remove the retained filter fields when reusing that message for an unfiltered request.

The output remains an array of normalized messages. `content_type` uses [Telegram's native media filters](https://core.telegram.org/type/MessagesFilter), so its categories follow Telegram search semantics rather than a comparison with the normalized output `contentType`. Text search uses [messages.search](https://core.telegram.org/method/messages.search); it does not transcribe audio or video.

There is no native text-only media filter. `content_type: "text"` is rejected by the palette. A calling flow that needs this selection must omit the media filter and select normalized `contentType === "text"` after fetching each page, preserving the original page length and cursor for pagination.

## Current v1 scope

- Incoming messages via `NewMessage`
- Text and media sends
- Basic history fetch
- Native text search, sender selection, and media filters for history
- Chat discovery and forum topic listing
- Single-message lookup by ID or t.me link

Cancelled: the reply ancestry chain tool.

Not included yet:

- secret chats
- edits/deletes
- contact management
- stories, calls, or generic low-level MTProto requests
