/*
 * thumbnail.c — Thumbnail extraction via FFmpeg.
 * Uses the same bridge (notify) for IO and thumbnail submission.
 */
#include "events.h"
#include <emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersink.h>
#include <libavfilter/buffersrc.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/imgutils.h>
#include <libavutil/opt.h>
#include <libavutil/pixdesc.h>
#include <libavutil/pixfmt.h>
#include <libswscale/swscale.h>
#include <stdio.h>
#include <stdlib.h>

static int custom_read_wrap(void *opaque, uint8_t *buf, int buf_size) {
    int result = (int)bridge_io_read(buf, buf_size);
    if (result == -1) return AVERROR(EIO);
    if (result == -2) return AVERROR_EOF;
    return result;
}

static int64_t custom_seek_wrap(void *opaque, int64_t offset, int whence) {
    int64_t result = bridge_io_seek(offset, whence);
    if (result < 0)
        fprintf(stderr, "Error seeking during thumbnail extraction\n");
    return result;
}

static uint8_t *copy_frame_data(const AVFrame *frame, int *out_size) {
    int size = av_image_get_buffer_size(frame->format, frame->width,
                                        frame->height, 1);
    uint8_t *buf = av_malloc(size);
    if (!buf) return NULL;

    *out_size = av_image_copy_to_buffer(buf, size,
                (const uint8_t *const *)frame->data,
                (const int *)frame->linesize, frame->format,
                frame->width, frame->height, 1);
    if (*out_size < 0) {
        av_free(buf);
        return NULL;
    }
    return buf;
}

