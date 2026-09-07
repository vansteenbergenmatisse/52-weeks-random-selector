import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, Toggle } from "../../components/ui/Dialog";
import { api, ApiError } from "../../platform/api/client";
import { useCalendar, useWhatsApp } from "../roulette/hooks";
import type { Collection } from "../../shared/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Amsterdam",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function SettingsDialog({
  open,
  onClose,
  collection,
}: {
  open: boolean;
  onClose: () => void;
  collection: Collection;
}) {
  const qc = useQueryClient();
  const [c, setC] = useState(collection);
  const [busy, setBusy] = useState(false);

  // Shared WhatsApp + calendar config (couple-wide) loaded when the dialog opens.
  const { data: wa } = useWhatsApp(open);
  const { data: cal } = useCalendar(open);
  const [waNote, setWaNote] = useState<string | null>(null);
  const [emailA, setEmailA] = useState("");
  const [emailB, setEmailB] = useState("");
  const [calEnabled, setCalEnabled] = useState(false);
  const [calNote, setCalNote] = useState<string | null>(null);

  useEffect(() => {
    if (cal) {
      setEmailA(cal.emails[0] ?? "");
      setEmailB(cal.emails[1] ?? "");
      setCalEnabled(cal.enabled);
    }
  }, [cal?.emails.join(","), cal?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch<K extends keyof Collection>(key: K, value: Collection[K]) {
    setC((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/api/collections/${collection.id}`, {
        name: c.name,
        targetPerPerson: c.targetPerPerson,
        autoSelect: c.autoSelect,
        scheduleWeekday: c.scheduleWeekday,
        scheduleTime: c.scheduleTime,
        scheduleTimezone: c.scheduleTimezone,
        notifyEnabled: c.notifyEnabled,
      });
      qc.invalidateQueries({ queryKey: ["collections"] });
      qc.invalidateQueries({ queryKey: ["result", collection.id] });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function newCycle() {
    if (!confirm("Start a fresh 52-week cycle? History and ideas are kept.")) return;
    setBusy(true);
    try {
      await api.post(`/api/collections/${collection.id}/new-cycle`);
      qc.invalidateQueries();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function whatsappAction(path: string) {
    setBusy(true);
    setWaNote(null);
    try {
      await api.post(path);
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    } finally {
      setBusy(false);
    }
  }

  /** Link the logged-in user's OWN WhatsApp — just starts their connection so the
   *  QR appears. No number to type: the linked device's own number is used. */
  async function linkMyWhatsApp() {
    setWaNote(null);
    if (!wa?.enabled) {
      setWaNote("WhatsApp isn't enabled on the server yet.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/whatsapp/connect");
      setWaNote("Scan the QR below to finish linking your WhatsApp.");
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    } catch (err) {
      setWaNote(err instanceof ApiError ? err.message : "Couldn't start linking.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setWaNote(null);
    try {
      const res = await api.post<{ ok: boolean; reason?: string; target?: string }>("/api/whatsapp/test");
      if (res.ok) setWaNote(`Test message sent to ${res.target} — check WhatsApp.`);
      else if (res.reason === "not_linked") setWaNote("Link your WhatsApp first, then send a test.");
      else if (res.reason === "no_number") setWaNote("No number yet — finish linking, then try again.");
      else setWaNote("Couldn't send the test.");
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    } catch (err) {
      setWaNote(err instanceof ApiError ? err.message : "Could not send test.");
    }
  }

  async function saveCalendar() {
    setCalNote(null);
    const emails = [emailA.trim(), emailB.trim()].filter(Boolean);
    try {
      await api.patch("/api/calendar/config", { enabled: calEnabled, emails });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      setCalNote("Saved.");
    } catch (err) {
      setCalNote(err instanceof ApiError ? err.message : "Check both look like real email addresses.");
    }
  }

  const youStatus = wa?.you.status ?? "disconnected";

  return (
    <Dialog open={open} onClose={onClose} title={`${collection.name} settings`} width="max-w-lg">
      <div className="space-y-5">
        <div>
          <label className="u-label block mb-1">Collection name</label>
          <input className="field" value={c.name} onChange={(e) => patch("name", e.target.value)} />
        </div>

        <div>
          <label className="u-label block mb-1">Contribution target (per person)</label>
          <input
            className="field w-28"
            type="number"
            value={c.targetPerPerson}
            onChange={(e) => patch("targetPerPerson", Number(e.target.value))}
          />
          <p className="text-faint text-xs mt-1">Default 26 each = 52 total. A target, not a requirement to spin.</p>
        </div>

        <div className="border-t border-line pt-4">
          <h3 className="u-display text-sm text-ink mb-3">Weekly schedule (this collection)</h3>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="u-label block mb-1">Day</label>
              <select className="field" value={c.scheduleWeekday} onChange={(e) => patch("scheduleWeekday", Number(e.target.value))}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="u-label block mb-1">Time</label>
              <input className="field" type="time" value={c.scheduleTime} onChange={(e) => patch("scheduleTime", e.target.value)} />
            </div>
            <div>
              <label className="u-label block mb-1">Timezone</label>
              <select className="field" value={c.scheduleTimezone} onChange={(e) => patch("scheduleTimezone", e.target.value)}>
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z.split("/")[1]?.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-faint text-xs mt-2">Each collection has its own day — e.g. Dates on Sunday, Movies on Saturday. DST-aware.</p>
        </div>

        <div className="border-t border-line pt-4 space-y-3">
          <Toggle checked={c.autoSelect} onChange={(v) => patch("autoSelect", v)} label="Automatic weekly selection (draws even when nobody's here)" />
          <Toggle
            checked={c.notifyEnabled}
            onChange={(v) => patch("notifyEnabled", v)}
            label="Send this collection's weekly reminder on WhatsApp"
            disabled={!wa?.activated}
          />
          {!wa?.activated && (
            <p className="text-faint text-xs">
              🔒 Both of you must link WhatsApp below to turn reminders on — you remind each other.
            </p>
          )}
        </div>

        {/* ── Your WhatsApp — personal, per-person link (not shared) ── */}
        <div className="border-t border-line pt-4 space-y-3">
          <h3 className="u-display text-sm text-ink">Your WhatsApp <span className="text-faint font-normal">· just you</span></h3>
          <p className="text-faint text-xs">
            Link your own phone. Reminders are mutual — once you and your partner are both linked,
            each of you gets the weekly pick from the other’s WhatsApp. Nothing else here changes for them.
          </p>

          {/* Live banner for the logged-in user's OWN connection. */}
          {!wa?.enabled ? (
            <div className="rounded-lg border border-line bg-panel-2 p-3">
              <p className="text-sm text-ink font-semibold">WhatsApp delivery is off on the server</p>
              <p className="text-xs text-muted mt-1">
                Set <code>WHATSAPP_ENABLED=true</code> on the server to link a phone. Spinning, the pool,
                and calendar all work without it.
              </p>
            </div>
          ) : youStatus === "connected" ? (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
              <p className="text-sm text-ink font-semibold">✅ Your WhatsApp is linked{wa?.you.phone ? ` as ${wa.you.phone}` : ""}</p>
              <p className="text-xs text-muted mt-1">The link self-heals if it briefly drops.</p>
            </div>
          ) : youStatus === "qr" ? (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
              <p className="text-sm text-ink font-semibold">Scan the QR to link your WhatsApp</p>
              <p className="text-xs text-muted mt-1">Open WhatsApp → Linked devices → Link a device, then scan below.</p>
            </div>
          ) : youStatus === "connecting" ? (
            <div className="rounded-lg border border-line bg-panel-2 p-3">
              <p className="text-sm text-ink font-semibold">Connecting…</p>
              <p className="text-xs text-muted mt-1">Hang on — a QR will appear in a moment.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-card-red/40 bg-card-red/10 p-3">
              <p className="text-sm text-ink font-semibold">Your WhatsApp isn’t linked yet</p>
              <p className="text-xs text-muted mt-1">Tap “Link my WhatsApp” and scan the QR — no number to type.</p>
            </div>
          )}

          {/* QR for the current user. */}
          {youStatus === "qr" && wa?.you.qr && (
            <div className="grid place-items-center rounded-lg bg-panel-2 border border-line p-3">
              <img src={wa.you.qr} alt="WhatsApp QR code" className="h-40 w-40 rounded bg-white p-2" />
              <p className="text-faint text-xs mt-2 text-center">WhatsApp → Linked devices → Link a device, then scan.</p>
            </div>
          )}

          {/* Link / connection controls for the current user. */}
          <div className="rounded-lg bg-panel-2 border border-line p-3 flex items-center justify-between gap-3">
            <div>
              <p className="u-label">Your connection</p>
              <p className="text-sm text-ink capitalize">{youStatus}{wa?.you.phone ? ` · ${wa.you.phone}` : ""}</p>
            </div>
            {youStatus === "connected" ? (
              <button className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm hover:border-card-red" onClick={() => whatsappAction("/api/whatsapp/disconnect")} disabled={busy}>
                Unlink
              </button>
            ) : (
              <button className="btn-yellow !py-1.5 !px-4 !text-sm" onClick={linkMyWhatsApp} disabled={busy}>
                Link my WhatsApp
              </button>
            )}
          </div>

          {/* Read-only partner status so it's clear when reminders are ready. */}
          {wa?.partner && (
            <div className="rounded-lg bg-panel-2 border border-line p-3">
              <p className="text-sm text-ink">
                {wa.partner.linked ? "✅" : "⬜"} {wa.partner.name}’s WhatsApp:{" "}
                <span className={wa.partner.linked ? "text-accent" : "text-muted"}>
                  {wa.partner.linked ? "linked" : "not linked yet"}
                </span>
              </p>
              <p className={`text-xs mt-1 ${wa.activated ? "text-accent" : "text-faint"}`}>
                {wa.activated ? "Reminders are ready — you two remind each other." : "Reminders start once you’re both linked."}
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm hover:border-accent" onClick={sendTest} disabled={busy}>
              Send test message
            </button>
            {waNote && <span className="text-accent text-xs">{waNote}</span>}
          </div>
        </div>

        {/* ── Calendar invites ── */}
        <div className="border-t border-line pt-4 space-y-3">
          <h3 className="u-display text-sm text-ink">Calendar invites (shared)</h3>
          <p className="text-faint text-xs">
            The “Add to calendar” button on each week’s pick downloads a calendar file and gives a
            one-tap Google Calendar link — no setup needed. The emails below are optional, only for
            auto-emailing invites (needs a Resend key on the server).
          </p>
          <Toggle checked={calEnabled} onChange={setCalEnabled} label="Also email the pick to both of you each week (optional)" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="u-label block mb-1">Your email</label>
              <input className="field" type="email" value={emailA} onChange={(e) => setEmailA(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="u-label block mb-1">Partner's email</label>
              <input className="field" type="email" value={emailB} onChange={(e) => setEmailB(e.target.value)} placeholder="them@example.com" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm hover:border-accent" onClick={saveCalendar} disabled={busy}>
              Save calendar
            </button>
            {calNote && <span className="text-accent text-xs">{calNote}</span>}
          </div>
          {cal && <p className="text-faint text-xs">{cal.note}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <button className="text-sm text-muted hover:text-card-red transition" onClick={newCycle} disabled={busy}>
            Start new 52-week cycle
          </button>
          <div className="flex gap-2">
            <button className="rounded-md px-4 py-2 text-sm text-muted hover:text-ink" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-yellow !py-2 !text-base" onClick={save} disabled={busy}>
              {busy ? "…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
