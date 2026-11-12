import { z } from "zod";
import { insightSchema } from "@/lib/camp/insight-spec";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/** Saved insights for this event, in the team's chosen order. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const insights = await tenant(org.id, (sql) => sql`
    select i.id, i.name, i.spec, i.position, i.created_at, a.name as created_by
    from event_insights i left join admins a on a.id = i.created_by
    where i.event_id = ${id} order by i.position, i.created_at`);
  return json({ insights });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { admin, org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const i = await body(req, insightSchema);
  const [row] = await tenant(org.id, async (sql) => {
    const [e] = await sql`select id from events where id = ${id}`;
    if (!e) throw new HttpError(404, "Event not found");
    const [{ n }] = await sql`select count(*)::int as n from event_insights where event_id = ${id}`;
    if (n >= 40) throw new HttpError(400, "Up to 40 saved insights per event");
    return sql`
      insert into event_insights (event_id, name, spec, position, created_by)
      values (${id}, ${i.name}, ${sql.json(i.spec as never)}, ${n}, ${admin.id}) returning id`;
  });
  return json({ id: row.id }, 201);
});

/** Edit (name/spec) or move (position) a saved insight. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const iid = z.uuid().parse(req.nextUrl.searchParams.get("iid"));
  const p = await body(req, insightSchema.partial().extend({ position: z.number().int().min(0).max(100).optional() }));
  const r = await tenant(org.id, (sql) => sql`
    update event_insights set
      name = coalesce(${p.name ?? null}, name),
      spec = coalesce(${p.spec ? sql.json(p.spec as never) : null}::jsonb, spec),
      position = coalesce(${p.position ?? null}, position)
    where id = ${iid} and event_id = ${id} returning id`);
  if (!r.length) throw new HttpError(404, "Insight not found");
  return json({ ok: true });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const iid = z.uuid().parse(req.nextUrl.searchParams.get("iid"));
  await tenant(org.id, (sql) => sql`delete from event_insights where id = ${iid} and event_id = ${id}`);
  return json({ ok: true });
});
