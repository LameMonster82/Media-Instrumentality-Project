/*
 * convert.c — Pixel format (swscale) and sample format (swresample)
 * conversion helpers used during software decoding.
 */
#include "context.h"
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
#include <libavutil/pixfmt.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
#include <stdio.h>

int convert_init_sws(FFmpegContext *ctx, int stream_index, AVFrame *frame) {
    if (ctx->sws_ctx[stream_index])
        return 0; /* already initialized */

    int loss = 0;
    enum AVPixelFormat best_fmt = avcodec_find_best_pix_fmt_of_list(
        ctx->supported_pix_fmts, frame->format, 1, &loss);

    if (best_fmt == AV_PIX_FMT_NONE) {
        fprintf(stderr, "No suitable pixel format found, falling back to RGBA\n");
        best_fmt = AV_PIX_FMT_RGBA;
    }

    struct SwsContext *c = sws_alloc_context();
    if (!c) {
        fprintf(stderr, "Error allocating sws context\n");
        return -1;
    }

    av_opt_set_int(c, "srcw",       frame->width,  0);
    av_opt_set_int(c, "srch",       frame->height, 0);
    av_opt_set_int(c, "src_format", frame->format, 0);
    av_opt_set_int(c, "dstw",       frame->width,  0);
    av_opt_set_int(c, "dsth",       frame->height, 0);
    av_opt_set_int(c, "dst_format", best_fmt,      0);
    av_opt_set_int(c, "sws_flags",  SWS_POINT,     0);
    av_opt_set_int(c, "threads",    1,              0);

    if (sws_init_context(c, NULL, NULL) < 0) {
        fprintf(stderr, "Error initializing sws context\n");
        sws_freeContext(c);
        return -1;
    }

    ctx->sws_ctx[stream_index] = c;

    ctx->sws_frame->format          = best_fmt;
    ctx->sws_frame->width           = frame->width;
    ctx->sws_frame->height          = frame->height;
    ctx->sws_frame->color_range     = frame->color_range;
    ctx->sws_frame->colorspace      = frame->colorspace;
    ctx->sws_frame->color_primaries = frame->color_primaries;
    ctx->sws_frame->color_trc       = frame->color_trc;

    if (av_frame_get_buffer(ctx->sws_frame, 0) < 0) {
        fprintf(stderr, "Could not allocate sws frame buffer\n");
        return -1;
    }

    return 0;
}

AVFrame *convert_sws_frame(FFmpegContext *ctx, int stream_index,
                           AVFrame *frame) {
    if (convert_init_sws(ctx, stream_index, frame) < 0)
        return frame;

    sws_scale_frame(ctx->sws_ctx[stream_index], ctx->sws_frame, frame);

    ctx->sws_frame->pts      = frame->pts;
    ctx->sws_frame->pkt_dts  = frame->pkt_dts;
    ctx->sws_frame->pict_type = frame->pict_type;
    ctx->sws_frame->duration = frame->duration;
    ctx->sws_frame->time_base = frame->time_base;

    return ctx->sws_frame;
}

int convert_init_swr(FFmpegContext *ctx, int stream_index, AVFrame *frame) {
    if (ctx->swr_ctx[stream_index])
        return 0;

    enum AVSampleFormat out_format = AV_SAMPLE_FMT_FLT;
    int ret = swr_alloc_set_opts2(
        &ctx->swr_ctx[stream_index],
        &frame->ch_layout, out_format, frame->sample_rate,
        &frame->ch_layout, frame->format, frame->sample_rate,
        0, NULL);

    if (ret < 0 || swr_init(ctx->swr_ctx[stream_index]) < 0) {
        fprintf(stderr, "Error creating swr context\n");
        swr_free(&ctx->swr_ctx[stream_index]);
        return -1;
    }

    if (av_channel_layout_copy(&ctx->swr_frame->ch_layout,
                                &frame->ch_layout) < 0)
        return -1;

    ctx->swr_frame->sample_rate = frame->sample_rate;
    ctx->swr_frame->format      = out_format;
    ctx->swr_frame->nb_samples  = frame->nb_samples;

    if (av_frame_get_buffer(ctx->swr_frame, 0) < 0) {
        fprintf(stderr, "Could not allocate swr frame buffer\n");
        return -1;
    }

    return 0;
}

AVFrame *convert_swr_frame(FFmpegContext *ctx, int stream_index,
                           AVFrame *frame) {
    if (convert_init_swr(ctx, stream_index, frame) < 0)
        return frame;

    swr_convert(ctx->swr_ctx[stream_index],
                ctx->swr_frame->data, ctx->swr_frame->nb_samples,
                (const uint8_t **)frame->data, frame->nb_samples);

    ctx->swr_frame->pts = frame->pts;
    return ctx->swr_frame;
}
