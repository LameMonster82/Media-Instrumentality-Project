#include "context.h"
#include "libavutil/buffer.h"
#include "libavutil/frame.h"
#include "libavutil/imgutils.h"
#include "libavutil/opt.h"
#include "libswresample/swresample.h"
#include "libswscale/swscale.h"

int init_sws(SwsInfo *info, AVFrame *frame, enum AVPixelFormat best_fmt) {
  if (best_fmt == AV_PIX_FMT_NONE) {
    printf("No good pix fmt found for conversion, Falling back to RGBA");
    best_fmt = AV_PIX_FMT_RGBA;
  }

  SwsContext *sws_ctx = sws_alloc_context();
  if (sws_ctx == NULL) {
    printf("Error creating swsContext\n");
    return -1;
  }
  av_opt_set_int(sws_ctx, "srcw", frame->width, 0);
  av_opt_set_int(sws_ctx, "srch", frame->height, 0);
  av_opt_set_int(sws_ctx, "src_format", frame->format, 0);
  av_opt_set_int(sws_ctx, "dstw", frame->width, 0);
  av_opt_set_int(sws_ctx, "dsth", frame->height, 0);
  av_opt_set_int(sws_ctx, "dst_format", best_fmt, 0);
  av_opt_set_int(sws_ctx, "sws_flags", SWS_POINT, 0);
  av_opt_set_int(sws_ctx, "threads", 1,
                 0); // codecContext[streamIndex]->thread_count / 2

  if (sws_init_context(sws_ctx, NULL, NULL) < 0) {
    printf("Error init swsContext\n");
    sws_freeContext(sws_ctx);
    return -1;
  }

  info->ctx = sws_ctx;
  info->in_fmt = frame->format;
  info->in_width = frame->width;
  info->in_height = frame->height;
  info->out_fmt = best_fmt;
  info->pool = av_buffer_pool_init(
      av_image_get_buffer_size(best_fmt, frame->width, frame->height, 1),
      av_buffer_alloc);

  return 0;
}

AVFrame *sws_frame(SwsInfo *info, AVFrame *frame, enum AVPixelFormat best_fmt) {

  AVFrame *dst = av_frame_alloc();
  if (!dst)
    return NULL;

  AVBufferRef *buf = av_buffer_pool_get(info->pool);
  if (!buf) {
    av_frame_free(&dst);
    return NULL;
  }

  dst->buf[0] = buf;
  dst->format = best_fmt;
  dst->width = frame->width;
  dst->height = frame->height;

  av_image_fill_arrays(dst->data, dst->linesize, buf->data, best_fmt,
                       frame->width, frame->height, 1);
  av_frame_copy_props(dst, frame);

  sws_scale_frame(info->ctx, dst, frame);

  dst->pts = frame->pts;
  dst->pkt_dts = frame->pkt_dts;
  dst->pict_type = frame->pict_type;
  dst->duration = frame->duration;
  dst->time_base = frame->time_base;

  return dst;
}

int init_swr(SwrInfo *info, AVFrame *frame, enum AVSampleFormat best_fmt) {
  int channels = FFMIN(frame->ch_layout.nb_channels, 8);
  // Convert the frame to a desired pixel format
  int ret = swr_alloc_set_opts2(&info->ctx, &frame->ch_layout, best_fmt,
                                frame->sample_rate, &frame->ch_layout,
                                frame->format, frame->sample_rate, 0, NULL);

  if (ret < 0 || swr_init(info->ctx) < 0) {
    printf("Error creating swrContext\n");
    swr_free(&info->ctx);
    return -1;
  }

  int max_out_samples = swr_get_out_samples(info->ctx, frame->nb_samples);

  av_channel_layout_copy(&info->in_layout,
                             &frame->ch_layout);
  info->in_fmt = frame->format;
  info->in_rate = frame->sample_rate;
  info->in_samples = frame->nb_samples;
  info->out_fmt = best_fmt;
  info->pool =
      av_buffer_pool_init(av_samples_get_buffer_size(
                              NULL, channels, max_out_samples, best_fmt, 0),
                          av_buffer_alloc);

  return ret;
}

AVFrame *swr_frame(SwrInfo *info, AVFrame *frame,
                   enum AVSampleFormat best_fmt) {
  AVFrame *dst = av_frame_alloc();
  if (!dst)
    return NULL;

  if (av_channel_layout_copy(&dst->ch_layout, &frame->ch_layout) < 0) {
    av_frame_free(&dst);
    return NULL;
  }

  AVBufferRef *buf = av_buffer_pool_get(info->pool);
  if (!buf) {
    av_frame_free(&dst);
    return NULL;
  }

  dst->buf[0] = buf;
  dst->format = best_fmt;
  dst->nb_samples = frame->nb_samples;
  dst->sample_rate = frame->sample_rate;
  int channels = FFMIN(frame->ch_layout.nb_channels, 8);


  av_samples_fill_arrays(dst->data, dst->linesize, buf->data, channels,
                       frame->nb_samples, best_fmt, 1);

  int ret = swr_convert(info->ctx, dst->data, dst->nb_samples,
                        (const uint8_t **)frame->data, frame->nb_samples);

  if (ret < 0) {
    av_frame_free(&dst);
    return NULL;
  }
  
  dst->nb_samples = ret;
  dst->pts = frame->pts;

  return dst;
}
