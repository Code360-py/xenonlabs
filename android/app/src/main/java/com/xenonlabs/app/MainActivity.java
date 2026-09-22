package com.xenonlabs.app;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.provider.OpenableColumns;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "XenonLabs";
    private static boolean nativeLoaded = false;

    static {
        try {
            System.loadLibrary("xenonlabs_jni");
            nativeLoaded = true;
        } catch (Throwable t) {
            Log.e(TAG, "native load failed", t);
        }
    }

    private native int  nativeInit(String path);
    private native void nativeShutdown();
    private native void nativeCancelGeneration();

    private native int  nativeGenerateStream(String prompt, int maxTokens,
                                             float temperature, float topP, int topK,
                                             TokenCallback cb);

    public interface TokenCallback { void onToken(String piece); }

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile long currentCallbackId = -1;
    private TextToSpeech tts;
    private static final String NOTIF_CHANNEL_ID = "xenon-generation";
    private static final int NOTIF_ID = 42;
    private volatile boolean ttsReady = false;
    private ActivityResultLauncher<String[]> filePicker;
    private volatile boolean importing = false;

    private void showCrash(String where, Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        String trace = sw.toString();
        Log.e(TAG, "CRASH " + where + ":\n" + trace);
        try {
            new AlertDialog.Builder(this)
                .setTitle("Crash in " + where)
                .setMessage(trace)
                .setPositiveButton("OK", null)
                .show();
        } catch (Throwable ignored) {}
    }

    @JavascriptInterface public void setCallbackId(long id) { currentCallbackId = id; }
    @JavascriptInterface public int  loadModel(String path) { return nativeInit(path); }
    @JavascriptInterface public void shutdown()             { nativeShutdown(); }

    @JavascriptInterface
    public void generateStream(final String prompt, final int maxTokens,
                               final float temperature, final float topP,
                               final int topK, final long callbackId) {
        new Thread(() -> {
            try {
                nativeGenerateStream(prompt, maxTokens, temperature, topP, topK,
                    piece -> deliverToken(callbackId, piece));
            } catch (Throwable t) {
                deliverError(callbackId, String.valueOf(t.getMessage()));
            } finally {
                deliverDone(callbackId);
            }
        }, "xenon-gen").start();
    }

    private void deliverToken(long id, String piece) {
        eval("window.__xenonToken && window.__xenonToken(" + id + "," + JSONObject.quote(piece) + ");");
    }
    private void deliverError(long id, String msg) {
        eval("window.__xenonError && window.__xenonError(" + id + "," + JSONObject.quote(msg == null ? "error" : msg) + ");");
    }
    private void deliverDone(long id) {
        eval("window.__xenonDone && window.__xenonDone(" + id + ");");
    }
    private void eval(String js) {
        if (web == null) return;
        ui.post(() -> { try { web.evaluateJavascript(js, null); } catch (Throwable ignored) {} });
    }

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

    @JavascriptInterface
    public void downloadModel(String url, String filename, long dlId) {
        new Thread(() -> downloadWorker(url, filename, dlId)).start();
    }

    private void downloadWorker(String url, String filename, long dlId) {
        try {
            java.net.HttpURLConnection c =
                (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            c.connect();
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            long total = c.getContentLengthLong(), done = 0;
            File tmp = new File(getFilesDir(), filename + ".part");
            byte[] buf = new byte[1 << 16];
            try (java.io.InputStream in = c.getInputStream();
                 java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
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
            tmp.renameTo(new File(getFilesDir(), filename));
            notifyDownload(dlId, 100, done, total, true);
        } catch (Exception e) { notifyDownloadError(dlId, e.getMessage()); }
    }

    private void notifyDownload(long id, int pct, long done, long total, boolean finished) {
        eval("window.__xenonDownload && window.__xenonDownload(" + id + "," + pct
             + "," + done + "," + total + "," + finished + ");");
    }
    private void notifyDownloadError(long id, String msg) {
        eval("window.__xenonDownloadError && window.__xenonDownloadError(" + id + ","
             + JSONObject.quote(msg == null ? "error" : msg) + ");");
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        filePicker = registerForActivityResult(
            new ActivityResultContracts.OpenDocument(),
            uri -> {
                importing = false;
                if (uri == null) {
                    eval("window.__xenonImportError && window.__xenonImportError('cancelled');");
                    return;
                }
                new Thread(() -> importGguf(uri)).start();
            });

        try {
            setContentView(R.layout.activity_main);

            web = findViewById(R.id.web);
            if (web == null) { showCrash("onCreate", new RuntimeException("R.id.web is null")); return; }

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
            web.loadUrl("file:///android_asset/index.html");

            initTts();

            Log.i(TAG, "onCreate complete; nativeLoaded=" + nativeLoaded);
        } catch (Throwable t) {
            showCrash("onCreate", t);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);

        /* The WebView is already loaded. Don't re-create it.
         * If the widget asked for a new chat, tell the JS side. */
        try {
            if (intent != null && intent.getBooleanExtra("xenon_new_chat", false)) {
                intent.removeExtra("xenon_new_chat");
                eval("window.__xenonNewChat && window.__xenonNewChat();");
            }
        } catch (Throwable ignored) {}
    }

    @Override
    protected void onDestroy() {
        try { if (nativeLoaded) nativeShutdown(); } catch (Throwable ignored) {}
        try {
            if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        } catch (Throwable ignored) {}
        super.onDestroy();
    }

    /* ============================================================
       Import a .gguf file from the device's file system
       ============================================================ */

    @JavascriptInterface
    public void importModel() {
        importing = true;
        ui.post(() -> {
            try {
                /* any MIME — Android shows "Browse" fallback for gguf */
                filePicker.launch(new String[]{"*/*"});
            } catch (Throwable t) {
                importing = false;
                eval("window.__xenonImportError && window.__xenonImportError('" +
                     JSONObject.quote(String.valueOf(t.getMessage())) + "');");
            }
        });
    }

    @JavascriptInterface
    public boolean isImporting() { return importing; }

    private void importGguf(Uri uri) {
        try {
            String display = queryDisplayName(uri);
            if (display == null || !display.toLowerCase().endsWith(".gguf")) {
                eval("window.__xenonImportError && window.__xenonImportError('Not a .gguf file');");
                return;
            }

            File dst = new File(getFilesDir(), display);

            /* if same name exists, add suffix */
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
            try (java.io.InputStream in = getContentResolver().openInputStream(uri);
                 java.io.FileOutputStream out = new java.io.FileOutputStream(dst)) {
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

            /* register as a custom model in JS land, then activate it */
            eval("window.__xenonImportDone && window.__xenonImportDone(" +
                 JSONObject.quote(dst.getName()) + ");");
        } catch (Throwable t) {
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

    /* ============================================================
       Text-to-speech
       ============================================================ */

    private void initTts() {
        if (tts != null) return;
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                try {
                    tts.setLanguage(Locale.getDefault());
                    /* slow down slightly — LLM output sounds fast at 1.0 */
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
        /* clean up markdown that would sound weird */
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

    /* ============================================================
       Notifications
       ============================================================ */

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
        } catch (SecurityException ignored) { /* permission not granted */ }
    }

    @JavascriptInterface
    public void hideGenerationNotification() {
        try {
            NotificationManagerCompat.from(this).cancel(NOTIF_ID);
        } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void saveWidgetReply(String text) {
        if (text == null) text = "";
        String trimmed = text.length() > 200 ? text.substring(0, 200) + "…" : text;
        getSharedPreferences(XenonWidget.PREFS, MODE_PRIVATE)
            .edit().putString(XenonWidget.KEY_LAST, trimmed).apply();
        try { XenonWidget.refresh(this); } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void cancelGeneration() {
        try { nativeCancelGeneration(); } catch (Throwable ignored) {}
    }

    public class Bridge {
        @JavascriptInterface public int    loadModel(String p)                        { return MainActivity.this.loadModel(p); }
        @JavascriptInterface public void   shutdown()                                 { MainActivity.this.shutdown(); }
        @JavascriptInterface public void   setCallbackId(long id)                     { MainActivity.this.setCallbackId(id); }
        @JavascriptInterface public void   generateStream(String p, int m, float t, float tp, int tk, long id) {
            MainActivity.this.generateStream(p, m, t, tp, tk, id);
        }
        @JavascriptInterface public String listModels()                                { return MainActivity.this.listModels(); }
        @JavascriptInterface public void   setActiveModel(String f)                    { MainActivity.this.setActiveModel(f); }
        @JavascriptInterface public boolean deleteModel(String f)                      { return MainActivity.this.deleteModel(f); }
        @JavascriptInterface public String getSettings()                               { return MainActivity.this.getSettings(); }
        @JavascriptInterface public void   saveSettings(int m, float t, float tp, int tk, String s) {
            MainActivity.this.saveSettings(m, t, tp, tk, s);
        }
        @JavascriptInterface public String modelPath(String f)                         { return MainActivity.this.modelPath(f); }
        @JavascriptInterface public void   downloadModel(String u, String f, long id)  { MainActivity.this.downloadModel(u, f, id); }
        @JavascriptInterface public void   importModel()                              { MainActivity.this.importModel(); }
        @JavascriptInterface public boolean isImporting()                             { return MainActivity.this.isImporting(); }
    
        @JavascriptInterface public void   speak(String text)                         { MainActivity.this.speak(text); }
        @JavascriptInterface public void   stopSpeaking()                             { MainActivity.this.stopSpeaking(); }
        @JavascriptInterface public void   showGenerationNotification(String text)    { MainActivity.this.showGenerationNotification(text); }
        @JavascriptInterface public void   hideGenerationNotification()              { MainActivity.this.hideGenerationNotification(); }
        @JavascriptInterface public void   cancelGeneration()                        { MainActivity.this.cancelGeneration(); }
        @JavascriptInterface public void   saveWidgetReply(String text)                { MainActivity.this.saveWidgetReply(text); }
    }
}
