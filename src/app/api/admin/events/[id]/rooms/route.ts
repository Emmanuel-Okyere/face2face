import { z } from "zod";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

const fields = {
  building: z.string().trim().max(60).default(""),
  beds: z.number().int().min(1).max(200),
  gender: z.enum(["male", "female", "family"]),
  church: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  note: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
};

/** "1-12" → 1…12, "A, B, C" → A B C, "Room 1-3" → Room 1…Room 3. */
function expandNames(input: string) {
  const out: string[] = [];
  for (const part of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(.*?)(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const [a, b] = [Number(m[2]), Number(m[3])];
      if (b < a || b - a > 300) throw new HttpError(400, `“${part}” isn't a sensible range`);
      for (let i = a; i <= b; i++) out.push(`${m[1]}${i}`.trim());
    } else out.push(part);
  }
  if (!out.length) throw new HttpError(400, "Name at least one room");
  if (out.length > 300) throw new HttpError(400, "Up to 300 rooms at a time");
  return [...new Set(out)];
}

/** Add rooms in bulk: one building, a list or range of room names, same bed count. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const r = await body(req, z.object({ ...fields, names: z.string().trim().min(1).max(2000) }));
  const names = expandNames(r.names);
  const added = await tenant(org.id, async (sql) => {
    const [e] = await sql`select id from events where id = ${id}`;
    if (!e) throw new HttpError(404, "Event not found");
    let n = 0;
    for (const name of names) {
      const x = await sql`
        insert into event_rooms (event_id, building, name, gender, beds, church, note)
        values (${id}, ${r.building}, ${name.slice(0, 60)}, ${r.gender}, ${r.beds}, ${r.church}, ${r.note})
        on conflict (event_id, building, name) do nothing returning id`;
      n += x.length;
    }
    return n;
  });
  return json({ added, skipped: names.length - added }, 201);
});

/** Edit a room. Fewer beds or a different gender moves the people who no longer fit out (they become unassigned). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const rid = z.uuid().parse(req.nextUrl.searchParams.get("rid"));
  const r = await body(req, z.object({ ...fields, name: z.string().trim().min(1).max(60) }));
  const moved = await tenant(org.id, async (sql) => {
    const x = await sql`
      update event_rooms set building = ${r.building}, name = ${r.name}, gender = ${r.gender}, beds = ${r.beds}, church = ${r.church}, note = ${r.note}
      where id = ${rid} and event_id = ${id} returning id`;
    if (!x.length) throw new HttpError(404, "Room not found");
    const out = await sql`
      update event_registrants set room_id = null where room_id = ${rid}
        and (bed > ${r.beds} or (${r.gender} <> 'family' and gender <> ${r.gender}))
      returning id`;
    return out.length;
  });
  return json({ ok: true, moved });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const ids = (req.nextUrl.searchParams.get("rid") ?? "").split(",").filter(Boolean).map((x) => z.uuid().parse(x));
  if (!ids.length) throw new HttpError(400, "No room given");
  await tenant(org.id, (sql) => sql`delete from event_rooms where id = any(${ids}) and event_id = ${id}`);
  return json({ ok: true });
});
