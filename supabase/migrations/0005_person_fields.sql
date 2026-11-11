-- Per-organization person fields. Each organization chooses which details it
-- collects: rename / hide / require the built-in ones (ID code, group, email,
-- phone) and add its own (text, number, date, dropdown, yes/no, phone, email…).
--
-- organizations.person_fields: JSON array of field definitions (null = defaults).
-- people.phone:      built-in phone, normalized to E.164 (+233241234567).
-- people.attributes: values of the organization's custom fields, keyed by field key.

alter table organizations add column if not exists person_fields jsonb
  check (person_fields is null or jsonb_typeof(person_fields) = 'array');

alter table people add column if not exists phone text;
do $$ begin
  alter table people add constraint people_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$');
exception when duplicate_object then null; end $$;

alter table people add column if not exists attributes jsonb not null default '{}'::jsonb;
do $$ begin
  alter table people add constraint people_attributes_object check (jsonb_typeof(attributes) = 'object');
exception when duplicate_object then null; end $$;
