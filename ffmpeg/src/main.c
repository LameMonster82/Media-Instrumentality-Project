#include "codec_config.h"
#include <emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavcodec/packet.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "context.h"
#include "io.h"
#include "libavutil/error.h"
#include "libavutil/frame.h"
#include "libswscale/swscale.h"
#include "sw_stuff.h"

EM_JS(void, send_sw_frame, (ReturnType * results),
      { return self.send_sw_frame(results); });

static BridgeContext g_ctx;

EMSCRIPTEN_KEEPALIVE
int init_ffmpeg(int buffer_size, int is_stream, int debug_level,
                const enum AVPixelFormat *fmts, int thread_count) {

  memset(&g_ctx, 0, sizeof(g_ctx));
  g_ctx.supported_pix_fmts = fmts;
  g_ctx.thread_count = thread_count;

  av_log_set_level(debug_level);

  int res = allocate_io(&g_ctx, buffer_size, is_stream);
  if (res < 0) {
    fprintf(stderr, "Error allocating FFmpeg IO\n");
    return res;
  }

  ReturnType *data_return = malloc(sizeof(*data_return));
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
    return NULL;
  }

  FileInfo *info = malloc(sizeof(FileInfo));
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
  g_ctx.codecs = malloc(sizeof(AVCodecContext *) * g_ctx.fmt_ctx->nb_streams);
  g_ctx.sws_ctx = malloc(sizeof(SwsContext *) * g_ctx.fmt_ctx->nb_streams);
  g_ctx.swr_ctx = malloc(sizeof(SwrContext *) * g_ctx.fmt_ctx->nb_streams);
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

    if (type == AVMEDIA_TYPE_ATTACHMENT) {
      continue;
    }

    const AVCodec *codec = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!codec) {
      av_log(NULL, AV_LOG_ERROR, "Failed to find decoder for stream #%u\n", i);
      continue;
    }

    AVCodecContext *ctx = avcodec_alloc_context3(codec);
    if (!ctx) {
      av_log(NULL, AV_LOG_ERROR,
             "Failed to allocate the decoder context for stream #%u\n", i);
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
      continue;
    }

    ret = avcodec_open2(ctx, codec, NULL);
    if (ret < 0) {
      av_log(NULL, AV_LOG_ERROR, "Failed to open decoder for stream #%u\n", i);
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
      ASSSubtitleConfig *config = malloc(sizeof(ASSSubtitleConfig));
      config->subtitle_header_size = ctx->subtitle_header_size;
      config->subtitle_header = ctx->subtitle_header;
      info->streams[i].subtitle_config = config;
    }

    g_ctx.codecs[i] = ctx;
  }

  av_dump_format(g_ctx.fmt_ctx, 0, "", 0);

  return info;
}

EMSCRIPTEN_KEEPALIVE
void set_stream_support(int32_t *stream_support) {
  g_ctx.stream_support = stream_support;
}

VideoFrame *decode_frame(AVFrame *frame, int stream_index,
                         AVRational time_base) {
  int loss, ret;
  enum AVPixelFormat best_fmt = avcodec_find_best_pix_fmt_of_list(
      g_ctx.supported_pix_fmts, frame->format, 0, &loss);

  AVFrame *out_frame = frame;
  if (best_fmt != out_frame->format) {
    if (!g_ctx.sws_ctx[stream_index]) {
      ret = init_sws(&g_ctx.sws_ctx[stream_index], frame, best_fmt);
    }

    // Create a new frame
    out_frame = sws_frame(g_ctx.sws_ctx[stream_index], frame, best_fmt);
    av_frame_free(&frame);
  }

  int64_t pts_js =
      av_rescale_q(out_frame->pts, time_base, (AVRational){1, 1000000});
  int64_t dur_js =
      av_rescale_q(out_frame->duration, time_base, (AVRational){1, 1000000});

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

  simple_frame->frame = out_frame;

  for (int i = 0; i < 8; i++) {
    simple_frame->src_data[i] = (uint32_t)(uintptr_t)out_frame->data[i];
    simple_frame->src_linesize[i] = out_frame->linesize[i];
  }

  return simple_frame;
}

EMSCRIPTEN_KEEPALIVE
void cleanup_video_frame(VideoFrame *simple_frame) {
  av_frame_free(&simple_frame->frame);
  free(simple_frame);
}

