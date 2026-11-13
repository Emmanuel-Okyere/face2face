"use client";

import { useEffect, useState } from "react";
import { SAMPLE_NAMES as NAMES } from "@/lib/sample-names";


const initials = (n: string) =>
  n
    .split(" ")
    .filter((w, _, all) => all.length < 3 || w !== "Nana") // "Nana Ama Agyeman" → AA, "Nana Yaw" → NY
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

/** Random morning time, 7:45–9:15 am. */
const randomTime = () => {
  const m = 7 * 60 + 45 + Math.floor(Math.random() * 91);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} am`;
};

type Card = { id: number; name: string; time: string; leaving: boolean };

/**
 * The landing page's "checked in" cards, in step with the 6s face-match loop: as the brackets turn
 * green a random person drops in at the front with a glow, the previous card steps back behind it,
 * and the one before that lifts away and blurs out.
 */
export default function LandingWelcome() {
  const [cards, setCards] = useState<Card[]>([]);
  useEffect(() => {
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => (timers.delete(t), fn()), ms);
      timers.add(t);
    };
    const arrive = () => {
      setCards((cur) => {
        const live = cur.filter((c) => !c.leaving);
        const pool = NAMES.filter((n) => !live.some((c) => c.name === n));
        const card = { id: ++id, name: pool[Math.floor(Math.random() * pool.length)], time: randomTime(), leaving: false };
        return [card, ...live.map((c, i) => (i >= 1 ? { ...c, leaving: true } : c))];
      });
      later(() => setCards((cur) => cur.filter((c) => !c.leaving)), 700);
    };
    // Arrive as the brackets lock green (~45% into their 6s loop), read from their running animation
    // each time so we never drift; if it can't be read (styles not ready, reduced motion), every 6s.
    const untilGreen = () => {
      const anim = document.querySelector(".land-brackets")?.getAnimations()[0];
      const t = Number(anim?.currentTime);
      if (!anim || !Number.isFinite(t)) return 6000;
      const wait = (2700 - (t % 6000) + 6000) % 6000;
      return wait < 300 ? wait + 6000 : wait;
    };
    const loop = () => (arrive(), later(loop, untilGreen()));
    later(loop, Math.min(untilGreen(), 3000));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="absolute -bottom-8 -left-4 h-[4.5rem] w-[18rem] sm:-left-10">
      {cards.map((c, i) => (
        <div
          key={c.id}
          className="absolute inset-0 transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(.4,0,.2,1)]"
          style={{
            zIndex: 10 - i,
            transform: c.leaving ? "translateY(-30px) scale(0.86)" : `translateY(${-i * 14}px) scale(${1 - i * 0.06})`,
            opacity: c.leaving ? 0 : 1 - i * 0.35,
            filter: c.leaving ? "blur(6px)" : "none",
          }}
        >
          <div className="feed-drop card-shadow flex h-full items-center gap-3 rounded-2xl border border-line/70 bg-surface p-3.5 pr-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-good-soft text-sm font-semibold text-good">{initials(c.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold leading-tight">{c.name}</div>
              <div className="mt-0.5 truncate text-xs text-muted">Checked in at {c.time}</div>
            </div>
            <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
              <circle cx="12" cy="12" r="11" fill="var(--good)" />
              <path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
