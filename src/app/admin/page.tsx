"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { PageHeader, useMe } from "@/components/AdminShell";
import ManualCheckIn from "@/components/ManualCheckIn";
import { api, Avatar, Card, CountUp, cx, Empty, fmtTime, Pill } from "@/components/ui";

type Stats = {
  day: string;
  timeZone: string;
  totals: { people: number; enrolled: number; present: number; late: number; visitors: number; first_time: number };
  hourly: { hour: number; n: number }[];
  methods: { method: string; n: number }[];
  groups: { group_name: string; total: number; present: number }[];
  recent: {
    id: number;
    checked_in_at: string;
    method: string;
    service: string;
    full_name: string;
    ref: string;
    code: string | null;
    avatar: string | null;
    group_name: string | null;
    late: boolean;
    is_visitor: boolean;
  }[];
  trend: { day: string; n: number }[];
  services: { id: string; name: string; schedule: string; window: string; present: number; expected: number; status: "open" | "upcoming" | "done" }[];
};

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

const noop = () => () => {};

/** The dashboard before its numbers arrive: the same layout at zero, so data can animate in. */
function emptyStats(): Stats {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - 13 + i);
    return { day: iso(d), n: 0 };
  });
  return { day: iso(today), timeZone: "", totals: { people: 0, enrolled: 0, present: 0, late: 0, visitors: 0, first_time: 0 }, hourly: [], methods: [], groups: [], recent: [], trend, services: [] };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

