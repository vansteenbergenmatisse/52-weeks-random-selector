/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from "node:path";
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
 * Real adapter backed by Baileys (unofficial, pure WebSocket — no Chromium).
 * Loaded lazily so the app runs without the library or a paired phone.
 * Multi-file auth state persists per couple in WHATSAPP_SESSION_DIR so the
 * session survives restarts (no re-scan needed after a transient drop).
 *
 * JID mapping: the outbox stores individual chats as "<digits>@c.us" (the
 * whatsapp-web.js convention); Baileys uses "<digits>@s.whatsapp.net". Groups
 * are "@g.us" in both.
 */
function toJid(chatId: string): string {
  if (chatId.endsWith("@g.us")) return chatId; // group ids are @g.us in Baileys too
  const user = chatId.replace(/@.*/, "").replace(/\D/g, "");
  return `${user}@s.whatsapp.net`;
}

export class BaileysWhatsAppAdapter implements WhatsAppAdapter {
  private sock: any = null;
  private _status: WAStatus = "disconnected";
  private _qr: string | null = null;
  private _phone: string | undefined;
  private inbound: InboundHandler | null = null;
  private statusCb: ((s: WAStatus, phone?: string) => void) | null = null;
  private closing = false;
  private normalizeJid: (jid: string) => string = (jid) => jid;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly coupleId: string,
    public readonly userId: string,
  ) {}

  /**
   * Schedule a reconnect with capped exponential backoff + jitter. Baileys drops
   * the socket on its own (network flaps, server-side resets); reconnecting
   * back-to-back with no delay would hammer WhatsApp and risk a rate-limit/ban,
   * and giving up after a single failed attempt would leave the couple silently
   * dark. The worker's periodic heal is the long-run backstop; this keeps a
   * transient drop recovering quickly without a tight loop.
   */
  private scheduleReconnect() {
    if (this.closing || this.reconnectTimer) return;
    const attempt = Math.min(this.reconnectAttempts++, 6);
    const base = Math.min(30_000, 1000 * 2 ** attempt); // 1s,2s,4s… capped at 30s
    const delay = base / 2 + Math.random() * (base / 2); // ±50% jitter
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closing) return;
      this.connect().catch((err) => {
        logger.error({ err: String(err) }, "WhatsApp (baileys) reconnect attempt failed");
        this.scheduleReconnect();
      });
    }, delay);
  }

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
    if (this.sock) return;
    this.closing = false;

    const baileys = (await import("baileys")) as any;
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, Browsers, jidNormalizedUser } = baileys;
    const QRCode = (await import("qrcode")).default as any;
    this.normalizeJid = (jid: string) => {
      try {
        return jidNormalizedUser(jid);
      } catch {
        return jid;
      }
    };

    const dir = join(env.WHATSAPP_SESSION_DIR, `user-${this.userId}`);
    const { state, saveCreds } = await useMultiFileAuthState(dir);

    const sock = makeWASocket({
      auth: state,
      browser: Browsers.appropriate("Our52"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u: any) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        try {
          this._qr = await QRCode.toDataURL(qr);
        } catch {
          this._qr = null;
        }
        this.setStatus("qr");
      }
      if (connection === "connecting") this.setStatus("connecting");
      if (connection === "open") {
        this._qr = null;
        this.reconnectAttempts = 0; // healthy link — reset backoff
        const raw = sock.user?.id as string | undefined;
        const phone = raw ? this.normalizeJid(raw).replace(/@.*/, "") : undefined;
        this.setStatus("connected", phone);
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason?.loggedOut;
        this.sock = null;
        if (this.closing || loggedOut) {
          // Deliberate close, or the phone unlinked us — don't fight it.
          this.setStatus("disconnected");
        } else {
          // Transient drop — resume the persisted session (no re-scan) on a
          // backoff so repeated flaps don't hammer WhatsApp.
          this.setStatus("connecting");
          this.scheduleReconnect();
        }
      }
    });

    sock.ev.on("messages.upsert", async (up: any) => {
      if (up.type !== "notify") return; // ignore history/append syncs
      for (const m of up.messages ?? []) {
        try {
          const msg = m.message;
          if (!msg) continue;
          const text = msg.conversation ?? msg.extendedTextMessage?.text ?? "";
          if (!text) continue;
          const quotedMessageId = msg.extendedTextMessage?.contextInfo?.stanzaId ?? null;
          const sender = m.key?.participant ?? m.key?.remoteJid ?? "";
          await this.inbound?.(this.coupleId, {
            kind: "reply",
            messageId: m.key?.id ?? "",
            quotedMessageId,
            body: String(text),
            senderId: this.normalizeJid(sender),
            chatId: m.key?.remoteJid ?? "",
            fromMe: !!m.key?.fromMe,
          });
        } catch (err) {
          logger.error({ err: String(err) }, "Error mapping inbound WhatsApp message (baileys)");
        }
      }
    });

    sock.ev.on("messages.reaction", async (reactions: any[]) => {
      for (const r of reactions ?? []) {
        try {
          const emoji = r.reaction?.text ?? "";
          const reactor = r.reaction?.key?.participant ?? r.reaction?.key?.remoteJid ?? "";
          await this.inbound?.(this.coupleId, {
            kind: "reaction",
            messageId: r.key?.id ?? "", // id of the message being reacted to
            emoji,
            senderId: this.normalizeJid(reactor),
            removed: !emoji, // empty reaction text = removal
            fromMe: !!r.reaction?.key?.fromMe,
          });
        } catch (err) {
          logger.error({ err: String(err) }, "Error mapping inbound WhatsApp reaction (baileys)");
        }
      }
    });

    this.setStatus("connecting");
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      // end() closes the socket but KEEPS credentials on disk, so a later
      // connect() resumes without a new QR. (logout() would unlink the phone.)
      this.sock?.end?.(undefined);
    } catch (err) {
      logger.warn({ err: String(err) }, "Error closing WhatsApp socket (baileys)");
    }
    this.sock = null;
    this.setStatus("disconnected");
  }

  async sendMessage(target: SendTarget, body: string): Promise<SentMessage> {
    if (!this.sock || this._status !== "connected") {
      return { id: null, ok: false, error: "not connected" };
    }
    try {
      const sent = await this.sock.sendMessage(toJid(target.chatId), { text: body });
      return { id: sent?.key?.id ?? null, ok: true };
    } catch (err) {
      // Network/timeout: outcome unknown → reconcile rather than blind retry.
      return { id: null, ok: false, uncertain: true, error: String(err) };
    }
  }
}
