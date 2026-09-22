#define XENONLABS_BUILD
#include "xenonlabs.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <llama.h>
#include <ggml.h>

struct xenon_model {
    struct llama_model *model;
    char               *path;
    int                 n_ctx;
};

struct xenon_context {
    xenon_model_t            *parent;
    struct llama_context     *ctx;
    const struct llama_vocab *vocab;
    int                       n_threads;
};

static char *xstrdup(const char *s) {
    if (!s) return NULL;
    size_t n = strlen(s) + 1;
    char *p = (char *)malloc(n);
    if (p) memcpy(p, s, n);
    return p;
}

static int env_truthy(const char *name) {
    const char *v = getenv(name);
    if (!v || !*v) return 0;
    return !(v[0] == '0' && v[1] == '\0');
}

static void silent_log_cb(enum ggml_log_level level,
                          const char *text, void *user) {
    (void)level; (void)text; (void)user;
}

typedef struct { char *buf; size_t len; size_t cap; } xbuf_t;

static int xbuf_append(xbuf_t *b, const char *s) {
    size_t n = strlen(s);
    if (b->len + n + 1 > b->cap) {
        size_t nc = b->cap ? b->cap * 2 : 256;
        while (nc < b->len + n + 1) nc *= 2;
        char *np = (char *)realloc(b->buf, nc);
        if (!np) return -1;
        b->buf = np;
        b->cap = nc;
    }
    memcpy(b->buf + b->len, s, n);
    b->len += n;
    b->buf[b->len] = '\0';
    return 0;
}

const char *xenon_version(void) {
    static char buf[32];
    snprintf(buf, sizeof buf, "%d.%d.%d",
             XENONLABS_VERSION_MAJOR,
             XENONLABS_VERSION_MINOR,
             XENONLABS_VERSION_PATCH);
    return buf;
}

xenon_config_t xenon_default_config(void) {
    xenon_config_t c = {0};
    c.n_threads = 4;
    c.n_ctx     = 2048;
    c.seed      = -1;
    c.verbose   = 0;
    return c;
}

xenon_gen_params_t xenon_default_gen_params(void) {
    xenon_gen_params_t p = {0};
    p.max_tokens     = 256;
    p.temperature    = 0.8f;
    p.top_p          = 0.95f;
    p.top_k          = 40;
    p.repeat_penalty = 1.1f;
    return p;
}

xenon_status_t xenon_init(void) {
    if (!env_truthy("XENONLABS_VERBOSE")) {
        ggml_log_set(silent_log_cb, NULL);
        llama_log_set(silent_log_cb, NULL);
    }
    llama_backend_init();
    return XENON_OK;
}

void xenon_shutdown(void) {
    llama_backend_free();
}

xenon_status_t xenon_model_load(const xenon_config_t *cfg,
                                xenon_model_t **out_model) {
    if (!cfg || !cfg->model_path || !out_model) return XENON_ERR_ARG;

    struct llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = cfg->n_gpu_layers;

    struct llama_model *lm = llama_model_load_from_file(cfg->model_path, mp);
    if (!lm) return XENON_ERR_MODEL_LOAD;

    xenon_model_t *m = (xenon_model_t *)calloc(1, sizeof *m);
    if (!m) { llama_model_free(lm); return XENON_ERR_OOM; }

    m->model = lm;
    m->path  = xstrdup(cfg->model_path);
    m->n_ctx = cfg->n_ctx > 0 ? cfg->n_ctx : 2048;

    *out_model = m;
    return XENON_OK;
}

void xenon_model_free(xenon_model_t *m) {
    if (!m) return;
    if (m->model) llama_model_free(m->model);
    free(m->path);
    free(m);
}

xenon_status_t xenon_context_create(xenon_model_t *model,
                                    xenon_context_t **out_ctx) {
    if (!model || !out_ctx) return XENON_ERR_ARG;

    struct llama_context_params cp = llama_context_default_params();
    cp.n_ctx     = (uint32_t)model->n_ctx;
    cp.n_threads = 4;

    struct llama_context *lc = llama_init_from_model(model->model, cp);
    if (!lc) return XENON_ERR_RUNTIME;

    xenon_context_t *c = (xenon_context_t *)calloc(1, sizeof *c);
    if (!c) { llama_free(lc); return XENON_ERR_OOM; }

    c->parent    = model;
    c->ctx       = lc;
    c->vocab     = llama_model_get_vocab(model->model);
    c->n_threads = 4;

    *out_ctx = c;
    return XENON_OK;
}

void xenon_context_free(xenon_context_t *c) {
    if (!c) return;
    if (c->ctx) llama_free(c->ctx);
    free(c);
}

static struct llama_batch make_batch(const llama_token *toks, int n, int pos0) {
    struct llama_batch b = llama_batch_init(n, 0, 1);
    for (int i = 0; i < n; ++i) {
        b.token[b.n_tokens]     = toks[i];
        b.pos[b.n_tokens]       = pos0 + i;
        b.n_seq_id[b.n_tokens]  = 1;
        b.seq_id[b.n_tokens][0] = 0;
        b.logits[b.n_tokens]    = (i == n - 1) ? 1 : 0;
        b.n_tokens++;
    }
    return b;
}

