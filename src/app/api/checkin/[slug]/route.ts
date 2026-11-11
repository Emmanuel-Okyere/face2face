import { handle, HttpError, json } from "@/lib/http";
import { parseLinkToken } from "@/lib/qr";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth";
import { servicesNow } from "@/lib/services";
import { loadOrg, tenant, type Org } from "@/lib/tenant";
import { safeEqual } from "@/lib/selfcheck";

type Ctx = { params: Promise<{ slug: string }> };

/** Public: what the check-in page needs to render (org name; personal greeting for personal links). */
export const GET = handle<Ctx>(async (req, { params }) => {
  await rateLimit(`selfcheck:info:${clientIp(req)}`, 60, 600);
  const { slug } = await params;
  const org = await loadOrg({ slug: slug.toLowerCase() });
  const sp = req.nextUrl.searchParams;
  const k = sp.get("k");
  const p = sp.get("p");
  // Same answer for "no such org", "wrong key" and "disabled" → links can't be used to probe orgs.
  const bad = () => new HttpError(404, "This check-in link isn't valid. Ask your organization for a new one.");
  if (!org || !org.selfCheckin) throw bad();
  if (p) {
    const t = parseLinkToken(p);
    if (!t) throw bad();
    const [person] = await tenant(org.id, (sql) => sql`
      select full_name from people where id = ${t.personId} and qr_version = ${t.version} and active`);
    if (!person) throw bad();
    return json({ org: { name: org.name, logoUrl: org.logoUrl }, mode: "personal", firstName: person.full_name.split(/\s+/)[0], ...(await status(org)) });
  }
  if (!k || !safeEqual(k, org.checkinKey)) throw bad();
  const code = org.personFields.find((f) => f.key === "code" && f.enabled);
  return json({
    org: { name: org.name, logoUrl: org.logoUrl },
    mode: "shared",
    idLabel: code ? `${code.label} or platform ID` : "Platform ID",
    ...(await status(org)),
  });
});

/** Open service (if any), what's next, and whether the phone's location is needed. */
async function status(org: Org) {
  const { open, next } = await tenant(org.id, (sql) => servicesNow(sql, org));
  return {
    service: open[0]?.name ?? null,
    next: next?.label ?? null,
    locationRequired: org.geo.required && org.geo.lat !== null && org.geo.lng !== null,
  };
}
