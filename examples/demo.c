/*
 * XenonLabs demo
 *
 * Minimal example of the public API: load a model, create a context,
 * stream a reply. Run:
 *
 *   ./build/demo <model.gguf> ["<prompt>"]
 *
 * Or set XENONLABS_MODEL to a path and omit the argument.
 *
 * Exit codes:
 *   0  success
 *   1  bad usage
 *   2  model load failed
 *   3  generation failed
 */

#include "xenonlabs.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* Streaming callback                                                  */
/* ------------------------------------------------------------------ */

static int on_token(const char *tok, void *ud) {
    int *count = (int *)ud;
    fputs(tok, stdout);
    fflush(stdout);
    (*count)++;
    return 0;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

int main(int argc, char **argv) {
    printf("XenonLabs v%s\n", xenon_version());

    /* -- figure out which model to use ---------------------------- */
    const char *model_path = NULL;
    if (argc >= 2) {
        model_path = argv[1];
    } else {
        model_path = getenv("XENONLABS_MODEL");
    }
    if (!model_path || !*model_path) {
        fprintf(stderr,
            "usage: %s <model.gguf> [\"<prompt>\"]\n"
            "   or: XENONLABS_MODEL=/path/to/model.gguf %s\n",
            argv[0], argv[0]);
        return 1;
    }

    const char *prompt = (argc >= 3) ? argv[2] : "Hello, who are you?";

    /* -- init backend --------------------------------------------- */
    xenon_status_t st = xenon_init();
    if (st != XENON_OK) {
        fprintf(stderr, "xenon_init failed: %s\n", xenon_status_str(st));
        return 3;
    }

    /* -- load model ----------------------------------------------- */
    xenon_config_t cfg = xenon_default_config();
    cfg.model_path = model_path;
    cfg.n_ctx      = 1024;
    cfg.n_threads  = 4;

    xenon_model_t *model = NULL;
    st = xenon_model_load(&cfg, &model);
    if (st != XENON_OK) {
        fprintf(stderr, "failed to load %s: %s\n",
                model_path, xenon_status_str(st));
        xenon_shutdown();
        return 2;
    }

    /* -- create context ------------------------------------------- */
    xenon_context_t *ctx = NULL;
    st = xenon_context_create(model, &ctx);
    if (st != XENON_OK) {
        fprintf(stderr, "context create failed: %s\n", xenon_status_str(st));
        xenon_model_free(model);
        xenon_shutdown();
        return 3;
    }

    /* -- generate ------------------------------------------------- */
    xenon_gen_params_t gp = xenon_default_gen_params();
    gp.max_tokens  = 128;
    gp.temperature = 0.7f;

    printf("\n--- prompt ---\n%s\n--- reply ---\n", prompt);

    int  tokens = 0;
    st = xenon_generate_stream(ctx, prompt, &gp, on_token, &tokens);
    putchar('\n');

    if (st == XENON_ERR_CANCELLED) {
        printf("(cancelled after %d tokens)\n", tokens);
    } else if (st != XENON_OK) {
        fprintf(stderr, "generation failed: %s\n", xenon_status_str(st));
        st = XENON_ERR_RUNTIME;  /* normalize */
    } else {
        printf("(%d tokens)\n", tokens);
    }

    /* -- demo multi-turn: a second prompt reuses the KV cache ----- */
    if (st == XENON_OK) {
        const char *followup = "And what can you do?";
        printf("\n--- follow-up (multi-turn) ---\n%s\n--- reply ---\n",
               followup);

        xenon_continue(ctx);   /* preserve KV from the previous turn */

        tokens = 0;
        st = xenon_generate_stream(ctx, followup, &gp, on_token, &tokens);
        putchar('\n');
        if (st == XENON_OK) {
            printf("(%d tokens)\n", tokens);
        } else if (st == XENON_ERR_CANCELLED) {
            printf("(cancelled)\n");
        } else {
            fprintf(stderr, "follow-up failed: %s\n", xenon_status_str(st));
        }
    }

    /* -- cleanup -------------------------------------------------- */
    xenon_context_free(ctx);
    xenon_model_free(model);
    xenon_shutdown();

    return (st == XENON_OK) ? 0 : 3;
}
