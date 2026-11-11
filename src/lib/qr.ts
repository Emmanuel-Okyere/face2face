import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { signingKey } from "./keys";

// Badge payload: F2F1.<personId>.<version>.<sig>
// HMAC (own derived key) binds person + badge version, so badges can't be forged
// from a guessed ID, and bumping people.qr_version revokes a lost badge.

function sign(personId: string, version: number) {
  return createHmac("sha256", Buffer.from(signingKey("qr")))
    .update(`qr:${personId}:${version}`)
    .digest("base64url")
    .slice(0, 22);
}

export function makeBadgeToken(personId: string, version: number) {
  return `F2F1.${personId}.${version}.${sign(personId, version)}`;
}

export function parseBadgeToken(token: string): { personId: string; version: number } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "F2F1") return null;
  const [, personId, v, sig] = parts;
  const version = Number(v);
  if (!/^[0-9a-f-]{36}$/i.test(personId) || !Number.isInteger(version)) return null;
  const expected = Buffer.from(sign(personId, version));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { personId, version };
}

// Personal self check-in link token. Separate key from badges, so a shared link
// can't be printed as a QR badge (which skips the face check) and vice versa.
function signLink(personId: string, version: number) {
  return createHmac("sha256", Buffer.from(signingKey("link")))
    .update(`link:${personId}:${version}`)
    .digest("base64url")
    .slice(0, 22);
}

export function makeLinkToken(personId: string, version: number) {
  return `${personId}.${version}.${signLink(personId, version)}`;
}

export function parseLinkToken(token: string): { personId: string; version: number } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [personId, v, sig] = parts;
  const version = Number(v);
  if (!/^[0-9a-f-]{36}$/i.test(personId) || !Number.isInteger(version)) return null;
  const expected = Buffer.from(signLink(personId, version));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { personId, version };
}
