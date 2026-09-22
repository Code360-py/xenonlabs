package com.xenonlabs.app;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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

public class MainActivity extends AppCompatActivity {

    static { System.loadLibrary("xenonlabs_jni"); }

    /* ---------- native ---------- */
    private native int nativeInit(String path);
    private native void nativeShutdown();
    private native int nativeGenerateStream(String prompt, int maxTokens,
                                            float temperature, float topP, int topK,
                                            TokenCallback cb);
    public interface TokenCallback { void onToken(String piece); }

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());

    /* ---------- token routing ---------- */
    /* each generateStream request gets a fresh callbackId; JS-side has a map */
    private volatile long currentCallbackId = -1;

    /** Called from JS to set the active callbackId for the next stream. */
    @JavascriptInterface
    public void setCallbackId(long id) { currentCallbackId = id; }

    /** Delivers one token to JS via eval. */
    private void deliverToken(String piece, long callbackId) {
        String js = "window.__xenonToken(" + callbackId + ", " +
                    JSONObject.quote(piece) + ");";
        ui.post(() -> web.evaluateJavascript(js, null));
    }

    /* ---------- JS bridge ---------- */

    @JavascriptInterface
    public String ping() { return "pong"; }

    @JavascriptInterface
    public int loadModel(String path) {
        return nativeInit(path);
    }

    @JavascriptInterface
    public void shutdown() { nativeShutdown(); }

    @JavascriptInterface
    public int generateStream(String prompt, int maxTokens, float temperature,
                              float topP, int topK) {
        long id = currentCallbackId;
        TokenCallback cb = piece -> deliverToken(piece, id);
        return nativeGenerateStream(prompt, maxTokens, temperature, topP, topK, cb);
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
                o.put("filename", m.filename);
                o.put("url", m.url);
                o.put("approxBytes", m.approxBytes);
                o.put("bytes", bytes);
                o.put("ready", ready);
                o.put("active", m.filename.equals(active));
                arr.put(o);
            }
            return arr.toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    @JavascriptInterface
    public void setActiveModel(String filename) {
        AppState.setActiveModel(this, filename);
    }

    @JavascriptInterface
    public boolean deleteModel(String filename) {
        File f = new File(getFilesDir(), filename);
        return f.delete();
    }

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
    public void saveSettings(int maxTok, float temp, float topP, int topK, String sys) {
        AppState.save(this, maxTok, temp, topP, topK, sys);
    }

    /* Called from JS as: Xenon.downloadModel(url, filename, dlId) */
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

            long total = c.getContentLengthLong();
            long done = 0;
            File tmp = new File(getFilesDir(), filename + ".part");
            byte[] buf = new byte[1 << 16];

            try (java.io.InputStream in = c.getInputStream();
                 java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
                int n; long last = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    done += n;
                    long now = System.currentTimeMillis();
                    if (now - last > 400) {
                        last = now;
                        int pct = total > 0 ? (int)(done * 100 / total) : 0;
                        notifyDownload(dlId, pct, done, total, false);
                    }
                }
            }
            tmp.renameTo(new File(getFilesDir(), filename));
            notifyDownload(dlId, 100, done, total, true);

        } catch (Exception e) {
            notifyDownloadError(dlId, e.getMessage());
        }
    }

    private void notifyDownload(long id, int pct, long done, long total, boolean finished) {
        String js = "window.__xenonDownload(" + id + "," + pct + "," + done + "," + total + "," + finished + ");";
        ui.post(() -> web.evaluateJavascript(js, null));
    }

    private void notifyDownloadError(long id, String msg) {
        String js = "window.__xenonDownloadError(" + id + "," + JSONObject.quote(msg) + ");";
        ui.post(() -> web.evaluateJavascript(js, null));
    }

    /* ---------- Activity ---------- */

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("XenonWeb", m.message());
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Xenon");
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onDestroy() {
        nativeShutdown();
        super.onDestroy();
    }

    /* Small inner class so JS calls land on a proper bridge object */
    public class Bridge {
        @JavascriptInterface public String ping() { return MainActivity.this.ping(); }
        @JavascriptInterface public int    loadModel(String p) { return MainActivity.this.loadModel(p); }
        @JavascriptInterface public void   shutdown()          { MainActivity.this.shutdown(); }
        @JavascriptInterface public int    generateStream(String p, int m, float t, float tp, int tk) {
            return MainActivity.this.generateStream(p, m, t, tp, tk);
        }
        @JavascriptInterface public void   setCallbackId(long id) { MainActivity.this.setCallbackId(id); }
        @JavascriptInterface public String listModels()        { return MainActivity.this.listModels(); }
        @JavascriptInterface public void   setActiveModel(String f) { MainActivity.this.setActiveModel(f); }
        @JavascriptInterface public boolean deleteModel(String f)   { return MainActivity.this.deleteModel(f); }
        @JavascriptInterface public String getSettings()       { return MainActivity.this.getSettings(); }
        @JavascriptInterface public void   saveSettings(int m, float t, float tp, int tk, String s) {
            MainActivity.this.saveSettings(m, t, tp, tk, s);
        }
        @JavascriptInterface public void   downloadModel(String u, String f, long id) {
            MainActivity.this.downloadModel(u, f, id);
        }
    }
}
