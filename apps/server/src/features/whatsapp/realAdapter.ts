/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from "../../platform/config/env.js";
import { logger } from "../../platform/logger/logger.js";
import type {
  InboundHandler,
  SendTarget,
  SentMessage,
  WAStatus,
  WhatsAppAdapter,
} from "./adapter.js";

/**
 * Real adapter backed by whatsapp-web.js (unofficial). Loaded lazily so the app
 * runs without the library or a paired phone. Session credentials persist via
 * LocalAuth in WHATSAPP_SESSION_DIR so they survive worker restarts.
 *
 * Event shapes were verified against whatsapp-web.js@1.26.0 index.d.ts:
 *   - message_reaction => Reaction { reaction, msgId._serialized, senderId, id.fromMe }
 *   - message          => Message  { id._serialized, body, from, author, fromMe, getQuotedMessage() }
 */
export class RealWhatsAppAdapter implements WhatsAppAdapter {
  private client: any = null;
  private _status: WAStatus = "disconnected";
  private _qr: string | null = null;
  private _phone: string | undefined;
  private inbound: InboundHandler | null = null;
  private statusCb: ((s: WAStatus, phone?: string) => void) | null = null;

  constructor(public readonly coupleId: string) {}

  status(): WAStatus {
    return this._status;
  }
  lastQr(): string | null {
    return this._qr;
  }
  onInbound(handler: InboundHandler): void {
    this.inbound = handler;
  }
  onStatusChange(handler: (s: WAStatus, phone?: string) => void): void {
    this.statusCb = handler;
  }

  private setStatus(s: WAStatus, phone?: string) {
    this._status = s;
    if (phone) this._phone = phone;
    this.statusCb?.(s, this._phone);
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const { Client, LocalAuth } = (await import("whatsapp-web.js")) as any;
    const QRCode = (await import("qrcode")).default as any;

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: `couple-${this.coupleId}`, dataPath: env.WHATSAPP_SESSION_DIR }),
      puppeteer: {
        headless: true,
        executablePath: env.WHATSAPP_CHROME_PATH || undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    this.client.on("qr", async (qr: string) => {
      try {
        this._qr = await QRCode.toDataURL(qr);
      } catch {
        this._qr = null;
      }
      this.setStatus("qr");
    });
    this.client.on("authenticated", () => this.setStatus("connecting"));
    this.client.on("ready", () => {
      this._qr = null;
      const wid = this.client?.info?.wid?.user;
      this.setStatus("connected", wid);
    });
    this.client.on("disconnected", () => this.setStatus("disconnected"));

    this.client.on("message", async (msg: any) => {
      try {
        let quotedMessageId: string | null = null;
        if (msg.hasQuotedMsg) {
          const q = await msg.getQuotedMessage();
          quotedMessageId = q?.id?._serialized ?? null;
        }
        await this.inbound?.(this.coupleId, {
          kind: "reply",
          messageId: msg.id?._serialized,
          quotedMessageId,
          body: String(msg.body ?? ""),
          senderId: msg.author ?? msg.from,
          chatId: msg.from,
          fromMe: !!msg.fromMe,
        });
      } catch (err) {
        logger.error({ err: String(err) }, "Error mapping inbound WhatsApp message");
      }
    });

    this.client.on("message_reaction", async (reaction: any) => {
      try {
        await this.inbound?.(this.coupleId, {
          kind: "reaction",
          messageId: reaction.msgId?._serialized,
          emoji: reaction.reaction ?? "",
          senderId: reaction.senderId,
          removed: !reaction.reaction, // empty reaction string = removal
          fromMe: !!reaction.id?.fromMe,
        });
      } catch (err) {
        logger.error({ err: String(err) }, "Error mapping inbound WhatsApp reaction");
      }
    });

    this.setStatus("connecting");
    await this.client.initialize();
  }

  async disconnect(): Promise<void> {
    try {
      await this.client?.destroy();
    } catch (err) {
      logger.warn({ err: String(err) }, "Error destroying WhatsApp client");
    }
    this.client = null;
    this.setStatus("disconnected");
  }

  async sendMessage(target: SendTarget, body: string): Promise<SentMessage> {
    if (!this.client || this._status !== "connected") {
      return { id: null, ok: false, error: "not connected" };
    }
    try {
      const sent = await this.client.sendMessage(target.chatId, body);
      return { id: sent?.id?._serialized ?? null, ok: true };
    } catch (err) {
      // Network/timeout: outcome unknown → reconcile rather than blind retry.
      return { id: null, ok: false, uncertain: true, error: String(err) };
    }
  }
}
