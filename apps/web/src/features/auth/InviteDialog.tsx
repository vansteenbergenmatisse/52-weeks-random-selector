import { useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { api, ApiError } from "../../platform/api/client";
import { useAuth } from "./useAuth";

export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { members } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const full = members.length >= 2;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ url: string }>("/api/invitations");
      setUrl(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create invite");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Invite your partner" width="max-w-md">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {members.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-panel-2 border border-line px-3 py-1 text-sm">
              {m.avatarUrl ?? "🙂"} {m.displayName}
            </span>
          ))}
          {!full && <span className="text-faint text-sm">+ 1 spot open</span>}
        </div>

        {full ? (
          <p className="text-muted text-sm">Your space is complete — both of you are here. 🎉</p>
        ) : (
          <>
            <p className="text-muted text-sm">
              Generate a secure, single-use link that expires in 72 hours. Share it with your partner so they can join
              this space.
            </p>
            {!url ? (
              <button className="btn-yellow w-full" onClick={generate} disabled={busy}>
                {busy ? "…" : "Create invite link"}
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input className="field text-xs" readOnly value={url} onFocus={(e) => e.target.select()} />
                  <button className="rounded-md bg-panel-3 border border-line px-3 text-sm hover:border-accent" onClick={copy}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-faint text-xs">Single-use · expires in 72 hours.</p>
              </div>
            )}
            {error && <p className="text-card-red text-sm">{error}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}