static int reset_context(xenon_context_t *c) {
    struct llama_context_params cp = llama_context_default_params();
    cp.n_ctx     = (uint32_t)c->parent->n_ctx;
    cp.n_threads = c->n_threads;

    struct llama_context *fresh =
        llama_init_from_model(c->parent->model, cp);
    if (!fresh) return -1;

    if (c->ctx) llama_free(c->ctx);
    c->ctx = fresh;
    return 0;
}

static int xenon_run(xenon_context_t *c, const char *prompt,
                     const xenon_gen_params_t *p,
                     xenon_token_cb cb, void *ud) {
    xenon_gen_params_t def = xenon_default_gen_params();
    if (!p) p = &def;

    const struct llama_vocab *vocab = c->vocab;

    if (reset_context(c) != 0) return -5;

    int n_prompt = -llama_tokenize(vocab, prompt, (int)strlen(prompt),
                                   NULL, 0, true, true);
    if (n_prompt <= 0) return -1;

    llama_token *toks = (llama_token *)malloc(sizeof(llama_token) * n_prompt);
    if (!toks) return -2;

    if (llama_tokenize(vocab, prompt, (int)strlen(prompt),
                       toks, n_prompt, true, true) < 0) {
        free(toks); return -3;
    }

    struct llama_sampler *smpl = llama_sampler_chain_init(
        llama_sampler_chain_default_params());

    if (p->top_k > 0)
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(p->top_k));
    if (p->top_p > 0.0f && p->top_p < 1.0f)
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(p->top_p, 1));
    if (p->temperature > 0.0f)
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(p->temperature));
    if (p->repeat_penalty > 1.0f) {
        int n_vocab = llama_vocab_n_tokens(vocab);
        llama_sampler_chain_add(smpl, llama_sampler_init_penalties(
            n_vocab, 64, p->repeat_penalty, 0.0f, 0.0f));
    }
    llama_sampler_chain_add(smpl,
        llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    int n_past = 0;
    struct llama_batch pb = make_batch(toks, n_prompt, n_past);
    int rc = llama_decode(c->ctx, pb);
    llama_batch_free(pb);
    free(toks);
    if (rc != 0) { llama_sampler_free(smpl); return -4; }
    n_past += n_prompt;

    char piece[256];
    int  n_gen = 0;

    llama_token eos = llama_vocab_eos(vocab);
    llama_token bos = llama_vocab_bos(vocab);

    while (n_gen < p->max_tokens) {
        llama_token id = llama_sampler_sample(smpl, c->ctx, -1);

        if (llama_vocab_is_eog(vocab, id)) break;
        if (id == eos) break;
        if (id == bos && n_gen > 0) break;

        int n = llama_token_to_piece(vocab, id, piece,
                                     (int)sizeof(piece) - 1, 0, true);
        if (n < 0) break;
        piece[n] = '\0';

        if (cb) { if (cb(piece, ud) != 0) break; }
        else    { if (xbuf_append((xbuf_t *)ud, piece) != 0) break; }

        struct llama_batch nb = make_batch(&id, 1, n_past);
        int rc2 = llama_decode(c->ctx, nb);
        llama_batch_free(nb);
        if (rc2 != 0) break;

        ++n_past;
        ++n_gen;
    }

    llama_sampler_free(smpl);
    return 0;
}

xenon_status_t xenon_generate(xenon_context_t *ctx,
                              const char *prompt,
                              const xenon_gen_params_t *params,
                              char **out_text) {
    if (!ctx || !prompt || !out_text) return XENON_ERR_ARG;

    xbuf_t b = {0};
    int rc = xenon_run(ctx, prompt, params, NULL, &b);
    if (rc != 0) { free(b.buf); return XENON_ERR_RUNTIME; }

    if (!b.buf) {
        b.buf = (char *)malloc(1);
        if (!b.buf) return XENON_ERR_OOM;
        b.buf[0] = '\0';
    }
    *out_text = b.buf;
    return XENON_OK;
}

xenon_status_t xenon_generate_stream(xenon_context_t *ctx,
                                     const char *prompt,
                                     const xenon_gen_params_t *params,
                                     xenon_token_cb cb,
                                     void *user_data) {
    if (!ctx || !prompt || !cb) return XENON_ERR_ARG;
    int rc = xenon_run(ctx, prompt, params, cb, user_data);
    return rc == 0 ? XENON_OK : XENON_ERR_RUNTIME;
}

void xenon_free_string(char *s) { free(s); }

const char *xenon_status_str(xenon_status_t s) {
    switch (s) {
        case XENON_OK:             return "ok";
        case XENON_ERR_ARG:        return "invalid argument";
        case XENON_ERR_IO:         return "io error";
        case XENON_ERR_MODEL_LOAD: return "model load failed";
        case XENON_ERR_RUNTIME:    return "runtime error";
        case XENON_ERR_OOM:        return "out of memory";
        default:                   return "unknown error";
    }
}
