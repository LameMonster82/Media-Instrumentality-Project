#ifndef FFMPEG_CONTEXT_H
#define FFMPEG_CONTEXT_H

#include "codec_config.h"
#include "libavcodec/avcodec.h"
#include "libavcodec/packet.h"
#include "libavformat/avformat.h"
#include "libavutil/frame.h"
#include "libswresample/swresample.h"
#include "libswscale/swscale.h"
#include <stdint.h>

enum MediaType {
  RESULT_VIDEO = 0,
  RESULT_AUDIO = 1,
  RESULT_SUBTITLE,
  RESULT_PACKET,
};

typedef struct {
  int64_t id;
  double start, end; ///< chapter start/end time in time_base units
  AVDictionary *metadata;
} ChapterInfo;

typedef struct {
  enum AVMediaType type;
  double duration;
  int disposition;
  VideoDecoderConfig *video_config;
  AudioDecoderConfig *audio_config;
  SubtitleConfig *subtitle_config;
  AttachmentConfig *attachment_config;
  AVDictionary *metadata;
} StreamInfo;

typedef struct {
  int64_t duration;
  int64_t start_time;
  int64_t bitrate;

  uint32_t nb_stream_groups;
  uint32_t nb_chapters;
  uint32_t nb_streams;

  AVDictionary *metadata;
  ChapterInfo *chapters;
  StreamInfo *streams;

} FileInfo;

#define RESULT_OK 0 /* data consumed, frame emitted or packet forwarded */
#define RESULT_NEED_MORE 1    /* EAGAIN — call get_data again */
#define RESULT_EOF 2          /* end of file reached */
#define RESULT_RAW_PACKET 10  /* packet was forwarded to WebCodecs decoder */
#define RESULT_ERR_GENERIC -1 /* fatal error */
#define RESULT_ERR_SKIP -3    /* stream not used — skip silently */
#define RESULT_UNREACHABLE -4 /* Unreachable place??? */

#define STREAM_HW_SUPPORT 1
#define STREAM_SW_SUPPORT 0
#define STREAM_UNUSED -1
#define STREAM_NO_SUPPORT -2

typedef struct {
  int32_t width;
  int32_t height;
  int32_t crop_top;
  int32_t crop_bottom;
  int32_t crop_left;
  int32_t crop_right;
  int32_t format;
  int32_t key_frame;
  int32_t pict_type;
  int64_t pts;
  double ts_js;
  int32_t time_base_num;
  int32_t time_base_den;
  int64_t duration;
  double dur_js;
  uintptr_t src_data[8];    /* uint8_t* plane pointers */
  int32_t src_linesize[8]; /* int32_t linesize per plane */
  int32_t color_range;
  int32_t color_space;
  int32_t color_primaries;
  int32_t color_transfer;
  int32_t stream_index;
  int buffer_size;

  // Just for the C side
  AVFrame *frame;
} VideoFrame;

typedef struct {
  int32_t channels;
  int32_t samples;
  int32_t sample_rate;
  uintptr_t src_data[8];
  int32_t linesize;
  int32_t bytes_per_sample;
  double ts_js;
  int32_t stream_index;
  int32_t format;
  int buffer_size;

  // Just for the C side
  AVFrame *frame;
} AudioFrame;

typedef struct {
  int x;
  int y;
  int width;
  int height;
  int nb_colors;
  int64_t pts;
  double ts_js;
  double dur_js;
  uintptr_t src_data[4];    /* uint8_t* plane pointers */
  int32_t src_linesize[4]; /* int32_t linesize per plane */
  int32_t stream_index;
  uint8_t * rgba_buff;

  // Just for the C side
  AVSubtitle *frame;
} SubtitleFrame;

typedef struct {
  int32_t status;
  uint32_t stream_index;
  enum MediaType type;
  VideoFrame *video_frame;
  AudioFrame *audio_frame;

  enum AVSubtitleType subtitle_type;
  SubtitleFrame *subtitle_frame;
  char          *subtitle_text;

  int flags;
  uint8_t *packet_data;
  int packet_size;
  int64_t timestamp;
  int64_t duration;

  AVPacket *packet;
} ReturnType;

typedef struct {
  const enum AVPixelFormat *supported_pix_fmts;
  int thread_count;
  AVFormatContext *fmt_ctx;
  AVCodecContext **codecs;
  SwsContext **sws_ctx;
  int *sws_in_fmt;
  SwrContext **swr_ctx;
  int *swr_in_fmt;
  int *swr_in_rate;
  AVChannelLayout *swr_in_layout;
  uint32_t nb_streams;
  /* An array of nb_streams signaling if a stream is supported or not */
  int32_t *stream_support;
  uint32_t report_timestamp;

  int64_t *last_ts_js;
  int64_t *last_dur_js;

  ReturnType *data_return;
} BridgeContext;

#endif
