#ifndef FFMPEG_CODEC_CONFIG_H
#define FFMPEG_CODEC_CONFIG_H

#include <libavcodec/avcodec.h>
#include <stdint.h>

typedef struct {
  char codec[256]; // The codec string
  int coded_width;
  int coded_height;
  // Optional: description data (extradata) and its size.
  uint8_t *description;
  int description_size;

  enum AVColorRange color_range;
  enum AVColorPrimaries color_primaries;
  enum AVColorTransferCharacteristic color_trc;
  enum AVColorSpace color_space;
  enum AVChromaLocation chroma_location;
} VideoDecoderConfig;

typedef struct {
    char codec[256];
    int32_t sample_rate;
    int32_t num_channels;

    uint8_t *description;
    int32_t description_size;
} AudioDecoderConfig;

typedef struct {
    int subtitle_header_size;
    uint8_t *subtitle_header;
} ASSSubtitleConfig;

VideoDecoderConfig *video_stream_to_config(AVCodecParameters *codecpar);
AudioDecoderConfig *audio_stream_to_config(AVCodecParameters *codecpar);

#endif
