/*
 * XenonLabs smoke tests
 *
 * Runs a set of always-on checks (not gated by NDEBUG), so the test is
 * meaningful in Release builds too.
 *
 * Basic checks always run. Full lifecycle tests only run if the
 * environment variable XENONLABS_TEST_MODEL points to a .gguf file.
 *
 * Exit code 0 = pass, non-zero = fail.
 */

#include "xenonlabs.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Test harness — runs regardless of NDEBUG                            */
/* ------------------------------------------------------------------ */

static int g_checks     = 0;
static int g_failures   = 0;
static int g_skipped    = 0;
static const char *g_test = "(none)";

#define CHECK(cond) do {                                          \
    g_checks++;                                                   \
    if (!(cond)) {                                                \
        g_failures++;                                             \
        fprintf(stderr, "FAIL [%s] %s:%d: %s\n",                  \
                g_test, __FILE__, __LINE__, #cond);               \
    }                                                             \
} while (0)

#define CHECK_EQ_INT(a, b) do {                                   \
    g_checks++;                                                   \
    long _a = (long)(a), _b = (long)(b);                          \
    if (_a != _b) {                                               \
        g_failures++;                                             \
        fprintf(stderr, "FAIL [%s] %s:%d: %s == %s "              \
                        "(got %ld, want %ld)\n",                  \
                g_test, __FILE__, __LINE__, #a, #b, _a, _b);      \
    }                                                             \
} while (0)

#define CHECK_EQ_STR(a, b) do {                                   \
    g_checks++;                                                   \
    const char *_a = (a), *_b = (b);                              \
    if (!_a || !_b || strcmp(_a, _b) != 0) {                      \
        g_failures++;                                             \
        fprintf(stderr, "FAIL [%s] %s:%d: %s == %s "              \
                        "(got \"%s\", want \"%s\")\n",            \
                g_test, __FILE__, __LINE__, #a, #b,               \
                _a ? _a : "(null)", _b ? _b : "(null)");          \
    }                                                             \
} while (0)

#define SKIP(msg) do {                                            \
    g_skipped++;                                                  \
    printf("SKIP [%s]: %s\n", g_test, msg);                       \
} while (0)

#define RUN(fn) do { g_test = #fn; fn(); } while (0)

/* ================================================================== */
/* Version + defaults                                                  */
/* ================================================================== */

static void test_version(void) {
    const char *v = xenon_version();
    CHECK(v != NULL);
    CHECK_EQ_STR(v, "1.0.0");

    /* Must be a stable pointer (string literal), not a static buffer. */
    CHECK(v == xenon_version());
}

static void test_default_config(void) {
    xenon_config_t c = xenon_default_config();
    CHECK(c.model_path   == NULL);
    CHECK(c.n_threads     > 0);
    CHECK(c.n_ctx         > 0);
    CHECK(c.n_gpu_layers == 0);
    CHECK(c.seed         == -1);
    CHECK(c.verbose      == 0);

    /* Two calls must produce identical values. */
    xenon_config_t c2 = xenon_default_config();
    CHECK_EQ_INT(c2.n_threads, c.n_threads);
    CHECK_EQ_INT(c2.n_ctx,     c.n_ctx);
}

static void test_default_gen_params(void) {
    xenon_gen_params_t p = xenon_default_gen_params();
    CHECK(p.max_tokens     > 0);
    CHECK(p.temperature    > 0.0f);
    CHECK(p.top_p          > 0.0f && p.top_p <= 1.0f);
    CHECK(p.top_k          > 0);
    CHECK(p.repeat_penalty >= 1.0f);
    CHECK(p.stop           == NULL);
    CHECK(p.seed           < 0);   /* nondeterministic default */
}

/* ================================================================== */
/* Status strings                                                      */
/* ================================================================== */

static void test_status_str(void) {
    CHECK_EQ_STR(xenon_status_str(XENON_OK),             "ok");
    CHECK_EQ_STR(xenon_status_str(XENON_ERR_ARG),        "invalid argument");
    CHECK_EQ_STR(xenon_status_str(XENON_ERR_IO),         "io error");
    CHECK_EQ_STR(xenon_status_str(XENON_ERR_MODEL_LOAD), "model load failed");
    CHECK_EQ_STR(xenon_status_str(XENON_ERR_RUNTIME),    "runtime error");
    CHECK_EQ_STR(xenon_status_str(XENON_ERR_OOM),        "out of memory");
    CHECK_EQ_STR(xenon_status_str(XENON_ERR_CANCELLED),  "cancelled");
    CHECK_EQ_STR(xenon_status_str(XENON_ERR_UNKNOWN),    "unknown error");

    /* Anything not listed must fall through to "unknown error". */
    CHECK_EQ_STR(xenon_status_str((xenon_status_t)-12345), "unknown error");
}

/* ================================================================== */
/* Argument validation                                                 */
/* ================================================================== */

