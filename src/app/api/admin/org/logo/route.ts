import { z } from "zod";
import { body, handle, json, requireOrg } from "@/lib/http";
import { clearLogo, decodeLogo, saveLogo } from "@/lib/logos";
import { rateLimit } from "@/lib/ratelimit";
import { loadOrg } from "@/lib/tenant";

const schema = z.object({ dataUrl: z.string().max(420_000) }); // ≈300 KB once base64-decoded

/** Upload / replace the organization's logo (owners only). */
export const PUT = handle(async (req) => {
  const { org } = await requireOrg(req, { owner: true });
  await rateLimit(`logo:${org.id}`, 20, 3600);
  const { dataUrl } = await body(req, schema);
  await saveLogo(org.id, decodeLogo(dataUrl));
  const fresh = await loadOrg({ id: org.id });
  return json({ logoUrl: fresh?.logoUrl ?? null });
});

/** Remove it → back to the default logo. */
export const DELETE = handle(async (req) => {
  const { org } = await requireOrg(req, { owner: true });
  await clearLogo(org.id);
  return json({ logoUrl: null });
});
