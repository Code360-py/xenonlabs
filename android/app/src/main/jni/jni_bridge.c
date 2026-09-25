#include <jni.h>
#include <stdlib.h>
#include <string.h>
#include "xenonlabs.h"

#include <android/log.h>
#define LOG_TAG "XenonJNI"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static xenon_model_t   *g_model = NULL;
static xenon_context_t *g_ctx   = NULL;

JNIEXPORT jint JNICALL
Java_com_xenonlabs_app_MainActivity_nativeInit(JNIEnv *env, jobject thiz,
                                               jstring jmodelPath,
                                               jint kvType) {
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
    cfg.kv_type    = (int)kvType;

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

    if (!env || !jprompt || !callback) return (jint)XENON_ERR_ARG;

    /* --- context check --- */
    if (!g_ctx) {
        LOGE("nativeGenerateStream: no context");
        return (jint)XENON_ERR_RUNTIME;
    }

    /* --- resolve onToken method --- */
    jclass cls = (*env)->GetObjectClass(env, callback);
    if (!cls) {
        if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
        LOGE("nativeGenerateStream: GetObjectClass failed");
        return (jint)XENON_ERR_RUNTIME;
    }

    jmethodID mid = (*env)->GetMethodID(env, cls, "onToken", "(Ljava/lang/String;)V");
    if (!mid) {
        /* Clear the pending NoSuchMethodError so subsequent JNI calls work. */
        if ((*env)->ExceptionCheck(env)) {
            LOGE("nativeGenerateStream: onToken method not found");
            (*env)->ExceptionDescribe(env);
            (*env)->ExceptionClear(env);
        }
        (*env)->DeleteLocalRef(env, cls);
        return (jint)XENON_ERR_ARG;
    }

    /* --- get prompt bytes --- */
    const char *prompt = (*env)->GetStringUTFChars(env, jprompt, NULL);
    if (!prompt) {
        if ((*env)->ExceptionCheck(env)) (*env)->ExceptionClear(env);
        (*env)->DeleteLocalRef(env, cls);
        return (jint)XENON_ERR_ARG;
    }

    /* --- params --- */
    xenon_gen_params_t gp = xenon_default_gen_params();
    gp.max_tokens  = (int)maxTokens;
    gp.temperature = (float)temperature;
    gp.top_p       = (float)topP;
    gp.top_k       = (int)topK;

    /* --- run generation --- */
    stream_ctx_t sc = { env, callback, mid };
    xenon_status_t st = xenon_generate_stream(g_ctx, prompt, &gp,
                                              stream_trampoline, &sc);

    /* --- cleanup --- */
    (*env)->ReleaseStringUTFChars(env, jprompt, prompt);
    (*env)->DeleteLocalRef(env, cls);

    /* If a callback exception is still pending, clear it before returning. */
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionDescribe(env);
        (*env)->ExceptionClear(env);
    }

    return (jint)st;
}

JNIEXPORT void JNICALL
Java_com_xenonlabs_app_MainActivity_nativeCancelGeneration(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx) xenon_cancel(g_ctx);
}

JNIEXPORT void JNICALL
Java_com_xenonlabs_app_MainActivity_nativeContinueContext(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx) xenon_continue(g_ctx);
}

JNIEXPORT void JNICALL
Java_com_xenonlabs_app_MainActivity_nativeResetContext(JNIEnv *env, jobject thiz) {
    (void)env; (void)thiz;
    if (g_ctx) xenon_reset_context(g_ctx);
}
