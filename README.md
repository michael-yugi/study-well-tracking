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
4. Have each student open the same tracker, create a separate **Student** account, choose their starting timetable, and enter their own one-time code from the parent.
5. Choose **Ann's timetable** or **Lewi's timetable** at signup. Each student's schedule and study log belong to that student's account; students can edit their timetable later. Parents can create another link code for every additional student, refresh the linked-student list, and select a student from the top bar.
6. Study logs and timetables sync from each student account. The parent signs in to view linked students and their records.

After a lesson, students can record the topic, explain what it covers, summarize what they learned, mark topic progress, and note what they did not understand. These reflections are searchable in the study log and sync with the rest of the student's record.

If the original Supabase setup SQL was already run, run the current `supabase-setup.sql` again to add the reflection fields to the existing table. It keeps existing study logs.

Each person should use their own account; do not share passwords. Link codes expire after 24 hours and can be used once. Parents can view records but cannot edit the student's timetable or logs. If a browser is offline, its local copy remains available and sync retries when the connection returns.

Without signing in, the tracker continues to store data only in that browser's local storage.
