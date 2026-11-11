import "server-only";
import { db } from "./db";
import { HttpError } from "./http";

/**
 * Fixed-window limiter stored in Postgres, so it holds across every serverless
 * instance (in-memory limiters don't on Vercel). Throws 429 when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const [r] = await db()`
    insert into rate_limits (key, count, window_start) values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count, extract(epoch from (window_start + make_interval(secs => ${windowSec}) - now()))::int as retry`;
  if (Math.random() < 0.01) {
    await db()`delete from rate_limits where window_start < now() - interval '1 day'`;
  }
  if (r.count > limit) throw new HttpError(429, "Too many requests — please slow down", { "retry-after": String(Math.max(1, r.retry)) });
}
