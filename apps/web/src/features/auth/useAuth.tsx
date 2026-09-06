import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../platform/api/client";
import type { User } from "../../shared/types";

interface MeResponse {
  user: User | null;
  couple: { coupleId: string; name: string } | null;
  members?: User[];
  demoMode?: boolean;
}

interface AuthValue {
  user: User | null;
  couple: { coupleId: string; name: string } | null;
  members: User[];
  demoMode: boolean;
  loading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/api/auth/me"),
    staleTime: 10_000,
  });

  const value: AuthValue = {
    user: data?.user ?? null,
    couple: data?.couple ?? null,
    members: data?.members ?? [],
    demoMode: data?.demoMode ?? false,
    loading: isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
    logout: async () => {
      await api.post("/api/auth/logout");
      await qc.invalidateQueries();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
