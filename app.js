(() => {
  const STORAGE_KEY = "studywell-tracker-v1";
  const LOCAL_MIGRATION_KEY = "studywell-local-imported-v1";
  const PUBLIC_APP_URL = "https://michael-yugi.github.io/study-well-tracking/";
  const supabaseClient = window.STUDYWELL_SUPABASE && window.supabase?.createClient
    ? window.supabase.createClient(window.STUDYWELL_SUPABASE.url, window.STUDYWELL_SUPABASE.publishableKey)
    : null;
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const $ = (id) => document.getElementById(id);
  const todayISO = () => toISO(new Date());
  const toISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const fromISO = (value) => { const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d); };
  const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const WEEKDAY_ROWS = [
    { start: "06:00", end: "07:00", label: "Morning prep", subjects: ["Science", "Pre-Technical", "Maths", "Social Studies", "Agriculture"] },
    { start: "08:00", end: "09:00", label: "Lesson 1", subjects: ["English", "Maths", "Agriculture", "Science", "Pre-Technical"] },
    { start: "09:00", end: "10:00", label: "Lesson 2", subjects: ["Kiswahili", "English", "Pre-Technical", "Kiswahili", "Maths"] },
    { start: "11:00", end: "12:00", label: "Lesson 3", subjects: ["CRE", "Agriculture", "Science", "Maths", "Science"] },
    { start: "14:00", end: "15:00", label: "Lesson 4", subjects: ["Social Studies", "Kiswahili", "Creative Arts", "CRE", "Social Studies"] },
    { start: "15:00", end: "16:00", label: "Lesson 5", subjects: ["Creative Arts", "Social Studies", "English", "English", "English"] },
  ];
  const ANN_WEEKDAY_ROWS = [
    { start: "06:00", end: "07:00", label: "Morning prep", subjects: ["Kiswahili", "Maths", "English", "Science", "Pre-Technical"] },
    { start: "09:00", end: "10:00", label: "Lesson 1", subjects: ["Maths", "Kiswahili", "Social Studies", "CRE", "Creative Arts"] },
    { start: "10:00", end: "11:00", label: "Lesson 2", subjects: ["CRE", "Pre-Technical", "Agriculture", "Kiswahili", "English"] },
    { start: "12:30", end: "13:00", label: "Lesson 3", subjects: ["Social Studies", "Creative Arts", "Science", "English", "Pre-Technical"] },
    { start: "14:30", end: "15:00", label: "Lesson 4", subjects: ["Agriculture", "Pre-Technical", "CRE", "Maths", "Maths"] },
  ];
  function buildTimetable(rows, prefix) {
    return rows.flatMap((row, rowIndex) => row.subjects.map((subject, index) => ({
      id: `${prefix}-${index + 1}-${rowIndex}`,
      day: index + 1,
      start: row.start,
      end: row.end,
      subject,
      focus: row.label,
    }))).concat({
      id: `${prefix}-saturday-revision`,
      day: 6,
      start: "08:00",
      end: "11:00",
      subject: "Revision",
      focus: "Review weekly topics, practise questions, do exams, revisit difficult topics",
    });
  }
  const LEWI_TIMETABLE = buildTimetable(WEEKDAY_ROWS, "lewi");
  const ANN_TIMETABLE = buildTimetable(ANN_WEEKDAY_ROWS, "ann");
  const defaultState = { name: "Student", schedule: LEWI_TIMETABLE, logs: [], activeTimer: null, weeklyGoalMinutes: 300, timetableImported: true };
  let authUser = null;
  let accountProfile = null;
  let linkedStudents = [];
  let selectedStudentId = null;
  let timerSessions = [];
  let logReviews = [];
  let timetableRequests = [];
  let makeupRequestLog = null;
  let currentLogTimer = false;
  let currentLogAutomatic = false;
  let currentLogTimerSeconds = 0;
  let authMode = "signin";
  let state = loadState();
  let timerInterval = null;
  let toastTimeout = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.schedule) && Array.isArray(saved.logs)) {
        const restored = { ...defaultState, ...saved };
        if (!saved.schedule.length && !saved.timetableImported) {
          restored.schedule = LEWI_TIMETABLE;
          restored.timetableImported = true;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
        }
        return restored;
      }
    } catch (_) { /* Start clean if stored data is unavailable. */ }
    return { ...defaultState };
  }
  function saveState() {
    if (isParentView()) return;
    const key = authUser && accountProfile?.account_type === "student" ? `${STORAGE_KEY}:user:${authUser.id}` : STORAGE_KEY;
    localStorage.setItem(key, JSON.stringify(state));
  }
  function formatDate(date, options = { weekday: "long", month: "long", day: "numeric" }) { return new Intl.DateTimeFormat(undefined, options).format(date); }
  function formatTime(value) {
    if (!value) return "";
    const [hour, minute] = value.split(":").map(Number);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hour, minute));
  }
  function weekDates() {
    const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => { const date = new Date(monday); date.setDate(monday.getDate() + i); return date; });
  }
  function minutesFromTime(value) { const [h, m] = value.split(":").map(Number); return h * 60 + m; }
  function durationLabel(minutes) { const m = Math.max(0, Math.round(minutes || 0)); const h = Math.floor(m / 60); const rem = m % 60; return h ? `${h}h ${rem ? `${rem}m` : ""}`.trim() : `${rem} min`; }
  function durationCompact(minutes) { const m = Math.max(0, Math.round(minutes || 0)); const h = Math.floor(m / 60); return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`; }
  function logsForWeek() { const dates = weekDates(); const first = toISO(dates[0]); const last = toISO(dates[6]); return state.logs.filter((log) => log.date >= first && log.date <= last); }
  function getOccurrenceLog(sessionId, date) { return state.logs.find((log) => log.sessionId === sessionId && log.date === date); }
  function sessionBoundary(session, date, part) {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = session[part].split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute).getTime();
  }
  function timerEndAt(timer, session = null) {
    const savedEnd = Number(timer?.plannedEndAt);
    if (Number.isFinite(savedEnd) && savedEnd > 0) return savedEnd;
    const linkedSession = session || state.schedule.find((item) => item.id === timer?.sessionId);
    return linkedSession && timer?.date ? sessionBoundary(linkedSession, timer.date, "end") : 0;
  }
  function timerElapsedMs(timer = state.activeTimer, now = Date.now()) {
    if (!timer) return 0;
    const accumulated = Math.max(0, Number(timer.accumulatedMs) || 0);
    if (timer.pausedAt || timer.autoStoppedAt || timer.manualStopped) return accumulated;
    const runningSince = Number(timer.runningSince || timer.startedAt);
    if (!runningSince) return accumulated;
    const session = state.schedule.find((item) => item.id === timer.sessionId);
    const plannedStartAt = Number(timer.plannedStartAt) || (session && timer.date ? sessionBoundary(session, timer.date, "start") : 0);
    const endAt = timerEndAt(timer);
    const boundedNow = endAt ? Math.min(now, endAt) : now;
    return accumulated + Math.max(0, boundedNow - Math.max(runningSince, plannedStartAt));
  }
  function sessionResultForSeconds(seconds, plannedSeconds) {
    if (seconds <= 0) return "missed";
    return seconds >= Math.max(1, plannedSeconds - 60) ? "completed" : "partial";
  }
  async function persistTimerAction(timer, action) {
    if (!isStudentAccount()) return;
    const { error } = await supabaseClient.rpc("record_study_timer", {
      p_session_id: timer.sessionId, p_study_date: timer.date, p_action: action,
    });
    if (error) throw error;
  }
  function isDue(session, date) {
    return sessionBoundary(session, date, "end") <= Date.now();
  }
  function updateHeader() {
    const name = state.name || "Student";
    $("profileName").textContent = name;
    $("avatarInitial").textContent = name.trim().charAt(0).toUpperCase() || "S";
    $("topDate").textContent = formatDate(new Date(), { weekday: "short", month: "short", day: "numeric" });
    const hour = new Date().getHours();
    const hello = hour < 12 ? "GOOD MORNING" : hour < 17 ? "GOOD AFTERNOON" : "GOOD EVENING";
    $("greeting").textContent = `${hello}${name !== "Student" ? `, ${name.toUpperCase()}` : ""}`;
    $("welcomeCopy").textContent = name === "Student" ? "A clear view of your plan, your progress, and what you’ve learned." : `A clear view of your plan, your progress, and what you’ve learned, ${name}.`;
    $("todayLongDate").textContent = formatDate(new Date());
  }
  function renderOverview() {
    updateHeader();
    const dates = weekDates(); const weekLogs = logsForWeek();
    const totalMinutes = weekLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
    const todayMinutes = state.logs.filter((log) => log.date === todayISO()).reduce((sum, log) => sum + Number(log.minutes || 0), 0);
    const h = Math.floor(totalMinutes / 60); const m = totalMinutes % 60;
    $("weekTime").innerHTML = `${h}<span>h</span> ${m}<span>m</span>`;
    $("weekTimeCaption").textContent = `Today: ${durationLabel(todayMinutes)} focused`;
    const loggedCompleted = weekLogs.filter((log) => log.status === "completed").length;
    $("completedValue").textContent = String(loggedCompleted);
    $("completedCaption").textContent = `${loggedCompleted === 1 ? "session" : "sessions"} fully completed this week`;
    const dueSessions = [];
    for (const date of dates) {
      const iso = toISO(date);
      if (iso > todayISO()) continue;
      for (const session of state.schedule.filter((item) => Number(item.day) === date.getDay())) if (isDue(session, iso)) dueSessions.push({ session, iso });
    }
    const adherence = dueSessions.length ? Math.round(dueSessions.filter(({ session, iso }) => getOccurrenceLog(session.id, iso)?.status === "completed").length / dueSessions.length * 100) : null;
    $("adherenceValue").innerHTML = adherence === null ? `—<span>%</span>` : `${adherence}<span>%</span>`;
    $("adherenceCaption").textContent = dueSessions.length ? `${dueSessions.filter(({ session, iso }) => getOccurrenceLog(session.id, iso)?.status === "completed").length} of ${dueSessions.length} planned sessions completed in full` : "No sessions due yet";
    $("adherenceBar").style.width = `${adherence || 0}%`;
    const dayMinutes = dates.map((date) => weekLogs.filter((log) => log.date === toISO(date)).reduce((sum, log) => sum + Number(log.minutes || 0), 0));
    $("weekDots").innerHTML = dates.map((date, i) => `<span class="week-dot ${dayMinutes[i] ? "has-study" : ""}" title="${SHORT_DAYS[date.getDay()]}: ${dayMinutes[i]} min"></span>`).join("");
    const start = dates[0], end = dates[6];
    $("weekRange").textContent = `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start)} – ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(end)}`;
    const max = Math.max(60, ...dayMinutes);
    $("weekChart").innerHTML = dates.map((date, i) => `<div class="chart-day ${toISO(date) === todayISO() ? "today" : ""}" title="${formatDate(date, { weekday: "long" })}: ${dayMinutes[i]} minutes"><span class="chart-minute">${dayMinutes[i] ? dayMinutes[i] : ""}</span><div class="chart-track"><div class="chart-fill" style="height:${dayMinutes[i] ? Math.max(8, Math.round(dayMinutes[i] / max * 94)) : 0}px"></div></div><span class="chart-label">${SHORT_DAYS[date.getDay()]}</span></div>`).join("");
    $("chartTotal").textContent = `${totalMinutes} min total`;
    const plannedToday = state.schedule.filter((item) => Number(item.day) === new Date().getDay()).length;
    const doneToday = state.logs.filter((log) => log.date === todayISO() && log.status === "completed").length;
    $("weekInsight").innerHTML = plannedToday ? `<span class="insight-icon">✳</span><span>${doneToday ? `You’ve completed ${doneToday} of ${plannedToday} planned session${plannedToday === 1 ? "" : "s"} today. Keep that focus going.` : `${plannedToday} session${plannedToday === 1 ? "" : "s"} in today’s plan. One focused block is a good start.`}</span>` : `<span class="insight-icon">✳</span><span>Add your timetable to see how your week is shaping up.</span>`;
    renderToday(); renderRecent();
  }
  function renderToday() {
    const today = new Date(); const iso = todayISO();
    const sessions = state.schedule.filter((session) => Number(session.day) === today.getDay()).sort((a, b) => a.start.localeCompare(b.start));
    $("todayCount").textContent = sessions.length ? `${sessions.length} planned ${sessions.length === 1 ? "session" : "sessions"}` : "A little space in your day";
    if (!sessions.length) {
      $("todaySessions").innerHTML = `<div class="empty-plan"><span class="empty-plan-icon">＋</span><strong>No sessions planned for today</strong><span>Leave room to rest, or add a study block.</span><button data-go="timetable">Set up your timetable ↗</button></div>`;
      return;
    }
    $("todaySessions").innerHTML = sessions.map((session) => {
      const log = getOccurrenceLog(session.id, iso); const active = state.activeTimer?.sessionId === session.id && state.activeTimer.date === iso;
      const remoteTimer = isParentView() ? timerSessions.find((timer) => timer.session_id === session.id && timer.study_date === iso) : null;
      const startAt = sessionBoundary(session, iso, "start"); const endAt = sessionBoundary(session, iso, "end"); const now = Date.now();
      let action, statusClass = "";
      if (active) {
        const stopped = Boolean(state.activeTimer.autoStoppedAt || state.activeTimer.manualStopped);
        const paused = Boolean(state.activeTimer.pausedAt);
        statusClass = "status-live";
        action = `<span class="timer-controls"><span class="timer-clock ${paused || stopped ? "timer-paused" : ""}">${formatElapsed()}</span>${stopped ? `<button class="timer-control" data-action="finish" data-id="${escapeHTML(session.id)}">Log</button>` : paused ? `<button class="timer-control" data-action="resume" data-id="${escapeHTML(session.id)}">Resume</button>` : ""}</span>`;
      }
      else if (log) { statusClass = `status-${log.status === "completed" ? "done" : log.status}`; action = `<button class="session-action done-action" data-action="view-log" data-id="${escapeHTML(log.id)}">${log.status === "missed" ? "Missed" : `${durationCompact(log.minutes)} · ${log.status === "partial" ? "Partial" : "Logged"}`}</button>`; }
      else if (remoteTimer) {
        const timerMinutes = Math.round(timerSessionElapsedSeconds(remoteTimer, now) / 60);
        const timerLabel = remoteTimer.status === "running" ? "In progress" : remoteTimer.status === "paused" ? "Paused" : "Timer ended";
        statusClass = remoteTimer.status === "running" ? "status-live" : "status-partial";
        action = `<span class="session-action done-action" title="Student started at ${escapeHTML(formatTimestampTime(remoteTimer.started_at))}">${timerLabel} · ${durationCompact(timerMinutes)}</span>`;
      }
      else if (isParentView()) { action = `<button class="session-action" disabled>Not logged</button>`; }
      else if (state.activeTimer) { action = `<button class="session-action" disabled title="A timer is already active for another lesson">Another timer</button>`; }
      else if (now < startAt) { action = `<button class="session-action" disabled title="The timer opens at the scheduled start time">Starts ${formatTime(session.start)}</button>`; }
      else if (now >= endAt) { action = `<button class="session-action missed-action" disabled title="Studywell is recording the automatic session result">Saving result…</button>`; }
      else { action = `<button class="session-action" data-action="start-or-log" data-id="${escapeHTML(session.id)}">Start timer</button>`; }
      const focus = log ? log.topic : remoteTimer ? `Timer started at ${formatTimestampTime(remoteTimer.started_at)}${remoteTimer.status === "paused" ? " · Paused" : ""}` : session.focus || "Planned study time";
      return `<div class="session-row ${statusClass}"><span class="session-time">${formatTime(session.start)}<br>${formatTime(session.end)}</span><span class="session-line"></span><span class="session-info"><strong class="session-subject">${escapeHTML(session.subject)}</strong><span class="session-focus">${escapeHTML(focus)}</span></span>${action}</div>`;
    }).join("");
  }
  function renderRecent() {
    const recent = [...state.logs].sort((a, b) => `${b.date}${b.createdAt || ""}`.localeCompare(`${a.date}${a.createdAt || ""}`)).slice(0, 4);
    if (!recent.length) { $("recentLogs").innerHTML = `<div class="empty-recent">Your study notes will show up here after your first session.</div>`; return; }
    $("recentLogs").innerHTML = recent.map((log) => `<div class="recent-row"><div class="subject-badge color-${(log.subject.charCodeAt(0) || 0) % 4}">${escapeHTML(log.subject.trim().charAt(0).toUpperCase())}</div><div class="recent-main"><strong>${escapeHTML(log.subject)} · ${escapeHTML(log.topic)}</strong><span>${formatDate(fromISO(log.date), { weekday: "short", month: "short", day: "numeric" })}${log.status === "partial" ? " · Partly completed" : ""}</span></div><div class="recent-meta"><strong>${durationCompact(log.minutes)}</strong><span>${log.status === "missed" ? "missed" : "focused"}</span></div></div>`).join("");
  }
  function renderTimetable() {
    const container = $("scheduleList");
    if (!state.schedule.length) {
      const noStudent = isParentView() && !selectedStudentId;
      const heading = noStudent ? "No linked students yet" : isParentView() ? "No timetable available yet" : "Start with the plan you have";
      const copy = noStudent ? (isAdminAccount() ? "A Parent account needs to link a student first. Then choose that student from the menu at the top of the page." : "Create a student link code, then select the linked student to view their timetable.") : isParentView() ? (isAdminAccount() ? "This student does not have a timetable yet. Add their study sessions here." : "This student does not have a timetable yet. Ask the admin to add their study sessions.") : isStudentAccount() ? "Your admin manages this timetable. Use your student account to log what you study." : "Add a few study blocks from your real timetable. When the time comes, start a focus timer and record what you covered.";
      container.innerHTML = `<div class="empty-timetable"><span class="empty-plan-icon">▦</span><h3>${heading}</h3><p>${copy}</p>${canEditTimetable() ? `<button class="button button-dark" id="emptyAddBtn"><span class="button-plus">+</span> Add the first session</button>` : ""}</div>`; return;
    }
    container.innerHTML = Array.from({ length: 7 }, (_, index) => (index + 1) % 7).map((day) => {
      const sessions = state.schedule.filter((item) => Number(item.day) === day).sort((a, b) => a.start.localeCompare(b.start));
      const actions = canEditTimetable();
      const entries = sessions.map((session) => `<div class="schedule-entry"><span class="schedule-entry-time">${formatTime(session.start)}<br>${formatTime(session.end)}</span><span class="schedule-entry-line"></span><span class="schedule-entry-copy"><strong>${escapeHTML(session.subject)}</strong><span>${escapeHTML(session.focus || "No focus topic added")} · ${durationLabel(minutesFromTime(session.end) - minutesFromTime(session.start))}</span></span>${actions ? `<span class="schedule-entry-actions"><button class="small-action edit-session" data-id="${escapeHTML(session.id)}" aria-label="Edit ${escapeHTML(session.subject)}" title="Edit">✎</button><button class="small-action delete-session" data-id="${escapeHTML(session.id)}" aria-label="Delete ${escapeHTML(session.subject)}" title="Delete">×</button></span>` : ""}</div>`).join("");
      return `<section class="day-card"><div class="day-card-header"><span class="day-title">${DAYS[day]}<span class="day-count">${sessions.length ? `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}` : "—"}</span></span>${actions ? `<button class="small-action add-day-session" data-day="${day}" aria-label="Add session on ${DAYS[day]}" title="Add a session">＋</button>` : ""}</div><div class="day-card-content">${entries || `<div class="empty-day">No study blocks planned.</div>`}</div></section>`;
    }).join("");
  }
  function topicProgressLabel(progress) {
    return ({ completed: "Topic completed", in_progress: "In progress", needs_help: "Needs more help", not_started: "Not started" })[progress] || "In progress";
  }
  function reflectionMarkup(label, value) {
    return value ? `<div class="reflection-item"><strong>${label}</strong><p>${escapeHTML(value)}</p></div>` : "";
  }
  function weeklySummaryData() {
    const dates = weekDates(); const first = toISO(dates[0]); const last = toISO(dates[6]);
    const weekLogs = state.logs.filter((log) => log.date >= first && log.date <= last);
    const plans = dates.flatMap((date) => state.schedule.filter((session) => Number(session.day) === date.getDay()).map((session) => ({ session, date: toISO(date) })));
    const duePlans = plans.filter(({ session, date }) => sessionBoundary(session, date, "end") <= Date.now());
    const loggedPlans = duePlans.filter(({ session, date }) => getOccurrenceLog(session.id, date));
    const topics = [...new Set(weekLogs.filter((log) => log.status !== "missed" && log.topic).map((log) => `${log.subject}: ${log.topic}`))];
    const needsHelp = weekLogs.filter((log) => log.status !== "missed" && (log.topicProgress === "needs_help" || log.notUnderstood));
    return {
      weekLogs, plans, duePlans, loggedPlans,
      completed: weekLogs.filter((log) => log.status === "completed").length,
      partial: weekLogs.filter((log) => log.status === "partial").length,
      missed: weekLogs.filter((log) => log.status === "missed").length,
      unlogged: Math.max(0, duePlans.length - loggedPlans.length),
      minutes: weekLogs.reduce((sum, log) => sum + Number(log.minutes || 0), 0),
      topics, needsHelp,
    };
  }
  function currentWeeklyGoal() {
    if (isStudentAccount()) return Number(accountProfile?.weekly_goal_minutes) || 300;
    if (isParentView()) return Number(linkedStudents.find((student) => student.id === selectedStudentId)?.weekly_goal_minutes) || 300;
    return Number(state.weeklyGoalMinutes) || 300;
  }
  function studyStreakDays() {
    const studyDates = new Set(state.logs.filter((log) => Number(log.minutes) > 0).map((log) => log.date));
    const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
    if (!studyDates.has(toISO(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (studyDates.has(toISO(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
    return streak;
  }
  function renderWeeklySummary() {
    const summary = weeklySummaryData();
    const goalMinutes = currentWeeklyGoal(); const goalPercent = Math.min(100, Math.round(summary.minutes / goalMinutes * 100));
    const streak = studyStreakDays();
    $("weeklySummaryTitle").textContent = isParentView() ? `${state.name || "Student"}'s progress this week` : "Your progress this week";
    $("weeklySummaryStats").innerHTML = [
      ["Planned", `${summary.plans.length}`, "sessions this week"],
      ["Logged", `${summary.loggedPlans.length} / ${summary.duePlans.length}`, "sessions due so far"],
      ["Focused time", durationLabel(summary.minutes), "total this week"],
      ["Needs help", `${summary.needsHelp.length}`, "topics to review"],
      ["Streak", `${streak} day${streak === 1 ? "" : "s"}`, streak ? "in a row with study time" : "start a study streak"],
    ].map(([label, value, caption]) => `<div class="summary-stat"><span>${label}</span><strong>${value}</strong><small>${caption}</small></div>`).join("");
    $("weeklyGoalValue").textContent = `${durationLabel(summary.minutes)} of ${durationLabel(goalMinutes)}`;
    $("weeklyGoalBar").style.width = `${goalPercent}%`;
    $("weeklyGoalNote").textContent = goalPercent >= 100 ? "Weekly goal reached — well done!" : `${goalPercent}% of this week's goal · ${durationLabel(Math.max(0, goalMinutes - summary.minutes))} to go`;
    $("weeklyGoalControls").hidden = !(isStudentAccount() || isAdminAccount() && Boolean(selectedStudentId));
    $("weeklyGoalInput").value = String(Math.round(goalMinutes / 60 * 10) / 10);
    const topicText = summary.topics.length ? `Topics covered: ${summary.topics.slice(0, 4).join(" · ")}${summary.topics.length > 4 ? ` · +${summary.topics.length - 4} more` : ""}. ` : "No topics logged this week yet. ";
    $("weeklySummaryNote").textContent = `${topicText}${summary.completed} completed · ${summary.partial} partial · ${summary.missed} missed · ${summary.unlogged} due session${summary.unlogged === 1 ? "" : "s"} not logged.`;
  }
  async function saveWeeklyGoal() {
    const hours = Number($("weeklyGoalInput").value);
    const minutes = Math.round(hours * 60);
    if (!Number.isFinite(hours) || minutes < 30 || minutes > 3000) { showToast("Choose a goal from 0.5 to 50 hours"); return; }
    if (!isStudentAccount() && !isAdminAccount()) return;
    const studentId = isStudentAccount() ? authUser.id : selectedStudentId;
    if (!studentId) return;
    const button = $("saveWeeklyGoalBtn"); button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc("update_my_weekly_goal", { p_student_id: studentId, p_weekly_goal_minutes: minutes });
      if (error) throw error;
      if (isStudentAccount()) accountProfile.weekly_goal_minutes = minutes;
      else {
        const student = linkedStudents.find((item) => item.id === studentId);
        if (student) student.weekly_goal_minutes = minutes;
      }
      state.weeklyGoalMinutes = minutes; renderWeeklySummary(); showToast("Weekly study goal updated");
    } catch (error) { showToast(error.message || "Could not save the weekly goal. Run the latest Supabase setup SQL."); }
    finally { button.disabled = false; }
  }
  function printStudyReport() {
    const range = $("reportRange").value; const today = new Date();
    let start, end;
    if (range === "month") { start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29); end = new Date(today.getFullYear(), today.getMonth(), today.getDate()); }
    else { [start, , end] = weekDates(); }
    const startISO = toISO(start), endISO = toISO(end);
    const logs = [...state.logs].filter((log) => log.date >= startISO && log.date <= endISO).sort((a, b) => `${a.date}${a.createdAt || ""}`.localeCompare(`${b.date}${b.createdAt || ""}`));
    const minutes = logs.reduce((sum, log) => sum + Number(log.minutes || 0), 0);
    const needsHelp = logs.filter((log) => log.topicProgress === "needs_help" || log.notUnderstood).length;
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) { showToast("Allow pop-ups to print the report"); return; }
    const rows = logs.map((log) => {
      const reportStudentId = selectedStudentId || authUser?.id;
      const reviewComments = logReviews.filter((review) => review.student_id === reportStudentId && review.log_id === log.id && review.comment).map((review) => review.comment).join(" · ");
      return `<tr><td>${escapeHTML(formatDate(fromISO(log.date), { month: "short", day: "numeric", year: "numeric" }))}</td><td>${escapeHTML(log.subject)}</td><td>${escapeHTML(log.topic)}${log.whatLearned ? `<small>Learned: ${escapeHTML(log.whatLearned)}</small>` : ""}${log.notUnderstood ? `<small>Needs help: ${escapeHTML(log.notUnderstood)}</small>` : ""}${reviewComments ? `<small>Parent review: ${escapeHTML(reviewComments)}</small>` : ""}</td><td>${escapeHTML(durationLabel(log.minutes))}</td><td>${escapeHTML(topicProgressLabel(log.topicProgress))}</td><td>${escapeHTML(log.status)}</td></tr>`;
    }).join("");
    const rangeLabel = `${formatDate(start, { month: "long", day: "numeric", year: "numeric" })} – ${formatDate(end, { month: "long", day: "numeric", year: "numeric" })}`;
    reportWindow.document.open();
    reportWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Studywell progress report</title><style>body{font:14px Arial,sans-serif;color:#24301f;margin:36px}h1{margin:0 0 6px}p{color:#596354}.stats{display:flex;gap:20px;margin:22px 0}.stats div{padding:14px;background:#f1f5e9;border-radius:8px;min-width:120px}.stats strong,.stats span{display:block}.stats span{font-size:12px;color:#687064;margin-top:5px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #dfe4d7}th{background:#f4f6ef}small{display:block;margin-top:5px;color:#66735b}footer{margin-top:28px;color:#8a9381;font-size:11px}@media print{body{margin:14mm}button{display:none}}</style></head><body><h1>Studywell progress report</h1><p>${escapeHTML(state.name || "Student")} · ${escapeHTML(rangeLabel)}</p><section class="stats"><div><strong>${escapeHTML(durationLabel(minutes))}</strong><span>Total focused time</span></div><div><strong>${logs.length}</strong><span>Study records</span></div><div><strong>${needsHelp}</strong><span>Topics needing help</span></div></section><table><thead><tr><th>Date</th><th>Subject</th><th>Learning notes</th><th>Time</th><th>Topic progress</th><th>Session</th></tr></thead><tbody>${rows || `<tr><td colspan="6">No study entries in this period.</td></tr>`}</tbody></table><footer>Created by Michael Yugi · Studywell</footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`);
    reportWindow.document.close();
  }
  function renderLogReviews(log) {
    const studentId = selectedStudentId || authUser?.id;
    const reviews = logReviews.filter((review) => review.student_id === studentId && review.log_id === log.id);
    const reviewNotes = reviews.map((review) => `<div class="parent-review"><strong>${review.reviewed ? "Reviewed" : "Parent note"}</strong>${review.comment ? `<p>${escapeHTML(review.comment)}</p>` : ""}<small>${formatDate(new Date(review.updated_at || Date.now()), { month: "short", day: "numeric" })}</small></div>`).join("");
    const myReview = reviews.find((review) => review.reviewer_id === authUser?.id);
    const reviewButton = isParentView() ? `<button class="text-button review-log-button" data-review-log="${escapeHTML(log.id)}">${myReview ? "Update review" : "Mark reviewed / comment"}</button>` : "";
    return reviewNotes || reviewButton ? `<div class="review-area">${reviewNotes}${reviewButton}</div>` : "";
  }
  function openReviewDialog(logId) {
    if (!isParentView()) return;
    const log = state.logs.find((item) => item.id === logId); if (!log) return;
    const mine = logReviews.find((review) => review.log_id === logId && review.reviewer_id === authUser.id);
    $("reviewLogId").value = logId; $("reviewLogSummary").textContent = `${log.subject} · ${log.topic}`;
    $("reviewCommentInput").value = mine?.comment || ""; $("reviewError").textContent = "";
    $("reviewDialog").showModal();
  }
  async function saveLogReview(event) {
    event.preventDefault();
    if (!isParentView() || !selectedStudentId) { $("reviewError").textContent = "Select a linked student first."; return; }
    const logId = $("reviewLogId").value;
    const review = { student_id: selectedStudentId, log_id: logId, reviewer_id: authUser.id, comment: $("reviewCommentInput").value.trim(), reviewed: true, updated_at: new Date().toISOString() };
    $("saveReviewBtn").disabled = true; $("reviewError").textContent = "";
    try {
      const { data, error } = await supabaseClient.from("study_log_reviews").upsert(review, { onConflict: "student_id,log_id,reviewer_id" }).select().single();
      if (error) throw error;
      logReviews = logReviews.filter((item) => !(item.student_id === data.student_id && item.log_id === data.log_id && item.reviewer_id === data.reviewer_id));
      logReviews.unshift(data); $("reviewDialog").close(); renderHistory(); showToast("Study log marked reviewed");
    } catch (error) { $("reviewError").textContent = error.message || "Could not save the review. Run the latest Supabase setup SQL."; }
    finally { $("saveReviewBtn").disabled = false; }
  }
  function renderTimetableRequests() {
    const panel = $("timetableRequestsPanel"); if (!panel) return;
    const visible = Boolean(authUser) && (!isParentView() || Boolean(selectedStudentId));
    panel.hidden = !visible; $("requestTimetableChangeBtn").hidden = !isStudentAccount();
    if (!visible) return;
    const list = $("timetableRequestList");
    if (!timetableRequests.length) { list.innerHTML = `<p class="empty-requests">${isStudentAccount() ? "You have not sent any requests." : "There are no requests for this student."}</p>`; return; }
    list.innerHTML = timetableRequests.map((request) => {
      const statusLabel = request.status === "approved" ? "Approved" : request.status === "declined" ? "Declined" : "Pending";
      const adminActions = isAdminAccount() && request.status === "pending" ? `<div class="request-actions"><button class="button button-quiet" data-request-status="approved" data-request-id="${escapeHTML(request.id)}">Approve</button><button class="button button-quiet" data-request-status="declined" data-request-id="${escapeHTML(request.id)}">Decline</button></div>` : "";
      const kindLabel = request.request_type === "makeup" ? "Make-up lesson" : "Timetable change";
      const makeupAt = request.makeup_date ? `${formatDate(fromISO(request.makeup_date), { weekday: "short", month: "short", day: "numeric" })}${request.makeup_start ? ` · ${formatTime(request.makeup_start)}${request.makeup_end ? `–${formatTime(request.makeup_end)}` : ""}` : ""}` : "";
      return `<article class="request-card"><div class="request-card-heading"><strong>${kindLabel} · ${statusLabel}</strong><small>${formatDate(new Date(request.created_at), { month: "short", day: "numeric" })}</small></div>${makeupAt ? `<small>Proposed make-up: ${escapeHTML(makeupAt)}</small>` : ""}<p>${escapeHTML(request.request_text)}</p>${request.admin_response ? `<small>Admin response: ${escapeHTML(request.admin_response)}</small>` : ""}${request.status === "approved" && isStudentAccount() && request.request_type !== "makeup" ? `<small>The admin will update your timetable.</small>` : ""}${adminActions}</article>`;
    }).join("");
  }
  function openTimetableRequestDialog(log = null) {
    if (!isStudentAccount()) return;
    makeupRequestLog = log;
    $("timetableRequestForm").reset(); $("timetableRequestError").textContent = "";
    $("makeupFields").hidden = !log;
    $("timetableRequestDialogTitle").textContent = log ? "Request a make-up lesson" : "Request a timetable change";
    $("timetableRequestReasonLabel").textContent = log ? "Why was the lesson missed?" : "What change would help?";
    $("timetableRequestInput").placeholder = log ? "For example, I had a family commitment. Could I make up this lesson tomorrow?" : "For example, move Maths revision to Saturday afternoon because of football practice.";
    const makeupDate = new Date(); makeupDate.setDate(makeupDate.getDate() + 1);
    $("makeupDateInput").value = toISO(makeupDate); $("makeupDateInput").min = todayISO();
    $("makeupStartInput").value = log?.plannedStart || "16:00"; $("makeupEndInput").value = log?.plannedEnd || "17:00";
    $("timetableRequestDialog").showModal();
  }
  async function submitTimetableChangeRequest(event) {
    event.preventDefault();
    if (!isStudentAccount()) return;
    const requestText = $("timetableRequestInput").value.trim();
    if (!requestText) { $("timetableRequestError").textContent = "Describe the timetable change you would like."; return; }
    const makeup = Boolean(makeupRequestLog);
    const makeupDate = $("makeupDateInput").value; const makeupStart = $("makeupStartInput").value; const makeupEnd = $("makeupEndInput").value;
    if (makeup && (!makeupDate || !makeupStart || !makeupEnd || makeupEnd <= makeupStart)) { $("timetableRequestError").textContent = "Choose a valid make-up date and a finishing time after the start time."; return; }
    $("submitTimetableRequestBtn").disabled = true; $("timetableRequestError").textContent = "";
    try {
      const { error } = await supabaseClient.from("study_timetable_requests").insert({
        student_id: authUser.id, request_type: makeup ? "makeup" : "timetable_change", request_text: requestText,
        missed_study_date: makeup ? makeupRequestLog.date : null, missed_session_id: makeup ? makeupRequestLog.sessionId : null,
        makeup_date: makeup ? makeupDate : null, makeup_start: makeup ? makeupStart : null, makeup_end: makeup ? makeupEnd : null,
      });
      if (error) throw error;
      timetableRequests = await fetchTimetableRequests(authUser.id); $("timetableRequestDialog").close(); renderTimetableRequests();
      makeupRequestLog = null; showToast(makeup ? "Make-up request sent to the admin" : "Timetable change request sent");
    } catch (error) { $("timetableRequestError").textContent = error.message || "Could not send the request. Run the latest Supabase setup SQL."; }
    finally { $("submitTimetableRequestBtn").disabled = false; }
  }
  async function reviewTimetableChangeRequest(requestId, status) {
    if (!isAdminAccount()) return;
    try {
      const { error } = await supabaseClient.rpc("review_study_timetable_request", { p_request_id: requestId, p_status: status, p_response: "" });
      if (error) throw error;
      timetableRequests = await fetchTimetableRequests(selectedStudentId); renderTimetableRequests();
      const request = timetableRequests.find((item) => item.id === requestId);
      showToast(status === "approved" ? request?.request_type === "makeup" ? "Make-up request approved" : "Timetable request approved" : "Request declined");
    } catch (error) { setCloudStatus(error.message || "Could not update the timetable request. Run the latest Supabase setup SQL."); }
  }
  function renderHistory() {
    renderWeeklySummary();
    const query = $("logSearch").value.trim().toLowerCase();
    const logs = [...state.logs].filter((log) => `${log.subject} ${log.topic} ${log.topicAbout || ""} ${log.whatLearned || ""} ${log.notUnderstood || ""} ${log.notes || ""}`.toLowerCase().includes(query)).sort((a, b) => `${b.date}${b.createdAt || ""}`.localeCompare(`${a.date}${a.createdAt || ""}`));
    $("historyCount").textContent = `${logs.length} ${logs.length === 1 ? "study session" : "study sessions"}`;
    if (!logs.length) { $("historyList").innerHTML = query ? `<div class="empty-history"><strong>No matches yet</strong><span>Try a different subject or topic.</span></div>` : `<div class="empty-history"><span class="empty-plan-icon">◷</span><strong>Your learning starts here</strong><span>Log a session to keep track of what you studied.</span></div>`; return; }
    $("historyList").innerHTML = logs.map((log) => {
      const plannedMinutes = log.plannedStart && log.plannedEnd ? minutesFromTime(log.plannedEnd) - minutesFromTime(log.plannedStart) : 0;
      const durationSummary = `${durationLabel(log.minutes)} focused${plannedMinutes > 0 ? ` · ${durationLabel(plannedMinutes)} planned` : ""}`;
    const reflections = [
        reflectionMarkup("What this topic is about", log.topicAbout),
        reflectionMarkup("What I learned", log.whatLearned),
        reflectionMarkup("What I didn’t understand properly", log.notUnderstood),
      ].join("");
      const missedFollowup = isStudentAccount() && log.status === "missed" && log.sessionId ? `<button class="button button-quiet missed-followup-button" data-makeup-log="${escapeHTML(log.id)}">Request a make-up</button>` : "";
      return `<article class="history-card"><div class="history-card-top"><div class="history-subject"><div class="subject-badge color-${(log.subject.charCodeAt(0) || 0) % 4}">${escapeHTML(log.subject.trim().charAt(0).toUpperCase())}</div><div><strong>${escapeHTML(log.subject)}</strong><span>${formatDate(fromISO(log.date), { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></div></div><span class="duration-pill">${durationSummary}</span></div><div class="history-topic">${escapeHTML(log.topic)}</div>${reflections ? `<div class="history-reflections">${reflections}</div>` : ""}${log.notes ? `<div class="history-notes"><strong>Next step or other notes</strong><p>${escapeHTML(log.notes)}</p></div>` : ""}${renderLogReviews(log)}<div class="history-foot"><span>${log.plannedStart ? `Planned ${formatTime(log.plannedStart)}${log.plannedEnd ? `–${formatTime(log.plannedEnd)}` : ""}` : "Independent study"}</span><span class="topic-progress-pill">${topicProgressLabel(log.topicProgress)}</span><span class="status-pill ${log.status === "partial" ? "partial" : ""}">${log.status === "partial" ? "Partly completed" : log.status === "missed" ? "Missed session" : log.sessionId ? "Completed as planned" : "Study logged"}</span>${missedFollowup}</div></article>`;
    }).join("");
  }
  function navigate(view) {
    document.querySelectorAll(".page-view").forEach((page) => page.classList.toggle("active", page.id === `${view}View`));
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
    $("currentSection").textContent = view === "overview" ? "Overview" : view === "timetable" ? "Timetable" : "Study log";
    if (view === "timetable") renderTimetable(); if (view === "history") renderHistory(); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showToast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => el.classList.remove("show"), 2300); }
  function openSessionDialog(session = null, day = new Date().getDay()) {
    $("sessionForm").reset(); $("sessionError").textContent = ""; $("sessionId").value = session?.id || "";
    $("modalEyebrow").textContent = session ? "TUNE YOUR PLAN" : "ADD TO YOUR TIMETABLE";
    $("modalTitle").textContent = session ? "Edit study session" : "Plan a study session";
    $("saveSessionBtn").textContent = session ? "Save changes" : "Save session";
    $("subjectInput").value = session?.subject || ""; $("focusInput").value = session?.focus || "";
    $("dayInput").value = String(session?.day ?? day); $("startInput").value = session?.start || "16:00"; $("endInput").value = session?.end || "17:00";
    $("sessionDialog").showModal(); $("subjectInput").focus();
  }
  function openLogDialog({ session = null, log = null, minutes = null, timer = false } = {}) {
    const readOnly = isParentView();
    currentLogTimer = Boolean(timer);
    currentLogAutomatic = Boolean(timer || session?.id || log?.sessionId);
    currentLogTimerSeconds = timer && state.activeTimer ? Math.max(0, Math.floor(timerElapsedMs(state.activeTimer) / 1000)) : 0;
    $("logForm").reset(); $("logError").textContent = "";
    ["logSubject", "topicInput", "topicAboutInput", "learnedInput", "topicProgressInput", "notUnderstoodInput", "minutesInput", "logDateInput", "notesInput", "statusInput"].forEach((id) => { $(id).disabled = false; });
    $("saveLogBtn").hidden = false;
    $("logSessionId").value = log?.sessionId || session?.id || "";
    $("logEyebrow").textContent = timer ? "NICE WORK — MAKE A NOTE OF IT" : log ? "YOUR STUDY NOTES" : "MAKE A NOTE OF IT";
    $("logTitle").textContent = readOnly ? "Study record" : log ? "Update study log" : "Log study time";
    $("logSubject").value = log?.subject || session?.subject || "";
    $("topicInput").value = log?.topic || "";
    $("topicAboutInput").value = log?.topicAbout || ""; $("learnedInput").value = log?.whatLearned || "";
    $("topicProgressInput").value = log?.topicProgress || (log?.status === "missed" ? "not_started" : "in_progress");
    $("notUnderstoodInput").value = log?.notUnderstood || "";
    const plannedStart = session?.start || log?.plannedStart; const plannedEnd = session?.end || log?.plannedEnd;
    const plannedMinutes = plannedStart && plannedEnd ? minutesFromTime(plannedEnd) - minutesFromTime(plannedStart) : 0;
    const autoMinutes = timer ? (currentLogTimerSeconds ? Math.max(1, Math.round(currentLogTimerSeconds / 60)) : 0) : minutes;
    const autoStatus = timer ? sessionResultForSeconds(currentLogTimerSeconds, plannedMinutes * 60) : log?.status || "completed";
    $("minutesInput").value = log ? log.minutes : autoMinutes ?? (session ? Math.max(1, plannedMinutes) : "");
    $("logDateInput").value = log?.date || todayISO(); $("logDateInput").max = todayISO(); $("notesInput").value = log?.notes || ""; $("statusInput").value = timer ? autoStatus : log?.status || "completed";
    $("plannedForLabel").textContent = plannedMinutes ? `Planned ${formatTime(plannedStart)}–${formatTime(plannedEnd)} · ${durationLabel(plannedMinutes)} planned` : "Independent study";
    $("timerBanner").hidden = !timer;
    if (timer) $("timerCopy").textContent = state.activeTimer?.autoStoppedAt ? "Stopped at the planned end" : state.activeTimer?.manualStopped ? "Timer finished" : state.activeTimer?.pausedAt ? "Timer paused" : "Focused time";
    $("saveLogBtn").textContent = log ? "Save changes" : "Save study log"; updateLogStatusFields();
    ["logSubject", "topicInput", "topicAboutInput", "learnedInput", "topicProgressInput", "notUnderstoodInput", "minutesInput", "logDateInput", "notesInput", "statusInput"].forEach((id) => { $(id).disabled = readOnly || (currentLogAutomatic && ["minutesInput", "statusInput", "logDateInput"].includes(id)) || (id !== "logSubject" && id !== "logDateInput" && id !== "notesInput" && $("statusInput").value === "missed"); });
    $("saveLogBtn").hidden = readOnly;
    $("logDialog").showModal(); if (timer) updateTimerText(); if (!readOnly) $("topicInput").focus();
  }
  function formatElapsed() { if (!state.activeTimer) return "00:00"; const sec = Math.max(0, Math.floor(timerElapsedMs() / 1000)); return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; }
  function updateTimerText() { $("timerText").textContent = formatElapsed(); }
  async function startTimer(session) {
    if (isParentView() || state.activeTimer) return;
    const date = todayISO(); const now = Date.now(); const plannedStartAt = sessionBoundary(session, date, "start"); const plannedEndAt = sessionBoundary(session, date, "end");
    if (now < plannedStartAt) return;
    if (now >= plannedEndAt) return;
    const startingTimer = { sessionId: session.id, date, startedAt: now, runningSince: now, accumulatedMs: 0, plannedStartAt, plannedEndAt, pausedAt: null, autoStoppedAt: null, manualStopped: false };
    try { await persistTimerAction(startingTimer, "start"); }
    catch (error) { setCloudStatus(error.message || "Could not start and sync this lesson timer."); showToast("Timer could not sync; check your connection"); return; }
    const startedAt = Date.now(); startingTimer.startedAt = startedAt; startingTimer.runningSince = startedAt;
    state.activeTimer = startingTimer;
    saveState(); ensureTimerLoop(); renderOverview(); showToast(`Focus timer started for ${session.subject}`);
  }
  async function pauseTimer(session) {
    const timer = state.activeTimer; if (!timer || timer.pausedAt || timer.autoStoppedAt || timer.manualStopped) return;
    const now = Date.now(); const endAt = timerEndAt(timer, session);
    if (endAt && now >= endAt) return autoStopTimer(session);
    try { await persistTimerAction(timer, "pause"); }
    catch (error) { setCloudStatus(error.message || "Could not sync the paused timer."); showToast("Pause did not sync; try again"); return; }
    timer.accumulatedMs = timerElapsedMs(timer, now); timer.runningSince = null; timer.pausedAt = now;
    saveState(); updateTimerText(); renderOverview(); showToast("Timer paused");
  }
  async function resumeTimer(session) {
    const timer = state.activeTimer; if (!timer || !timer.pausedAt || timer.autoStoppedAt || timer.manualStopped) return;
    const now = Date.now(); const endAt = timerEndAt(timer, session);
    if (endAt && now >= endAt) return autoStopTimer(session);
    try { await persistTimerAction(timer, "resume"); }
    catch (error) { setCloudStatus(error.message || "Could not sync the resumed timer."); showToast("Resume did not sync; try again"); return; }
    timer.runningSince = now; timer.pausedAt = null;
    saveState(); ensureTimerLoop(); renderOverview(); showToast("Timer resumed");
  }
  function timerTick() {
    const timer = state.activeTimer;
    if (!timer) { clearInterval(timerInterval); timerInterval = null; return; }
    const session = state.schedule.find((item) => item.id === timer.sessionId);
    const endAt = timerEndAt(timer, session);
    if (!timer.autoStoppedAt && !timer.manualStopped && endAt && Date.now() >= endAt) return autoStopTimer(session);
    if (!timer.pausedAt && !timer.autoStoppedAt && !timer.manualStopped) updateTimerText();
    renderToday();
  }
  function ensureTimerLoop() {
    if (!state.activeTimer || state.activeTimer.autoStoppedAt || state.activeTimer.manualStopped) {
      clearInterval(timerInterval); timerInterval = null; return;
    }
    if (!timerInterval) timerInterval = setInterval(timerTick, 1000);
    timerTick();
  }
  function autoStopTimer(session) {
    const timer = state.activeTimer; if (!timer || timer.autoStoppedAt || timer.manualStopped) return;
    const endAt = timerEndAt(timer, session); if (!endAt) return;
    const elapsedMs = timerElapsedMs(timer, endAt);
    void persistTimerAction(timer, "finish").catch(() => setCloudStatus("Timer stopped here; Supabase will finalize the saved timer at the scheduled end."));
    timer.accumulatedMs = elapsedMs; timer.runningSince = null; timer.autoStoppedAt = endAt;
    saveState(); clearInterval(timerInterval); timerInterval = null; renderOverview();
    if (session) {
      openLogDialog({ session, minutes: Math.max(0, Math.round(elapsedMs / 60000)), timer: true });
      showToast("Timer stopped at the scheduled lesson end");
    }
  }
  async function finishTimer(session) {
    const timer = state.activeTimer; if (!timer) return;
    if (timer.autoStoppedAt || timer.manualStopped) {
      openLogDialog({ session, minutes: Math.max(0, Math.round(timerElapsedMs(timer) / 60000)), timer: true }); return;
    }
    const now = Date.now(); const endAt = timerEndAt(timer, session);
    if (endAt && now >= endAt) return autoStopTimer(session);
    try { await persistTimerAction(timer, "finish"); }
    catch (error) { setCloudStatus(error.message || "Could not sync the finished timer."); showToast("Finish did not sync; try again"); return; }
    const elapsedMs = timerElapsedMs(timer, now);
    timer.accumulatedMs = elapsedMs; timer.runningSince = null; timer.pausedAt = now; timer.manualStopped = true;
    saveState(); clearInterval(timerInterval); timerInterval = null; renderOverview();
    openLogDialog({ session, minutes: Math.max(0, Math.round(elapsedMs / 60000)), timer: true });
  }
  function finishTimerState() { state.activeTimer = null; clearInterval(timerInterval); timerInterval = null; }
  function saveLog() {
    if (isParentView()) { $("logError").textContent = "Parent accounts can view logs but cannot edit them."; return false; }
    const id = $("logSessionId").value; const session = state.schedule.find((item) => item.id === id);
    const timer = currentLogTimer && state.activeTimer?.sessionId === id ? state.activeTimer : null;
    const studyDate = $("logDateInput").value;
    const existingServerResult = timer && state.logs.find((log) => log.sessionId === id && log.date === studyDate && ["Details not added yet", "Session missed"].includes(log.topic));
    const plannedSeconds = session ? (minutesFromTime(session.end) - minutesFromTime(session.start)) * 60 : 0;
    const status = timer ? existingServerResult?.status || sessionResultForSeconds(currentLogTimerSeconds, plannedSeconds) : $("statusInput").value;
    const topic = $("topicInput").value.trim();
    const minutes = status === "missed" ? 0 : timer ? existingServerResult?.minutes ?? Math.max(1, Math.round(currentLogTimerSeconds / 60)) : Number($("minutesInput").value);
    if (!$("logSubject").value.trim() || (status !== "missed" && !topic) || !$("logDateInput").value || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { $("logError").textContent = status === "missed" ? "Add a subject and valid study date." : "Add a subject, topic, valid date, and minutes studied."; return false; }
    if (state.activeTimer && session && state.activeTimer.sessionId === session.id) finishTimerState();
    const date = $("logDateInput").value; const priorIndex = state.logs.findIndex((log) => log.sessionId === id && id && log.date === date);
    const prior = priorIndex >= 0 ? state.logs[priorIndex] : null;
    const entry = { id: prior?.id || (id ? `session:${id}:${date}` : uid()), sessionId: id || null, date, subject: $("logSubject").value.trim(), topic: status === "missed" ? topic || "Session missed" : topic, topicAbout: status === "missed" ? "" : $("topicAboutInput").value.trim(), whatLearned: status === "missed" ? "" : $("learnedInput").value.trim(), topicProgress: status === "missed" ? "not_started" : $("topicProgressInput").value, notUnderstood: status === "missed" ? "" : $("notUnderstoodInput").value.trim(), minutes, notes: $("notesInput").value.trim(), status, plannedStart: session?.start || prior?.plannedStart || null, plannedEnd: session?.end || prior?.plannedEnd || null, createdAt: prior?.createdAt || new Date().toISOString() };
    if (priorIndex >= 0) state.logs[priorIndex] = entry; else state.logs.push(entry);
    saveState(); $("logDialog").close(); renderOverview(); renderHistory();
    if (isStudentAccount()) void syncLog(entry);
    currentLogTimer = false; currentLogAutomatic = false; currentLogTimerSeconds = 0;
    showToast(prior ? "Study log updated" : "Study session saved"); return true;
  }
  function markMissed(session, date = todayISO()) {
    const existing = getOccurrenceLog(session.id, date);
    if (existing) return;
    state.logs.push({ id: `session:${session.id}:${date}`, sessionId: session.id, date, subject: session.subject, topic: "Session missed", topicAbout: "", whatLearned: "", topicProgress: "not_started", notUnderstood: "", minutes: 0, notes: "", status: "missed", plannedStart: session.start, plannedEnd: session.end, createdAt: new Date().toISOString() });
    saveState(); renderOverview(); renderHistory(); if (isStudentAccount()) void syncLog(state.logs[state.logs.length - 1]); showToast("Session marked as missed");
  }
  async function refreshStudyLogs() {
    if (!supabaseClient || !authUser) return;
    const studentId = isStudentAccount() ? authUser.id : selectedStudentId;
    if (!studentId) return;
    try {
      if (isParentView()) {
        try { timerSessions = await fetchStudentTimerSessions(studentId); }
        catch (_) { timerSessions = []; }
      }
      const remote = await fetchStudentLogs(studentId);
      const remoteIds = new Set(remote.map((log) => log.id));
      const remoteOccurrences = new Set(remote.filter((log) => log.sessionId).map((log) => `${log.sessionId}|${log.date}`));
      const mergedRemote = remote.map((remoteLog) => {
        const localLog = state.logs.find((log) => log.id === remoteLog.id || (remoteLog.sessionId && log.sessionId === remoteLog.sessionId && log.date === remoteLog.date));
        if (!localLog || !remoteLog.sessionId || localLog.topic === "Details not added yet" || localLog.topic === "Session missed") return remoteLog;
        return { ...remoteLog, topic: localLog.topic, topicAbout: localLog.topicAbout || remoteLog.topicAbout,
          whatLearned: localLog.whatLearned || remoteLog.whatLearned, topicProgress: localLog.topicProgress || remoteLog.topicProgress,
          notUnderstood: localLog.notUnderstood || remoteLog.notUnderstood, notes: localLog.notes || remoteLog.notes };
      });
      const pendingLocal = state.logs.filter((log) => !remoteIds.has(log.id) && !(log.sessionId && remoteOccurrences.has(`${log.sessionId}|${log.date}`)));
      state.logs = [...mergedRemote, ...pendingLocal];
      if (isStudentAccount()) saveState();
      renderOverview(); if ($("historyView").classList.contains("active")) renderHistory();
    } catch (_) { /* The next refresh will retry. */ }
  }
  function updateLogStatusFields() {
    const missed = $("statusInput").value === "missed";
    $("topicInput").required = !missed;
    $("topicInput").placeholder = missed ? "Leave blank if no study took place" : "e.g. Causes of the French Revolution";
    $("minutesInput").disabled = missed;
    if (missed) $("minutesInput").value = "0";
    else if ($("minutesInput").value === "0") $("minutesInput").value = "";
    ["topicAboutInput", "learnedInput", "topicProgressInput", "notUnderstoodInput"].forEach((id) => { $(id).disabled = missed || isParentView(); });
    if (missed) $("topicProgressInput").value = "not_started";
    else if ($("topicProgressInput").value === "not_started") $("topicProgressInput").value = "in_progress";
  }

  function isStudentAccount() { return Boolean(authUser && accountProfile?.account_type === "student"); }
  function isParentAccount() { return Boolean(authUser && accountProfile?.account_type === "parent"); }
  function isAdminAccount() { return Boolean(authUser && accountProfile?.account_type === "admin"); }
  function isParentView() { return Boolean(authUser && ["parent", "admin"].includes(accountProfile?.account_type)); }
  function canEditTimetable() { return isAdminAccount() ? Boolean(selectedStudentId) : !authUser; }
  function reminderPreferenceKey() { return `${STORAGE_KEY}:reminders:${authUser?.id || "guest"}`; }
  function reminderSentKey() { return `${STORAGE_KEY}:sent-reminders:${authUser?.id || "guest"}`; }
  function updateReminderControls() {
    const button = $("reminderToggleBtn"); if (!button) return;
    const enabled = localStorage.getItem(reminderPreferenceKey()) === "true";
    const pushRegistered = localStorage.getItem(`${reminderPreferenceKey()}:push`) === "true";
    button.textContent = enabled ? "Turn off study reminders" : "Enable study reminders";
    $("reminderStatus").textContent = enabled
      ? pushRegistered ? "This device is registered for push. Closed-site delivery needs the Supabase push setup to be active." : "Reminders appear while Studywell is open. Closed-site push setup is still needed."
      : "Turn reminders on for a notice before a lesson and a prompt to update your log afterward.";
  }
  function base64UrlToBytes(value) {
    const padded = `${value}${"=".repeat((4 - value.length % 4) % 4)}`;
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  async function toggleStudyReminders() {
    const enabled = localStorage.getItem(reminderPreferenceKey()) === "true";
    if (enabled) {
      try {
        const registration = await navigator.serviceWorker?.getRegistration("./");
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
          if (isStudentAccount()) await supabaseClient.from("study_push_subscriptions").delete().eq("endpoint", subscription.endpoint);
          await subscription.unsubscribe();
        }
      } catch (_) { /* A stale browser subscription should not block disabling reminders. */ }
      localStorage.removeItem(reminderPreferenceKey()); localStorage.removeItem(`${reminderPreferenceKey()}:push`); updateReminderControls(); showToast("Study reminders turned off"); return;
    }
    if (!("Notification" in window)) { $("reminderStatus").textContent = "This browser does not support desktop reminders."; return; }
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") { $("reminderStatus").textContent = "Allow notifications in your browser to turn on study reminders."; return; }
    if (window.STUDYWELL_SUPABASE?.pushPublicKey && isStudentAccount() && "serviceWorker" in navigator && "PushManager" in window) {
      try {
        const registration = await navigator.serviceWorker.register("./service-worker.js");
        const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(window.STUDYWELL_SUPABASE.pushPublicKey),
        });
        const json = subscription.toJSON();
        const { error } = await supabaseClient.from("study_push_subscriptions").upsert({
          endpoint: json.endpoint, student_id: authUser.id,
          p256dh: json.keys?.p256dh, auth_secret: json.keys?.auth, updated_at: new Date().toISOString(),
        }, { onConflict: "endpoint" });
        if (error) throw error;
        localStorage.setItem(`${reminderPreferenceKey()}:push`, "true");
      } catch (error) {
        $("reminderStatus").textContent = error.message || "Could not register this device for push reminders. Check the Supabase push setup.";
        return;
      }
    }
    localStorage.setItem(reminderPreferenceKey(), "true"); updateReminderControls(); showToast("Study reminders enabled");
  }
  function sendStudyReminderOnce(key, title, body) {
    try {
      const sent = JSON.parse(localStorage.getItem(reminderSentKey()) || "[]");
      if (sent.includes(key)) return;
      new Notification(title, { body, tag: key });
      localStorage.setItem(reminderSentKey(), JSON.stringify([...sent.slice(-99), key]));
    } catch (_) { /* Notifications are optional; the tracker still works without them. */ }
  }
  function checkStudyReminders() {
    if (!isStudentAccount() || localStorage.getItem(reminderPreferenceKey()) !== "true" || !("Notification" in window) || Notification.permission !== "granted") return;
    const today = todayISO(); const now = Date.now(); const tenMinutes = 10 * 60 * 1000;
    for (const session of state.schedule.filter((item) => Number(item.day) === new Date().getDay())) {
      const startAt = sessionBoundary(session, today, "start"); const endAt = sessionBoundary(session, today, "end");
      const log = getOccurrenceLog(session.id, today);
      if (!log && now >= startAt - tenMinutes && now < startAt) {
        sendStudyReminderOnce(`start:${today}:${session.id}`, "Studywell lesson reminder", `${session.subject} starts at ${formatTime(session.start)}.`);
      }
      if (!log && now >= endAt && now < endAt + 30 * 60 * 1000 && state.activeTimer?.sessionId !== session.id) {
        sendStudyReminderOnce(`log:${today}:${session.id}`, "Remember to log your lesson", `Add what you studied in ${session.subject}.`);
      }
    }
  }
  function setCloudStatus(message) {
    const button = $("syncAccountBtn");
    if (button) { button.textContent = authUser ? (isAdminAccount() ? "Admin account" : isParentView() ? "Parent account" : "Synced account") : "Sign in to sync"; button.title = message; }
    const messageEl = $("cloudMessage"); if (messageEl) messageEl.textContent = message;
  }
  function renderCloudControls() {
    const parent = isParentView(); const admin = isAdminAccount();
    $("quickLogBtn").hidden = parent; $("historyLogBtn").hidden = parent; $("addSessionBtn").hidden = !canEditTimetable();
    $("editNameBtn").hidden = parent;
    $("adminTimetableTools").hidden = !admin || !selectedStudentId;
    $("timetableRequestsPanel").hidden = !authUser || (parent && !selectedStudentId);
    $("requestTimetableChangeBtn").hidden = !isStudentAccount();
    $("timetableIntro").textContent = admin ? "Edit the selected student's timetable here. Changes save to their account." : parent ? "View the selected student's timetable. The admin manages schedules." : isStudentAccount() ? "The admin manages this timetable. Use your student account to log what you study." : "Set the sessions you want to make time for. You can change your plan whenever life changes.";
    $("studentPicker").hidden = !parent || linkedStudents.length === 0;
    if (parent && linkedStudents.length) {
      const picker = $("studentPicker");
      picker.replaceChildren(...linkedStudents.map((student) => { const option = document.createElement("option"); option.value = student.id; option.textContent = student.display_name; return option; }));
      picker.value = selectedStudentId || linkedStudents[0].id;
    }
    updateReminderControls(); renderTimetableRequests();
    setCloudStatus(authUser ? (admin ? "Admin view: linked study logs are read-only; you can manage student timetables." : parent ? "Parent view: linked study logs are read-only." : "Study data is syncing to your account.") : "Study data stays on this device until you sign in.");
  }
  function renderLinkedStudentsList() {
    $("linkedStudentsList").replaceChildren(...linkedStudents.map((student) => {
      const item = document.createElement("div"); item.className = "linked-student"; item.textContent = `${student.display_name} · linked student`; return item;
    }));
  }
  function setAccountMode(mode) {
    authMode = mode;
    document.querySelectorAll(".auth-mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    $("signupFields").hidden = mode !== "signup";
    $("accountDialogTitle").textContent = mode === "signup" ? "Create a Studywell account" : "Sync your study data";
    $("accountSubmit").textContent = mode === "signup" ? "Create account" : "Sign in";
    $("accountError").textContent = "";
  }
  function openAccountDialog() {
    $("accountError").textContent = ""; $("linkError").textContent = "";
    $("authPanel").hidden = Boolean(authUser); $("linkPanel").hidden = !authUser;
    if (authUser) {
      $("accountDialogTitle").textContent = isAdminAccount() ? "Admin tools" : isParentView() ? "Parent account" : "Cloud sync";
      $("signedInSummary").textContent = `${accountProfile?.display_name || authUser.email} · ${isAdminAccount() ? "Admin" : isParentView() ? "Parent" : "Student"}`;
      $("parentTools").hidden = !isParentAccount(); $("adminTools").hidden = !isAdminAccount(); $("studentTools").hidden = !isStudentAccount();
      $("parentToolsIntro").textContent = "Create a one-time code for each student. You can view linked students’ timetables and study logs; the admin manages schedules.";
      $("createInviteBtn").textContent = linkedStudents.length ? "Create another student code" : "Create student link code";
      renderLinkedStudentsList();
    } else setAccountMode("signin");
    $("accountDialog").showModal();
  }
  function readCachedUserState(userId) {
    try {
      const saved = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:user:${userId}`));
      if (saved && Array.isArray(saved.schedule) && Array.isArray(saved.logs)) return { ...defaultState, ...saved };
    } catch (_) { /* Ignore a damaged per-user cache and recover from the cloud. */ }
    return null;
  }
  function toRemoteLog(log, studentId) {
    return {
      student_id: studentId, id: log.id, session_id: log.sessionId || null, study_date: log.date,
      subject: log.subject, topic: log.topic, minutes: Number(log.minutes || 0), notes: log.notes || "",
      topic_about: log.topicAbout || "", what_learned: log.whatLearned || "", topic_progress: log.topicProgress || "in_progress", not_understood: log.notUnderstood || "",
      status: log.status, planned_start: log.plannedStart || null, planned_end: log.plannedEnd || null,
      created_at: log.createdAt || new Date().toISOString(),
    };
  }
  function fromRemoteLog(row) {
    return {
      id: row.id, sessionId: row.session_id, date: row.study_date, subject: row.subject, topic: row.topic,
      minutes: row.minutes, notes: row.notes || "", topicAbout: row.topic_about || "", whatLearned: row.what_learned || "", topicProgress: row.topic_progress || "in_progress", notUnderstood: row.not_understood || "", status: row.status, plannedStart: row.planned_start,
      plannedEnd: row.planned_end, createdAt: row.created_at,
    };
  }
  async function uploadStudentLogs(logs) {
    if (!logs.length) return true;
    const { error } = await supabaseClient.from("study_logs").upsert(logs.map((log) => toRemoteLog(log, authUser.id)), { onConflict: "student_id,id" });
    if (error) throw error;
    return true;
  }
  async function fetchStudentLogs(studentId) {
    const { data, error } = await supabaseClient.from("study_logs").select("*").eq("student_id", studentId).order("study_date", { ascending: false });
    if (error) throw error;
    return (data || []).map(fromRemoteLog);
  }
  async function fetchStudentTimerSessions(studentId) {
    const { data, error } = await supabaseClient.from("study_timer_sessions").select("*")
      .eq("student_id", studentId).eq("study_date", todayISO());
    if (error) throw error;
    return data || [];
  }
  function timerSessionElapsedSeconds(timer, now = Date.now()) {
    let seconds = Math.max(0, Number(timer.focused_seconds) || 0);
    if (timer.status === "running" && timer.last_started_at) {
      const startedAt = Date.parse(timer.last_started_at);
      const plannedEndAt = Date.parse(timer.planned_end_at);
      if (Number.isFinite(startedAt)) seconds += Math.max(0, (Math.min(now, Number.isFinite(plannedEndAt) ? plannedEndAt : now) - startedAt) / 1000);
    }
    return Math.floor(seconds);
  }
  function formatTimestampTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  function restoreStudentTimerSession(remoteTimers) {
    const unloggedTimers = remoteTimers.filter((timer) => !getOccurrenceLog(timer.session_id, timer.study_date));
    const timer = unloggedTimers.find((item) => item.status === "running" || item.status === "paused")
      || unloggedTimers.filter((item) => item.status === "finished" || item.status === "auto_stopped")
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    if (!timer) { state.activeTimer = null; return; }
    const plannedStartAt = Date.parse(timer.planned_start_at);
    const plannedEndAt = Date.parse(timer.planned_end_at);
    const startedAt = Date.parse(timer.started_at);
    const lastStartedAt = Date.parse(timer.last_started_at);
    state.activeTimer = {
      sessionId: timer.session_id,
      date: timer.study_date,
      startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
      runningSince: timer.status === "running" ? (Number.isFinite(lastStartedAt) ? lastStartedAt : Date.now()) : null,
      accumulatedMs: Math.max(0, Number(timer.focused_seconds) || 0) * 1000,
      plannedStartAt: Number.isFinite(plannedStartAt) ? plannedStartAt : 0,
      plannedEndAt: Number.isFinite(plannedEndAt) ? plannedEndAt : 0,
      pausedAt: timer.status === "paused" ? (Date.parse(timer.updated_at) || Date.now()) : null,
      autoStoppedAt: timer.status === "auto_stopped" ? (Number.isFinite(plannedEndAt) ? plannedEndAt : Date.now()) : null,
      manualStopped: timer.status === "finished",
    };
  }
  async function loadStudentExtras(studentId) {
    let setupMissing = false;
    const { data: reviews, error: reviewsError } = await supabaseClient.from("study_log_reviews").select("*").eq("student_id", studentId).order("updated_at", { ascending: false });
    if (reviewsError) { logReviews = []; setupMissing = true; }
    else logReviews = reviews || [];
    const { data: requests, error: requestsError } = await supabaseClient.from("study_timetable_requests").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
    if (requestsError) { timetableRequests = []; setupMissing = true; }
    else timetableRequests = requests || [];
    if (setupMissing) setCloudStatus("For parent reviews and timetable requests, run the latest Studywell setup SQL in Supabase.");
    return !setupMissing;
  }
  async function fetchTimetableRequests(studentId) {
    const { data, error } = await supabaseClient.from("study_timetable_requests").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  async function syncStudentDisplayName() {
    if (!isStudentAccount()) return;
    const { error } = await supabaseClient.rpc("update_my_display_name", { p_display_name: state.name || "Student" });
    if (error) { setCloudStatus("Could not sync your name. Your local copy is saved."); return false; }
    accountProfile.display_name = state.name || accountProfile.display_name;
    setCloudStatus("Your name is synced to your account.");
    return true;
  }
  async function syncSelectedStudentTimetable() {
    if (!isAdminAccount() || !selectedStudentId) throw new Error("Sign in as admin and select a linked student first.");
    const { error } = await supabaseClient.rpc("update_student_timetable", { p_student_id: selectedStudentId, p_timetable: state.schedule });
    if (error) throw error;
    const student = linkedStudents.find((item) => item.id === selectedStudentId);
    if (student) student.timetable = state.schedule;
    setCloudStatus(`${student?.display_name || "Student"}'s timetable was updated.`);
  }
  async function applyTimetablePreset() {
    if (!isAdminAccount() || !selectedStudentId) return;
    const preset = $("adminTimetablePreset").value;
    if (!preset) { setCloudStatus("Choose a starting timetable first."); return; }
    if (state.schedule.length && !window.confirm("Replace this student's current timetable with the selected timetable?")) return;
    const previousSchedule = state.schedule;
    state.schedule = (preset === "ann" ? ANN_TIMETABLE : LEWI_TIMETABLE).map((session) => ({ ...session }));
    renderTimetable(); renderOverview();
    try {
      await syncSelectedStudentTimetable();
      $("adminTimetablePreset").value = "";
      showToast("Student timetable updated");
    } catch (error) {
      state.schedule = previousSchedule;
      renderTimetable(); renderOverview();
      setCloudStatus(error.message || "Could not update the student's timetable.");
    }
  }
  async function syncLog(log) {
    if (!isStudentAccount()) return;
    setCloudStatus("Syncing study log…");
    try {
      await uploadStudentLogs([log]);
      setCloudStatus("Study log synced to your account.");
    } catch (error) {
      setCloudStatus("Saved on this device; cloud sync will retry when you reconnect.");
    }
  }
  async function loadStudentAccountState() {
    timerSessions = [];
    let saved = readCachedUserState(authUser.id);
    let importingFirstLocalUse = false;
    if (!saved && !localStorage.getItem(LOCAL_MIGRATION_KEY)) {
      saved = loadState();
      importingFirstLocalUse = true;
    }
    const serverTimetable = Array.isArray(accountProfile.timetable) ? accountProfile.timetable : [];
    state = saved || { ...defaultState, name: accountProfile.display_name || "Student", schedule: serverTimetable, logs: [], activeTimer: null };
    state.name = accountProfile.display_name || state.name || "Student";
    state.schedule = serverTimetable;
    state.weeklyGoalMinutes = Number(accountProfile.weekly_goal_minutes) || 300;
    setCloudStatus("Syncing this student's timetable and study logs…");
    try {
      await uploadStudentLogs(state.logs);
      if (importingFirstLocalUse) localStorage.setItem(LOCAL_MIGRATION_KEY, authUser.id);
      state.logs = await fetchStudentLogs(authUser.id);
      try {
        const timers = await fetchStudentTimerSessions(authUser.id);
        restoreStudentTimerSession(timers);
      } catch (_) { /* Keep the locally cached timer if the timer table cannot be reached. */ }
      const extrasReady = await loadStudentExtras(authUser.id);
      saveState();
      ensureTimerLoop();
      if (extrasReady) setCloudStatus("Study logs and timetable are synced.");
    } catch (error) {
      saveState();
      setCloudStatus("Could not reach the cloud. Your local study data is saved and will retry next sign-in.");
    }
  }
  async function loadParentStudents() {
    let linksQuery = supabaseClient.from("study_access").select("student_id");
    if (!isAdminAccount()) linksQuery = linksQuery.eq("parent_id", authUser.id);
    const { data: links, error: linksError } = await linksQuery;
    if (linksError) throw linksError;
    const ids = (links || []).map((link) => link.student_id);
    if (!ids.length) {
      linkedStudents = []; selectedStudentId = null;
      timerSessions = [];
      state = { ...defaultState, name: accountProfile.display_name || (isAdminAccount() ? "Admin" : "Parent"), schedule: [], logs: [], activeTimer: null };
      logReviews = []; timetableRequests = [];
      return;
    }
     const { data: profiles, error: profileError } = await supabaseClient.from("study_profiles").select("id,display_name,timetable,weekly_goal_minutes,time_zone").in("id", ids);
    if (profileError) throw profileError;
    linkedStudents = (profiles || []).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
    if (!linkedStudents.some((student) => student.id === selectedStudentId)) selectedStudentId = linkedStudents[0]?.id || null;
    await loadSelectedStudent();
  }
  async function loadSelectedStudent() {
    const student = linkedStudents.find((item) => item.id === selectedStudentId);
    timerSessions = [];
    if (!student) return;
    state = { ...defaultState, name: student.display_name || "Student", schedule: Array.isArray(student.timetable) ? student.timetable : [], logs: [], activeTimer: null, weeklyGoalMinutes: Number(student.weekly_goal_minutes) || 300 };
    try { state.logs = await fetchStudentLogs(student.id); }
    catch (_) { setCloudStatus("Could not load this student's cloud logs."); }
    try {
      timerSessions = await fetchStudentTimerSessions(student.id);
      setCloudStatus(`Viewing ${student.display_name}'s synced study logs and live timer.`);
    } catch (_) { setCloudStatus("Study logs loaded; could not load this student's live timer."); }
    await loadStudentExtras(student.id);
    renderTimetableRequests(); renderOverview(); if ($("historyView").classList.contains("active")) renderHistory();
  }
  async function refreshParentStudents() {
    if (!isParentView()) return;
    ["refreshStudentsBtn", "refreshAdminStudentsBtn"].forEach((id) => { $(id).disabled = true; }); $("linkError").textContent = "";
    try {
      await loadParentStudents(); renderCloudControls(); renderLinkedStudentsList(); renderOverview();
      if ($("historyView").classList.contains("active")) renderHistory();
      $("linkError").textContent = linkedStudents.length ? "Student list refreshed." : "No students linked yet. Create a separate code for each student.";
    } catch (error) { $("linkError").textContent = error.message || "Could not refresh the student list."; }
    finally { ["refreshStudentsBtn", "refreshAdminStudentsBtn"].forEach((id) => { $(id).disabled = false; }); }
  }
  async function handleAuthSession(session) {
    if (!session) {
      authUser = null; accountProfile = null; linkedStudents = []; selectedStudentId = null; timerSessions = []; logReviews = []; timetableRequests = []; state = loadState();
      renderCloudControls(); renderOverview(); if ($("historyView").classList.contains("active")) renderHistory();
      return;
    }
    authUser = session.user;
    setCloudStatus("Loading your Studywell account…");
    const { data: profile, error } = await supabaseClient.from("study_profiles").select("*").eq("id", authUser.id).maybeSingle();
    if (error || !profile) { setCloudStatus("Account profile missing. Run the Studywell database setup SQL first."); return; }
    accountProfile = profile;
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timeZone && timeZone !== accountProfile.time_zone) void supabaseClient.rpc("update_my_time_zone", { p_time_zone: timeZone });
      if (isParentView()) await loadParentStudents();
      else { linkedStudents = []; selectedStudentId = null; await loadStudentAccountState(); }
      renderCloudControls(); renderOverview(); if ($("historyView").classList.contains("active")) renderHistory();
    } catch (error) {
      setCloudStatus("Cloud setup is incomplete. Check the Studywell SQL setup and try again.");
    }
  }
  async function initializeCloud() {
    if (!supabaseClient) { setCloudStatus("Cloud connection is not configured."); return; }
    supabaseClient.auth.onAuthStateChange((_event, session) => { window.setTimeout(() => void handleAuthSession(session), 0); });
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) { setCloudStatus("Could not check your cloud session."); return; }
    await handleAuthSession(data.session);
  }
  async function submitAccountForm() {
    if (!supabaseClient) { $("accountError").textContent = "Cloud setup is not configured."; return; }
    const email = $("accountEmail").value.trim(); const password = $("accountPassword").value;
    if (!email || password.length < 8) { $("accountError").textContent = "Enter your email and a password with at least 8 characters."; return; }
    $("accountSubmit").disabled = true; $("accountError").textContent = "";
    try {
      if (authMode === "signup") {
        const displayName = $("accountName").value.trim();
        if (!displayName) { $("accountError").textContent = "Add your name to create an account."; return; }
        const accountType = $("accountType").value;
        const { data, error } = await supabaseClient.auth.signUp({
          email, password,
          options: { data: { display_name: displayName, account_type: accountType }, emailRedirectTo: PUBLIC_APP_URL },
        });
        if (error) throw error;
        if (data.session) { await handleAuthSession(data.session); $("accountDialog").close(); showToast("Studywell account created"); }
        else { $("cloudMessage").textContent = "Check your email to confirm the account, then return here to sign in."; $("accountError").textContent = "Confirmation email sent."; }
      } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await handleAuthSession(data.session); $("accountDialog").close(); showToast("Signed in and syncing");
      }
    } catch (error) { $("accountError").textContent = error.message || "Could not sign in. Check the details and try again."; }
    finally { $("accountSubmit").disabled = false; }
  }
  async function createInviteCode() {
    $("linkError").textContent = ""; $("createInviteBtn").disabled = true;
    try {
      const { data, error } = await supabaseClient.rpc("create_study_invite");
      if (error) throw error;
      $("inviteCodeText").textContent = data; $("inviteCodeBox").hidden = false;
    } catch (error) { $("linkError").textContent = error.message || "Could not create a link code. Check the database setup."; }
    finally { $("createInviteBtn").disabled = false; }
  }
  async function redeemInviteCode() {
    const code = $("parentCodeInput").value.trim().toUpperCase();
    if (!code) { $("linkError").textContent = "Enter the code from your parent or teacher."; return; }
    $("linkError").textContent = ""; $("redeemInviteBtn").disabled = true;
    try {
      const { error } = await supabaseClient.rpc("redeem_study_invite", { p_code: code });
      if (error) throw error;
      $("parentCodeInput").value = ""; $("linkError").textContent = "Linked. Your parent can now view your synced study logs.";
      await handleAuthSession({ user: authUser });
      showToast("Parent link created");
    } catch (error) { $("linkError").textContent = error.message || "That code could not be used."; }
    finally { $("redeemInviteBtn").disabled = false; }
  }

  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.go)));
  $("quickLogBtn").addEventListener("click", () => openLogDialog()); $("historyLogBtn").addEventListener("click", () => openLogDialog()); $("addSessionBtn").addEventListener("click", () => { if (canEditTimetable()) openSessionDialog(); });
  $("syncAccountBtn").addEventListener("click", openAccountDialog);
  document.querySelectorAll(".auth-mode").forEach((button) => button.addEventListener("click", () => setAccountMode(button.dataset.mode)));
  $("accountSubmit").addEventListener("click", () => void submitAccountForm());
  $("applyTimetablePresetBtn").addEventListener("click", () => void applyTimetablePreset());
  $("printReportBtn").addEventListener("click", printStudyReport);
  $("saveWeeklyGoalBtn").addEventListener("click", () => void saveWeeklyGoal());
  $("requestTimetableChangeBtn").addEventListener("click", openTimetableRequestDialog);
  $("timetableRequestForm").addEventListener("submit", (event) => void submitTimetableChangeRequest(event));
  $("reviewForm").addEventListener("submit", (event) => void saveLogReview(event));
  $("reminderToggleBtn").addEventListener("click", () => void toggleStudyReminders());
  $("createInviteBtn").addEventListener("click", () => void createInviteCode());
  $("refreshStudentsBtn").addEventListener("click", () => void refreshParentStudents());
  $("refreshAdminStudentsBtn").addEventListener("click", () => void refreshParentStudents());
  $("copyInviteBtn").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("inviteCodeText").textContent); showToast("Link code copied"); }
    catch (_) { $("linkError").textContent = "Copy was unavailable. Select and copy the code above."; }
  });
  $("redeemInviteBtn").addEventListener("click", () => void redeemInviteCode());
  $("signOutBtn").addEventListener("click", async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) { $("linkError").textContent = error.message || "Could not sign out."; return; }
    $("accountDialog").close(); showToast("Signed out");
  });
  $("studentPicker").addEventListener("change", async (event) => {
    selectedStudentId = event.target.value;
    await loadSelectedStudent(); renderCloudControls(); renderOverview();
  });
  $("historyList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-log]"); if (button) openReviewDialog(button.dataset.reviewLog);
    const makeupButton = event.target.closest("[data-makeup-log]");
    if (makeupButton) { const log = state.logs.find((item) => item.id === makeupButton.dataset.makeupLog); if (log) openTimetableRequestDialog(log); }
  });
  $("timetableRequestList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-request-status]"); if (button) void reviewTimetableChangeRequest(button.dataset.requestId, button.dataset.requestStatus);
  });
  $("accountDialog").addEventListener("click", (event) => { if (event.target === $("accountDialog") || event.target.closest("[data-close-account]")) $("accountDialog").close(); });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $(button.dataset.closeDialog).close()));
  window.addEventListener("online", () => { if (isStudentAccount()) void uploadStudentLogs(state.logs).catch(() => setCloudStatus("Offline changes are saved; cloud sync will retry.")); });
  $("scheduleList").addEventListener("click", async (event) => {
    const add = event.target.closest(".add-day-session"); if (add && canEditTimetable()) return openSessionDialog(null, Number(add.dataset.day));
    if (event.target.closest("#emptyAddBtn") && canEditTimetable()) return openSessionDialog();
    const edit = event.target.closest(".edit-session"); if (edit && canEditTimetable()) return openSessionDialog(state.schedule.find((item) => item.id === edit.dataset.id));
    const del = event.target.closest(".delete-session");
    if (del && canEditTimetable()) {
      const previousSchedule = state.schedule;
      const session = state.schedule.find((item) => item.id === del.dataset.id);
      state.schedule = state.schedule.filter((item) => item.id !== del.dataset.id);
      renderTimetable(); renderOverview();
      if (isAdminAccount()) {
        try { await syncSelectedStudentTimetable(); }
        catch (error) { state.schedule = previousSchedule; renderTimetable(); renderOverview(); setCloudStatus(error.message || "Could not update the student's timetable."); return; }
      } else saveState();
      showToast(`${session?.subject || "Session"} removed`);
    }
  });
  $("todaySessions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (action === "view-log") { const log = state.logs.find((item) => item.id === button.dataset.id); if (log) openLogDialog({ log }); return; }
    const session = state.schedule.find((item) => item.id === button.dataset.id); if (!session) return;
    if (action === "finish") return void finishTimer(session);
    if (action === "pause") return void pauseTimer(session);
    if (action === "resume") return void resumeTimer(session);
    if (isDue(session, todayISO())) return;
    void startTimer(session);
  });
  $("sessionForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const start = $("startInput").value, end = $("endInput").value;
    if (end <= start) { $("sessionError").textContent = "End time needs to be later than start time."; return; }
    if (!canEditTimetable()) { $("sessionError").textContent = isStudentAccount() ? "The admin manages student timetables." : "Only the admin can edit a linked student's timetable."; return; }
    const id = $("sessionId").value; const session = { id: id || uid(), day: Number($("dayInput").value), start, end, subject: $("subjectInput").value.trim(), focus: $("focusInput").value.trim() };
    const previousSchedule = state.schedule;
    if (id) state.schedule = state.schedule.map((item) => item.id === id ? session : item); else state.schedule.push(session);
    renderTimetable(); renderOverview();
    if (isAdminAccount()) {
      try { await syncSelectedStudentTimetable(); }
      catch (error) { state.schedule = previousSchedule; renderTimetable(); renderOverview(); $("sessionError").textContent = error.message || "Could not save the timetable."; return; }
    } else saveState();
    $("sessionDialog").close(); showToast(id ? "Timetable updated" : "Session added to timetable");
  });
  $("logForm").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); saveLog(); });
  $("statusInput").addEventListener("change", updateLogStatusFields);
  $("logSearch").addEventListener("input", renderHistory);
  $("editNameBtn").addEventListener("click", () => { $("nameInput").value = state.name === "Student" ? "" : state.name; $("nameDialog").showModal(); $("nameInput").focus(); });
  $("nameForm").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); state.name = $("nameInput").value.trim() || "Student"; saveState(); if (isStudentAccount()) void syncStudentDisplayName(); $("nameDialog").close(); renderOverview(); showToast("Profile name updated"); });
  ["sessionDialog", "logDialog", "nameDialog"].forEach((id) => $(id).addEventListener("click", (event) => { if (event.target === $(id)) $(id).close(); }));
  document.addEventListener("click", (event) => { const go = event.target.closest("[data-go]"); if (go && go.closest(".page-view")) navigate(go.dataset.go); });
  renderOverview();
  window.setInterval(() => {
    if (!state.activeTimer) renderOverview();
    if (!authUser) for (const session of state.schedule.filter((item) => Number(item.day) === new Date().getDay())) {
      const timerBelongsHere = state.activeTimer?.sessionId === session.id && state.activeTimer?.date === todayISO();
      if (isDue(session, todayISO()) && !timerBelongsHere) markMissed(session);
    }
    checkStudyReminders();
    if (authUser) void refreshStudyLogs();
  }, 15000);
  void initializeCloud().finally(ensureTimerLoop);
})();
