import { z } from "zod";
import { logAttempt, matchDescriptor, recordCheckIn } from "@/lib/attendance";
import { getKiosk, verifyChallenge } from "@/lib/auth";
import { body, descriptorSchema, handle, HttpError, json } from "@/lib/http";
import { checkLiveness, livenessSchema, useNonce } from "@/lib/liveness-server";
import { rateLimit } from "@/lib/ratelimit";
import { serviceForCheckIn } from "@/lib/services";
import { loadOrg, tenant } from "@/lib/tenant";

const schema = z.object({ token: z.string().max(2000), descriptor: descriptorSchema, liveness: livenessSchema });

export const POST = handle(async (req) => {
  const kiosk = await getKiosk(req);
  if (!kiosk) throw new HttpError(401, "This device is not a paired kiosk");
  if (kiosk.paused) throw new HttpError(423, "This kiosk is paused by an admin");
  await rateLimit(`checkin:${kiosk.id}`, 40, 60);
  const org = await loadOrg({ id: kiosk.orgId });
  if (!org) throw new HttpError(401, "Kiosk organization no longer exists");
  const { token, descriptor, liveness } = await body(req, schema);

  return tenant(org.id, async (sql) => {
    const failLiveness = async (reason: string) => {
      await logAttempt(sql, org, { kioskId: kiosk.id, outcome: "liveness" });
      return json({ result: "liveness_failed", reason });
    };
    const ch = await verifyChallenge(token, kiosk.id);
    if (!ch) return failLiveness("Challenge expired — let's try again");
    const problem = checkLiveness(ch.steps, liveness);
    if (problem) return failLiveness(problem);
    if (!(await useNonce(ch.nonce))) return failLiveness("Challenge already used");

    const m = await matchDescriptor(sql, org, descriptor);
    if (m.status === "unknown") {
      await logAttempt(sql, org, { kioskId: kiosk.id, outcome: "unknown", distance: m.distance, candidate: m.best?.id });
      return json({ result: "unknown" });
    }
    if (m.status === "ambiguous") {
      await logAttempt(sql, org, { kioskId: kiosk.id, outcome: "ambiguous", distance: m.best.distance, margin: m.margin, candidate: m.best.id });
      return json({ result: "ambiguous" });
    }
    // Which service is this for? Nothing open → nothing recorded.
    const occ = await serviceForCheckIn(sql, org, m.person.id);
    if (!occ.service) return json({ result: "no_service", next: occ.next?.label ?? null });
    const occurrence = { serviceId: occ.service.id, serviceName: occ.service.name, day: occ.day, late: occ.late };
    const r = await recordCheckIn(sql, org, m.person.id, "face", occurrence, {
      distance: m.distance,
      margin: m.margin,
      kioskId: kiosk.id,
      liveness,
    });
    return json({ result: r.status, ...r });
  });
});
