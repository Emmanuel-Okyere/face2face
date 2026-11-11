import { z } from "zod";
import { db } from "@/lib/db";
import { body, handle, HttpError, json, requireOrg } from "@/lib/http";
import { BUILTIN_KEYS, checkFieldDefs, FIELD_TYPES, resolveFields, type FieldDef } from "@/lib/person-fields";

/** The person fields this organization collects (any admin can read; forms need them). */
export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  return json({ fields: org.personFields });
});

const fieldSchema = z.object({
  key: z.string().min(1).max(20),
  label: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  enabled: z.boolean(),
  required: z.boolean(),
  showInList: z.boolean(),
  options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  defaultCountry: z.string().regex(/^[A-Z]{2}$/).optional().nullable(),
  help: z.string().trim().max(160).optional().nullable(),
});

/** Replace the field list (owners only). Order in the array = order on forms. */
export const PUT = handle(async (req) => {
  const { org } = await requireOrg(req, { owner: true });
  const { fields } = await body(req, z.object({ fields: z.array(fieldSchema).min(1).max(40) }));
  const clean: FieldDef[] = fields.map((f) => ({
    ...f,
    builtin: (BUILTIN_KEYS as readonly string[]).includes(f.key),
    options: f.type === "select" || f.key === "group_name" ? f.options?.filter(Boolean) : undefined,
    defaultCountry: f.type === "phone" ? f.defaultCountry || undefined : undefined,
    help: f.help || undefined,
  }));
  const problem = checkFieldDefs(clean);
  if (problem) throw new HttpError(400, problem);
  const resolved = resolveFields(clean); // re-applies built-in rules (name always required, fixed types)
  const sql = db();
  // sql.json → a real jsonb array (JSON.stringify would store a jsonb *string*).
  await sql`update organizations set person_fields = ${sql.json(resolved as never)} where id = ${org.id}`;
  return json({ fields: resolved });
});
