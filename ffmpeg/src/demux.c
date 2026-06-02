/*
 * demux.c — File opening, stream discovery, metadata extraction, chapter
 * parsing, and the main demux loop (get_data).
 */
#include "context.h"
#include "events.h"
#include "codec_config.h"
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/dict.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Event bridge functions */
extern int64_t bridge_io_read(uint8_t *buf, int buf_size);
extern int64_t bridge_io_seek(int64_t offset, int whence);
extern int bridge_query_stream(int stream_index);

/* decode.c */
int decode_packet(FFmpegContext *ctx, int stream_index, AVPacket *pkt,
                  int64_t ts_js, int64_t dur_js, int is_supported);

#define METADATA_MAX_ENTRIES 64

static int custom_read(void *opaque, uint8_t *buf, int buf_size) {
    int result = (int)bridge_io_read(buf, buf_size);
    if (result == -1) {
        fprintf(stderr, "Error fetching video data\n");
        return AVERROR(EIO);
    }
    if (result == -2) {
        fprintf(stderr, "Reached EOF during read\n");
        return AVERROR_EOF;
    }
    return result;
}

static int64_t custom_seek(void *opaque, int64_t offset, int whence) {
    int64_t result = bridge_io_seek(offset, whence);
    fprintf(stderr, "Seek to %lld, result %lld\n", (long long)offset,
            (long long)result);
    if (result < 0)
        fprintf(stderr, "Error seeking video data\n");
    return result;
}

int ctx_alloc_io(FFmpegContext *ctx, int buffer_size) {
    memset(ctx, 0, sizeof(*ctx));

    uint8_t *buf = av_malloc(buffer_size);
    if (!buf) {
        fprintf(stderr, "Error allocating IO buffer\n");
        return -1;
    }

    AVIOContext *avio = avio_alloc_context(
        buf, buffer_size, 0, NULL, custom_read, NULL, custom_seek);
    if (!avio) {
        fprintf(stderr, "Error allocating AVIO context\n");
        av_free(buf);
        return -1;
    }

    ctx->fmt_ctx = avformat_alloc_context();
    if (!ctx->fmt_ctx) {
        avio_context_free(&avio);
        return -1;
    }

    ctx->fmt_ctx->pb = avio;
    ctx->fmt_ctx->flags |= AVFMT_FLAG_GENPTS | AVFMT_FLAG_CUSTOM_IO;
    avio->direct   = 0;
    avio->seekable = AVIO_SEEKABLE_NORMAL;

    ctx->frame     = av_frame_alloc();
    ctx->sws_frame = av_frame_alloc();
    ctx->swr_frame = av_frame_alloc();
    ctx->pkt       = av_packet_alloc();

    return 0;
}

void ctx_init_fields(FFmpegContext *ctx, int thread_count,
                            const enum AVPixelFormat *fmts) {
    ctx->supported_pix_fmts = fmts;
    ctx->thread_count       = thread_count;

    for (int i = 0; i < MAX_STREAMS; i++) {
        ctx->codec_ctx[i] = NULL;
        ctx->sws_ctx[i]   = NULL;
        ctx->swr_ctx[i]   = NULL;
    }
}

static void emit_metadata(MetadataEvent *ev, char **keys, char **values,
                          int count) {
    ev->keys   = (uint32_t)(uintptr_t)keys;
    ev->values = (uint32_t)(uintptr_t)values;
    ev->count  = count;
    bridge_emit_file_info(ev);
}

static int extract_metadata(AVDictionary *dict, char ***keys_out,
                            char ***values_out) {
    char **keys   = malloc(sizeof(char *) * METADATA_MAX_ENTRIES);
    char **values = malloc(sizeof(char *) * METADATA_MAX_ENTRIES);
    if (!keys || !values) {
        free(keys);
        free(values);
        return 0;
    }

    int count = 0;
    AVDictionaryEntry *tag = NULL;
    while ((tag = av_dict_get(dict, "", tag, AV_DICT_IGNORE_SUFFIX))) {
        if (count >= METADATA_MAX_ENTRIES) break;
        keys[count]   = strdup(tag->key);
        values[count] = strdup(tag->value);
        count++;
    }
    *keys_out   = keys;
    *values_out = values;
    return count;
}

