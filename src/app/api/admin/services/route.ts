import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { normalize, serviceSchema } from "@/lib/service-input";
import { listServices } from "@/lib/services";
import { tenant } from "@/lib/tenant";

/** The organization's services, with how often each has been held. */
export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  return tenant(org.id, async (sql) => {
    const services = await listServices(sql, org);
    const stats = await sql`
      select service_id, count(distinct day)::int as held, count(*)::int as checkins, max(day)::text as last_held
      from attendance where org_id = ${org.id} group by service_id`;
    const groups = await sql`
      select distinct group_name from people where org_id = ${org.id} and group_name is not null order by 1`;
    const by = new Map(stats.map((r) => [r.service_id, r]));
    return json({
      services: services.map((s) => ({ ...s, held: by.get(s.id)?.held ?? 0, checkins: by.get(s.id)?.checkins ?? 0, last_held: by.get(s.id)?.last_held ?? null })),
      // The organization's own group list first, then any other group people already have.
      groups: [...new Set([...(org.personFields.find((f) => f.key === "group_name")?.options ?? []), ...groups.map((g) => g.group_name as string)])],
    });
  });
});

export const POST = handle(async (req) => {
  const { org } = await requireOrg(req);
  const s = normalize(await body(req, serviceSchema));
  const [row] = await tenant(org.id, (sql) => sql`
    insert into services (org_id, name, kind, weekdays, on_date, start_time, end_time, opens_before, closes_after, late_after, audience, active)
    values (${org.id}, ${s.name}, ${s.kind}, ${s.weekdays}, ${s.on_date}, ${s.start_time}, ${s.end_time},
            ${s.opens_before}, ${s.closes_after}, ${s.late_after}, ${s.audience}, ${s.active})
    returning id`);
  if (!row) throw new HttpError(500, "Couldn't create the service");
  return json({ id: row.id }, 201);
});
