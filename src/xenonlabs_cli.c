/*
 * XenonLabs CLI
 *
 * Usage:
 *   xenonlabs-cli <model.gguf> "<prompt>" [options]
 *
 * Options:
 *   --stream            Stream tokens as generated
 *   --chat              Wrap prompt in ChatML
 *   --sys TEXT          System prompt (implies --chat)
 *   --max N             Max tokens to generate (default 256)
 *   --temp F            Temperature (default 0.8)
 *   --top-p F           Top-p (default 0.95)
 *   --top-k N           Top-k (default 40)
 *   --repeat F          Repetition penalty (default 1.1)
 *   --threads N         Worker threads (default 4)
 *   --ctx N             Context size (default 2048)
 *   --gpu-layers N      Offload N layers (default 0)
 *   --seed N            RNG seed (default -1 = random)
 *   --multi-turn        Keep the conversation going (implies --chat)
 *   --verbose           Show llama.cpp logs
 *   --version           Print version and exit
 *   -h, --help          Print this help and exit
 *
 * Exit codes:
 *   0  success
 *   1  bad arguments
 *   2  model load failed
 *   3  generation failed
 *   4  cancelled (Ctrl-C)
 */

#include "xenonlabs.h"

#include <errno.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* ------------------------------------------------------------------ */
/* Cancellation via Ctrl-C                                             */
/* ------------------------------------------------------------------ */

static volatile sig_atomic_t g_interrupted = 0;
static xenon_context_t      *g_active_ctx  = NULL;

static void on_sigint(int sig) {
    (void)sig;
    g_interrupted = 1;
    if (g_active_ctx) xenon_cancel(g_active_ctx);
}

static void install_signal_handlers(void) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_sigint;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;   /* no SA_RESTART: let blocking reads be interrupted */
    sigaction(SIGINT,  &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
}

/* ------------------------------------------------------------------ */
/* Streaming callback                                                  */
/* ------------------------------------------------------------------ */

static int on_token(const char *tok, void *ud) {
    (void)ud;
    fputs(tok, stdout);
    fflush(stdout);
    return 0;
}

/* ------------------------------------------------------------------ */
/* ChatML wrapper                                                      */
/* ------------------------------------------------------------------ */

/*
 * Wrap a user turn in the ChatML template used by Qwen / SmolLM2.
 * Note: this does not escape special tokens in user input. For a local
 * CLI that's acceptable; for untrusted input you'd want to strip
 * "<|im_start|>" / "<|im_end|>" from `user` and `system` first.
 */
static char *wrap_chatml(const char *user, const char *system) {
    if (!system) system = "You are a helpful assistant.";

    static const char PRE_SYS[] = "<|im_start|>system\n";
    static const char MID[]     = "<|im_end|>\n<|im_start|>user\n";
    static const char SUF[]     = "<|im_end|>\n<|im_start|>assistant\n";

    size_t n = sizeof(PRE_SYS) - 1 + strlen(system)
             + sizeof(MID)     - 1 + strlen(user)
             + sizeof(SUF)     - 1 + 1;

    char *out = (char *)malloc(n);
    if (!out) return NULL;

    int r = snprintf(out, n, "%s%s%s%s%s", PRE_SYS, system, MID, user, SUF);
    if (r < 0 || (size_t)r >= n) { free(out); return NULL; }
    return out;
}

/* ------------------------------------------------------------------ */
/* Argument helpers                                                    */
/* ------------------------------------------------------------------ */

static void usage(FILE *to, const char *prog) {
    fprintf(to,
        "Usage: %s <model.gguf> \"<prompt>\" [options]\n"
        "\n"
        "Options:\n"
        "  --stream          Stream tokens as generated\n"
        "  --chat            Wrap prompt in ChatML\n"
        "  --sys TEXT        System prompt (implies --chat)\n"
        "  --max N           Max tokens to generate (default 256)\n"
        "  --temp F          Temperature (default 0.8)\n"
        "  --top-p F         Top-p (default 0.95)\n"
        "  --top-k N         Top-k (default 40)\n"
        "  --repeat F        Repetition penalty (default 1.1)\n"
        "  --threads N       Worker threads (default 4)\n"
        "  --ctx N           Context size (default 2048)\n"
        "  --gpu-layers N    Offload N layers to GPU (default 0)\n"
        "  --seed N          RNG seed (default -1 = random)\n"
        "  --multi-turn      Keep conversation context (implies --chat)\n"
        "  --verbose         Show llama.cpp logs\n"
        "  --version         Print version and exit\n"
        "  -h, --help        Show this help\n",
        prog);
}

