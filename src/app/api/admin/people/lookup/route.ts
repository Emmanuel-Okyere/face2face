import { z } from "zod";
import { body, handle, json, requireOrg } from "@/lib/http";
import { normalizeRef } from "@/lib/ids";
import { tenant } from "@/lib/tenant";

const schema = z.object({ codes: z.array(z.string().trim().min(1).max(64)).min(1).max(5000) });

/**
 * Resolve keys → people for bulk photo enrollment. A key can be the
 * organization's own code or a platform ID (any case, dash optional).
 * Returns the matched person per key.
 */
export const POST = handle(async (req) => {
  const { org } = await requireOrg(req);
  const { codes } = await body(req, schema);
  const refs = codes.map(normalizeRef).filter((r): r is string => !!r);
  const rows = await tenant(org.id, (sql) => sql`
    select p.id, p.ref, p.code, p.full_name,
      (select count(*)::int from face_embeddings e where e.person_id = p.id) as embeddings
    from people p
    where p.org_id = ${org.id} and (p.code = any(${codes}::text[]) or p.ref = any(${refs}::text[]))`);
  const matches: Record<string, (typeof rows)[number]> = {};
  for (const key of codes) {
    // Org code wins over a platform ID that happens to look the same.
    const m = rows.find((r) => r.code === key) ?? rows.find((r) => r.ref === normalizeRef(key));
    if (m) matches[key] = m;
  }
  return json({ matches });
});
