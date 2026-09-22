package com.xenonlabs.app;

import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.method.ScrollingMovementMethod;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends AppCompatActivity {

    static { System.loadLibrary("xenonlabs_jni"); }

    private static final String MODEL_URL =
        "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf";
    private static final String MODEL_FILENAME = "qwen2.5-0.5b-instruct-q4_k_m.gguf";
    private static final long   MODEL_MIN_BYTES = 300L * 1024 * 1024;

    private native int    nativeInit(String modelPath);
    private native String nativeGenerate(String prompt, int maxTokens);
    private native void   nativeShutdown();

    private TextView   output;
    private EditText   input;
    private Button     send;
    private ProgressBar progress;
    private TextView   status;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean modelReady = false;
    private boolean busy       = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);

        output   = findViewById(R.id.output);
        input    = findViewById(R.id.input);
        send     = findViewById(R.id.send);
        progress = findViewById(R.id.progress);
        status   = findViewById(R.id.status);

        output.setMovementMethod(new ScrollingMovementMethod());

        ensureModel();

        send.setOnClickListener(v -> {
            if (!modelReady || busy) return;
            String p = input.getText().toString().trim();
            if (p.isEmpty()) return;
            input.setText("");
            appendUser(p);
            busy = true;
            send.setEnabled(false);
            progress.setVisibility(View.VISIBLE);
            progress.setIndeterminate(true);
            new Thread(() -> {
                String r = nativeGenerate(p, 256);
                ui.post(() -> {
                    appendAssistant(r);
                    busy = false;
                    send.setEnabled(true);
                    progress.setIndeterminate(false);
                    progress.setVisibility(View.GONE);
                });
            }).start();
        });
    }

    @Override
    protected void onDestroy() {
        nativeShutdown();
        super.onDestroy();
    }

    private File modelFile() {
        return new File(getFilesDir(), MODEL_FILENAME);
    }

    private void ensureModel() {
        File f = modelFile();
        if (f.exists() && f.length() >= MODEL_MIN_BYTES) {
            loadModel();
            return;
        }

        new AlertDialog.Builder(this)
            .setTitle("Download model")
            .setMessage("Qwen2.5-0.5B-Instruct (~400 MB) will be downloaded once.\n\nWi-Fi recommended.")
            .setCancelable(false)
            .setPositiveButton("Download", (d, w) -> downloadModel())
            .setNegativeButton("Use demo model", (d, w) -> useBundledDemo())
            .show();
    }

    private void useBundledDemo() {
        new Thread(() -> {
            File dst = modelFile();
            try (InputStream is = getAssets().open("model.gguf");
                 FileOutputStream os = new FileOutputStream(dst)) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
            } catch (Exception e) {
                ui.post(() -> appendSystem("Failed: " + e));
                return;
            }
            ui.post(this::loadModel);
        }).start();
    }

    private void downloadModel() {
        progress.setVisibility(View.VISIBLE);
        progress.setIndeterminate(false);
        status.setVisibility(View.VISIBLE);
        status.setText("Connecting…");

        new Thread(() -> {
            File tmp = new File(getFilesDir(), MODEL_FILENAME + ".part");
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(MODEL_URL).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.connect();
                if (conn.getResponseCode() != 200)
                    throw new Exception("HTTP " + conn.getResponseCode());

                long total = conn.getContentLengthLong();
                long done  = 0;

                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    long lastUpdate = 0;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastUpdate > 500) {
                            lastUpdate = now;
                            int pct = total > 0 ? (int)(done * 100 / total) : 0;
                            long mb  = done / (1024 * 1024);
                            long mbT = total > 0 ? total / (1024 * 1024) : 0;
                            ui.post(() -> {
                                progress.setProgress(pct);
                                status.setText("Downloading " + mb + " / " + mbT + " MB (" + pct + "%)");
                            });
                        }
                    }
                }
                tmp.renameTo(modelFile());
                ui.post(() -> {
                    status.setText("Loading model…");
                    loadModel();
                });
            } catch (Exception e) {
                ui.post(() -> {
                    status.setText("Download failed: " + e.getMessage());
                    progress.setVisibility(View.GONE);
                });
            }
        }).start();
    }

    private void loadModel() {
        status.setVisibility(View.VISIBLE);
        status.setText("Loading model…");
        progress.setVisibility(View.VISIBLE);

        new Thread(() -> {
            int rc = nativeInit(modelFile().getAbsolutePath());
            ui.post(() -> {
                progress.setVisibility(View.GONE);
                if (rc == 0) {
                    modelReady = true;
                    status.setText("Ready");
                    status.setVisibility(View.GONE);
                    appendSystem("Model ready. Ask anything.");
                } else {
                    status.setText("Init failed: " + rc);
                }
            });
        }).start();
    }

    private void appendUser(String s)      { appendLine("🧑  " + s); }
    private void appendAssistant(String s) { appendLine("🤖  " + s); }
    private void appendSystem(String s)    { appendLine("· " + s); }

    private void appendLine(String s) {
        ui.post(() -> {
            output.append(s + "\n\n");
            ScrollView sv = findViewById(R.id.scroll);
            sv.post(() -> sv.fullScroll(ScrollView.FOCUS_DOWN));
        });
    }
}
