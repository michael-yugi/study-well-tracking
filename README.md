# Studywell

A timetable-based study tracker for students, parents/guardians, and an admin. The live site is hosted on GitHub Pages and uses Supabase for accounts and shared progress.

## Roles and sharing

- **Admin:** views linked students and manages their timetables and weekly goals.
- **Parent / guardian:** creates a one-time code for each student and views linked students’ timetables, logs, weekly progress, and make-up requests.
- **Student:** signs in to start lesson timers, add learning reflections, set a weekly goal, and request make-up time.
- A student can link several caregivers. Each caregiver creates a separate code, and the student redeems each code from the same Student account.
- Ann and Lewi have independent student accounts. The admin selects each student separately and applies the correct timetable preset.

## Lesson timers and automatic results

- A student starts a timer during the scheduled lesson. The server records the start, pauses, resume, and finish actions.
- Focused minutes come from the timer; the scheduled session’s time and result fields are locked against manual editing.
- The timer stops at the timetable end. A full session is **Completed** when focused time is within one minute of the planned duration; any positive shorter time is **Partly completed**; no focused time is **Missed**.
- A background Supabase Cron job finalizes timers and adds a missed record when a scheduled lesson ends without a timer. It runs even if Studywell is closed.
- After the result is recorded, the student can add the topic and learning reflections. Until then a timed log says **Details not added yet**.
- Independent study entries that are not attached to a timetable block can still use manually entered minutes and a selected result.

## Goals, streaks, and missed-session requests

- New students start with a weekly goal of **300 minutes (5 hours)**. The student or admin can change it; parents can view it.
- A streak counts consecutive calendar days with recorded focused study time.
- From a missed session in the Study log, the student can request a make-up date and time and explain why they missed it. The admin can approve or decline.

## Android app-use reports

The `android` folder contains a Samsung/Android companion app that opens Studywell and can read Android foreground-app usage after the student explicitly enables **Usage Access** in phone Settings. It records app names and foreground time only within timetable blocks for which a Studywell timer was started; it does not read messages, page contents, or keystrokes. The student can turn off Usage Access in Android Settings at any time.

When the student opens or returns to the companion app with an internet connection, it syncs the recent app-use summary to Supabase. Parents and the admin can see the app names and minutes under the matching session in **Study log**. Reports may arrive after the student returns to Studywell, since Android can pause the website while another app is in front.

Run the current `supabase-setup.sql` once more to create the private app-use report table and its student/guardian access rules. The GitHub Actions workflow builds a debug APK when Android files change; download the `studywell-android-debug` artifact from the repository's **Actions** page. Install the APK on each student's phone, sign in with that student's Studywell account, open the account dialog, choose **Enable app-use reporting**, and allow Studywell under Android's Usage Access settings. Parents see the report on each matching entry in **Study log**. Android may pause Studywell while another app is open, so the report syncs when the student returns to the companion app with internet access.

## Database setup

Run the current `supabase-setup.sql` in the project’s Supabase SQL Editor. It is safe to rerun and keeps existing profiles and study logs. It updates the database for multiple guardians, timers, goals, requests, missed-session automation, and reminder scheduling.

The script tries to enable Supabase Cron and schedule these jobs:

- `studywell-mark-missed-lessons` — finalizes timers and records missed lessons each minute.
- `studywell-queue-reminders` — creates before-lesson and follow-up reminder events each minute.

Check **Integrations → Cron** in Supabase to confirm both jobs appear. If Cron is not enabled on the project, enable the Cron extension there and run these two statements in SQL Editor:

```sql
select cron.schedule('studywell-mark-missed-lessons', '* * * * *',
  'select public.finalize_and_mark_missed_study_sessions()');
select cron.schedule('studywell-queue-reminders', '* * * * *',
  'select public.enqueue_study_reminders()');
```

To assign the admin role after the admin has signed up, use the final commented SQL example in `supabase-setup.sql`, replacing the placeholder with the admin email. For Michael’s admin account, the address is `michaelyugi598@gmail.com`.

## Enable reminders when Studywell is closed

The existing browser reminders work while the site is open. Closed-site reminders use Web Push and need a one-time setup in Supabase and the repository:

1. Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Keep the private key out of GitHub.
2. Put the **public** key in `supabase-config.js` as `pushPublicKey` and publish that small config change to GitHub Pages.
3. Install/link the Supabase CLI, then save the private VAPID key and these values as Edge Function secrets: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (for example `mailto:michaelyugi598@gmail.com`), and a long random `STUDYWELL_WEBHOOK_SECRET`. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function.
4. Deploy `supabase/functions/studywell-push` with JWT verification disabled; the function checks the webhook secret itself. For example: `npx supabase functions deploy studywell-push --project-ref iksxkdcamgeidwppgeef --no-verify-jwt`.
5. In **Database → Webhooks**, create an INSERT webhook for `study_reminder_queue` that calls the `studywell-push` Edge Function. Add Supabase’s Edge Function secret key header and a custom `x-studywell-webhook-secret` header with the same value saved in step 3.
6. Each student signs in on each device, chooses **Enable study reminders**, and allows notifications. Supported browsers can then receive lesson reminders even with Studywell closed.

Do not commit VAPID private keys, Supabase secret keys, or webhook secrets. The publishable Supabase key in `supabase-config.js` is intended to be public; table access is restricted by row-level security.

## Local use

Open `index.html` in a modern browser. Without signing in, data stays in that browser. Closed-site automatic missed records and shared accounts require the hosted Supabase setup.
