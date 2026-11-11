-- Face2Face schema. Run this in the Supabase SQL editor (or `supabase db push`).
-- Requires the pgvector extension (enabled by default on Supabase, just not created).

create extension if not exists vector;

-- ─── Admins ──────────────────────────────────────────────────────────────────
create table if not exists admins (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null default '',
  password_hash  text not null,
  token_version  int not null default 0,          -- bump to kill every session ("sign out everywhere")
  failed_logins  int not null default 0,
  locked_until   timestamptz,                      -- exponential lockout after repeated failures
  password_changed_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

-- One row per signed-in device. The refresh token is opaque and only its
-- SHA-256 is stored; it rotates on every use and re-use of an old one revokes the session.
create table if not exists admin_sessions (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid not null references admins (id) on delete cascade,
  refresh_hash   text not null unique,
  prev_hash      text,
  rotated_at     timestamptz,
  token_version  int not null,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz not null default now(),
  expires_at     timestamptz not null,             -- absolute lifetime
  revoked_at     timestamptz,
  revoke_reason  text,
  ip             text,
  user_agent     text
);
create index if not exists admin_sessions_admin_idx on admin_sessions (admin_id) where revoked_at is null;

-- Fixed-window rate limiter shared by all serverless instances.
create table if not exists rate_limits (
  key           text primary key,
  count         int not null,
  window_start  timestamptz not null
);

-- ─── People ──────────────────────────────────────────────────────────────────
create table if not exists people (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,            -- staff / student / member ID
  full_name    text not null,
  group_name   text,                            -- department, class, team…
  email        text,
  avatar       text,                            -- small JPEG data URL (≈5 KB) for admin UX
  qr_version   int not null default 1,          -- bump to revoke a lost badge
  consent_at   timestamptz,                     -- biometric consent captured at enrollment
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists people_name_idx  on people (lower(full_name));
create index if not exists people_group_idx on people (group_name);

-- ─── Face embeddings (3–5 per person, 128-d face-api descriptors) ────────────
create table if not exists face_embeddings (
  id          bigint generated always as identity primary key,
  person_id   uuid not null references people (id) on delete cascade,
  embedding   vector(128) not null,
  quality     real,                             -- 0..1 capture quality score
  pose        text,                             -- front / left / right / up / smile / upload
  created_at  timestamptz not null default now()
);
create index if not exists face_embeddings_person_idx on face_embeddings (person_id);
-- face-api descriptors are compared by Euclidean (L2) distance.
create index if not exists face_embeddings_hnsw
  on face_embeddings using hnsw (embedding vector_l2_ops);

-- ─── Kiosks (paired check-in devices) ────────────────────────────────────────
create table if not exists kiosks (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  created_by    uuid references admins (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

-- One-time liveness challenge nonces (replay protection).
create table if not exists kiosk_nonces (
  nonce    text primary key,
  used_at  timestamptz not null default now()
);

-- ─── Attendance ──────────────────────────────────────────────────────────────
do $$ begin
  create type attendance_method as enum ('face', 'qr', 'manual');
exception when duplicate_object then null; end $$;

create table if not exists attendance (
  id             bigint generated always as identity primary key,
  person_id      uuid not null references people (id) on delete cascade,
  day            date not null,                 -- local day in ATTENDANCE_TZ
  checked_in_at  timestamptz not null default now(),
  method         attendance_method not null,
  distance       real,                          -- best L2 distance (face)
  margin         real,                          -- gap to 2nd-best person (face)
  liveness       jsonb,                         -- challenge steps + timings
  kiosk_id       uuid references kiosks (id) on delete set null,
  recorded_by    uuid references admins (id) on delete set null,
  note           text,
  unique (person_id, day)                       -- one check-in per person per day
);
create index if not exists attendance_day_idx on attendance (day, checked_in_at desc);

-- Failed / rejected attempts, for auditing spoof attempts and tuning the threshold.
create table if not exists attempts (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  kiosk_id    uuid references kiosks (id) on delete set null,
  outcome     text not null,                    -- unknown / ambiguous / liveness / bad_qr
  distance    real,
  margin      real,
  candidate   uuid references people (id) on delete set null
);
create index if not exists attempts_at_idx on attempts (at desc);

-- Everything is accessed server-side through DATABASE_URL; lock out the public
-- Supabase API roles entirely.
alter table admins          enable row level security;
alter table admin_sessions  enable row level security;
alter table rate_limits     enable row level security;
alter table people          enable row level security;
alter table face_embeddings enable row level security;
alter table kiosks          enable row level security;
alter table kiosk_nonces    enable row level security;
alter table attendance      enable row level security;
alter table attempts        enable row level security;
