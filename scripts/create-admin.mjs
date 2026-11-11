// Recovery tool: npm run create-admin -- you@example.com "Your Name"
// Creates or resets a PLATFORM admin with a temporary password that must be
// changed at next sign-in. Normal setup uses BOOTSTRAP_ADMIN_* (see README).
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { createInterface } from "node:readline/promises";

const [email, ...nameParts] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run create-admin -- <email> "<name>"');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (put it in .env.local)");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = process.env.ADMIN_PASSWORD || (await rl.question("Password (12+ chars): "));
rl.close();
if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
  console.error("Password must be 12+ characters and at most 72 bytes");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
const sql = postgres(url, { prepare: false, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require" });
const hash = await bcrypt.hash(password, 12);
const name = nameParts.join(" ") || email.split("@")[0];
const [row] = await sql`
  insert into admins (email, name, password_hash, is_platform_admin, must_change_password)
  values (${email.toLowerCase()}, ${name}, ${hash}, true, true)
  on conflict (email) do update set password_hash = excluded.password_hash, name = excluded.name,
    is_platform_admin = true, must_change_password = true,
    token_version = admins.token_version + 1, failed_logins = 0, locked_until = null, password_changed_at = now()
  returning id, email`;
console.log(`✓ Admin ready: ${row.email}`);
await sql.end();
