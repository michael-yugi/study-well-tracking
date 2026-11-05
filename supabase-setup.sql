-- Studywell cloud sync and role security.
-- Run this in the Supabase SQL Editor as the project owner.
-- Public sign-up can create Parent or Student accounts only. Assign Admin manually
-- to the intended owner account after that account has signed up; example at bottom.
-- Parent accounts link students; Admin accounts oversee linked students and timetables.
-- Safe to rerun. Existing profiles, timetables, and study logs are kept.

create table if not exists public.study_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Student',
  account_type text not null default 'student',
  timetable jsonb not null default '[]'::jsonb,
  weekly_goal_minutes integer not null default 300,
  time_zone text not null default 'Africa/Nairobi',
  created_at timestamptz not null default now()
);

alter table public.study_profiles
  add column if not exists weekly_goal_minutes integer not null default 300,
  add column if not exists time_zone text not null default 'Africa/Nairobi';
alter table public.study_profiles drop constraint if exists study_profiles_weekly_goal_minutes_check;
alter table public.study_profiles add constraint study_profiles_weekly_goal_minutes_check
  check (weekly_goal_minutes between 30 and 3000);

alter table public.study_profiles
  drop constraint if exists study_profiles_account_type_check;
alter table public.study_profiles
  add constraint study_profiles_account_type_check
  check (account_type in ('student', 'parent', 'admin'));

create table if not exists public.study_access (
  parent_id uuid not null references public.study_profiles(id) on delete cascade,
  student_id uuid not null references public.study_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id),
  check (parent_id <> student_id)
);

-- Older setup versions allowed only one guardian. Drop that constraint so a student
-- can accept link codes from multiple parents/guardians.
alter table public.study_access drop constraint if exists study_access_student_id_key;

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

create table if not exists public.study_timer_sessions (
  student_id uuid not null references public.study_profiles(id) on delete cascade,
  session_id text not null,
  study_date date not null,
  subject text not null,
  planned_start time not null,
  planned_end time not null,
  planned_start_at timestamptz not null,
  planned_end_at timestamptz not null,
  started_at timestamptz not null default now(),
  last_started_at timestamptz,
  focused_seconds integer not null default 0 check (focused_seconds between 0 and 86400),
  status text not null check (status in ('running', 'paused', 'finished', 'auto_stopped')),
  updated_at timestamptz not null default now(),
  primary key (student_id, session_id, study_date),
  check (planned_end_at > planned_start_at)
);

create index if not exists study_timer_sessions_due_idx
  on public.study_timer_sessions (planned_end_at, status);

create table if not exists public.study_push_subscriptions (
  endpoint text primary key,
  student_id uuid not null references public.study_profiles(id) on delete cascade,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_push_subscriptions_student_idx
  on public.study_push_subscriptions (student_id);

create table if not exists public.study_reminder_queue (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.study_profiles(id) on delete cascade,
  session_id text not null,
  study_date date not null,
  reminder_type text not null check (reminder_type in ('before_lesson', 'log_after_lesson')),
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text not null default '',
  unique (student_id, session_id, study_date, reminder_type)
);

create table if not exists public.study_log_reviews (
  student_id uuid not null,
  log_id text not null,
  reviewer_id uuid not null references public.study_profiles(id) on delete cascade,
  comment text not null default '',
  reviewed boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (student_id, log_id, reviewer_id),
  foreign key (student_id, log_id) references public.study_logs(student_id, id) on delete cascade
);

create table if not exists public.study_timetable_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.study_profiles(id) on delete cascade,
  request_type text not null default 'timetable_change'
    check (request_type in ('timetable_change', 'makeup')),
  request_text text not null check (pg_catalog.char_length(request_text) between 1 and 800),
  missed_study_date date,
  missed_session_id text,
  makeup_date date,
  makeup_start time,
  makeup_end time,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_response text not null default '',
  reviewed_by uuid references public.study_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.study_timetable_requests
  add column if not exists request_type text not null default 'timetable_change',
  add column if not exists missed_study_date date,
  add column if not exists missed_session_id text,
  add column if not exists makeup_date date,
  add column if not exists makeup_start time,
  add column if not exists makeup_end time;
alter table public.study_timetable_requests drop constraint if exists study_timetable_requests_request_type_check;
alter table public.study_timetable_requests add constraint study_timetable_requests_request_type_check
  check (request_type in ('timetable_change', 'makeup'));

create index if not exists study_timetable_requests_student_idx
  on public.study_timetable_requests (student_id, created_at desc);

create index if not exists study_logs_student_date_idx
  on public.study_logs (student_id, study_date desc);

-- A signup can request Parent or Student. Admin is never accepted from metadata.
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
    '[]'::jsonb
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
  '[]'::jsonb
from auth.users u
on conflict (id) do nothing;

-- These SECURITY DEFINER checks read the private profile table without triggering
-- recursive row-level-security policies.
create or replace function public.is_studywell_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.study_profiles
    where id = (select auth.uid()) and account_type = 'admin'
  );
