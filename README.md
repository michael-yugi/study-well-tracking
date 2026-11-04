# Studywell

Repository: `study-well-tracking`

A small, browser based study tracker for following a personal timetable and remembering what each session covered.

## Open it

Open `index.html` in a modern browser. No install or account is needed.

## Use it

1. The weekday lessons from the supplied timetable are preloaded. The six study periods are included; breakfast, break, and lunch are left out. Saturday revision is set to 8:00–11:00.
2. On the day, start a focus timer when a planned session begins. For a past or missed session, choose **Log session**.
3. Save the subject, topic, actual minutes, and whether the session was completed, partly completed, or missed.
4. Use **Study log** to search and review what was studied over time.

The overview compares completed sessions against timetable blocks whose end time has passed this week. Focus time comes from saved logs. A timer is a self-reported aid, not independent proof that someone studied.

## Parent and student sync

Cloud sync uses Supabase. The browser contains only the project's publishable key; table access is restricted with row-level security. Never put a Supabase secret or service-role key in this repository.

1. In the Supabase project, open **SQL Editor**, create a query, paste all of `supabase-setup.sql`, and run it once.
2. In **Authentication → URL Configuration**, add `https://michael-yugi.github.io/study-well-tracking/` to the redirect URL allow list.
3. Open the tracker and create a **Parent / teacher** account. Sign in and choose **Create student link code**.
4. Have the student open the same tracker, create their own **Student** account, and enter the one-time code from the parent.
5. Study logs and the timetable sync from the student account. The parent signs in to view linked students and their records.

Each person should use their own account; do not share passwords. Link codes expire after 24 hours and can be used once. Parents can view records but cannot edit the student's timetable or logs. If a browser is offline, its local copy remains available and sync retries when the connection returns.

Without signing in, the tracker continues to store data only in that browser's local storage.
