import { randomBytes } from "node:crypto";
import { getKiosk, signChallenge } from "@/lib/auth";
import { config } from "@/lib/config";
import { handle, HttpError, json } from "@/lib/http";
import { pickSteps } from "@/lib/liveness-server";
import { rateLimit } from "@/lib/ratelimit";
import { servicesNow } from "@/lib/services";
import { loadOrg, tenant } from "@/lib/tenant";

/** Server-chosen random liveness challenge, signed so the kiosk can't pick its own. */
export const GET = handle(async (req) => {
  const kiosk = await getKiosk(req);
  if (!kiosk) throw new HttpError(401, "This device is not a paired kiosk");
  if (kiosk.paused) throw new HttpError(423, "This kiosk is paused by an admin");
  await rateLimit(`challenge:${kiosk.id}`, 40, 60);
  // Don't start a face check when no service is open.
  const org = await loadOrg({ id: kiosk.orgId });
  if (!org) throw new HttpError(401, "Kiosk organization no longer exists");
  const { open, next } = await tenant(org.id, (sql) => servicesNow(sql, org));
  if (!open.length) return json({ error: "No service is open right now", code: "no_service", next: next?.label ?? null }, 409);
  const steps = pickSteps();
  const nonce = randomBytes(16).toString("base64url");
  const token = await signChallenge(kiosk.id, { nonce, steps }, config.challengeTtl);
  return json({ token, steps, ttl: config.challengeTtl }, { headers: { "cache-control": "no-store" } });
});