static int parse_int(const char *s, int *out) {
    if (!s || !*s) return -1;
    errno = 0;
    char *end = NULL;
    long v = strtol(s, &end, 10);
    if (errno != 0 || end == s || *end != '\0') return -1;
    if (v < INT32_MIN || v > INT32_MAX) return -1;
    *out = (int)v;
    return 0;
}

static int parse_float(const char *s, float *out) {
    if (!s || !*s) return -1;
    errno = 0;
    char *end = NULL;
    float v = strtof(s, &end);
    if (errno != 0 || end == s || *end != '\0') return -1;
    *out = v;
    return 0;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

int main(int argc, char **argv) {
    if (argc >= 2 && (!strcmp(argv[1], "-h") || !strcmp(argv[1], "--help"))) {
        usage(stdout, argv[0]);
        return 0;
    }
    if (argc >= 2 && !strcmp(argv[1], "--version")) {
        printf("xenonlabs-cli %s\n", xenon_version());
        return 0;
    }
    if (argc < 3) {
        usage(stderr, argv[0]);
        return 1;
    }

    const char *model_path = argv[1];
    const char *prompt_in  = argv[2];

    /* -- flags ---------------------------------------------------- */
    int   stream     = 0;
    int   chat       = 0;
    int   multi_turn = 0;
    int   verbose    = 0;
    const char *system = NULL;

    xenon_config_t     cfg = xenon_default_config();
    xenon_gen_params_t gp  = xenon_default_gen_params();

    for (int i = 3; i < argc; ++i) {
        const char *a = argv[i];
        const char *v = (i + 1 < argc) ? argv[i + 1] : NULL;

        if      (!strcmp(a, "--stream"))     stream = 1;
        else if (!strcmp(a, "--chat"))       chat = 1;
        else if (!strcmp(a, "--multi-turn")) { multi_turn = 1; chat = 1; }
        else if (!strcmp(a, "--verbose"))    verbose = 1;
        else if (!strcmp(a, "--sys")) {
            if (!v) { fprintf(stderr, "--sys requires an argument\n"); return 1; }
            system = v;
            chat = 1;
            ++i;
        }
        else if (!strcmp(a, "--max")) {
            if (parse_int(v, &gp.max_tokens) || gp.max_tokens <= 0) {
                fprintf(stderr, "--max: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--temp")) {
            if (parse_float(v, &gp.temperature)) {
                fprintf(stderr, "--temp: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--top-p")) {
            if (parse_float(v, &gp.top_p)) {
                fprintf(stderr, "--top-p: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--top-k")) {
            if (parse_int(v, &gp.top_k)) {
                fprintf(stderr, "--top-k: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--repeat")) {
            if (parse_float(v, &gp.repeat_penalty)) {
                fprintf(stderr, "--repeat: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--seed")) {
            if (parse_int(v, &gp.seed)) {
                fprintf(stderr, "--seed: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--threads")) {
            if (parse_int(v, &cfg.n_threads)) {
                fprintf(stderr, "--threads: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--ctx")) {
            if (parse_int(v, &cfg.n_ctx) || cfg.n_ctx <= 0) {
                fprintf(stderr, "--ctx: invalid value\n"); return 1;
            }
            ++i;
        }
        else if (!strcmp(a, "--gpu-layers")) {
            if (parse_int(v, &cfg.n_gpu_layers)) {
                fprintf(stderr, "--gpu-layers: invalid value\n"); return 1;
            }
            ++i;
        }
        else {
            fprintf(stderr, "unknown option: %s\n", a);
            usage(stderr, argv[0]);
            return 1;
        }
    }

    cfg.model_path = model_path;
    cfg.verbose    = verbose;

    /* -- prompt --------------------------------------------------- */
    char *prompt = chat ? wrap_chatml(prompt_in, system)
                        : strdup(prompt_in);
    if (!prompt) {
        fprintf(stderr, "out of memory\n");
        return 1;
    }

    /* -- signal + backend ---------------------------------------- */
    install_signal_handlers();

    xenon_status_t st = xenon_init();
    if (st != XENON_OK) {
        fprintf(stderr, "xenon_init failed: %s\n", xenon_status_str(st));
        free(prompt);
        return 3;
    }

    /* -- model ---------------------------------------------------- */
    xenon_model_t *model = NULL;
    st = xenon_model_load(&cfg, &model);
    if (st != XENON_OK) {
        fprintf(stderr, "model load failed (%s): %s\n",
                xenon_status_str(st), model_path);
        xenon_shutdown();
        free(prompt);
        return 2;
    }

    /* -- context -------------------------------------------------- */
    xenon_context_t *ctx = NULL;
    st = xenon_context_create(model, &ctx);
    if (st != XENON_OK) {
        fprintf(stderr, "context create failed: %s\n", xenon_status_str(st));
        xenon_model_free(model);
        xenon_shutdown();
        free(prompt);
        return 3;
    }
    g_active_ctx = ctx;

    /* -- generate -------------------------------------------------- */
    int rc = 0;

    if (stream) {
        st = xenon_generate_stream(ctx, prompt, &gp, on_token, NULL);
        putchar('\n');
    } else {
        char *out = NULL;
        st = xenon_generate(ctx, prompt, &gp, &out);
        if (st == XENON_OK && out) {
            fputs(out, stdout);
            if (out[0] && out[strlen(out) - 1] != '\n') putchar('\n');
            xenon_free_string(out);
        }
    }

    /* -- outcome -------------------------------------------------- */
    if (st == XENON_OK) {
        rc = 0;
    } else if (st == XENON_ERR_CANCELLED || g_interrupted) {
        if (stream) putchar('\n');
        fprintf(stderr, "\ninterrupted\n");
        rc = 4;
    } else {
        fprintf(stderr, "generation failed: %s\n", xenon_status_str(st));
        rc = 3;
    }

    /* -- multi-turn mode: read-eval loop -------------------------- */
    if (multi_turn && rc == 0) {
        char line[4096];
        for (;;) {
            fputs("\n> ", stderr);
            if (!fgets(line, sizeof line, stdin)) break;

            size_t L = strlen(line);
            while (L && (line[L-1] == '\n' || line[L-1] == '\r')) line[--L] = '\0';
            if (!L) continue;
            if (!strcmp(line, "/exit") || !strcmp(line, "/quit")) break;
            if (!strcmp(line, "/reset")) {
                xenon_reset_context(ctx);
                fputs("(context reset)\n", stderr);
                continue;
            }

            char *next = wrap_chatml(line, system);
            if (!next) { fprintf(stderr, "oom\n"); rc = 3; break; }

            xenon_continue(ctx);   /* preserve KV from previous turn */

            if (stream) {
                st = xenon_generate_stream(ctx, next, &gp, on_token, NULL);
                putchar('\n');
            } else {
                char *out2 = NULL;
                st = xenon_generate(ctx, next, &gp, &out2);
                if (st == XENON_OK && out2) {
                    fputs(out2, stdout);
                    if (out2[0] && out2[strlen(out2) - 1] != '\n') putchar('\n');
                    xenon_free_string(out2);
                }
            }
            free(next);

            if (st == XENON_ERR_CANCELLED || g_interrupted) {
                fprintf(stderr, "\ninterrupted\n");
                rc = 4;
                break;
            }
            if (st != XENON_OK) {
                fprintf(stderr, "generation failed: %s\n", xenon_status_str(st));
                rc = 3;
                break;
            }
        }
    }

    /* -- cleanup -------------------------------------------------- */
    g_active_ctx = NULL;
    xenon_context_free(ctx);
    xenon_model_free(model);
    xenon_shutdown();
    free(prompt);
    return rc;
}
