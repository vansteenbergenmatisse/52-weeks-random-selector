import { useEffect, useMemo, useRef, useState } from "react";
import { CarouselCard, type ReelItem } from "./CarouselCard";

export type SpinPhase = "idle" | "spinning" | "settled";

interface CarouselProps {
  /** Decorative pool used to fill the reel (colors/emoji/posters). */
  pool: ReelItem[];
  /** The winning item to land in the center frame (server-decided). */
  winner: ReelItem | null;
  /** Increment to trigger a spin animation toward `winner`. */
  spinToken: number;
  phase: SpinPhase;
  reduceMotion: boolean;
  soundOn: boolean;
  onSettled: () => void;
  compact?: boolean; // mobile
}

// Geometry (tuned against the reference during visual QA).
const DESKTOP = { step: 12.5, half: 66, spread: 470, drop: 232, tilt: 0.92, cardW: 78, cardH: 112 };
const MOBILE = { step: 20, half: 44, spread: 190, drop: 150, tilt: 0.95, cardW: 62, cardH: 90 };

const SPIN_MS = 7000;
// How far back the reel starts before the winner — a long, guaranteed sweep so
// every spin opens with the reel racing over the whole pool at least once.
const RUNWAY = 84;

// easeOutQuint — launches at full speed (a full sweep right away), then a long,
// smooth deceleration that eases gently into the frame. No slow ramp-up.
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

function playTick(volume = 0.04) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.03);
    osc.onended = () => ctx.close();
  } catch {
    /* audio not available */
  }
}

function randomFrom(pool: ReelItem[], n: number): ReelItem[] {
  if (pool.length === 0) return [];
  return Array.from({ length: n }, (_, i) => pool[Math.floor((i * 7 + 3) % pool.length)]!);
}

