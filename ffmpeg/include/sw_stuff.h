#ifndef SWS_IO
#define SWS_IO

#include "libavutil/frame.h"
#include "libswresample/swresample.h"
#include "libswscale/swscale.h"

int init_sws(SwsContext **sws_ctx, AVFrame *frame,
             enum AVPixelFormat best_fmt);
AVFrame* sws_frame(SwsContext *sws_ctx, AVFrame *frame,
             enum AVPixelFormat best_fmt);


int init_swr(SwrContext **swr_ctx, AVFrame *frame,
             enum AVSampleFormat best_fmt);

AVFrame *swr_frame(SwrContext *swr_ctx, AVFrame *frame,
                   enum AVSampleFormat best_fmt);

#endif
