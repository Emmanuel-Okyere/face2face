"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, useOrg } from "@/components/AdminShell";
import { PhoneDisplay } from "@/components/PhoneInput";
import { api, Avatar, Button, Card, cx, Empty, hardNavigate, Input, Pill, Spinner } from "@/components/ui";

type P = {
  id: string;
  full_name: string;
  ref: string;
  code: string | null;
  group_name: string | null;
  phone: string | null;
  avatar: string | null;
  last_seen: string | null;
  days: number;
  expected: number;
  prev_days?: number;
};
type Report = {
  org: { name: string; timeZone: string };
  services: { id: string; name: string; active: boolean }[];
  service: string | null;
  period: { from: string; to: string; days: number; bucket: "day" | "week" | "month"; prevFrom: string; prevTo: string; today: string };
  totals: {
    checkins: number;
    uniquePeople: number;
    servicesHeld: number;
    avgPerService: number;
    peopleTotal: number;
    attendanceRate: number;
    activeMembers: number;
    activeDays: number;
    newcomers: number;
    peak: { day: string; n: number; service: string } | null;
    prev: { checkins: number; uniquePeople: number; servicesHeld: number };
  };
  engagement: { regular: number; occasional: number; rare: number; absent: number };
  series: { bucket: string; n: number; u?: number }[];
  methods: { method: string; n: number }[];
  groups: { group: string; people: number; attended: number }[];
  groupList: string[];
  group: string | null;
  lists: { absent: { total: number; people: P[] }; drifting: { total: number; people: P[] }; faithful: { total: number; people: P[] } };
};

type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom";
const iso = (d: Date) => d.toLocaleDateString("en-CA");

function presetRange(p: Exclude<Preset, "custom">): [string, string] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === "today") return [iso(now), iso(now)];
  if (p === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return [iso(d), iso(now)];
  }
  if (p === "month") return [iso(new Date(y, m, 1)), iso(now)];
  if (p === "quarter") return [iso(new Date(y, m - (m % 3), 1)), iso(now)];
  return [iso(new Date(y, 0, 1)), iso(now)];
}

const PRESETS: [Preset, string][] = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["quarter", "This quarter"],
  ["year", "This year"],
  ["custom", "Custom"],
];

