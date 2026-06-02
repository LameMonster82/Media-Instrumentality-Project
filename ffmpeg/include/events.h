#ifndef FFMPEG_EVENTS_H
#define FFMPEG_EVENTS_H

#include <stdint.h>

/*
 * Event types for C→JS communication via notify().
 * Each event struct is written to Wasm linear memory and a pointer is
 * passed to the single EM_JS dispatch function.
 *
 * Pointer-sized fields use uint32_t for consistent layout across wasm32/64.
 * This is safe because event structs live on the stack within the accessible
 * Wasm heap range. The TS side reads them at fixed byte offsets.
 */

typedef enum {
    EVENT_NONE = 0,
    EVENT_VIDEO_CONFIG = 1,
    EVENT_AUDIO_CONFIG,
    EVENT_SUBTITLE_CONFIG,
    EVENT_VIDEO_FRAME,
    EVENT_AUDIO_FRAME,
    EVENT_RAW_PACKET,
    EVENT_SUBTITLE_BITMAP,
    EVENT_SUBTITLE_ASS,
    EVENT_SUBTITLE_EMPTY,
    EVENT_FILE_INFO,
    EVENT_CHAPTER_INFO,
    EVENT_ATTACHMENT,
    EVENT_DEMUXERS,
    EVENT_IO_READ,
    EVENT_IO_SEEK,
    EVENT_QUERY_STREAM,
    EVENT_THUMBNAIL,
} EventType;

/*
 * IO Events (synchronous: C blocks until JS returns result)
 */

typedef struct {
    uint32_t buffer;    /* uint8_t* — destination in Wasm memory */
    int32_t  buf_size;  /* max bytes to read */
} IOReadEvent;

typedef struct {
    int64_t  offset;
    int32_t  whence;
} IOSeekEvent;

/*
 * Query Events (synchronous)
 */

typedef struct {
    int32_t  stream_index;
} QueryStreamEvent;

/*
 * Configuration Events (C→JS, fire-and-forget)
 */

typedef struct {
    int32_t  stream_index;
    char     codec[256];
    int32_t  coded_width;
    int32_t  coded_height;
    uint32_t description;      /* uint8_t* — extradata ptr */
    int32_t  description_size;
    double   duration;
    int32_t  color_range;
    int32_t  color_space;
    int32_t  color_primaries;
    int32_t  color_transfer;
} VideoConfigEvent;

typedef struct {
    int32_t  stream_index;
    char     codec[256];
    int32_t  sample_rate;
    int32_t  num_channels;
    uint32_t description;      /* uint8_t* — extradata ptr */
    int32_t  description_size;
    double   duration;
} AudioConfigEvent;

typedef struct {
    int32_t  stream_index;
    int32_t  duration;
    uint32_t header_ptr;       /* uint8_t* */
    int32_t  header_size;
} SubtitleConfigEvent;

/*
 * Raw Packet Event (synchronous: returns whether queued to decoder)
 */

typedef struct {
    int32_t  stream_index;
    int32_t  flags;
    double   ts_js;
    double   dur_js;
    uint32_t data;             /* uint8_t* — packet bytes */
    int32_t  data_size;
} RawPacketEvent;

/*
 * Decoded Frame Events (C→JS, fire-and-forget)
 */

typedef struct {
    int32_t  width;
    int32_t  height;
    int32_t  crop_top;
    int32_t  crop_bottom;
    int32_t  crop_left;
    int32_t  crop_right;
    int32_t  format;
    int32_t  key_frame;
    int32_t  pict_type;
    int64_t  pts;
    double   ts_js;
    int32_t  time_base_num;
    int32_t  time_base_den;
    int64_t  duration;
    double   dur_js;
    uint32_t src_data[8];       /* uint8_t* plane pointers */
    int32_t  src_linesize[8];   /* int32_t linesize per plane */
    int32_t  color_range;
    int32_t  color_space;
    int32_t  color_primaries;
    int32_t  color_transfer;
    int32_t  stream_index;
} VideoFrameEvent;

