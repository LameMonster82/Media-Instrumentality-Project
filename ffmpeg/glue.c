#include "libavutil/log.h"
#include "libavutil/pixfmt.h"
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
#include <libavutil/samplefmt.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

AVFormatContext *formatContext = NULL;
AVCodecContext *codecContext[64];
struct SwsContext *swsContext[64];
struct SwrContext *swrContext[64];
AVFrame *frame = NULL;
AVPacket *packet;
AVSubtitle *subtitle = NULL;

AVFrame *swsFrame = NULL;
AVFrame *swrFrame = NULL;
const enum AVPixelFormat *supported_pix_fmts = NULL;

typedef struct OutFrame {
  int width, height;
  int crop_top, crop_bottom, crop_left, crop_right;
  int format;
  int key_frame;
  int pict_type;
  int64_t pts;
  double ts_js;
  // int ptshi;
  int time_base_num;
  int time_base_den;
  int64_t duration;
  double duration_js;
  size_t data_size;
  uint8_t *data;
} OutFrame;

typedef struct ReturnBuffer {
  OutFrame **ptr;
  int size;
} ReturnBuffer;

typedef struct {
  char codec[256]; // The codec string
  int codedWidth;
  int codedHeight;
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
  char codec[256]; // The codec string
  int sampleRate;
  int numberOfChannels;
  // Optional: description data (extradata) and its size.
  uint8_t *description;
  int description_size;
} AudioDecoderConfig;

typedef struct {
  char *key;
  char *value;
} KeyValuePair;

EM_JS(int, fetch_data, (uint8_t *buf, int buf_size), {
  // console.log("good morning");
  let value = globalThis.fetch_video_data(buf, buf_size);
  // console.log("hi", value);
  return value;
});

EM_JS(int64_t, seek_data, (int64_t offset, int whence), {
  // console.log("good morning");
  let value = globalThis.seek_video_data(offset, whence);
  // console.log("hi", value);
  return value;
});

EM_JS(void, submit_decoded, (int64_t pos), { globalThis.submit_decoded(pos); });

EM_JS(void, submit_video_config,
      (int stream_index, char *codec, int codedWidth, int codedHeight,
       const uint8_t *description, int description_size, double duration,
       enum AVColorRange colorRange, enum AVColorSpace colorSpace,
       enum AVColorPrimaries colorPrimative,
       enum AVColorTransferCharacteristic colorTransfer),
      {
        // Convert C string (UTF8) to JS string
        let codecString = UTF8ToString(codec);
        globalThis.submit_video_config({
          index : stream_index,
          codec : codecString,
          codedHeight : codedHeight,
          codedWidth : codedWidth,
          description : description,
          descriptionSize : description_size,
          duration : duration,
          colorRange : colorRange,
          colorSpace : colorSpace,
          colorPrimative : colorPrimative,
          colorTransfer : colorTransfer,
        });
      });

EM_JS(void, submit_audio_config,
      (int stream_index, char *codec, int sampleRate, int numberOfChannels,
       const uint8_t *description, int description_size, double duration),
      {
        // Convert C string (UTF8) to JS string
        let codecString = UTF8ToString(codec);
        globalThis.submit_audio_config({
          index : stream_index,
          codec : codecString,
          sampleRate : sampleRate,
          numberOfChannels : numberOfChannels,
          description : description,
          descriptionSize : description_size,
          duration : duration
        });
      });

EM_JS(int, is_stream_supported, (int stream_index),
      { return globalThis.is_stream_supported(stream_index); });

EM_JS(int, submit_raw_packet,
      (int stream_index, int flags, double timestamp_js, double duration_js,
       const uint8_t *data, int data_size),
      {
        return globalThis.submit_raw_packet({
          index : stream_index,
          flags : flags,
          timestamp : timestamp_js,
          duration : duration_js,
          dataPtr : data,
          dataSize : data_size
        });
      });

EM_JS(void, submit_video_frame,
      (int width, int height, int crop_top, int crop_bottom, int crop_left,
       int crop_right, int format, int key_frame, enum AVPictureType pict_type,
       int64_t pts, double ts_js, int time_base_num, int time_base_den,
       int64_t duration, double duration_js, uint8_t *src_data,
       uint8_t *src_linesize, enum AVColorRange colorRange,
       enum AVColorSpace colorSpace, enum AVColorPrimaries colorPrimative,
       enum AVColorTransferCharacteristic colorTransfer, int stream_index),
      {
        globalThis.submit_video_frame(
            {width,         height,      crop_top,    crop_bottom,
             crop_left,     crop_right,  format,      key_frame,
             pict_type,     pts,         ts_js,       time_base_num,
             time_base_den, duration,    duration_js, src_data,
             src_linesize,  colorRange,  colorSpace,  colorPrimative,
             colorTransfer, stream_index});
      });

EM_JS(void, submit_audio_frame,
      (int channels, int samples, int sampleRate, uint8_t *data,
       int bytesPerSample, double ts_js, int stream_index),
      {
        globalThis.submit_audio_frame({channels, samples, sampleRate, data,
                                       bytesPerSample, ts_js, stream_index});
      });

EM_JS(void, submit_file_info,
      (int stream_index, char **metadata_keys, char **metadata_values,
       int metadata_count),
      {
        let newMetadata = {};
        for (let i = 0; i < metadata_count; i++) {
          let key = UTF8ToString(HEAP32[(metadata_keys >> 2) + i]);
          let value = UTF8ToString(HEAP32[(metadata_values >> 2) + i]);
          newMetadata[key] = value;
        }

        globalThis.submit_file_info(stream_index, newMetadata);
      });

