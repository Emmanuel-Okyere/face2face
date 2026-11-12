import { z } from "zod";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  seats: z.number().int().min(1).max(120),
  churches: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  pickup: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  departs: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  driver: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  count: z.number().int().min(1).max(50).default(1), // add several identical buses: "Bus 1" … "Bus 5"
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const b = await body(req, schema);
  const added = await tenant(org.id, async (sql) => {
    const [e] = await sql`select id from events where id = ${id}`;
    if (!e) throw new HttpError(404, "Event not found");
    const existing = new Set((await sql`select name from event_buses where event_id = ${id}`).map((x) => x.name as string));
    let n = 0;
    for (let i = 1; n < b.count && i < 1000; i++) {
      const name = b.count === 1 && !existing.has(b.name) ? b.name : `${b.name} ${i}`;
      if (existing.has(name)) continue;
      await sql`
        insert into event_buses (event_id, name, seats, churches, pickup, departs, driver)
        values (${id}, ${name}, ${b.seats}, ${b.churches}, ${b.pickup}, ${b.departs}, ${b.driver})`;
      existing.add(name);
      n++;
    }
    return n;
  });
  return json({ added }, 201);
});

/** Edit a bus. Fewer seats, or no longer serving a church, frees the seats that don't fit. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const bid = z.uuid().parse(req.nextUrl.searchParams.get("bid"));
  const b = await body(req, schema.omit({ count: true }));
  const moved = await tenant(org.id, async (sql) => {
    const x = await sql`
      update event_buses set name = ${b.name}, seats = ${b.seats}, churches = ${b.churches}, pickup = ${b.pickup}, departs = ${b.departs}, driver = ${b.driver}
      where id = ${bid} and event_id = ${id} returning id`;
    if (!x.length) throw new HttpError(404, "Bus not found");
    const out = await sql`
      update event_registrants r set bus_id = null
      from event_households h
      where r.bus_id = ${bid} and h.id = r.household_id
        and (r.seat > ${b.seats} or (cardinality(${b.churches}::text[]) > 0 and not (h.church = any(${b.churches}::text[]))))
      returning r.id`;
    return out.length;
  });
  return json({ ok: true, moved });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const bid = z.uuid().parse(req.nextUrl.searchParams.get("bid"));
  await tenant(org.id, (sql) => sql`delete from event_buses where id = ${bid} and event_id = ${id}`);
  return json({ ok: true });
});

/** A new captain link for a bus; the old one stops working at once. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const bid = z.uuid().parse(req.nextUrl.searchParams.get("bid"));
  const [b] = await tenant(org.id, (sql) => sql`
    update event_buses set captain_token = replace(gen_random_uuid()::text, '-', '')
    where id = ${bid} and event_id = ${id} returning captain_token`);
  if (!b) throw new HttpError(404, "Bus not found");
  return json({ token: b.captain_token });
});
