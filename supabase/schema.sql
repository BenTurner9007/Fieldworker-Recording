-- Fieldworker Recording: database setup
-- ======================================
-- Paste this whole file into Supabase > SQL Editor and click Run.
-- Then change the email address at the bottom to yours (you become the first admin).
-- Safe to run again: it only adds what's missing.
--
-- Table names start with fw_ (and the team list is fw_team), so this can share a
-- Supabase project with other apps without clashing.

-- PostGIS gives every record a real point geometry in British National Grid
-- (EPSG:27700), so QGIS / ArcGIS Pro can connect straight to the database.
create extension if not exists postgis with schema extensions;

-- ---------- Team ----------
-- Everyone allowed to sign in and see the data. Admins can add and remove people in the app.
create table if not exists public.fw_team (
  email     text primary key,
  name      text not null default '',
  initials  text not null default '',
  role      text not null default 'recorder' check (role in ('recorder', 'admin')),
  added_at  timestamptz not null default now()
);

create or replace function public.fw_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fw_team where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.fw_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fw_team where lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin');
$$;

-- ---------- Data ----------
-- Every record keeps all its fields in "data" (JSON), plus key columns for
-- searching, GIS and export. The fw_* views further down flatten "data" into
-- normal columns.

create table if not exists public.fw_projects (
  id          text primary key,
  site_code   text not null,
  name        text,
  data        jsonb not null default '{}'::jsonb,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),  -- when it was edited (on the phone)
  updated_by  text,                                -- who edited it
  synced_by   text,                                -- who uploaded it
  synced_at   timestamptz not null default now()   -- when it reached the database
);

create table if not exists public.fw_records (
  id          text primary key,
  project_id  text not null,
  type        text not null,          -- context | find | sample | photo | drawing
  number      text not null,
  data        jsonb not null default '{}'::jsonb,
  latitude    double precision,
  longitude   double precision,
  easting     double precision,
  northing    double precision,
  geom        extensions.geometry(Point, 27700) generated always as (
                case when easting is not null and northing is not null
                     then extensions.st_setsrid(extensions.st_makepoint(easting, northing), 27700) end
              ) stored,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  synced_by   text,
  synced_at   timestamptz not null default now()
);

create table if not exists public.fw_files (
  id          text primary key,
  record_id   text not null,
  project_id  text not null,
  path        text not null,          -- location in the fieldwork-photos storage bucket
  name        text,
  mime        text,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  text,
  synced_by   text,
  synced_at   timestamptz not null default now()
);

create index if not exists fw_records_project on public.fw_records (project_id, type);
create index if not exists fw_records_synced  on public.fw_records (synced_at);
create index if not exists fw_projects_synced on public.fw_projects (synced_at);
create index if not exists fw_files_synced    on public.fw_files (synced_at);
create index if not exists fw_files_record    on public.fw_files (record_id);
create index if not exists fw_records_geom    on public.fw_records using gist (geom);

-- Stamp every upload, and never let an older edit overwrite a newer one
-- (e.g. a phone that was offline all day syncing late).
create or replace function public.fw_on_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;  -- keep the newer version already in the database
  end if;
  new.synced_at := now();
  new.synced_by := auth.jwt() ->> 'email';
  return new;
end $$;

drop trigger if exists fw_projects_write on public.fw_projects;
drop trigger if exists fw_records_write  on public.fw_records;
drop trigger if exists fw_files_write    on public.fw_files;
create trigger fw_projects_write before insert or update on public.fw_projects for each row execute function public.fw_on_write();
create trigger fw_records_write  before insert or update on public.fw_records  for each row execute function public.fw_on_write();
create trigger fw_files_write    before insert or update on public.fw_files    for each row execute function public.fw_on_write();

-- ---------- Access rules ----------
grant usage on schema public to authenticated;
grant select, insert, update on public.fw_projects, public.fw_records, public.fw_files to authenticated;
grant select, insert, update, delete on public.fw_team to authenticated;

alter table public.fw_team     enable row level security;
alter table public.fw_projects enable row level security;
alter table public.fw_records  enable row level security;
alter table public.fw_files    enable row level security;

drop policy if exists "team can read team"      on public.fw_team;
drop policy if exists "admins manage team"      on public.fw_team;
drop policy if exists "team can do everything"  on public.fw_projects;
drop policy if exists "team can do everything"  on public.fw_records;
drop policy if exists "team can do everything"  on public.fw_files;

create policy "team can read team" on public.fw_team
  for select to authenticated using (public.fw_is_member());
create policy "admins manage team" on public.fw_team
  for all to authenticated using (public.fw_is_admin()) with check (public.fw_is_admin());

-- Nothing is ever hard-deleted from the app: deletions are flagged (deleted = true)
-- so they reach every phone, and so you can recover them.
create policy "team can do everything" on public.fw_projects
  for all to authenticated using (public.fw_is_member()) with check (public.fw_is_member());
create policy "team can do everything" on public.fw_records
  for all to authenticated using (public.fw_is_member()) with check (public.fw_is_member());
create policy "team can do everything" on public.fw_files
  for all to authenticated using (public.fw_is_member()) with check (public.fw_is_member());

-- Live updates between phones.
do $$ begin alter publication supabase_realtime add table public.fw_projects;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.fw_records;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.fw_files;
exception when duplicate_object then null; end $$;

-- ---------- Photos ----------
insert into storage.buckets (id, name, public)
values ('fieldwork-photos', 'fieldwork-photos', false)
on conflict (id) do nothing;

drop policy if exists "fw team read photos"   on storage.objects;
drop policy if exists "fw team add photos"    on storage.objects;
drop policy if exists "fw team change photos" on storage.objects;
drop policy if exists "fw team remove photos" on storage.objects;
create policy "fw team read photos" on storage.objects
  for select to authenticated using (bucket_id = 'fieldwork-photos' and public.fw_is_member());
create policy "fw team add photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'fieldwork-photos' and public.fw_is_member());
create policy "fw team change photos" on storage.objects
  for update to authenticated using (bucket_id = 'fieldwork-photos' and public.fw_is_member());
create policy "fw team remove photos" on storage.objects
  for delete to authenticated using (bucket_id = 'fieldwork-photos' and public.fw_is_member());

-- >>> Change this to the email address you will sign in with. You become the first admin. <<<
insert into public.fw_team (email, name, initials, role) values
  ('you@example.com', 'Your Name', 'YN', 'admin')
on conflict (email) do update set role = 'admin';
