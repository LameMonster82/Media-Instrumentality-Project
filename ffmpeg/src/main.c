#include "codec_config.h"
#include <emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavcodec/packet.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/imgutils.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "context.h"
#include "io.h"
#include "libavcodec/codec_id.h"
#include "libavutil/channel_layout.h"
#include "libavutil/dict.h"
#include "libavutil/error.h"
#include "libavutil/avutil.h"
#include "libavutil/frame.h"
#include "libswscale/swscale.h"
#include "sw_stuff.h"

EM_JS(void, send_sw_frame, (ReturnType * results),
      { return self.send_sw_frame(results); });

EM_JS(void, set_timestamp, (int64_t time),
      { return self.set_timestamp(time); });

static BridgeContext g_ctx;

EMSCRIPTEN_KEEPALIVE
int init_ffmpeg(int buffer_size, int is_stream, int debug_level,
                const enum AVPixelFormat *fmts, int thread_count) {

  memset(&g_ctx, 0, sizeof(g_ctx));
  g_ctx.supported_pix_fmts = fmts;
  g_ctx.thread_count = thread_count;
  g_ctx.report_timestamp = 0;

  av_log_set_level(debug_level);

  int res = allocate_io(&g_ctx, buffer_size, is_stream);
  if (res < 0) {
    fprintf(stderr, "Error allocating FFmpeg IO\n");
    return res;
  }

  ReturnType *data_return = calloc(1, sizeof(*data_return));
  data_return->status = 0;
  data_return->packet_data = NULL;
  data_return->packet_size = 0;
  g_ctx.data_return = data_return;

  fprintf(stderr, "FFmpeg initialized with buffer size %d\n", buffer_size);
  return 0;
}

