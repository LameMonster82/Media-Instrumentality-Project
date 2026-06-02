/*
 * subtitle.c — Subtitle decoding helpers.
 * Includes bitmap→RGBA conversion for DVD/DVB subtitle bitmaps.
 */
#include "context.h"
#include "events.h"
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MIN(a,b) ((a) < (b) ? (a) : (b))

static uint8_t *convert_bitmap_to_rgba(AVSubtitleRect *rect) {
    if (!rect || rect->type != SUBTITLE_BITMAP)
        return NULL;

    int width  = rect->w;
    int height = rect->h;
    int stride = rect->linesize[0];
    uint8_t  *src     = rect->data[0];
    uint32_t *palette = (uint32_t *)rect->data[1];

    if (!src || !palette || width <= 0 || height <= 0)
        return NULL;

    uint8_t *rgba = malloc(width * height * 4);
    if (!rgba)
        return NULL;

    for (int y = 0; y < height; y++) {
        uint8_t *src_row = src + y * stride;
        uint8_t *dst_row = rgba + y * width * 4;

        for (int x = 0; x < width; x++) {
            uint32_t argb = palette[src_row[x]];
            dst_row[x * 4 + 0] = (argb >> 16) & 0xFF;  /* R */
            dst_row[x * 4 + 1] = (argb >> 8)  & 0xFF;  /* G */
            dst_row[x * 4 + 2] =  argb        & 0xFF;  /* B */
            dst_row[x * 4 + 3] = (argb >> 24) & 0xFF;  /* A */
        }
    }

    return rgba;
}

int subtitle_decode_packet(FFmpegContext *ctx, AVPacket *pkt,
                           int64_t ts_js, int64_t dur_js) {
    AVCodecContext *codec = ctx->codec_ctx[pkt->stream_index];
    int stream_index = pkt->stream_index;
    int got_output;
    int try_again = 0;

    while (1) {
        got_output = 0;
        int ret = avcodec_decode_subtitle2(codec, &ctx->subtitle,
                                           &got_output, pkt);
        if (ret < 0) {
            fprintf(stderr, "Error decoding subtitle: %s\n", av_err2str(ret));
            return -1;
        }

        if (!got_output) {
            if (try_again) {
                return 1;
            }
            pkt->data = NULL;
            pkt->size = 0;
            try_again = 1;
            continue;
        }

        for (unsigned int i = 0; i < ctx->subtitle.num_rects; i++) {
            AVSubtitleRect *rect = ctx->subtitle.rects[i];
            if (!rect)
                continue;

            if (rect->type == SUBTITLE_BITMAP) {
                uint8_t *pixels = convert_bitmap_to_rgba(rect);
                if (pixels) {
                    SubtitleBitmapEvent ev = {
                        .stream_index = stream_index,
                        .data         = (uint32_t)(uintptr_t)pixels,
                        .data_size    = rect->w * rect->h * 4,
                        .x = rect->x, .y = rect->y,
                        .width  = rect->w, .height = rect->h,
                        .ts_js   = ts_js, .dur_js = dur_js,
                        .coded_width  = codec->coded_width,
                        .coded_height = codec->coded_height,
                    };
                    bridge_emit_subtitle_bitmap(&ev);
                    free(pixels);
                }
            } else if (rect->type == SUBTITLE_ASS) {
                SubtitleAssEvent ev = {
                    .stream_index = stream_index,
                    .dialog       = (uint32_t)(uintptr_t)rect->ass,
                    .start_time   = ts_js,
                    .end_time     = ts_js + dur_js,
                };
                bridge_emit_subtitle_ass(&ev);
            } else if (rect->type == SUBTITLE_TEXT) {
                fprintf(stderr, "Subtitle text: %s\n", rect->text);
            }
        }

        if (ctx->subtitle.num_rects == 0) {
            SubtitleEmptyEvent ev = {
                .stream_index = stream_index,
                .ts_js        = ts_js,
            };
            bridge_emit_subtitle_empty(&ev);
        }

        avsubtitle_free(&ctx->subtitle);
        break;
    }

    return 0;
}
