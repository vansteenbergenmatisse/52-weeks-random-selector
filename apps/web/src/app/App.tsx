import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../features/auth/useAuth";
import { AuthPage } from "../features/auth/AuthPage";
import { InvitePage } from "../features/auth/InvitePage";
import { RoulettePage } from "../features/roulette/RoulettePage";
import { PoolPage } from "../features/entries/PoolPage";

export function App() {
  const { user, loading } = useAuth();

  // Warm per-person accent: tag <html> with the logged-in username so the
  // theme's CSS variables shift (see styles/index.css).
  useEffect(() => {
    const el = document.documentElement;
    if (user?.username) el.setAttribute("data-user", user.username);
    else el.removeAttribute("data-user");
  }, [user?.username]);

  if (loading) {
    return (
      <div className="app-backdrop min-h-screen grid place-items-center">
        <div className="u-display text-ink/70 text-xl animate-pulse">Our 52</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/login" element={user ? <Navigate to="/app" replace /> : <AuthPage />} />
      <Route path="/app" element={user ? <RoulettePage /> : <Navigate to="/login" replace />} />
      <Route path="/app/pool" element={user ? <PoolPage /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={user ? "/app" : "/login"} replace />} />
    </Routes>
  );
}
