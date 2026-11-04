(() => {
  const STORAGE_KEY = "studywell-tracker-v1";
  const LOCAL_MIGRATION_KEY = "studywell-local-imported-v1";
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
  const defaultState = { name: "Student", schedule: LEWI_TIMETABLE, logs: [], activeTimer: null, timetableImported: true };
  let authUser = null;
  let accountProfile = null;
  let linkedStudents = [];
  let selectedStudentId = null;
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
    if (authUser && accountProfile?.account_type === "parent") return;
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
  function isDue(session, date) {
    const [y, m, d] = date.split("-").map(Number);
    const end = new Date(y, m - 1, d, ...session.end.split(":").map(Number));
    return end.getTime() <= Date.now();
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
    const h = Math.floor(totalMinutes / 60); const m = totalMinutes % 60;
    $("weekTime").innerHTML = `${h}<span>h</span> ${m}<span>m</span>`;
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
      let action, statusClass = "";
      if (active) { statusClass = "status-live"; action = `<button class="session-action timer-action" data-action="finish" data-id="${escapeHTML(session.id)}">${formatElapsed()}</button>`; }
      else if (log) { statusClass = `status-${log.status === "completed" ? "done" : log.status}`; action = `<button class="session-action done-action" data-action="view-log" data-id="${escapeHTML(log.id)}">${log.status === "missed" ? "Missed" : `${durationCompact(log.minutes)} · ${log.status === "partial" ? "Partial" : "Logged"}`}</button>`; }
      else if (isParentView()) { action = `<button class="session-action" disabled>Not logged</button>`; }
      else if (state.activeTimer) { action = `<button class="session-action" disabled title="Finish the active timer first">Waiting</button>`; }
      else { action = `<button class="session-action ${isDue(session, iso) ? "missed-action" : ""}" data-action="start-or-log" data-id="${escapeHTML(session.id)}">${isDue(session, iso) ? "Log session" : "Start timer"}</button>`; }
      const focus = log ? log.topic : session.focus || "Planned study time";
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
    if (!state.schedule.length) { container.innerHTML = `<div class="empty-timetable"><span class="empty-plan-icon">▦</span><h3>${isParentView() ? "No timetable available yet" : "Start with the plan you have"}</h3><p>${isParentView() ? "The student has not added a timetable yet." : "Add a few study blocks from your real timetable. When the time comes, start a focus timer and record what you covered."}</p>${isParentView() ? "" : `<button class="button button-dark" id="emptyAddBtn"><span class="button-plus">+</span> Add your first session</button>`}</div>`; return; }
    container.innerHTML = Array.from({ length: 7 }, (_, index) => (index + 1) % 7).map((day) => {
      const sessions = state.schedule.filter((item) => Number(item.day) === day).sort((a, b) => a.start.localeCompare(b.start));
      const entries = sessions.map((session) => `<div class="schedule-entry"><span class="schedule-entry-time">${formatTime(session.start)}<br>${formatTime(session.end)}</span><span class="schedule-entry-line"></span><span class="schedule-entry-copy"><strong>${escapeHTML(session.subject)}</strong><span>${escapeHTML(session.focus || "No focus topic added")} · ${durationLabel(minutesFromTime(session.end) - minutesFromTime(session.start))}</span></span>${isParentView() ? "" : `<span class="schedule-entry-actions"><button class="small-action edit-session" data-id="${escapeHTML(session.id)}" aria-label="Edit ${escapeHTML(session.subject)}" title="Edit">✎</button><button class="small-action delete-session" data-id="${escapeHTML(session.id)}" aria-label="Delete ${escapeHTML(session.subject)}" title="Delete">×</button></span>`}</div>`).join("");
      return `<section class="day-card"><div class="day-card-header"><span class="day-title">${DAYS[day]}<span class="day-count">${sessions.length ? `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}` : "—"}</span></span>${isParentView() ? "" : `<button class="small-action add-day-session" data-day="${day}" aria-label="Add session on ${DAYS[day]}" title="Add a session">＋</button>`}</div><div class="day-card-content">${entries || `<div class="empty-day">No study blocks planned.</div>`}</div></section>`;
    }).join("");
  }
  function renderHistory() {
    const query = $("logSearch").value.trim().toLowerCase();
    const logs = [...state.logs].filter((log) => `${log.subject} ${log.topic} ${log.notes || ""}`.toLowerCase().includes(query)).sort((a, b) => `${b.date}${b.createdAt || ""}`.localeCompare(`${a.date}${a.createdAt || ""}`));
    $("historyCount").textContent = `${logs.length} ${logs.length === 1 ? "study session" : "study sessions"}`;
    if (!logs.length) { $("historyList").innerHTML = query ? `<div class="empty-history"><strong>No matches yet</strong><span>Try a different subject or topic.</span></div>` : `<div class="empty-history"><span class="empty-plan-icon">◷</span><strong>Your learning starts here</strong><span>Log a session to keep track of what you studied.</span></div>`; return; }
    $("historyList").innerHTML = logs.map((log) => `<article class="history-card"><div class="history-card-top"><div class="history-subject"><div class="subject-badge color-${(log.subject.charCodeAt(0) || 0) % 4}">${escapeHTML(log.subject.trim().charAt(0).toUpperCase())}</div><div><strong>${escapeHTML(log.subject)}</strong><span>${formatDate(fromISO(log.date), { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></div></div><span class="duration-pill">${durationLabel(log.minutes)} studied</span></div><div class="history-topic">${escapeHTML(log.topic)}</div>${log.notes ? `<div class="history-notes">${escapeHTML(log.notes)}</div>` : ""}<div class="history-foot"><span>${log.plannedStart ? `Planned ${formatTime(log.plannedStart)}${log.plannedEnd ? `–${formatTime(log.plannedEnd)}` : ""}` : "Independent study"}</span><span class="status-pill ${log.status === "partial" ? "partial" : ""}">${log.status === "partial" ? "Partly completed" : log.status === "missed" ? "Missed session" : log.sessionId ? "Completed as planned" : "Study logged"}</span></div></article>`).join("");
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
    $("logForm").reset(); $("logError").textContent = "";
    ["logSubject", "topicInput", "minutesInput", "logDateInput", "notesInput", "statusInput"].forEach((id) => { $(id).disabled = false; });
    $("saveLogBtn").hidden = false;
    $("logSessionId").value = log?.sessionId || session?.id || "";
    $("logEyebrow").textContent = timer ? "NICE WORK — MAKE A NOTE OF IT" : log ? "YOUR STUDY NOTES" : "MAKE A NOTE OF IT";
    $("logTitle").textContent = readOnly ? "Study record" : log ? "Update study log" : "Log study time";
    $("logSubject").value = log?.subject || session?.subject || "";
    $("topicInput").value = log?.topic || "";
    $("minutesInput").value = log ? log.minutes : minutes ?? (session ? Math.max(1, minutesFromTime(session.end) - minutesFromTime(session.start)) : "");
    $("logDateInput").value = log?.date || todayISO(); $("logDateInput").max = todayISO(); $("notesInput").value = log?.notes || ""; $("statusInput").value = log?.status || "completed";
    $("plannedForLabel").textContent = session ? `Planned ${formatTime(session.start)}–${formatTime(session.end)}` : log?.plannedStart ? `Planned ${formatTime(log.plannedStart)}–${formatTime(log.plannedEnd)}` : "Independent study";
    $("timerBanner").hidden = !timer; $("saveLogBtn").textContent = log ? "Save changes" : "Save study log"; updateLogStatusFields();
    ["logSubject", "topicInput", "minutesInput", "logDateInput", "notesInput", "statusInput"].forEach((id) => { $(id).disabled = readOnly; });
    $("saveLogBtn").hidden = readOnly;
    $("logDialog").showModal(); if (timer) updateTimerText(); if (!readOnly) $("topicInput").focus();
  }
  function formatElapsed() { if (!state.activeTimer) return "Start timer"; const sec = Math.max(0, Math.floor((Date.now() - state.activeTimer.startedAt) / 1000)); return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; }
  function updateTimerText() { $("timerText").textContent = formatElapsed(); }
  function startTimer(session) {
    if (isParentView() || state.activeTimer) return;
    state.activeTimer = { sessionId: session.id, date: todayISO(), startedAt: Date.now() }; saveState();
    timerInterval = setInterval(() => { updateTimerText(); renderToday(); }, 1000); renderOverview(); showToast(`Focus timer started for ${session.subject}`);
  }
  function finishTimer(session) {
    const elapsed = Math.max(1, Math.round((Date.now() - state.activeTimer.startedAt) / 60000));
    openLogDialog({ session, minutes: elapsed, timer: true });
  }
  function finishTimerState() { state.activeTimer = null; clearInterval(timerInterval); timerInterval = null; }
  function saveLog() {
    if (isParentView()) { $("logError").textContent = "Parent accounts can view logs but cannot edit them."; return false; }
    const id = $("logSessionId").value; const session = state.schedule.find((item) => item.id === id);
    const status = $("statusInput").value; const topic = $("topicInput").value.trim(); const minutes = status === "missed" ? 0 : Number($("minutesInput").value);
    if (!$("logSubject").value.trim() || (status !== "missed" && !topic) || !$("logDateInput").value || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { $("logError").textContent = status === "missed" ? "Add a subject and valid study date." : "Add a subject, topic, valid date, and minutes studied."; return false; }
    if (state.activeTimer && session && state.activeTimer.sessionId === session.id) finishTimerState();
    const date = $("logDateInput").value; const priorIndex = state.logs.findIndex((log) => log.sessionId === id && id && log.date === date);
    const prior = priorIndex >= 0 ? state.logs[priorIndex] : null;
    const entry = { id: prior?.id || uid(), sessionId: id || null, date, subject: $("logSubject").value.trim(), topic: status === "missed" ? topic || "Session missed" : topic, minutes, notes: $("notesInput").value.trim(), status, plannedStart: session?.start || prior?.plannedStart || null, plannedEnd: session?.end || prior?.plannedEnd || null, createdAt: prior?.createdAt || new Date().toISOString() };
    if (priorIndex >= 0) state.logs[priorIndex] = entry; else state.logs.push(entry);
    saveState(); $("logDialog").close(); renderOverview(); renderHistory();
    if (isStudentAccount()) void syncLog(entry);
    showToast(prior ? "Study log updated" : "Study session saved"); return true;
  }
  function markMissed(session) {
    const existing = getOccurrenceLog(session.id, todayISO());
    if (existing) return;
    state.logs.push({ id: uid(), sessionId: session.id, date: todayISO(), subject: session.subject, topic: "Session missed", minutes: 0, notes: "", status: "missed", plannedStart: session.start, plannedEnd: session.end, createdAt: new Date().toISOString() });
    saveState(); renderOverview(); renderHistory(); if (isStudentAccount()) void syncLog(state.logs[state.logs.length - 1]); showToast("Session marked as missed");
  }
  function updateLogStatusFields() {
    const missed = $("statusInput").value === "missed";
    $("topicInput").required = !missed;
    $("topicInput").placeholder = missed ? "Leave blank if no study took place" : "e.g. Causes of the French Revolution";
    $("minutesInput").disabled = missed;
    if (missed) $("minutesInput").value = "0";
    else if ($("minutesInput").value === "0") $("minutesInput").value = "";
  }

  function isStudentAccount() { return Boolean(authUser && accountProfile?.account_type === "student"); }
  function isParentView() { return Boolean(authUser && accountProfile?.account_type === "parent"); }
  function setCloudStatus(message) {
    const button = $("syncAccountBtn");
    if (button) { button.textContent = authUser ? (isParentView() ? "Parent account" : "Synced account") : "Sign in to sync"; button.title = message; }
    const messageEl = $("cloudMessage"); if (messageEl) messageEl.textContent = message;
  }
  function renderCloudControls() {
    const parent = isParentView();
    $("quickLogBtn").hidden = parent; $("historyLogBtn").hidden = parent; $("addSessionBtn").hidden = parent;
    $("editNameBtn").hidden = parent;
    $("studentPicker").hidden = !parent || linkedStudents.length === 0;
    if (parent && linkedStudents.length) {
      const picker = $("studentPicker");
      picker.replaceChildren(...linkedStudents.map((student) => { const option = document.createElement("option"); option.value = student.id; option.textContent = student.display_name; return option; }));
      picker.value = selectedStudentId || linkedStudents[0].id;
    }
    setCloudStatus(authUser ? (parent ? "Parent view: synced study logs are read-only." : "Student data is syncing to your account.") : "Study data stays on this device until you sign in.");
  }
  function renderLinkedStudentsList() {
    $("linkedStudentsList").replaceChildren(...linkedStudents.map((student) => {
      const item = document.createElement("div"); item.className = "linked-student"; item.textContent = `${student.display_name} · linked student`; return item;
    }));
  }
  function updateSignupTimetableVisibility() {
    $("studentTimetableFields").hidden = authMode !== "signup" || $("accountType").value !== "student";
  }
  function setAccountMode(mode) {
    authMode = mode;
    document.querySelectorAll(".auth-mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    $("signupFields").hidden = mode !== "signup";
    $("accountDialogTitle").textContent = mode === "signup" ? "Create a Studywell account" : "Sync your study data";
    $("accountSubmit").textContent = mode === "signup" ? "Create account" : "Sign in";
    $("accountError").textContent = "";
    updateSignupTimetableVisibility();
  }
  function openAccountDialog() {
    $("accountError").textContent = ""; $("linkError").textContent = "";
    $("authPanel").hidden = Boolean(authUser); $("linkPanel").hidden = !authUser;
    if (authUser) {
      $("accountDialogTitle").textContent = "Cloud sync";
      $("signedInSummary").textContent = `${accountProfile?.display_name || authUser.email} · ${isParentView() ? "Parent / teacher" : "Student"}`;
      $("parentTools").hidden = !isParentView(); $("studentTools").hidden = !isStudentAccount();
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
      status: log.status, planned_start: log.plannedStart || null, planned_end: log.plannedEnd || null,
      created_at: log.createdAt || new Date().toISOString(),
    };
  }
  function fromRemoteLog(row) {
    return {
      id: row.id, sessionId: row.session_id, date: row.study_date, subject: row.subject, topic: row.topic,
      minutes: row.minutes, notes: row.notes || "", status: row.status, plannedStart: row.planned_start,
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
  async function syncProfile() {
    if (!isStudentAccount()) return;
    const { error } = await supabaseClient.from("study_profiles").update({ display_name: state.name || "Student", timetable: state.schedule }).eq("id", authUser.id);
    if (error) { setCloudStatus("Could not sync your timetable. Your local copy is saved."); return false; }
    accountProfile.display_name = state.name || accountProfile.display_name;
    accountProfile.timetable = state.schedule;
    setCloudStatus("Timetable synced to your account.");
    return true;
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
    let saved = readCachedUserState(authUser.id);
    let importingFirstLocalUse = false;
    if (!saved && !localStorage.getItem(LOCAL_MIGRATION_KEY)) {
      saved = loadState();
      importingFirstLocalUse = true;
    }
    state = saved || { ...defaultState, name: accountProfile.display_name || "Student", schedule: Array.isArray(accountProfile.timetable) && accountProfile.timetable.length ? accountProfile.timetable : LEWI_TIMETABLE, logs: [], activeTimer: null };
    state.name = accountProfile.display_name || state.name || "Student";
    if (Array.isArray(accountProfile.timetable) && accountProfile.timetable.length) state.schedule = accountProfile.timetable;
    setCloudStatus("Syncing this student's timetable and study logs…");
    try {
      const profileSynced = await syncProfile();
      await uploadStudentLogs(state.logs);
      if (importingFirstLocalUse) localStorage.setItem(LOCAL_MIGRATION_KEY, authUser.id);
      state.logs = await fetchStudentLogs(authUser.id);
      saveState();
      setCloudStatus(profileSynced === false ? "Logs synced. Check timetable sync." : "Study logs and timetable are synced.");
    } catch (error) {
      saveState();
      setCloudStatus("Could not reach the cloud. Your local study data is saved and will retry next sign-in.");
    }
  }
  async function loadParentStudents() {
    const { data: links, error: linksError } = await supabaseClient.from("study_access").select("student_id").eq("parent_id", authUser.id);
    if (linksError) throw linksError;
    const ids = (links || []).map((link) => link.student_id);
    if (!ids.length) {
      linkedStudents = []; selectedStudentId = null;
      state = { ...defaultState, name: accountProfile.display_name || "Parent", schedule: [], logs: [], activeTimer: null };
      return;
    }
    const { data: profiles, error: profileError } = await supabaseClient.from("study_profiles").select("id,display_name,timetable").in("id", ids);
    if (profileError) throw profileError;
    linkedStudents = (profiles || []).sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
    if (!linkedStudents.some((student) => student.id === selectedStudentId)) selectedStudentId = linkedStudents[0]?.id || null;
    await loadSelectedStudent();
  }
  async function loadSelectedStudent() {
    const student = linkedStudents.find((item) => item.id === selectedStudentId);
    if (!student) return;
    state = { ...defaultState, name: student.display_name || "Student", schedule: Array.isArray(student.timetable) ? student.timetable : [], logs: [], activeTimer: null };
    try { state.logs = await fetchStudentLogs(student.id); setCloudStatus(`Viewing ${student.display_name}'s synced study logs.`); }
    catch (error) { setCloudStatus("Could not load this student's cloud logs."); }
    renderOverview(); if ($("historyView").classList.contains("active")) renderHistory();
  }
  async function refreshParentStudents() {
    if (!isParentView()) return;
    $("refreshStudentsBtn").disabled = true; $("linkError").textContent = "";
    try {
      await loadParentStudents(); renderCloudControls(); renderLinkedStudentsList(); renderOverview();
      if ($("historyView").classList.contains("active")) renderHistory();
      $("linkError").textContent = linkedStudents.length ? "Student list refreshed." : "No students linked yet. Create a separate code for each student.";
    } catch (error) { $("linkError").textContent = error.message || "Could not refresh the student list."; }
    finally { $("refreshStudentsBtn").disabled = false; }
  }
  async function handleAuthSession(session) {
    if (!session) {
      authUser = null; accountProfile = null; linkedStudents = []; selectedStudentId = null; state = loadState();
      renderCloudControls(); renderOverview(); if ($("historyView").classList.contains("active")) renderHistory();
      return;
    }
    authUser = session.user;
    setCloudStatus("Loading your Studywell account…");
    const { data: profile, error } = await supabaseClient.from("study_profiles").select("*").eq("id", authUser.id).maybeSingle();
    if (error || !profile) { setCloudStatus("Account profile missing. Run the Studywell database setup SQL first."); return; }
    accountProfile = profile;
    try {
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
        const selectedTimetable = $("signupTimetable").value;
        if (accountType === "student" && !selectedTimetable) { $("accountError").textContent = "Choose the timetable for this student."; return; }
        const initialTimetable = accountType === "student" ? (selectedTimetable === "ann" ? ANN_TIMETABLE : LEWI_TIMETABLE) : [];
        const { data, error } = await supabaseClient.auth.signUp({
          email, password,
          options: { data: { display_name: displayName, account_type: accountType, timetable: initialTimetable }, emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
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
  $("quickLogBtn").addEventListener("click", () => openLogDialog()); $("historyLogBtn").addEventListener("click", () => openLogDialog()); $("addSessionBtn").addEventListener("click", () => { if (!isParentView()) openSessionDialog(); });
  $("syncAccountBtn").addEventListener("click", openAccountDialog);
  document.querySelectorAll(".auth-mode").forEach((button) => button.addEventListener("click", () => setAccountMode(button.dataset.mode)));
  $("accountType").addEventListener("change", updateSignupTimetableVisibility);
  $("accountSubmit").addEventListener("click", () => void submitAccountForm());
  $("createInviteBtn").addEventListener("click", () => void createInviteCode());
  $("refreshStudentsBtn").addEventListener("click", () => void refreshParentStudents());
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
  $("accountDialog").addEventListener("click", (event) => { if (event.target === $("accountDialog") || event.target.closest("[data-close-account]")) $("accountDialog").close(); });
  window.addEventListener("online", () => { if (isStudentAccount()) { void syncProfile(); void uploadStudentLogs(state.logs).catch(() => setCloudStatus("Offline changes are saved; cloud sync will retry.")); } });
  $("scheduleList").addEventListener("click", (event) => {
    const add = event.target.closest(".add-day-session"); if (add && !isParentView()) return openSessionDialog(null, Number(add.dataset.day));
    if (event.target.closest("#emptyAddBtn") && !isParentView()) return openSessionDialog();
    const edit = event.target.closest(".edit-session"); if (edit && !isParentView()) return openSessionDialog(state.schedule.find((item) => item.id === edit.dataset.id));
    const del = event.target.closest(".delete-session"); if (del && !isParentView()) { const session = state.schedule.find((item) => item.id === del.dataset.id); state.schedule = state.schedule.filter((item) => item.id !== del.dataset.id); saveState(); renderTimetable(); renderOverview(); if (isStudentAccount()) void syncProfile(); showToast(`${session?.subject || "Session"} removed`); }
  });
  $("todaySessions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action;
    if (action === "view-log") { const log = state.logs.find((item) => item.id === button.dataset.id); if (log) openLogDialog({ log }); return; }
    const session = state.schedule.find((item) => item.id === button.dataset.id); if (!session) return;
    if (action === "finish") return finishTimer(session);
    if (isDue(session, todayISO())) return openLogDialog({ session });
    startTimer(session);
  });
  $("sessionForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const start = $("startInput").value, end = $("endInput").value;
    if (end <= start) { $("sessionError").textContent = "End time needs to be later than start time."; return; }
    if (isParentView()) { $("sessionError").textContent = "Parent accounts cannot edit a student timetable."; return; }
    const id = $("sessionId").value; const session = { id: id || uid(), day: Number($("dayInput").value), start, end, subject: $("subjectInput").value.trim(), focus: $("focusInput").value.trim() };
    if (id) state.schedule = state.schedule.map((item) => item.id === id ? session : item); else state.schedule.push(session);
    saveState(); $("sessionDialog").close(); renderTimetable(); renderOverview(); if (isStudentAccount()) void syncProfile(); showToast(id ? "Timetable updated" : "Session added to timetable");
  });
  $("logForm").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); saveLog(); });
  $("statusInput").addEventListener("change", updateLogStatusFields);
  $("logSearch").addEventListener("input", renderHistory);
  $("editNameBtn").addEventListener("click", () => { $("nameInput").value = state.name === "Student" ? "" : state.name; $("nameDialog").showModal(); $("nameInput").focus(); });
  $("nameForm").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); state.name = $("nameInput").value.trim() || "Student"; saveState(); if (isStudentAccount()) { accountProfile.display_name = state.name; void syncProfile(); } $("nameDialog").close(); renderOverview(); showToast("Profile name updated"); });
  ["sessionDialog", "logDialog", "nameDialog"].forEach((id) => $(id).addEventListener("click", (event) => { if (event.target === $(id)) $(id).close(); }));
  document.addEventListener("click", (event) => { const go = event.target.closest("[data-go]"); if (go && go.closest(".page-view")) navigate(go.dataset.go); });
  if (state.activeTimer) { timerInterval = setInterval(() => { updateTimerText(); renderToday(); }, 1000); }
  renderOverview();
  void initializeCloud();
})();