export default function Dashboard() {
  const me = useMe();
  const [day, setDay] = useState("");
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api<Stats>(`/api/admin/stats${day ? `?day=${day}` : ""}`)
      .then((r) => {
        setS(r);
        setErr("");
      })
      .catch((e) => setErr(e.message));
  }, [day]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  // Draw only in the browser: the greeting and dates depend on the viewer's clock.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  if (!s && err) return <Empty title="Couldn't load the dashboard">{err}</Empty>;
  const loaded = !!s;
  const data = s ?? emptyStats();
  const { totals } = data;
  const absent = Math.max(0, totals.people - totals.present);
  const yesterday = data.trend.at(-2)?.n ?? 0;
  const delta = totals.present - yesterday;
  const method = (m: string) => data.methods.find((x) => x.method === m)?.n ?? 0;
  const first = (me?.name || "").split(" ")[0];

  return (
    <div className="stagger">
      <PageHeader
        title={
          <>
            {greeting()}
            {first && (
              <>
                , <span className="font-semibold">{first}!</span>
              </>
            )}
          </>
        }
        actions={
          <label className="flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm">
            <svg viewBox="0 0 24 24" className="size-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18" />
            </svg>
            <input type="date" value={day || data.day} onChange={(e) => setDay(e.target.value)} className="bg-transparent outline-none" aria-label="Day" />
          </label>
        }
      />

      {/* ── Stat cards ── */}
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Present today" value={<CountUp value={totals.present} />} foot={
            <span>
              <Delta n={delta} suffix="vs yesterday" />
              {totals.visitors > 0 && (
                <span className="ml-1.5 text-ink/70">
                  · +{totals.visitors} {totals.visitors === 1 ? "visitor" : "visitors"}
                  {totals.first_time > 0 && `, ${totals.first_time} first time`}
                </span>
              )}
            </span>
          }
          href="/admin/attendance">
          <TwinBars a={yesterday} b={totals.present} max={Math.max(1, totals.people)} />
        </StatCard>
        <StatCard title="Attendance rate" value={<CountUp value={pct(totals.present, totals.people)} format={(n) => `${n}%`} />} foot={<span>{absent} not yet in</span>}>
          <Gauge value={pct(totals.present, totals.people)} />
        </StatCard>
        <StatCard
          title="Late arrivals"
          value={<CountUp value={totals.late} format={(n) => String(n).padStart(2, "0")} />}
          foot={<span>across today&apos;s services</span>}
        >
          <DotMatrix filled={totals.late} total={Math.max(totals.present, 1)} />
        </StatCard>
        <StatCard title="Face enrolled" value={<CountUp value={totals.enrolled} />} foot={<span>of {totals.people} people</span>} href="/admin/people?status=pending">
          <Blocks value={pct(totals.enrolled, totals.people)} />
        </StatCard>
      </div>

      {/* ── Today's services ── */}
      {data.services.length > 0 && (
        <div className="stagger mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.services.map((sv) => (
            <Card key={sv.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{sv.name}</div>
                  <div className="text-xs text-muted">Check-in {sv.window}</div>
                </div>
                {sv.status === "open" ? <Pill tone="good">Open</Pill> : sv.status === "upcoming" ? <Pill>Later</Pill> : <Pill>Closed</Pill>}
              </div>
              <div className="mt-3 text-3xl tabular-nums tracking-tight">
                <CountUp value={sv.present} />
                <span className="text-base text-muted"> / {sv.expected}</span>
              </div>
              <div className="hatch mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-good transition-[width] duration-1000 ease-out" style={{ width: `${Math.min(100, pct(sv.present, sv.expected))}%` }} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Charts ── */}
      <div className="stagger mt-3 grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHead title="Attendance rate" sub="Last 14 days" />
          <RateBars data={data.trend} total={totals.people} selected={data.day} />
        </Card>
        <Card>
          <CardHead
            title="Arrivals by hour"
            right={
              <div className="flex gap-1.5">
                <Pill>Face {method("face")}</Pill>
                <Pill>QR {method("qr")}</Pill>
                {method("link") > 0 && <Pill>Phone {method("link")}</Pill>}
                <Pill>Manual {method("manual")}</Pill>
              </div>
            }
          />
          <HourLine key={loaded ? "data" : "empty"} data={data.hourly} />
        </Card>
      </div>

      {/* ── Lists ── */}
      <div className="stagger mt-3 grid gap-3 xl:grid-cols-3">
        <Card>
          <CardHead title="Just checked in" right={<ArrowLink href="/admin/attendance" />} />
          {data.recent.length === 0 ? (
            loaded && <p className="py-10 text-center text-sm text-muted">No check-ins yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.recent.slice(0, 7).map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                  <Avatar src={r.avatar} name={r.full_name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.full_name}</div>
                    <div className="truncate text-xs text-muted">{r.service}</div>
                  </div>
                  {r.is_visitor && <Pill tone="info">Visitor</Pill>}
                  {r.late && <Pill tone="warn">Late</Pill>}
                  <span className="font-mono text-xs text-muted">{fmtTime(r.checked_in_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="By group" />
          {data.groups.length === 0 ? (
            loaded && <p className="py-10 text-center text-sm text-muted">No people yet.</p>
          ) : data.groups.every((g) => g.group_name === "—") ? (
            <p className="py-10 text-center text-sm text-muted">
              Not using groups. Give people a group (department, class, ministry…) to see a breakdown here.
            </p>
          ) : (
            <ul className="space-y-3.5">
              {data.groups.map((g) => (
                <li key={g.group_name}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="truncate">{g.group_name}</span>
                    <span className="font-mono text-xs text-muted">
                      {g.present}/{g.total}
                    </span>
                  </div>
                  <div className="hatch h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-good transition-[width] duration-1000 ease-out" style={{ width: `${pct(g.present, g.total)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Manual check-in" />
          <ManualCheckIn onDone={load} />
        </Card>
      </div>
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────

function CardHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="font-medium">{title}</h2>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function ArrowLink({ href }: { href: string }) {
  return (
    <Link href={href} className="flex size-7 items-center justify-center rounded-full border border-line text-muted hover:text-ink" aria-label="Open">
      ↗
    </Link>
  );
}

function StatCard({ title, value, foot, href, children }: { title: string; value: React.ReactNode; foot: React.ReactNode; href?: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between text-xs text-ink/70">
        {title}
        {href ? <ArrowLink href={href} /> : <span className="size-7" />}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-4xl font-normal tabular-nums tracking-tight">{value}</div>
          <div className="mt-1 text-[11px] text-muted">{foot}</div>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </Card>
  );
}

function Delta({ n, suffix }: { n: number; suffix: string }) {
  return (
    <span>
      <span className={n >= 0 ? "text-good" : "text-accent"}>
        {n >= 0 ? "↗ +" : "↘ "}
        {n}
      </span>{" "}
      {suffix}
    </span>
  );
}

function TwinBars({ a, b, max }: { a: number; b: number; max: number }) {
  const h = (v: number) => `${Math.max(10, (v / max) * 100)}%`;
  return (
    <div className="flex h-12 items-end gap-1.5">
      <div className="hatch relative h-full w-5 overflow-hidden rounded-md bg-surface-2">
        <div className="absolute inset-x-0 bottom-0 rounded-md bg-info/80 transition-[height] duration-700 ease-out" style={{ height: h(a) }} title={`Yesterday ${a}`} />
      </div>
      <div className="hatch relative h-full w-5 overflow-hidden rounded-md bg-surface-2">
        <div className="absolute inset-x-0 bottom-0 rounded-md bg-good/80 transition-[height] duration-700 ease-out" style={{ height: h(b), transitionDelay: "120ms" }} title={`Today ${b}`} />
      </div>
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  // Semicircle of ticks, like the reference "new hires" gauge.
  const ticks = 22;
  return (
    <svg viewBox="0 0 80 46" className="h-12 w-20" aria-label={`${value}%`}>
      {Array.from({ length: ticks }, (_, i) => {
        const a = Math.PI - (i / (ticks - 1)) * Math.PI;
        const on = i / (ticks - 1) <= value / 100;
        const r1 = 26;
        const r2 = 36;
        return (
          <line
            key={i}
            x1={40 + r1 * Math.cos(a)}
            y1={42 - r1 * Math.sin(a)}
            x2={40 + r2 * Math.cos(a)}
            y2={42 - r2 * Math.sin(a)}
            stroke={on ? "var(--warn)" : "var(--line)"}
            strokeWidth="2.6"
            strokeLinecap="round"
            style={{ transition: "stroke 0.25s ease-out", transitionDelay: `${i * 30}ms` }}
          />
        );
      })}
      <text x="40" y="42" textAnchor="middle" fontSize="9" fill="var(--muted)">
        {value}%
      </text>
    </svg>
  );
}

function DotMatrix({ filled, total }: { filled: number; total: number }) {
  const cols = 9;
  const rows = 5;
  const n = cols * rows;
  const on = Math.round((filled / total) * n);
  return (
    <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 4px)` }} aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const idx = col * rows + (rows - 1 - row); // fill column-wise from bottom-left
        return <span key={i} className={cx("size-1 rounded-full transition-colors duration-300", idx < on ? "bg-accent" : "bg-line")} style={{ transitionDelay: `${idx * 15}ms` }} />;
      })}
    </div>
  );
}

function Blocks({ value }: { value: number }) {
  return (
    <div className="flex items-end gap-1.5">
      <div className="flex h-12 w-9 flex-col justify-end">
        <span className="mb-0.5 text-center text-[9px] text-muted">
          <CountUp value={value} format={(n) => `${n}%`} />
        </span>
        <div className="rounded-md bg-accent transition-[height] duration-700 ease-out" style={{ height: `${Math.max(14, value * 0.32)}px`, transitionDelay: "150ms" }} />
      </div>
      <div className="hatch h-8 w-9 rounded-md bg-surface-2" />
    </div>
  );
}

function RateBars({ data, total, selected }: { data: { day: string; n: number }[]; total: number; selected: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selected;
  return (
    <div className="flex gap-2">
      <div className="flex h-48 flex-col justify-between pb-6 text-right font-mono text-[10px] text-muted">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
        <span>0</span>
      </div>
      <div className="flex h-48 flex-1 items-end gap-1.5">
        {data.map((d, i) => {
          const dt = new Date(d.day + "T12:00:00");
          const rate = pct(d.n, total);
          const isFocus = d.day === focus;
          return (
            <div
              key={d.day}
              className="flex h-full flex-1 flex-col items-center gap-1.5"
              onMouseEnter={() => setHover(d.day)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="hatch relative w-full flex-1 overflow-visible rounded-lg bg-surface-2/60">
                <div
                  className={cx("absolute inset-x-0 bottom-0 rounded-lg transition-[height,background-color] duration-700 ease-out", isFocus ? "bg-accent" : "bg-good-soft")}
                  style={{ height: `${Math.max(2, rate)}%`, transitionDelay: `${i * 40}ms, 0ms` }}
                />
                {isFocus && (
                  <span
                    className="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-full bg-ink px-1.5 py-0.5 text-[10px] text-white"
                    style={{ bottom: `${Math.max(2, rate)}%` }}
                  >
                    {rate}%
                  </span>
                )}
              </div>
              <span className={cx("font-mono text-[10px]", isFocus ? "text-ink" : "text-muted")}>
                {dt.toLocaleDateString([], { day: "numeric" })}
                <span className="hidden sm:inline"> {dt.toLocaleDateString([], { month: "short" })}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HourLine({ data }: { data: { hour: number; n: number }[] }) {
  const hours = data.length ? data.map((d) => d.hour) : [8];
  const from = Math.max(0, Math.min(6, ...hours));
  const to = Math.min(23, Math.max(18, ...hours));
  const range = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const max = Math.max(1, ...data.map((d) => d.n));
  const W = 600;
  const H = 170;
  const pts = range.map((h, i) => {
    const n = data.find((d) => d.hour === h)?.n ?? 0;
    return { x: (i / (range.length - 1)) * W, y: H - 8 - (n / max) * (H - 30), n, h };
  });
  const peak = pts.reduce((a, b) => (b.n > a.n ? b : a), pts[0]);
  // Smooth-ish path with Catmull-Rom → Bézier.
  const d = pts
    .map((p, i) => {
      if (i === 0) return `M${p.x},${p.y}`;
      const p0 = pts[i - 2] ?? pts[i - 1];
      const p1 = pts[i - 1];
      const p3 = pts[i + 1] ?? p;
      const c1 = { x: p1.x + (p.x - p0.x) / 6, y: p1.y + (p.y - p0.y) / 6 };
      const c2 = { x: p.x - (p3.x - p1.x) / 6, y: p.y - (p3.y - p1.y) / 6 };
      return `C${c1.x},${c1.y} ${c2.x},${c2.y} ${p.x},${p.y}`;
    })
    .join(" ");
  return (
    <div>
      <div className="hatch-v relative rounded-xl">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" preserveAspectRatio="none" aria-label="Arrivals per hour">
          <path d={d} pathLength={1} className="draw" fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {peak.n > 0 && (
          <span
            className="fade-in absolute -translate-x-1/2 -translate-y-[140%] rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white"
            style={{ left: `${(peak.x / W) * 100}%`, top: `${(peak.y / H) * 100}%`, animationDelay: "1s" }}
          >
            {peak.n}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted">
        {range.filter((_, i) => i % 2 === 0).map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}:00</span>
        ))}
      </div>
    </div>
  );
}

