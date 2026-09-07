import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useLiveSync } from "../../platform/realtime/useLiveSync";
import { Wordmark } from "../../components/ui/Wordmark";
import { Carousel, type SpinPhase } from "./Carousel";
import type { ReelItem } from "./CarouselCard";
import { ResultPanel } from "./ResultPanel";
import { ProgressRow } from "../entries/ProgressRow";
import { SettingsDialog } from "../settings/SettingsDialog";
import { HistoryDialog } from "../history/HistoryDialog";
import { InviteDialog } from "../auth/InviteDialog";
import {
  posterUrl,
  useAddToCalendar,
  useCollections,
  useComplete,
  useEntries,
  useResult,
  useSkip,
  useSpin,
} from "./hooks";
import type { Collection } from "../../shared/types";

const CARD_COLORS: ReelItem["colorKey"][] = ["red", "blue", "purple", "charcoal"];

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 700);
  useEffect(() => {
    const on = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return mobile;
}

export function RoulettePage() {
  const { user, couple, members, logout } = useAuth();
  useLiveSync(true);
  const reduceMotion = useReduceMotion();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();

  const { data: colData } = useCollections();
  const collections = colData?.collections ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (collections.length === 0) return;
    const fromUrl = params.get("collection");
    if (fromUrl && collections.some((c) => c.id === fromUrl)) setActiveId(fromUrl);
    else if (!activeId) setActiveId(collections[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections]);

  const active = collections.find((c) => c.id === activeId) ?? null;

  return (
    <div className="app-backdrop min-h-screen py-3 px-2 sm:py-6 sm:px-4">
      <div className="mx-auto max-w-6xl rounded-2xl bg-panel border border-line shadow-panel overflow-hidden">
        {/* Header */}
        <header className="relative bg-header border-b border-line h-12 flex items-center justify-center">
          <Wordmark />
          <div className="absolute right-3 flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-muted">{couple?.name}</span>
            <UserMenu name={user?.displayName ?? ""} avatar={user?.avatarUrl ?? "🙂"} onLogout={logout} />
          </div>
        </header>

        {active ? (
          <CollectionView
            key={active.id}
            collection={active}
            collections={collections}
            activeId={active.id}
            onSelect={(id) => {
              setActiveId(id);
              setParams({ collection: id });
            }}
            reduceMotion={reduceMotion}
            isMobile={isMobile}
            membersCount={members.length}
          />
        ) : (
          <div className="p-10 text-center text-muted">Loading your collections…</div>
        )}
      </div>
      <p className="text-center text-white/50 text-xs mt-3">
        Our 52 · a date & movie for every week
      </p>
    </div>
  );
}

function UserMenu({ name, avatar, onLogout }: { name: string; avatar: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-md bg-panel-3 border border-line px-2 py-1 text-sm hover:border-muted transition">
        <span>{avatar}</span>
        <span className="hidden sm:inline text-ink">{name}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-36 rounded-md bg-panel-2 border border-line shadow-panel z-[300] py-1">
          <button className="w-full text-left px-3 py-2 text-sm text-muted hover:text-ink hover:bg-panel-3" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function CollectionView({
  collection,
  collections,
  activeId,
  onSelect,
  reduceMotion,
  isMobile,
  membersCount,
}: {
  collection: Collection;
  collections: Collection[];
  activeId: string;
  onSelect: (id: string) => void;
  reduceMotion: boolean;
  isMobile: boolean;
  membersCount: number;
}) {
  const { data: entriesData } = useEntries(collection.id);
  const { data: resultData } = useResult(collection.id);
  const entries = entriesData?.entries ?? [];
  const progress = entriesData?.progress;
  const state = resultData?.state;

  const navigate = useNavigate();
  const spin = useSpin(collection.id);
  const skip = useSkip(collection.id);
  const complete = useComplete(collection.id);
  const addCalendar = useAddToCalendar(collection.id);

  const [soundOn, setSoundOn] = useState(true);
  const [phase, setPhase] = useState<SpinPhase>("idle");
  const [spinToken, setSpinToken] = useState(0);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const [calendarGoogleUrl, setCalendarGoogleUrl] = useState<string | null>(null);

  // Dialog state
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const isMovie = collection.kind === "movies";

  const pool: ReelItem[] = useMemo(
    () =>
      entries
        .filter((e) => e.status === "available" || e.status === "selected")
        .map((e, i) => ({
          id: e.id,
          colorKey: CARD_COLORS[i % CARD_COLORS.length]!,
          emoji: e.emoji ?? (isMovie ? "🎬" : "🎲"),
          posterUrl: isMovie ? posterUrl(e.posterPath, "w185") : null,
          title: e.title,
        })),
    [entries, isMovie],
  );

  const winner: ReelItem | null = useMemo(() => {
    if (!state?.result) return null;
    return {
      id: state.result.entryId ?? state.result.weeklyResultId,
      colorKey: collection.colorKey,
      emoji: state.result.emoji ?? (isMovie ? "🎬" : "🎲"),
      posterUrl: isMovie ? posterUrl(state.result.posterPath, "w185") : null,
      title: state.result.title,
    };
  }, [state?.result, collection.colorKey, isMovie]);

  // Determine display phase from server state + local reveal tracking.
  const resultId = state?.result?.weeklyResultId;
  const alreadyRevealed = resultId ? revealedIds.has(resultId) : false;
  const needsReveal = !!state?.hasResult && !alreadyRevealed && phase !== "spinning";

  useEffect(() => {
    if (state?.hasResult && alreadyRevealed) setPhase("settled");
    else if (!state?.hasResult) setPhase("idle");
  }, [state?.hasResult, alreadyRevealed]);

  // A result that already exists when we arrive — the Sunday auto-spin, or the
  // partner spun first — is shown straight away, settled. No mystery "reveal"
  // click: you see this week's pick the moment you open the space. Only a spin
  // you start yourself (which sets phase to "spinning" first) still animates.
  useEffect(() => {
    // Auto-reveal an unrevealed result whenever we're not mid-spin — covers both
    // the initial load AND a NEW pick arriving (e.g. a fresh week) while an older
    // one is still shown settled. Guarding on phase === "idle" left the stale pick
    // on screen with contradictory "locked in" copy; `phase !== "spinning"` lets
    // the new result take over without interrupting an in-progress animation.
    if (state?.hasResult && resultId && phase !== "spinning" && !alreadyRevealed) {
      setRevealedIds((s) => new Set(s).add(resultId));
      setPhase("settled");
    }
  }, [state?.hasResult, resultId, phase, alreadyRevealed]);

  async function onSpin() {
    if (!state) return;
    if (state.hasResult) {
      // Reveal the saved result (never draws again).
      setPhase("spinning");
      setSpinToken((t) => t + 1);
      return;
    }
    // Manual spin: server picks & persists, then we animate to it.
    const res = await spin.mutateAsync();
    if (res.created || res.state.result) {
      setPhase("spinning");
      setSpinToken((t) => t + 1);
    }
  }

  function onSettled() {
    if (resultId) setRevealedIds((s) => new Set(s).add(resultId));
    setPhase("settled");
  }

  async function onSkip() {
    setCalendarNote(null);
    const res = await skip.mutateAsync();
    if (res.skipped) {
      // Animate the reel to the freshly-drawn pick.
      setPhase("spinning");
      setSpinToken((t) => t + 1);
    } else if (res.reason === "no_alternative") {
      setCalendarNote("Nothing else in the pool to skip to — add more ideas first.");
    }
  }

  async function onAddToCalendar() {
    setCalendarNote(null);
    setCalendarGoogleUrl(null);
    const res = await addCalendar.mutateAsync();
    if (res.ok && res.ics) {
      // Download the .ics for Apple/Outlook, and surface a Google Calendar link.
      // Keyless — nothing is emailed and no server key is required.
      const blob = new Blob([res.ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename ?? "our52.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCalendarGoogleUrl(res.googleUrl ?? null);
      setCalendarNote("📅 Calendar file downloaded. Or add it to Google Calendar →");
    } else if (res.reason === "no_result") {
      setCalendarNote("Spin first, then add it to your calendar.");
    } else if (res.reason === "not_found") {
      setCalendarNote("Couldn't find this collection.");
    } else {
      setCalendarNote("Couldn't build the calendar invite — try again.");
    }
  }

  const canSpin = state && (state.hasResult || state.availableCount > 0);
  const buttonLabel = state?.hasResult ? "Reveal this week" : "Spin this week";
  const showBigButton = phase !== "settled" || needsReveal;

  return (
    <>
      {/* Tabs + toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2.5 border-b border-line bg-panel-2/50 flex-wrap">
        <div className="flex gap-1.5 overflow-x-auto">
          {collections.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`u-display text-sm px-3 py-1.5 rounded-md whitespace-nowrap transition ${
                c.id === activeId ? "bg-accent text-header" : "text-muted hover:text-ink bg-panel-3/60"
              }`}
            >
              <span className="mr-1">{c.emoji}</span>
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <IconBtn label="Sound" onClick={() => setSoundOn((s) => !s)}>{soundOn ? "🔊" : "🔇"}</IconBtn>
          <IconBtn label="Ideas & import" onClick={() => navigate(`/app/pool?collection=${activeId}`)}>📋</IconBtn>
          <IconBtn label="Invite partner" onClick={() => setShowInvite(true)}>{membersCount < 2 ? "➕" : "👥"}</IconBtn>
          <IconBtn label="History" onClick={() => setShowHistory(true)}>🕘</IconBtn>
          <IconBtn label="Settings & reminders" onClick={() => setShowSettings(true)}>⚙️</IconBtn>
        </div>
      </div>

      {/* Stage */}
      <div className="relative px-3 sm:px-6 pt-5 pb-6">
        {/* Legend (decorative) + stats — only on wide screens so they never
            collide with the arch at mid widths. */}
        <div className="hidden lg:block absolute left-6 top-5 space-y-1.5">
          <Legend />
        </div>
        <div className="hidden lg:flex flex-col items-end absolute right-6 top-5 space-y-1.5">
          <StatChip label="Week" value={`${state?.weekIndex ?? "–"} / 52`} />
          <StatChip label="Cycle" value={`${state?.cycleIndex ?? 1}`} />
          <StatChip label="In pool" value={`${state?.availableCount ?? 0}`} />
        </div>

        <Carousel
          pool={pool}
          winner={winner}
          spinToken={spinToken}
          phase={phase}
          reduceMotion={reduceMotion}
          soundOn={soundOn}
          onSettled={onSettled}
          compact={isMobile}
        />

        {/* Spin button + status */}
        <div className="mt-2 flex flex-col items-center gap-2">
          {showBigButton ? (
            <button className="btn-yellow" onClick={onSpin} disabled={!canSpin || spin.isPending || phase === "spinning"}>
              {phase === "spinning" ? "…" : buttonLabel}
            </button>
          ) : null}
          <p className="u-label">
            {phase === "spinning"
              ? "Choosing…"
              : state?.hasResult
                ? `Week ${state.weekIndex} pick is locked in`
                : state?.availableCount === 0
                  ? "Add ideas below to start spinning"
                  : `${state?.availableCount} ideas ready · one gets picked`}
          </p>
        </div>

        {/* Result panel */}
        {phase === "settled" && state?.result && (
          <div className="mt-5 max-w-2xl mx-auto">
            <ResultPanel
              state={state}
              collection={collection}
              onComplete={() => complete.mutate()}
              onSkip={onSkip}
              skipping={skip.isPending}
              onAddToCalendar={onAddToCalendar}
              addingToCalendar={addCalendar.isPending}
              calendarNote={calendarNote}
              calendarGoogleUrl={calendarGoogleUrl}
            />
          </div>
        )}
      </div>

      {/* Ideas summary → full management lives on the pool page */}
      <div className="bg-panel-2/40 border-t border-line px-3 sm:px-6 py-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="u-display text-base text-ink">
            Ideas in the pool <span className="text-muted">· {collection.totalCount}</span>
          </h2>
          <button
            className="btn-yellow !py-1.5 !px-4 !text-sm"
            onClick={() => navigate(`/app/pool?collection=${activeId}`)}
          >
            Manage ideas & import →
          </button>
        </div>
        {progress && <ProgressRow progress={progress} />}
      </div>

      {/* Dialogs */}
      {showSettings && <SettingsDialog open onClose={() => setShowSettings(false)} collection={collection} />}
      {showHistory && <HistoryDialog open onClose={() => setShowHistory(false)} collection={collection} />}
      {showInvite && <InviteDialog open onClose={() => setShowInvite(false)} />}
    </>
  );
}

function IconBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-9 w-9 grid place-items-center rounded-md text-base text-muted hover:text-ink hover:bg-panel-3 transition"
    >
      {children}
    </button>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-md bg-panel-2 border border-line px-2.5 py-1">
      <span className="u-label !text-[9px]">{label}</span>
      <span className="u-display text-accent text-sm">{value}</span>
    </div>
  );
}

function Legend() {
  const items: Array<[ReelItem["colorKey"], string]> = [
    ["red", "Dates"],
    ["blue", "Movies"],
    ["purple", "Custom"],
    ["charcoal", "Other"],
  ];
  const bg: Record<string, string> = {
    red: "bg-card-red",
    blue: "bg-card-blue",
    purple: "bg-card-purple",
    charcoal: "bg-steel",
  };
  return (
    <div className="space-y-1">
      {items.map(([k, label]) => (
        <div key={k} className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-sm ${bg[k]}`} />
          <span className="u-label !text-[9px]">{label}</span>
        </div>
      ))}
    </div>
  );
}