static void free_metadata(char **keys, char **values, int count) {
    for (int i = 0; i < count; i++) {
        free(keys[i]);
        free(values[i]);
    }
    free(keys);
    free(values);
}

static int open_codec(FFmpegContext *ctx, AVStream *stream, int index,
                      int thread_count) {
    const AVCodec *codec = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!codec) {
        fprintf(stderr, "Error: unsupported codec for stream %d\n", index);
        return -1;
    }

    ctx->codec_ctx[index] = avcodec_alloc_context3(codec);
    if (!ctx->codec_ctx[index]) {
        fprintf(stderr, "Error allocating codec context for stream %d\n",
                index);
        return -1;
    }

    ctx->codec_ctx[index]->thread_count = thread_count;
    ctx->codec_ctx[index]->thread_type  = FF_THREAD_FRAME | FF_THREAD_SLICE;

    if (avcodec_parameters_to_context(ctx->codec_ctx[index],
                                      stream->codecpar) < 0) {
        fprintf(stderr, "Error copying codec parameters for stream %d\n",
                index);
        return -1;
    }

    ctx->codec_ctx[index]->err_recognition = 0;
    ctx->codec_ctx[index]->flags |=
        AV_CODEC_FLAG_OUTPUT_CORRUPT | AV_CODEC_FLAG2_FAST;

    if (avcodec_open2(ctx->codec_ctx[index], codec, NULL) < 0) {
        fprintf(stderr, "Error opening codec for stream %d\n", index);
        return -1;
    }

    return 0;
}

static double stream_duration(AVFormatContext *fmt_ctx, AVStream *stream) {
    double dur = (double)fmt_ctx->duration / AV_TIME_BASE;
    if (stream->duration != AV_NOPTS_VALUE)
        dur = stream->duration * av_q2d(stream->time_base);
    return dur;
}

static void submit_stream_config(FFmpegContext *ctx, AVStream *stream,
                                 int index, double duration) {

    if (stream->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
        VideoDecoderConfig *cfg = video_stream_to_config(stream->codecpar);
        if (!cfg) return;

        VideoConfigEvent ev = {
            .stream_index      = index,
            .coded_width       = cfg->coded_width,
            .coded_height      = cfg->coded_height,
            .description       = (uint32_t)(uintptr_t)cfg->description,
            .description_size  = cfg->description_size,
            .duration          = duration,
            .color_range     = cfg->color_range,
            .color_space     = cfg->color_space,
            .color_primaries = cfg->color_primaries,
            .color_transfer   = cfg->color_trc,
        };
        strncpy(ev.codec, cfg->codec, sizeof(ev.codec) - 1);
        bridge_emit_video_config(&ev);
        free(cfg);

    } else if (stream->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
        AudioDecoderConfig *cfg = audio_stream_to_config(stream->codecpar);
        if (!cfg) return;

        AudioConfigEvent ev = {
            .stream_index     = index,
            .sample_rate      = cfg->sample_rate,
            .num_channels     = cfg->num_channels,
            .description      = (uint32_t)(uintptr_t)cfg->description,
            .description_size = cfg->description_size,
            .duration         = duration,
        };
        strncpy(ev.codec, cfg->codec, sizeof(ev.codec) - 1);
        bridge_emit_audio_config(&ev);
        free(cfg);

    } else if (stream->codecpar->codec_type == AVMEDIA_TYPE_SUBTITLE) {
        SubtitleConfigEvent ev = {
            .stream_index = index,
            .duration     = (int32_t)duration,
            .header_ptr   = (uint32_t)(uintptr_t)ctx->codec_ctx[index]->subtitle_header,
            .header_size  = (int32_t)ctx->codec_ctx[index]->subtitle_header_size,
        };
        bridge_emit_subtitle_config(&ev);
    }
}

