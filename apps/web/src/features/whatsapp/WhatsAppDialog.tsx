import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "../../components/ui/Dialog";
import { api } from "../../platform/api/client";
import { useWhatsApp } from "../roulette/hooks";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "text-card-blue" },
  connecting: { label: "Connecting…", cls: "text-accent" },
  qr: { label: "Scan the QR code", cls: "text-accent" },
  disconnected: { label: "Disconnected", cls: "text-muted" },
};

export function WhatsAppDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useWhatsApp(open);
  const [recipients, setRecipients] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const status = data?.status ?? "disconnected";
  const s = STATUS_LABEL[status] ?? STATUS_LABEL.disconnected!;

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setNote(null);
    try {
      await api.post(path, body);
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    } finally {
      setBusy(false);
    }
  }

  async function saveRecipients() {
    const list = recipients.split(",").map((r) => r.trim()).filter(Boolean);
    await api.patch("/api/whatsapp/config", { deliveryMode: "individuals", recipients: list });
    qc.invalidateQueries({ queryKey: ["whatsapp"] });
    setNote("Recipients saved.");
  }

  return (
    <Dialog open={open} onClose={onClose} title="WhatsApp reminders" width="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-panel-2 border border-line p-3 flex items-center justify-between">
          <div>
            <p className="u-label">Status</p>
            <p className={`font-semibold ${s.cls}`}>{s.label}</p>
            {data?.phone && <p className="text-faint text-xs">Paired: {data.phone}</p>}
          </div>
          <div className="flex gap-2">
            {status === "connected" ? (
              <button className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm hover:border-card-red" onClick={() => act("/api/whatsapp/disconnect")} disabled={busy}>
                Disconnect
              </button>
            ) : (
              <button className="btn-yellow !py-2 !text-base" onClick={() => act("/api/whatsapp/connect")} disabled={busy}>
                Connect
              </button>
            )}
          </div>
        </div>

        {status === "qr" && data?.qr && (
          <div className="grid place-items-center rounded-lg bg-panel-2 border border-line p-4">
            <img src={data.qr} alt="WhatsApp QR code" className="h-48 w-48 rounded bg-white p-2" />
            <p className="text-faint text-xs mt-2 text-center">Open WhatsApp → Linked devices → Link a device, then scan.</p>
          </div>
        )}

        <div className="rounded-lg bg-panel-2 border border-line p-3">
          <p className="u-label mb-1">Which account sends the messages?</p>
          <p className="text-muted text-sm">
            The paired phone is the sender — it can be one of you. Both partners then receive the weekly pick and can
            react 🔄 to reroll or ✅ to mark done, or reply <code className="text-accent">REROLL</code> / <code className="text-accent">DONE</code>.
          </p>
        </div>

        <div>
          <label className="u-label block mb-1">Recipient numbers (comma-separated, e.g. 15551234567)</label>
          <div className="flex gap-2">
            <input className="field" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={(data?.recipients ?? []).join(", ") || "15551234567, 15557654321"} />
            <button className="rounded-md bg-panel-3 border border-line px-3 text-sm hover:border-accent" onClick={saveRecipients} disabled={busy}>
              Save
            </button>
          </div>
          {data && data.recipients.length > 0 && <p className="text-faint text-xs mt-1">Current: {data.recipients.join(", ")}</p>}
        </div>

        <div className="flex items-center justify-between">
          <button className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm hover:border-accent" onClick={() => act("/api/whatsapp/test")} disabled={busy || status !== "connected"}>
            Send test message
          </button>
          {note && <span className="text-accent text-xs">{note}</span>}
        </div>

        <p className="text-faint text-xs border-t border-line pt-3">{data?.note}</p>
      </div>
    </Dialog>
  );
}
