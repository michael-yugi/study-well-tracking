self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { message: event.data?.text() || "Open Studywell to check your study plan." }; }
  event.waitUntil(self.registration.showNotification(data.title || "Studywell", {
    body: data.message || "Open Studywell to check your study plan.",
    tag: data.tag || "studywell-reminder",
    data: { url: data.url || "https://michael-yugi.github.io/study-well-tracking/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = event.notification.data?.url || "https://michael-yugi.github.io/study-well-tracking/";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clientsList.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.focus(); return existing.navigate(destination); }
    return self.clients.openWindow(destination);
  })());
});
