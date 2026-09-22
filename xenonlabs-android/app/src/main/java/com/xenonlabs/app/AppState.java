package com.xenonlabs.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public final class AppState {

    /* ---- Available models ---- */
    public static final class ModelInfo {
        public final String name;
        public final String filename;
        public final String url;
        public final long   approxBytes;

        public ModelInfo(String name, String filename, String url, long approxBytes) {
            this.name = name;
            this.filename = filename;
            this.url = url;
            this.approxBytes = approxBytes;
        }
        public File file(Context ctx) { return new File(ctx.getFilesDir(), filename); }
        public boolean isReady(Context ctx) {
            File f = file(ctx);
            return f.exists() && f.length() > approxBytes * 9 / 10;
        }
    }

    public static final ModelInfo[] MODELS = new ModelInfo[] {
        new ModelInfo(
            "Qwen2.5 0.5B Instruct (Q4_K_M)",
            "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
            400L * 1024 * 1024),
        new ModelInfo(
            "TinyLlama 1.1B Chat (Q4_K_M)",
            "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
            "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
            670L * 1024 * 1024),
        new ModelInfo(
            "SmolLM2 360M Instruct (Q4_K_M)",
            "SmolLM2-360M-Instruct-Q4_K_M.gguf",
            "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf",
            270L * 1024 * 1024),
        new ModelInfo(
            "TinyStories 15M (demo, tiny)",
            "stories15M-q4_0.gguf",
            "https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories15M-q4_0.gguf",
            20L  * 1024 * 1024),
    };

    /* ---- Settings keys ---- */
    private static final String P = "xenonlabs";
    private static final String K_MODEL    = "active_model";     /* filename */
    private static final String K_MAXTOK   = "max_tokens";
    private static final String K_TEMP     = "temperature";
    private static final String K_TOPP     = "top_p";
    private static final String K_TOPK     = "top_k";
    private static final String K_SYSPROMPT= "system_prompt";

    private AppState() {}

    public static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(P, Context.MODE_PRIVATE);
    }

    public static String activeModelFilename(Context ctx) {
        return prefs(ctx).getString(K_MODEL, null);
    }
    public static void setActiveModel(Context ctx, String filename) {
        prefs(ctx).edit().putString(K_MODEL, filename).apply();
    }

    public static int    maxTokens(Context ctx)   { return prefs(ctx).getInt(K_MAXTOK, 256); }
    public static float  temperature(Context ctx) { return prefs(ctx).getFloat(K_TEMP, 0.7f); }
    public static float  topP(Context ctx)        { return prefs(ctx).getFloat(K_TOPP, 0.95f); }
    public static int    topK(Context ctx)        { return prefs(ctx).getInt(K_TOPK, 40); }
    public static String systemPrompt(Context ctx){
        return prefs(ctx).getString(K_SYSPROMPT, "You are a helpful assistant.");
    }

    public static void save(Context ctx, int maxTok, float temp, float topP, int topK, String sys) {
        prefs(ctx).edit()
            .putInt(K_MAXTOK, maxTok)
            .putFloat(K_TEMP, temp)
            .putFloat(K_TOPP, topP)
            .putInt(K_TOPK, topK)
            .putString(K_SYSPROMPT, sys)
            .apply();
    }

    public static List<ModelInfo> installed(Context ctx) {
        List<ModelInfo> out = new ArrayList<>();
        for (ModelInfo m : MODELS) if (m.isReady(ctx)) out.add(m);
        return out;
    }
}
