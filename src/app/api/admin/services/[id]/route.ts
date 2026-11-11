import { z } from "zod";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { normalize, serviceSchema } from "@/lib/service-input";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/** Replace a service's settings. Past attendance keeps pointing at it. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const s = normalize(await body(req, serviceSchema));
  const [row] = await tenant(org.id, (sql) => sql`
    update services set name = ${s.name}, kind = ${s.kind}, weekdays = ${s.weekdays}, on_date = ${s.on_date},
      start_time = ${s.start_time}, end_time = ${s.end_time}, opens_before = ${s.opens_before},
      closes_after = ${s.closes_after}, late_after = ${s.late_after}, audience = ${s.audience}, active = ${s.active}
    where id = ${id} returning id`);
  if (!row) throw new HttpError(404, "Service not found");
  return json({ ok: true });
});

/** Delete a service that was never used; one with attendance history is archived instead. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const result = await tenant(org.id, async (sql) => {
    const [used] = await sql`select 1 from attendance where service_id = ${id} limit 1`;
    if (used) {
      const r = await sql`update services set active = false where id = ${id} returning id`;
      return r.length ? "archived" : null;
    }
    const r = await sql`delete from services where id = ${id} returning id`;
    return r.length ? "deleted" : null;
  });
  if (!result) throw new HttpError(404, "Service not found");
  return json({ result });
});