EM_JS(void, submit_chapter_info,
      (int chapter_index, int64_t start_js, int64_t end_js,
       char **metadata_keys, char **metadata_values, int metadata_count),
      {
        let newMetadata = {};
        for (let i = 0; i < metadata_count; i++) {
          let key = UTF8ToString(HEAP32[(metadata_keys >> 2) + i]);
          let value = UTF8ToString(HEAP32[(metadata_values >> 2) + i]);
          newMetadata[key] = value;
        }

        globalThis.submit_chapter_info(chapter_index, start_js, end_js,
                                       newMetadata);
      });

EM_JS(void, submit_subtitle_config,
      (int stream_index, int duration, uint8_t *header_ptr, int header_size), {
        globalThis.submit_subtitle_config(
            {stream_index, duration, header_ptr, header_size});
      });

EM_JS(void, submit_subtitle_bitmap,
      (int stream_index, uint8_t *data, int data_size, int x, int y, int width,
       int height, uint64_t ts_js, uint64_t dur_js, int coded_width,
       int coded_height),
      {
        globalThis.submit_subtitle_bitmap({stream_index, data, data_size, x, y,
                                           width, height, ts_js, dur_js,
                                           coded_width, coded_height});
      });

EM_JS(void, submit_subtitle_ass,
      (int stream_index, char *dialogChar, int64_t start_time,
       int64_t end_time),
      {
        let dialog = UTF8ToString(dialogChar);
        globalThis.submit_subtitle_ass(
            {stream_index, dialog, start_time, end_time});
      });

EM_JS(void, submit_empty_subtitle, (int stream_index, uint64_t ts_js),
      { globalThis.submit_empty_subtitle(stream_index, ts_js); });

EM_JS(void, submit_attachment,
      (char **metadata_keys, char **metadata_values, int metadata_count,
       uint8_t *data, int data_size),
      {
        let newMetadata = {};
        for (let i = 0; i < metadata_count; i++) {
          let key = UTF8ToString(HEAP32[(metadata_keys >> 2) + i]);
          let value = UTF8ToString(HEAP32[(metadata_values >> 2) + i]);
          newMetadata[key] = value;
        }

        globalThis.submit_attachment(newMetadata, data, data_size);
      });

EM_JS(void, submit_demuxers,
      (char **extensions, char **long_names, char **mime_types, char **names,
       int data_count),
      {
        let newDemuxers = [];
        for (let i = 0; i < data_count; i++) {
          let extension = UTF8ToString(HEAP32[(extensions >> 2) + i]);
          let long_name = UTF8ToString(HEAP32[(long_names >> 2) + i]);
          let mime_type = UTF8ToString(HEAP32[(mime_types >> 2) + i]);
          let name = UTF8ToString(HEAP32[(names >> 2) + i]);

          newDemuxers.push({extension, long_name, mime_type, name})
        }

        globalThis.submit_demuxers(newDemuxers);
      });

EMSCRIPTEN_KEEPALIVE
int custom_read_packet(void *opaque, uint8_t *buf, int buf_size) {
  int result = fetch_data(buf, buf_size);
  if (result == -1) {
    printf("Error fetching video data\n");
    return AVERROR(EIO);
  }
  if (result == -2) {
    printf("Reached EOF\n");
    return AVERROR_EOF;
  }

  return result;
}

EMSCRIPTEN_KEEPALIVE
int custom_write_packet(void *opaque, uint8_t *buf, int buf_size) { return 0; }

EMSCRIPTEN_KEEPALIVE
int64_t custom_seek_packet(void *opaque, int64_t offset, int whence) {
  int64_t result = seek_data(offset, whence);
  printf("Done fetching %lld \n", result);
  if (result < 0)
    printf("Error seeking video data\n");

  return result;
}

// Utility function for reversing 32 bits (used for HEVC)
unsigned int reverse_bits(unsigned int val) {
  unsigned int reversed = 0;
  for (int i = 0; i < 32; i++) {
    reversed |= (val & 1);
    if (i == 31)
      break;
    reversed <<= 1;
    val >>= 1;
  }
  return reversed;
}

AudioDecoderConfig *audioStreamToConfig(AVCodecParameters *codecpar) {
  if (!codecpar)
    return NULL;

  // Get the codec name string for the codec id.
  const char *codecString = avcodec_get_name(codecpar->codec_id);
  // Allocate the config structure.
  AudioDecoderConfig *ret = malloc(sizeof(AudioDecoderConfig));
  if (!ret)
    return NULL;
  memset(ret, 0, sizeof(AudioDecoderConfig));

  ret->sampleRate = codecpar->sample_rate;
  ret->numberOfChannels = codecpar->ch_layout.nb_channels;
  ret->description_size = 0;

  // Keep a local pointer to extradata for convenience.
  uint8_t *extradata = codecpar->extradata;

  // Then convert the actual codec
  if (strcmp(codecString, "flac") == 0) {
    strcpy(ret->codec, "flac");
    ret->description = extradata;
    ret->description_size = codecpar->extradata_size;
  } else if (strcmp(codecString, "mp3") == 0) {
    strcpy(ret->codec, "mp3");
  } else if (strcmp(codecString, "aac") == 0) {
    switch (codecpar->profile) {
    default:
    case 1: // AAC_LOW
      strcpy(ret->codec, "mp4a.40.2");
      break;
    case 4: // AAC_HE
      strcpy(ret->codec, "mp4a.40.5");
      break;
    case 28: // AAC_HE_V2
      strcpy(ret->codec, "mp4a.40.29");
      break;
    }

    if (codecpar->extradata_size > 0) {
      ret->description = extradata;
      ret->description_size = codecpar->extradata_size;
    }
  } else if (strcmp(codecString, "opus") == 0) {
    strcpy(ret->codec, "opus");
  } else if (strcmp(codecString, "vorbis") == 0) {
    strcpy(ret->codec, "vorbis");
    ret->description = extradata;
    ret->description_size = codecpar->extradata_size;
  } else {
    printf("Unsupported codec: %s\n", codecString);
  }

  return ret;
}

