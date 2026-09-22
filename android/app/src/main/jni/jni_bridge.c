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

    if (g_ctx)   { xenon_context_free(g_ctx); g_ctx = NULL; }
    if (g_model) { xenon_model_free(g_model); g_model = NULL; }

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

JNIEXPORT void JNICALL
Java_com_xenonlabs_app_MainActivity_nativeShutdown(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx)   { xenon_context_free(g_ctx); g_ctx = NULL; }
    if (g_model) { xenon_model_free(g_model); g_model = NULL; }
    xenon_shutdown();
}

typedef struct { JNIEnv *env; jobject cb; jmethodID mid; } stream_ctx_t;

static int stream_trampoline(const char *piece, void *user) {
    stream_ctx_t *s = (stream_ctx_t *)user;
    jstring js = (*s->env)->NewStringUTF(s->env, piece);
    (*s->env)->CallVoidMethod(s->env, s->cb, s->mid, js);
    (*s->env)->DeleteLocalRef(s->env, js);
    return 0;
}

JNIEXPORT jint JNICALL
Java_com_xenonlabs_app_MainActivity_nativeGenerateStream(JNIEnv *env, jobject thiz,
                                                         jstring jprompt,
                                                         jint maxTokens,
                                                         jfloat temperature,
                                                         jfloat topP,
                                                         jint topK,
                                                         jobject callback) {
    (void)thiz;
    if (!g_ctx) return -1;

    jclass cls = (*env)->GetObjectClass(env, callback);
    jmethodID mid = (*env)->GetMethodID(env, cls, "onToken", "(Ljava/lang/String;)V");
    if (!mid) return -2;

    const char *prompt = (*env)->GetStringUTFChars(env, jprompt, NULL);
    if (!prompt) return -3;

    xenon_gen_params_t gp = xenon_default_gen_params();
    gp.max_tokens  = (int)maxTokens;
    gp.temperature = (float)temperature;
    gp.top_p       = (float)topP;
    gp.top_k       = (int)topK;

    stream_ctx_t sc = { env, callback, mid };
    xenon_status_t st = xenon_generate_stream(g_ctx, prompt, &gp, stream_trampoline, &sc);

    (*env)->ReleaseStringUTFChars(env, jprompt, prompt);
    return st == XENON_OK ? 0 : -4;
}

JNIEXPORT void JNICALL
Java_com_xenonlabs_app_MainActivity_nativeCancelGeneration(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx) xenon_cancel(g_ctx);
}