int ctx_open_file(FFmpegContext *ctx) {
    if (avformat_open_input(&ctx->fmt_ctx, "", NULL, NULL) != 0) {
        fprintf(stderr, "Error opening input stream\n");
        return -1;
    }

    if (avformat_find_stream_info(ctx->fmt_ctx, NULL) < 0) {
        fprintf(stderr, "Error finding stream info\n");
        return -1;
    }

    /* File-level metadata */
    char **file_keys, **file_values;
    int file_count = extract_metadata(ctx->fmt_ctx->metadata,
                                      &file_keys, &file_values);
    MetadataEvent mev = {
        .stream_index = -1,
        .keys   = (uint32_t)(uintptr_t)file_keys,
        .values = (uint32_t)(uintptr_t)file_values,
        .count  = file_count,
    };
    bridge_emit_file_info(&mev);
    free_metadata(file_keys, file_values, file_count);

    av_dump_format(ctx->fmt_ctx, 0, "", 0);

    /* Pre-allocate metadata arrays for reuse */
    char **stream_keys   = malloc(sizeof(char *) * METADATA_MAX_ENTRIES);
    char **stream_values = malloc(sizeof(char *) * METADATA_MAX_ENTRIES);

    for (int i = 0; i < ctx->fmt_ctx->nb_streams; i++) {
        AVStream *stream = ctx->fmt_ctx->streams[i];
        if (!stream || !stream->codecpar) continue;

        if (stream->codecpar->codec_type == AVMEDIA_TYPE_ATTACHMENT) {
            int count = extract_metadata(stream->metadata,
                                         &stream_keys, &stream_values);
            AttachmentEvent aev = {
                .keys      = (uint32_t)(uintptr_t)stream_keys,
                .values    = (uint32_t)(uintptr_t)stream_values,
                .count     = count,
                .data      = (uint32_t)(uintptr_t)stream->codecpar->extradata,
                .data_size = stream->codecpar->extradata_size,
            };
            bridge_emit_attachment(&aev);
            free_metadata(stream_keys, stream_values, count);
            continue;
        }

        if (stream->codecpar->codec_type != AVMEDIA_TYPE_VIDEO &&
            stream->codecpar->codec_type != AVMEDIA_TYPE_AUDIO &&
            stream->codecpar->codec_type != AVMEDIA_TYPE_SUBTITLE) {
            continue;
        }

        if (open_codec(ctx, stream, i, ctx->thread_count) < 0)
            return -1;

        double duration = stream_duration(ctx->fmt_ctx, stream);
        submit_stream_config(ctx, stream, i, duration);

        /* Per-stream metadata */
        int count = extract_metadata(stream->metadata,
                                     &stream_keys, &stream_values);
        mev.stream_index = i;
        mev.keys   = (uint32_t)(uintptr_t)stream_keys;
        mev.values = (uint32_t)(uintptr_t)stream_values;
        mev.count  = count;
        bridge_emit_file_info(&mev);
        free_metadata(stream_keys, stream_values, count);
    }

    free(stream_keys);
    free(stream_values);

    /* Chapters */
    for (unsigned int i = 0; i < ctx->fmt_ctx->nb_chapters; i++) {
        AVChapter *ch = ctx->fmt_ctx->chapters[i];
        char **ch_keys, **ch_values;
        int count = extract_metadata(ch->metadata, &ch_keys, &ch_values);

        int64_t start_js = av_rescale_q(ch->start, ch->time_base,
                                        (AVRational){1, 1000000});
        int64_t end_js   = av_rescale_q(ch->end, ch->time_base,
                                        (AVRational){1, 1000000});

        ChapterInfoEvent cev = {
            .chapter_index = (int32_t)i,
            .start_js      = start_js,
            .end_js        = end_js,
            .keys          = (uint32_t)(uintptr_t)ch_keys,
            .values        = (uint32_t)(uintptr_t)ch_values,
            .count         = count,
        };
        bridge_emit_chapter_info(&cev);
        free_metadata(ch_keys, ch_values, count);
    }

    fprintf(stderr, "Demuxing initialized successfully with %d streams\n",
            ctx->fmt_ctx->nb_streams);
    return 0;
}

