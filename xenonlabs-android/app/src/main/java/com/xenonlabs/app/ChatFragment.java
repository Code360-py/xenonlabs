package com.xenonlabs.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.method.ScrollingMovementMethod;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import java.io.File;

public class ChatFragment extends Fragment {

    static { System.loadLibrary("xenonlabs_jni"); }

    private native int nativeInit(String path);
    private native void nativeShutdown();
    private native int nativeGenerateStream(String prompt, int maxTokens,
                                            float temperature, float topP, int topK,
                                            TokenCallback cb);

    public interface TokenCallback {
        void onToken(String piece);
    }

    private LinearLayout messages;
    private ScrollView   scroll;
    private EditText     input;
    private Button       send;
    private TextView     header;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean ready = false;
    private boolean busy  = false;
    private int     msgCount = 0;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater,
                             @Nullable ViewGroup container,
                             @Nullable Bundle saved) {
        View v = inflater.inflate(R.layout.fragment_chat, container, false);
        messages = v.findViewById(R.id.messages);
        scroll   = v.findViewById(R.id.scroll);
        input    = v.findViewById(R.id.input);
        send     = v.findViewById(R.id.send);
        header   = v.findViewById(R.id.header);
        input.setMovementMethod(new ScrollingMovementMethod());

        send.setOnClickListener(x -> onSend());
        refreshHeader();
        tryLoad();
        return v;
    }

    @Override
    public void onResume() {
        super.onResume();
        refreshHeader();
        if (!ready) tryLoad();
    }

    private void refreshHeader() {
        String active = AppState.activeModelFilename(requireContext());
        header.setText(active == null
            ? "No model selected — open the Models tab"
            : "Model: " + active);
    }

    private void tryLoad() {
        String fn = AppState.activeModelFilename(requireContext());
        if (fn == null) return;

        File f = new File(requireContext().getFilesDir(), fn);
        if (!f.exists()) return;

        new Thread(() -> {
            int rc = nativeInit(f.getAbsolutePath());
            ui.post(() -> {
                ready = rc == 0;
                if (ready) {
                    addSystem("Model loaded. Ask anything.");
                } else {
                    addSystem("Init failed: " + rc);
                }
            });
        }).start();
    }

    private void onSend() {
        if (!ready) { toast("Model not ready"); return; }
        if (busy)   return;

        String prompt = input.getText().toString().trim();
        if (prompt.isEmpty()) return;
        input.setText("");
        addUser(prompt);
        busy = true;
        send.setEnabled(false);

        TextView assistant = addBubble("🤖  ", "");
        StringBuilder collected = new StringBuilder();

        new Thread(() -> {
            int maxTok = AppState.maxTokens(requireContext());
            float temp = AppState.temperature(requireContext());
            float topP = AppState.topP(requireContext());
            int   topK = AppState.topK(requireContext());

            /* wrap in Qwen chat template */
            String wrapped =
                "<|im_start|>system\n" + AppState.systemPrompt(requireContext()) +
                "<|im_end|>\n<|im_start|>user\n" + prompt +
                "<|im_end|>\n<|im_start|>assistant\n";

            int rc = nativeGenerateStream(wrapped, maxTok, temp, topP, topK,
                piece -> {
                    collected.append(piece);
                    ui.post(() -> {
                        assistant.setText("🤖  " + collected.toString());
                        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
                    });
                });

            ui.post(() -> {
                busy = false;
                send.setEnabled(true);
                if (rc != 0 && collected.length() == 0)
                    assistant.setText("🤖  [error]");
            });
        }).start();
    }

    private void addUser(String s)      { addBubble("🧑  ", s); }
    private void addSystem(String s)    {
        TextView t = new TextView(requireContext());
        t.setText("· " + s);
        t.setTextSize(12f);
        t.setPadding(8, 4, 8, 4);
        messages.addView(t);
        scrollDown();
    }

    private TextView addBubble(String prefix, String text) {
        TextView t = new TextView(requireContext());
        t.setText(prefix + text);
        t.setTextSize(15f);
        t.setPadding(12, 10, 12, 10);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 6, 0, 6);
        t.setLayoutParams(lp);
        messages.addView(t);
        scrollDown();
        msgCount++;
        return t;
    }

    private void scrollDown() {
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private void toast(String s) {
        Toast.makeText(requireContext(), s, Toast.LENGTH_SHORT).show();
    }
}
