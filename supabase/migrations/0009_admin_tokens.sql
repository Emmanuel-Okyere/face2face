-- One-time links emailed to admins: "set your password" invites and password
-- resets. Only the SHA-256 of the token is stored; the link itself is never
-- kept. A token is single-use and short-lived.

create table if not exists admin_tokens (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references admins (id) on delete cascade,
  token_hash  text not null unique,
  purpose     text not null check (purpose in ('invite', 'reset')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists admin_tokens_admin_idx on admin_tokens (admin_id);

-- Never readable by tenant queries.
alter table admin_tokens enable row level security;