/**
 * Convert a FFmpeg video stream to a WebCodecs-style configuration.
 *
 * @param  codecpar   The CodecParameters structure from FFmpeg
 * @return Pointer to a dynamically allocated VideoDecoderConfig structure,
 *         or NULL if conversion fails.
 */
EMSCRIPTEN_KEEPALIVE
VideoDecoderConfig *videoStreamToConfig(AVCodecParameters *codecpar) {

  if (!codecpar)
    return NULL;

  // Get the codec name string for the codec id.
  const char *codecString = avcodec_get_name(codecpar->codec_id);
  // Allocate the config structure.
  VideoDecoderConfig *ret = malloc(sizeof(VideoDecoderConfig));
  if (!ret)
    return NULL;
  memset(ret, 0, sizeof(VideoDecoderConfig));
  ret->codedWidth = codecpar->width;
  ret->codedHeight = codecpar->height;

  // Keep a local pointer to extradata for convenience.
  uint8_t *extradata = codecpar->extradata;

  // For some codecs profile and level are needed.
  int profile = codecpar->profile;
  int level = codecpar->level;

  ret->color_range = codecpar->color_range;
  ret->color_primaries = codecpar->color_primaries;
  ret->color_trc = codecpar->color_trc;
  ret->color_space = codecpar->color_space;

  const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(codecpar->format);

  if (strcmp(codecString, "av1") == 0) {
    // Build an av1 string:
    // av01.<profile>.<level><tier>.<bitDepth>.<monochrome>.<chromaSubsampling>
    strcpy(ret->codec, "av01");

    // <profile>: if profile is unknown, use 0.
    if (profile < 0)
      profile = 0;
    char profileStr[8];
    sprintf(profileStr, ".%d", profile);
    strcat(ret->codec, profileStr);

    // <level> and <tier>: if unknown, use level 0 and tier "M" (as a
    // default/fallback).
    if (level < 0)
      level = 0;
    char levelStr[8];
    if (level < 10)
      sprintf(levelStr, ".0%d", level);
    else
      sprintf(levelStr, ".%d", level);
    strcat(ret->codec, levelStr);
    strcat(ret->codec,
           "M"); // FIXME: May need to adjust tier based on additional data.

    // <bitDepth>
    int bitDepth = desc->comp->depth;
    char bitDepthStr[8];
    if (bitDepth < 10)
      sprintf(bitDepthStr, ".0%d", bitDepth);
    else
      sprintf(bitDepthStr, ".%d", bitDepth);
    strcat(ret->codec, bitDepthStr);

    // Seems to be bugged
    if (false) {
      // <monochrome>
      uint8_t nbComponents = desc->nb_components;
      if (nbComponents < 2)
        strcat(ret->codec, ".1");
      else
        strcat(ret->codec, ".0");

      // <chromaSubsampling>
      int subX = 0, subY = 0, subP = 0;
      if (nbComponents < 2) {
        subX = 1;
        subY = 1;
      } else {
        subX = desc->log2_chroma_w;
        subY = desc->log2_chroma_h;
        // subP is not available via FFmpeg; default to 0.
      }
      char subsamplingStr[8];
      sprintf(subsamplingStr, ".%d%d%d", subX, subY, subP);
      strcat(ret->codec, subsamplingStr);
    }
  } else if (strcmp(codecString, "h264") == 0) {
    // h264 -> avc1: use extradata if valid, else derive from parameters
    strcpy(ret->codec, "avc1");
    if (extradata && codecpar->extradata_size >= 8 &&
        (extradata[0] | extradata[1] | extradata[2]) == 0 &&
        extradata[3] == 1 && (extradata[4] & 0x1F) == 7) {
      strcat(ret->codec, ".");
      // Append bytes 5 to 7 in hexadecimal.
      for (int i = 5; i <= 7; i++) {
        char hexByte[3];
        sprintf(hexByte, "%02x", extradata[i]);
        strcat(ret->codec, hexByte);
      }
    } else {
      // Fallback: use profile, constraints and level.
      if (profile < 0)
        profile = 77; // Default to FF_PROFILE_H264_BASELINE
      int profileB = profile & 0xFF;
      char profileStr[8];
      sprintf(profileStr, ".%02x", profileB);
      strcat(ret->codec, profileStr);

      // Calculate constraints byte.
      int constraints = 0;
      if (profile & 0x100) { // constrained bit is set
        if (profileB == 66) {
          constraints |= 0xE0;
        } else if (profileB == 77) {
          constraints |= 0x60;
        } else if (profileB == 88) {
          constraints |= 0x20;
        } else {
          free(ret);
          return NULL;
        }
      }
      char constraintsStr[8];
      sprintf(constraintsStr, "%02x", constraints);
      strcat(ret->codec, constraintsStr);

      if (level < 0)
        level = 10;
      char levelStr[8];
      sprintf(levelStr, "%02x", level);
      strcat(ret->codec, levelStr);
    }

    // Optionally, if extradata is provided, copy it as description.
    if (extradata && codecpar->extradata_size > 0) {
      ret->description = malloc(codecpar->extradata_size);
      if (ret->description) {
        memcpy(ret->description, extradata, codecpar->extradata_size);
        ret->description_size = codecpar->extradata_size;
      }
    }
  } else if (strcmp(codecString, "hevc") == 0) {
    // HEVC: choose between hvc1 with extradata or a fallback.
    if (extradata && codecpar->extradata_size > 12) {
      strcpy(ret->codec, "hvc1.");
      // Second byte: use upper 2 bits for profile space.
      uint8_t profileSpace = extradata[1] >> 6;
      switch (profileSpace) {
      case 1:
        strcat(ret->codec, "A");
        break;
      case 2:
        strcat(ret->codec, "B");
        break;
      case 3:
        strcat(ret->codec, "C");
        break;
      default:
        break; // do nothing for 0.
      }
      // Append the lower 5 bits of byte 1 as profile id.
      char temp[16];
      sprintf(temp, "%d.", extradata[1] & 0x1F);
      strcat(ret->codec, temp);

      // Get profile compatibility from 4 bytes starting at extradata[2].
      unsigned int profileCompatibility = *(unsigned int *)(extradata + 2);
      unsigned int rev = reverse_bits(profileCompatibility);
      sprintf(temp, "%x.", rev);
      strcat(ret->codec, temp);

      // Tier flag from extradata[1] bit 5.
      int tierFlag = (extradata[1] & 0x20) >> 5;
      if (tierFlag == 0)
        strcat(ret->codec, "L");
      else
        strcat(ret->codec, "H");

      // Level from extradata[12].
      sprintf(temp, "%d", extradata[12]);
      strcat(ret->codec, temp);

      // Append constraints if any.
      // We loop from extradata[11] down to extradata[6] if any nonzero exists.
      for (int i = 11; i >= 6; i--) {
        if (extradata[i] || (i < 11)) {
          sprintf(temp, ".%x", extradata[i]);
          strcat(ret->codec, temp);
        }
      }

      // Set description.
      ret->description_size = codecpar->extradata_size;
      ret->description = malloc(ret->description_size);
      if (ret->description)
        memcpy(ret->description, extradata, ret->description_size);
    } else {
      // Fallback string using profile and level.
      if (profile < 0)
        profile = 0;
      if (level < 0)
        level = 0;
      sprintf(ret->codec, "hev1.%d.4.L%d.B01", profile, level);
    }
  } else if (strcmp(codecString, "vp8") == 0) {
    strcpy(ret->codec, "vp08");
  } else if (strcmp(codecString, "vp9") == 0) {
    // Build vp9 string:
    // vp09.<profile>.<level>.<bitDepth>.<chromaSubsampling>.1.1.1.0
    strcpy(ret->codec, "vp09.");
    char temp[16];
    if (profile < 0) {
      sprintf(temp, "00");
    } else {
      sprintf(temp, (profile < 10) ? "0%d" : "%d", profile);
    }
    strcat(ret->codec, temp);
    strcat(ret->codec, ".");

    if (level < 0) {
      sprintf(temp, "10");
    } else {
      sprintf(temp, (level < 10) ? "0%d" : "%d", level);
    }
    strcat(ret->codec, temp);
    strcat(ret->codec, ".");

    int bitDepth = desc->comp->depth;
    if (bitDepth == 0)
      bitDepth = 8;
    sprintf(temp, (bitDepth < 10) ? "0%d" : "%d", bitDepth);
    strcat(ret->codec, temp);
    strcat(ret->codec, ".");

    // Chroma subsampling – decide based on subsampling logarithmic values.
    int subX = desc->log2_chroma_w;
    int subY = desc->log2_chroma_h;
    int chromaSubsampling = 0;
    if (subX > 0 && subY > 0)
      chromaSubsampling = 1; // YUV420
    else if (subX > 0 || subY > 0)
      chromaSubsampling = 2; // YUV422
    else
      chromaSubsampling = 3; // YUV444
    sprintf(temp, "0%d", chromaSubsampling);
    strcat(ret->codec, temp);

    // Append remaining constant parts.
    strcat(ret->codec, ".1.1.1.0");
  } else {
    fprintf(stderr,
            "Unsupported Web codec: %s. Dont worry. We will see if ffmpeg can "
            "decode it\n",
            codecString);
  }

  // Finally, return the configuration if codec string is set.

  return ret;
}

