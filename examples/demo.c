#include "xenonlabs.h"
#include <stdio.h>

int main(void) {
    printf("XenonLabs v%s\n", xenon_version());

    xenon_init();

    xenon_config_t cfg = xenon_default_config();
    cfg.model_path = "models/demo.gguf";

    xenon_model_t *m = NULL;
    if (xenon_model_load(&cfg, &m) != XENON_OK) {
        fprintf(stderr, "Failed to load models/demo.gguf\n");
        return 1;
    }

    xenon_context_t *c = NULL;
    xenon_context_create(m, &c);

    char *out = NULL;
    if (xenon_generate(c, "Hello Xenon", NULL, &out) == XENON_OK) {
        printf("=> %s\n", out);
        xenon_free_string(out);
    }

    xenon_context_free(c);
    xenon_model_free(m);
    xenon_shutdown();
    return 0;
}
