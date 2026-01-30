#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libswscale/swscale.h>
#include "libavutil/pixfmt.h"
#include <emscripten.h>
#include <libavutil/pixfmt.h>
#include <libavutil/pixdesc.h>
#include <libavutil/imgutils.h>
#include <libavutil/avutil.h>
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
#include <libavutil/opt.h>
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersrc.h>
#include <libavfilter/buffersink.h>

EM_JS(int, fetch_data2, (uint8_t *buf, int buf_size), {
    // console.log("good morning");
    let value = globalThis.fetch_video_data(buf, buf_size);
    // console.log("hi", value);
    return value;
});

EM_JS(int64_t, seek_data2, (int64_t offset, int whence), {
    // console.log("good morning");
    let value = globalThis.seek_video_data(offset, whence);
    // console.log("hi", value);
    return value;
});

EM_JS(void, submit_thumbnail, (int is_raw, uint8_t *data, int data_size, int width, int height, int format), {
    globalThis.submit_thumbnail({is_raw, data, data_size, width, height, format});
});

EMSCRIPTEN_KEEPALIVE
static int custom_read_packet2(void *opaque, uint8_t *buf, int buf_size)
{
    int result = fetch_data2(buf, buf_size);
    if (result == -1)
    {
        printf("Error fetching video data\n");
        return AVERROR(EIO);
    }
    if (result == -2)
    {
        printf("Reached EOF\n");
        return AVERROR_EOF;
    }

    return result;
}

EMSCRIPTEN_KEEPALIVE
static int custom_write_packet2(void *opaque, uint8_t *buf, int buf_size)
{
    return 0;
}

EMSCRIPTEN_KEEPALIVE
static int64_t custom_seek_packet2(void *opaque, int64_t offset, int whence)
{
    int64_t result = seek_data2(offset, whence);
    // printf("Done fetching %d \n", result);
    if (result < 0)
        printf("Error seeking video data\n");

    return result;
}

uint8_t *copy_frame_data_range2(const AVFrame *frame, int *out_size)
{
    const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(frame->format);
    if (!desc)
        return NULL;

    int size = av_image_get_buffer_size(frame->format, frame->width,
                                        frame->height, 1);

    // printf("Frame required size is %d \n", size);

    uint8_t *buffer = av_malloc(size);
    if (!buffer)
    {
        fprintf(stderr, "Can not alloc buffer to copy frame\n");
        return NULL;
    }

    int copyout_size = av_image_copy_to_buffer(buffer, size,
                                               (const uint8_t *const *)frame->data,
                                               (const int *)frame->linesize, frame->format,
                                               frame->width, frame->height, 1);

    // printf("Frame size is %d \n", copyout_size);
    *out_size = size;
    if (*out_size < 0)
        return NULL;

    return buffer;
}

