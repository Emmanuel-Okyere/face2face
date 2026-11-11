-- Organization logos. Stored like face thumbnails: a Vercel Blob object (when
-- configured) or bytea, served via /api/orgs/:id/logo?v=<version>. Logos are
-- public branding (shown on the public phone check-in page), so that route
-- needs no sign-in; uploads are owner-only and validated (PNG/JPEG/WebP, no SVG).

alter table organizations add column if not exists logo_key text;            -- Blob pathname
alter table organizations add column if not exists logo_bytes bytea;         -- fallback storage
alter table organizations add column if not exists logo_type text
  check (logo_type is null or logo_type in ('image/png', 'image/jpeg', 'image/webp'));
alter table organizations add column if not exists logo_version int not null default 0;  -- 0 = default logo

alter table organizations add column if not exists logo_url text
  generated always as (
    case when logo_version > 0 then '/api/orgs/' || id::text || '/logo?v=' || logo_version::text end
  ) stored;
