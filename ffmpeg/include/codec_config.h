#ifndef FFMPEG_CODEC_CONFIG_H
#define FFMPEG_CODEC_CONFIG_H

#include <libavcodec/avcodec.h>
#include <stdint.h>

typedef struct {
    char codec[256];
    int32_t coded_width;
    int32_t coded_height;
    uint8_t *description;
    int32_t description_size;
    int32_t color_range;
    int32_t color_primaries;
    int32_t color_trc;
    int32_t color_space;
} VideoDecoderConfig;

typedef struct {
    char codec[256];
    int32_t sample_rate;
    int32_t num_channels;
    uint8_t *description;
    int32_t description_size;
} AudioDecoderConfig;

VideoDecoderConfig *video_stream_to_config(AVCodecParameters *codecpar);
AudioDecoderConfig *audio_stream_to_config(AVCodecParameters *codecpar);

#endif
