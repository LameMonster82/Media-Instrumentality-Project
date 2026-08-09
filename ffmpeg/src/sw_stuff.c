#include "libavutil/frame.h"
#include "libavutil/opt.h"
#include "libswresample/swresample.h"
#include "libswscale/swscale.h"

int init_sws(SwsContext **sws_ctx, AVFrame *frame,
             enum AVPixelFormat best_fmt) {
  if (best_fmt == AV_PIX_FMT_NONE) {
    printf("No good pix fmt found for conversion, Falling back to RGBA");
    best_fmt = AV_PIX_FMT_RGBA;
  }

  *sws_ctx = sws_alloc_context();
  if (*sws_ctx == NULL) {
    printf("Error creating swsContext\n");
    return -1;
  }
  av_opt_set_int(*sws_ctx, "srcw", frame->width, 0);
  av_opt_set_int(*sws_ctx, "srch", frame->height, 0);
  av_opt_set_int(*sws_ctx, "src_format", frame->format, 0);
  av_opt_set_int(*sws_ctx, "dstw", frame->width, 0);
  av_opt_set_int(*sws_ctx, "dsth", frame->height, 0);
  av_opt_set_int(*sws_ctx, "dst_format", best_fmt, 0);
  av_opt_set_int(*sws_ctx, "sws_flags", SWS_POINT, 0);
  av_opt_set_int(*sws_ctx, "threads", 1,
                 0); // codecContext[streamIndex]->thread_count / 2

  if (sws_init_context(*sws_ctx, NULL, NULL) < 0) {
    printf("Error init swsContext\n");
    sws_freeContext(*sws_ctx);
    return -1;
  }

  return 0;
}

AVFrame *sws_frame(SwsContext *sws_ctx, AVFrame *frame,
                   enum AVPixelFormat best_fmt) {

  AVFrame *dst = av_frame_alloc();
  dst->format = best_fmt;
  dst->width = frame->width;
  dst->height = frame->height;
  dst->color_range = frame->color_range;
  dst->colorspace = frame->colorspace;
  dst->color_primaries = frame->color_primaries;
  dst->color_trc = frame->color_trc;

  int ret = av_frame_get_buffer(dst, 0);
  if (ret < 0) {
    fprintf(stderr, "Could not allocate the video frame data for new format\n");
    return NULL;
  }

  sws_scale_frame(sws_ctx, dst, frame);
  dst->pts = frame->pts;
  dst->pkt_dts = frame->pkt_dts;
  dst->pict_type = frame->pict_type;
  dst->duration = frame->duration;
  dst->time_base = frame->time_base;

  return dst;
}

int init_swr(SwrContext **swr_ctx, AVFrame *frame,
              enum AVSampleFormat best_fmt) {
  // Convert the frame to a desired pixel format
  int ret = swr_alloc_set_opts2(swr_ctx, &frame->ch_layout,
                                best_fmt, frame->sample_rate, &frame->ch_layout,
                                frame->format, frame->sample_rate, 0, NULL);

  if (ret < 0 || swr_init(*swr_ctx) < 0) {
    printf("Error creating swrContext\n");
    swr_free(swr_ctx);
    return -1;
  }

  return ret;
}

AVFrame *swr_frame(SwrContext *swr_ctx, AVFrame *frame,
                   enum AVSampleFormat best_fmt) {
  AVFrame *dst = av_frame_alloc();
  if (av_channel_layout_copy(&dst->ch_layout, &frame->ch_layout) < 0)
    return NULL;

  dst->nb_samples = frame->nb_samples;
  dst->sample_rate = frame->sample_rate;
  dst->format = best_fmt;

  int ret = av_frame_get_buffer(dst, 0);
  if (ret < 0) {
    fprintf(stderr, "Could not allocate the audio frame data for new format\n");
  }

  ret = swr_convert(swr_ctx, dst->data, dst->nb_samples,
                    (const uint8_t **)frame->data, frame->nb_samples);
  dst->pts = frame->pts;

  return dst;
}
