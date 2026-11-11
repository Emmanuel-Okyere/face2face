import { z } from "zod";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const kiosks = await tenant(org.id, (sql) => sql`
    select k.id, k.name, k.location, k.allow_qr, k.voice_default, k.paused, k.created_at, k.last_seen_at, k.revoked_at, a.name as created_by,
      (select count(*)::int from attendance x where x.kiosk_id = k.id) as checkins
    from kiosks k left join admins a on a.id = k.created_by
    where k.org_id = ${org.id}
    order by k.revoked_at nulls first, k.created_at desc`);
  return json({ kiosks });
});

export const DELETE = handle(async (req) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse(req.nextUrl.searchParams.get("id"));
  await tenant(org.id, (sql) => sql`update kiosks set revoked_at = now() where id = ${id} and revoked_at is null`);
  return json({ ok: true });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  allowQr: z.boolean().optional(),
  voiceDefault: z.boolean().optional(),
  paused: z.boolean().optional(),
});

/** Edit a kiosk. Kiosks pick changes up on their next poll (about a minute). */
export const PATCH = handle(async (req) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse(req.nextUrl.searchParams.get("id"));
  const p = await body(req, patchSchema);
  const [k] = await tenant(org.id, (sql) => sql`
    update kiosks set
      name = coalesce(${p.name ?? null}, name),
      location = case when ${p.location !== undefined} then ${p.location || null} else location end,
      allow_qr = coalesce(${p.allowQr ?? null}, allow_qr),
      voice_default = coalesce(${p.voiceDefault ?? null}, voice_default),
      paused = coalesce(${p.paused ?? null}, paused)
    where id = ${id} and revoked_at is null
    returning id`);
  if (!k) throw new HttpError(404, "Kiosk not found (or revoked)");
  return json({ ok: true });
});
