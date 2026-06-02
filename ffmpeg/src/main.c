/*
 * main.c — Emscripten-exported entry points.
 * These functions are called from TypeScript and map to the context API.
 */
#include "context.h"
#include "events.h"
#include <emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static FFmpegContext g_ctx;

EMSCRIPTEN_KEEPALIVE
void init_ffmpeg(int buffer_size, int debug_level) {
    av_log_set_level(debug_level);

    if (ctx_alloc_io(&g_ctx, buffer_size) < 0) {
        fprintf(stderr, "Error allocating FFmpeg IO\n");
        return;
    }

    fprintf(stderr, "FFmpeg initialized with buffer size %d\n", buffer_size);
}

EMSCRIPTEN_KEEPALIVE
void get_supported_demuxers(void) {
    void *opaque = NULL;
    const AVInputFormat *fmt = NULL;
    int max_count = 256;
    int counter = 0;

    char **extensions  = malloc(sizeof(char *) * max_count);
    char **long_names   = malloc(sizeof(char *) * max_count);
    char **mime_types   = malloc(sizeof(char *) * max_count);
    char **names        = malloc(sizeof(char *) * max_count);

    while ((fmt = av_demuxer_iterate(&opaque)) && counter < max_count) {
        extensions[counter]  = fmt->extensions  ? strdup(fmt->extensions)  : strdup("");
        long_names[counter]   = fmt->long_name   ? strdup(fmt->long_name)   : strdup("");
        mime_types[counter]   = fmt->mime_type   ? strdup(fmt->mime_type)   : strdup("");
        names[counter]        = fmt->name        ? strdup(fmt->name)        : strdup("");
        counter++;
    }

    DemuxersEvent ev = {
        .extensions  = (uint32_t)(uintptr_t)extensions,
        .long_names   = (uint32_t)(uintptr_t)long_names,
        .mime_types   = (uint32_t)(uintptr_t)mime_types,
        .names        = (uint32_t)(uintptr_t)names,
        .count        = counter,
    };
    bridge_emit_demuxers(&ev);

    for (int i = 0; i < counter; i++) {
        free(extensions[i]);
        free(long_names[i]);
        free(mime_types[i]);
        free(names[i]);
    }
    free(extensions);
    free(long_names);
    free(mime_types);
    free(names);
}

EMSCRIPTEN_KEEPALIVE
int get_exif(void) {
    if (ctx_alloc_io(&g_ctx, 32768) < 0)
        return -1;

    if (ctx_open_file(&g_ctx) < 0) {
        ctx_destroy(&g_ctx);
        return -1;
    }

    ctx_destroy(&g_ctx);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int open_file(int thread_count, const enum AVPixelFormat *fmts) {
    ctx_init_fields(&g_ctx, thread_count, fmts);

    if (ctx_open_file(&g_ctx) < 0) {
        ctx_destroy(&g_ctx);
        return -1;
    }

    return 0;
}

EMSCRIPTEN_KEEPALIVE
int get_data(void) {
    return ctx_get_data(&g_ctx);
}

EMSCRIPTEN_KEEPALIVE
int seek_to(double time) {
    return ctx_seek_to(&g_ctx, time);
}

EMSCRIPTEN_KEEPALIVE
void cleanup(void) {
    ctx_destroy(&g_ctx);
    memset(&g_ctx, 0, sizeof(g_ctx));
}
