/**
 * WhatsApp adapter contract. Both the fixture adapter (tests / no-pairing) and
 * the real Baileys adapter implement this, so the outbox, command handler, and
 * worker never depend on the concrete library.
 */

export type WAStatus = "disconnected" | "qr" | "connecting" | "connected";

export interface SendTarget {
  /** WhatsApp chat id, e.g. "123@c.us" (individual) or "123-456@g.us" (group). */
  chatId: string;
}

export interface SentMessage {
  id: string | null;
  ok: boolean;
  /** true when the send outcome is unknown and must be reconciled, not retried. */
  uncertain?: boolean;
  error?: string;
}

export interface InboundReaction {
  kind: "reaction";
  messageId: string; // id of the message being reacted to
  emoji: string;
  senderId: string;
  removed: boolean; // true when a reaction was REMOVED (must be ignored)
  fromMe: boolean; // reactions authored by the paired (bot) account
}

export interface InboundReply {
  kind: "reply";
  messageId: string; // id of THIS reply message
  quotedMessageId: string | null; // message it replies to, if any
  body: string;
  senderId: string;
  chatId: string;
  fromMe: boolean;
}

export type InboundEvent = InboundReaction | InboundReply;
export type InboundHandler = (coupleId: string, event: InboundEvent) => Promise<void>;

export interface WhatsAppAdapter {
  readonly coupleId: string;
  readonly userId: string;
  status(): WAStatus;
  lastQr(): string | null;
  /** Begin pairing; resolves once the client is initialising (QR may follow). */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(target: SendTarget, body: string): Promise<SentMessage>;
  onInbound(handler: InboundHandler): void;
  onStatusChange(handler: (status: WAStatus, phone?: string) => void): void;
}

/**
 * Fixture adapter: no real WhatsApp connection. Records sent messages and lets
 * tests push inbound events. Also the default when WHATSAPP_ENABLED is false so
 * the rest of the app behaves identically.
 */
export class FixtureAdapter implements WhatsAppAdapter {
  private _status: WAStatus = "disconnected";
  private inbound: InboundHandler | null = null;
  private statusCb: ((s: WAStatus, phone?: string) => void) | null = null;
  public readonly sent: Array<{ chatId: string; body: string; id: string }> = [];
  private counter = 0;

  constructor(
    public readonly coupleId: string,
    public readonly userId: string = "",
  ) {}

  status(): WAStatus {
    return this._status;
  }
  lastQr(): string | null {
    return this._status === "qr" ? "data:image/png;base64,FIXTURE_QR" : null;
  }
  async connect(): Promise<void> {
    this._status = "connected";
    this.statusCb?.("connected", "fixture");
  }
  async disconnect(): Promise<void> {
    this._status = "disconnected";
    this.statusCb?.("disconnected");
  }
  async sendMessage(target: SendTarget, body: string): Promise<SentMessage> {
    const id = `fixture-${this.coupleId}-${++this.counter}`;
    this.sent.push({ chatId: target.chatId, body, id });
    return { id, ok: true };
  }
  onInbound(handler: InboundHandler): void {
    this.inbound = handler;
  }
  onStatusChange(handler: (status: WAStatus, phone?: string) => void): void {
    this.statusCb = handler;
  }

  /** Test helper: simulate an inbound event. */
  async push(event: InboundEvent): Promise<void> {
    await this.inbound?.(this.coupleId, event);
  }
  setStatus(s: WAStatus) {
    this._status = s;
  }
}
