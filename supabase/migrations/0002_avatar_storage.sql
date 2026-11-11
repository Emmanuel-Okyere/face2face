-- Face thumbnails move out of the `people.avatar` text column (base64 data URLs).
-- Images now live in Vercel Blob (private) when configured, or in a bytea column
-- otherwise. Either way they're only reachable through the authenticated
-- /api/avatars/:id route; the database keeps just the 128-d vectors for matching.

alter table people add column if not exists avatar_key text;                 -- Vercel Blob pathname
alter table people add column if not exists avatar_bytes bytea;              -- fallback when Blob isn't configured
alter table people add column if not exists avatar_version int not null default 0;  -- 0 = no avatar; bumps bust caches

-- Carry over thumbnails written by 0001 as data URLs, then drop the old column.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'people' and column_name = 'avatar') then
    update people
       set avatar_bytes = decode(split_part(avatar, ',', 2), 'base64'),
           avatar_version = 1
     where avatar like 'data:image/jpeg;base64,%';
    alter table people drop column avatar;
  end if;
end $$;

-- What the app hands to the browser: a versioned, same-origin, auth-checked URL.
alter table people add column if not exists avatar_url text
  generated always as (
    case when avatar_version > 0 then '/api/avatars/' || id::text || '?v=' || avatar_version::text end
  ) stored;
