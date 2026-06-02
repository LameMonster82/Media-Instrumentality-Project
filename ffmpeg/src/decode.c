/*
 * decode.c — Video and audio frame decoding (FFmpeg software decoder path).
 * Handles the avcodec_send_packet / avcodec_receive_frame loop,
 * format conversion, and emitting decoded frames to JS.
 */
#include "context.h"
#include "events.h"
#include "codec_config.h"
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/pixfmt.h>
#include <stdio.h>

/* Declared in convert.c */
AVFrame *convert_sws_frame(FFmpegContext *ctx, int stream_index, AVFrame *frame);
AVFrame *convert_swr_frame(FFmpegContext *ctx, int stream_index, AVFrame *frame);

/* Declared in subtitle.c */
int subtitle_decode_packet(FFmpegContext *ctx, AVPacket *pkt,
                           int64_t ts_js, int64_t dur_js);

static void emit_video_frame(FFmpegContext *ctx, int stream_index,
                             AVFrame *frame) {
    AVStream *stream = ctx->fmt_ctx->streams[stream_index];

    int loss = 0;
    enum AVPixelFormat best_fmt = avcodec_find_best_pix_fmt_of_list(
        ctx->supported_pix_fmts, frame->format, 1, &loss);

    AVFrame *out = frame;
    if (best_fmt != frame->format && best_fmt != AV_PIX_FMT_NONE) {
        out = convert_sws_frame(ctx, stream_index, frame);
    }

    out->time_base = stream->time_base;

    int64_t pts_js  = av_rescale_q(out->pts, out->time_base,
                                    (AVRational){1, 1000000});
    int64_t dur_js  = av_rescale_q(out->duration, out->time_base,
                                    (AVRational){1, 1000000});

    VideoFrameEvent ev = {
        .width      = out->width,
        .height     = out->height,
        .crop_top    = out->crop_top,
        .crop_bottom = out->crop_bottom,
        .crop_left   = out->crop_left,
        .crop_right  = out->crop_right,
        .format      = out->format,
        .key_frame   = -1,
        .pict_type   = out->pict_type,
        .pts         = out->pts,
        .ts_js       = (double)pts_js,
        .time_base_num  = out->time_base.num,
        .time_base_den  = out->time_base.den,
        .duration    = out->duration,
        .dur_js      = (double)dur_js,
        .color_range     = out->color_range,
        .color_space     = out->colorspace,
        .color_primaries = out->color_primaries,
        .color_transfer   = out->color_trc,
        .stream_index = stream_index,
    };

    for (int i = 0; i < 8; i++) {
        ev.src_data[i]    = (uint32_t)(uintptr_t)out->data[i];
        ev.src_linesize[i] = out->linesize[i];
    }

    bridge_emit_video_frame(&ev);
}

static void emit_audio_frame(FFmpegContext *ctx, int stream_index,
                             AVFrame *frame, double ts_js) {
    enum AVSampleFormat out_format = AV_SAMPLE_FMT_FLT;

    AVFrame *out = frame;
    if (out_format != frame->format) {
        out = convert_swr_frame(ctx, stream_index, frame);
    }

    int channels = FFMIN(out->ch_layout.nb_channels, 8);

    AudioFrameEvent ev = {
        .channels        = channels,
        .samples         = out->nb_samples,
        .sample_rate     = out->sample_rate,
        .data            = (uint32_t)(uintptr_t)out->data[0],
        .bytes_per_sample = av_get_bytes_per_sample(out_format),
        .ts_js           = ts_js,
        .stream_index    = stream_index,
    };

    bridge_emit_audio_frame(&ev);
}

static int try_decode_software(FFmpegContext *ctx, int stream_index,
                               AVPacket *pkt, int64_t ts_js, int64_t dur_js) {

    int ret = avcodec_send_packet(ctx->codec_ctx[stream_index], pkt);
    if (ret < 0) {
        fprintf(stderr, "Error sending packet to decoder: %s\n",
                av_err2str(ret));
        return -1;
    }

    ret = avcodec_receive_frame(ctx->codec_ctx[stream_index], ctx->frame);
    if (ret == AVERROR(EAGAIN)) {
        return 1; /* need more data */
    }

    if (ret == AVERROR_EOF)
        return 2;

    if (ret < 0) {
        fprintf(stderr, "Error receiving frame: %s\n", av_err2str(ret));
        return -1;
    }

    if (ctx->codec_ctx[stream_index]->codec_type == AVMEDIA_TYPE_VIDEO) {
        emit_video_frame(ctx, stream_index, ctx->frame);
        return 0;
    }

    if (ctx->codec_ctx[stream_index]->codec_type == AVMEDIA_TYPE_AUDIO) {
        emit_audio_frame(ctx, stream_index, ctx->frame, ts_js);
        return 0;
    }

    fprintf(stderr, "Unknown codec type: %d\n",
            ctx->codec_ctx[stream_index]->codec_type);
    return -1;
}

int decode_packet(FFmpegContext *ctx, int stream_index, AVPacket *pkt,
                  int64_t ts_js, int64_t dur_js, int is_supported) {

    if (is_supported) {
        int ret = bridge_submit_raw_packet(&(RawPacketEvent){
            .stream_index = stream_index,
            .flags        = pkt->flags,
            .ts_js        = (double)ts_js,
            .dur_js       = (double)dur_js,
            .data         = (uint32_t)(uintptr_t)pkt->data,
            .data_size    = pkt->size,
        });
        return (ret < 0) ? RESULT_ERR_GENERIC : RESULT_RAW_PACKET;
    }

    if (ctx->codec_ctx[stream_index]->codec_type == AVMEDIA_TYPE_SUBTITLE) {
        return subtitle_decode_packet(ctx, pkt, ts_js, dur_js);
    }

    return try_decode_software(ctx, stream_index, pkt, ts_js, dur_js);
}
