#include "xenonlabs.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int on_token(const char *tok, void *ud) {
    (void)ud;
    fputs(tok, stdout);
    fflush(stdout);
    return 0;
}

/* Wrap a user prompt in the Qwen/SmolLM2 ChatML template.
 * Returns a malloc'd string; caller must free(). */
static char *wrap_chatml(const char *user, const char *system) {
    if (!system) system = "You are a helpful assistant.";

    const char *a = "<|im_start|>system\n";
    const char *b = "<|im_end|>\n<|im_start|>user\n";
    const char *c = "<|im_end|>\n<|im_start|>assistant\n";

    size_t n = strlen(a) + strlen(system) +
               strlen(b) + strlen(user) +
               strlen(c) + 1;

    char *out = (char *)malloc(n);
    if (!out) return NULL;
    snprintf(out, n, "%s%s%s%s%s", a, system, b, user, c);
    return out;
}

static void usage(const char *prog) {
    fprintf(stderr,
        "Usage: %s <model.gguf> \"<prompt>\" [options]\n"
        "Options:\n"
        "  --stream      stream tokens as generated\n"
        "  --chat        wrap prompt in Qwen/SmolLM2 ChatML template\n"
        "  --sys TEXT    system prompt (implies --chat)\n"
        "  --max N       max tokens to generate (default 256)\n"
        "  --temp F      temperature (default 0.8)\n"
        "  --verbose     show llama.cpp logs\n",
        prog);
}

int main(int argc, char **argv) {
    if (argc < 3) { usage(argv[0]); return 1; }

    const char *model_path = argv[1];
    const char *prompt_in  = argv[2];

    int   stream = 0, chat = 0;
    int   max_tokens = 256;
    float temp = 0.8f;
    const char *system = NULL;

    for (int i = 3; i < argc; ++i) {
        if      (!strcmp(argv[i], "--stream"))  stream = 1;
        else if (!strcmp(argv[i], "--chat"))    chat   = 1;
        else if (!strcmp(argv[i], "--verbose")) setenv("XENONLABS_VERBOSE", "1", 1);
        else if (!strcmp(argv[i], "--sys") && i + 1 < argc) {
            system = argv[++i];
            chat = 1;
        }
        else if (!strcmp(argv[i], "--max")  && i + 1 < argc) max_tokens = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--temp") && i + 1 < argc) temp = (float)atof(argv[++i]);
        else { fprintf(stderr, "unknown option: %s\n", argv[i]); usage(argv[0]); return 1; }
    }

    char *prompt = chat ? wrap_chatml(prompt_in, system) : strdup(prompt_in);
    if (!prompt) { fprintf(stderr, "oom\n"); return 1; }

    xenon_init();

    xenon_config_t cfg = xenon_default_config();
    cfg.model_path = model_path;

    xenon_model_t *model = NULL;
    if (xenon_model_load(&cfg, &model) != XENON_OK) {
        fprintf(stderr, "load failed: %s\n", model_path);
        free(prompt);
        return 2;
    }

    xenon_context_t *ctx = NULL;
    xenon_context_create(model, &ctx);

    xenon_gen_params_t gp = xenon_default_gen_params();
    gp.max_tokens  = max_tokens;
    gp.temperature = temp;

    if (stream) {
        xenon_generate_stream(ctx, prompt, &gp, on_token, NULL);
        putchar('\n');
    } else {
        char *out = NULL;
        if (xenon_generate(ctx, prompt, &gp, &out) == XENON_OK) {
            puts(out);
            xenon_free_string(out);
        }
    }

    xenon_context_free(ctx);
    xenon_model_free(model);
    xenon_shutdown();
    free(prompt);
    return 0;
}