int ctx_get_data(FFmpegContext *ctx) {
    int ret = av_read_frame(ctx->fmt_ctx, ctx->pkt);
    if (ret < 0) {
        fprintf(stderr, "Error reading frame: %s\n", av_err2str(ret));
        av_packet_unref(ctx->pkt);
        return (ret == AVERROR_EOF) ? RESULT_EOF : RESULT_ERR_GENERIC;
    }

    int stream_index = ctx->pkt->stream_index;

    if (!ctx->codec_ctx[stream_index]) {
        av_packet_unref(ctx->pkt);
        return RESULT_ERR_GENERIC;
    }

    AVStream *stream = ctx->fmt_ctx->streams[stream_index];
    int64_t ts_js  = av_rescale_q(ctx->pkt->pts, stream->time_base,
                                  (AVRational){1, 1000000});
    int64_t dur_js = av_rescale_q(ctx->pkt->duration, stream->time_base,
                                  (AVRational){1, 1000000});

    int query_result = bridge_query_stream(stream_index);
    if (query_result == -1) {
        av_packet_unref(ctx->pkt);
        return RESULT_ERR_SKIP;
    }

    int result = decode_packet(ctx, stream_index, ctx->pkt, ts_js, dur_js,
                               query_result == 1);
    av_packet_unref(ctx->pkt);
    return result;
}

int ctx_seek_to(FFmpegContext *ctx, double time) {
    if (!(ctx->fmt_ctx->pb->seekable & AVIO_SEEKABLE_NORMAL)) {
        fprintf(stderr, "File is not seekable\n");
        return AVERROR(EIO);
    }

    int64_t target = (int64_t)(time * AV_TIME_BASE);

    if (ctx->fmt_ctx->duration > 0 && target > ctx->fmt_ctx->duration) {
        fprintf(stderr, "Target time %.2f exceeds file duration %.2f\n",
                time, (double)ctx->fmt_ctx->duration / AV_TIME_BASE);
        return AVERROR(EINVAL);
    }

    int ret = avformat_seek_file(ctx->fmt_ctx, -1, INT64_MIN,
                                 target, INT64_MAX,
                                 AVSEEK_FLAG_BACKWARD);
    if (ret < 0) {
        fprintf(stderr, "Seek failed: %s\n", av_err2str(ret));
        return ret;
    }

    for (int i = 0; i < MAX_STREAMS; i++) {
        if (ctx->codec_ctx[i])
            avcodec_flush_buffers(ctx->codec_ctx[i]);
    }

    return 0;
}

void ctx_destroy(FFmpegContext *ctx) {
    if (ctx->fmt_ctx)
        avformat_close_input(&ctx->fmt_ctx);

    for (int i = 0; i < MAX_STREAMS; i++) {
        if (ctx->codec_ctx[i])
            avcodec_free_context(&ctx->codec_ctx[i]);
        if (ctx->sws_ctx[i])
            sws_freeContext(ctx->sws_ctx[i]);
        if (ctx->swr_ctx[i])
            swr_free(&ctx->swr_ctx[i]);
    }

    if (ctx->frame)     av_frame_free(&ctx->frame);
    if (ctx->sws_frame) av_frame_free(&ctx->sws_frame);
    if (ctx->swr_frame) av_frame_free(&ctx->swr_frame);
    if (ctx->pkt)       av_packet_free(&ctx->pkt);
}
