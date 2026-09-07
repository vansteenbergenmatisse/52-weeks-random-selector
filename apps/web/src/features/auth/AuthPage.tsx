import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../platform/api/client";
import { useAuth } from "./useAuth";
import { Wordmark } from "../../components/ui/Wordmark";

/** A password/passcode input with a show/hide eye toggle. */
function SecretInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = "",
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <input
        className="field pr-11"
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        autoCapitalize="none"
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide" : "Show"}
        title={show ? "Hide" : "Show"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-base"
      >
        {show ? "🙈" : "👁️"}
      </button>
    </div>
  );
}

/** One person in the shared space — tap to enter as them. */
function PersonCard({
  user,
  emoji,
  name,
  busy,
  onPick,
}: {
  user: string;
  emoji: string;
  name: string;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-user={user}
      onClick={onPick}
      disabled={busy}
      aria-label={`Enter as ${name}`}
      className="group flex flex-col items-center gap-3 rounded-xl bg-panel-3 border border-line py-6 transition hover:border-accent hover:-translate-y-0.5 active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span
        aria-hidden="true"
        className="grid place-items-center w-16 h-16 rounded-full bg-panel-2 border border-line text-3xl transition group-hover:border-accent"
      >
        {emoji}
      </span>
      <span className="u-display text-lg text-ink transition group-hover:text-accent">{name}</span>
    </button>
  );
}

export function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [coupleName, setCoupleName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh, demoMode, spaceLocked } = useAuth();
  const navigate = useNavigate();

  // When the shared-space picker is available it leads; the password form is
  // opt-in behind a link. Without demo mode, the form is the only way in.
  const showForm = !demoMode || showPasswordForm;

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

  async function pick(u: string) {
    setError(null);
    if (spaceLocked && !passcode.trim()) {
      setError("Enter the space passcode first.");
      return;
    }
    setBusy(true);
    try {
      // No client-side password: the passcode-gated space-login signs the seeded
      // member in server-side.
      await api.post("/api/auth/space-login", { username: u, passcode });
      refresh();
      navigate("/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't open the space");
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
          {demoMode && (
            <div className={showForm ? "mb-6" : ""}>
              <h1 className="u-display text-2xl text-ink mb-1">Who's here?</h1>
              <p className="text-muted text-sm mb-5">
                Tap in — everything you both add stays in the same space, in sync.
              </p>
              {spaceLocked && (
                <SecretInput
                  className="mb-3"
                  placeholder="Space passcode"
                  value={passcode}
                  onChange={setPasscode}
                  ariaLabel="Space passcode"
                  autoComplete="off"
                />
              )}
              <div className="grid grid-cols-2 gap-3">
                <PersonCard user="teresa" emoji="🌸" name="Teresa" busy={busy} onPick={() => pick("teresa")} />
                <PersonCard user="matisse" emoji="🎨" name="Matisse" busy={busy} onPick={() => pick("matisse")} />
              </div>
              {!showForm && (
                <button
                  className="mt-4 text-sm text-muted hover:text-ink transition"
                  onClick={() => setShowPasswordForm(true)}
                >
                  Use a password instead
                </button>
              )}
            </div>
          )}

          {showForm && (
            <div className={demoMode ? "pt-5 border-t border-line" : ""}>
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
                <SecretInput
                  placeholder="Password"
                  value={password}
                  onChange={setPassword}
                  ariaLabel="Password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
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
            </div>
          )}

          {error && <p className="text-card-red text-sm mt-4">{error}</p>}
        </div>
      </div>
    </div>
  );
}