EMSCRIPTEN_KEEPALIVE
FileInfo *open_file() {
  int i;
  int ret = avformat_open_input(&g_ctx.fmt_ctx, "", NULL, NULL);
  if (ret < 0) {
    av_log(NULL, AV_LOG_ERROR, "Cannot open input stream\n");
    return NULL;
  }

  ret = avformat_find_stream_info(g_ctx.fmt_ctx, NULL);
  if (ret < 0) {
    av_log(NULL, AV_LOG_ERROR, "Cannot find stream information\n");
    avformat_close_input(&g_ctx.fmt_ctx);
    return NULL;
  }

  av_dump_format(g_ctx.fmt_ctx, 0, "", 0);

  FileInfo *info = calloc(1, sizeof(FileInfo));
  info->duration = g_ctx.fmt_ctx->duration == AV_NOPTS_VALUE
                       ? INT64_MAX
                       : g_ctx.fmt_ctx->duration;
  info->start_time = g_ctx.fmt_ctx->start_time == AV_NOPTS_VALUE
                         ? 0
                         : g_ctx.fmt_ctx->start_time;
  info->bitrate = g_ctx.fmt_ctx->bit_rate ? g_ctx.fmt_ctx->bit_rate : 0;

  info->nb_stream_groups = g_ctx.fmt_ctx->nb_stream_groups;
  info->metadata = g_ctx.fmt_ctx->metadata;

  info->nb_chapters = g_ctx.fmt_ctx->nb_chapters;
  info->chapters = malloc(sizeof(ChapterInfo) * g_ctx.fmt_ctx->nb_chapters);
  for (i = 0; i < g_ctx.fmt_ctx->nb_chapters; i++) {
    const AVChapter *ch = g_ctx.fmt_ctx->chapters[i];
    info->chapters[i].id = ch->id;
    info->chapters[i].start = ch->start * av_q2d(ch->time_base);
    info->chapters[i].end = ch->end * av_q2d(ch->time_base);
    info->chapters[i].metadata = ch->metadata;
  }

  info->nb_streams = g_ctx.fmt_ctx->nb_streams;
  info->streams = malloc(sizeof(StreamInfo) * g_ctx.fmt_ctx->nb_streams);

  double duration = (double)g_ctx.fmt_ctx->duration / AV_TIME_BASE;

  g_ctx.nb_streams = g_ctx.fmt_ctx->nb_streams;
  g_ctx.stream_support =  calloc(g_ctx.nb_streams, sizeof(int32_t));
  g_ctx.codecs =          calloc(g_ctx.nb_streams, sizeof(AVCodecContext *));
  g_ctx.sws_ctx =         calloc(g_ctx.nb_streams, sizeof(SwsContext *));
  g_ctx.sws_in_fmt =      calloc(g_ctx.nb_streams, sizeof(int));
  g_ctx.swr_ctx =         calloc(g_ctx.nb_streams, sizeof(SwrContext *));
  g_ctx.swr_in_fmt =      calloc(g_ctx.nb_streams, sizeof(int));
  g_ctx.swr_in_rate =     calloc(g_ctx.nb_streams, sizeof(int));
  g_ctx.swr_in_layout =   calloc(g_ctx.nb_streams, sizeof(AVChannelLayout));
  g_ctx.last_ts_js =      calloc(g_ctx.nb_streams, sizeof(int64_t));
  g_ctx.last_dur_js =     calloc(g_ctx.nb_streams, sizeof(int64_t));

  for (int i = 0; i < g_ctx.fmt_ctx->nb_streams; i++) {
    // Get codec parameters and find the decoder
    AVStream *stream = g_ctx.fmt_ctx->streams[i];

    info->streams[i].type = AVMEDIA_TYPE_UNKNOWN;

    if (!stream)
      continue;

    enum AVMediaType type = stream->codecpar->codec_type;

    if (!(type == AVMEDIA_TYPE_VIDEO || type == AVMEDIA_TYPE_AUDIO ||
          type == AVMEDIA_TYPE_SUBTITLE || type == AVMEDIA_TYPE_ATTACHMENT)) {
      continue;
    }

    info->streams[i].type = type;
    info->streams[i].metadata = stream->metadata;
    info->streams[i].disposition = stream->disposition;

    if (type == AVMEDIA_TYPE_ATTACHMENT) {
      const AVDictionaryEntry *mimetype =
          av_dict_get(stream->metadata, "mimetype", NULL, 0);
      if (mimetype && strncmp(mimetype->value, "font/", 5) == 0) {
        AttachmentConfig *att = calloc(1, sizeof(AttachmentConfig));
        att->type = FONT;
        att->data = stream->codecpar->extradata;
        att->size = stream->codecpar->extradata_size;
        info->streams[i].attachment_config = att;
      } else {
        info->streams[i].type = AVMEDIA_TYPE_UNKNOWN;
      }
      continue;
    }

    if (type == AVMEDIA_TYPE_VIDEO &&
        stream->disposition & AV_DISPOSITION_ATTACHED_PIC) {
      info->streams[i].type = AVMEDIA_TYPE_ATTACHMENT;

      AVPacket *pic = &stream->attached_pic;
      AttachmentConfig *cover = calloc(1, sizeof(AttachmentConfig));
      cover->type = COVER;
      cover->data = pic->data;
      cover->size = pic->size;
      info->streams[i].attachment_config = cover;
      continue;
    }

    const AVCodec *codec;
    if (stream->codecpar->codec_id == AV_CODEC_ID_AV1) {
      codec = avcodec_find_decoder_by_name("libdav1d");
    } else {
      codec = avcodec_find_decoder(stream->codecpar->codec_id);
    }

    if (!codec) {
      av_log(NULL, AV_LOG_ERROR, "Failed to find decoder for stream #%u\n", i);
      info->streams[i].type = AVMEDIA_TYPE_UNKNOWN;
      continue;
    }

    AVCodecContext *ctx = avcodec_alloc_context3(codec);
    if (!ctx) {
      av_log(NULL, AV_LOG_ERROR,
             "Failed to allocate the decoder context for stream #%u\n", i);
      info->streams[i].type = AVMEDIA_TYPE_UNKNOWN;
      continue;
    }

    ctx->thread_count = g_ctx.thread_count;
    ctx->err_recognition = 0; // Accept all frames, no matter how broken
    ctx->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
    ctx->flags |= AV_CODEC_FLAG_OUTPUT_CORRUPT | AV_CODEC_FLAG2_FAST;

    // Initialize the codec context
    if (avcodec_parameters_to_context(ctx, stream->codecpar) < 0) {
      av_log(NULL, AV_LOG_ERROR,
             "Failed to copy decoder parameters to input decoder context "
             "for stream #%u\n",
             i);
      info->streams[i].type = AVMEDIA_TYPE_UNKNOWN;
      avcodec_free_context(&ctx);
      continue;
    }

    ctx->pkt_timebase = stream->time_base;

    ret = avcodec_open2(ctx, codec, NULL);
    if (ret < 0) {
      av_log(NULL, AV_LOG_ERROR, "Failed to open decoder for stream #%u\n", i);
      info->streams[i].type = AVMEDIA_TYPE_UNKNOWN;
      avcodec_free_context(&ctx);
      continue;
    }

    if (stream->duration != AV_NOPTS_VALUE)
      duration = stream->duration * av_q2d(stream->time_base);

    info->streams[i].duration = duration;
    if (type == AVMEDIA_TYPE_VIDEO) {
      info->streams[i].video_config = video_stream_to_config(stream->codecpar);
    } else if (type == AVMEDIA_TYPE_AUDIO) {
      info->streams[i].audio_config = audio_stream_to_config(stream->codecpar);
    } else if (type == AVMEDIA_TYPE_SUBTITLE) {
      SubtitleConfig *config = calloc(1, sizeof(SubtitleConfig));
      config->subtitle_header_size = ctx->subtitle_header_size;
      config->subtitle_header = ctx->subtitle_header;
      config->type = SUBTITLE_ASS;

      const AVCodecDescriptor *desc = avcodec_descriptor_get(codec->id);

      if (desc->props & AV_CODEC_PROP_BITMAP_SUB) {
        config->type = SUBTITLE_BITMAP;
      } else if (desc->props & AV_CODEC_PROP_TEXT_SUB) {
        config->type = SUBTITLE_ASS;
      }

      info->streams[i].subtitle_config = config;
    } else {
      info->streams[i].type = AVMEDIA_TYPE_UNKNOWN;
    }

    g_ctx.codecs[i] = ctx;
  }

  return info;
}

