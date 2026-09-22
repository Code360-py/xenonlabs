package com.xenonlabs.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public final class AppState {

    public static final class ModelInfo {
        public final String name;
        public final String category;
        public final String filename;
        public final String url;
        public final long   approxBytes;

        public ModelInfo(String name, String category, String filename,
                         String url, long approxBytes) {
            this.name = name;
            this.category = category;
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

        /* tiny / fast */
        new ModelInfo(
            "SmolLM2 360M Instruct",
            "Fast chat · ~0.7 GB RAM",
            "SmolLM2-360M-Instruct-Q4_K_M.gguf",
            "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf",
            258L * 1024 * 1024),

        new ModelInfo(
            "Qwen2.5 0.5B Instruct",
            "Fast chat · ~0.9 GB RAM",
            "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
            400L * 1024 * 1024),

        new ModelInfo(
            "TinyLlama 1.1B Chat",
            "Legacy chat · ~1.1 GB RAM",
            "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
            "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
            670L * 1024 * 1024),

        /* modern */
        new ModelInfo(
            "Llama 3.2 1B Instruct",
            "Modern chat · ~1.2 GB RAM",
            "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
            "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
            767L * 1024 * 1024),

        new ModelInfo(
            "Gemma 2 2B Instruct",
            "Balanced Google · ~2.0 GB RAM",
            "gemma-2-2b-it-Q4_K_M.gguf",
            "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf",
            1500L * 1024 * 1024),

        new ModelInfo(
            "Qwen2.5 1.5B Instruct",
            "Balanced Qwen · ~1.7 GB RAM",
            "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            1100L * 1024 * 1024),

        new ModelInfo(
            "Qwen2.5 3B Instruct",
            "Better reasoning · ~2.8 GB RAM",
            "qwen2.5-3b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
            2100L * 1024 * 1024),

        new ModelInfo(
            "Qwen3 1.7B",
            "Newest Qwen · ~1.7 GB RAM",
            "Qwen3-1.7B-Q4_K_M.gguf",
            "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
            1100L * 1024 * 1024),

        /* code */
        new ModelInfo(
            "Qwen2.5-Coder 0.5B Instruct",
            "Tiny coder · ~0.9 GB RAM",
            "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
            400L * 1024 * 1024),

        new ModelInfo(
            "Qwen2.5-Coder 1.5B Instruct",
            "Coder · ~1.6 GB RAM",
            "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
            1000L * 1024 * 1024),

        /* reasoning */
        new ModelInfo(
            "DeepSeek-R1-Distill-Qwen 1.5B",
            "Reasoning · ~1.7 GB RAM",
            "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
            "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
            1100L * 1024 * 1024),

        /* demo */
        new ModelInfo(
            "TinyStories 15M (demo)",
            "Story demo · ~0.1 GB RAM",
            "stories15M-q4_0.gguf",
            "https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories15M-q4_0.gguf",
            20L * 1024 * 1024),
    };

    private static final String P           = "xenonlabs";
    private static final String K_MODEL     = "active_model";
    private static final String K_MAXTOK    = "max_tokens";
    private static final String K_TEMP      = "temperature";
    private static final String K_TOPP      = "top_p";
    private static final String K_TOPK      = "top_k";
    private static final String K_SYSPROMPT = "system_prompt";

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
