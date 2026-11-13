"use client";

import { useEffect, useState } from "react";
import { SAMPLE_NAMES } from "@/lib/sample-names";

const TONES = ["bg-[#cfeed6] text-[#2e7d4f]", "bg-[#fde3d6] text-[#b8441a]", "bg-[#e3e6fb] text-[#4450a8]", "bg-[#f6ecc9] text-[#8a6410]"];
const SLOTS = 3;
const ROW = 62; // px, row height
const STEP = ROW + 12; // row + gap
type Row = { id: number; name: string; min: number; tone: string; leaving: boolean };

const initials = (n: string) =>
  n
    .split(" ")
    .filter((w, _, all) => all.length < 3 || w !== "Nana") // "Nana Ama Agyeman" → AA, "Nana Yaw" → NY
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
const clock = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} am`;
const rand = (n: number) => Math.floor(Math.random() * n);

/**
 * The sign-in panel's live feed. Random people arrive at random moments: the newcomer drops in at the
 * top with a green tick, everyone glides down a slot, and the oldest slides out the bottom and fades away.
 */
export default function AuthFeed() {
  // Empty on the server; the first arrivals cascade in once the page is live, so every visit differs.
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let id = 0;
    let min = 8 * 60 + 20 + rand(20);
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => (timers.delete(t), fn()), ms);
      timers.add(t);
    };
    const arrive = () => {
      min += 1 + rand(3);
      const at = min;
      setRows((cur) => {
        const live = cur.filter((r) => !r.leaving);
        const pool = SAMPLE_NAMES.filter((n) => !live.some((r) => r.name === n));
        const row: Row = { id: ++id, name: pool[rand(pool.length)], min: at, tone: TONES[rand(TONES.length)], leaving: false };
        return [row, ...live.map((r, i) => (i >= SLOTS - 1 ? { ...r, leaving: true } : r))];
      });
      setCount((c) => (c === null || c >= 196 ? 90 + rand(50) : c + 1));
      later(() => setRows((cur) => cur.filter((r) => !r.leaving)), 600); // gone once it has slid out
    };
    // Opening cascade, then someone new every 2–4.5s.
    later(arrive, 200);
    later(arrive, 900);
    later(arrive, 1600);
    const loop = () => later(() => (arrive(), loop()), 2200 + rand(2300));
    later(loop, 1600);
    return () => timers.forEach(clearTimeout);
  }, []);

  const filled = Math.min(1, (count ?? 0) / 200) * 94.2;
  return (
    <div className="mt-10 space-y-3">
      <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
        <svg viewBox="0 0 36 36" className="size-12 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--good)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${filled} 94.2`} className="transition-[stroke-dasharray] duration-700" />
        </svg>
        <div>
          <div className="text-2xl font-semibold tabular-nums leading-none">{count ?? "—"}</div>
          <div className="mt-1 text-xs text-white/60">present today</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-sm font-medium text-good">+12%</div>
          <div className="text-xs text-white/50">vs last week</div>
        </div>
      </div>

      <div className="relative" style={{ height: SLOTS * STEP - 12 }}>
        {rows.map((r, i) => {
          const newest = i === 0;
          return (
            // Outer layer glides between slots; the inner one plays the drop-in.
            <div
              key={r.id}
              className="absolute inset-x-0 transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(.4,0,.2,1)]"
              style={{
                height: ROW,
                transform: `translateY(${i * STEP}px) scale(${r.leaving ? 0.92 : 1})`,
                opacity: r.leaving ? 0 : 1 - i * 0.18,
                filter: r.leaving ? "blur(6px)" : "none",
              }}
            >
              <div className="feed-drop flex h-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4">
                <span className={`flex size-9 items-center justify-center rounded-full text-xs font-semibold ${r.tone}`}>{initials(r.name)}</span>
                <span className="flex-1 truncate text-sm">{r.name}</span>
                <span className="relative flex h-5 w-16 items-center justify-end text-xs tabular-nums text-white/50">
                  {/* newest shows a tick that settles into the time */}
                  <span className={`absolute right-0 transition-all duration-500 ${newest ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}>
                    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                      <circle cx="12" cy="12" r="11" fill="var(--good)" />
                      <path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className={`transition-all duration-500 ${newest ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"}`}>{clock(r.min)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