uint8_t *copy_frame_data_range(const AVFrame *frame, int *out_size) {
  const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(frame->format);
  if (!desc)
    return NULL;

  int size =
      av_image_get_buffer_size(frame->format, frame->width, frame->height, 1);

  // printf("Frame required size is %d \n", size);

  uint8_t *buffer = av_malloc(size);
  if (!buffer) {
    fprintf(stderr, "Can not alloc buffer to copy frame\n");
    return NULL;
  }

  int copyout_size =
      av_image_copy_to_buffer(buffer, size, (const uint8_t *const *)frame->data,
                              (const int *)frame->linesize, frame->format,
                              frame->width, frame->height, 1);

  // printf("Frame size is %d \n", copyout_size);
  *out_size = size;
  if (*out_size < 0)
    return NULL;

  return buffer;
}

void create_out_frame(const AVFrame *frame, int stream_index) {
  // int data_size;
  // uint8_t *data = copy_frame_data_range(frame, &data_size);

  int64_t ts_js =
      av_rescale_q(frame->pts, frame->time_base, (AVRational){1, 1000000});
  int64_t duration_js =
      av_rescale_q(frame->duration, frame->time_base, (AVRational){1, 1000000});

  submit_video_frame(
      frame->width, frame->height, frame->crop_top, frame->crop_bottom,
      frame->crop_left, frame->crop_right, frame->format, -1, frame->pict_type,
      frame->pts, ts_js, frame->time_base.num, frame->time_base.den,
      frame->duration, duration_js, (uint8_t *)frame->data,
      (uint8_t *)frame->linesize, frame->color_range, frame->colorspace,
      frame->color_primaries, frame->color_trc, stream_index);
}

uint8_t *convert_subtitle_bitmap_to_rgba(AVSubtitleRect *rect) {
  if (!rect || rect->type != SUBTITLE_BITMAP) {
    return NULL;
  }

  int width = rect->w;
  int height = rect->h;
  int stride = rect->linesize[0];
  uint8_t *src = rect->data[0];                  // Indexed pixels
  uint32_t *palette = (uint32_t *)rect->data[1]; // ARGB palette

  if (!src || !palette || width <= 0 || height <= 0) {
    return NULL;
  }

  // Allocate RGBA buffer
  uint8_t *rgba = malloc(width * height * 4);
  if (!rgba)
    return NULL;

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

  return rgba;
}

