#ifndef XENONLABS_H
#define XENONLABS_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <stdint.h>

#define XENONLABS_VERSION_MAJOR 1
#define XENONLABS_VERSION_MINOR 0
#define XENONLABS_VERSION_PATCH 0

#if defined(__GNUC__) && __GNUC__ >= 4
  #define XENONLABS_API __attribute__((visibility("default")))
#else
  #define XENONLABS_API
#endif

typedef enum {
    XENON_OK              =  0,
    XENON_ERR_ARG         = -1,
    XENON_ERR_IO          = -2,
    XENON_ERR_MODEL_LOAD  = -3,
    XENON_ERR_RUNTIME     = -4,
    XENON_ERR_OOM         = -5,
    XENON_ERR_UNKNOWN     = -99
} xenon_status_t;

typedef struct xenon_model   xenon_model_t;
typedef struct xenon_context xenon_context_t;

typedef struct {
    const char *model_path;
    int         n_threads;
    int         n_ctx;
    int         n_gpu_layers;
    int         seed;
    int         verbose;
} xenon_config_t;

typedef struct {
    int         max_tokens;
    float       temperature;
    float       top_p;
    int         top_k;
    float       repeat_penalty;
    const char *stop;
} xenon_gen_params_t;

typedef int (*xenon_token_cb)(const char *token, void *user_data);

/* Library info */
XENONLABS_API const char *xenon_version(void);

/* Defaults */
XENONLABS_API xenon_config_t     xenon_default_config(void);
XENONLABS_API xenon_gen_params_t xenon_default_gen_params(void);

/* Lifecycle */
XENONLABS_API xenon_status_t xenon_init(void);
XENONLABS_API void           xenon_shutdown(void);

/* Model */
XENONLABS_API xenon_status_t xenon_model_load(const xenon_config_t *cfg,
                                              xenon_model_t **out_model);
XENONLABS_API void           xenon_model_free(xenon_model_t *model);

/* Context */
XENONLABS_API xenon_status_t xenon_context_create(xenon_model_t *model,
                                                  xenon_context_t **out_ctx);
XENONLABS_API void           xenon_context_free(xenon_context_t *ctx);

/* Inference */
XENONLABS_API xenon_status_t xenon_generate(xenon_context_t *ctx,
                                            const char *prompt,
                                            const xenon_gen_params_t *params,
                                            char **out_text);

XENONLABS_API xenon_status_t xenon_generate_stream(xenon_context_t *ctx,
                                                   const char *prompt,
                                                   const xenon_gen_params_t *params,
                                                   xenon_token_cb cb,
                                                   void *user_data);

/* Cooperative cancellation — call from another thread to abort
 * an in-flight xenon_generate or xenon_generate_stream. */
XENONLABS_API void xenon_cancel(xenon_context_t *ctx);

/* Multi-turn support.
 * xenon_continue() tells the context that the next prompt is a
 * continuation of the previous one — the KV cache is preserved and
 * only new tokens are decoded.
 * xenon_reset_context() clears the KV cache for a fresh conversation. */
XENONLABS_API void xenon_continue(xenon_context_t *ctx);
XENONLABS_API void xenon_reset_context(xenon_context_t *ctx);

/* Utility */
XENONLABS_API void         xenon_free_string(char *s);
XENONLABS_API const char  *xenon_status_str(xenon_status_t s);

#ifdef __cplusplus
}
#endif
#endif /* XENONLABS_H */