AudioFrame *decode_audio(AVFrame *frame, int stream_index, double ts_js) {

  int ret;
  enum AVSampleFormat out_format =
      AV_SAMPLE_FMT_FLT; // av_get_packed_sample_fmt(frame->format);

  AVFrame *out_frame = frame;
  if (out_format != frame->format) {

    if (!g_ctx.swr_ctx[stream_index]) {
      ret = init_swr(&g_ctx.swr_ctx[stream_index], frame, out_format);
    }

    out_frame = swr_frame(g_ctx.swr_ctx[stream_index], frame, out_format);
    av_frame_free(&frame);
  }

  int channels = FFMIN(out_frame->ch_layout.nb_channels, 8);

  AudioFrame *simple_frame = malloc(sizeof(*simple_frame));

  simple_frame->channels = channels;
  simple_frame->samples = out_frame->nb_samples;
  simple_frame->sample_rate = out_frame->sample_rate;
  simple_frame->data = (uint32_t)(uintptr_t)out_frame->data[0];
  simple_frame->bytes_per_sample = av_get_bytes_per_sample(out_format);
  simple_frame->ts_js = ts_js;
  simple_frame->stream_index = stream_index;

  simple_frame->frame = frame;

  return simple_frame;
}

EMSCRIPTEN_KEEPALIVE
void cleanup_audio_frame(AudioFrame *simple_frame) {
  av_frame_free(&simple_frame->frame);
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

  g_ctx.data_return->status = RESULT_ERR_GENERIC;

  if (ret < 0) {
    fprintf(stderr, "Error reading frame: %s\n", av_err2str(ret));
    av_packet_free(&packet);
    if (ret == AVERROR_EOF) {
      g_ctx.data_return->status = RESULT_EOF;
      return g_ctx.data_return;
    }
    return g_ctx.data_return;
  }

  g_ctx.data_return->stream_index = packet->stream_index;
  g_ctx.data_return->packet_data = packet->data;
  g_ctx.data_return->packet_size = packet->size;

  int stream_index = packet->stream_index;

  if (g_ctx.codecs[stream_index] == NULL) {
    av_packet_free(&packet);
    g_ctx.data_return->status = RESULT_ERR_SKIP;
    return g_ctx.data_return;
  }

  AVStream *stream = g_ctx.fmt_ctx->streams[stream_index];
  AVCodecContext *ctx = g_ctx.codecs[stream_index];
  enum AVMediaType type = stream->codecpar->codec_type;

  int64_t ts_js =
      av_rescale_q(packet->pts, stream->time_base, (AVRational){1, 1000000});
  int64_t dur_js = av_rescale_q(packet->duration, stream->time_base,
                                (AVRational){1, 1000000});

  if (g_ctx.stream_support[stream_index] == STREAM_HW_SUPPORT) {
    g_ctx.data_return->status = RESULT_RAW_PACKET;
    g_ctx.data_return->type = RESULT_PACKET;
    return g_ctx.data_return;
  } else if (g_ctx.stream_support[stream_index] ==
             STREAM_NO_SUPPORT) { // Dont care about this stream rn
    g_ctx.data_return->status = RESULT_ERR_SKIP;
    av_packet_free(&packet);
    return g_ctx.data_return;
  }

  ret = avcodec_send_packet(ctx, packet);
  if (ret < 0) {
    fprintf(stderr, "Error sending packet to decoder: %s\n", av_err2str(ret));
    av_packet_free(&packet);
    g_ctx.data_return->status = RESULT_ERR_GENERIC;
    return g_ctx.data_return;
  }

  AVFrame *frame = NULL;

  while (ret >= 0) {
    ret = avcodec_receive_frame(ctx, frame);

    if (ret == AVERROR_EOF) {
      g_ctx.data_return->status = RESULT_EOF;
      break;
    } else if (ret == AVERROR(EAGAIN)) {
      g_ctx.data_return->status = RESULT_NEED_MORE;
      break;
    } else if (ret < 0) {
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
      AudioFrame *final_frame =
          decode_audio(frame, stream_index, ts_js);

      g_ctx.data_return->status = RESULT_OK;
      g_ctx.data_return->type = RESULT_AUDIO;
      g_ctx.data_return->audio_frame = final_frame;
    } else {
      fprintf(stderr, "Unknown media type, skipping\n");
      continue;
    }

    send_sw_frame(g_ctx.data_return);
  }

  av_packet_free(&packet);

  //g_ctx.data_return->status = RESULT_UNREACHABLE;

  return g_ctx.data_return;
}

EMSCRIPTEN_KEEPALIVE
void cleanup_packet(AVPacket *packet) {
  av_packet_free(&packet);
}

EMSCRIPTEN_KEEPALIVE
void cleanup_info(FileInfo *info) {
  int i;
  for (i = 0; i < info->nb_streams; i++) {
    enum AVMediaType type = info->streams[i].type;
    switch (type) {

    case AVMEDIA_TYPE_VIDEO:
      free(info->streams[i].video_config);
      break;
    case AVMEDIA_TYPE_AUDIO:
      free(info->streams[i].audio_config);
      break;
    case AVMEDIA_TYPE_SUBTITLE:
      free(info->streams[i].subtitle_config);
      break;
    default:
      break;
    }
  }

  free(info->streams);
  free(info->chapters);
  free(info);
}
