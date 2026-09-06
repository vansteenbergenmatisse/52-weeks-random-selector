import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../platform/api/client";
import { useAuth } from "./useAuth";
import { Wordmark } from "../../components/ui/Wordmark";

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [coupleName, setCoupleName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh, demoMode } = useAuth();
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await api.post("/api/auth/login", { username, password });
      } else {
        await api.post("/api/auth/register", { username, password, displayName, coupleName });
      }
      refresh();
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function demoLogin(u: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/auth/login", { username: u, password: "12345" });
      refresh();
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Demo login failed");
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
          <h1 className="u-display text-2xl text-ink mb-1">
            {mode === "login" ? "Welcome back" : "Start your 52"}
          </h1>
          <p className="text-muted text-sm mb-5">
            {mode === "login"
              ? "Sign in to your shared space."
              : "Create your space — 52 weeks of dates & movies await."}
          </p>

          <form onSubmit={submit} className="space-y-3">
            <input
              className="field"
              placeholder="Username"
              value={username}
              autoCapitalize="none"
              onChange={(e) => setUsername(e.target.value)}
              aria-label="Username"
            />
            <input
              className="field"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
            />
            {mode === "register" && (
              <>
                <input
                  className="field"
                  placeholder="Your display name (e.g. Alex)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  aria-label="Display name"
                />
                <input
                  className="field"
                  placeholder="Name your space (e.g. Alex & Sam)"
                  value={coupleName}
                  onChange={(e) => setCoupleName(e.target.value)}
                  aria-label="Space name"
                />
              </>
            )}
            {error && <p className="text-card-red text-sm">{error}</p>}
            <button className="btn-yellow w-full" disabled={busy} type="submit">
              {busy ? "…" : mode === "login" ? "Sign in" : "Create space"}
            </button>
          </form>

          <button
            className="mt-4 text-sm text-muted hover:text-ink transition"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "New here? Create a space" : "Already have an account? Sign in"}
          </button>

          {demoMode && (
            <div className="mt-6 pt-5 border-t border-line">
              <p className="u-label mb-2">Who's spinning?</p>
              <div className="flex gap-2">
                <button className="flex-1 rounded-lg bg-panel-3 border border-line py-3 text-base hover:border-accent transition" onClick={() => demoLogin("teresa")} disabled={busy}>
                  🌸 Teresa
                </button>
                <button className="flex-1 rounded-lg bg-panel-3 border border-line py-3 text-base hover:border-accent transition" onClick={() => demoLogin("matisse")} disabled={busy}>
                  🎨 Matisse
                </button>
              </div>
              <p className="text-faint text-xs mt-2">One tap, no password. You both share the same space.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