EMSCRIPTEN_KEEPALIVE
void set_stream_support(int index, int32_t support) {
  g_ctx.stream_support[index] = support;
}

VideoFrame *decode_frame(AVFrame *frame, int stream_index,
                         AVRational time_base) {
  int loss, ret;
  enum AVPixelFormat best_fmt = avcodec_find_best_pix_fmt_of_list(
      g_ctx.supported_pix_fmts, frame->format, 0, &loss);

  AVFrame *out_frame = frame;
  if (best_fmt != out_frame->format) {
    if (g_ctx.sws_ctx[stream_index] &&
        g_ctx.sws_in_fmt[stream_index] != frame->format) {
      sws_free_context(&g_ctx.sws_ctx[stream_index]);
    }
    if (!g_ctx.sws_ctx[stream_index]) {
      ret = init_sws(&g_ctx.sws_ctx[stream_index], frame, best_fmt);
      g_ctx.sws_in_fmt[stream_index] = frame->format;
    }

    // Create a new frame
    out_frame = sws_frame(g_ctx.sws_ctx[stream_index], frame, best_fmt);
    av_frame_free(&frame);
  }

  int64_t pts_js =
      av_rescale_q(out_frame->pts, time_base, (AVRational){1, 1000000});
  int64_t dur_js =
      av_rescale_q(out_frame->duration, time_base, (AVRational){1, 1000000});

  int buffer_size = av_image_get_buffer_size(
      out_frame->format, out_frame->width, out_frame->height, 1);

  VideoFrame *simple_frame = malloc(sizeof(*simple_frame));

  simple_frame->width = out_frame->width;
  simple_frame->height = out_frame->height;
  simple_frame->crop_top = out_frame->crop_top;
  simple_frame->crop_bottom = out_frame->crop_bottom;
  simple_frame->crop_left = out_frame->crop_left;
  simple_frame->crop_right = out_frame->crop_right;
  simple_frame->format = out_frame->format;
  simple_frame->key_frame = -1;
  simple_frame->pict_type = out_frame->pict_type;
  simple_frame->pts = out_frame->pts;
  simple_frame->ts_js = (double)pts_js;
  simple_frame->time_base_num = out_frame->time_base.num;
  simple_frame->time_base_den = out_frame->time_base.den;
  simple_frame->duration = out_frame->duration;
  simple_frame->dur_js = (double)dur_js;
  simple_frame->color_range = out_frame->color_range;
  simple_frame->color_space = out_frame->colorspace;
  simple_frame->color_primaries = out_frame->color_primaries;
  simple_frame->color_transfer = out_frame->color_trc;
  simple_frame->stream_index = stream_index;
  simple_frame->buffer_size = buffer_size;

  simple_frame->frame = out_frame;

  for (int i = 0; i < 8; i++) {
    simple_frame->src_data[i] = (uintptr_t)out_frame->data[i];
    simple_frame->src_linesize[i] = (int32_t)out_frame->linesize[i];
  }

  return simple_frame;
}

