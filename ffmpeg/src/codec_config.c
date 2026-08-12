/*
 * codec_config.c — Build WebCodecs-compatible codec strings from FFmpeg
 * AVCodecParameters. Converts FFmpeg codec IDs to WebCodecs codec strings
 * (avc1, hvc1, vp09, av01, mp4a, opus, flac, vorbis, mp3).
 */
#include "codec_config.h"
#include <libavcodec/avcodec.h>
#include <libavutil/pixdesc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned int reverse_bits(unsigned int val) {
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

AudioDecoderConfig *audio_stream_to_config(AVCodecParameters *codecpar) {
    const char *codecString = avcodec_get_name(codecpar->codec_id);
    AudioDecoderConfig *ret = calloc(1, sizeof(AudioDecoderConfig));
    if (!ret)
        return NULL;

    ret->sample_rate   = codecpar->sample_rate;
    ret->num_channels  = codecpar->ch_layout.nb_channels;
    uint8_t *extradata = codecpar->extradata;

    if (strcmp(codecString, "flac") == 0) {
        strcpy(ret->codec, "flac");
        ret->description      = extradata;
        ret->description_size = codecpar->extradata_size;
    } else if (strcmp(codecString, "mp3") == 0) {
        strcpy(ret->codec, "mp3");
    } else if (strcmp(codecString, "aac") == 0) {
        switch (codecpar->profile) {
        case 1:  strcpy(ret->codec, "mp4a.40.2");  break;
        case 4:  strcpy(ret->codec, "mp4a.40.5");  break;
        case 28: strcpy(ret->codec, "mp4a.40.29"); break;
        default: strcpy(ret->codec, "mp4a.40.2");  break;
        }
        if (codecpar->extradata_size > 0) {
            ret->description      = extradata;
            ret->description_size = codecpar->extradata_size;
        }
    } else if (strcmp(codecString, "opus") == 0) {
        strcpy(ret->codec, "opus");
    } else if (strcmp(codecString, "vorbis") == 0) {
        strcpy(ret->codec, "vorbis");
        ret->description      = extradata;
        ret->description_size = codecpar->extradata_size;
    } else {
      fprintf(stderr, "Unsupported audio codec: %s\n", codecString);
      strcpy(ret->codec, codecString);
    }

    return ret;
}