export function Carousel({
  pool,
  winner,
  spinToken,
  phase,
  reduceMotion,
  soundOn,
  onSettled,
  compact = false,
}: CarouselProps) {
  const g = compact ? MOBILE : DESKTOP;
  const [scroll, setScroll] = useState(0);
  const [reel, setReel] = useState<ReelItem[]>(() => randomFrom(pool.length ? pool : PLACEHOLDER, 24));
  const winnerIndexRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTickAngle = useRef(0);
  // The spin token we last animated. Lets us start a spin the moment the winner
  // becomes known even if it was still null when the token changed (the cause of
  // the reel occasionally never moving), without ever double-triggering.
  const lastSpunToken = useRef(0);

  // Build an idle reel when the pool changes and we aren't mid-spin.
  useEffect(() => {
    if (phase !== "spinning") {
      const base = pool.length ? pool : PLACEHOLDER;
      const idle = randomFrom(base, 24);
      // Show the winner in the frame only once settled; otherwise a mystery card
      // keeps the reveal a surprise.
      idle[12] = phase === "settled" && winner ? winner : MYSTERY;
      setReel(idle);
      setScroll(12); // center on the middle card
      winnerIndexRef.current = 12;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, phase === "spinning" ? "spin" : "static", winner?.id]);

  // Trigger a spin when spinToken changes — or as soon as the winner arrives if
  // it lagged behind the token bump.
  useEffect(() => {
    if (spinToken === 0 || !winner) return;
    if (spinToken === lastSpunToken.current) return; // already animated this spin
    lastSpunToken.current = spinToken;
    const base = pool.length ? pool.filter((p) => p.id !== winner.id) : PLACEHOLDER;
    // Long runway so the reel visibly races across the whole pool many times
    // before decelerating into the winner (CS:GO-style long spin).
    const lead = randomFrom(base.length ? base : PLACEHOLDER, 90);
    const tail = randomFrom(base.length ? base : PLACEHOLDER, 6);
    const newReel = [...lead, winner, ...tail];
    const winnerIndex = lead.length;
    winnerIndexRef.current = winnerIndex;
    setReel(newReel);

    if (reduceMotion) {
      setScroll(winnerIndex);
      onSettled();
      return;
    }

    // Always sweep the same long distance so every spin opens with a full
    // pass over the pool, then eases in — consistent from the first frame.
    const from = Math.max(0, winnerIndex - RUNWAY);
    const startTime = performance.now();
    lastTickAngle.current = 0;

    const animate = (now: number) => {
      const t = Math.min(1, (now - startTime) / SPIN_MS);
      const eased = easeOutQuint(t);
      const pos = from + (winnerIndex - from) * eased;
      setScroll(pos);

      // Tick sound as cards cross the center frame.
      if (soundOn) {
        const crossed = Math.floor(pos);
        if (crossed !== lastTickAngle.current) {
          lastTickAngle.current = crossed;
          playTick();
        }
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setScroll(winnerIndex);
        if (soundOn) playTick(0.08);
        onSettled();
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinToken, winner?.id]);

  const visible = useMemo(() => {
    const items: Array<{ item: ReelItem; theta: number; key: number }> = [];
    for (let i = 0; i < reel.length; i++) {
      const theta = (i - scroll) * g.step;
      if (Math.abs(theta) > g.half + g.step) continue;
      items.push({ item: reel[i]!, theta, key: i });
    }
    return items;
  }, [reel, scroll, g]);

  const centerHeld = phase === "settled" && winner;

  return (
    <div
      className="relative mx-auto select-none"
      style={{ height: compact ? 220 : 300, maxWidth: compact ? 360 : 980 }}
      aria-label="Activity carousel"
    >
      {/* Cards along the arch */}
      {visible.map(({ item, theta, key }) => {
        const rad = (theta * Math.PI) / 180;
        const x = Math.sin(rad) * g.spread;
        const y = (1 - Math.cos(rad)) * g.drop;
        const dist = Math.abs(theta) / g.half;
        const opacity = 1 - Math.min(0.55, dist * 0.55);
        const scale = 1 - Math.min(0.16, dist * 0.16);
        const isCenter = Math.abs(theta) < g.step / 2;
        return (
          <div
            key={key}
            className="absolute left-1/2 top-1"
            style={{
              transform: `translate(-50%, 0) translate(${x}px, ${y}px) rotate(${theta * g.tilt}deg) scale(${scale})`,
              zIndex: 100 - Math.round(Math.abs(theta)),
              opacity,
            }}
          >
            <CarouselCard item={item} width={g.cardW} height={g.cardH} dim={!isCenter} />
          </div>
        );
      })}

      {/* Fixed metallic selection bezel + yellow marker (top-center).
          The center is transparent so the winning card reads clearly. */}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[-6px] z-[200]"
        style={{ width: g.cardW + 12, height: g.cardH + 40 }}
      >
        {/* Metallic bezel ring — transparent center so the card reads through */}
        <div
          className="absolute inset-0 rounded-xl"
          style={{
            border: "5px solid #6b727c",
            borderRadius: 14,
            boxShadow:
              "inset 0 2px 3px rgba(255,255,255,0.45), inset 0 -3px 5px rgba(0,0,0,0.65), 0 0 0 2px rgba(0,0,0,0.55), 0 8px 22px rgba(0,0,0,0.5)",
            background: "transparent",
          }}
        />
        {/* Top + bottom bracket highlights on the steel */}
        <div className="absolute inset-x-3 top-[2px] h-[2px] rounded bg-white/40" />
        <div className="absolute inset-x-3 bottom-[2px] h-[2px] rounded bg-black/50" />
        {/* Yellow up-arrow marker inside the bottom of the frame */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[10px]">
          <div
            className={centerHeld ? "animate-pulse" : ""}
            style={{
              height: 0,
              width: 0,
              borderLeft: "9px solid transparent",
              borderRight: "9px solid transparent",
              borderBottom: "14px solid #ffcc00",
              filter: "drop-shadow(0 0 6px rgba(255,204,0,0.85))",
            }}
          />
        </div>
      </div>

      {/* Winner glow overlay when settled */}
      {centerHeld && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-1 z-[150] rounded-lg animate-glow"
          style={{ width: g.cardW + 8, height: g.cardH + 8 }}
        />
      )}
    </div>
  );
}

const MYSTERY: ReelItem = { id: "mystery", colorKey: "charcoal", emoji: "❔" };

const PLACEHOLDER: ReelItem[] = [
  { id: "p1", colorKey: "red", emoji: "🎲" },
  { id: "p2", colorKey: "blue", emoji: "🎬" },
  { id: "p3", colorKey: "purple", emoji: "🌅" },
  { id: "p4", colorKey: "charcoal", emoji: "🍿" },
  { id: "p5", colorKey: "red", emoji: "🎯" },
  { id: "p6", colorKey: "blue", emoji: "🎡" },
  { id: "p7", colorKey: "charcoal", emoji: "☕" },
  { id: "p8", colorKey: "purple", emoji: "🎪" },
];