function fmtDate(d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Date(`${d}T12:00:00`).toLocaleDateString([], opts);
}
function ago(d: string | null) {
  if (!d) return "never";
  const days = Math.round((Date.now() - Date.parse(`${d}T12:00:00`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function Reports() {
  const org = useOrg();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState<[string, string]>(() => presetRange("month"));
  const [active, setActive] = useState(30);
  const [service, setService] = useState("");
  const [group, setGroup] = useState("");
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api<Report>(`/api/admin/reports?from=${range[0]}&to=${range[1]}&active=${active}&service=${service}&group=${encodeURIComponent(group)}`)
        .then((d) => {
          setR(d);
          setErr("");
        })
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [range, active, service, group]);

  const choose = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  };

  const label = r
    ? r.period.from === r.period.to
      ? fmtDate(r.period.from, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : `${fmtDate(r.period.from, { day: "numeric", month: "short", year: "numeric" })} – ${fmtDate(r.period.to, { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={r ? `${org?.name ?? r.org.name} · ${label}` : " "}
        actions={
          <Button variant="ghost" className="no-print" onClick={() => window.print()}>
            Print
          </Button>
        }
      />

      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-full border border-line bg-surface p-1 text-sm">
          {PRESETS.map(([p, l]) => (
            <button
              key={p}
              onClick={() => choose(p)}
              className={cx("rounded-full px-3.5 py-1", preset === p ? "bg-ink text-white" : "text-muted hover:text-ink")}
            >
              {l}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm">
            <input
              type="date"
              value={range[0]}
              max={range[1]}
              onChange={(e) => e.target.value && setRange([e.target.value, range[1]])}
              className="bg-transparent outline-none"
              aria-label="From"
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              value={range[1]}
              min={range[0]}
              onChange={(e) => e.target.value && setRange([range[0], e.target.value])}
              className="bg-transparent outline-none"
              aria-label="To"
            />
          </div>
        )}
        {r && r.services.length > 1 && (
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm"
            aria-label="Service"
          >
            <option value="">All services</option>
            {r.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? "" : " (archived)"}
              </option>
            ))}
          </select>
        )}
        {r && r.groupList.length > 0 && (
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm"
            aria-label="Group"
          >
            <option value="">All groups</option>
            {r.groupList.map((g) => (
              <option key={g}>{g}</option>
            ))}
            <option value="—">No group</option>
          </select>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Active = seen in the last
          <select
            value={active}
            onChange={(e) => setActive(Number(e.target.value))}
            className="rounded-full border border-line bg-surface px-2 py-1 text-xs text-ink"
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        {loading && <Spinner className="size-4" />}
      </div>

      {err ? (
        <Empty title="Couldn't load the report">{err}</Empty>
      ) : !r ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : r.totals.peopleTotal === 0 ? (
        <Empty title="No people yet">
          <Link href="/admin/people/new" className="underline">
            Add people
          </Link>{" "}
          to start seeing reports.
        </Empty>
      ) : (
        <div className={cx("space-y-4 transition-opacity", loading && "opacity-60")}>
          <StatRow r={r} />
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <h2 className="font-medium">Attendance trend</h2>
              <p className="mb-4 text-xs text-muted">
                {r.totals.servicesHeld} service{r.totals.servicesHeld === 1 ? "" : "s"} held
                {r.totals.peak &&
                  ` · busiest: ${r.totals.peak.service}, ${fmtDate(r.totals.peak.day, { weekday: "short", day: "numeric", month: "short" })} (${r.totals.peak.n})`}
              </p>
              <Trend r={r} />
            </Card>
            <Card>
              <h2 className="font-medium">Engagement</h2>
              <div className="mb-4" />
              <Engagement r={r} />
            </Card>
          </div>
          {!r.group && (r.groups.length > 1 || (r.groups[0] && r.groups[0].group !== "—")) ? <Groups r={r} /> : null}
          <FollowUp r={r} orgName={org?.name ?? r.org.name} />
        </div>
      )}
    </>
  );
}

function Delta({ now, prev, label }: { now: number; prev: number; label: string }) {
  if (!prev && !now) return <span className="text-muted">—</span>;
  if (!prev) return <span className="text-good">new {label}</span>;
  const d = Math.round(((now - prev) / prev) * 100);
  return (
    <span className={d >= 0 ? "text-good" : "text-accent"}>
      {d >= 0 ? "↗ +" : "↘ "}
      {d}% <span className="text-muted">vs previous</span>
    </span>
  );
}

function StatRow({ r }: { r: Report }) {
  const t = r.totals;
  const cards: [string, React.ReactNode, React.ReactNode][] = [
    ["Check-ins", t.checkins, <Delta key="d" now={t.checkins} prev={t.prev.checkins} label="activity" />],
    ["People who came", t.uniquePeople, <Delta key="d" now={t.uniquePeople} prev={t.prev.uniquePeople} label="activity" />],
    ["Avg per service", t.avgPerService, `${t.servicesHeld} held`],
    ["Attendance rate", pct(t.attendanceRate), `of ${t.peopleTotal} expected came`],
    [
      "Active members",
      t.activeMembers,
      `${pct(t.peopleTotal ? t.activeMembers / t.peopleTotal : 0)} seen in the last ${t.activeDays} days`,
    ],
    ["Newcomers", t.newcomers, "first ever check-in in this period"],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map(([l, v, sub]) => (
        <Card key={l} className="p-4">
          <div className="text-xs text-ink/70">{l}</div>
          <div className="mt-1 text-3xl tabular-nums tracking-tight">{v}</div>
          <div className="mt-1 text-[11px] leading-snug text-muted">{sub}</div>
        </Card>
      ))}
    </div>
  );
}

function Trend({ r }: { r: Report }) {
  const data = r.series;
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="py-12 text-center text-sm text-muted">No check-ins in this period.</p>;
  const max = Math.max(1, ...data.map((d) => d.n));
  const peak = data.reduce((a, b, i) => (b.n > data[a].n ? i : a), 0);
  const focus = hover ?? peak;
  const fmt = (b: string) =>
    r.period.bucket === "month"
      ? fmtDate(b, { month: "short", year: "2-digit" })
      : r.period.bucket === "week"
        ? `wk ${fmtDate(b)}`
        : fmtDate(b, data.length > 10 ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" });
  return (
    <div>
      <div className="flex h-48 items-end gap-1">
        {data.map((d, i) => (
          <div
            key={d.bucket}
            className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="hatch absolute inset-0 rounded-md bg-surface-2/40" />
            <div
              className={cx("relative rounded-md transition-all", i === focus ? "bg-accent" : "bg-good-soft")}
              style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }}
            />
            {i === focus && (
              <span
                className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-ink px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white"
                style={{ bottom: `calc(${Math.max(2, (d.n / max) * 100)}% + 4px)` }}
              >
                {d.n}
                {d.u !== undefined ? ` · ${d.u} people` : ""}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        {data.map((d, i) => (
          <span
            key={d.bucket}
            className={cx("min-w-0 flex-1 truncate text-center font-mono text-[9px]", i === focus ? "text-ink" : "text-muted")}
          >
            {data.length > 16 && i % Math.ceil(data.length / 12) !== 0 && i !== focus ? "" : fmt(d.bucket)}
          </span>
        ))}
      </div>
    </div>
  );
}

const ENG = [
  ["regular", "Regular", "≥ 75%", "bg-good"],
  ["occasional", "Occasional", "25–75%", "bg-good-soft"],
  ["rare", "Rare", "< 25%", "bg-warn/60"],
  ["absent", "Didn't come", "0%", "hatch bg-surface-2"],
] as const;

function Engagement({ r }: { r: Report }) {
  const total = r.totals.peopleTotal || 1;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full">
        {ENG.map(([k, , , cls]) => (
          <div key={k} className={cls} style={{ width: `${(r.engagement[k] / total) * 100}%` }} title={`${r.engagement[k]}`} />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {ENG.map(([k, l, range, cls]) => (
          <li key={k} className="flex items-center gap-3 text-sm">
            <span className={cx("size-3 rounded-full", cls)} />
            <span className="flex-1">
              {l} <span className="text-xs text-muted">{range}</span>
            </span>
            <span className="font-mono tabular-nums">{r.engagement[k]}</span>
            <span className="w-10 text-right text-xs text-muted">{pct(r.engagement[k] / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Groups({ r }: { r: Report }) {
  return (
    <Card>
      <h2 className="mb-4 font-medium">By group</h2>
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
        {r.groups.map((g) => (
          <div key={g.group}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="truncate">{g.group}</span>
              <span className="font-mono text-xs text-muted">
                {g.attended}/{g.people} · {pct(g.people ? g.attended / g.people : 0)}
              </span>
            </div>
            <div className="hatch h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-good" style={{ width: `${g.people ? (g.attended / g.people) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

type Tab = "absent" | "drifting" | "faithful";
const TEMPLATE_KEY = "f2f_followup_template";

function FollowUp({ r, orgName }: { r: Report; orgName: string }) {
  const [tab, setTab] = useState<Tab>(r.lists.drifting.total ? "drifting" : "absent");
  const [q, setQ] = useState("");
  const [template, setTemplate] = useState(() => {
    try {
      return localStorage.getItem(TEMPLATE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [editing, setEditing] = useState(false);
  const defaultTemplate = `Hi {name}, we missed you at ${orgName}! Hope all is well with you. 🙏`;
  const tpl = template || defaultTemplate;

  const list = r.lists[tab];
  const people = useMemo(
    () =>
      list.people.filter(
        (p) => !q || p.full_name.toLowerCase().includes(q.toLowerCase()) || (p.group_name ?? "").toLowerCase().includes(q.toLowerCase()),
      ),
    [list, q],
  );
  const TABS: [Tab, string, string][] = [
    ["drifting", "Drifting away", "Came regularly last period, not at all this one"],
    ["absent", "Didn't come", "No check-in this period"],
    ["faithful", "Most faithful", "Attended the most service days"],
  ];
  const message = (p: P) => tpl.replaceAll("{name}", p.full_name.split(/\s+/)[0]).replaceAll("{org}", orgName);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-full border border-line bg-surface p-1 text-sm">
          {TABS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cx(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1",
                tab === k ? "bg-ink text-white" : "text-muted hover:text-ink",
              )}
            >
              {l}
              <span className={cx("rounded-full px-1.5 text-[10px]", tab === k ? "bg-white/20" : "bg-surface-2")}>{r.lists[k].total}</span>
            </button>
          ))}
        </div>
        <div className="no-print flex items-center gap-2">
          <Input
            placeholder="Filter by name or group…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-48 rounded-full py-1.5"
          />
          <Button
            variant="ghost"
            className="whitespace-nowrap"
            onClick={() =>
              hardNavigate(
                `/api/admin/reports?from=${r.period.from}&to=${r.period.to}&active=${r.totals.activeDays}&service=${r.service ?? ""}&group=${encodeURIComponent(r.group ?? "")}&format=csv&list=${tab}`,
              )
            }
          >
            Export CSV
          </Button>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted">
        {tab !== "faithful" && (
          <>
            Message:{" "}
            {editing ? (
              <span className="mt-2 block">
                <textarea
                  value={tpl}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    try {
                      localStorage.setItem(TEMPLATE_KEY, e.target.value);
                    } catch {}
                  }}
                  rows={2}
                  className="w-full max-w-xl rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink"
                />
                <span className="text-muted">
                  {"{name}"} = first name.{" "}
                  <button onClick={() => setEditing(false)} className="underline">
                    Done
                  </button>
                </span>
              </span>
            ) : (
              <>
                <span className="italic text-ink/70">“{tpl.replace("{name}", "Ama")}”</span>{" "}
                <button onClick={() => setEditing(true)} className="no-print underline">
                  edit
                </button>
              </>
            )}
          </>
        )}
      </p>

      {people.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          {list.total === 0
            ? tab === "faithful"
              ? "No check-ins yet in this period."
              : "Nobody here — wonderful! 🎉"
            : "No match for that filter."}
        </p>
      ) : (
        <ul className="divide-y divide-line/70">
          {people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Avatar src={p.avatar} name={p.full_name} size={36} />
              <Link href={`/admin/people/${p.id}`} className="min-w-0 flex-1 hover:underline">
                <div className="truncate text-sm font-medium">{p.full_name}</div>
                <div className="truncate text-xs text-muted">
                  <span className="font-mono">{p.code || p.ref}</span>
                  {p.group_name ? ` · ${p.group_name}` : ""}
                </div>
              </Link>
              <div className="w-36 text-xs text-muted">
                {tab === "faithful" ? (
                  <>
                    <span className="text-ink">{p.days}</span> of {p.expected} · {pct(p.expected ? Math.min(1, p.days / p.expected) : 0)}
                  </>
                ) : tab === "drifting" ? (
                  <>
                    came {p.prev_days}× before · last {ago(p.last_seen)}
                  </>
                ) : (
                  <>last seen {ago(p.last_seen)}</>
                )}
              </div>
              <div className="no-print flex w-64 items-center justify-end gap-2">
                {p.phone ? (
                  <>
                    <PhoneDisplay value={p.phone} compact />
                    {tab !== "faithful" && (
                      <a
                        href={`https://wa.me/${p.phone.replace("+", "")}?text=${encodeURIComponent(message(p))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full bg-good px-2.5 py-1 text-[11px] font-medium text-white hover:bg-good/90"
                      >
                        Message
                      </a>
                    )}
                  </>
                ) : (
                  <Pill>no phone</Pill>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.total > list.people.length && (
        <p className="mt-3 text-xs text-muted">
          Showing {list.people.length} of {list.total} — export CSV for everyone.
        </p>
      )}
    </Card>
  );
}
