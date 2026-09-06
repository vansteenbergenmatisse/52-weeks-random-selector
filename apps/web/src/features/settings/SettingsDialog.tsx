import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, Toggle } from "../../components/ui/Dialog";
import { api, ApiError } from "../../platform/api/client";
import { useCalendar, useWhatsApp } from "../roulette/hooks";
import { COUNTRIES, splitDial } from "./countries";
import type { Collection } from "../../shared/types";

interface Recipient {
  dial: string;
  national: string;
}

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

const E164 = /^\+[1-9]\d{7,14}$/;

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
  const [recips, setRecips] = useState<Recipient[]>([]);
  const [waNote, setWaNote] = useState<string | null>(null);
  const [emailA, setEmailA] = useState("");
  const [emailB, setEmailB] = useState("");
  const [calEnabled, setCalEnabled] = useState(false);
  const [calNote, setCalNote] = useState<string | null>(null);

  useEffect(() => {
    if (!wa) return;
    setRecips(wa.recipients.length ? wa.recipients.map(splitDial) : [{ dial: "+32", national: "" }]);
  }, [wa?.recipients.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
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

  function setRecip(i: number, patch: Partial<Recipient>) {
    setRecips((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function saveRecipients() {
    setWaNote(null);
    const list = recips
      .filter((r) => r.national.trim())
      .map((r) => `${r.dial}${r.national.replace(/\D/g, "")}`);
    const bad = list.find((r) => !E164.test(r));
    if (bad) {
      setWaNote(`"${bad}" doesn't look right — check the number after the country code.`);
      return;
    }
    try {
      await api.patch("/api/whatsapp/config", { deliveryMode: "individuals", recipients: list });
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
      setWaNote("Saved.");
    } catch (err) {
      setWaNote(err instanceof ApiError ? err.message : "Could not save numbers.");
    }
  }

  async function sendTest() {
    setWaNote(null);
    try {
      await api.post("/api/whatsapp/test");
      setWaNote(wa?.status === "connected" ? "Test message sent — check WhatsApp." : "Queued. Connect a phone to actually deliver it.");
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

  const waStatus = wa?.status ?? "disconnected";

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
          <Toggle checked={c.notifyEnabled} onChange={(v) => patch("notifyEnabled", v)} label="Send this collection's weekly reminder on WhatsApp" />
        </div>

        {/* ── Reminders: shared WhatsApp connection + recipients ── */}
        <div className="border-t border-line pt-4 space-y-3">
          <h3 className="u-display text-sm text-ink">WhatsApp reminders (shared)</h3>
          <div className="rounded-lg bg-panel-2 border border-line p-3 flex items-center justify-between">
            <div>
              <p className="u-label">Connection</p>
              <p className="text-sm text-ink capitalize">{waStatus}{wa?.phone ? ` · ${wa.phone}` : ""}</p>
            </div>
            {waStatus === "connected" ? (
              <button className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm hover:border-card-red" onClick={() => whatsappAction("/api/whatsapp/disconnect")} disabled={busy}>
                Disconnect
              </button>
            ) : (
              <button className="rounded-md bg-panel-3 border border-line px-3 py-2 text-sm hover:border-accent" onClick={() => whatsappAction("/api/whatsapp/connect")} disabled={busy}>
                Connect
              </button>
            )}
          </div>
          {waStatus === "qr" && wa?.qr && (
            <div className="grid place-items-center rounded-lg bg-panel-2 border border-line p-3">
              <img src={wa.qr} alt="WhatsApp QR code" className="h-40 w-40 rounded bg-white p-2" />
              <p className="text-faint text-xs mt-2 text-center">WhatsApp → Linked devices → Link a device, then scan.</p>
            </div>
          )}
          <div>
            <label className="u-label block mb-1">Recipient numbers</label>
            <div className="space-y-2">
              {recips.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    className="field !w-44 shrink-0"
                    value={r.dial}
                    onChange={(e) => setRecip(i, { dial: e.target.value })}
                    aria-label="Country code"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.name} value={c.dial}>
                        {c.flag} {c.name} {c.dial}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field flex-1"
                    inputMode="tel"
                    value={r.national}
                    onChange={(e) => setRecip(i, { national: e.target.value })}
                    placeholder="612 34 56 78"
                    aria-label="Phone number"
                  />
                  {recips.length > 1 && (
                    <button
                      className="rounded-md bg-panel-3 border border-line px-2 text-sm text-muted hover:border-card-red"
                      onClick={() => setRecips(recips.filter((_, idx) => idx !== i))}
                      aria-label="Remove number"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              {recips.length < 4 && (
                <button
                  className="text-sm text-muted hover:text-ink transition"
                  onClick={() => setRecips([...recips, { dial: recips[recips.length - 1]?.dial ?? "+32", national: "" }])}
                >
                  + Add another
                </button>
              )}
              <button className="ml-auto rounded-md bg-panel-3 border border-line px-3 py-1.5 text-sm hover:border-accent" onClick={saveRecipients} disabled={busy}>
                Save numbers
              </button>
            </div>
            <p className="text-faint text-xs mt-1">Pick the country (the +prefix) and enter the rest of the number.</p>
          </div>
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
          <Toggle checked={calEnabled} onChange={setCalEnabled} label="Offer to add each weekly pick to your calendars" />
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
