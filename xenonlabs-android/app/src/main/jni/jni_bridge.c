#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include "xenonlabs.h"

static xenon_model_t   *g_model = NULL;
static xenon_context_t *g_ctx   = NULL;

JNIEXPORT jint JNICALL
Java_com_xenonlabs_app_MainActivity_nativeInit(JNIEnv *env, jobject thiz,
                                               jstring jmodelPath) {
    (void)thiz;
    const char *path = (*env)->GetStringUTFChars(env, jmodelPath, NULL);
    if (!path) return -1;

    xenon_init();

    xenon_config_t cfg = xenon_default_config();
    cfg.model_path = path;
    cfg.n_ctx      = 2048;
    cfg.n_threads  = 4;

    xenon_status_t st = xenon_model_load(&cfg, &g_model);
    (*env)->ReleaseStringUTFChars(env, jmodelPath, path);
    if (st != XENON_OK) return (jint)st;

    st = xenon_context_create(g_model, &g_ctx);
    return (jint)st;
}

JNIEXPORT jstring JNICALL
Java_com_xenonlabs_app_MainActivity_nativeGenerate(JNIEnv *env, jobject thiz,
                                                   jstring jprompt,
                                                   jint maxTokens) {
    (void)thiz;
    if (!g_ctx) return (*env)->NewStringUTF(env, "error: not initialised");

    const char *prompt = (*env)->GetStringUTFChars(env, jprompt, NULL);
    if (!prompt) return NULL;

    const char *pre  = "<|im_start|>user\n";
    const char *post = "<|im_end|>\n<|im_start|>assistant\n";

    size_t n = strlen(pre) + strlen(prompt) + strlen(post) + 1;
    char *full = (char *)malloc(n);
    if (!full) {
        (*env)->ReleaseStringUTFChars(env, jprompt, prompt);
        return (*env)->NewStringUTF(env, "error: oom");
    }
    snprintf(full, n, "%s%s%s", pre, prompt, post);

    (*env)->ReleaseStringUTFChars(env, jprompt, prompt);

    xenon_gen_params_t gp = xenon_default_gen_params();
    gp.max_tokens  = (int)maxTokens;
    gp.temperature = 0.7f;

    char *out = NULL;
    xenon_status_t st = xenon_generate(g_ctx, full, &gp, &out);
    free(full);

    if (st != XENON_OK) return (*env)->NewStringUTF(env, "error: generation failed");

    jstring result = (*env)->NewStringUTF(env, out);
    xenon_free_string(out);
    return result;
}

JNIEXPORT void JNICALL
Java_com_xenonlabs_app_MainActivity_nativeShutdown(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx)   { xenon_context_free(g_ctx); g_ctx = NULL; }
    if (g_model) { xenon_model_free(g_model); g_model = NULL; }
    xenon_shutdown();
}
