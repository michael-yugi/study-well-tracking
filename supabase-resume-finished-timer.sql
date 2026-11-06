-- Allow a student to resume a lesson timer that was finished early by mistake.
-- Run this once in Supabase SQL Editor before using Resume timer in Studywell.
create or replace function public.resume_finished_study_timer(p_session_id text, p_study_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_timer public.study_timer_sessions%rowtype;
begin
  if v_user is null or not (select public.is_studywell_student()) then
    raise exception 'Sign in with a student account first';
  end if;

  select * into v_timer from public.study_timer_sessions
    where student_id = v_user and session_id = p_session_id and study_date = p_study_date for update;
  if not found then raise exception 'No saved timer was found for this lesson'; end if;
  if v_timer.status <> 'finished' then raise exception 'Only a lesson finished early can be resumed'; end if;
  if now() >= v_timer.planned_end_at then raise exception 'The planned lesson end has passed'; end if;
  if exists (
    select 1 from public.study_logs
    where student_id = v_user and session_id = p_session_id and study_date = p_study_date
  ) then raise exception 'This lesson already has a saved study log'; end if;

  update public.study_timer_sessions set status = 'running', last_started_at = now(), updated_at = now()
    where student_id = v_user and session_id = p_session_id and study_date = p_study_date;
end;
$$;

revoke all on function public.resume_finished_study_timer(text, date) from public, anon, authenticated;
grant execute on function public.resume_finished_study_timer(text, date) to authenticated;
