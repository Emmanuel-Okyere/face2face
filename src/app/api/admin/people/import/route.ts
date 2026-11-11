import { z } from "zod";
import { body, handle, json, requireOrg } from "@/lib/http";
import { normalizeRef } from "@/lib/ids";
import { validatePerson } from "@/lib/person-fields";
import { tenant } from "@/lib/tenant";

// Bulk import. Each row is an object keyed by the organization's field keys
// (the browser maps CSV headers → fields by label), plus an optional `ref`.
//   • `ref` (platform ID)  → updates that existing person (only the columns given)
//   • else `code` matches  → updates that person
//   • else                 → creates a new person
// Every row is validated with the organization's own field rules.
const schema = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000) });

type Problem = { row: number; error: string };

export const POST = handle(async (req) => {
  const { org } = await requireOrg(req);
  const { rows } = await body(req, schema);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const problems: Problem[] = [];
  const seen = new Set<string>();

  await tenant(org.id, async (sql) => {
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNo = i + 2; // +1 header, +1 human counting
      const refRaw = typeof raw.ref === "string" ? raw.ref.trim() : "";
      const ref = refRaw ? normalizeRef(refRaw) : null;
      if (refRaw && !ref) {
        problems.push({ row: rowNo, error: `"${refRaw}" isn't a platform ID` });
        continue;
      }
      const codeRaw = typeof raw.code === "string" ? raw.code.trim() : "";
      const key = ref ? `r:${ref}` : codeRaw ? `c:${codeRaw}` : null;
      if (key && seen.has(key)) {
        skipped++;
        continue;
      }
      if (key) seen.add(key);

      const [existing] = ref
        ? await sql`select id from people where ref = ${ref}`
        : codeRaw
          ? await sql`select id from people where code = ${codeRaw}`
          : [];
      if (ref && !existing) {
        problems.push({ row: rowNo, error: `No person with platform ID ${ref}` });
        continue;
      }
      const { values: p, errors } = validatePerson(org.personFields, raw, { partial: !!existing });
      if (Object.keys(errors).length) {
        problems.push({ row: rowNo, error: Object.values(errors).join("; ") });
        continue;
      }
      const attrs = sql.json(Object.fromEntries(Object.entries(p.attributes ?? {}).filter(([, v]) => v !== null)) as never);
      try {
        await sql.savepoint(async (sp) => {
          if (existing) {
            const has = (k: string) => k in p;
            await sp`
              update people set
                full_name = case when ${has("full_name")} then ${p.full_name ?? null} else full_name end,
                code = case when ${has("code")} then ${p.code ?? null} else code end,
                group_name = case when ${has("group_name")} then ${p.group_name ?? null} else group_name end,
                email = case when ${has("email")} then ${p.email ?? null} else email end,
                phone = case when ${has("phone")} then ${p.phone ?? null} else phone end,
                attributes = attributes || ${attrs},
                updated_at = now()
              where id = ${existing.id}`;
            updated++;
          } else {
            await sp`
              insert into people (org_id, code, full_name, group_name, email, phone, attributes)
              values (${org.id}, ${p.code ?? null}, ${p.full_name!}, ${p.group_name ?? null}, ${p.email ?? null},
                      ${p.phone ?? null}, ${attrs})`;
            inserted++;
          }
        });
      } catch (e) {
        problems.push({ row: rowNo, error: (e as { code?: string }).code === "23505" ? "ID code already used by someone else" : "Couldn't save" });
      }
    }
  });
  return json({ inserted, updated, skipped, problems: problems.slice(0, 200), problemCount: problems.length });
});
