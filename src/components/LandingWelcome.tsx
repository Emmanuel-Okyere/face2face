"use client";

import { useEffect, useRef, useState } from "react";

const NAMES = [
  "Kweku Ohemeng",
  "Kojo Appiah",
  "Esi Quaye",
  "Kobina Baah",
  "Akosua Boateng",
  "Kwabena Asante",
  "Efua Owusu",
  "Yaw Darko",
  "Abena Ofori",
  "Nana Yaw",
  "Adjoa Frimpong",
  "Nana Ama Agyeman",
  "Kofi Ansah",
  "Agya Yaw",
  "Kwame Banfor",
];

const initials = (n: string) =>
  n
    .split(" ")
    .filter((w) => w !== "Nana")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

/** Random morning time, 7:45–9:15 am. */
const randomTime = () => {
  const m = 7 * 60 + 45 + Math.floor(Math.random() * 91);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} am`;
};

/** The landing page's "checked in" card: a random person each time it rises. */
export default function LandingWelcome() {
  // First render is fixed so server and client match; random from the next loop on.
  const [who, setWho] = useState({ name: NAMES[0], time: "8:42 am" });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const next = () =>
      setWho((cur) => {
        let name = cur.name;
        while (name === cur.name) name = NAMES[Math.floor(Math.random() * NAMES.length)];
        return { name, time: randomTime() };
      });
    // Swap while the card is hidden: at the start of each 6s loop of the CSS animation.
    const anim = ref.current?.getAnimations()[0];
    if (!anim) return; // reduced motion: keep one card
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      next();
      interval = setInterval(next, 6000);
    }, 6000 - (Number(anim.currentTime ?? 0) % 6000));
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="land-welcome card-shadow absolute -bottom-8 -left-4 flex w-[18rem] items-center gap-3 rounded-2xl border border-line/70 bg-surface p-3.5 pr-4 sm:-left-10"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-good-soft text-sm font-semibold text-good">{initials(who.name)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold leading-tight">{who.name}</div>
        <div className="mt-0.5 truncate text-xs text-muted">Checked in at {who.time}</div>
      </div>
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="var(--good)" />
        <path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
