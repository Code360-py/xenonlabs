/*
 * XenonLabs CLI
 * Usage:
 *   xenonlabs-cli <model.gguf> "<prompt>" [--stream] [--chat]
 *                 [--max N] [--temp F] [--verbose]
 */
#include "xenonlabs.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>

/* ---------- stderr suppression ---------- */
static int saved_stderr_fd = -1;

static void quiet_begin(void) {
    if (saved_stderr_fd >= 0) return;
    fflush(stderr);
    saved_stderr_fd = dup(fileno(stderr));
    int devnull = open("/dev/null", O_WRONLY);
    if (devnull >= 0) { dup2(devnull, fileno(stderr)); close(devnull); }
}

static void quiet_end(void) {
    if (saved_stderr_fd < 0) return;
    fflush(stderr);
    dup2(saved_stderr_fd, fileno(stderr));
    close(saved_stderr_fd);
    saved_stderr_fd = -1;
}

/* ---------- streaming callback ---------- */
static int on_token(const char *tok, void *ud) {
    int *first = (int *)ud;
    if (*first) { quiet_end(); *first = 0; }
    fputs(tok, stdout);
    fflush(stdout);
    return 0;
}

/* ---------- chat template ---------- */
static char *wrap_chat(const char *user) {
    const char *a = "<|im_start|>user\n";
    const char *b = "<|im_end|>\n<|im_start|>assistant\n";
    size_t n = strlen(a) + strlen(user) + strlen(b) + 1;
    char *out = (char *)malloc(n);
    if (!out) return NULL;
    snprintf(out, n, "%s%s%s", a, user, b);
    return out;
}

static void usage(const char *p) {
    fprintf(stderr,
        "Usage: %s <model.gguf> \"<prompt>\" [options]\n"
        "Options:\n"
        "  --stream       stream tokens\n"
        "  --chat         wrap prompt in chat template\n"
        "  --max N        max tokens (default 256)\n"
        "  --temp F       temperature (default 0.8)\n"
        "  --verbose      show llama.cpp logs\n",
        p);
}

int main(int argc, char **argv) {
    if (argc < 3) { usage(argv[0]); return 1; }

    const char *model_path = argv[1];
    const char *prompt_in  = argv[2];

    int   stream = 0, chat = 0, verbose = 0;
    int   max_tokens = 256;
    float temp = 0.8f;

    for (int i = 3; i < argc; ++i) {
        if      (!strcmp(argv[i], "--stream"))  stream = 1;
        else if (!strcmp(argv[i], "--chat"))    chat   = 1;
        else if (!strcmp(argv[i], "--verbose")) verbose = 1;
        else if (!strcmp(argv[i], "--max")  && i + 1 < argc) max_tokens = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--temp") && i + 1 < argc) temp = (float)atof(argv[++i]);
        else { fprintf(stderr, "unknown option: %s\n", argv[i]); usage(argv[0]); return 1; }
    }

    if (verbose) setenv("XENONLABS_VERBOSE", "1", 1);

    char *prompt = chat ? wrap_chat(prompt_in) : strdup(prompt_in);
    if (!prompt) return 2;

    if (!verbose) quiet_begin();

    xenon_init();

    xenon_config_t cfg = xenon_default_config();
    cfg.model_path = model_path;

    xenon_model_t *model = NULL;
    xenon_status_t st = xenon_model_load(&cfg, &model);
    if (st != XENON_OK) {
        if (!verbose) quiet_end();
        fprintf(stderr, "load error: %s\n", xenon_status_str(st));
        free(prompt);
        return 3;
    }

    xenon_context_t *ctx = NULL;
    st = xenon_context_create(model, &ctx);
    if (st != XENON_OK) {
        if (!verbose) quiet_end();
        fprintf(stderr, "context error: %s\n", xenon_status_str(st));
        xenon_model_free(model);
        free(prompt);
        return 3;
    }

    xenon_gen_params_t gp = xenon_default_gen_params();
    gp.max_tokens  = max_tokens;
    gp.temperature = temp;

    if (stream) {
        int first = 1;
        st = xenon_generate_stream(ctx, prompt, &gp, on_token, &first);
        if (!verbose) quiet_end();
        putchar('\n');
    } else {
        char *out = NULL;
        st = xenon_generate(ctx, prompt, &gp, &out);
        if (!verbose) quiet_end();
        if (st == XENON_OK) { puts(out); xenon_free_string(out); }
    }

    if (st != XENON_OK)
        fprintf(stderr, "generate error: %s\n", xenon_status_str(st));

    xenon_context_free(ctx);
    xenon_model_free(model);
    xenon_shutdown();
    free(prompt);
    return st == XENON_OK ? 0 : 4;
}