// EMSCRIPTEN_KEEPALIVE is a directive to prevent the function from being
// removed during optimization
EMSCRIPTEN_KEEPALIVE
void init_ffmpeg(int bufferSize, int debugLevel) {
  uint8_t *buf = av_malloc(bufferSize);
  AVIOContext *avioContext = avio_alloc_context(
      buf, bufferSize, 0, NULL, custom_read_packet, NULL, custom_seek_packet);

  // Set up the format context and assign the custom IO context to it
  formatContext = avformat_alloc_context();
  formatContext->pb = avioContext;
  formatContext->flags |= AVFMT_FLAG_GENPTS | AVFMT_FLAG_CUSTOM_IO;
  avioContext->direct = 0;
  avioContext->seekable = AVIO_SEEKABLE_NORMAL;

  av_log_set_level(debugLevel);

  // printf("Size of OutFrame is %zu \n", sizeof(OutFrame));
  // printf("Size of ReturnBuffer is %zu \n", sizeof(ReturnBuffer));

  printf("FFmpeg initialized\n");
}

EMSCRIPTEN_KEEPALIVE
void get_supported_demuxers(void) {
  void *opaque = NULL;
  const AVInputFormat *fmt = NULL;

  char **extensions = malloc(sizeof(char *) * 1024);
  char **long_names = malloc(sizeof(char *) * 1024);
  char **mime_types = malloc(sizeof(char *) * 1024);
  char **names = malloc(sizeof(char *) * 1024);
  int counter = 0;
  while ((fmt = av_demuxer_iterate(&opaque))) {
    if (fmt->extensions != NULL)
      extensions[counter] = strdup(fmt->extensions);
    if (fmt->long_name != NULL)
      long_names[counter] = strdup(fmt->long_name);
    if (fmt->mime_type != NULL)
      mime_types[counter] = strdup(fmt->mime_type);
    if (fmt->name != NULL)
      names[counter] = strdup(fmt->name);
    counter += 1;
  }
  submit_demuxers(extensions, long_names, mime_types, names, counter);
  for (size_t i = 0; i < counter; i++) {
    free(extensions[i]);
    free(long_names[i]);
    free(mime_types[i]);
    free(names[i]);
  }
  free(extensions);
  free(long_names);
  free(mime_types);
  free(names);
}

EMSCRIPTEN_KEEPALIVE
int get_exif() {
  if (avformat_open_input(&formatContext, "", NULL, NULL) != 0) {
    printf("Error opening input stream\n");
    return -1;
  }

  // Find streams in the file
  if (avformat_find_stream_info(formatContext, NULL) < 0) {
    printf("Error finding stream info\n");
    return -1;
  }

  char **metadata_keys = malloc(sizeof(char *) * 64);
  char **metadata_values = malloc(sizeof(char *) * 64);
  int metadata_count = 0;
  AVDictionaryEntry *stream_tag = NULL;
  while ((stream_tag = av_dict_get(formatContext->metadata, "", stream_tag,
                                   AV_DICT_IGNORE_SUFFIX))) {
    printf("  %s=%s\n", stream_tag->key, stream_tag->value);
    metadata_keys[metadata_count] = strdup(stream_tag->key);
    metadata_values[metadata_count] = strdup(stream_tag->value);
    metadata_count += 1;
  }

  submit_file_info(-1, metadata_keys, metadata_values, metadata_count);
  for (size_t i = 0; i < metadata_count; i++) {
    free(metadata_keys[i]);
    free(metadata_values[i]);
  }
  free(metadata_keys);
  free(metadata_values);
  return 0;
}

