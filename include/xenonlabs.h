/*
 * XenonLabs — public API
 *
 * A C wrapper over llama.cpp.
 *
 * Threading contract:
 *   - xenon_init / xenon_shutdown are thread-safe and reference-counted.
 *   - A single xenon_context_t must NOT be used concurrently from more
 *     than one thread for generation. One context = one generator thread.
 *   - xenon_cancel may be called from any thread while generation is
 *     running on another. It is the only method safe to call across
 *     threads on an in-use context.
 *   - xenon_context_was_cancelled may be called from any thread.
 *   - Model and context lifetimes: a model must outlive every context
 *     created from it. xenon_model_free will refuse to free a model that
 *     still has live contexts (see source). This is a safety net, not a
 *     license to ignore the contract.
 */

#ifndef XENONLABS_H
#define XENONLABS_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

/* ------------------------------------------------------------------ */
/* Version                                                             */
/* ------------------------------------------------------------------ */

#define XENONLABS_VERSION_MAJOR 1
#define XENONLABS_VERSION_MINOR 0
#define XENONLABS_VERSION_PATCH 0

/* ------------------------------------------------------------------ */
/* Symbol visibility                                                   */
/* ------------------------------------------------------------------ */

#if defined(_WIN32) && defined(XENONLABS_SHARED)
#  if defined(XENONLABS_BUILD)
#    define XENONLABS_API __declspec(dllexport)
#  else
#    define XENONLABS_API __declspec(dllimport)
#  endif
#elif defined(__GNUC__) && __GNUC__ >= 4
#  define XENONLABS_API __attribute__((visibility("default")))
#else
#  define XENONLABS_API
#endif

/* ------------------------------------------------------------------ */
/* Status codes                                                        */
/* ------------------------------------------------------------------ */

typedef enum {
    XENON_OK              =   0,
    XENON_ERR_ARG         =  -1,   /* bad argument                     */
    XENON_ERR_IO          =  -2,   /* file / stream error              */
    XENON_ERR_MODEL_LOAD  =  -3,   /* model could not be loaded        */
    XENON_ERR_RUNTIME     =  -4,   /* llama.cpp returned an error      */
    XENON_ERR_OOM         =  -5,   /* allocation failed                */
    XENON_ERR_CANCELLED   =  -6,   /* user called xenon_cancel         */
    XENON_ERR_UNKNOWN     = -99
} xenon_status_t;

/* ------------------------------------------------------------------ */
/* Opaque handles                                                      */
/* ------------------------------------------------------------------ */

typedef struct xenon_model   xenon_model_t;
typedef struct xenon_context xenon_context_t;

/* ------------------------------------------------------------------ */
/* Configuration structs                                               */
/* ------------------------------------------------------------------ */

typedef struct {
    /* Required. Path to a .gguf model file. */
    const char *model_path;

    /* Worker threads for decode. 0 or negative → library default (4). */
    int n_threads;

    /* Context size (KV cache). 0 or negative → library default (2048). */
    int n_ctx;

    /* Layers to offload to GPU. 0 = CPU only. */
    int n_gpu_layers;

    /* RNG seed for sampling. < 0 → nondeterministic. */
    int seed;

    /* Non-zero enables llama.cpp log output (unless the environment
     * variable XENONLABS_VERBOSE=0 forces silence). */
    int verbose;
} xenon_config_t;

typedef struct {
    /* Hard cap on tokens generated per call. Must be > 0. */
    int max_tokens;

    /* Sampling temperature. <= 0 disables the temperature sampler. */
    float temperature;

    /* Nucleus sampling. <= 0 or >= 1 disables. */
    float top_p;

    /* Top-k sampling. <= 0 disables. */
    int top_k;

    /* Repetition penalty. <= 1.0 disables. */
    float repeat_penalty;

    /* Optional stop string. NULL or empty string disables.
     * Checked per-piece; cannot span piece boundaries. */
    const char *stop;

    /* RNG seed for the sampler chain. < 0 → LLAMA_DEFAULT_SEED. */
    int seed;
} xenon_gen_params_t;

/* ------------------------------------------------------------------ */
/* Streaming callback                                                  */
/* ------------------------------------------------------------------ */

/*
 * Called once per decoded token.
 *
 *   token     : NUL-terminated UTF-8 piece. Valid only for the duration
 *               of the call.
 *   user_data : pointer passed to xenon_generate_stream.
 *
 * Return 0 to continue generating, non-zero to abort. Aborting via the
 * callback sets the context into a cancelled state just like
 * xenon_cancel, and xenon_generate_stream returns XENON_ERR_CANCELLED.
 */
typedef int (*xenon_token_cb)(const char *token, void *user_data);

/* ------------------------------------------------------------------ */
/* Library info                                                        */
/* ------------------------------------------------------------------ */

