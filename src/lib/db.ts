import "server-only";
import postgres from "postgres";

declare global {
  var __f2fSql: postgres.Sql | undefined;
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
  });
}

/** Lazily-created, hot-reload-safe connection pool. */
export function db(): postgres.Sql {
  if (!globalThis.__f2fSql) globalThis.__f2fSql = create();
  return globalThis.__f2fSql;
}

/** Serialise a descriptor for a pgvector parameter: '[0.1,0.2,…]'. */
export function toVector(v: number[]): string {
  return `[${v.map((x) => x.toFixed(6)).join(",")}]`;
}