EMSCRIPTEN_KEEPALIVE
int open_file(int threadCount, const enum AVPixelFormat *fmts) {
  supported_pix_fmts = fmts;
  for (size_t i = 0; i < 64; i++) {
    codecContext[i] = NULL;
    swsContext[i] = NULL;
    swrContext[i] = NULL;
  }

  printf("1\n");

  // Open the input stream
  if (avformat_open_input(&formatContext, "", NULL, NULL) != 0) {
    printf("Error opening input stream\n");
    return -1;
  }

  printf("2\n");

  // Find streams in the file
  if (avformat_find_stream_info(formatContext, NULL) < 0) {
    printf("Error finding stream info\n");
    return -1;
  }

  printf("3\n");

  char **metadata_keys = malloc(sizeof(char *) * 64);
  char **metadata_values = malloc(sizeof(char *) * 64);
  int metadata_count = 0;
  AVDictionaryEntry *stream_tag = NULL;
  while ((stream_tag = av_dict_get(formatContext->metadata, "", stream_tag,
                                   AV_DICT_IGNORE_SUFFIX))) {
    printf("  %s=%s\n", stream_tag->key, stream_tag->value);
    metadata_keys[metadata_count] = strdup(stream_tag->key);
    metadata_values[metadata_count] = strdup(stream_tag->value);
    metadata_count += 1;
    printf("4\n");
  }
  printf("5\n");

  submit_file_info(-1, metadata_keys, metadata_values, metadata_count);
  printf("6\n");

  for (size_t i = 0; i < metadata_count; i++) {
    free(metadata_keys[i]);
    free(metadata_values[i]);
  }

  av_dump_format(formatContext, 0, "", 0);

  frame = av_frame_alloc();
  swsFrame = av_frame_alloc();
  swrFrame = av_frame_alloc();
  packet = av_packet_alloc();
  subtitle = av_mallocz(sizeof(*subtitle));

  for (int i = 0; i < formatContext->nb_streams; i++) {
    // Get codec parameters and find the decoder
    AVStream *stream = formatContext->streams[i];

    if (stream->codecpar->codec_type == AVMEDIA_TYPE_ATTACHMENT) {
      metadata_count = 0;
      stream_tag = NULL;
      printf("Stream #%u:\n", i);
      while ((stream_tag = av_dict_get(stream->metadata, "", stream_tag,
                                       AV_DICT_IGNORE_SUFFIX))) {
        printf("  %s=%s\n", stream_tag->key, stream_tag->value);
        metadata_keys[metadata_count] = strdup(stream_tag->key);
        metadata_values[metadata_count] = strdup(stream_tag->value);
        metadata_count += 1;
      }

      submit_attachment(metadata_keys, metadata_values, metadata_count,
                        stream->codecpar->extradata,
                        stream->codecpar->extradata_size);

      for (size_t i = 0; i < metadata_count; i++) {
        free(metadata_keys[i]);
        free(metadata_values[i]);
      }
    }

    if (!(stream->codecpar->codec_type == AVMEDIA_TYPE_VIDEO ||
          stream->codecpar->codec_type == AVMEDIA_TYPE_AUDIO ||
          stream->codecpar->codec_type == AVMEDIA_TYPE_SUBTITLE)) {
      continue;
    }

    const AVCodec *codec = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!codec) {
      printf("Error: Unsupported codec\n");
      return -1;
    }

    codecContext[i] = avcodec_alloc_context3(codec);
    if (!codecContext[i]) {
      printf("Error allocating codec context\n");
      return -1;
    }

    codecContext[i]->thread_count = threadCount;
    codecContext[i]->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;

    // Initialize the codec context
    if (avcodec_parameters_to_context(codecContext[i], stream->codecpar) < 0) {
      printf("Error copying codec parameters to context\n");
      return -1;
    }

    codecContext[i]->err_recognition =
        0; // Accept all frames, no matter how broken

    codecContext[i]->flags |=
        AV_CODEC_FLAG_OUTPUT_CORRUPT | AV_CODEC_FLAG2_FAST;

    if (avcodec_open2(codecContext[i], codec, NULL) < 0) {
      printf("Error opening codec\n");
      return -1;
    }

    double duration = formatContext->duration / AV_TIME_BASE;
    if (stream->duration != AV_NOPTS_VALUE)
      duration = stream->duration * av_q2d(stream->time_base);

    if (stream->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
      VideoDecoderConfig *vidConfig = videoStreamToConfig(stream->codecpar);
      submit_video_config(i, vidConfig->codec, vidConfig->codedWidth,
                          vidConfig->codedHeight, vidConfig->description,
                          vidConfig->description_size, duration,
                          vidConfig->color_range, vidConfig->color_space,
                          vidConfig->color_primaries, vidConfig->color_trc);
      // if (vidConfig->description_size > 0)
      //     free(vidConfig->description);
      free(vidConfig);
    } else if (stream->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
      AudioDecoderConfig *audioConfig = audioStreamToConfig(stream->codecpar);
      submit_audio_config(i, audioConfig->codec, audioConfig->sampleRate,
                          audioConfig->numberOfChannels,
                          audioConfig->description,
                          audioConfig->description_size, duration);
      // if (audioConfig->description_size > 0)
      //     free(audioConfig->description);
      free(audioConfig);
    } else if (stream->codecpar->codec_type == AVMEDIA_TYPE_SUBTITLE) {
      submit_subtitle_config(i, duration, codecContext[i]->subtitle_header,
                             codecContext[i]->subtitle_header_size);
    }

    metadata_count = 0;
    AVDictionaryEntry *stream_tag = NULL;
    printf("Stream #%u:\n", i);
    while ((stream_tag = av_dict_get(stream->metadata, "", stream_tag,
                                     AV_DICT_IGNORE_SUFFIX))) {
      printf("  %s=%s\n", stream_tag->key, stream_tag->value);
      metadata_keys[metadata_count] = strdup(stream_tag->key);
      metadata_values[metadata_count] = strdup(stream_tag->value);
      metadata_count += 1;
    }

    submit_file_info(i, metadata_keys, metadata_values, metadata_count);
  }

  for (size_t i = 0; i < formatContext->nb_chapters; i++) {
    AVChapter *chapter = formatContext->chapters[i];
    char **chapter_keys = malloc(sizeof(char *) * 64);
    char **chapter_values = malloc(sizeof(char *) * 64);
    metadata_count = 0;
    AVDictionaryEntry *chapter_tag = NULL;
    while ((chapter_tag = av_dict_get(chapter->metadata, "", chapter_tag,
                                      AV_DICT_IGNORE_SUFFIX))) {
      printf("Chapter %zu  %s=%s\n", i, chapter_tag->key, chapter_tag->value);
      chapter_keys[metadata_count] = strdup(chapter_tag->key);
      chapter_values[metadata_count] = strdup(chapter_tag->value);
      metadata_count += 1;
    }

    int64_t start_js = av_rescale_q(chapter->start, chapter->time_base,
                                    (AVRational){1, 1000000});
    int64_t end_js = av_rescale_q(chapter->end, chapter->time_base,
                                  (AVRational){1, 1000000});

    submit_chapter_info(i, start_js, end_js, chapter_keys, chapter_values,
                        metadata_count);

    for (size_t i = 0; i < metadata_count; i++) {
      free(chapter_keys[i]);
      free(chapter_values[i]);
    }
  }

  printf("Demuxing initialized successfully\n");

  free(metadata_keys);
  free(metadata_values);

  return 0;
}
// -1 error
// 0 no output
// 1 output
// 2 Try Again