$$;

create or replace function public.is_studywell_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.study_profiles
    where id = (select auth.uid()) and account_type = 'student'
  );
$$;

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
  if v_type is distinct from 'parent' then raise exception 'Only a parent account can create a student link code'; end if;

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
  select parent_id into v_parent
  from public.study_invites
  where code = pg_catalog.upper(pg_catalog.btrim(p_code))
    and used_at is null
    and expires_at > pg_catalog.now()
  for update;
  if v_parent is null then raise exception 'That code is invalid or has expired'; end if;
  if v_parent = v_user then raise exception 'A parent cannot link to their own account'; end if;
  if exists (select 1 from public.study_access where student_id = v_user and parent_id = v_parent) then
    raise exception 'This student is already linked to that parent';
  end if;

  insert into public.study_access (parent_id, student_id) values (v_parent, v_user);
  update public.study_invites set used_at = pg_catalog.now(), redeemed_by = v_user where code = pg_catalog.upper(pg_catalog.btrim(p_code));
end;
$$;

create or replace function public.update_my_weekly_goal(p_student_id uuid, p_weekly_goal_minutes integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if p_weekly_goal_minutes < 30 or p_weekly_goal_minutes > 3000 then
    raise exception 'Weekly goal must be between 30 and 3000 minutes';
  end if;
  if not (
    (p_student_id = v_user and (select public.is_studywell_student()))
    or (
      (select public.is_studywell_admin())
      and exists (select 1 from public.study_access where student_id = p_student_id)
    )
  ) then raise exception 'Only the student or admin can change this weekly goal'; end if;
  update public.study_profiles set weekly_goal_minutes = p_weekly_goal_minutes
    where id = p_student_id and account_type = 'student';
  if not found then raise exception 'Only a student can update their own weekly goal'; end if;
end;
$$;

create or replace function public.update_my_time_zone(p_time_zone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Choose a valid time zone';
  end if;
  update public.study_profiles set time_zone = p_time_zone where id = v_user;
end;
$$;

-- Timer actions are written on the server so an unattended scheduled job can
-- accurately close the timer and create a missed record when its end time passes.
create or replace function public.record_study_timer(p_session_id text, p_study_date date, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_tz text;
  v_day integer;
  v_start time;
  v_end time;
  v_subject text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_local_now timestamp;
  v_timer public.study_timer_sessions%rowtype;
  v_seconds integer;
begin
  if v_user is null or not (select public.is_studywell_student()) then raise exception 'Sign in with a student account first'; end if;
  if p_action not in ('start', 'pause', 'resume', 'finish') then raise exception 'Unknown timer action'; end if;

  select time_zone into v_tz from public.study_profiles where id = v_user;
  if p_action = 'start' then
    select (sessions.item ->> 'day')::integer, (sessions.item ->> 'start')::time, (sessions.item ->> 'end')::time, sessions.item ->> 'subject'
      into v_day, v_start, v_end, v_subject
      from public.study_profiles p
      cross join lateral pg_catalog.jsonb_array_elements(p.timetable) as sessions(item)
      where p.id = v_user and sessions.item ->> 'id' = p_session_id limit 1;
    if v_start is null or v_end is null or v_end <= v_start then raise exception 'This lesson is not in your current timetable'; end if;
    if v_day <> extract(dow from p_study_date)::integer then raise exception 'This lesson is not scheduled for that date'; end if;
    v_start_at := (p_study_date + v_start) at time zone v_tz;
    v_end_at := (p_study_date + v_end) at time zone v_tz;
    v_local_now := pg_catalog.timezone(v_tz, now());
    if v_local_now::date <> p_study_date or now() < v_start_at or now() >= v_end_at then
      raise exception 'The timer can only start during the scheduled lesson';
    end if;
    insert into public.study_timer_sessions
      (student_id, session_id, study_date, subject, planned_start, planned_end, planned_start_at, planned_end_at, started_at, last_started_at, focused_seconds, status, updated_at)
      values (v_user, p_session_id, p_study_date, v_subject, v_start, v_end, v_start_at, v_end_at, now(), now(), 0, 'running', now())
      on conflict (student_id, session_id, study_date) do nothing;
    if not found then raise exception 'A timer has already been started for this lesson'; end if;
    return;
  end if;

  select * into v_timer from public.study_timer_sessions
    where student_id = v_user and session_id = p_session_id and study_date = p_study_date for update;
  if not found then raise exception 'Start this lesson timer first'; end if;
  if v_timer.status in ('finished', 'auto_stopped') then raise exception 'This lesson timer has already ended'; end if;

  if p_action = 'pause' then
    if v_timer.status = 'running' then
      v_seconds := greatest(0, least(86400, floor(extract(epoch from (least(now(), v_timer.planned_end_at) - v_timer.last_started_at)))::integer));
      update public.study_timer_sessions set focused_seconds = focused_seconds + v_seconds,
        status = case when now() >= planned_end_at then 'auto_stopped' else 'paused' end,
        last_started_at = null, updated_at = now()
        where student_id = v_user and session_id = p_session_id and study_date = p_study_date;
    end if;
  elsif p_action = 'resume' then
    if v_timer.status <> 'paused' then raise exception 'This timer is not paused'; end if;
    if now() >= v_timer.planned_end_at then
      update public.study_timer_sessions set status = 'auto_stopped', updated_at = now()
        where student_id = v_user and session_id = p_session_id and study_date = p_study_date;
    else
      update public.study_timer_sessions set status = 'running', last_started_at = now(), updated_at = now()
        where student_id = v_user and session_id = p_session_id and study_date = p_study_date;
    end if;
  elsif p_action = 'finish' then
    v_seconds := case when v_timer.status = 'running' then greatest(0, least(86400, floor(extract(epoch from (least(now(), v_timer.planned_end_at) - v_timer.last_started_at)))::integer)) else 0 end;
    update public.study_timer_sessions set focused_seconds = focused_seconds + v_seconds,
      status = case when now() >= planned_end_at then 'auto_stopped' else 'finished' end,
      last_started_at = null, updated_at = now()
      where student_id = v_user and session_id = p_session_id and study_date = p_study_date;
  end if;
end;
$$;

create or replace function public.finalize_and_mark_missed_study_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_inserted integer := 0; v_count integer := 0;
begin
  update public.study_timer_sessions t
    set focused_seconds = t.focused_seconds + case when t.status = 'running' and t.last_started_at is not null
          then greatest(0, floor(extract(epoch from (t.planned_end_at - t.last_started_at)))::integer) else 0 end,
        status = 'auto_stopped', last_started_at = null, updated_at = now()
    where t.status in ('running', 'paused') and t.planned_end_at <= now();

  with timed as (
    select t.*,
      greatest(0, floor(extract(epoch from (t.planned_end_at - t.planned_start_at)) / 60)::integer) as planned_minutes,
      round(t.focused_seconds / 60.0)::integer as studied_minutes
    from public.study_timer_sessions t
    where t.status in ('finished', 'auto_stopped') and t.planned_end_at <= now()
  ), inserted as (
    insert into public.study_logs
      (student_id, id, session_id, study_date, subject, topic, topic_progress, minutes, status, planned_start, planned_end, created_at)
    select t.student_id, 'session:' || t.session_id || ':' || t.study_date::text, t.session_id, t.study_date,
      t.subject,
      case when t.focused_seconds = 0 then 'Session missed' else 'Details not added yet' end,
      case when t.focused_seconds = 0 then 'not_started' else 'in_progress' end,
      case when t.focused_seconds = 0 then 0 else greatest(1, t.studied_minutes) end,
      case when t.focused_seconds = 0 then 'missed'
           when t.focused_seconds >= greatest(1, extract(epoch from (t.planned_end_at - t.planned_start_at))::integer - 60) then 'completed' else 'partial' end,
      t.planned_start, t.planned_end, now()
    from timed t
    where not exists (select 1 from public.study_logs l where l.student_id = t.student_id and l.session_id = t.session_id and l.study_date = t.study_date)
    on conflict (student_id, id) do nothing returning 1
  ) select count(*) into v_count from inserted;
  v_inserted := v_inserted + v_count;

  with due as (
    select p.id as student_id, s.item ->> 'id' as session_id, s.item ->> 'subject' as subject,
      (s.item ->> 'start')::time as planned_start, (s.item ->> 'end')::time as planned_end, d.day_date
    from public.study_profiles p
    cross join lateral pg_catalog.generate_series(
      (pg_catalog.timezone(p.time_zone, now())::date - 14)::timestamp,
      (pg_catalog.timezone(p.time_zone, now())::date)::timestamp,
      interval '1 day'
    ) as days(day_timestamp)
    cross join lateral pg_catalog.jsonb_array_elements(p.timetable) s(item)
    cross join lateral (select days.day_timestamp::date as day_date) d
    where p.account_type = 'student'
      and (s.item ->> 'day')::integer = extract(dow from d.day_date)::integer
      and ((d.day_date + (s.item ->> 'end')::time) at time zone p.time_zone) <= now()
  ), missed as (
    insert into public.study_logs
      (student_id, id, session_id, study_date, subject, topic, topic_progress, minutes, status, planned_start, planned_end, created_at)
    select d.student_id, 'session:' || d.session_id || ':' || d.day_date::text, d.session_id, d.day_date,
      d.subject, 'Session missed', 'not_started', 0, 'missed', d.planned_start, d.planned_end, now()
    from due d
    where not exists (select 1 from public.study_timer_sessions t where t.student_id = d.student_id and t.session_id = d.session_id and t.study_date = d.day_date)
      and not exists (select 1 from public.study_logs l where l.student_id = d.student_id and l.session_id = d.session_id and l.study_date = d.day_date)
    on conflict (student_id, id) do nothing returning 1
  ) select count(*) into v_count from missed;
  v_inserted := v_inserted + v_count;
  return v_inserted;
end;
$$;

create or replace function public.enqueue_study_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_inserted integer := 0;
begin
  with scheduled as (
    select p.id as student_id, p.time_zone, (sessions.item ->> 'id') as session_id,
      sessions.item ->> 'subject' as subject, (sessions.item ->> 'day')::integer as scheduled_day,
      (sessions.item ->> 'start')::time as planned_start, (sessions.item ->> 'end')::time as planned_end,
      pg_catalog.timezone(p.time_zone, now())::date as local_today
    from public.study_profiles p
    cross join lateral pg_catalog.jsonb_array_elements(p.timetable) as sessions(item)
    where p.account_type = 'student'
  ), windows as (
    select s.*,
      ((s.local_today + s.planned_start) at time zone s.time_zone) as starts_at,
      ((s.local_today + s.planned_end) at time zone s.time_zone) as ends_at
    from scheduled s
    where s.scheduled_day = extract(dow from s.local_today)::integer
  ), queued as (
    insert into public.study_reminder_queue (student_id, session_id, study_date, reminder_type, title, message)
    select w.student_id, w.session_id, w.local_today, 'before_lesson', 'Studywell lesson reminder',
      w.subject || ' starts at ' || to_char(w.planned_start, 'FMHH12:MI AM') || '.'
    from windows w
    where now() >= w.starts_at - interval '10 minutes'
      and now() < w.starts_at - interval '9 minutes'
      and not exists (select 1 from public.study_timer_sessions t where t.student_id = w.student_id and t.session_id = w.session_id and t.study_date = w.local_today)
      and not exists (select 1 from public.study_logs l where l.student_id = w.student_id and l.session_id = w.session_id and l.study_date = w.local_today)
      and exists (select 1 from public.study_push_subscriptions ps where ps.student_id = w.student_id)
    on conflict (student_id, session_id, study_date, reminder_type) do nothing
    returning 1
  ) select count(*) into v_inserted from queued;

  with scheduled as (
    select p.id as student_id, p.time_zone, (sessions.item ->> 'id') as session_id,
      sessions.item ->> 'subject' as subject, (sessions.item ->> 'day')::integer as scheduled_day,
      (sessions.item ->> 'start')::time as planned_start, (sessions.item ->> 'end')::time as planned_end,
      pg_catalog.timezone(p.time_zone, now())::date as local_today
    from public.study_profiles p
    cross join lateral pg_catalog.jsonb_array_elements(p.timetable) as sessions(item)
    where p.account_type = 'student'
  ), windows as (
    select s.*,
      ((s.local_today + s.planned_end) at time zone s.time_zone) as ends_at
    from scheduled s
    where s.scheduled_day = extract(dow from s.local_today)::integer
  ), queued as (
    insert into public.study_reminder_queue (student_id, session_id, study_date, reminder_type, title, message)
    select w.student_id, w.session_id, w.local_today, 'log_after_lesson', 'Update your study log',
      'Open Studywell to add your topic and learning notes for ' || w.subject || ', or request a make-up for the missed lesson.'
    from windows w
    where now() >= w.ends_at + interval '5 minutes'
      and now() < w.ends_at + interval '6 minutes'
      and exists (
        select 1 from public.study_logs l
        where l.student_id = w.student_id and l.session_id = w.session_id and l.study_date = w.local_today
          and (l.topic = 'Details not added yet' or l.status = 'missed')
      )
      and exists (select 1 from public.study_push_subscriptions ps where ps.student_id = w.student_id)
    on conflict (student_id, session_id, study_date, reminder_type) do nothing
    returning 1
  ) select v_inserted + count(*) into v_inserted from queued;
  return v_inserted;
end;
$$;

-- A scheduled lesson's duration and result are always derived from the server timer.
-- Students can still edit learning reflections, but cannot change the recorded time.
create or replace function public.enforce_study_timer_log_results()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_local_today date;
  v_timer public.study_timer_sessions%rowtype;
  v_day integer;
  v_start time;
  v_end time;
  v_subject text;
  v_planned_seconds integer;
begin
  if tg_op = 'UPDATE' and old.session_id is not null then
    new.session_id := old.session_id;
    new.study_date := old.study_date;
    new.subject := old.subject;
    new.minutes := old.minutes;
    new.status := old.status;
    new.planned_start := old.planned_start;
    new.planned_end := old.planned_end;
    return new;
  end if;
  if new.session_id is null then return new; end if;

  select time_zone into v_tz from public.study_profiles where id = new.student_id;
  if v_tz is null then return new; end if;
  v_local_today := pg_catalog.timezone(v_tz, now())::date;
  -- Keep imported historical entries intact; protect current and future sessions.
  if new.study_date < v_local_today then return new; end if;

  select * into v_timer from public.study_timer_sessions
    where student_id = new.student_id and session_id = new.session_id and study_date = new.study_date;
  if found then
    if v_timer.status not in ('finished', 'auto_stopped') then
      raise exception 'Finish the scheduled lesson timer before saving its study record';
    end if;
    new.subject := v_timer.subject;
    new.planned_start := v_timer.planned_start;
    new.planned_end := v_timer.planned_end;
    new.minutes := case when v_timer.focused_seconds = 0 then 0 else greatest(1, round(v_timer.focused_seconds / 60.0)::integer) end;
    v_planned_seconds := greatest(1, floor(extract(epoch from (v_timer.planned_end_at - v_timer.planned_start_at)))::integer);
    new.status := case when v_timer.focused_seconds = 0 then 'missed'
      when v_timer.focused_seconds >= greatest(1, v_planned_seconds - 60) then 'completed' else 'partial' end;
    if new.status = 'missed' then
      new.topic := 'Session missed'; new.topic_about := ''; new.what_learned := ''; new.topic_progress := 'not_started'; new.not_understood := '';
    end if;
    return new;
  end if;

  select (sessions.item ->> 'day')::integer, (sessions.item ->> 'start')::time,
    (sessions.item ->> 'end')::time, sessions.item ->> 'subject'
    into v_day, v_start, v_end, v_subject
    from public.study_profiles p
    cross join lateral pg_catalog.jsonb_array_elements(p.timetable) as sessions(item)
    where p.id = new.student_id and sessions.item ->> 'id' = new.session_id
    limit 1;
  if v_start is null or v_end is null or new.study_date is null then
    raise exception 'This is not a scheduled study session';
  end if;
  if v_day <> extract(dow from new.study_date)::integer then raise exception 'This lesson is not scheduled for that date'; end if;
  if now() < ((new.study_date + v_end) at time zone v_tz) then
    raise exception 'A result is recorded after the scheduled end time';
  end if;
  new.subject := v_subject;
  new.planned_start := v_start;
  new.planned_end := v_end;
  new.topic := 'Session missed';
  new.topic_about := ''; new.what_learned := ''; new.topic_progress := 'not_started'; new.not_understood := '';
  new.minutes := 0; new.status := 'missed';
  return new;
end;
$$;

drop trigger if exists study_logs_enforce_timer_result on public.study_logs;
create trigger study_logs_enforce_timer_result
  before insert or update on public.study_logs
  for each row execute function public.enforce_study_timer_log_results();

create or replace function public.update_my_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if not public.is_studywell_student() then raise exception 'Only student accounts can update their profile name'; end if;

  update public.study_profiles
  set display_name = coalesce(nullif(pg_catalog.btrim(p_display_name), ''), 'Student')
  where id = v_user;
end;
$$;

create or replace function public.update_student_timetable(p_student_id uuid, p_timetable jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if not public.is_studywell_admin() then raise exception 'Only an admin can edit student timetables'; end if;
  if pg_catalog.jsonb_typeof(p_timetable) is distinct from 'array' then
    raise exception 'Timetable must be a list of sessions';
  end if;
  if not exists (
    select 1 from public.study_access where student_id = p_student_id
  ) then raise exception 'You can only edit a linked student timetable'; end if;

  update public.study_profiles
  set timetable = p_timetable
  where id = p_student_id and account_type = 'student';
  if not found then raise exception 'Student account not found'; end if;
end;
$$;

create or replace function public.review_study_timetable_request(p_request_id uuid, p_status text, p_response text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_student uuid;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if not public.is_studywell_admin() then raise exception 'Only an admin can review timetable requests'; end if;
  if p_status is null or p_status not in ('approved', 'declined') then
    raise exception 'Choose approved or declined';
  end if;
  select student_id into v_student
  from public.study_timetable_requests
  where id = p_request_id;
  if not found then raise exception 'Timetable request not found'; end if;
  if not exists (select 1 from public.study_access where student_id = v_student) then
    raise exception 'This request is not from a linked student';
  end if;

  update public.study_timetable_requests
  set status = p_status,
      admin_response = coalesce(pg_catalog.btrim(p_response), ''),
      reviewed_by = v_user,
      reviewed_at = pg_catalog.now()
  where id = p_request_id;
end;
$$;

alter table public.study_profiles enable row level security;
alter table public.study_access enable row level security;
alter table public.study_invites enable row level security;
alter table public.study_logs enable row level security;
alter table public.study_log_reviews enable row level security;
alter table public.study_timetable_requests enable row level security;
alter table public.study_timer_sessions enable row level security;
alter table public.study_push_subscriptions enable row level security;
alter table public.study_reminder_queue enable row level security;

revoke all on table public.study_profiles, public.study_access, public.study_invites, public.study_logs, public.study_log_reviews, public.study_timetable_requests, public.study_timer_sessions, public.study_push_subscriptions, public.study_reminder_queue from public, anon, authenticated;
grant select on table public.study_profiles to authenticated;
grant select on table public.study_access to authenticated;
grant select, insert, update, delete on table public.study_logs to authenticated;
grant select, insert, update on table public.study_log_reviews to authenticated;
grant select, insert on table public.study_timetable_requests to authenticated;
grant select on table public.study_timer_sessions to authenticated;
grant select, insert, update, delete on table public.study_push_subscriptions to authenticated;

drop policy if exists "Read own or linked profiles" on public.study_profiles;
create policy "Read own or linked profiles"
  on public.study_profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.study_access a
      where a.student_id = study_profiles.id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  );

drop policy if exists "Update own profile" on public.study_profiles;

drop policy if exists "Read own link" on public.study_access;
create policy "Read own link"
  on public.study_access for select to authenticated
  using (
    parent_id = (select auth.uid())
    or student_id = (select auth.uid())
    or (select public.is_studywell_admin())
  );

drop policy if exists "Students read own logs" on public.study_logs;
create policy "Students read own logs"
  on public.study_logs for select to authenticated
  using (student_id = (select auth.uid()) and (select public.is_studywell_student()));

drop policy if exists "Linked parents read student logs" on public.study_logs;
create policy "Linked parents read student logs"
  on public.study_logs for select to authenticated
  using (
    exists (
      select 1 from public.study_access a
      where a.student_id = study_logs.student_id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  );

drop policy if exists "Students add own logs" on public.study_logs;
create policy "Students add own logs"
  on public.study_logs for insert to authenticated
  with check (student_id = (select auth.uid()) and (select public.is_studywell_student()));

drop policy if exists "Students update own logs" on public.study_logs;
create policy "Students update own logs"
  on public.study_logs for update to authenticated
  using (student_id = (select auth.uid()) and (select public.is_studywell_student()))
  with check (student_id = (select auth.uid()) and (select public.is_studywell_student()));

drop policy if exists "Students delete own logs" on public.study_logs;
create policy "Students delete own logs"
  on public.study_logs for delete to authenticated
  using (student_id = (select auth.uid()) and (select public.is_studywell_student()));

drop policy if exists "Read accessible study log reviews" on public.study_log_reviews;
create policy "Read accessible study log reviews"
  on public.study_log_reviews for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.study_access a
      where a.student_id = study_log_reviews.student_id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  );

drop policy if exists "Parents and admins add study log reviews" on public.study_log_reviews;
create policy "Parents and admins add study log reviews"
  on public.study_log_reviews for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.study_access a
      where a.student_id = study_log_reviews.student_id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  );

drop policy if exists "Parents and admins update study log reviews" on public.study_log_reviews;
create policy "Parents and admins update study log reviews"
  on public.study_log_reviews for update to authenticated
  using (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.study_access a
      where a.student_id = study_log_reviews.student_id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  )
  with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1 from public.study_access a
      where a.student_id = study_log_reviews.student_id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  );

drop policy if exists "Read accessible timetable requests" on public.study_timetable_requests;
create policy "Read accessible timetable requests"
  on public.study_timetable_requests for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.study_access a
      where a.student_id = study_timetable_requests.student_id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  );

drop policy if exists "Students request timetable changes" on public.study_timetable_requests;
create policy "Students request timetable changes"
  on public.study_timetable_requests for insert to authenticated
  with check (student_id = (select auth.uid()) and (select public.is_studywell_student()));

drop policy if exists "Read accessible timer sessions" on public.study_timer_sessions;
create policy "Read accessible timer sessions"
  on public.study_timer_sessions for select to authenticated
  using (
    student_id = (select auth.uid())
    or exists (
      select 1 from public.study_access a
      where a.student_id = study_timer_sessions.student_id
        and (a.parent_id = (select auth.uid()) or (select public.is_studywell_admin()))
    )
  );

drop policy if exists "Students manage own push subscriptions" on public.study_push_subscriptions;
create policy "Students manage own push subscriptions"
  on public.study_push_subscriptions for all to authenticated
  using (student_id = (select auth.uid()) and (select public.is_studywell_student()))
  with check (student_id = (select auth.uid()) and (select public.is_studywell_student()));

revoke all on function public.is_studywell_admin() from public, anon, authenticated;
grant execute on function public.is_studywell_admin() to authenticated;
revoke all on function public.is_studywell_student() from public, anon, authenticated;
grant execute on function public.is_studywell_student() to authenticated;
revoke all on function public.create_study_invite() from public, anon, authenticated;
grant execute on function public.create_study_invite() to authenticated;
revoke all on function public.redeem_study_invite(text) from public, anon, authenticated;
grant execute on function public.redeem_study_invite(text) to authenticated;
revoke all on function public.update_my_display_name(text) from public, anon, authenticated;
grant execute on function public.update_my_display_name(text) to authenticated;
revoke all on function public.update_my_weekly_goal(uuid, integer) from public, anon, authenticated;
grant execute on function public.update_my_weekly_goal(uuid, integer) to authenticated;
revoke all on function public.update_my_time_zone(text) from public, anon, authenticated;
grant execute on function public.update_my_time_zone(text) to authenticated;
revoke all on function public.record_study_timer(text, date, text) from public, anon, authenticated;
grant execute on function public.record_study_timer(text, date, text) to authenticated;
revoke all on function public.finalize_and_mark_missed_study_sessions() from public, anon, authenticated;
revoke all on function public.enqueue_study_reminders() from public, anon, authenticated;
revoke all on function public.enforce_study_timer_log_results() from public, anon, authenticated;
drop function if exists public.update_my_study_profile(text, jsonb);
revoke all on function public.update_student_timetable(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_student_timetable(uuid, jsonb) to authenticated;
revoke all on function public.review_study_timetable_request(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_study_timetable_request(uuid, text, text) to authenticated;
revoke all on function public.handle_new_study_user() from public, anon, authenticated;

-- Enable a one-minute background check so missed sessions are recorded even when
-- nobody has the website open. Supabase Cron stores job history in the Dashboard.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    execute 'create extension pg_cron';
  end if;
  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'studywell-mark-missed-lessons',
      '* * * * *',
      'select public.finalize_and_mark_missed_study_sessions()'
    );
    perform cron.schedule(
      'studywell-queue-reminders',
      '* * * * *',
      'select public.enqueue_study_reminders()'
    );
  end if;
exception
  when others then
    raise notice 'Studywell background schedules were not enabled automatically. Enable Supabase Cron and schedule the two Studywell SQL functions from the Dashboard.';
end $$;

-- After the owner has created their Parent account, make it the admin account
-- by running this separately in the SQL Editor with that account's email:
-- update public.study_profiles
-- set account_type = 'admin'
-- where id = (select id from auth.users where lower(email) = lower('YOUR_ADMIN_EMAIL'));
