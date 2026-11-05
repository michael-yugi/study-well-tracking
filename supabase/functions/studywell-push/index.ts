import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, x-studywell-webhook-secret" };

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const serviceUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hookSecret = Deno.env.get("STUDYWELL_WEBHOOK_SECRET");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  if (!serviceUrl || !serviceKey || !hookSecret || !vapidPublic || !vapidPrivate || !vapidSubject) {
    return new Response("Push secrets are not configured", { status: 503 });
  }
  if (request.headers.get("x-studywell-webhook-secret") !== hookSecret) return new Response("Unauthorized", { status: 401 });

  try {
    const webhook = await request.json();
    const record = webhook?.record;
    if (webhook?.type !== "INSERT" || webhook?.table !== "study_reminder_queue" || !record?.id) {
      return new Response("Ignored event", { status: 200 });
    }

    const client = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } });
    const { data: queued, error: queueError } = await client.from("study_reminder_queue")
      .select("id,student_id,title,message,sent_at")
      .eq("id", record.id).maybeSingle();
    if (queueError) throw queueError;
    if (!queued || queued.sent_at) return new Response("Already handled", { status: 200 });

    const { data: subscriptions, error: subscriptionsError } = await client.from("study_push_subscriptions")
      .select("endpoint,p256dh,auth_secret").eq("student_id", queued.student_id);
    if (subscriptionsError) throw subscriptionsError;
    if (!subscriptions?.length) {
      await client.from("study_reminder_queue").update({ last_error: "No registered student devices" }).eq("id", queued.id);
      return new Response("No registered devices", { status: 200 });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const payload = JSON.stringify({
      title: queued.title,
      message: queued.message,
      tag: `studywell:${record.id}`,
      url: "https://michael-yugi.github.io/study-well-tracking/",
    });
    const failures: string[] = [];
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
        }, payload, { TTL: 3600 });
      } catch (error) {
        const code = Number((error as { statusCode?: number })?.statusCode || 0);
        if (code === 404 || code === 410) {
          await client.from("study_push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        } else failures.push(String((error as Error)?.message || error));
      }
    }

    await client.from("study_reminder_queue").update({
      sent_at: new Date().toISOString(),
      last_error: failures.join("; ").slice(0, 1000),
    }).eq("id", queued.id);
    return new Response(JSON.stringify({ sent: subscriptions.length, failures: failures.length }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(String((error as Error)?.message || error), { status: 500, headers: corsHeaders });
  }
});