VideoDecoderConfig *video_stream_to_config(AVCodecParameters *codecpar) {
    const char *codecString = avcodec_get_name(codecpar->codec_id);
    VideoDecoderConfig *ret = calloc(1, sizeof(VideoDecoderConfig));
    if (!ret)
        return NULL;

    ret->coded_width  = codecpar->width;
    ret->coded_height = codecpar->height;
    ret->color_range     = codecpar->color_range;
    ret->color_primaries = codecpar->color_primaries;
    ret->color_trc       = codecpar->color_trc;
    ret->color_space     = codecpar->color_space;

    const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(codecpar->format);
    uint8_t *extradata   = codecpar->extradata;
    int      profile     = codecpar->profile;
    int      level       = codecpar->level;
    char     temp[32];

    if (strcmp(codecString, "av1") == 0) {
        strcpy(ret->codec, "av1");

        if (profile < 0) profile = 0;
        temp[0] = '\0';
        sprintf(temp, ".%d", profile);
        strcat(ret->codec, temp);

        if (level < 0) level = 0;
        temp[0] = '\0';
        sprintf(temp, (level < 10) ? ".0%d" : ".%d", level);
        strcat(ret->codec, temp);
        strcat(ret->codec, "M");

        int bitDepth = desc->comp->depth;
        temp[0] = '\0';
        sprintf(temp, (bitDepth < 10) ? ".0%d" : ".%d", bitDepth);
        strcat(ret->codec, temp);

    } else if (strcmp(codecString, "h264") == 0) {
        strcpy(ret->codec, "avc1");

        if (extradata && codecpar->extradata_size >= 8 &&
            (extradata[0] | extradata[1] | extradata[2]) == 0 &&
            extradata[3] == 1 && (extradata[4] & 0x1F) == 7) {
            strcat(ret->codec, ".");
            for (int i = 5; i <= 7; i++) {
                char hex[3];
                sprintf(hex, "%02x", extradata[i]);
                strcat(ret->codec, hex);
            }
        } else {
            if (profile < 0) profile = 77;
            int profileB = profile & 0xFF;
            temp[0] = '\0';
            sprintf(temp, ".%02x", profileB);
            strcat(ret->codec, temp);

            int constraints = 0;
            if (profile & 0x100) {
                if (profileB == 66)      constraints = 0xE0;
                else if (profileB == 77) constraints = 0x60;
                else if (profileB == 88) constraints = 0x20;
                else { free(ret); return NULL; }
            }
            temp[0] = '\0';
            sprintf(temp, "%02x", constraints);
            strcat(ret->codec, temp);

            if (level < 0) level = 10;
            temp[0] = '\0';
            sprintf(temp, "%02x", level);
            strcat(ret->codec, temp);
        }

        if (extradata && codecpar->extradata_size > 0) {
            ret->description = malloc(codecpar->extradata_size);
            if (ret->description) {
                memcpy(ret->description, extradata, codecpar->extradata_size);
                ret->description_size = codecpar->extradata_size;
            }
        }

    } else if (strcmp(codecString, "hevc") == 0) {
        if (extradata && codecpar->extradata_size > 12) {
            strcpy(ret->codec, "hvc1.");

            uint8_t profileSpace = extradata[1] >> 6;
            switch (profileSpace) {
            case 1: strcat(ret->codec, "A"); break;
            case 2: strcat(ret->codec, "B"); break;
            case 3: strcat(ret->codec, "C"); break;
            default: break;
            }

            temp[0] = '\0';
            sprintf(temp, "%d.", extradata[1] & 0x1F);
            strcat(ret->codec, temp);

            unsigned int profileCompat = *(unsigned int *)(extradata + 2);
            unsigned int rev = reverse_bits(profileCompat);
            temp[0] = '\0';
            sprintf(temp, "%x.", rev);
            strcat(ret->codec, temp);

            int tierFlag = (extradata[1] & 0x20) >> 5;
            strcat(ret->codec, tierFlag == 0 ? "L" : "H");

            temp[0] = '\0';
            sprintf(temp, "%d", extradata[12]);
            strcat(ret->codec, temp);

            for (int i = 11; i >= 6; i--) {
                if (extradata[i] || (i < 11)) {
                    temp[0] = '\0';
                    sprintf(temp, ".%x", extradata[i]);
                    strcat(ret->codec, temp);
                }
            }

            ret->description_size = codecpar->extradata_size;
            ret->description = malloc(ret->description_size);
            if (ret->description)
                memcpy(ret->description, extradata, ret->description_size);
        } else {
            if (profile < 0) profile = 0;
            if (level   < 0) level   = 0;
            sprintf(ret->codec, "hev1.%d.4.L%d.B01", profile, level);
        }

    } else if (strcmp(codecString, "vp8") == 0) {
        strcpy(ret->codec, "vp08");

    } else if (strcmp(codecString, "vp9") == 0) {
        strcpy(ret->codec, "vp09.");

        temp[0] = '\0';
        sprintf(temp, (profile < 0 ? "00" : (profile < 10 ? "0%d" : "%d")),
                profile < 0 ? 0 : profile);
        strcat(ret->codec, temp);
        strcat(ret->codec, ".");

        temp[0] = '\0';
        sprintf(temp, (level < 0 ? "10" : (level < 10 ? "0%d" : "%d")),
                level < 0 ? 10 : level);
        strcat(ret->codec, temp);
        strcat(ret->codec, ".");

        int bitDepth = desc->comp->depth;
        if (!bitDepth) bitDepth = 8;
        temp[0] = '\0';
        sprintf(temp, (bitDepth < 10 ? "0%d" : "%d"), bitDepth);
        strcat(ret->codec, temp);
        strcat(ret->codec, ".");

        int subX = desc->log2_chroma_w;
        int subY = desc->log2_chroma_h;
        int chromaSubsampling;
        if      (subX > 0 && subY > 0) chromaSubsampling = 1;
        else if (subX > 0 || subY > 0) chromaSubsampling = 2;
        else                           chromaSubsampling = 3;
        temp[0] = '\0';
        sprintf(temp, "0%d", chromaSubsampling);
        strcat(ret->codec, temp);

        strcat(ret->codec, ".1.1.1.0");

    } else {
      fprintf(
          stderr,
          "Unsupported WebCodecs codec: %s (FFmpeg will try software decode)\n",
          codecString);
      strcpy(ret->codec, codecString);
    }

    return ret;
}
