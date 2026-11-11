import { z } from "zod";
import { logAttempt, matchDescriptor, recordCheckIn } from "@/lib/attendance";
import { clientIp, verifySelfChallenge } from "@/lib/auth";
import { body, descriptorSchema, handle, HttpError, json } from "@/lib/http";
import { checkLiveness, livenessSchema, useNonce } from "@/lib/liveness-server";
import { rateLimit } from "@/lib/ratelimit";
import { serviceForCheckIn } from "@/lib/services";
import { loadOrg, tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

const schema = z.object({ token: z.string().max(2000), descriptor: descriptorSchema, liveness: livenessSchema });

/**
 * Public step 2: liveness proof + face. The face must match the CLAIMED person
 * (1:1) *and* that person must be the org's best match with a clear margin
 * (1:N) — so a lookalike colleague can't check someone else in.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const ip = clientIp(req);
  await rateLimit(`selfcheck:verify:ip:${ip}`, 30, 600);
  const { slug } = await params;
  const org = await loadOrg({ slug: slug.toLowerCase() });
  if (!org || !org.selfCheckin) throw new HttpError(404, "This check-in link isn't valid");
  const { token, descriptor, liveness } = await body(req, schema);

  return tenant(org.id, async (sql) => {
    const fail = async (outcome: string, result: string, reason?: string, extra: { distance?: number | null; candidate?: string | null } = {}) => {
      await logAttempt(sql, org, { outcome, ...extra });
      return json({ result, reason });
    };
    const ch = await verifySelfChallenge(token, org.id);
    if (!ch) return fail("liveness", "liveness_failed", "Challenge expired — let's try again");
    const problem = checkLiveness(ch.steps, liveness);
    if (problem) return fail("liveness", "liveness_failed", problem);
    if (!(await useNonce(ch.nonce))) return fail("liveness", "liveness_failed", "Challenge already used");

    const m = await matchDescriptor(sql, org, descriptor);
    if (m.status !== "match" || m.person.id !== ch.sub) {
      const best = m.status === "match" ? m.person : m.best;
      return fail("link_mismatch", "not_you", "That doesn't look like the person this link belongs to.", {
        distance: best?.distance ?? null,
        candidate: ch.sub,
      });
    }
    const occ = await serviceForCheckIn(sql, org, ch.sub);
    if (!occ.service) return json({ result: "no_service", reason: occ.next ? `No service is open right now. Next: ${occ.next.label}.` : "No service is open right now." });
    const occurrence = { serviceId: occ.service.id, serviceName: occ.service.name, day: occ.day, late: occ.late };
    const r = await recordCheckIn(sql, org, ch.sub, "link", occurrence, {
      distance: m.distance,
      margin: m.margin,
      liveness: { ...liveness, ip, ua: (req.headers.get("user-agent") || "").slice(0, 200) },
    });
    return json({ result: r.status, ...r, org: org.name });
  });
});