static int is_browser_supported_sample_fmt(enum AVSampleFormat fmt) {
  switch (fmt) {
  case AV_SAMPLE_FMT_U8:
  case AV_SAMPLE_FMT_S16:
  case AV_SAMPLE_FMT_S32:
  case AV_SAMPLE_FMT_FLT:
  case AV_SAMPLE_FMT_U8P:
  case AV_SAMPLE_FMT_S16P:
  case AV_SAMPLE_FMT_S32P:
  case AV_SAMPLE_FMT_FLTP:
    return 1;
  default:
    return 0;
  }
}

EMSCRIPTEN_KEEPALIVE
void cleanup_video_frame(VideoFrame *simple_frame) {
  av_frame_free(&simple_frame->frame);
  free(simple_frame);
}

AudioFrame *decode_audio(AVFrame *frame, int stream_index, double ts_js) {
  int ret;
  enum AVSampleFormat out_format = AV_SAMPLE_FMT_FLTP;
  AVFrame *out_frame = frame;
  if (frame->format != out_format) {
    if (g_ctx.swr_ctx[stream_index] &&
        (g_ctx.swr_in_fmt[stream_index] != frame->format ||
         g_ctx.swr_in_rate[stream_index] != frame->sample_rate ||
         av_channel_layout_compare(&g_ctx.swr_in_layout[stream_index],
                                   &frame->ch_layout))) {
      swr_free(&g_ctx.swr_ctx[stream_index]);
    }
    if (!g_ctx.swr_ctx[stream_index]) {
      init_swr(&g_ctx.swr_ctx[stream_index], frame, out_format);
      g_ctx.swr_in_fmt[stream_index] = frame->format;
      g_ctx.swr_in_rate[stream_index] = frame->sample_rate;
      av_channel_layout_copy(&g_ctx.swr_in_layout[stream_index],
                             &frame->ch_layout);
    }

    out_frame = swr_frame(g_ctx.swr_ctx[stream_index], frame, out_format);
    av_frame_free(&frame);
  }

  int channels = FFMIN(out_frame->ch_layout.nb_channels, 8);
  int buffer_size = av_samples_get_buffer_size(
      NULL, channels, out_frame->nb_samples, out_frame->format, 0);

  AudioFrame *simple_frame = malloc(sizeof(*simple_frame));

  simple_frame->channels = channels;
  simple_frame->samples = out_frame->nb_samples;
  simple_frame->sample_rate = out_frame->sample_rate;
  simple_frame->bytes_per_sample = av_get_bytes_per_sample(out_frame->format);
  simple_frame->ts_js = ts_js;
  simple_frame->stream_index = stream_index;
  simple_frame->format = out_frame->format;
  simple_frame->linesize = out_frame->linesize[0];
  simple_frame->buffer_size = buffer_size;

  simple_frame->frame = out_frame;

  for (int i = 0; i < 8; i++) {
    simple_frame->src_data[i] = (uintptr_t)out_frame->data[i];
  }

  return simple_frame;
}

EMSCRIPTEN_KEEPALIVE
void cleanup_audio_frame(AudioFrame *simple_frame) {
  av_frame_free(&simple_frame->frame);
  free(simple_frame);
}