/* Returns a static string like "1.0.0". Thread-safe. */
XENONLABS_API const char *xenon_version(void);

/* Fill a config with sensible defaults. */
XENONLABS_API xenon_config_t     xenon_default_config(void);

/* Fill generation params with sensible defaults. */
XENONLABS_API xenon_gen_params_t xenon_default_gen_params(void);

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/*
 * Initialize the llama.cpp backend. Reference-counted: safe to call
 * multiple times; only the first call does real work. Balanced by
 * xenon_shutdown.
 */
XENONLABS_API xenon_status_t xenon_init(void);

/*
 * Release one reference to the backend. When the last reference is
 * released, llama.cpp's backend is freed. Safe to call more times than
 * xenon_init; the counter floors at 0.
 */
XENONLABS_API void xenon_shutdown(void);

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

/*
 * Load a model. On success *out_model is set and must be freed with
 * xenon_model_free. On failure *out_model is set to NULL.
 */
XENONLABS_API xenon_status_t xenon_model_load(const xenon_config_t *cfg,
                                              xenon_model_t **out_model);

/*
 * Free a model. If any contexts are still alive, the call is refused
 * (a diagnostic is printed to stderr) and the model is left intact.
 * Free all contexts first.
 */
XENONLABS_API void xenon_model_free(xenon_model_t *model);

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

/*
 * Create a context from a model. The model must outlive the context.
 * On success *out_ctx is set and must be freed with xenon_context_free.
 * On failure *out_ctx is set to NULL.
 */
XENONLABS_API xenon_status_t xenon_context_create(xenon_model_t *model,
                                                  xenon_context_t **out_ctx);

XENONLABS_API void xenon_context_free(xenon_context_t *ctx);

/* ------------------------------------------------------------------ */
/* Inference                                                           */
/* ------------------------------------------------------------------ */

/*
 * Generate a full reply into a heap-allocated NUL-terminated string.
 * On success *out_text is set; free with xenon_free_string.
 * On failure *out_text is set to NULL.
 *
 * On cancellation, whatever was generated so far is returned and
 * XENON_OK is returned; check xenon_context_was_cancelled to know.
 */
XENONLABS_API xenon_status_t xenon_generate(xenon_context_t *ctx,
                                            const char *prompt,
                                            const xenon_gen_params_t *params,
                                            char **out_text);

/*
 * Generate a reply, delivering each token to cb.
 *
 * Returns XENON_OK on natural stop (EOS or max_tokens),
 * XENON_ERR_CANCELLED if the user called xenon_cancel or the callback
 * returned non-zero, or another error code on failure.
 */
XENONLABS_API xenon_status_t xenon_generate_stream(xenon_context_t *ctx,
                                                   const char *prompt,
                                                   const xenon_gen_params_t *params,
                                                   xenon_token_cb cb,
                                                   void *user_data);

/*
 * Request cancellation of an in-flight generation. Safe to call from
 * any thread. Idempotent. Takes effect at the next token boundary.
 *
 * The flag is cleared automatically at the start of the next
 * generation that begins a new conversation (i.e. when the context is
 * not being continued). It is NOT cleared by xenon_continue.
 */
XENONLABS_API void xenon_cancel(xenon_context_t *ctx);

/*
 * Returns non-zero if the last generation was cancelled (by
 * xenon_cancel or by the streaming callback returning non-zero).
 * Safe to call from any thread.
 */
XENONLABS_API int xenon_context_was_cancelled(xenon_context_t *ctx);

/* ------------------------------------------------------------------ */
/* Multi-turn conversation                                             */
/* ------------------------------------------------------------------ */

/*
 * Mark the next generate call as a continuation of the previous turn.
 * The KV cache is preserved and only new tokens are decoded. This is
 * what makes multi-turn fast.
 *
 * Call this BEFORE xenon_generate / xenon_generate_stream. The flag is
 * consumed by the next call and cleared automatically. Calling it when
 * no prior turn exists is harmless — the next call starts fresh.
 */
XENONLABS_API void xenon_continue(xenon_context_t *ctx);

/*
 * Clear the KV cache and forget the conversation. Safe to call at any
 * time the context is not actively generating. Cancels any pending
 * cancel flag.
 */
XENONLABS_API void xenon_reset_context(xenon_context_t *ctx);

/* ------------------------------------------------------------------ */
/* Utility                                                             */
/* ------------------------------------------------------------------ */

/* Free a string returned by xenon_generate. Passing NULL is a no-op. */
XENONLABS_API void xenon_free_string(char *s);

/* Human-readable description of a status code. Thread-safe. */
XENONLABS_API const char *xenon_status_str(xenon_status_t s);

#ifdef __cplusplus
}
#endif
#endif /* XENONLABS_H */
