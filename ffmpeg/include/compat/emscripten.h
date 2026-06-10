/*
 * Minimal stub for clangd intellisense.
 * Not used in actual Emscripten builds
 */
#ifndef EMSCRIPTEN_STUB_H
#define EMSCRIPTEN_STUB_H

#include <stdint.h>

#define EMSCRIPTEN_KEEPALIVE __attribute__((used))

#define EM_JS(rettype, name, params, ...) \
    rettype name params

#endif