EMSCRIPTEN_KEEPALIVE
int get_data(void) {
  // Try to decode a frame from the video stream
  int ret = av_read_frame(formatContext, packet);
  if (ret < 0) {
    printf("Error reading frame: %s\n", av_err2str(ret));
    av_packet_unref(packet);dur_js
    if (ret == AVERROR_EOF) {
      return AVERROR_EOF;
    }
    return -1;
  }

  if (codecContext[packet->stream_index] == NULL) {
    av_packet_unref(packet);
    return -1;
  }

  int streamIndex = packet->stream_index;
  AVStream *stream = formatContext->streams[streamIndex];
  int64_t ts_js =
      av_rescale_q(packet->pts, stream->time_base, (AVRational){1, 1000000});
  int64_t dur_js = av_rescale_q(packet->duration, stream->time_base,
                                (AVRational){1, 1000000});

  ret = is_stream_supported(streamIndex);

  if (ret == 1) {
    ret = submit_raw_packet(streamIndex, packet->flags, ts_js, dur_js,
                            packet->data, packet->size);
    av_packet_unref(packet);
    return 3;
  } else if (ret == -1) { // Dont care about this stream rn
    av_packet_unref(packet);
    return 0;
  }

  if (codecContext[streamIndex]->codec_type == AVMEDIA_TYPE_SUBTITLE) {
    bool tryAgain = false;
    while (1) {
      int got_output = -1;
      ret = avcodec_decode_subtitle2(codecContext[streamIndex], subtitle,
                                     &got_output, packet);
      if (ret < 0) {
        fprintf(stderr, "Error decoding subtitle: %s\n", av_err2str(ret));
        return -1;
      }
      if (!got_output) {
        if (tryAgain) {
          av_packet_unref(packet);
          return 1;
        }
        packet->data = NULL;
        packet->size = 0;
        tryAgain = true;
        continue;
      }

      for (unsigned int i = 0; i < subtitle->num_rects; i++) {
        AVSubtitleRect *rect = subtitle->rects[i];
        if (rect) {

          if (rect->type == SUBTITLE_BITMAP) {
            // printf("ts_js: %lld\n", ts_js);
            // printf("dur_js: %lld\n", dur_js);
            // printf("Start Time: %u\n", subtitle->start_display_time);
            // printf("End Time: %u\n", subtitle->end_display_time);
            // printf("Packet PTS: %lld\n", packet->pts);
            // printf("Packet Duration: %lld\n", packet->duration);
            // printf("Subtitle PTS: %lld\n", subtitle->pts);
            // printf("Stream Width: %u\n", stream->codecpar->width);
            // printf("Stream Height: %u\n", stream->codecpar->height);
            // printf("Aspect ratio: %ux%u\n", stream->sample_aspect_ratio.num,
            // stream->sample_aspect_ratio.den);

            uint8_t *pixelData = convert_subtitle_bitmap_to_rgba(rect);

            submit_subtitle_bitmap(streamIndex, pixelData,
                                   rect->w * rect->h * 4, rect->x, rect->y,
                                   rect->w, rect->h, ts_js, dur_js,
                                   codecContext[streamIndex]->coded_width,
                                   codecContext[streamIndex]->coded_height);
            free(pixelData);
          } else if (rect->type == SUBTITLE_ASS) {
            submit_subtitle_ass(streamIndex, rect->ass, ts_js, ts_js + dur_js);
          } else if (rect->type == SUBTITLE_TEXT) {
            printf("  Text: %s\n", rect->text);
          } else {
            printf("Unknown subtitle type\n");
          }
        }
      }

      if (subtitle->num_rects == 0) {
        submit_empty_subtitle(streamIndex, ts_js);
      }

      avsubtitle_free(subtitle);
      break;
    }
    return 0;
  }

  while (true) {
    ret = avcodec_send_packet(codecContext[streamIndex], packet);
    if (ret < 0) {
      fprintf(stderr, "Error sending packet to decoder: %s\n", av_err2str(ret));
      return -1;
    }

    ret = avcodec_receive_frame(codecContext[streamIndex], frame);
    if (ret == AVERROR(EAGAIN)) {
      printf("ret is AVERROR(EAGAIN). Lets go again\n");
      av_packet_unref(packet);
      return 1;
    }

    if (ret == AVERROR_EOF) {
      return 2;
    }

    if (ret < 0) {
      fprintf(stderr, "avcodec_receive_frame (video) returned bad: %s\n",
              av_err2str(ret));
      return -1;
    }

    if (codecContext[streamIndex]->codec_type == AVMEDIA_TYPE_VIDEO) {
      // lastFrameWasBFrame = frame->pict_type == AV_PICTURE_TYPE_B;
      int loss = 0;
      enum AVPixelFormat best_fmt =
          avcodec_find_best_pix_fmt_of_list(supported_pix_fmts, frame->format,
                                            1, // allow lossless match
                                            &loss);
      AVFrame *outFrame = frame;
      if (best_fmt != frame->format) {
        if (!swsContext[streamIndex]) {
          if (best_fmt == AV_PIX_FMT_NONE) {
            printf(
                "No good pix fmt found for conversion, Falling back to RGBA");
            best_fmt = AV_PIX_FMT_RGBA;
          }

          struct SwsContext *c = sws_alloc_context();
          if (c == NULL) {
            printf("Error creating swsContext\n");
            return -1;
          }
          av_opt_set_int(c, "srcw", frame->width, 0);
          av_opt_set_int(c, "srch", frame->height, 0);
          av_opt_set_int(c, "src_format", frame->format, 0);
          av_opt_set_int(c, "dstw", frame->width, 0);
          av_opt_set_int(c, "dsth", frame->height, 0);
          av_opt_set_int(c, "dst_format", best_fmt, 0);
          av_opt_set_int(c, "sws_flags", SWS_POINT, 0);
          av_opt_set_int(c, "threads", 1,
                         0); // codecContext[streamIndex]->thread_count / 2

          if (sws_init_context(c, NULL, NULL) < 0) {
            printf("Error init swsContext\n");
            sws_freeContext(c);
            return -1;
          }

          swsContext[streamIndex] = c;

          swsFrame->format = best_fmt;
          swsFrame->width = frame->width;
          swsFrame->height = frame->height;
          swsFrame->color_range = frame->color_range;
          swsFrame->colorspace = frame->colorspace;
          swsFrame->color_primaries = frame->color_primaries;
          swsFrame->color_trc = frame->color_trc;

          ret = av_frame_get_buffer(swsFrame, 0);
          if (ret < 0) {
            fprintf(stderr,
                    "Could not allocate the video frame data for new format\n");
          }
        }

        // sws_scale(swsContext[streamIndex], (const uint8_t *const
        // *)frame->data, frame->linesize, 0, frame->height, swsFrame->data,
        // swsFrame->linesize);
        sws_scale_frame(swsContext[streamIndex], swsFrame, frame);
        outFrame = swsFrame;
        swsFrame->pts = frame->pts;
        swsFrame->pkt_dts = frame->pkt_dts;
        swsFrame->pict_type = frame->pict_type;
        swsFrame->duration = frame->duration;
        swsFrame->time_base = frame->time_base;
      }

      outFrame->time_base = stream->time_base;

      create_out_frame(outFrame, streamIndex);
      return 0;
    } else if (codecContext[streamIndex]->codec_type == AVMEDIA_TYPE_AUDIO) {
      enum AVSampleFormat outFormat =
          AV_SAMPLE_FMT_FLT; // av_get_packed_sample_fmt(frame->format);
      AVFrame *outFrame = frame;
      if (outFormat != frame->format) {

        if (!swrContext[streamIndex]) {
          // Convert the frame to a desired pixel format
          ret = swr_alloc_set_opts2(&swrContext[streamIndex], &frame->ch_layout,
                                    outFormat, frame->sample_rate,
                                    &frame->ch_layout, frame->format,
                                    frame->sample_rate, 0, NULL);

          if (ret < 0 || swr_init(swrContext[streamIndex]) < 0) {
            printf("Error creating swrContext\n");
            swr_free(&swrContext[streamIndex]);
            return -1;
          }

          if (av_channel_layout_copy(&swrFrame->ch_layout, &frame->ch_layout) <
              0)
            return -1;
          swrFrame->sample_rate = frame->sample_rate;
          swrFrame->format = outFormat;
          swrFrame->nb_samples = frame->nb_samples;

          ret = av_frame_get_buffer(swrFrame, 0);
          if (ret < 0) {
            fprintf(stderr,
                    "Could not allocate the audio frame data for new format\n");
          }
        }

        ret = swr_convert(swrContext[streamIndex], swrFrame->data,
                          swrFrame->nb_samples, (const uint8_t **)frame->data,
                          frame->nb_samples);
        outFrame = swrFrame;
        swrFrame->pts = frame->pts;
      }

      int channels = FFMIN(outFrame->ch_layout.nb_channels, 8);
      submit_audio_frame(channels, outFrame->nb_samples, outFrame->sample_rate,
                         outFrame->data[0], av_get_bytes_per_sample(outFormat),
                         ts_js, streamIndex);

      return 0;
    } else {
      printf("A third, more evil codec type: ");
      switch (codecContext[streamIndex]->codec_type) {
      case AVMEDIA_TYPE_UNKNOWN:
        printf("AVMEDIA_TYPE_UNKNOWN\n");
        break;
      case AVMEDIA_TYPE_VIDEO:
        printf("AVMEDIA_TYPE_VIDEO ???????\n");
        break;
      case AVMEDIA_TYPE_AUDIO:
        printf("AVMEDIA_TYPE_AUDIO ????????\n");
        break;
      case AVMEDIA_TYPE_DATA:
        printf("AVMEDIA_TYPE_DATA\n");
        break;
      case AVMEDIA_TYPE_SUBTITLE:
        printf("AVMEDIA_TYPE_SUBTITLE ???????\n");
        break;
      case AVMEDIA_TYPE_ATTACHMENT:
        printf("AVMEDIA_TYPE_ATTACHMENT\n");
        break;
      case AVMEDIA_TYPE_NB:
        printf("AVMEDIA_TYPE_NB ( Non-Binary??????????? )\n");
        break;
      }

      break;
    }
  }

  av_packet_unref(packet);

  return 0;
}