SubtitleFrame *decode_subtitle_frame(AVSubtitleRect *frame, AVSubtitle *sub,
                                     int stream_index) {
  int loss, ret;

  int width = frame->w;
  int height = frame->h;
  int stride = frame->linesize[0];
  uint8_t *src = frame->data[0];                  // Indexed pixels
  uint32_t *palette = (uint32_t *)frame->data[1]; // ARGB palette

  // Allocate RGBA buffer
  uint8_t *rgba = malloc(width * height * 4);
  for (int y = 0; y < height; y++) {
    uint8_t *src_row = src + y * stride;
    uint8_t *dst_row = rgba + y * width * 4;

    for (int x = 0; x < width; x++) {
      uint8_t idx = src_row[x];
      uint32_t argb = palette[idx];

      // Convert ARGB to RGBA
      dst_row[x * 4 + 0] = (argb >> 16) & 0xFF; // R
      dst_row[x * 4 + 1] = (argb >> 8) & 0xFF;  // G
      dst_row[x * 4 + 2] = argb & 0xFF;         // B
      dst_row[x * 4 + 3] = (argb >> 24) & 0xFF; // A
    }
  }

  SubtitleFrame *simple_frame = malloc(sizeof(*simple_frame));

  simple_frame->width = frame->w;
  simple_frame->height = frame->h;
  simple_frame->codec_width = g_ctx.codecs[stream_index]->coded_width;
  simple_frame->codec_height = g_ctx.codecs[stream_index]->coded_height;
  simple_frame->x = frame->x;
  simple_frame->y = frame->y;
  simple_frame->nb_colors = frame->nb_colors;
  simple_frame->pts = sub->pts;
  simple_frame->stream_index = stream_index;
  simple_frame->rgba_buff = rgba;

  for (int i = 0; i < 4; i++) {
    simple_frame->src_data[i] = (uintptr_t)frame->data[i];
    simple_frame->src_linesize[i] = (int32_t)frame->linesize[i];
  }

  return simple_frame;
}

EMSCRIPTEN_KEEPALIVE
void cleanup_subtitle_frame(SubtitleFrame *simple_frame) {
  free(simple_frame->rgba_buff);
  free(simple_frame);
}

EMSCRIPTEN_KEEPALIVE
int seek_to(double time) {
  if (!(g_ctx.fmt_ctx->pb->seekable & AVIO_SEEKABLE_NORMAL)) {
    fprintf(stderr, "File is not seekable\n");
    return AVERROR(EIO);
  }
  
  int64_t target_timestamp_us = (int64_t)(time * AV_TIME_BASE);

  // Optional: prevent seeking beyond EOF
  if (g_ctx.fmt_ctx->duration > 0 &&
      target_timestamp_us > g_ctx.fmt_ctx->duration) {
    fprintf(stderr, "Target time %.2f exceeds file duration %.2f\n", time,
            (double)g_ctx.fmt_ctx->duration / AV_TIME_BASE);
    return AVERROR(EINVAL);
  }

  int ret =
      avformat_seek_file(g_ctx.fmt_ctx, -1, INT64_MIN, target_timestamp_us,
                         INT64_MAX, AVSEEK_FLAG_BACKWARD); // INT64_MAX

  g_ctx.report_timestamp = 1;

  if (ret < 0) {
    fprintf(stderr, "Seek failed: %s\n", av_err2str(ret));
    return ret;
  }

  for (int i = 0; i < g_ctx.nb_streams; i++) {
    if (g_ctx.codecs[i] != NULL) {
      avcodec_flush_buffers(g_ctx.codecs[i]);
    }
  }

  return 0;
}

