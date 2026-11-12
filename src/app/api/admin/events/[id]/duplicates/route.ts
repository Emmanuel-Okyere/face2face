import { z } from "zod";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

/** Mark two people as "not the same person" so they stop showing as a possible duplicate. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const { a, b } = await body(req, z.object({ a: z.uuid(), b: z.uuid() }));
  const pair = [a, b].sort().join("|");
  const r = await tenant(org.id, (sql) => sql`
    update events set duplicates_ignored = array_append(duplicates_ignored, ${pair})
    where id = ${id} and not (${pair} = any(duplicates_ignored)) and cardinality(duplicates_ignored) < 5000
    returning id`);
  if (!r.length) {
    const [e] = await tenant(org.id, (sql) => sql`select id from events where id = ${id}`);
    if (!e) throw new HttpError(404, "Event not found");
  }
  return json({ ok: true });
});
