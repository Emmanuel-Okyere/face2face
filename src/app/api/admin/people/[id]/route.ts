import { z } from "zod";
import { removeBlobs } from "@/lib/avatars";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { validatePerson } from "@/lib/person-fields";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };
const uuid = z.uuid();

export const GET = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = uuid.parse((await params).id);
  return tenant(org.id, async (sql) => {
    const [person] = await sql`
      select id, ref, code, full_name, group_name, email, phone, attributes, avatar_url as avatar, active, consent_at, qr_version, created_at
      from people where id = ${id}`;
    if (!person) throw new HttpError(404, "Not found");
    const embeddings = await sql`
      select id, quality, pose, created_at from face_embeddings where person_id = ${id} order by id`;
    const history = await sql`
      select a.id, a.day::text as day, a.checked_in_at, a.method::text as method, a.distance, a.note, a.late, s.name as service
      from attendance a join services s on s.id = a.service_id
      where a.person_id = ${id} order by a.day desc, a.checked_in_at desc limit 60`;
    return json({ person, embeddings, history });
  });
});

/** Edit: only the keys sent are validated/changed (against the org's fields); `active` toggles. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = uuid.parse((await params).id);
  const raw = await body(req, z.record(z.string(), z.unknown()));
  const active = typeof raw.active === "boolean" ? raw.active : null;
  const { values: p, errors } = validatePerson(org.personFields, raw, { partial: true });
  if (Object.keys(errors).length) return json({ error: Object.values(errors)[0], fieldErrors: errors }, 422);
  const has = (k: string) => k in p;
  const attrs = p.attributes ?? {};
  try {
    const [row] = await tenant(org.id, (sql) => sql`
      update people set
        full_name = case when ${has("full_name")} then ${p.full_name ?? null} else full_name end,
        code = case when ${has("code")} then ${p.code ?? null} else code end,
        group_name = case when ${has("group_name")} then ${p.group_name ?? null} else group_name end,
        email = case when ${has("email")} then ${p.email ?? null} else email end,
        phone = case when ${has("phone")} then ${p.phone ?? null} else phone end,
        -- merge custom values; a null clears that one value
        attributes = jsonb_strip_nulls(attributes || ${sql.json(attrs as never)}),
        active = coalesce(${active}, active),
        updated_at = now()
      where id = ${id} returning id`);
    if (!row) throw new HttpError(404, "Not found");
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return json({ error: "That ID code is already in use", fieldErrors: { code: "Already in use" } }, 409);
    }
    throw e;
  }
  return json({ ok: true });
});

/** Right to erasure: removes the person, their embeddings, photo and attendance. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = uuid.parse((await params).id);
  const [gone] = await tenant(org.id, (sql) => sql`delete from people where id = ${id} returning avatar_key`);
  if (gone?.avatar_key) await removeBlobs([gone.avatar_key]);
  return json({ ok: true });
});
