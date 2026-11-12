import { after } from "next/server";
import { z } from "zod";
import { householdSchema, insertHousehold, loadEvent, normalizeHousehold, queueMessages, sendQueued } from "@/lib/camp/events";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { appOrigin } from "@/lib/mail";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/** Register one person or a group from the admin side (phone calls, walk-ins). `notify` sends the confirmation SMS. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const input = await body(req, householdSchema.extend({ notify: z.boolean().default(true) }));
  const origin = appOrigin(req);
  const hh = await tenant(org.id, async (sql) => {
    const e = await loadEvent(sql, id);
    const h = normalizeHousehold(e, input);
    const row = await insertHousehold(sql, e, h, "admin");
    if (input.notify) await queueMessages(sql, e, "registered", origin, { householdIds: [row.id] });
    return row;
  });
  if (input.notify) after(() => sendQueued(org.id, id).catch((e) => console.error("[camp] send", e)));
  return json({ household: hh }, 201);
});

/** Edit a family: contact details and members (added, changed or removed). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const hid = z.uuid().parse(req.nextUrl.searchParams.get("hid"));
  const input = await body(req, householdSchema);
  await tenant(org.id, async (sql) => {
    const e = await loadEvent(sql, id);
    const h = normalizeHousehold(e, input);
    const [hh] = await sql`
      update event_households set church = ${h.church}, contact_name = ${h.contact_name},
        contact_phone = ${h.contact_phone}, contact_email = ${h.contact_email}
      where id = ${hid} and event_id = ${id} returning id`;
    if (!hh) throw new HttpError(404, "Registration not found");
    const keep = h.members.filter((m) => m.id).map((m) => m.id!);
    await sql`delete from event_registrants where household_id = ${hid} and not (id = any(${keep}))`;
    for (const m of h.members) {
      if (m.id) {
        const r = await sql`
          update event_registrants set full_name = ${m.full_name}, gender = ${m.gender}, age = ${m.age}, age_group = ${m.age_group}, days = ${m.days}::date[], relation = ${m.relation},
            phone = ${m.phone}, needs_bus = ${m.needs_bus}, answers = ${sql.json(m.answers as never)},
            -- a gender change can't keep a bed in a single-sex room
            room_id = case when gender <> ${m.gender} and not room_locked then null else room_id end,
            bed = case when gender <> ${m.gender} and not room_locked then null else bed end
          where id = ${m.id} and household_id = ${hid} returning id`;
        if (!r.length) throw new HttpError(404, "Person not found in this registration");
      } else {
        await sql`
          insert into event_registrants (event_id, household_id, full_name, gender, age, age_group, days, relation, phone, needs_bus, answers)
          values (${id}, ${hid}, ${m.full_name}, ${m.gender}, ${m.age}, ${m.age_group}, ${m.days}::date[], ${m.relation}, ${m.phone}, ${m.needs_bus}, ${sql.json(m.answers as never)})`;
      }
    }
  });
  return json({ ok: true });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const hid = z.uuid().parse(req.nextUrl.searchParams.get("hid"));
  const r = await tenant(org.id, (sql) => sql`delete from event_households where id = ${hid} and event_id = ${id} returning id`);
  if (!r.length) throw new HttpError(404, "Registration not found");
  return json({ ok: true });
});
