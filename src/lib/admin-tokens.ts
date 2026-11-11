import "server-only";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "./db";
import { appOrigin, mails } from "./mail";

export const INVITE_HOURS = 72;
export const RESET_MINUTES = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A password nobody knows, for accounts that will set theirs from an invite link. */
export async function unusablePasswordHash() {
  return bcrypt.hash(randomBytes(32).toString("base64url"), 12);
}

/** Issue a one-time token, replacing any earlier unused one of the same kind. Returns the raw token (only ever emailed). */
export async function issueToken(adminId: string, purpose: "invite" | "reset") {
  const token = randomBytes(32).toString("base64url");
  const ttl = purpose === "invite" ? INVITE_HOURS * 3600 : RESET_MINUTES * 60;
  const sql = db();
  await sql`delete from admin_tokens where admin_id = ${adminId} and (purpose = ${purpose} or expires_at < now())`;
  await sql`
    insert into admin_tokens (admin_id, token_hash, purpose, expires_at)
    values (${adminId}, ${sha256(token)}, ${purpose}, now() + make_interval(secs => ${ttl}))`;
  return token;
}

/**
 * Look up a token without using it. Single-use is enforced by `consumeToken`
 * inside the same transaction that sets the password.
 */
export async function peekToken(token: string) {
  const [t] = await db()`
    select t.id, t.purpose, a.id as admin_id, a.email, a.name
    from admin_tokens t join admins a on a.id = t.admin_id
    where t.token_hash = ${sha256(token)} and t.used_at is null and t.expires_at > now()`;
  return t as { id: string; purpose: "invite" | "reset"; admin_id: string; email: string; name: string } | undefined;
}

// Links carry the token in the #fragment: browsers never send it to the server
// or in Referer headers, so it stays out of access logs.
const link = (req: NextRequest, token: string) => `${appOrigin(req)}/set-password#t=${token}`;

/** Email a new admin a link to set their password. */
export async function sendInvite(req: NextRequest, a: { id: string; email: string; name: string }, by: string, org?: string) {
  const token = await issueToken(a.id, "invite");
  await mails.invite(a.email, { name: a.name || a.email, by, org, url: link(req, token), hours: INVITE_HOURS });
}

export async function sendReset(req: NextRequest, a: { id: string; email: string; name: string }) {
  const token = await issueToken(a.id, "reset");
  await mails.reset(a.email, { name: a.name || a.email, url: link(req, token), minutes: RESET_MINUTES });
}

export const signInUrl = (req: NextRequest) => `${appOrigin(req)}/login`;
export const forgotUrl = (req: NextRequest) => `${appOrigin(req)}/forgot-password`;
