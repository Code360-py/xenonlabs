package com.xenonlabs.app;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.PrintWriter;
import java.io.StringWriter;

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
    private native int  nativeGenerateStream(String prompt, int maxTokens,
                                             float temperature, float topP, int topK,
                                             TokenCallback cb);

    public interface TokenCallback { void onToken(String piece); }

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile long currentCallbackId = -1;

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

            Log.i(TAG, "onCreate complete; nativeLoaded=" + nativeLoaded);
        } catch (Throwable t) {
            showCrash("onCreate", t);
        }
    }

    @Override
    protected void onDestroy() {
        try { if (nativeLoaded) nativeShutdown(); } catch (Throwable ignored) {}
        super.onDestroy();
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
    }
}
