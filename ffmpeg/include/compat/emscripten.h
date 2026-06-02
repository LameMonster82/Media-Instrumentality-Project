/*
 * Minimal stub for clangd intellisense.
 * Not used in actual Emscripten builds (Dockerfile uses real emscripten.h).
 */
#ifndef EMSCRIPTEN_STUB_H
#define EMSCRIPTEN_STUB_H

#include <stdint.h>

#define EMSCRIPTEN_KEEPALIVE __attribute__((used))

/*
 * EM_JS(rettype, name, params, code...)
 * Strips the JS body for C intellisense, leaving a plain function declaration.
 */
#define EM_JS(rettype, name, params, ...) \
    rettype name params

#endif