typedef struct {
    int32_t  channels;
    int32_t  samples;
    int32_t  sample_rate;
    uint32_t data;              /* uint8_t* — audio samples */
    int32_t  bytes_per_sample;
    double   ts_js;
    int32_t  stream_index;
} AudioFrameEvent;

/*
 * Subtitle Events (C→JS, fire-and-forget)
 */

typedef struct {
    int32_t  stream_index;
    uint32_t data;              /* uint8_t* — RGBA bitmap */
    int32_t  data_size;
    int32_t  x;
    int32_t  y;
    int32_t  width;
    int32_t  height;
    int64_t  ts_js;
    int64_t  dur_js;
    int32_t  coded_width;
    int32_t  coded_height;
} SubtitleBitmapEvent;

typedef struct {
    int32_t  stream_index;
    uint32_t dialog;            /* char* — ASS dialog text */
    int64_t  start_time;
    int64_t  end_time;
} SubtitleAssEvent;

typedef struct {
    int32_t  stream_index;
    int64_t  ts_js;
} SubtitleEmptyEvent;

/*
 * Metadata / Chapter / Attachment Events
 */

typedef struct {
    int32_t  stream_index;
    uint32_t keys;              /* char** — null-terminated string ptr array */
    uint32_t values;            /* char** */
    int32_t  count;
} MetadataEvent;

typedef struct {
    int32_t  chapter_index;
    int64_t  start_js;
    int64_t  end_js;
    uint32_t keys;
    uint32_t values;
    int32_t  count;
} ChapterInfoEvent;

typedef struct {
    uint32_t keys;
    uint32_t values;
    int32_t  count;
    uint32_t data;              /* uint8_t* */
    int32_t  data_size;
} AttachmentEvent;

/*
 * Demuxer Registration
 */

typedef struct {
    uint32_t extensions;        /* char** */
    uint32_t long_names;        /* char** */
    uint32_t mime_types;        /* char** */
    uint32_t names;             /* char** */
    int32_t  count;
} DemuxersEvent;

/*
 * Thumbnail
 */

typedef struct {
    int32_t  is_raw;        /* 1 = raw pixel data, 0 = encoded image */
    uint32_t data;          /* uint8_t* */
    int32_t  data_size;
    int32_t  width;
    int32_t  height;
    int32_t  format;        /* AVPixelFormat */
} ThumbnailEvent;

/*
 * Action result codes returned by demux/decode functions.
 * TS must handle these with named constants, not magic ints.
 */
typedef enum {
    RESULT_OK            =  0,   /* data consumed, frame emitted or packet forwarded */
    RESULT_NEED_MORE     =  1,   /* EAGAIN — call get_data again */
    RESULT_EOF           =  2,   /* end of file reached */
    RESULT_RAW_PACKET    = 10,   /* packet was forwarded to WebCodecs decoder */
    RESULT_ERR_GENERIC   = -1,   /* fatal error */
    RESULT_ERR_SKIP      = -3,   /* stream not used — skip silently */
} ActionResult;

/* Bridge function declarations (implemented in notify.c) */

int64_t bridge_io_read(uint8_t *buf, int buf_size);
int64_t bridge_io_seek(int64_t offset, int whence);
int    bridge_query_stream(int stream_index);
int    bridge_submit_raw_packet(RawPacketEvent *ev);

void bridge_emit_video_config(VideoConfigEvent *ev);
void bridge_emit_audio_config(AudioConfigEvent *ev);
void bridge_emit_subtitle_config(SubtitleConfigEvent *ev);
void bridge_emit_video_frame(VideoFrameEvent *ev);
void bridge_emit_audio_frame(AudioFrameEvent *ev);
void bridge_emit_subtitle_bitmap(SubtitleBitmapEvent *ev);
void bridge_emit_subtitle_ass(SubtitleAssEvent *ev);
void bridge_emit_subtitle_empty(SubtitleEmptyEvent *ev);
void bridge_emit_file_info(MetadataEvent *ev);
void bridge_emit_chapter_info(ChapterInfoEvent *ev);
void bridge_emit_attachment(AttachmentEvent *ev);
void bridge_emit_demuxers(DemuxersEvent *ev);
void bridge_emit_thumbnail(ThumbnailEvent *ev);

#endif