AVFrame *swsFrame2 = NULL;
AVFrame *frame2 = NULL;
AVFrame *filt_frame = NULL;
EMSCRIPTEN_KEEPALIVE
int extract_thumbnail()
{
    uint8_t *thumb_buf = av_malloc(32768);

    AVFormatContext *fmt_ctx = NULL;
    AVIOContext *avioContext = avio_alloc_context(thumb_buf, 32768, 0, NULL, custom_read_packet2, NULL, custom_seek_packet2);

    // Set up the format context and assign the custom IO context to it
    fmt_ctx = avformat_alloc_context();
    fmt_ctx->pb = avioContext;
    fmt_ctx->flags |= AVFMT_FLAG_GENPTS | AVFMT_FLAG_CUSTOM_IO;
    avioContext->direct = 0;
    avioContext->seekable = AVIO_SEEKABLE_NORMAL;

    av_log_set_level(AV_LOG_ERROR);

    int ret = avformat_open_input(&fmt_ctx, "", NULL, NULL);
    if (ret < 0)
    {
        fprintf(stderr, "avformat_open_input failed: %s \n", av_err2str(ret));
        return ret;
    }

    ret = avformat_find_stream_info(fmt_ctx, NULL);
    if (ret < 0)
    {
        fprintf(stderr, "avformat_find_stream_info failed: %s \n", av_err2str(ret));
        goto end;
    }

    // First check for attached picture
    for (unsigned i = 0; i < fmt_ctx->nb_streams; i++)
    {
        AVStream *st = fmt_ctx->streams[i];
        if (st->disposition & AV_DISPOSITION_ATTACHED_PIC)
        {
            AVPacket *pkt = &st->attached_pic;
            submit_thumbnail(0, pkt->data, pkt->size, 0, 0, -1);
            ret = 0;
            goto end;
        }
    }

    // No poster, generate thumbnail from video
    int video_stream_index = av_find_best_stream(fmt_ctx, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
    if (video_stream_index < 0)
    {
        fprintf(stderr, "av_find_best_stream failed. No video stream\n");
        ret = video_stream_index;
        goto end;
    }

    AVCodecParameters *codecpar = fmt_ctx->streams[video_stream_index]->codecpar;
    const AVCodec *decoder = avcodec_find_decoder(codecpar->codec_id);
    AVCodecContext *dec_ctx = avcodec_alloc_context3(decoder);
    avcodec_parameters_to_context(dec_ctx, codecpar);
    avcodec_open2(dec_ctx, decoder, NULL);

    // Set up filter graph
    AVFilterGraph *filter_graph = avfilter_graph_alloc();
    filter_graph->nb_threads = 1;
    AVFilterContext *buffersrc_ctx = NULL, *buffersink_ctx = NULL;
    char args[512];
    snprintf(args, sizeof(args),
             "video_size=%dx%d:pix_fmt=%d:time_base=1/25:pixel_aspect=%d/%d",
             dec_ctx->width, dec_ctx->height, dec_ctx->pix_fmt,
             dec_ctx->sample_aspect_ratio.num, dec_ctx->sample_aspect_ratio.den);

    const AVFilter *buffersrc = avfilter_get_by_name("buffer");
    const AVFilter *buffersink = avfilter_get_by_name("buffersink");
    AVFilterInOut *outputs = avfilter_inout_alloc();
    AVFilterInOut *inputs = avfilter_inout_alloc();

    if (!buffersrc || !buffersink)
    {
        fprintf(stderr, "Filtering support not available or filters not found.\n");
        ret = AVERROR_FILTER_NOT_FOUND;
        goto end;
    }

    ret = avfilter_graph_create_filter(&buffersrc_ctx, buffersrc, "in", args, NULL, filter_graph);
    if (ret < 0)
        goto cleanup;

    ret = avfilter_graph_create_filter(&buffersink_ctx, buffersink, "out", NULL, NULL, filter_graph);
    if (ret < 0)
        goto cleanup;

    AVFilterContext *thumbnail_ctx;
    ret = avfilter_graph_create_filter(&thumbnail_ctx, avfilter_get_by_name("thumbnail"), "thumb", NULL, NULL, filter_graph);
    if (ret < 0)
        goto cleanup;

    avfilter_link(buffersrc_ctx, 0, thumbnail_ctx, 0);
    avfilter_link(thumbnail_ctx, 0, buffersink_ctx, 0);
    avfilter_graph_config(filter_graph, NULL);

    // Read frames
    AVPacket pkt;

    
    frame2 = av_frame_alloc();
    filt_frame = av_frame_alloc();

    int got_frame = 0;

    while (av_read_frame(fmt_ctx, &pkt) >= 0)
    {
        if (pkt.stream_index == video_stream_index)
        {
            ret = avcodec_send_packet(dec_ctx, &pkt);
            if (ret < 0)
                break;
            while (ret >= 0)
            {
                ret = avcodec_receive_frame(dec_ctx, frame2);
                if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
                    break;
                if (ret < 0)
                    goto cleanup;

                ret = av_buffersrc_add_frame(buffersrc_ctx, frame2);
                ret = av_buffersink_get_frame(buffersink_ctx, filt_frame);
                if (ret >= 0)
                {
                    got_frame = 1;
                    goto extract_image;
                }
            }
        }
        av_packet_unref(&pkt);
    }

extract_image:
    if (got_frame)
    {
        // lastFrameWasBFrame = frame->pict_type == AV_PICTURE_TYPE_B;
        if (AV_PIX_FMT_RGBA != filt_frame->format)
        {

            //if(swsFrame2 == NULL)
            swsFrame2 = av_frame_alloc();

            SwsContext *c = sws_alloc_context();
            if (c == NULL)
            {
                fprintf(stderr, "Error creating swsContext\n");
                goto cleanup;
            }
            av_opt_set_int(c, "srcw", filt_frame->width, 0);
            av_opt_set_int(c, "srch", filt_frame->height, 0);
            av_opt_set_int(c, "src_format", filt_frame->format, 0);
            av_opt_set_int(c, "dstw", filt_frame->width, 0);
            av_opt_set_int(c, "dsth", filt_frame->height, 0);
            av_opt_set_int(c, "dst_format", AV_PIX_FMT_RGBA, 0);
            av_opt_set_int(c, "sws_flags", SWS_POINT, 0);
            av_opt_set_int(c, "threads", 1, 0); // codecContext[streamIndex]->thread_count / 2

            ret = sws_init_context(c, NULL, NULL);
            if (ret < 0)
            {
                fprintf(stderr,"Error init swsContext: %s \n", av_err2str(ret));
                sws_freeContext(c);
                goto cleanup;
            }

            swsFrame2->format = AV_PIX_FMT_RGBA;
            swsFrame2->width = filt_frame->width;
            swsFrame2->height = filt_frame->height;
            swsFrame2->color_range = filt_frame->color_range;
            swsFrame2->colorspace = filt_frame->colorspace;
            swsFrame2->color_primaries = filt_frame->color_primaries;
            swsFrame2->color_trc = filt_frame->color_trc;

            ret = av_frame_get_buffer(swsFrame2, 0);
            if (ret < 0)
            {
                fprintf(stderr, "Could not allocate the video frame data for new format: %s \n", av_err2str(ret));
                goto cleanup;
            }

            // sws_scale(swsContext[streamIndex], (const uint8_t *const *)frame->data, frame->linesize, 0, frame->height, swsFrame->data, swsFrame->linesize);
            sws_scale_frame(c, swsFrame2, filt_frame);

            swsFrame2->pts = filt_frame->pts;
            swsFrame2->pkt_dts = filt_frame->pkt_dts;
            swsFrame2->pict_type = filt_frame->pict_type;
            swsFrame2->duration = filt_frame->duration;
            sws_freeContext(c);
            AVFrame *old_frame = filt_frame;
            filt_frame = swsFrame2;
            av_frame_free(&old_frame);
        }

        filt_frame->time_base = fmt_ctx->streams[video_stream_index]->time_base;

        int data_size;
        uint8_t *data = copy_frame_data_range2(filt_frame, &data_size);
        submit_thumbnail(1, data, data_size, filt_frame->width, filt_frame->height, filt_frame->format);
        av_free(data); // Free the copied frame data
        av_packet_unref(&pkt);

        ret = 0;
    }
    else
    {
        fprintf(stderr, "Did not get frame :(.\n");
        ret = -1;
    }

cleanup:
    avcodec_free_context(&dec_ctx);
    avfilter_graph_free(&filter_graph);
    avfilter_inout_free(&inputs);
    avfilter_inout_free(&outputs);
    av_frame_free(&frame2); // Free allocated frames
    av_frame_free(&filt_frame);
    av_packet_unref(&pkt); // Ensure packet is unreferenced
end:
    avformat_close_input(&fmt_ctx);
    avio_context_free(&avioContext);
    return ret;
}