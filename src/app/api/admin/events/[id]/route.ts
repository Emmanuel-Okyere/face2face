import { z } from "zod";
import { checkEvent, eventSchema, loadEvent } from "@/lib/camp/events";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { appOrigin, mailEnabled } from "@/lib/mail";
import { smsEnabled } from "@/lib/sms";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };
const eventId = async (params: Ctx["params"]) => z.uuid().parse((await params).id);

/** Everything the event screens need in one go: settings, rooms, buses, families, people. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = await eventId(params);
  const data = await tenant(org.id, async (sql) => {
    const event = await loadEvent(sql, id);
    const [rooms, buses, households, people, messages] = await Promise.all([
      sql`select id, building, name, gender, beds, church, note from event_rooms where event_id = ${id} order by building, length(name), name`,
      sql`select id, name, seats, churches, pickup, departs, driver, captain_token from event_buses where event_id = ${id} order by length(name), name`,
      sql`select id, church, contact_name, contact_phone, contact_email, code, pass_token, source, created_at from event_households where event_id = ${id} order by created_at`,
      sql`select id, household_id, full_name, gender, age, age_group, to_json(days) as days, relation, phone, needs_bus, answers, status, code,
            room_id, bed, room_locked, bus_id, seat, seat_locked, arrived_at, created_at
          from event_registrants where event_id = ${id} order by created_at`,
      sql`select status, count(*)::int as n from event_messages where event_id = ${id} group by status`,
    ]);
    const boardings = await sql`select registrant_id, bus_id, trip, method, at from event_boardings where event_id = ${id}`;
    return { event, rooms, buses, households, people, boardings, messages: Object.fromEntries(messages.map((m) => [m.status, m.n])) };
  });
  return json({ ...data, origin: appOrigin(req), channels: { sms: smsEnabled(), email: mailEnabled() } });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = await eventId(params);
  const e = await body(req, eventSchema);
  checkEvent(e);
  await tenant(org.id, async (sql) => {
    await loadEvent(sql, id);
    await sql`
      update events set name = ${e.name}, venue = ${e.venue}, starts_on = ${e.starts_on}, ends_on = ${e.ends_on},
        registration_open = ${e.registration_open}, churches = ${e.churches}, age_groups = ${sql.json(e.age_groups as never)},
        child_age = ${e.child_age}, unit_label = ${e.unit_label}, rooms_enabled = ${e.rooms_enabled}, buses_enabled = ${e.buses_enabled},
        form = ${sql.json(e.form as never)}, questions = ${sql.json(e.questions as never)}, archived = ${e.archived ?? false}
      where id = ${id}`;
  });
  return json({ ok: true });
});

/** Delete an event and everything in it (owners only; typed confirmation in the UI). */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req, { owner: true });
  const id = await eventId(params);
  const n = await tenant(org.id, (sql) => sql`delete from events where id = ${id} returning id`);
  if (!n.length) throw new HttpError(404, "Event not found");
  return json({ ok: true });
});
