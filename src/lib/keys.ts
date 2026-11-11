// Shared by route handlers and proxy.ts (Node runtime). No "server-only" import
// so the proxy bundle can use it too; it is never imported by client code.
import { createHmac } from "node:crypto";
import { jwtVerify, type JWTPayload } from "jose";

export const ISSUER = "face2face";
export const AUD = {
  admin: "f2f:admin",
  kiosk: "f2f:kiosk",
  challenge: "f2f:challenge",
  selfCheck: "f2f:selfcheck",
} as const;

export type KeyPurpose = "admin-access" | "kiosk" | "challenge" | "qr" | "link";

const isProd = process.env.NODE_ENV === "production";
// __Host- cookies must be Secure, Path=/ and host-only: no subdomain can set or read them.
export const COOKIE = {
  access: isProd ? "__Host-f2f_at" : "f2f_at",
  refresh: isProd ? "__Host-f2f_rt" : "f2f_rt",
  kiosk: isProd ? "__Host-f2f_kiosk" : "f2f_kiosk",
  org: isProd ? "__Host-f2f_org" : "f2f_org", // which organization the admin is working in
} as const;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: isProd,
  sameSite: "strict" as const,
  path: "/",
  maxAge,
});

const cache = new Map<KeyPurpose, Uint8Array>();

/**
 * Key separation: every token type is signed with its own key derived from
 * AUTH_SECRET, so a token minted for one purpose can never verify as another.
 */
export function signingKey(purpose: KeyPurpose): Uint8Array {
  let k = cache.get(purpose);
  if (!k) {
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters");
    }
    k = new Uint8Array(createHmac("sha256", secret).update(`face2face/v1/${purpose}`).digest());
    cache.set(purpose, k);
  }
  return k;
}

/** Strict verification: pinned algorithm, issuer, audience and required claims. */
export async function verifyJwt<T extends JWTPayload>(
  token: string | undefined,
  purpose: KeyPurpose,
  audience: string,
): Promise<(T & { sub: string; exp: number; jti: string }) | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(purpose), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience,
      clockTolerance: 5,
      requiredClaims: ["sub", "exp", "iat", "jti"],
      typ: "JWT",
    });
    return payload as T & { sub: string; exp: number; jti: string };
  } catch {
    return null;
  }
}
