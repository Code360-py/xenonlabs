package com.xenonlabs.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    /* Set by onCreate. Used by ServerService to obtain a
     * generator without holding a reference to a specific
     * activity instance. */
    private static LocalServer.Generator sGenerator;

    public static LocalServer.Generator getGenerator() {
        return sGenerator;
    }

    private static final String TAG = "XenonLabs";
    private static final String NOTIF_CHANNEL_ID = "xenon-generation";
    private static final int NOTIF_ID = 42;
    private static final int REQ_POST_NOTIFS = 1001;

    private static boolean nativeLoaded = false;
    static {
        try {
            System.loadLibrary("xenonlabs_jni");
            nativeLoaded = true;
        } catch (Throwable t) {
            Log.e(TAG, "native library load failed", t);
        }
    }

    /* ---- native declarations (must match jni_bridge.c symbols) ---- */
    private native int    nativeInit(String path);
    private native void   nativeShutdown();
    private native void   nativeCancelGeneration();
    private native void   nativeContinueContext();
    private native void   nativeResetContext();
    private native int    nativeGenerateStream(String prompt, int maxTokens,
                                               float temperature, float topP, int topK,
                                               TokenCallback cb);
    private native String nativeStatusString(int code);

    public interface TokenCallback { void onToken(String piece); }

    /* ---- fields ---- */
    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private TextToSpeech tts;
    private volatile boolean ttsReady = false;

    private ActivityResultLauncher<String[]> filePicker;
    private ActivityResultLauncher<String[]> importPicker;
    private volatile boolean importing = false;

    /**
     * Generation runs on a dedicated thread so the UI thread stays
     * responsive. We keep a reference so onDestroy can wait for it.
     */
    private volatile Thread genThread = null;

    /* ============================================================ */
    /* Lifecycle                                                    */
    /* ============================================================ */

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        /* Android 13+ requires a runtime request for POST_NOTIFICATIONS
         * or notifications silently fail. */
        requestNotificationPermissionIfNeeded();

        filePicker = registerForActivityResult(
            new ActivityResultContracts.OpenDocument(),
            uri -> {
                importing = false;
                if (uri == null) {
                    eval("window.__xenonImportError && window.__xenonImportError('cancelled');");
                    return;
                }
                new Thread(() -> importGguf(uri), "xenon-import").start();
            });

        importPicker = registerForActivityResult(
            new ActivityResultContracts.OpenDocument(),
            uri -> {
                if (uri == null) return;
                new Thread(() -> {
                    try {
                        StringBuilder sb = new StringBuilder();
                        try (InputStream in = getContentResolver().openInputStream(uri);
                             java.io.BufferedReader br = new java.io.BufferedReader(
                                 new java.io.InputStreamReader(in, "UTF-8"))) {
                            char[] buf = new char[8192];
                            int n;
                            while ((n = br.read(buf)) > 0) sb.append(buf, 0, n);
                        }
                        String json = sb.toString();
                        eval("window.__xenonBackupLoaded && window.__xenonBackupLoaded("
                             + JSONObject.quote(json) + ");");
                    } catch (Throwable t) {
                        Log.e(TAG, "importBackup read failed", t);
                        eval("window.__xenonImportError && window.__xenonImportError("
                             + JSONObject.quote(String.valueOf(t.getMessage())) + ");");
                    }
                }, "xenon-import-backup").start();
            });

        try {
            setContentView(R.layout.activity_main);

            web = findViewById(R.id.web);
            if (web == null) {
                showCrash("onCreate", new RuntimeException("R.id.web not found"));
                return;
            }

            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setAllowFileAccess(true);
            s.setAllowContentAccess(true);

            web.setWebViewClient(new WebViewClient());
            web.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onConsoleMessage(ConsoleMessage m) {
                    Log.d("XenonWeb", m.message());
                    return true;
                }
            });

            web.addJavascriptInterface(new Bridge(), "Xenon");

            /* Provide a Generator for the local server. */
            sGenerator = new LocalServer.Generator() {
                @Override
                public boolean generate(String prompt, int maxTokens,
                                        float temperature, float topP, int topK,
                                        LocalServer.TokenSink onToken) {
                    if (!nativeLoaded) return false;
                    final boolean[] ok = { false };
                    try {
                        Log.i(TAG, "server gen: prompt=" + prompt.length() + " chars, max=" + maxTokens);
                        int rc = nativeGenerateStream(prompt, maxTokens, temperature, topP, topK,
                            piece -> onToken.onToken(piece));
                        Log.i(TAG, "server gen: rc=" + rc);
                        ok[0] = (rc == 0);
                    } catch (Throwable t) {
                        Log.e(TAG, "server generate failed", t);
                        ok[0] = false;
                    }
                    return ok[0];
                }
                @Override
                public String modelName() {
                    String f = AppState.activeModelFilename(MainActivity.this);
                    return (f != null) ? f : "xenon-default";
                }
            };
            web.loadUrl("file:///android_asset/index.html");

            initTts();

            /* Back button: if a generation is running, cancel it instead
             * of killing the activity out from under the native call. */
            getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                @Override public void handleOnBackPressed() {
                    if (genThread != null && genThread.isAlive()) {
                        try { nativeCancelGeneration(); } catch (Throwable ignored) {}
                        toastViaJs("Stopping…");
                        return;
                    }
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            });

            Log.i(TAG, "onCreate complete; nativeLoaded=" + nativeLoaded);

            if (!nativeLoaded) {
                toastViaJs("Native library failed to load — model features disabled");
            }
        } catch (Throwable t) {
            showCrash("onCreate", t);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        try {
            if (intent != null && intent.getBooleanExtra("xenon_new_chat", false)) {
                intent.removeExtra("xenon_new_chat");
                eval("window.__xenonNewChat && window.__xenonNewChat();");
            }
        } catch (Throwable ignored) {}
    }

    @Override
    protected void onDestroy() {
        /* Stop any in-flight generation before tearing down native state. */
        try { nativeCancelGeneration(); } catch (Throwable ignored) {}
        Thread t = genThread;
        if (t != null) {
            try { t.join(2000); } catch (InterruptedException ignored) {}
        }
        sGenerator = null;
        try {
            if (nativeLoaded) nativeShutdown();
        } catch (Throwable ignored) {}
        try {
            if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        } catch (Throwable ignored) {}
        super.onDestroy();
    }

    /* ============================================================ */
    /* Crash dialog                                                 */
    /* ============================================================ */

    private void showCrash(String where, Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        String trace = sw.toString();
        Log.e(TAG, "CRASH " + where + ":\n" + trace);

        /* Keep the dialog readable: first 20 lines only. */
        String[] lines = trace.split("\n", 25);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(20, lines.length); i++) {
            sb.append(lines[i]).append('\n');
        }
        if (lines.length > 20) sb.append("…\n");

        try {
            new AlertDialog.Builder(this)
                .setTitle("Crash in " + where)
                .setMessage(sb.toString())
                .setPositiveButton("OK", null)
                .show();
        } catch (Throwable ignored) {}
    }

    /* ============================================================ */
    /* JS bridge plumbing                                           */
    /* ============================================================ */

    private void eval(String js) {
        if (web == null) return;
        ui.post(() -> {
            try { web.evaluateJavascript(js, null); }
            catch (Throwable ignored) {}
        });
    }

    private void toastViaJs(String msg) {
        eval("window.__xenonToast && window.__xenonToast("
             + JSONObject.quote(msg) + ");");
    }

    /* ============================================================ */
    /* Native wrappers                                              */
    /* ============================================================ */

    @JavascriptInterface
    public int loadModel(String path) {
        if (!nativeLoaded) return -1;
        try {
            return nativeInit(path);
        } catch (Throwable t) {
            Log.e(TAG, "loadModel failed", t);
            return -4;
        }
    }

    @JavascriptInterface
    public void shutdown() {
        if (!nativeLoaded) return;
        try { nativeShutdown(); } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public String statusString(int code) {
        if (!nativeLoaded) return "native library not loaded";
        try {
            return nativeStatusString(code);
        } catch (Throwable t) {
            return "unknown error " + code;
        }
    }

    @JavascriptInterface
    public void cancelGeneration() {
        if (!nativeLoaded) return;
        try { nativeCancelGeneration(); } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void continueContext() {
        if (!nativeLoaded) return;
        try { nativeContinueContext(); } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void resetContext() {
        if (!nativeLoaded) return;
        try { nativeResetContext(); } catch (Throwable ignored) {}
    }

    /* ============================================================ */
    /* Generation                                                   */
    /* ============================================================ */

    @JavascriptInterface
    public void generateStream(final String prompt, final int maxTokens,
                               final float temperature, final float topP,
                               final int topK, final long callbackId) {
        if (!nativeLoaded) {
            deliverError(callbackId, "native library not loaded");
            deliverDone(callbackId);
            return;
        }

        /* Serialize generations — only one at a time. */
        Thread prev = genThread;
        if (prev != null && prev.isAlive()) {
            deliverError(callbackId, "generation already in progress");
            deliverDone(callbackId);
            return;
        }

        Thread t = new Thread(() -> {
            int rc = 0;
            try {
                rc = nativeGenerateStream(prompt, maxTokens, temperature, topP, topK,
                    piece -> deliverToken(callbackId, piece));
            } catch (Throwable th) {
                Log.e(TAG, "generateStream crashed", th);
                deliverError(callbackId, String.valueOf(th.getMessage()));
                rc = -4;
            } finally {
                genThread = null;
            }

            if (rc == -6) {
                /* cancelled — no error, just done */
            } else if (rc != 0) {
                String msg;
                try { msg = nativeStatusString(rc); }
                catch (Throwable ignored) { msg = "code " + rc; }
                deliverError(callbackId, msg);
            }
            deliverDone(callbackId);
        }, "xenon-gen");

        genThread = t;
        t.start();
    }

    private void deliverToken(long id, String piece) {
        eval("window.__xenonToken && window.__xenonToken("
             + id + "," + JSONObject.quote(piece) + ");");
    }
    private void deliverError(long id, String msg) {
        eval("window.__xenonError && window.__xenonError("
             + id + "," + JSONObject.quote(msg == null ? "error" : msg) + ");");
    }
    private void deliverDone(long id) {
        eval("window.__xenonDone && window.__xenonDone(" + id + ");");
    }

    /* ============================================================ */
    /* Model list / selection                                       */
    /* ============================================================ */

    @JavascriptInterface
    public String listModels() {
        try {
            JSONArray arr = new JSONArray();
            String active = AppState.activeModelFilename(this);
            for (AppState.ModelInfo m : AppState.MODELS) {
                File f = m.file(this);
                long bytes = f.exists() ? f.length() : 0;
                boolean ready = f.exists() && bytes > m.approxBytes * 9 / 10;
                JSONObject o = new JSONObject();
                o.put("name", m.name);
                o.put("category", m.category);
                o.put("filename", m.filename);
                o.put("url", m.url);
                o.put("approxBytes", m.approxBytes);
                o.put("bytes", bytes);
                o.put("ready", ready);
                o.put("active", m.filename.equals(active));
                arr.put(o);
            }
            return arr.toString();
        } catch (Exception e) { return "[]"; }
    }

    @JavascriptInterface public void setActiveModel(String filename) { AppState.setActiveModel(this, filename); }
    @JavascriptInterface public boolean deleteModel(String filename)  { return new File(getFilesDir(), filename).delete(); }
    @JavascriptInterface public String modelPath(String filename)     { return new File(getFilesDir(), filename).getAbsolutePath(); }

    /* ============================================================ */
    /* Settings                                                     */
    /* ============================================================ */

    @JavascriptInterface
    public String getSettings() {
        try {
            JSONObject o = new JSONObject();
            o.put("maxTokens",   AppState.maxTokens(this));
            o.put("temperature", AppState.temperature(this));
            o.put("topP",        AppState.topP(this));
            o.put("topK",        AppState.topK(this));
            o.put("system",      AppState.systemPrompt(this));
            return o.toString();
        } catch (Exception e) { return "{}"; }
    }

    @JavascriptInterface
    public void saveSettings(int m, float t, float tp, int tk, String sys) {
        AppState.save(this, m, t, tp, tk, sys);
    }

    /* ============================================================ */
    /* Model download                                               */
    /* ============================================================ */

    @JavascriptInterface
    public void downloadModel(String url, String filename, long dlId) {
        new Thread(() -> downloadWorker(url, filename, dlId), "xenon-dl").start();
    }

    private void downloadWorker(String url, String filename, long dlId) {
        File tmp = new File(getFilesDir(), filename + ".part");
        File dst = new File(getFilesDir(), filename);
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "XenonLabs/1.0 (Android)");
            c.connect();
            if (c.getResponseCode() != 200) {
                throw new Exception("HTTP " + c.getResponseCode());
            }
            long total = c.getContentLengthLong(), done = 0;
            byte[] buf = new byte[1 << 16];
            try (InputStream in = c.getInputStream();
                 FileOutputStream out = new FileOutputStream(tmp)) {
                int n; long last = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n); done += n;
                    long now = System.currentTimeMillis();
                    if (now - last > 300) {
                        last = now;
                        int pct = total > 0 ? (int)(done * 100 / total) : 0;
                        notifyDownload(dlId, pct, done, total, false);
                    }
                }
            }
            if (!tmp.renameTo(dst)) {
                throw new Exception("rename failed");
            }
            notifyDownload(dlId, 100, done, total, true);
        } catch (Exception e) {
            /* Clean up the partial file so it does not accumulate. */
            try { if (tmp.exists()) tmp.delete(); } catch (Throwable ignored) {}
            notifyDownloadError(dlId, e.getMessage());
        }
    }

    private void notifyDownload(long id, int pct, long done, long total, boolean finished) {
        eval("window.__xenonDownload && window.__xenonDownload(" + id + "," + pct
             + "," + done + "," + total + "," + finished + ");");
    }
    private void notifyDownloadError(long id, String msg) {
        eval("window.__xenonDownloadError && window.__xenonDownloadError(" + id + ","
             + JSONObject.quote(msg == null ? "error" : msg) + ");");
    }

    /* ============================================================ */
    /* GGUF import from file picker                                 */
    /* ============================================================ */

    @JavascriptInterface
    public void importModel() {
        importing = true;
        ui.post(() -> {
            try {
                filePicker.launch(new String[]{"*/*"});
            } catch (Throwable t) {
                importing = false;
                eval("window.__xenonImportError && window.__xenonImportError(" +
                     JSONObject.quote(String.valueOf(t.getMessage())) + ");");
            }
        });
    }

    @JavascriptInterface
    public boolean isImporting() { return importing; }

    private void importGguf(Uri uri) {
        File dst = null;
        try {
            String display = queryDisplayName(uri);
            if (display == null || !display.toLowerCase().endsWith(".gguf")) {
                eval("window.__xenonImportError && window.__xenonImportError('Not a .gguf file');");
                return;
            }

            dst = new File(getFilesDir(), display);
            if (dst.exists()) {
                String base = display.substring(0, display.length() - 5);
                int i = 1;
                while (dst.exists()) {
                    dst = new File(getFilesDir(), base + "-" + i + ".gguf");
                    i++;
                }
            }

            long total = querySize(uri);
            long done = 0;
            try (InputStream in = getContentResolver().openInputStream(uri);
                 FileOutputStream out = new FileOutputStream(dst)) {
                if (in == null) throw new Exception("cannot open stream");
                byte[] buf = new byte[1 << 16];
                int n; long last = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    long now = System.currentTimeMillis();
                    if (now - last > 300) {
                        last = now;
                        int pct = total > 0 ? (int)(done * 100 / total) : -1;
                        long mbD = done / (1024 * 1024);
                        long mbT = total > 0 ? total / (1024 * 1024) : 0;
                        String msg = pct >= 0
                            ? ("Importing " + mbD + " / " + mbT + " MB · " + pct + "%")
                            : ("Importing " + mbD + " MB");
                        eval("window.__xenonImportProgress && window.__xenonImportProgress(" +
                             JSONObject.quote(msg) + ");");
                    }
                }
            }

            eval("window.__xenonImportDone && window.__xenonImportDone(" +
                 JSONObject.quote(dst.getName()) + ");");
        } catch (Throwable t) {
            /* Clean up partial import. */
            try { if (dst != null && dst.exists() && dst.length() == 0) dst.delete(); }
            catch (Throwable ignored) {}
            eval("window.__xenonImportError && window.__xenonImportError(" +
                 JSONObject.quote(String.valueOf(t.getMessage())) + ");");
        }
    }

    private String queryDisplayName(Uri uri) {
        try (android.database.Cursor c =
                 getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return c.getString(idx);
            }
        } catch (Throwable ignored) {}
        String last = uri.getLastPathSegment();
        return last != null ? last : "model.gguf";
    }

    private long querySize(Uri uri) {
        try (android.database.Cursor c =
                 getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.SIZE);
                if (idx >= 0) return c.getLong(idx);
            }
        } catch (Throwable ignored) {}
        return 0;
    }

    /* ============================================================ */
    /* TTS                                                          */
    /* ============================================================ */

    private void initTts() {
        if (tts != null) return;
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                try {
                    tts.setLanguage(Locale.getDefault());
                    tts.setSpeechRate(0.95f);
                    ttsReady = true;
                } catch (Throwable t) {
                    ttsReady = false;
                }
            } else {
                ttsReady = false;
            }
        });
    }

    @JavascriptInterface
    public boolean ttsAvailable() {
        return tts != null;
    }

    @JavascriptInterface
    public void speak(String text) {
        if (text == null || text.isEmpty()) return;
        if (tts == null) initTts();
        if (tts == null) {
            eval("window.__xenonTtsState && window.__xenonTtsState('unavailable');");
            return;
        }
        String clean = text
            .replaceAll("```[\\s\\S]*?```", " code block ")
            .replaceAll("`([^`]*)`", "$1")
            .replaceAll("\\*\\*([^*]*)\\*\\*", "$1")
            .replaceAll("\\*([^*]*)\\*", "$1")
            .replaceAll("^#+ ", "")
            .replaceAll("\\[(.+?)\\]\\(.+?\\)", "$1");

        ui.post(() -> {
            try {
                tts.stop();
                tts.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "xenon-tts");
                eval("window.__xenonTtsState && window.__xenonTtsState('speaking');");
            } catch (Throwable t) {
                eval("window.__xenonTtsState && window.__xenonTtsState('idle');");
            }
        });
    }

    @JavascriptInterface
    public void stopSpeaking() {
        if (tts != null) {
            try { tts.stop(); } catch (Throwable ignored) {}
        }
        eval("window.__xenonTtsState && window.__xenonTtsState('idle');");
    }

    /* ============================================================ */
    /* Notifications                                                */
    /* ============================================================ */

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                REQ_POST_NOTIFS);
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(NOTIF_CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                    NOTIF_CHANNEL_ID,
                    "Generation",
                    NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shown while the model is generating");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(this, 0, i, flags);
    }

    @JavascriptInterface
    public void showGenerationNotification(String text) {
        if (text == null) text = "Generating…";
        ensureNotificationChannel();
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("XenonLabs")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppIntent());
        try {
            NotificationManagerCompat.from(this).notify(NOTIF_ID, b.build());
        } catch (SecurityException ignored) {
            /* permission not granted */
        }
    }

    @JavascriptInterface
    public void hideGenerationNotification() {
        try { NotificationManagerCompat.from(this).cancel(NOTIF_ID); }
        catch (Throwable ignored) {}
    }

    /* ============================================================ */
    /* Widget reply                                                 */
    /* ============================================================ */

    @JavascriptInterface
    public void saveWidgetReply(String text) {
        if (text == null) text = "";
        String trimmed = text.length() > 200 ? text.substring(0, 200) + "…" : text;
        getSharedPreferences(XenonWidget.PREFS, MODE_PRIVATE)
            .edit().putString(XenonWidget.KEY_LAST, trimmed).apply();
        try { XenonWidget.refresh(this); } catch (Throwable ignored) {}
    }

    /* ============================================================ */
    /* In-app APK update                                            */
    /* ============================================================ */

    @JavascriptInterface
    public void downloadAndInstallApk(String url, String versionTag) {
        if (url == null || url.isEmpty()) {
            eval("window.__xenonApkError && window.__xenonApkError('no url');");
            return;
        }
        new Thread(() -> doDownloadApk(url, versionTag), "xenon-apk").start();
    }

    private void doDownloadApk(String url, String versionTag) {
        File out = null;
        try {
            File dir = new File(getFilesDir(), "updates");
            if (!dir.exists() && !dir.mkdirs()) {
                eval("window.__xenonApkError && window.__xenonApkError('mkdir failed');");
                return;
            }
            String safeTag = (versionTag == null || versionTag.isEmpty())
                ? "latest" : versionTag.replaceAll("[^a-zA-Z0-9._-]", "_");
            out = new File(dir, "xenonlabs-" + safeTag + ".apk");

            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", "XenonLabs/1.0 (Android)");
            c.connect();
            if (c.getResponseCode() != 200) {
                eval("window.__xenonApkError && window.__xenonApkError('HTTP " + c.getResponseCode() + "');");
                return;
            }
            long total = c.getContentLengthLong();
            long done = 0;
            byte[] buf = new byte[1 << 16];
            try (InputStream in = c.getInputStream();
                 FileOutputStream os = new FileOutputStream(out)) {
                int n; long last = 0;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    done += n;
                    long now = System.currentTimeMillis();
                    if (now - last > 300) {
                        last = now;
                        int pct = total > 0 ? (int)(done * 100 / total) : -1;
                        long mbD = done / 1048576;
                        long mbT = total > 0 ? total / 1048576 : 0;
                        String msg = pct >= 0
                            ? ("Downloading update " + mbD + " / " + mbT + " MB · " + pct + "%")
                            : ("Downloading update " + mbD + " MB");
                        eval("window.__xenonApkProgress && window.__xenonApkProgress("
                             + JSONObject.quote(msg) + ");");
                    }
                }
            }

            eval("window.__xenonApkProgress && window.__xenonApkProgress('Preparing install…');");

            Uri apkUri = FileProvider.getUriForFile(
                this, getPackageName() + ".fileprovider", out);

            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri,
                "application/vnd.android.package-archive");
            install.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(install);

            eval("window.__xenonApkDone && window.__xenonApkDone();");
        } catch (Throwable t) {
            try { if (out != null && out.exists()) out.delete(); }
            catch (Throwable ignored) {}
            eval("window.__xenonApkError && window.__xenonApkError("
                 + JSONObject.quote(String.valueOf(t.getMessage())) + ");");
        }
    }

    /* ============================================================ */
    /* JS bridge                                                    */
    /* ============================================================ */

    /* ============================================================ */
    /* Backup export / import                                       */
    /* ============================================================ */

    @JavascriptInterface
    public void exportBackup(String json, String suggestedName) {
        try {
            String name = (suggestedName == null || suggestedName.isEmpty())
                ? ("xenonlabs-backup-" + System.currentTimeMillis() + ".json")
                : suggestedName;
            if (!name.endsWith(".json")) name += ".json";

            File dir = new File(getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) {
                toastViaJs("Cannot create export dir");
                return;
            }
            File out = new File(dir, name);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(json.getBytes("UTF-8"));
            }

            Uri uri = FileProvider.getUriForFile(
                this, getPackageName() + ".fileprovider", out);

            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("application/json");
            share.putExtra(Intent.EXTRA_STREAM, uri);
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(share, "Save backup"));

            toastViaJs("Backup ready to save");
        } catch (Throwable t) {
            Log.e(TAG, "exportBackup failed", t);
            toastViaJs("Export failed: " + t.getMessage());
        }
    }

    @JavascriptInterface
    public void importBackup() {
        ui.post(() -> {
            try {
                importPicker.launch(new String[]{
                    "application/json", "text/plain", "*/*"});
            } catch (Throwable t) {
                Log.e(TAG, "importBackup launch failed", t);
                eval("window.__xenonImportError && window.__xenonImportError("
                     + JSONObject.quote(String.valueOf(t.getMessage())) + ");");
            }
        });
    }

    /* ============================================================ */
    /* Local server management                                      */
    /* ============================================================ */

    @JavascriptInterface
    public void nativeToast(String msg) {
        if (msg == null) msg = "";
        final String m = msg;
        runOnUiThread(() -> {
            try {
                android.widget.Toast.makeText(
                    MainActivity.this, m,
                    android.widget.Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {}
        });
    }

    @JavascriptInterface
    public void startLocalServer() {
        try {
            ServerService.start(this);
        } catch (Throwable t) {
            Log.e(TAG, "startLocalServer failed", t);
        }
    }

    @JavascriptInterface
    public void stopLocalServer() {
        try {
            ServerService.stop(this);
        } catch (Throwable t) {
            Log.e(TAG, "stopLocalServer failed", t);
        }
    }

    @JavascriptInterface
    public int getServerPort() {
        return ServerService.getPort(this);
    }

    @JavascriptInterface
    public void setServerPort(int port) {
        if (port < 1024 || port > 65535) return;
        ServerService.setPort(this, port);
    }

    @JavascriptInterface
    public String getServerApiKey() {
        return ServerService.getApiKey(this);
    }

    @JavascriptInterface
    public String regenerateServerApiKey() {
        return ServerService.regenerateKey(this);
    }

    @JavascriptInterface
    public boolean isServerEnabled() {
        return ServerService.isEnabled(this);
    }

    /** Returns a small JSON blob with the current status. */
    @JavascriptInterface
    public String getServerStatus() {
        try {
            JSONObject o = new JSONObject();
            int port = ServerService.getPort(this);
            o.put("enabled", ServerService.isEnabled(this));
            o.put("port", port);

            /* Loopback URL — only reachable from this device. */
            o.put("localUrl", "http://127.0.0.1:" + port + "/v1");

            /* LAN URL — reachable from other devices on the same network. */
            String ip = com.xenonlabs.app.LocalServer.localIpv4();
            if (ip != null && !ip.isEmpty()) {
                o.put("ip", ip);
                o.put("lanUrl", "http://" + ip + ":" + port + "/v1");
            } else {
                o.put("ip", "");
                o.put("lanUrl", "");
            }
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    public class Bridge {
        @JavascriptInterface public int     loadModel(String p)                        { return MainActivity.this.loadModel(p); }
        @JavascriptInterface public void    shutdown()                                 { MainActivity.this.shutdown(); }
        @JavascriptInterface public String  statusString(int code)                     { return MainActivity.this.statusString(code); }
        @JavascriptInterface public void    generateStream(String p, int m, float t, float tp, int tk, long id) {
            MainActivity.this.generateStream(p, m, t, tp, tk, id);
        }
        @JavascriptInterface public String  listModels()                                { return MainActivity.this.listModels(); }
        @JavascriptInterface public void    setActiveModel(String f)                    { MainActivity.this.setActiveModel(f); }
        @JavascriptInterface public boolean deleteModel(String f)                       { return MainActivity.this.deleteModel(f); }
        @JavascriptInterface public String  getSettings()                               { return MainActivity.this.getSettings(); }
        @JavascriptInterface public void    saveSettings(int m, float t, float tp, int tk, String s) {
            MainActivity.this.saveSettings(m, t, tp, tk, s);
        }
        @JavascriptInterface public String  modelPath(String f)                         { return MainActivity.this.modelPath(f); }
        @JavascriptInterface public void    downloadModel(String u, String f, long id)  { MainActivity.this.downloadModel(u, f, id); }
        @JavascriptInterface public void    importModel()                               { MainActivity.this.importModel(); }
        @JavascriptInterface public boolean isImporting()                               { return MainActivity.this.isImporting(); }

        @JavascriptInterface public void    speak(String text)                          { MainActivity.this.speak(text); }
        @JavascriptInterface public void    stopSpeaking()                              { MainActivity.this.stopSpeaking(); }
        @JavascriptInterface public void    showGenerationNotification(String text)     { MainActivity.this.showGenerationNotification(text); }
        @JavascriptInterface public void    hideGenerationNotification()                { MainActivity.this.hideGenerationNotification(); }
        @JavascriptInterface public void    cancelGeneration()                          { MainActivity.this.cancelGeneration(); }
        @JavascriptInterface public void    continueContext()                           { MainActivity.this.continueContext(); }
        @JavascriptInterface public void    resetContext()                              { MainActivity.this.resetContext(); }
        @JavascriptInterface public void    downloadAndInstallApk(String u, String v)   { MainActivity.this.downloadAndInstallApk(u, v); }
        @JavascriptInterface public void    saveWidgetReply(String text)                { MainActivity.this.saveWidgetReply(text); }
        @JavascriptInterface public void    nativeToast(String msg)                  { MainActivity.this.nativeToast(msg); }
        @JavascriptInterface public void   startLocalServer()                      { MainActivity.this.startLocalServer(); }
        @JavascriptInterface public void   stopLocalServer()                       { MainActivity.this.stopLocalServer(); }
        @JavascriptInterface public int    getServerPort()                         { return MainActivity.this.getServerPort(); }
        @JavascriptInterface public void   setServerPort(int port)                 { MainActivity.this.setServerPort(port); }
        @JavascriptInterface public String getServerApiKey()                       { return MainActivity.this.getServerApiKey(); }
        @JavascriptInterface public String regenerateServerApiKey()                { return MainActivity.this.regenerateServerApiKey(); }
        @JavascriptInterface public boolean isServerEnabled()                      { return MainActivity.this.isServerEnabled(); }
        @JavascriptInterface public String getServerStatus()                       { return MainActivity.this.getServerStatus(); }
        @JavascriptInterface public void    exportBackup(String json, String name) { MainActivity.this.exportBackup(json, name); }
        @JavascriptInterface public void    importBackup()                         { MainActivity.this.importBackup(); }
    }
}