EMSCRIPTEN_KEEPALIVE
int seek_to(double time) {
  if (!(formatContext->pb->seekable & AVIO_SEEKABLE_NORMAL)) {
    fprintf(stderr, "File is not seekable\n");
    return AVERROR(EIO);
  }

  int64_t target_timestamp_us = (int64_t)(time * AV_TIME_BASE);

  // Optional: prevent seeking beyond EOF
  if (formatContext->duration > 0 &&
      target_timestamp_us > formatContext->duration) {
    fprintf(stderr, "Target time %.2f exceeds file duration %.2f\n", time,
            (double)formatContext->duration / AV_TIME_BASE);
    return AVERROR(EINVAL);
  }

  int ret =
      avformat_seek_file(formatContext, -1, INT64_MIN, target_timestamp_us,
                         INT64_MAX, AVSEEK_FLAG_BACKWARD); // INT64_MAX
  if (ret < 0) {
    fprintf(stderr, "Seek failed: %s\n", av_err2str(ret));
    return ret;
  }

  for (int i = 0; i < 64; i++) {
    if (codecContext[i] != NULL) {
      avcodec_flush_buffers(codecContext[i]);
    }
  }

  return 0;
}
EMSCRIPTEN_KEEPALIVE
void cleanup(void) {
  if (formatContext) {
    avformat_close_input(&formatContext);
  }
  for (size_t i = 0; i < 64; i++) {
    if (codecContext[i] != NULL) {
      avcodec_free_context(&codecContext[i]);
    }
    if (swsContext[i] != NULL) {
      sws_freeContext(swsContext[i]);
    }
    if (swrContext[i] != NULL) {
      swr_free(&swrContext[i]);
    }
  }

  if (frame) {
    av_frame_free(&frame);
  }
  if (swsFrame) {
    av_frame_free(&swsFrame);
  }
  if (swrFrame) {
    av_frame_free(&swrFrame);
  }
  if (packet) {
    av_packet_free(&packet);
  }
}
