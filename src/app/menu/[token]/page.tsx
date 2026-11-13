"use client";

import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, Card, cx, Logo, OrgLogo, Spinner } from "@/components/ui";

type Row = { church: string | null; day: string; meal: string; dishes: string };
type Menu = {
  org: { name: string; logoUrl: string | null };
  event: { name: string; venue: string | null; unit_label: string; byChurch: boolean };
  today: string;
  days: string[];
  meals: { key: string; name: string; from: string; to: string }[];
  churches: string[];
  menu: Row[];
};

const dishes = (s: string | undefined) => (s ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
/** A church's own menu for that meal, else the menu shared by all. */
const pick = (menu: Row[], church: string | null, day: string, meal: string) =>
  (church ? menu.find((m) => m.church === church && m.day === day && m.meal === meal) : undefined) ?? menu.find((m) => m.church === null && m.day === day && m.meal === meal);

function MenuView() {
  const { token } = useParams<{ token: string }>();
  const [m, setM] = useState<Menu | null>(null);
  const [bad, setBad] = useState("");
  const [day, setDay] = useState("");
  const [church, setChurch] = useState("");
  useEffect(() => {
    api<Menu>(`/api/menu/${token}`)
      .then((r) => {
        setM(r);
        setDay(r.days.includes(r.today) ? r.today : (r.days[0] ?? ""));
        try {
          const saved = localStorage.getItem(`menu-church:${token}`);
          if (saved && r.churches.includes(saved)) setChurch(saved);
        } catch {}
      })
      .catch((e) => setBad(e.message));
  }, [token]);

  if (bad)
    return (
      <Shell>
        <Card className="p-8 text-center">
          <h1 className="text-lg font-semibold">Menu not found</h1>
          <p className="mt-1 text-sm text-muted">{bad}</p>
        </Card>
      </Shell>
    );
  if (!m)
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </Shell>
    );

  const chooseChurch = (c: string) => {
    setChurch(c);
    try {
      localStorage.setItem(`menu-church:${token}`, c);
    } catch {}
  };
  // By church without one picked: every church side by side for the day.
  const columns: (string | null)[] = m.event.byChurch ? (church ? [church] : m.churches) : [null];

  return (
    <Shell>
      <header className="mb-5 flex items-center gap-3">
        <OrgLogo src={m.org.logoUrl} name={m.org.name} size={40} />
        <div className="min-w-0">
          <div className="text-xs text-muted">{m.org.name}</div>
          <h1 className="truncate text-xl font-semibold leading-tight">{m.event.name} menu</h1>
        </div>
      </header>

      {m.event.byChurch && m.churches.length > 0 && (
        <select value={church} onChange={(e) => chooseChurch(e.target.value)} className="mb-3 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm">
          <option value="">Every {m.event.unit_label.toLowerCase()}</option>
          {m.churches.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )}

      {m.days.length > 1 && (
        <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {m.days.map((d) => (
            <button
              key={d}
              onClick={() => setDay(d)}
              className={cx("shrink-0 rounded-xl border px-3 py-1.5 text-sm", day === d ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted")}
            >
              {d === m.today ? "Today" : dayLabel(d)}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {columns.map((c) => (
          <Card key={c ?? "all"} className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">{c ?? (day === m.today ? "Today" : dayLabel(day, { weekday: "long", day: "numeric", month: "long" }))}</h2>
              {c && <span className="text-xs text-muted">{day === m.today ? "Today" : dayLabel(day)}</span>}
            </div>
            <ul className="divide-y divide-line/70">
              {m.meals.map((meal) => {
                const list = dishes(pick(m.menu, c, day, meal.key)?.dishes);
                return (
                  <li key={meal.key} className="grid grid-cols-[6rem_1fr] gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <span>
                      <span className="font-medium">{meal.name}</span>
                      <span className="block text-xs text-muted">
                        {meal.from}–{meal.to}
                      </span>
                    </span>
                    {list.length ? (
                      <ul className="space-y-0.5">
                        {list.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted">To be announced</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-bg min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-xl">{children}</div>
      <div className="mx-auto mt-10 flex max-w-xl justify-center opacity-60">
        <Logo />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <MenuView />
    </Suspense>
  );
}
