import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { AUD, COOKIE, cookieOptions, ISSUER, signingKey, verifyJwt, type KeyPurpose } from "./keys";

// ── Lifetimes ────────────────────────────────────────────────────────────────
export const ACCESS_TTL = 10 * 60; // 10 min access JWT
export const REFRESH_TTL = 7 * 24 * 3600; // 7 day absolute session lifetime
const IDLE_TTL_SQL = "12 hours"; // session dies if unused this long
const ROTATION_GRACE_MS = 15_000; // parallel tabs refreshing at once aren't treated as theft
const KIOSK_TTL = 365 * 24 * 3600; // revocable server-side at any time

export type AdminSession = {
  id: string;
  email: string;
  name: string;
  sid: string;
  isPlatform: boolean;
  mustChangePassword: boolean;
};
export type KioskSession = {
  id: string;
  name: string;
  orgId: string;
  location: string | null;
  allowQr: boolean;
  voiceDefault: boolean;
  paused: boolean;
};

export async function signJwt(
  purpose: KeyPurpose,
  audience: string,
  subject: string,
  ttlSeconds: number,
  claims: Record<string, unknown> = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setSubject(subject)
    .setJti(randomUUID())
    .setIssuedAt()
    .setNotBefore("0s")
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(signingKey(purpose));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function safeEqualHex(a: string, b: string) {
  const A = Buffer.from(a, "hex");
  const B = Buffer.from(b, "hex");
  return A.length === B.length && timingSafeEqual(A, B);
}

export function clientIp(req: NextRequest) {
  // On Vercel the platform overwrites x-forwarded-for; elsewhere put a trusted proxy in front.
  return (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

// ── Admin sessions ──────────────────────────────────────────────────────────

async function setAccessCookie(res: NextResponse, adminId: string, sid: string, tokenVersion: number, mustChange: boolean) {
  // `pwc` only steers the UI (proxy redirect); the API re-checks the DB flag.
  const at = await signJwt("admin-access", AUD.admin, adminId, ACCESS_TTL, { sid, tv: tokenVersion, ...(mustChange ? { pwc: true } : {}) });
  res.cookies.set(COOKIE.access, at, cookieOptions(ACCESS_TTL));
}

/** Start a new session after a successful login. */
export async function createSession(res: NextResponse, req: NextRequest, adminId: string, tokenVersion: number, mustChange = false) {
  const secret = randomBytes(32).toString("base64url");
  const [s] = await db()`
    insert into admin_sessions (admin_id, refresh_hash, token_version, expires_at, ip, user_agent)
    values (${adminId}, ${sha256(secret)}, ${tokenVersion}, now() + make_interval(secs => ${REFRESH_TTL}),
            ${clientIp(req)}, ${(req.headers.get("user-agent") || "").slice(0, 300)})
    returning id`;
  res.cookies.set(COOKIE.refresh, `${s.id}.${secret}`, cookieOptions(REFRESH_TTL));
  await setAccessCookie(res, adminId, s.id, tokenVersion, mustChange);
  return s.id as string;
}

function parseRefresh(req: NextRequest) {
  const raw = req.cookies.get(COOKIE.refresh)?.value;
  const m = raw?.match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/);
  return m ? { sid: m[1], hash: sha256(m[2]) } : null;
}

export type RefreshResult = { ok: true } | { ok: false; reason: string };

/**
 * Refresh-token rotation with reuse detection (OAuth 2.0 Security BCP §4.14):
 * every refresh swaps in a new token; presenting the *previous* token outside a
 * short grace window means it was stolen, so the whole session is revoked.
 */
export async function rotateSession(req: NextRequest, res: NextResponse): Promise<RefreshResult> {
  const rt = parseRefresh(req);
  if (!rt) return { ok: false, reason: "no_session" };
  const sql = db();
  const [s] = await sql`
    select s.id, s.admin_id, s.refresh_hash, s.prev_hash, s.rotated_at, s.token_version,
      extract(epoch from (s.expires_at - now()))::int as remaining,
      (s.revoked_at is not null or s.expires_at < now()
        or s.last_used_at < now() - ${IDLE_TTL_SQL}::interval
        or s.token_version <> a.token_version) as dead,
      a.token_version as admin_tv, a.must_change_password
    from admin_sessions s join admins a on a.id = s.admin_id
    where s.id = ${rt.sid}`;
  if (!s || s.dead) return { ok: false, reason: "expired" };

  if (safeEqualHex(rt.hash, s.refresh_hash)) {
    const secret = randomBytes(32).toString("base64url");
    // Compare-and-swap so two concurrent rotations can't both win.
    const swapped = await sql`
      update admin_sessions set prev_hash = refresh_hash, refresh_hash = ${sha256(secret)},
        rotated_at = now(), last_used_at = now()
      where id = ${s.id} and refresh_hash = ${rt.hash} and revoked_at is null
      returning id`;
    if (!swapped.length) return { ok: false, reason: "race" };
    // Cookie never outlives the session's absolute expiry.
    res.cookies.set(COOKIE.refresh, `${s.id}.${secret}`, cookieOptions(Math.max(1, s.remaining)));
    await setAccessCookie(res, s.admin_id, s.id, s.admin_tv, s.must_change_password);
    return { ok: true };
  }

  if (s.prev_hash && safeEqualHex(rt.hash, s.prev_hash)) {
    const recent = s.rotated_at && Date.now() - new Date(s.rotated_at).getTime() < ROTATION_GRACE_MS;
    if (recent) {
      // Another tab just rotated; its Set-Cookie already holds the new refresh token.
      await setAccessCookie(res, s.admin_id, s.id, s.admin_tv, s.must_change_password);
      return { ok: true };
    }
    await sql`update admin_sessions set revoked_at = now(), revoke_reason = 'refresh_token_reuse' where id = ${s.id}`;
    console.warn(`[auth] refresh token reuse detected; session ${s.id} revoked`);
    return { ok: false, reason: "reuse" };
  }
  return { ok: false, reason: "invalid" };
}

export async function revokeCurrentSession(req: NextRequest, reason = "logout") {
  const rt = parseRefresh(req);
  const at = await verifyJwt<{ sid: string }>(req.cookies.get(COOKIE.access)?.value, "admin-access", AUD.admin);
  const sid = rt?.sid ?? at?.sid;
  if (!sid) return;
  if (rt) {
    await db()`
      update admin_sessions set revoked_at = now(), revoke_reason = ${reason}
      where id = ${sid} and revoked_at is null and (refresh_hash = ${rt.hash} or prev_hash = ${rt.hash})`;
  } else if (at) {
    await db()`update admin_sessions set revoked_at = now(), revoke_reason = ${reason} where id = ${sid} and admin_id = ${at.sub} and revoked_at is null`;
  }
}

export function clearAuthCookies(res: NextResponse) {
  res.cookies.set(COOKIE.access, "", cookieOptions(0));
  res.cookies.set(COOKIE.refresh, "", cookieOptions(0));
}

/** Validates the access JWT *and* that its session and token version are still live. */
export async function getAdmin(req: NextRequest): Promise<AdminSession | null> {
  const p = await verifyJwt<{ sid: string; tv: number }>(req.cookies.get(COOKIE.access)?.value, "admin-access", AUD.admin);
  if (!p || typeof p.sid !== "string" || typeof p.tv !== "number") return null;
  const [row] = await db()`
    select a.id, a.email, a.name, a.is_platform_admin, a.must_change_password
    from admin_sessions s join admins a on a.id = s.admin_id
    where s.id = ${p.sid} and s.admin_id = ${p.sub}
      and s.revoked_at is null and s.expires_at > now()
      and a.token_version = ${p.tv} and s.token_version = a.token_version`;
  return row
    ? { id: row.id, email: row.email, name: row.name, sid: p.sid, isPlatform: row.is_platform_admin, mustChangePassword: row.must_change_password }
    : null;
}

// ── Kiosks ──────────────────────────────────────────────────────────────────

export async function setKioskCookie(res: NextResponse, kiosk: { id: string }) {
  const token = await signJwt("kiosk", AUD.kiosk, kiosk.id, KIOSK_TTL);
  res.cookies.set(COOKIE.kiosk, token, cookieOptions(KIOSK_TTL));
}

export async function getKiosk(req: NextRequest): Promise<KioskSession | null> {
  const p = await verifyJwt(req.cookies.get(COOKIE.kiosk)?.value, "kiosk", AUD.kiosk);
  if (!p) return null;
  const [row] = await db()`
    update kiosks set last_seen_at = now()
    where id = ${p.sub} and revoked_at is null
    returning id, name, org_id, location, allow_qr, voice_default, paused`;
  return row
    ? {
        id: row.id,
        name: row.name,
        orgId: row.org_id,
        location: row.location,
        allowQr: row.allow_qr,
        voiceDefault: row.voice_default,
        paused: row.paused,
      }
    : null;
}

// ── Liveness challenges ─────────────────────────────────────────────────────

export type Challenge = { nonce: string; steps: string[] };

export function signChallenge(kioskId: string, c: Challenge, ttl: number) {
  return signJwt("challenge", AUD.challenge, kioskId, ttl, c);
}

/** Self check-in challenge: bound to one person in one org. */
export function signSelfChallenge(orgId: string, personId: string, c: Challenge, ttl: number) {
  return signJwt("challenge", AUD.selfCheck, personId, ttl, { ...c, org: orgId });
}

export async function verifySelfChallenge(token: string, orgId: string) {
  const p = await verifyJwt<Challenge & { org: string }>(token, "challenge", AUD.selfCheck);
  if (!p || p.org !== orgId || typeof p.nonce !== "string" || !Array.isArray(p.steps)) return null;
  return p; // p.sub = personId
}

export async function verifyChallenge(token: string, kioskId: string) {
  const p = await verifyJwt<Challenge>(token, "challenge", AUD.challenge);
  if (!p || p.sub !== kioskId || typeof p.nonce !== "string" || !Array.isArray(p.steps)) return null;
  return p;
}
