package com.michaelyugi.studywell;

import android.app.Activity;
import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Iterator;
import java.util.Map;
import java.util.TreeMap;

public class MainActivity extends Activity {
    private static final String STUDYWELL_URL = "https://michael-yugi.github.io/study-well-tracking/";
    private static final String STUDYWELL_HOST = "michael-yugi.github.io";
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new StudywellPhoneBridge(this), "StudywellPhone");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath() == null ? "" : uri.getPath();
                if ("https".equals(uri.getScheme()) && STUDYWELL_HOST.equals(uri.getHost())
                    && (path.equals("/study-well-tracking") || path.startsWith("/study-well-tracking/"))) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript("window.onStudywellPhoneReady && window.onStudywellPhoneReady()", null);
            }
        });
        setContentView(webView);
        if (savedInstanceState == null) webView.loadUrl(STUDYWELL_URL);
        else webView.restoreState(savedInstanceState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.postDelayed(() -> webView.evaluateJavascript(
            "window.onStudywellPhoneReady && window.onStudywellPhoneReady()", null), 250);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    public static final class StudywellPhoneBridge {
        private final Activity activity;

        StudywellPhoneBridge(Activity activity) { this.activity = activity; }

        @JavascriptInterface
        public boolean hasUsageAccess() {
            AppOpsManager appOps = (AppOpsManager) activity.getSystemService(Context.APP_OPS_SERVICE);
            int mode = appOps == null ? AppOpsManager.MODE_IGNORED
                : appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        }

        @JavascriptInterface
        public void openUsageAccessSettings() {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.runOnUiThread(() -> activity.startActivity(intent));
        }

        @JavascriptInterface
        public String readAppUsage(long sessionStartMs, long sessionEndMs) {
            JSONObject result = new JSONObject();
            JSONArray apps = new JSONArray();
            try {
                if (!hasUsageAccess()) {
                    result.put("error", "permission_required");
                    result.put("apps", apps);
                    return result.toString();
                }
                long now = System.currentTimeMillis();
                long endMs = Math.min(sessionEndMs, now);
                long startMs = Math.max(sessionStartMs, endMs - 3L * 24 * 60 * 60 * 1000);
                if (endMs <= startMs) {
                    result.put("apps", apps);
                    return result.toString();
                }

                LocalDate date = Instant.ofEpochMilli(startMs).atZone(ZoneId.systemDefault()).toLocalDate();
                long dayStartMs = date.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
                UsageStatsManager manager = (UsageStatsManager) activity.getSystemService(Context.USAGE_STATS_SERVICE);
                UsageEvents events = manager == null ? null : manager.queryEvents(dayStartMs, endMs);
                if (events == null) {
                    result.put("apps", apps);
                    return result.toString();
                }

                Map<String, Long> totals = new TreeMap<>();
                UsageEvents.Event event = new UsageEvents.Event();
                String foregroundPackage = null;
                long lastTransitionMs = dayStartMs;
                while (events.hasNextEvent()) {
                    events.getNextEvent(event);
                    long at = event.getTimeStamp();
                    int type = event.getEventType();
                    boolean foreground = type == UsageEvents.Event.ACTIVITY_RESUMED || type == UsageEvents.Event.MOVE_TO_FOREGROUND;
                    boolean background = type == UsageEvents.Event.ACTIVITY_PAUSED || type == UsageEvents.Event.MOVE_TO_BACKGROUND;
                    boolean screenOff = type == UsageEvents.Event.SCREEN_NON_INTERACTIVE || type == UsageEvents.Event.KEYGUARD_SHOWN;

                    if (foreground || background || screenOff) {
                        addForegroundInterval(totals, foregroundPackage, lastTransitionMs, at, startMs, endMs);
                        if (foreground) foregroundPackage = event.getPackageName();
                        else if (screenOff || foregroundPackage == null || foregroundPackage.equals(event.getPackageName())) foregroundPackage = null;
                        lastTransitionMs = at;
                    }
                }
                addForegroundInterval(totals, foregroundPackage, lastTransitionMs, endMs, startMs, endMs);

                PackageManager packages = activity.getPackageManager();
                Iterator<Map.Entry<String, Long>> iterator = totals.entrySet().iterator();
                while (iterator.hasNext()) {
                    Map.Entry<String, Long> entry = iterator.next();
                    if (entry.getValue() < 1000 || activity.getPackageName().equals(entry.getKey())) continue;
                    JSONObject app = new JSONObject();
                    app.put("packageName", entry.getKey());
                    app.put("appName", applicationLabel(packages, entry.getKey()));
                    app.put("foregroundSeconds", entry.getValue() / 1000);
                    apps.put(app);
                }
                result.put("apps", apps);
            } catch (Exception error) {
                try { result.put("error", "usage_query_failed"); result.put("apps", apps); }
                catch (Exception ignored) { }
            }
            return result.toString();
        }

        private static void addForegroundInterval(Map<String, Long> totals, String packageName,
                                                  long intervalStart, long intervalEnd,
                                                  long allowedStart, long allowedEnd) {
            if (packageName == null || intervalEnd <= intervalStart) return;
            long overlapStart = Math.max(intervalStart, allowedStart);
            long overlapEnd = Math.min(intervalEnd, allowedEnd);
            if (overlapEnd > overlapStart) totals.put(packageName,
                totals.getOrDefault(packageName, 0L) + (overlapEnd - overlapStart));
        }

        private static String applicationLabel(PackageManager packages, String packageName) {
            try {
                ApplicationInfo info = packages.getApplicationInfo(packageName, 0);
                return packages.getApplicationLabel(info).toString();
            } catch (PackageManager.NameNotFoundException ignored) {
                return packageName;
            }
        }
    }
}
