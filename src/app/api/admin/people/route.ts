import { body, handle, json, requireOrg } from "@/lib/http";
import { z } from "zod";
import { displayValue, enabledFields, validatePerson } from "@/lib/person-fields";
import { tenant, todayIn } from "@/lib/tenant";

const PAGE = 50;

export const GET = handle(async (req) => {
  const { org } = await requireOrg(req);
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const status = sp.get("status") || "all"; // all | enrolled | pending
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const today = todayIn(org.timeZone);
  // "024 123 4567" should find +233241234567: drop the local trunk 0.
  const phoneDigits = q.replace(/\D/g, "").replace(/^0+/, "");

  if (sp.get("format") === "csv") {
    // Everyone, with platform IDs — edit and re-import to update (platform_id column).
    const all = await tenant(org.id, (sql) => sql`
      select p.ref, p.code, p.full_name, p.group_name, p.email, p.phone, p.attributes, p.active,
        exists (select 1 from face_embeddings e where e.person_id = p.id) as enrolled
      from people p where p.org_id = ${org.id} order by p.full_name`);
    const fields = enabledFields(org.personFields);
    const cell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    // Columns follow the organization's own fields (labels as headers) — re-importable as-is.
    const lines = [
      ["platform_id", ...fields.map((f) => f.label), "active", "face_enrolled"].map(cell).join(","),
      ...all.map((r) =>
        [
          r.ref,
          ...fields.map((f) => {
            const v = f.builtin ? r[f.key] : r.attributes?.[f.key];
            return f.type === "phone" ? displayValue(f, v) : f.type === "yesno" ? displayValue(f, v) : v;
          }),
          r.active,
          r.enrolled,
        ]
          .map(cell)
          .join(","),
      ),
    ];
    return new Response(lines.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${org.slug}_people.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const rows = await tenant(org.id, (sql) => {
    const where = sql`and`.join([
      sql`p.org_id = ${org.id}`,
      !!q &&
        sql`(p.full_name ilike ${"%" + q + "%"} or p.code ilike ${"%" + q + "%"} or p.group_name ilike ${"%" + q + "%"}
          or p.email ilike ${"%" + q + "%"} or p.attributes::text ilike ${"%" + q + "%"}
          or replace(p.ref, '-', '') ilike ${"%" + q.toUpperCase().replace(/[\s-]/g, "") + "%"}
          ${phoneDigits.length >= 4 ? sql`or p.phone like ${"%" + phoneDigits + "%"}` : sql``})`,
      status === "enrolled" && sql`exists (select 1 from face_embeddings e where e.person_id = p.id)`,
      status === "pending" && sql`not exists (select 1 from face_embeddings e where e.person_id = p.id)`,
    ]);
    return sql`
      select p.id, p.ref, p.code, p.full_name, p.group_name, p.email, p.phone, p.attributes, p.avatar_url as avatar, p.active, p.created_at,
        (select count(*)::int from face_embeddings e where e.person_id = p.id) as embeddings,
        (select a.checked_in_at from attendance a where a.person_id = p.id and a.day = ${today}::date) as today_at,
        count(*) over()::int as total
      from people p
      where ${where}
      order by p.full_name
      limit ${PAGE} offset ${(page - 1) * PAGE}`;
  });

  return json({ people: rows.map(omitTotal), total: rows[0]?.total ?? 0, page, pageSize: PAGE });
});

/** Create a person from the organization's own fields. */
export const POST = handle(async (req) => {
  const { org } = await requireOrg(req);
  const raw = await body(req, z.record(z.string(), z.unknown()));
  const { values: p, errors } = validatePerson(org.personFields, raw);
  if (Object.keys(errors).length) return json({ error: Object.values(errors)[0], fieldErrors: errors }, 422);
  try {
    const [row] = await tenant(org.id, (sql) => sql`
      insert into people (org_id, code, full_name, group_name, email, phone, attributes)
      values (${org.id}, ${p.code ?? null}, ${p.full_name!}, ${p.group_name ?? null}, ${p.email ?? null},
              ${p.phone ?? null}, ${sql.json(stripNulls(p.attributes ?? {}) as never)})
      returning id, ref, code, full_name`);
    return json({ person: row }, 201);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return json({ error: `ID code "${p.code}" is already in use`, fieldErrors: { code: "Already in use" } }, 409);
    }
    throw e;
  }
});

function stripNulls(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

function omitTotal<T extends { total?: unknown }>(r: T) {
  const out = { ...r };
  delete out.total;
  return out;
}
