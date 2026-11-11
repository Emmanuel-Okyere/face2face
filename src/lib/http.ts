import "server-only";
import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdmin, type AdminSession } from "./auth";
import { resolveAdminOrg, type Org } from "./tenant";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public headers: Record<string, string> = {},
    public code?: string,
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export function json(data: unknown, init?: number | ResponseInit) {
  const base: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  return NextResponse.json(data, { ...base, headers: { ...NO_STORE, ...(base.headers as Record<string, string>) } });
}

/**
 * CSRF defence in depth (cookies are already SameSite=Strict): state-changing
 * requests from a browser must come from this origin. Browsers always send
 * Sec-Fetch-Site and/or Origin on cross-origin POSTs, so their absence means a
 * non-browser client, which can't ride on a victim's cookies anyway.
 */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new HttpError(403, "Cross-site request blocked");
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new Set([req.headers.get("x-forwarded-host"), req.headers.get("host")].filter(Boolean) as string[]);
    if (process.env.APP_ORIGIN) allowed.add(new URL(process.env.APP_ORIGIN).host);
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (!allowed.has(originHost)) throw new HttpError(403, "Cross-origin request blocked");
  }
}

/** Wrap a route handler: same-origin guard, and HttpError/ZodError → JSON. */
export function handle<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C) => {
    // Every API route is per-request (cookies, DB); never prerender it. Kept
    // outside the try so Next's own prerender signal isn't swallowed below.
    await connection();
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, { status: e.status, headers: e.headers });
      if (e instanceof z.ZodError) {
        return json({ error: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
      }
      console.error(e);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

/**
 * Signed-in admin. Admins on a temporary password can do nothing but change it
 * (and sign out) — enforced here, against the live DB flag, for every route.
 */
export async function requireAdmin(req: NextRequest, opts: { allowPasswordChange?: boolean } = {}): Promise<AdminSession> {
  const admin = await getAdmin(req);
  if (!admin) throw new HttpError(401, "Not signed in");
  if (admin.mustChangePassword && !opts.allowPasswordChange) {
    throw new HttpError(403, "Change your temporary password first", {}, "password_change_required");
  }
  return admin;
}

/** Admin + the organization they're working in. `owner` restricts to org owners (and platform admins). */
export async function requireOrg(req: NextRequest, opts: { owner?: boolean } = {}): Promise<{ admin: AdminSession; org: Org }> {
  const admin = await requireAdmin(req);
  const org = await resolveAdminOrg(admin, req);
  if (!org) throw new HttpError(403, "You're not a member of any organization yet", {}, "no_org");
  if (opts.owner && org.role !== "owner" && !admin.isPlatform) throw new HttpError(403, "Only organization owners can do that");
  return { admin, org };
}

export async function requirePlatform(req: NextRequest): Promise<AdminSession> {
  const admin = await requireAdmin(req);
  if (!admin.isPlatform) throw new HttpError(403, "Platform admins only");
  return admin;
}

const MAX_BODY = 256 * 1024;

export async function body<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  // Requiring JSON also blocks HTML-form CSRF, which can't send this content type.
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Expected application/json");
  }
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "Request body too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  return schema.parse(raw);
}

/** A face-api descriptor: exactly 128 finite numbers. */
export const descriptorSchema = z.array(z.number().finite().min(-2).max(2)).length(128);

/** bcrypt only uses the first 72 bytes, so cap there rather than silently truncating. */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password is too long (max 72 bytes)");
