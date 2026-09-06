import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../platform/api/client";
import { useAuth } from "./useAuth";
import { Wordmark } from "../../components/ui/Wordmark";

export function InvitePage() {
  const { token = "" } = useParams();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ valid: boolean; coupleName?: string; reason?: string } | null>(null);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/api/invitations/${token}`).then((d) => setInfo(d as typeof info));
  }, [token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/invitations/${token}/accept`);
      refresh();
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept invitation");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await api.post("/api/auth/login", { username, password });
      else await api.post("/api/auth/register-solo", { username, password, displayName });
      await api.post(`/api/invitations/${token}/accept`);
      refresh();
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-backdrop min-h-screen grid place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-panel border border-line shadow-panel overflow-hidden">
        <div className="bg-header border-b border-line py-4 grid place-items-center">
          <Wordmark />
        </div>
        <div className="p-6">
          {!info && <p className="text-muted">Checking invitation…</p>}
          {info && !info.valid && (
            <>
              <h1 className="u-display text-xl text-card-red mb-2">Invitation unavailable</h1>
              <p className="text-muted text-sm">{info.reason}</p>
              <button className="btn-yellow mt-5 w-full" onClick={() => navigate("/login")}>
                Go to sign in
              </button>
            </>
          )}
          {info?.valid && (
            <>
              <h1 className="u-display text-2xl text-ink mb-1">You're invited 💌</h1>
              <p className="text-muted text-sm mb-5">
                Join <span className="text-accent font-semibold">{info.coupleName}</span> on Our 52.
              </p>
              {user ? (
                <>
                  <p className="text-sm text-muted mb-3">Signed in as {user.displayName}.</p>
                  {error && <p className="text-card-red text-sm mb-2">{error}</p>}
                  <button className="btn-yellow w-full" onClick={accept} disabled={busy}>
                    {busy ? "…" : "Accept invitation"}
                  </button>
                </>
              ) : (
                <form onSubmit={submit} className="space-y-3">
                  <input className="field" placeholder="Username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
                  <input className="field" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  {mode === "register" && (
                    <input className="field" placeholder="Your display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  )}
                  {error && <p className="text-card-red text-sm">{error}</p>}
                  <button className="btn-yellow w-full" disabled={busy} type="submit">
                    {busy ? "…" : mode === "register" ? "Create account & join" : "Sign in & join"}
                  </button>
                  <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setMode(mode === "register" ? "login" : "register")}>
                    {mode === "register" ? "I already have an account" : "I need to create an account"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