EMSCRIPTEN_KEEPALIVE
int extract_thumbnail(void) {
    uint8_t *io_buf = av_malloc(32768);
    if (!io_buf) return AVERROR(ENOMEM);

    AVIOContext *avio = avio_alloc_context(
        io_buf, 32768, 0, NULL,
        custom_read_wrap, NULL, custom_seek_wrap);
    if (!avio) { av_free(io_buf); return AVERROR(ENOMEM); }

    AVFormatContext *fmt_ctx = avformat_alloc_context();
    if (!fmt_ctx) { avio_context_free(&avio); return AVERROR(ENOMEM); }

    fmt_ctx->pb = avio;
    fmt_ctx->flags |= AVFMT_FLAG_GENPTS | AVFMT_FLAG_CUSTOM_IO;
    avio->direct   = 0;
    avio->seekable = AVIO_SEEKABLE_NORMAL;

    av_log_set_level(AV_LOG_ERROR);

    int ret = avformat_open_input(&fmt_ctx, "", NULL, NULL);
    if (ret < 0) {
        fprintf(stderr, "avformat_open_input failed: %s\n", av_err2str(ret));
        goto end;
    }

    ret = avformat_find_stream_info(fmt_ctx, NULL);
    if (ret < 0) {
        fprintf(stderr, "avformat_find_stream_info failed: %s\n",
                av_err2str(ret));
        goto end;
    }

    /* Check for attached picture first */
    for (unsigned i = 0; i < fmt_ctx->nb_streams; i++) {
        AVStream *st = fmt_ctx->streams[i];
        if (st->disposition & AV_DISPOSITION_ATTACHED_PIC) {
            AVPacket *pkt = &st->attached_pic;
            ThumbnailEvent tev = {
                .is_raw    = 0,
                .data      = (uint32_t)(uintptr_t)pkt->data,
                .data_size = pkt->size,
                .width     = 0,
                .height    = 0,
                .format    = -1,
            };
            bridge_emit_thumbnail(&tev);
            ret = 0;
            goto end;
        }
    }

    /* Find video stream and decode to find a frame */
    int vsi = av_find_best_stream(fmt_ctx, AVMEDIA_TYPE_VIDEO, -1, -1,
                                  NULL, 0);
    if (vsi < 0) {
        fprintf(stderr, "No video stream found for thumbnail\n");
        ret = vsi;
        goto end;
    }

    AVCodecParameters *codecpar = fmt_ctx->streams[vsi]->codecpar;
    const AVCodec *decoder = avcodec_find_decoder(codecpar->codec_id);
    AVCodecContext *dec_ctx = avcodec_alloc_context3(decoder);
    avcodec_parameters_to_context(dec_ctx, codecpar);
    avcodec_open2(dec_ctx, decoder, NULL);

    /* Filter graph: buffer → thumbnail → buffersink */
    AVFilterGraph *filter_graph = avfilter_graph_alloc();
    filter_graph->nb_threads = 1;
    AVFilterContext *src_ctx  = NULL, *sink_ctx  = NULL;
    AVFilterContext *thumb_ctx = NULL;

    char args[512];
    snprintf(args, sizeof(args),
             "video_size=%dx%d:pix_fmt=%d:time_base=1/25:pixel_aspect=%d/%d",
             dec_ctx->width, dec_ctx->height, dec_ctx->pix_fmt,
             dec_ctx->sample_aspect_ratio.num,
             dec_ctx->sample_aspect_ratio.den);

    if (avfilter_graph_create_filter(&src_ctx,
            avfilter_get_by_name("buffer"), "in", args,
            NULL, filter_graph) < 0) goto cleanup_decode;

    if (avfilter_graph_create_filter(&sink_ctx,
            avfilter_get_by_name("buffersink"), "out",
            NULL, NULL, filter_graph) < 0) goto cleanup_decode;

    if (avfilter_graph_create_filter(&thumb_ctx,
            avfilter_get_by_name("thumbnail"), "thumb",
            NULL, NULL, filter_graph) < 0) goto cleanup_decode;

    avfilter_link(src_ctx, 0, thumb_ctx, 0);
    avfilter_link(thumb_ctx, 0, sink_ctx, 0);
    avfilter_graph_config(filter_graph, NULL);

    AVFrame *frame  = av_frame_alloc();
    AVFrame *filt   = av_frame_alloc();
    AVFrame *sws    = NULL;
    AVPacket pkt;
    int got_frame = 0;

    while (av_read_frame(fmt_ctx, &pkt) >= 0) {
        if (pkt.stream_index != vsi) {
            av_packet_unref(&pkt);
            continue;
        }
        ret = avcodec_send_packet(dec_ctx, &pkt);
        if (ret < 0) break;
        while (ret >= 0) {
            ret = avcodec_receive_frame(dec_ctx, frame);
            if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
                break;
            if (ret < 0) goto cleanup_decode;

            av_buffersrc_add_frame(src_ctx, frame);
            ret = av_buffersink_get_frame(sink_ctx, filt);
            if (ret >= 0) {
                got_frame = 1;
                goto extract;
            }
        }
        av_packet_unref(&pkt);
    }

extract:
    if (!got_frame) {
        fprintf(stderr, "No thumbnail frame extracted\n");
        ret = -1;
    } else {
        if (filt->format != AV_PIX_FMT_RGBA) {
            struct SwsContext *c = sws_alloc_context();
            sws = av_frame_alloc();
            if (!c || !sws) {
                ret = AVERROR(ENOMEM);
                goto cleanup_decode;
            }

            av_opt_set_int(c, "srcw",       filt->width,     0);
            av_opt_set_int(c, "srch",       filt->height,    0);
            av_opt_set_int(c, "src_format", filt->format,    0);
            av_opt_set_int(c, "dstw",       filt->width,     0);
            av_opt_set_int(c, "dsth",       filt->height,    0);
            av_opt_set_int(c, "dst_format", AV_PIX_FMT_RGBA, 0);
            av_opt_set_int(c, "sws_flags",  SWS_POINT,       0);
            av_opt_set_int(c, "threads",    1,                0);

            if (sws_init_context(c, NULL, NULL) < 0) {
                sws_freeContext(c);
                av_frame_free(&sws);
                goto cleanup_decode;
            }

            sws->format          = AV_PIX_FMT_RGBA;
            sws->width           = filt->width;
            sws->height          = filt->height;
            sws->color_range     = filt->color_range;
            sws->colorspace      = filt->colorspace;
            sws->color_primaries = filt->color_primaries;
            sws->color_trc       = filt->color_trc;

            if (av_frame_get_buffer(sws, 0) < 0) {
                sws_freeContext(c);
                av_frame_free(&sws);
                goto cleanup_decode;
            }

            sws_scale_frame(c, sws, filt);
            sws->pts      = filt->pts;
            sws->pkt_dts  = filt->pkt_dts;
            sws->pict_type = filt->pict_type;
            sws->duration = filt->duration;
            sws_freeContext(c);

            AVFrame *old = filt;
            filt = sws;
            av_frame_free(&old);
        }

        filt->time_base = fmt_ctx->streams[vsi]->time_base;

        int data_size;
        uint8_t *data = copy_frame_data(filt, &data_size);
        if (data) {
            ThumbnailEvent tev = {
                .is_raw    = 1,
                .data      = (uint32_t)(uintptr_t)data,
                .data_size = data_size,
                .width     = filt->width,
                .height    = filt->height,
                .format    = filt->format,
            };
            bridge_emit_thumbnail(&tev);
            av_free(data);
            ret = 0;
        } else {
            ret = -1;
        }
    }

    av_packet_unref(&pkt);

cleanup_decode:
    av_frame_free(&frame);
    av_frame_free(&filt);
    av_frame_free(&sws);
    avcodec_free_context(&dec_ctx);
    avfilter_graph_free(&filter_graph);

end:
    avformat_close_input(&fmt_ctx);
    avio_context_free(&avio);
    return ret;
}
