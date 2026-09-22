package com.xenonlabs.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public class MainActivity extends AppCompatActivity {

    static { System.loadLibrary("xenonlabs_jni"); }

    private native int    nativeInit(String modelPath);
    private native String nativeGenerate(String prompt, int maxTokens);
    private native void   nativeShutdown();

    private TextView output;
    private EditText input;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);

        output = findViewById(R.id.output);
        input  = findViewById(R.id.input);
        Button send = findViewById(R.id.send);

        new Thread(() -> {
            File modelFile = new File(getFilesDir(), "model.gguf");
            if (!modelFile.exists()) {
                append("Copying model from assets…");
                try (InputStream is = getAssets().open("model.gguf");
                     FileOutputStream os = new FileOutputStream(modelFile)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
                } catch (Exception e) {
                    append("Model copy failed: " + e.getMessage());
                    return;
                }
            }
            int rc = nativeInit(modelFile.getAbsolutePath());
            append(rc == 0 ? "Model ready." : ("Init failed: " + rc));
        }).start();

        send.setOnClickListener(v -> {
            String p = input.getText().toString().trim();
            if (p.isEmpty()) return;
            input.setText("");
            append("> " + p);
            new Thread(() -> {
                String r = nativeGenerate(p, 128);
                append(r);
            }).start();
        });
    }

    @Override
    protected void onDestroy() {
        nativeShutdown();
        super.onDestroy();
    }

    private void append(String s) {
        ui.post(() -> {
            output.append(s + "\n\n");
            ScrollView sv = findViewById(R.id.scroll);
            sv.post(() -> sv.fullScroll(ScrollView.FOCUS_DOWN));
        });
    }
}
