"use client";

import { Card, cx, Empty } from "@/components/ui";
import { eventDays, plural } from "@/lib/camp/format";
import type { FieldDef } from "@/lib/person-fields";
import { ageGroupName } from "./RegistrationForm";
import SavedInsights from "./SavedInsights";
import type { Person, TabProps } from "./types";

// One hue for magnitude; the gender pair is validated for colour-blind separation
// and always shown with labels.
const BAR = "#5b72d9";
const FEMALE = "#c2578f";
const MALE = "#3f73c4";

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const wd = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Event analytics, computed from the registrations already on the page. */
export default function Insights({ d }: TabProps) {
  const e = d.event;
  const live = d.people.filter((p) => p.status === "registered");
  if (!live.length) return <Empty title="Nothing to show yet">Insights appear once people register.</Empty>;

  const hh = new Map(d.households.map((h) => [h.id, h]));
  const churchOf = (p: Person) => hh.get(p.household_id)?.church ?? "—";
  const groupOf = (p: Person) => p.age_group ?? ageGroupName(p.age, e.age_groups);
  const days = eventDays(e.starts_on, e.ends_on);
  const onDay = (day: string) => live.filter((p) => !p.days || p.days.includes(day));
  const isChild = (p: Person) => {
    const a = p.age ?? e.age_groups.find((g) => g.name === p.age_group)?.upTo ?? null;
    return a !== null && a <= e.child_age;
  };

  // ── Registrations over time (by day registered) ──
  const byDate = new Map<string, number>();
  for (const p of live) {
    const k = p.created_at.slice(0, 10);
    byDate.set(k, (byDate.get(k) ?? 0) + 1);
  }
  const first = [...byDate.keys()].sort()[0];
  const timeline: { day: string; n: number; total: number }[] = [];
  {
    const end = new Date().toISOString().slice(0, 10);
    const t = new Date(`${first}T12:00:00Z`);
    let total = 0;
    for (let i = 0; i < 120; i++) {
      const k = t.toISOString().slice(0, 10);
      if (k > end) break;
      total += byDate.get(k) ?? 0;
      timeline.push({ day: k, n: byDate.get(k) ?? 0, total });
      t.setUTCDate(t.getUTCDate() + 1);
    }
  }
  const last7 = timeline.slice(-7).reduce((n, x) => n + x.n, 0);
  const prev7 = timeline.slice(-14, -7).reduce((n, x) => n + x.n, 0);

  // ── Churches ──
  const churches = [...new Set(live.map(churchOf))]
    .map((c) => {
      const ps = live.filter((p) => churchOf(p) === c);
      return { c, n: ps.length, families: new Set(ps.map((p) => p.household_id)).size, bus: ps.filter((p) => p.needs_bus).length, arrived: ps.filter((p) => p.arrived_at).length };
    })
    .sort((a, b) => b.n - a.n);
  const quiet = e.churches.filter((c) => !churches.some((x) => x.c === c));

  // ── Age × gender ──
  const groups = [...e.age_groups.map((g) => g.name), "Not given"];
  const ageRows = groups
    .map((g) => {
      const ps = live.filter((p) => (groupOf(p) ?? "Not given") === g);
      return { g, f: ps.filter((p) => p.gender === "female").length, m: ps.filter((p) => p.gender === "male").length, n: ps.length };
    })
    .filter((r) => r.n > 0);
  const females = live.filter((p) => p.gender === "female").length;
  const males = live.filter((p) => p.gender === "male").length;
  const showGender = e.form?.gender !== false || females + males > 0;

  // ── Families ──
  const sizes = new Map<string, number>();
  for (const h of d.households) {
    const n = live.filter((p) => p.household_id === h.id).length;
    if (!n) continue;
    const k = n >= 6 ? "6+" : String(n);
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
  }
  const families = [...sizes.values()].reduce((a, b) => a + b, 0);
  const avgFamily = families ? live.length / families : 0;

  // ── Days ──
  const perDay = days.map((day) => ({ day, n: onDay(day).length, kids: onDay(day).filter(isChild).length }));
  const peak = perDay.reduce((a, b) => (b.n > (a?.n ?? -1) ? b : a), perDay[0]);
  const partial = live.filter((p) => p.days && p.days.length < days.length).length;

  // ── Capacity ──
  const beds = (g: string) => d.rooms.filter((r) => r.gender === g).reduce((n, r) => n + r.beds, 0);
  const used = (g: string) => live.filter((p) => p.room_id && d.rooms.find((r) => r.id === p.room_id)?.gender === g).length;
  const riders = live.filter((p) => p.needs_bus);
  const seats = d.buses.reduce((n, b) => n + b.seats, 0);

  // ── Answers to the event's own questions ──
  const questions = (e.questions ?? []).filter((q) => q.enabled !== false);

  // ── Headline facts ──
  const kids = live.filter(isChild).length;
  const facts: { k: string; v: string; sub: string }[] = [
    { k: "Registered", v: String(live.length), sub: `${families} ${families === 1 ? "registration" : "registrations"} · ${avgFamily.toFixed(1)} people each` },
    { k: "This week", v: `+${last7}`, sub: prev7 ? `${last7 >= prev7 ? "up" : "down"} from ${prev7} the week before` : "new registrations in 7 days" },
    { k: `Top ${e.unit_label.toLowerCase()}`, v: churches[0].c, sub: `${churches[0].n} people · ${pct(churches[0].n, live.length)}%` },
    peak && days.length > 1
      ? (() => {
          const tied = perDay.filter((x) => x.n === peak.n);
          return { k: tied.length > 1 ? "Busiest days" : "Busiest day", v: tied.length > 1 ? `${wd(tied[0].day).split(" ")[0]}–${wd(tied[tied.length - 1].day).split(" ")[0]}` : wd(peak.day), sub: `${peak.n} people — plan meals for this` };
        })()
      : { k: "Children", v: String(kids), sub: `${e.child_age} and under` },
  ];

  return (
    <div className="space-y-4">
      <SavedInsights d={d} />
      <h2 className="pt-4 font-medium">At a glance</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {facts.map((f) => (
          <div key={f.k} className="card-shadow rounded-2xl border border-line bg-surface p-4">
            <div className="text-xs text-muted">{f.k}</div>
            <div className="mt-1 truncate text-2xl font-semibold leading-tight">{f.v}</div>
            <div className="mt-1 text-[11px] text-muted">{f.sub}</div>
          </div>
        ))}
      </div>

      {timeline.length > 1 && (
        <Card>
          <Title title="Registrations over time" sub={`${live.length} people since ${short(first)}`} />
          <Columns rows={timeline.map((t) => ({ label: short(t.day), n: t.n, tip: `${short(t.day)}: ${t.n} registered · ${t.total} total` }))} every={Math.ceil(timeline.length / 8)} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Title title={plural(e.unit_label)} sub={quiet.length ? `No one yet from ${quiet.slice(0, 3).join(", ")}${quiet.length > 3 ? ` +${quiet.length - 3}` : ""}` : `All ${e.churches.length || churches.length} represented`} />
          <Bars rows={churches.map((c) => ({ label: c.c, n: c.n, tip: `${c.c}: ${c.n} people, ${c.families} registrations${e.buses_enabled ? `, ${c.bus} need the bus` : ""}, ${c.arrived} arrived` }))} />
        </Card>

        <Card>
          <Title title="Age groups" sub={`${kids} children (${e.child_age} and under) · ${pct(kids, live.length)}%`} />
          {showGender && (
            <div className="mb-3 flex gap-4 text-xs text-muted">
              <Legend color={FEMALE} label={`Female ${females}`} />
              <Legend color={MALE} label={`Male ${males}`} />
            </div>
          )}
          <ul className="space-y-2.5">
            {ageRows.map((r) => {
              const max = Math.max(...ageRows.map((x) => x.n));
              const rest = r.n - r.f - r.m;
              return (
                <li key={r.g} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm" title={`${r.g}: ${r.n} (${r.f} female, ${r.m} male)`}>
                  <span className="truncate text-ink/80">{r.g}</span>
                  <span className="flex h-3 gap-[2px]" style={{ width: `${(r.n / max) * 100}%` }}>
                    {showGender ? (
                      <>
                        {r.f > 0 && <span className="h-full last:rounded-r-[4px]" style={{ flex: r.f, background: FEMALE }} />}
                        {r.m > 0 && <span className="h-full last:rounded-r-[4px]" style={{ flex: r.m, background: MALE }} />}
                        {rest > 0 && <span className="h-full bg-line last:rounded-r-[4px]" style={{ flex: rest }} />}
                      </>
                    ) : (
                      <span className="h-full flex-1 rounded-r-[4px]" style={{ background: BAR }} />
                    )}
                  </span>
                  <span className="text-right tabular-nums text-ink/80">{r.n}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {days.length > 1 && (
          <Card>
            <Title title="Expected each day" sub={partial ? `${partial} people come for only some days` : "Everyone is coming every day"} />
            <Columns rows={perDay.map((x) => ({ label: wd(x.day), n: x.n, tip: `${wd(x.day)}: ${x.n} people, ${x.kids} children`, mark: x.n === peak?.n }))} showValues />
          </Card>
        )}
        <Card>
          <Title title="Registration size" sub={`${sizes.get("1") ?? 0} on their own, ${families - (sizes.get("1") ?? 0)} with others`} />
          <Columns
            rows={["1", "2", "3", "4", "5", "6+"].map((k) => ({ label: k === "1" ? "Alone" : `${k} people`, n: sizes.get(k) ?? 0, tip: `${sizes.get(k) ?? 0} registrations of ${k}` }))}
            showValues
          />
        </Card>
      </div>

      {(e.rooms_enabled || e.buses_enabled) && (
        <Card>
          <Title title="Capacity" />
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {e.rooms_enabled && <Meter label="All beds" used={live.filter((p) => p.room_id).length} total={d.rooms.reduce((n, r) => n + r.beds, 0)} need={live.length} />}
            {e.rooms_enabled &&
              (["female", "male", "family"] as const)
                .filter((g) => beds(g) > 0)
                .map((g) => <Meter key={g} label={`${g === "female" ? "Women's" : g === "male" ? "Men's" : "Family"} rooms`} used={used(g)} total={beds(g)} />)}
            {e.buses_enabled && <Meter label="Bus seats" used={riders.filter((p) => p.bus_id).length} total={seats} need={riders.length} />}
          </div>
        </Card>
      )}

      {questions.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {questions.map((q) => (
            <Answers key={q.key} q={q} people={live} />
          ))}
        </div>
      )}

      <Card className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Stat label="Registered online" value={d.households.filter((h) => h.source === "public").length} />
        <Stat label="Added by admins" value={d.households.filter((h) => h.source === "admin").length} />
        <Stat label="Cancelled" value={d.people.filter((p) => p.status === "cancelled").length} />
        <Stat label="Arrived at camp" value={live.filter((p) => p.arrived_at).length} />
        <Stat label="SMS / email sent" value={d.messages.sent ?? 0} />
        {(d.messages.failed ?? 0) > 0 && <Stat label="Failed to send" value={d.messages.failed} />}
      </Card>
    </div>
  );
}

function Title({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h3 className="font-medium">{title}</h3>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

/** Horizontal bars, biggest first, value at the end of each. */
function Bars({ rows, limit = 12 }: { rows: { label: string; n: number; tip: string }[]; limit?: number }) {
  const shown = rows.slice(0, limit);
  const other = rows.slice(limit).reduce((n, r) => n + r.n, 0);
  const all = other ? [...shown, { label: `${rows.length - limit} others`, n: other, tip: `${rows.length - limit} others: ${other}` }] : shown;
  const max = Math.max(1, ...all.map((r) => r.n));
  return (
    <ul className="space-y-2.5">
      {all.map((r) => (
        <li key={r.label} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm" title={r.tip}>
          <span className="truncate text-ink/80">{r.label}</span>
          <span className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(2, (r.n / max) * 100)}%`, background: BAR }} />
          <span className="text-right tabular-nums text-ink/80">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns along a baseline; labels thinned when there are many. */
function Columns({ rows, every = 1, showValues }: { rows: { label: string; n: number; tip: string; mark?: boolean }[]; every?: number; showValues?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div>
      <div className="flex h-36 items-end gap-[2px] border-b border-line">
        {rows.map((r, i) => (
          <div key={i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={r.tip}>
            {showValues && r.n > 0 && <span className="mb-1 text-center text-[11px] tabular-nums text-muted">{r.n}</span>}
            <span
              className={cx("rounded-t-[4px] transition-opacity group-hover:opacity-80", r.n === 0 && "opacity-0")}
              style={{ height: `${(r.n / max) * (showValues ? 82 : 100)}%`, minHeight: r.n ? 3 : 0, background: r.mark ? "var(--ink)" : BAR }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {rows.map((r, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">
            {i % every === 0 ? r.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Used / set up, with what's needed marked when it's more than what exists. */
function Meter({ label, used, total, need }: { label: string; used: number; total: number; need?: number }) {
  const short = need !== undefined && need > total ? need - total : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          {used} / {total} {short > 0 && <span className="font-medium text-danger">· {short} short</span>}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${total ? Math.min(100, (used / total) * 100) : 0}%`, background: BAR }} />
      </div>
    </div>
  );
}

/** Each custom question: counts per answer (dropdown / yes-no), or how many answered plus recent answers. */
function Answers({ q, people }: { q: FieldDef; people: Person[] }) {
  const answered = people.filter((p) => {
    const v = p.answers?.[q.key];
    return v !== undefined && v !== null && v !== "";
  });
  if (q.type === "select" || q.type === "yesno") {
    const keys = q.type === "yesno" ? ["Yes", "No"] : (q.options ?? []);
    const val = (p: Person) => {
      const v = p.answers?.[q.key];
      return typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
    };
    const rows = keys.map((k) => ({ label: k, n: answered.filter((p) => val(p) === k).length, tip: "" })).map((r) => ({ ...r, tip: `${r.label}: ${r.n}` }));
    return (
      <Card>
        <Title title={q.label} sub={`${answered.length} of ${people.length} answered`} />
        <Bars rows={rows} />
      </Card>
    );
  }
  const recent = answered.slice(-5).reverse();
  return (
    <Card>
      <Title title={q.label} sub={`${answered.length} of ${people.length} answered`} />
      {recent.length ? (
        <ul className="space-y-1.5 text-sm">
          {recent.map((p) => (
            <li key={p.id} className="flex gap-2">
              <span className="w-32 shrink-0 truncate text-muted">{p.full_name}</span>
              <span className="min-w-0 truncate">{String(p.answers[q.key])}</span>
            </li>
          ))}
          {answered.length > 5 && <li className="text-xs text-muted">All answers are in the CSV export.</li>}
        </ul>
      ) : (
        <p className="text-sm text-muted">No answers yet.</p>
      )}
    </Card>
  );
}
