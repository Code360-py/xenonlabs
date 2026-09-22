#include "xenonlabs.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>

int main(void) {
    assert(strcmp(xenon_version(), "1.0.0") == 0);
    xenon_init();
    assert(xenon_status_str(XENON_OK) != NULL);
    assert(strcmp(xenon_status_str(XENON_OK), "ok") == 0);
    xenon_shutdown();
    printf("smoke: ok\n");
    return 0;
}
