// Tracked, idempotent database migrations.
//
//   npm run db:migrate              apply pending migrations
//   npm run db:migrate -- --status  list applied / pending, change nothing
//
// On Vercel this runs automatically from `vercel-build`, but only for
// production deployments (previews usually share the production database).
// Set MIGRATE_ON_PREVIEW=1 if your previews have their own database.
//
// Rules for migration files (supabase/migrations/NNNN_name.sql):
//   • Never edit a file once it has been applied — add a new one. Edits are
//     detected by checksum and fail the deploy.
//   • Every pending file runs in ONE transaction: all apply or none do.
//     (So no `CREATE INDEX CONCURRENTLY` — it can't run inside a transaction.)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const statusOnly = process.argv.includes("--status");
const log = (m) => console.log(`[migrate] ${m}`);

if (process.env.VERCEL && process.env.VERCEL_ENV !== "production" && process.env.MIGRATE_ON_PREVIEW !== "1") {
  log(`skipping on Vercel "${process.env.VERCEL_ENV}" deployment (set MIGRATE_ON_PREVIEW=1 to enable)`);
  process.exit(0);
}

// Prefer a direct/session connection for DDL; fall back to the app's pooler URL.
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL (or DATABASE_MIGRATION_URL) is not set");
  process.exit(1);
}

const dir = process.env.MIGRATIONS_DIR || join(import.meta.dirname, "../supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort()
  .map((f) => {
    const sqlText = readFileSync(join(dir, f), "utf8");
    return { version: f.replace(/\.sql$/, ""), sqlText, checksum: createHash("sha256").update(sqlText).digest("hex") };
  });

const sql = postgres(url, {
  prepare: false,
  max: 1,
  onnotice: () => {}, // silence "already exists, skipping"
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
});

// Arbitrary constant: every deploy takes the same lock, so concurrent builds queue.
const LOCK_ID = 7_314_202_611;

/**
 * Seeds the first (platform) admin ONCE, from settings, on an empty database:
 *   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD (temporary, must be changed
 *   at first sign-in), optional BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ORG_NAME,
 *   BOOTSTRAP_ORG_SLUG, BOOTSTRAP_ORG_TIMEZONE.
 * Once any admin exists this is a no-op, so the variables can (and should) be
 * removed after the first deploy. Changing them later never resets anything.
 */
async function seedBootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
    const [{ n }] = await tx`select count(*)::int as n from admins`;
    if (n > 0) return log("bootstrap: admins already exist — nothing to seed");
    if (!email || !password) {
      log("WARNING: no admins exist and BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD are not set — nobody can sign in yet");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("BOOTSTRAP_ADMIN_EMAIL is not a valid email");
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be 12+ characters (max 72 bytes)");
    }
    const orgName = process.env.BOOTSTRAP_ORG_NAME?.trim() || "My organization";
    let slug = (process.env.BOOTSTRAP_ORG_SLUG || orgName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    if (slug.length < 3) slug = `org-${slug || "main"}`;
    const tz = process.env.BOOTSTRAP_ORG_TIMEZONE || "UTC";

    let [org] = await tx`select id from organizations order by created_at limit 1`;
    if (!org) {
      [org] = await tx`insert into organizations (name, slug, time_zone, late_after)
                       values (${orgName}, ${slug}, ${tz}, '09:00') returning id`;
    }
    const hash = await bcrypt.hash(password, 12);
    const [admin] = await tx`
      insert into admins (email, name, password_hash, is_platform_admin, must_change_password)
      values (${email}, ${process.env.BOOTSTRAP_ADMIN_NAME?.trim() || email.split("@")[0]}, ${hash}, true, true)
      returning id`;
    await tx`insert into memberships (org_id, admin_id, role) values (${org.id}, ${admin.id}, 'owner')`;
    const [{ n: svc }] = await tx`select count(*)::int as n from services where org_id = ${org.id}`;
    if (!svc) await tx`insert into services (org_id, name, kind, start_time, end_time, opens_before, closes_after, late_after)
      values (${org.id}, 'Every day', 'daily', '00:00', '23:59', 0, 0, 540)`;
    log(`bootstrap: created platform admin ${email} (temporary password — must be changed at first sign-in)`);
  });
}

let exitCode = 0;
try {
  await sql`
    create table if not exists schema_migrations (
      version     text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )`;
  await sql`alter table schema_migrations enable row level security`;

  await sql.begin(async (tx) => {
    // Held until commit/rollback; works through Supabase's transaction pooler too.
    await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
    const applied = new Map((await tx`select version, checksum from schema_migrations`).map((r) => [r.version, r.checksum]));

    const tampered = files.filter((f) => applied.has(f.version) && applied.get(f.version) !== f.checksum);
    if (tampered.length) {
      throw new Error(
        `already-applied migration(s) were edited: ${tampered.map((f) => f.version).join(", ")}. ` +
          "Revert the edit and put the change in a new migration file.",
      );
    }

    const pending = files.filter((f) => !applied.has(f.version));
    if (statusOnly) {
      for (const f of files) log(`${applied.has(f.version) ? "applied " : "PENDING "} ${f.version}`);
      return;
    }
    if (!pending.length) {
      log(`up to date (${files.length} migration${files.length === 1 ? "" : "s"})`);
      return;
    }
    for (const f of pending) {
      const t0 = Date.now();
      await tx.unsafe(f.sqlText);
      await tx`insert into schema_migrations (version, checksum) values (${f.version}, ${f.checksum})`;
      log(`ran ${f.version} (${Date.now() - t0} ms)`);
    }
    log(`committed ${pending.length} migration${pending.length === 1 ? "" : "s"}`);
  });
  if (!statusOnly) await seedBootstrapAdmin();
} catch (e) {
  console.error(`[migrate] FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(exitCode);
