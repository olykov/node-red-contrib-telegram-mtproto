export type AuthState =
  | "disconnected"
  | "connecting"
  | "awaiting_code"
  | "awaiting_password"
  | "connected"
  | "error";

export interface AuthStatus {
  state: AuthState;
  label: string;
  error?: string;
  sessionString?: string;
}

export interface ConnectionCredentials {
  apiHash: string;
  apiId: number;
  phone: string;
  sessionString?: string;
}

export interface NormalizedPeer {
  id?: string;
  raw?: unknown;
  type?: string;
  username?: string;
  title?: string;
  ref?: string;
}

export interface NormalizedMedia {
  fileName?: string;
  mimeType?: string;
  size?: number;
  type: string;
}

export interface NormalizedMessage {
  chatId?: string;
  date?: string;
  id?: number | string;
  media?: NormalizedMedia;
  messageId?: number | string;
  outgoing: boolean;
  peer?: NormalizedPeer;
  raw?: unknown;
  replyToMessageId?: number;
  senderId?: string;
  text: string;
}

export interface SendMediaInput {
  file: Buffer | string;
  fileName?: string;
}

export interface SendRequest {
  caption?: string;
  media?: SendMediaInput;
  peer: string | number | Record<string, unknown>;
  text?: string;
}

export interface HistoryRequest {
  includeRaw: boolean;
  limit: number;
  offsetId?: number;
  peer: string | number | Record<string, unknown>;
  unreadOnly: boolean;
}

export interface RuntimeClientOptions extends ConnectionCredentials {
  reconnectMaxMs: number;
  reconnectMinMs: number;
}

export interface RuntimeStatusListener {
  (status: AuthStatus): void;
}

export interface TelegramStartOptions {
  onError(error: Error): void;
  password(): Promise<string>;
  phoneCode(): Promise<string>;
  phoneNumber(): Promise<string>;
}

export interface TelegramClientLike {
  addEventHandler?(handler: (event: unknown) => void, eventBuilder?: unknown): void;
  connect?(): Promise<void>;
  disconnect(): Promise<void>;
  disconnected?: Promise<unknown>;
  getEntity?(input: unknown): Promise<unknown>;
  getInputEntity?(input: unknown): Promise<unknown>;
  getMessages?(entity: unknown, options: Record<string, unknown>): Promise<unknown[]>;
  invoke?(request: unknown): Promise<unknown>;
  removeEventHandler?(handler: (event: unknown) => void, eventBuilder?: unknown): void;
  sendFile?(entity: unknown, options: Record<string, unknown>): Promise<unknown>;
  sendMessage?(entity: unknown, options: Record<string, unknown>): Promise<unknown>;
  session: {
    save(): string;
  };
  start(options: TelegramStartOptions): Promise<void>;
}

export interface SessionControllerOptions {
  clientFactory?(credentials: ConnectionCredentials): TelegramClientLike;
}