static void test_arg_validation(void) {
    /* xenon_model_load */
    xenon_model_t *m = (xenon_model_t *)0xdeadbeef;
    CHECK_EQ_INT(xenon_model_load(NULL, &m), XENON_ERR_ARG);
    CHECK(m == NULL);   /* must be cleared on failure */

    xenon_config_t c = xenon_default_config();
    CHECK_EQ_INT(xenon_model_load(&c, NULL), XENON_ERR_ARG);

    /* model_path required */
    m = (xenon_model_t *)0xdeadbeef;
    CHECK_EQ_INT(xenon_model_load(&c, &m), XENON_ERR_ARG);
    CHECK(m == NULL);

    /* xenon_context_create */
    xenon_context_t *ctx = (xenon_context_t *)0xdeadbeef;
    CHECK_EQ_INT(xenon_context_create(NULL, &ctx), XENON_ERR_ARG);
    CHECK(ctx == NULL);

    /* xenon_generate */
    char *out = (char *)0xdeadbeef;
    CHECK_EQ_INT(xenon_generate(NULL, "hi", NULL, &out), XENON_ERR_ARG);
    CHECK(out == NULL);

    /* xenon_generate_stream */
    CHECK_EQ_INT(xenon_generate_stream(NULL, "hi", NULL, NULL, NULL),
                 XENON_ERR_ARG);

    /* Freeing NULL is a no-op. */
    xenon_model_free(NULL);
    xenon_context_free(NULL);
    xenon_free_string(NULL);

    /* Cancelling NULL is a no-op. */
    xenon_cancel(NULL);
    CHECK_EQ_INT(xenon_context_was_cancelled(NULL), 0);

    /* Continue/reset on NULL is a no-op. */
    xenon_continue(NULL);
    xenon_reset_context(NULL);
}

/* ================================================================== */
/* Lifecycle idempotency                                               */
/* ================================================================== */

static void test_init_shutdown(void) {
    /* Multiple init / shutdown calls must be safe. */
    CHECK_EQ_INT(xenon_init(), XENON_OK);
    CHECK_EQ_INT(xenon_init(), XENON_OK);
    CHECK_EQ_INT(xenon_init(), XENON_OK);

    xenon_shutdown();
    xenon_shutdown();
    xenon_shutdown();

    /* Extra shutdowns floor at 0 — must not crash or corrupt state. */
    xenon_shutdown();
    xenon_shutdown();

    /* A subsequent init must still work. */
    CHECK_EQ_INT(xenon_init(), XENON_OK);
    xenon_shutdown();
}

/* ================================================================== */
/* Full lifecycle (needs a real model)                                 */
/* ================================================================== */

static void test_full_lifecycle(void) {
    const char *model = getenv("XENONLABS_TEST_MODEL");
    if (!model || !*model) {
        SKIP("set XENONLABS_TEST_MODEL to run");
        return;
    }

    CHECK_EQ_INT(xenon_init(), XENON_OK);

    xenon_config_t cfg = xenon_default_config();
    cfg.model_path = model;
    cfg.n_ctx      = 256;      /* small, keep the test fast */
    cfg.n_threads  = 2;

    xenon_model_t *m = NULL;
    xenon_status_t st = xenon_model_load(&cfg, &m);
    if (st != XENON_OK) {
        fprintf(stderr, "  (model load failed: %s)\n", xenon_status_str(st));
        xenon_shutdown();
        SKIP("cannot load model");
        return;
    }
    CHECK(m != NULL);

    xenon_context_t *ctx = NULL;
    st = xenon_context_create(m, &ctx);
    CHECK_EQ_INT(st, XENON_OK);
    CHECK(ctx != NULL);

    if (ctx) {
        /* Non-streaming generate */
        xenon_gen_params_t gp = xenon_default_gen_params();
        gp.max_tokens  = 4;
        gp.temperature = 0.0f;   /* deterministic-ish */

        char *out = NULL;
        st = xenon_generate(ctx, "Hi", &gp, &out);
        CHECK_EQ_INT(st, XENON_OK);
        CHECK(out != NULL);
        if (out) {
            CHECK(out[0] != '\0');   /* produced something */
            xenon_free_string(out);
        }

        /* Multi-turn: continue, then generate again */
        xenon_continue(ctx);
        char *out2 = NULL;
        st = xenon_generate(ctx, " there", &gp, &out2);
        CHECK_EQ_INT(st, XENON_OK);
        if (out2) xenon_free_string(out2);

        /* Reset and generate fresh */
        xenon_reset_context(ctx);
        char *out3 = NULL;
        st = xenon_generate(ctx, "Hi", &gp, &out3);
        CHECK_EQ_INT(st, XENON_OK);
        if (out3) xenon_free_string(out3);

        xenon_context_free(ctx);
    }

    xenon_model_free(m);
    xenon_shutdown();
}

/* ================================================================== */
/* Entry point                                                         */
/* ================================================================== */

int main(void) {
    printf("XenonLabs smoke tests\n");

    RUN(test_version);
    RUN(test_default_config);
    RUN(test_default_gen_params);
    RUN(test_status_str);
    RUN(test_arg_validation);
    RUN(test_init_shutdown);
    RUN(test_full_lifecycle);

    printf("\n%d checks, %d failures, %d skipped\n",
           g_checks, g_failures, g_skipped);

    if (g_failures > 0) {
        printf("smoke: FAILED\n");
        return 1;
    }
    printf("smoke: ok\n");
    return 0;
}
