import { HttpError, handle, json, requireOrg } from "@/lib/http";
import { displayValue } from "@/lib/person-fields";
import { expects } from "@/lib/service-schedule";
import { listServices } from "@/lib/services";
import { tenant, todayIn } from "@/lib/tenant";

// Attendance reports over a date range, optionally for one service.
//
// Definitions:
//  • held service  = a service on a day where at least one person checked in
//                    (a cancelled service doesn't count against anyone)
//  • expected      = the service is for everyone, or for the person's group
//  • rate          = expected services attended ÷ expected services held
//  • engagement    = regular ≥ 75% · occasional 25–75% · rare < 25% · absent 0
//  • active member = checked in within the last N days (30/60/90) up to `to`
//  • drifting      = came regularly to expected services in the previous period
//                    of equal length (≥ 40%, at least 2) but not at all in this one

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const LIST_LIMIT = 300;

function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

type PersonRow = {
  id: string;
  full_name: string;
  ref: string;
  code: string | null;
  group_name: string | null;
  phone: string | null;
  avatar: string | null;
  last_seen: string | null;
};
type Out = PersonRow & { days: number; expected: number; prev_days?: number };
type Att = { person_id: string; service_id: string; day: string };

export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const sp = req.nextUrl.searchParams;
  const today = todayIn(org.timeZone);
  const to = sp.get("to") || today;
  const from = sp.get("from") || to;
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new HttpError(400, "Use from/to as YYYY-MM-DD with from ≤ to");
  const span = daysBetween(from, to) + 1;
  if (span > 3 * 366) throw new HttpError(400, "Reports cover at most 3 years");
  const activeDays = [30, 60, 90].includes(Number(sp.get("active"))) ? Number(sp.get("active")) : 30;
  const serviceId = sp.get("service") && UUID.test(sp.get("service")!) ? sp.get("service")! : null;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -span);
  const bucket = span <= 62 ? "day" : span <= 400 ? "week" : "month";
  const o = org.id;

  const data = await tenant(org.id, async (sql) => {
    const svc = serviceId ? sql`and service_id = ${serviceId}` : sql``;
    const services = await listServices(sql, org);
    const people = await sql<PersonRow[]>`
      select p.id, p.full_name, p.ref, p.code, p.group_name, p.phone, p.avatar_url as avatar,
        (select max(a.day)::text from attendance a where a.person_id = p.id and a.day <= ${to}::date) as last_seen
      from people p
      where p.org_id = ${o} and p.active and p.created_at::date <= ${to}::date
      order by p.full_name`;
    const rows = await sql<Att[]>`
      select person_id, service_id, day::text from attendance
      where org_id = ${o} and day between ${from}::date and ${to}::date ${svc}`;
    const prevRows = await sql<Att[]>`
      select person_id, service_id, day::text from attendance
      where org_id = ${o} and day between ${prevFrom}::date and ${prevTo}::date ${svc}`;
    const [t] = await sql`
      select
        (select count(distinct person_id)::int from attendance
          where org_id = ${o} and day > ${to}::date - ${activeDays}::int and day <= ${to}::date) as active_members,
        (select count(*)::int from (
           select person_id, min(day) as first from attendance where org_id = ${o} group by person_id
         ) f where f.first between ${from}::date and ${to}::date) as newcomers`;
    const series =
      bucket === "day"
        ? await sql`
            select day::text as bucket, count(*)::int as n, count(distinct person_id)::int as u from attendance
            where org_id = ${o} and day between ${from}::date and ${to}::date ${svc}
            group by day order by day`
        : await sql`
            with b as (
              select generate_series(date_trunc(${bucket}, ${from}::date), date_trunc(${bucket}, ${to}::date), ('1 ' || ${bucket})::interval)::date as bucket
            )
            select b.bucket::text, coalesce(x.n, 0)::int as n, coalesce(x.u, 0)::int as u
            from b left join (
              select date_trunc(${bucket}, day)::date as bucket, count(*) as n, count(distinct person_id) as u
              from attendance where org_id = ${o} and day between ${from}::date and ${to}::date ${svc} group by 1
            ) x using (bucket)
            order by b.bucket`;
    const methods = await sql`
      select method::text as method, count(*)::int as n from attendance
      where org_id = ${o} and day between ${from}::date and ${to}::date ${svc} group by 1`;
    return { services, people, rows, prevRows, t, series, methods };
  });

  const svcById = new Map(data.services.map((s) => [s.id, s]));
  // Held occurrences (service + day with ≥ 1 check-in).
  const occ = (rows: Att[]) => {
    const m = new Map<string, { service_id: string; day: string; n: number }>();
    for (const r of rows) {
      const k = `${r.service_id}|${r.day}`;
      const e = m.get(k) ?? { service_id: r.service_id, day: r.day, n: 0 };
      e.n++;
      m.set(k, e);
    }
    return [...m.values()];
  };
  const held = occ(data.rows);
  const prevHeld = occ(data.prevRows);
  const key = (r: Att) => `${r.person_id}|${r.service_id}|${r.day}`;
  const attendedSet = new Set(data.rows.map(key));
  const prevSet = new Set(data.prevRows.map(key));
  const rowsByPerson = new Map<string, number>();
  for (const r of data.rows) rowsByPerson.set(r.person_id, (rowsByPerson.get(r.person_id) ?? 0) + 1);

  const people: Out[] = data.people.map((p) => {
    const count = (list: typeof held, set: Set<string>) => {
      let expected = 0;
      let attended = 0;
      for (const h of list) {
        const s = svcById.get(h.service_id);
        if (s && expects(s, p.group_name)) {
          expected++;
          if (set.has(`${p.id}|${h.service_id}|${h.day}`)) attended++;
        }
      }
      return { expected, attended };
    };
    const now = count(held, attendedSet);
    const prev = count(prevHeld, prevSet);
    const regularBefore = prev.expected <= 2 ? 1 : Math.max(2, Math.ceil(prev.expected * 0.4));
    return {
      ...p,
      days: rowsByPerson.get(p.id) ?? 0, // includes services they visited without being expected
      expected: now.expected,
      prev_days: prev.expected > 0 && prev.attended >= regularBefore ? prev.attended : 0,
    };
  });

  const members = people.filter((p) => p.expected > 0); // expected at ≥ 1 held service
  const rate = (p: Out) => (p.expected ? Math.min(1, p.days / p.expected) : 0);
  const engagement = { regular: 0, occasional: 0, rare: 0, absent: 0 };
  for (const p of members) {
    const r = rate(p);
    if (p.days === 0) engagement.absent++;
    else if (r >= 0.75) engagement.regular++;
    else if (r >= 0.25) engagement.occasional++;
    else engagement.rare++;
  }
  const absent = members.filter((p) => p.days === 0).sort((a, b) => (a.last_seen ?? "").localeCompare(b.last_seen ?? ""));
  const drifting = members.filter((p) => p.days === 0 && (p.prev_days ?? 0) > 0).sort((a, b) => (b.prev_days ?? 0) - (a.prev_days ?? 0));
  const faithful = people.filter((p) => p.days > 0).sort((a, b) => rate(b) - rate(a) || b.days - a.days || a.full_name.localeCompare(b.full_name));

  const groups = new Map<string, { group: string; people: number; attended: number }>();
  for (const p of members) {
    const g = p.group_name || "—";
    const row = groups.get(g) ?? { group: g, people: 0, attended: 0 };
    row.people++;
    if (p.days > 0) row.attended++;
    groups.set(g, row);
  }

  const checkins = data.rows.length;
  const uniquePeople = new Set(data.rows.map((r) => r.person_id)).size;
  const peak = held.length ? held.reduce((a, b) => (b.n > a.n ? b : a)) : null;
  const strip = (p: Out) => ({
    id: p.id,
    full_name: p.full_name,
    ref: p.ref,
    code: p.code,
    group_name: p.group_name,
    phone: p.phone,
    avatar: p.avatar,
    last_seen: p.last_seen,
    days: p.days,
    expected: p.expected,
    ...(p.prev_days ? { prev_days: p.prev_days } : {}),
  });

  if (sp.get("format") === "csv") {
    const list = sp.get("list") ?? "absent";
    const rows = list === "drifting" ? drifting : list === "faithful" ? faithful : list === "everyone" ? people : absent;
    const phoneField = org.personFields.find((f) => f.key === "phone") ?? {
      key: "phone",
      label: "Phone",
      type: "phone" as const,
      enabled: true,
      required: false,
      showInList: false,
    };
    const cell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const lines = [
      ["name", "platform_id", "code", "group", "phone", "attended", "expected", "attendance_rate", "last_seen"].map(cell).join(","),
      ...rows.map((p) =>
        [p.full_name, p.ref, p.code, p.group_name, displayValue(phoneField, p.phone), p.days, p.expected, `${Math.round(rate(p) * 100)}%`, p.last_seen ?? "never"]
          .map(cell)
          .join(","),
      ),
    ];
    return new Response(lines.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${org.slug}_${list}_${from}_${to}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return json({
    org: { name: org.name, timeZone: org.timeZone },
    period: { from, to, days: span, bucket, prevFrom, prevTo, today },
    services: data.services.map((s) => ({ id: s.id, name: s.name, active: s.active })),
    service: serviceId,
    totals: {
      checkins,
      uniquePeople,
      servicesHeld: held.length,
      avgPerService: held.length ? Math.round((checkins / held.length) * 10) / 10 : 0,
      peopleTotal: members.length,
      attendanceRate: members.length ? members.filter((p) => p.days > 0).length / members.length : 0,
      activeMembers: data.t.active_members,
      activeDays,
      newcomers: data.t.newcomers,
      peak: peak ? { day: peak.day, n: peak.n, service: svcById.get(peak.service_id)?.name ?? "" } : null,
      prev: { checkins: data.prevRows.length, uniquePeople: new Set(data.prevRows.map((r) => r.person_id)).size, servicesHeld: prevHeld.length },
    },
    engagement,
    series: data.series,
    methods: data.methods,
    groups: [...groups.values()].sort((a, b) => b.people - a.people),
    lists: {
      absent: { total: absent.length, people: absent.slice(0, LIST_LIMIT).map(strip) },
      drifting: { total: drifting.length, people: drifting.slice(0, LIST_LIMIT).map(strip) },
      faithful: { total: faithful.length, people: faithful.slice(0, 50).map(strip) },
    },
  });
});
