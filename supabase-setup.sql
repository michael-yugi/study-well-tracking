-- Studywell cloud sync: run once in Supabase SQL Editor.
-- Browser access uses only the publishable key. Row-level security protects all records.

create table if not exists public.study_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Student',
  account_type text not null check (account_type in ('student', 'parent')),
  timetable jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.study_access (
  parent_id uuid not null references public.study_profiles(id) on delete cascade,
  student_id uuid not null references public.study_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id),
  unique (student_id),
  check (parent_id <> student_id)
);

create table if not exists public.study_invites (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.study_profiles(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  redeemed_by uuid references public.study_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.study_logs (
  student_id uuid not null references public.study_profiles(id) on delete cascade,
  id text not null,
  session_id text,
  study_date date not null,
  subject text not null,
  topic text not null,
  topic_about text not null default '',
  what_learned text not null default '',
  topic_progress text not null default 'in_progress'
    check (topic_progress in ('completed', 'in_progress', 'needs_help', 'not_started')),
  not_understood text not null default '',
  minutes integer not null check (minutes between 0 and 1440),
  notes text not null default '',
  status text not null check (status in ('completed', 'partial', 'missed')),
  planned_start time,
  planned_end time,
  created_at timestamptz not null default now(),
  primary key (student_id, id)
);

alter table public.study_logs
  add column if not exists topic_about text not null default '',
  add column if not exists what_learned text not null default '',
  add column if not exists topic_progress text not null default 'in_progress'
    check (topic_progress in ('completed', 'in_progress', 'needs_help', 'not_started')),
  add column if not exists not_understood text not null default '';

create index if not exists study_logs_student_date_idx
  on public.study_logs (student_id, study_date desc);

create or replace function public.handle_new_study_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.study_profiles (id, display_name, account_type, timetable)
  values (
    new.id,
    coalesce(
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
      'Student'
    ),
    case when new.raw_user_meta_data ->> 'account_type' = 'parent' then 'parent' else 'student' end,
    case when pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'timetable') = 'array'
      then new.raw_user_meta_data -> 'timetable' else '[]'::jsonb end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists study_auth_user_created on auth.users;
create trigger study_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_study_user();

-- Also cover an account created before this setup script was run.
insert into public.study_profiles (id, display_name, account_type, timetable)
select
  u.id,
  coalesce(
    nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(pg_catalog.split_part(coalesce(u.email, ''), '@', 1), ''),
    'Student'
  ),
  case when u.raw_user_meta_data ->> 'account_type' = 'parent' then 'parent' else 'student' end,
  case when pg_catalog.jsonb_typeof(u.raw_user_meta_data -> 'timetable') = 'array'
    then u.raw_user_meta_data -> 'timetable' else '[]'::jsonb end
from auth.users u
on conflict (id) do nothing;

create or replace function public.create_study_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_type text;
  v_code text;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select account_type into v_type from public.study_profiles where id = v_user;
  if v_type is distinct from 'parent' then raise exception 'Only a parent account can create a link code'; end if;

  v_code := pg_catalog.upper(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''));
  insert into public.study_invites (parent_id, code, expires_at)
  values (v_user, v_code, pg_catalog.now() + interval '24 hours');
  return v_code;
end;
$$;

create or replace function public.redeem_study_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_type text;
  v_parent uuid;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select account_type into v_type from public.study_profiles where id = v_user;
  if v_type is distinct from 'student' then raise exception 'Sign in with a student account to use this code'; end if;
  if exists (select 1 from public.study_access where student_id = v_user) then
    raise exception 'This student account is already linked to a parent';
  end if;

  select parent_id into v_parent
  from public.study_invites
  where code = pg_catalog.upper(pg_catalog.btrim(p_code))
    and used_at is null
    and expires_at > pg_catalog.now()
  for update;
  if v_parent is null then raise exception 'That code is invalid or has expired'; end if;
  if v_parent = v_user then raise exception 'A parent cannot link to their own account'; end if;

  insert into public.study_access (parent_id, student_id) values (v_parent, v_user);
  update public.study_invites set used_at = pg_catalog.now(), redeemed_by = v_user where code = pg_catalog.upper(pg_catalog.btrim(p_code));
end;
$$;

alter table public.study_profiles enable row level security;
alter table public.study_access enable row level security;
alter table public.study_invites enable row level security;
alter table public.study_logs enable row level security;

revoke all on table public.study_profiles, public.study_access, public.study_invites, public.study_logs from anon, authenticated;
grant select on table public.study_profiles to authenticated;
grant update (display_name, timetable) on table public.study_profiles to authenticated;
grant select on table public.study_access to authenticated;
grant select, insert, update, delete on table public.study_logs to authenticated;

drop policy if exists "Read own or linked profiles" on public.study_profiles;
create policy "Read own or linked profiles"
  on public.study_profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.study_access a
      where a.student_id = study_profiles.id and a.parent_id = (select auth.uid())
    )
  );

drop policy if exists "Update own profile" on public.study_profiles;
create policy "Update own profile"
  on public.study_profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Read own link" on public.study_access;
create policy "Read own link"
  on public.study_access for select to authenticated
  using (parent_id = (select auth.uid()) or student_id = (select auth.uid()));

drop policy if exists "Students read own logs" on public.study_logs;
create policy "Students read own logs"
  on public.study_logs for select to authenticated
  using (student_id = (select auth.uid()));

drop policy if exists "Linked parents read student logs" on public.study_logs;
create policy "Linked parents read student logs"
  on public.study_logs for select to authenticated
  using (
    exists (
      select 1 from public.study_access a
      where a.student_id = study_logs.student_id and a.parent_id = (select auth.uid())
    )
  );

drop policy if exists "Students add own logs" on public.study_logs;
create policy "Students add own logs"
  on public.study_logs for insert to authenticated
  with check (student_id = (select auth.uid()));

drop policy if exists "Students update own logs" on public.study_logs;
create policy "Students update own logs"
  on public.study_logs for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

drop policy if exists "Students delete own logs" on public.study_logs;
create policy "Students delete own logs"
  on public.study_logs for delete to authenticated
  using (student_id = (select auth.uid()));

revoke all on function public.create_study_invite() from public, anon, authenticated;
grant execute on function public.create_study_invite() to authenticated;
revoke all on function public.redeem_study_invite(text) from public, anon, authenticated;
grant execute on function public.redeem_study_invite(text) to authenticated;
revoke all on function public.handle_new_study_user() from public, anon, authenticated;
