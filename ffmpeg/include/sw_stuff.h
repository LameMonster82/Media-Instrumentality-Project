#ifndef SWS_IO
#define SWS_IO

#include "context.h"
#include "libavutil/frame.h"

int init_sws(SwsInfo *info, AVFrame *frame,
             enum AVPixelFormat best_fmt);
AVFrame* sws_frame(SwsInfo *info, AVFrame *frame,
             enum AVPixelFormat best_fmt);


int init_swr(SwrInfo *info, AVFrame *frame,
             enum AVSampleFormat best_fmt);

AVFrame *swr_frame(SwrInfo *info, AVFrame *frame,
                   enum AVSampleFormat best_fmt);

#endif
