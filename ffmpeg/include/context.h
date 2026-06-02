#ifndef FFMPEG_CONTEXT_H
#define FFMPEG_CONTEXT_H

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

#define MAX_STREAMS 64

typedef struct FFmpegContext {
    AVFormatContext *fmt_ctx;
    AVCodecContext *codec_ctx[MAX_STREAMS];
    struct SwsContext *sws_ctx[MAX_STREAMS];
    struct SwrContext *swr_ctx[MAX_STREAMS];
    AVFrame *frame;
    AVFrame *sws_frame;
    AVFrame *swr_frame;
    AVPacket *pkt;
    AVSubtitle subtitle;
    const enum AVPixelFormat *supported_pix_fmts;
    int thread_count;
} FFmpegContext;

int ctx_alloc_io(FFmpegContext *ctx, int buffer_size);
void ctx_init_fields(FFmpegContext *ctx, int thread_count,
                    const enum AVPixelFormat *fmts);
int ctx_open_file(FFmpegContext *ctx);
int ctx_get_data(FFmpegContext *ctx);
int ctx_seek_to(FFmpegContext *ctx, double time);
void ctx_destroy(FFmpegContext *ctx);

#endif
