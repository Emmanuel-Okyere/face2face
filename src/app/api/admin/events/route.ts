import { eventSchema, checkEvent } from "@/lib/camp/events";
import { body, handle, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

/** Events of the current organization, with headline numbers. */
export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const events = await tenant(org.id, (sql) => sql`
    select e.id, e.name, e.venue, to_char(e.starts_on, 'YYYY-MM-DD') as starts_on, to_char(e.ends_on, 'YYYY-MM-DD') as ends_on,
      e.registration_open, e.archived, e.created_at,
      (select count(*)::int from event_registrants r where r.event_id = e.id and r.status = 'registered') as people,
      (select count(*)::int from event_households h where h.event_id = e.id) as households,
      (select count(*)::int from event_registrants r where r.event_id = e.id and r.status = 'registered' and r.room_id is not null) as roomed
    from events e order by e.archived, coalesce(e.starts_on, e.created_at::date) desc`);
  return json({ events });
});

export const POST = handle(async (req) => {
  const { org } = await requireOrg(req);
  const e = await body(req, eventSchema);
  checkEvent(e);
  const [row] = await tenant(org.id, (sql) => sql`
    insert into events (name, venue, starts_on, ends_on, registration_open, churches, age_groups, child_age, unit_label, questions, rooms_enabled, buses_enabled, form, meals_enabled, meals_mode, meals)
    values (${e.name}, ${e.venue}, ${e.starts_on}, ${e.ends_on}, ${e.registration_open}, ${e.churches},
            ${sql.json(e.age_groups as never)}, ${e.child_age}, ${e.unit_label}, ${sql.json(e.questions as never)},
            ${e.rooms_enabled}, ${e.buses_enabled}, ${sql.json(e.form as never)}, ${e.meals_enabled}, ${e.meals_mode}, ${sql.json(e.meals as never)})
    returning id`);
  return json({ id: row.id }, 201);
});