EMSCRIPTEN_KEEPALIVE
ReturnType *poke_for_data() {
  AVPacket *packet = av_packet_alloc();
  int ret = av_read_frame(g_ctx.fmt_ctx, packet);

  g_ctx.data_return->video_frame = 0;
  g_ctx.data_return->audio_frame = 0;
  g_ctx.data_return->subtitle_frame = 0;
  g_ctx.data_return->subtitle_text = 0;
  g_ctx.data_return->packet_data = 0;

  g_ctx.data_return->status = RESULT_ERR_GENERIC;

  if (ret < 0) {
    fprintf(stderr, "Error reading frame: %s\n", av_err2str(ret));
    av_packet_free(&packet);
    if (ret == AVERROR_EOF) {
      g_ctx.data_return->status = RESULT_EOF;
    }
    return g_ctx.data_return;
  }

  g_ctx.data_return->stream_index = packet->stream_index;
  g_ctx.data_return->packet_data = packet->data;
  g_ctx.data_return->packet_size = packet->size;

  int stream_index = packet->stream_index;

  AVStream *stream = g_ctx.fmt_ctx->streams[stream_index];
  enum AVMediaType type = stream->codecpar->codec_type;

  int64_t ts_js;
  if (packet->pts != AV_NOPTS_VALUE) {
    ts_js =
        av_rescale_q(packet->pts, stream->time_base, (AVRational){1, 1000000});
  } else if (packet->dts != AV_NOPTS_VALUE) {
    ts_js =
        av_rescale_q(packet->dts, stream->time_base, (AVRational){1, 1000000});
  } else {
    ts_js = g_ctx.last_ts_js[stream_index] +
            g_ctx.last_dur_js[stream_index]; // extrapolate
  }
  int64_t dur_js = av_rescale_q(packet->duration, stream->time_base,
                                (AVRational){1, 1000000});

  g_ctx.last_ts_js[stream_index] = ts_js;
  g_ctx.last_dur_js[stream_index] = dur_js;

  if (g_ctx.report_timestamp == 1) {
    set_timestamp(ts_js);
    g_ctx.report_timestamp = 0;
  }

  g_ctx.data_return->flags = packet->flags;
  g_ctx.data_return->timestamp = ts_js;
  g_ctx.data_return->duration = dur_js;

  if (g_ctx.stream_support[stream_index] == STREAM_HW_SUPPORT) {
    g_ctx.data_return->status = RESULT_RAW_PACKET;
    g_ctx.data_return->type = RESULT_PACKET;
    g_ctx.data_return->packet = packet;
    return g_ctx.data_return;
  } else if (g_ctx.stream_support[stream_index] == STREAM_NO_SUPPORT ||
             g_ctx.stream_support[stream_index] ==
                 STREAM_UNUSED) { // Dont care about this stream rn
    g_ctx.data_return->status = RESULT_ERR_SKIP;
    av_packet_free(&packet);
    return g_ctx.data_return;
  }

  if (g_ctx.codecs[stream_index] == NULL) {
    av_packet_free(&packet);
    g_ctx.data_return->status = RESULT_ERR_SKIP;
    return g_ctx.data_return;
  }

  AVCodecContext *ctx = g_ctx.codecs[stream_index];

  if (type == AVMEDIA_TYPE_SUBTITLE) {
    AVSubtitle sub;
    int got_sub = 0;

    ret = avcodec_decode_subtitle2(ctx, &sub, &got_sub, packet);
    if (ret < 0) {
      fprintf(stderr, "Error decoding subtitle: %s\n", av_err2str(ret));
      av_packet_free(&packet);
      g_ctx.data_return->status = RESULT_ERR_GENERIC;
      return g_ctx.data_return;
    }

    if (got_sub == 0) {
      fprintf(stdout, "Got no subtitle. hmmm: %s\n", av_err2str(ret));
      av_packet_free(&packet);
      g_ctx.data_return->status = RESULT_NEED_MORE;
      return g_ctx.data_return;
    }

    g_ctx.data_return->status = RESULT_OK;
    g_ctx.data_return->type = RESULT_SUBTITLE;

    for (int i = 0; i < sub.num_rects; i++) {
      AVSubtitleRect *rect = sub.rects[i];

      g_ctx.data_return->subtitle_type = rect->type;
      if (rect->type == SUBTITLE_BITMAP) {
        SubtitleFrame *frame =
            decode_subtitle_frame(rect, &sub, stream_index);
        g_ctx.data_return->subtitle_frame = frame;
      } else {
          int64_t pts_js =
            av_rescale_q(sub.pts, packet->time_base, (AVRational){1, 1000000}) +
            (sub.start_display_time * 1000);
          dur_js =
            av_rescale_q(sub.pts, packet->time_base, (AVRational){1, 1000000}) +
            (sub.end_display_time * 1000);

        if (pts_js != 0 && dur_js != 0) {
          g_ctx.data_return->duration = dur_js;
          g_ctx.data_return->timestamp = pts_js;
        }
        if (rect->type == SUBTITLE_ASS) {
          g_ctx.data_return->subtitle_text = rect->ass;
        } else if (rect->type == SUBTITLE_TEXT) {
          g_ctx.data_return->subtitle_text = rect->text;
        } else {
          fprintf(stderr, "Unknown subtitle type: %d\n", rect->type);
          continue;
        }
    }

      send_sw_frame(g_ctx.data_return);
    }

    avsubtitle_free(&sub);
    av_packet_free(&packet);
    return g_ctx.data_return;
  }

  // fprintf(stdout, "ptr is %d\n", g_ctx.stream_support);
  // fprintf(stdout, "State is %d\n", g_ctx.stream_support[stream_index]);

  ret = avcodec_send_packet(ctx, packet);
  if (ret < 0) {
    fprintf(stderr, "Error sending packet to decoder: %s\n", av_err2str(ret));
    av_packet_free(&packet);
    g_ctx.data_return->status = RESULT_ERR_GENERIC;
    return g_ctx.data_return;
  }

  int sent_sw_frame = 0;
  while (ret >= 0) {
    AVFrame *frame = av_frame_alloc();
    ret = avcodec_receive_frame(ctx, frame);

    if (ret == AVERROR_EOF) {
      g_ctx.data_return->status = RESULT_EOF;
      av_frame_free(&frame);
      break;
    } else if (ret == AVERROR(EAGAIN)) {
      av_frame_free(&frame);
      if (sent_sw_frame > 0) {
        g_ctx.data_return->status = RESULT_OK;
      } else {
        g_ctx.data_return->status = RESULT_NEED_MORE;
      }
      break;
    } else if (ret < 0) {
      av_frame_free(&frame);
      fprintf(stderr, "Error while getting frames out :/\n");
      g_ctx.data_return->status = RESULT_ERR_GENERIC;
      break;
    }

    if (type == AVMEDIA_TYPE_VIDEO) {
      VideoFrame *final_frame =
          decode_frame(frame, stream_index, stream->time_base);

      g_ctx.data_return->status = RESULT_OK;
      g_ctx.data_return->type = RESULT_VIDEO;
      g_ctx.data_return->video_frame = final_frame;

    } else if (type == AVMEDIA_TYPE_AUDIO) {
      AudioFrame *final_frame = decode_audio(frame, stream_index, ts_js);

      g_ctx.data_return->status = RESULT_OK;
      g_ctx.data_return->type = RESULT_AUDIO;
      g_ctx.data_return->audio_frame = final_frame;
    } else {
      fprintf(stderr, "Unknown media type, skipping\n");
      av_frame_free(&frame);
      continue;
    }

    sent_sw_frame = 1;
    av_packet_free(&packet);
    send_sw_frame(g_ctx.data_return);
  }

  av_packet_free(&packet);

  // g_ctx.data_return->status = RESULT_UNREACHABLE;

  return g_ctx.data_return;
}

EMSCRIPTEN_KEEPALIVE
void cleanup_packet(AVPacket *packet) { av_packet_free(&packet); }

EMSCRIPTEN_KEEPALIVE
void cleanup_info(FileInfo *info) {
  int i;
  for (i = 0; i < info->nb_streams; i++) {
    enum AVMediaType type = info->streams[i].type;
    switch (type) {

    case AVMEDIA_TYPE_VIDEO:
      if(info->streams[i].video_config->description_size > 0)
        free(info->streams[i].video_config->description);
      free(info->streams[i].video_config);
      break;
    case AVMEDIA_TYPE_AUDIO:
      if(info->streams[i].audio_config->description_size > 0)
        free(info->streams[i].audio_config->description);
      free(info->streams[i].audio_config);
      break;
    case AVMEDIA_TYPE_SUBTITLE:
      free(info->streams[i].subtitle_config);
      break;
    case AVMEDIA_TYPE_ATTACHMENT:
      free(info->streams[i].attachment_config);
      break;
    default:
      break;
    }
  }

  free(info->streams);
  free(info->chapters);
  free(info);
}
