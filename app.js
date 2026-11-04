(() => {
  const STORAGE_KEY = "studywell-tracker-v1";
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
  const LEWI_TIMETABLE = WEEKDAY_ROWS.flatMap((row, rowIndex) => row.subjects.map((subject, index) => ({
    id: `lewi-${index + 1}-${rowIndex}`,
    day: index + 1,
    start: row.start,
    end: row.end,
    subject,
    focus: row.label,
  }))).concat({
    id: "lewi-saturday-revision",
    day: 6,
    start: "08:00",
    end: "11:00",
    subject: "Revision",
    focus: "Review weekly topics, practise questions, revisit difficult topics",
  });
  const defaultState = { name: "Student", schedule: LEWI_TIMETABLE, logs: [], activeTimer: null, timetableImported: true };
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
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
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
    if (!state.schedule.length) { container.innerHTML = `<div class="empty-timetable"><span class="empty-plan-icon">▦</span><h3>Start with the plan you have</h3><p>Add a few study blocks from your real timetable. When the time comes, start a focus timer and record what you covered.</p><button class="button button-dark" id="emptyAddBtn"><span class="button-plus">+</span> Add your first session</button></div>`; return; }
    container.innerHTML = Array.from({ length: 7 }, (_, index) => (index + 1) % 7).map((day) => {
      const sessions = state.schedule.filter((item) => Number(item.day) === day).sort((a, b) => a.start.localeCompare(b.start));
      const entries = sessions.map((session) => `<div class="schedule-entry"><span class="schedule-entry-time">${formatTime(session.start)}<br>${formatTime(session.end)}</span><span class="schedule-entry-line"></span><span class="schedule-entry-copy"><strong>${escapeHTML(session.subject)}</strong><span>${escapeHTML(session.focus || "No focus topic added")} · ${durationLabel(minutesFromTime(session.end) - minutesFromTime(session.start))}</span></span><span class="schedule-entry-actions"><button class="small-action edit-session" data-id="${escapeHTML(session.id)}" aria-label="Edit ${escapeHTML(session.subject)}" title="Edit">✎</button><button class="small-action delete-session" data-id="${escapeHTML(session.id)}" aria-label="Delete ${escapeHTML(session.subject)}" title="Delete">×</button></span></div>`).join("");
      return `<section class="day-card"><div class="day-card-header"><span class="day-title">${DAYS[day]}<span class="day-count">${sessions.length ? `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}` : "—"}</span></span><button class="small-action add-day-session" data-day="${day}" aria-label="Add session on ${DAYS[day]}" title="Add a session">＋</button></div><div class="day-card-content">${entries || `<div class="empty-day">No study blocks planned.</div>`}</div></section>`;
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
    $("logForm").reset(); $("logError").textContent = "";
    $("logSessionId").value = log?.sessionId || session?.id || "";
    $("logEyebrow").textContent = timer ? "NICE WORK — MAKE A NOTE OF IT" : log ? "YOUR STUDY NOTES" : "MAKE A NOTE OF IT";
    $("logTitle").textContent = log ? "Update study log" : "Log study time";
    $("logSubject").value = log?.subject || session?.subject || "";
    $("topicInput").value = log?.topic || "";
    $("minutesInput").value = log ? log.minutes : minutes ?? (session ? Math.max(1, minutesFromTime(session.end) - minutesFromTime(session.start)) : "");
    $("logDateInput").value = log?.date || todayISO(); $("logDateInput").max = todayISO(); $("notesInput").value = log?.notes || ""; $("statusInput").value = log?.status || "completed";
    $("plannedForLabel").textContent = session ? `Planned ${formatTime(session.start)}–${formatTime(session.end)}` : log?.plannedStart ? `Planned ${formatTime(log.plannedStart)}–${formatTime(log.plannedEnd)}` : "Independent study";
    $("timerBanner").hidden = !timer; $("saveLogBtn").textContent = log ? "Save changes" : "Save study log"; updateLogStatusFields();
    $("logDialog").showModal(); if (timer) updateTimerText(); $("topicInput").focus();
  }
  function formatElapsed() { if (!state.activeTimer) return "Start timer"; const sec = Math.max(0, Math.floor((Date.now() - state.activeTimer.startedAt) / 1000)); return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; }
  function updateTimerText() { $("timerText").textContent = formatElapsed(); }
  function startTimer(session) {
    if (state.activeTimer) return;
    state.activeTimer = { sessionId: session.id, date: todayISO(), startedAt: Date.now() }; saveState();
    timerInterval = setInterval(() => { updateTimerText(); renderToday(); }, 1000); renderOverview(); showToast(`Focus timer started for ${session.subject}`);
  }
  function finishTimer(session) {
    const elapsed = Math.max(1, Math.round((Date.now() - state.activeTimer.startedAt) / 60000));
    openLogDialog({ session, minutes: elapsed, timer: true });
  }
  function finishTimerState() { state.activeTimer = null; clearInterval(timerInterval); timerInterval = null; }
  function saveLog() {
    const id = $("logSessionId").value; const session = state.schedule.find((item) => item.id === id);
    const status = $("statusInput").value; const topic = $("topicInput").value.trim(); const minutes = status === "missed" ? 0 : Number($("minutesInput").value);
    if (!$("logSubject").value.trim() || (status !== "missed" && !topic) || !$("logDateInput").value || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { $("logError").textContent = status === "missed" ? "Add a subject and valid study date." : "Add a subject, topic, valid date, and minutes studied."; return false; }
    if (state.activeTimer && session && state.activeTimer.sessionId === session.id) finishTimerState();
    const date = $("logDateInput").value; const priorIndex = state.logs.findIndex((log) => log.sessionId === id && id && log.date === date);
    const prior = priorIndex >= 0 ? state.logs[priorIndex] : null;
    const entry = { id: prior?.id || uid(), sessionId: id || null, date, subject: $("logSubject").value.trim(), topic: status === "missed" ? topic || "Session missed" : topic, minutes, notes: $("notesInput").value.trim(), status, plannedStart: session?.start || prior?.plannedStart || null, plannedEnd: session?.end || prior?.plannedEnd || null, createdAt: prior?.createdAt || new Date().toISOString() };
    if (priorIndex >= 0) state.logs[priorIndex] = entry; else state.logs.push(entry);
    saveState(); $("logDialog").close(); renderOverview(); renderHistory(); showToast(prior ? "Study log updated" : "Study session saved"); return true;
  }
  function markMissed(session) {
    const existing = getOccurrenceLog(session.id, todayISO());
    if (existing) return;
    state.logs.push({ id: uid(), sessionId: session.id, date: todayISO(), subject: session.subject, topic: "Session missed", minutes: 0, notes: "", status: "missed", plannedStart: session.start, plannedEnd: session.end, createdAt: new Date().toISOString() });
    saveState(); renderOverview(); renderHistory(); showToast("Session marked as missed");
  }
  function updateLogStatusFields() {
    const missed = $("statusInput").value === "missed";
    $("topicInput").required = !missed;
    $("topicInput").placeholder = missed ? "Leave blank if no study took place" : "e.g. Causes of the French Revolution";
    $("minutesInput").disabled = missed;
    if (missed) $("minutesInput").value = "0";
    else if ($("minutesInput").value === "0") $("minutesInput").value = "";
  }

  document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", () => navigate(item.dataset.go)));
  $("quickLogBtn").addEventListener("click", () => openLogDialog()); $("historyLogBtn").addEventListener("click", () => openLogDialog()); $("addSessionBtn").addEventListener("click", () => openSessionDialog());
  $("scheduleList").addEventListener("click", (event) => {
    const add = event.target.closest(".add-day-session"); if (add) return openSessionDialog(null, Number(add.dataset.day));
    if (event.target.closest("#emptyAddBtn")) return openSessionDialog();
    const edit = event.target.closest(".edit-session"); if (edit) return openSessionDialog(state.schedule.find((item) => item.id === edit.dataset.id));
    const del = event.target.closest(".delete-session"); if (del) { const session = state.schedule.find((item) => item.id === del.dataset.id); state.schedule = state.schedule.filter((item) => item.id !== del.dataset.id); saveState(); renderTimetable(); renderOverview(); showToast(`${session?.subject || "Session"} removed`); }
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
    const id = $("sessionId").value; const session = { id: id || uid(), day: Number($("dayInput").value), start, end, subject: $("subjectInput").value.trim(), focus: $("focusInput").value.trim() };
    if (id) state.schedule = state.schedule.map((item) => item.id === id ? session : item); else state.schedule.push(session);
    saveState(); $("sessionDialog").close(); renderTimetable(); renderOverview(); showToast(id ? "Timetable updated" : "Session added to timetable");
  });
  $("logForm").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); saveLog(); });
  $("statusInput").addEventListener("change", updateLogStatusFields);
  $("logSearch").addEventListener("input", renderHistory);
  $("editNameBtn").addEventListener("click", () => { $("nameInput").value = state.name === "Student" ? "" : state.name; $("nameDialog").showModal(); $("nameInput").focus(); });
  $("nameForm").addEventListener("submit", (event) => { if (event.submitter?.value === "cancel") return; event.preventDefault(); state.name = $("nameInput").value.trim() || "Student"; saveState(); $("nameDialog").close(); renderOverview(); showToast("Profile name updated"); });
  ["sessionDialog", "logDialog", "nameDialog"].forEach((id) => $(id).addEventListener("click", (event) => { if (event.target === $(id)) $(id).close(); }));
  document.addEventListener("click", (event) => { const go = event.target.closest("[data-go]"); if (go && go.closest(".page-view")) navigate(go.dataset.go); });
  if (state.activeTimer) { timerInterval = setInterval(() => { updateTimerText(); renderToday(); }, 1000); }
  renderOverview();
})();
