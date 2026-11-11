import { handle, json, requireOrg } from "@/lib/http";
import { describeSchedule, expects, fmtMin, isOpen, localNow, occursOn, windowOf } from "@/lib/service-schedule";
import { listServices } from "@/lib/services";
import { tenant, todayIn } from "@/lib/tenant";

export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const day = req.nextUrl.searchParams.get("day") || todayIn(org.timeZone);
  const tz = org.timeZone;
  const o = org.id;

  // One tenant transaction, queries in sequence (a transaction is one connection).
  return tenant(org.id, async (sql) => {
    // "Present" = people (not check-ins): someone at two services counts once.
    const [totals] = await sql`
      select
        (select count(*)::int from people where org_id = ${o} and active) as people,
        (select count(distinct person_id)::int from face_embeddings where org_id = ${o}) as enrolled,
        (select count(distinct person_id)::int from attendance where org_id = ${o} and day = ${day}::date) as present,
        (select count(distinct person_id)::int from attendance where org_id = ${o} and day = ${day}::date and late) as late`;
    const hourly = await sql`
      select extract(hour from checked_in_at at time zone ${tz})::int as hour, count(*)::int as n
      from attendance where org_id = ${o} and day = ${day}::date group by 1 order by 1`;
    const methods = await sql`
      select method::text as method, count(*)::int as n from attendance where org_id = ${o} and day = ${day}::date group by 1`;
    const groups = await sql`
      select coalesce(p.group_name, '—') as group_name, count(*)::int as total,
        count(*) filter (where exists (select 1 from attendance a where a.person_id = p.id and a.day = ${day}::date))::int as present
      from people p
      where p.org_id = ${o} and p.active group by 1 order by total desc limit 12`;
    const recent = await sql`
      select a.id, a.checked_in_at, a.method::text as method, a.late, s.name as service,
        p.full_name, p.ref, p.code, p.avatar_url as avatar, p.group_name
      from attendance a join people p on p.id = a.person_id join services s on s.id = a.service_id
      where a.org_id = ${o} and a.day = ${day}::date order by a.checked_in_at desc limit 12`;
    const trend = await sql`
      select d::date::text as day,
        (select count(distinct person_id)::int from attendance where org_id = ${o} and day = d::date) as n
      from generate_series(${day}::date - 13, ${day}::date, interval '1 day') d order by d`;

    // The day's services, with who came vs who was expected.
    const services = (await listServices(sql, org)).filter((s) => occursOn(s, day));
    const counts = await sql`
      select service_id, count(*)::int as n from attendance where org_id = ${o} and day = ${day}::date group by 1`;
    const people = await sql<{ group_name: string | null }[]>`select group_name from people where org_id = ${o} and active`;
    const now = localNow(tz);
    const byService = new Map(counts.map((c) => [c.service_id, c.n as number]));
    const todays = services.map((s) => {
      const w = windowOf(s);
      return {
        id: s.id,
        name: s.name,
        schedule: describeSchedule(s),
        window: `${fmtMin(w.opens)}–${fmtMin(w.closes)}`,
        present: byService.get(s.id) ?? 0,
        expected: people.filter((p) => expects(s, p.group_name)).length,
        status: day !== now.date ? (day < now.date ? "done" : "upcoming") : isOpen(s, now.date, now.min) ? "open" : now.min < w.opens ? "upcoming" : "done",
      };
    });

    return json({ day, timeZone: tz, org: { name: org.name, slug: org.slug }, totals, hourly, methods, groups, recent, trend, services: todays });
  });
});
