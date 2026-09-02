#include "context.h"
#include "emscripten.h"
#include "libavformat/avformat.h"
#include "libavformat/avio.h"
#include "libavutil/error.h"
#include "libavutil/mem.h"
#include <stdio.h>

EM_JS(int, read_js_packet, (void *opaque, uint8_t *buf, int buf_size),
      { return self.read_packet(buf, buf_size); });

EM_JS(int64_t, seek_packet, (void *opaque, int64_t offset, int whence),
      { return self.seek_packet(offset, whence); });


int read_packet(void *opaque, uint8_t *buf, int buf_size) {
    int len = read_js_packet(opaque, buf, buf_size);

    if(len == 0) {
        return AVERROR_EOF;
    }

    return len;
}


int allocate_io(BridgeContext *ctx, int buffer_size, int is_stream) {
    uint8_t *buf = av_malloc(buffer_size);
    if (!buf) {
        fprintf(stderr, "Error allocating IO buffer\n");
        return AVERROR_UNKNOWN;
    }

    AVIOContext *avio = avio_alloc_context(
        buf, buffer_size, 0, NULL, read_packet, NULL, seek_packet);
    if (!avio) {
        fprintf(stderr, "Error allocating AVIO context\n");
        av_free(buf);
        return AVERROR_UNKNOWN;
    }

    ctx->fmt_ctx = avformat_alloc_context();
    if (!ctx->fmt_ctx) {
        avio_context_free(&avio);
        return AVERROR_UNKNOWN;
    }

    ctx->fmt_ctx->pb = avio;
    ctx->fmt_ctx->flags |= AVFMT_FLAG_GENPTS | AVFMT_FLAG_CUSTOM_IO | AVFMT_FLAG_NONBLOCK;
    avio->direct   = 0;
    avio->seekable = is_stream ? 0 : AVIO_SEEKABLE_NORMAL;

    return 0;
}
