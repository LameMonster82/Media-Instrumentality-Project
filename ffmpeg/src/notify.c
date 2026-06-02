/*
 * notify.c — Single EM_JS dispatch bridge between C and TypeScript.
 *
 * All C→JS communication flows through notify(event_type, *data):
 *   - Synchronous calls (IO, queries): TS handles the request and returns
 *     a result value that flows back to C.
 *   - Asynchronous calls (frames, configs): fire-and-forget, return value
 *     is ignored.
 */
#include <emscripten.h>
#include <stdint.h>
#include "events.h"

EM_JS(int64_t, notify, (int event_type, void *data), {
    return globalThis._ffmpeg_notify(event_type, data);
});

/*
 * IO bridge — these wrap notify() for use as AVIO callbacks.
 */

int64_t bridge_io_read(uint8_t *buf, int buf_size) {
    IOReadEvent ev = { .buffer = (uint32_t)(uintptr_t)buf, .buf_size = buf_size };
    return notify(EVENT_IO_READ, &ev);
}

int64_t bridge_io_seek(int64_t offset, int whence) {
    IOSeekEvent ev = { .offset = offset, .whence = whence };
    return notify(EVENT_IO_SEEK, &ev);
}

/*
 * Stream query — synchronous, returns 0 (decode in FFmpeg),
 * 1 (send raw packet), or -1 (stream not used).
 */

int bridge_query_stream(int stream_index) {
    QueryStreamEvent ev = { .stream_index = stream_index };
    return (int)notify(EVENT_QUERY_STREAM, &ev);
}

/*
 * Fire-and-forget events — calls notify() and discards the return value.
 */

void bridge_emit_video_config(VideoConfigEvent *ev) {
    notify(EVENT_VIDEO_CONFIG, ev);
}

void bridge_emit_audio_config(AudioConfigEvent *ev) {
    notify(EVENT_AUDIO_CONFIG, ev);
}

void bridge_emit_subtitle_config(SubtitleConfigEvent *ev) {
    notify(EVENT_SUBTITLE_CONFIG, ev);
}

void bridge_emit_video_frame(VideoFrameEvent *ev) {
    notify(EVENT_VIDEO_FRAME, ev);
}

void bridge_emit_audio_frame(AudioFrameEvent *ev) {
    notify(EVENT_AUDIO_FRAME, ev);
}

void bridge_emit_subtitle_bitmap(SubtitleBitmapEvent *ev) {
    notify(EVENT_SUBTITLE_BITMAP, ev);
}

void bridge_emit_subtitle_ass(SubtitleAssEvent *ev) {
    notify(EVENT_SUBTITLE_ASS, ev);
}

void bridge_emit_subtitle_empty(SubtitleEmptyEvent *ev) {
    notify(EVENT_SUBTITLE_EMPTY, ev);
}

void bridge_emit_file_info(MetadataEvent *ev) {
    notify(EVENT_FILE_INFO, ev);
}

void bridge_emit_chapter_info(ChapterInfoEvent *ev) {
    notify(EVENT_CHAPTER_INFO, ev);
}

void bridge_emit_attachment(AttachmentEvent *ev) {
    notify(EVENT_ATTACHMENT, ev);
}

void bridge_emit_demuxers(DemuxersEvent *ev) {
    notify(EVENT_DEMUXERS, ev);
}

void bridge_emit_thumbnail(ThumbnailEvent *ev) {
    notify(EVENT_THUMBNAIL, ev);
}

/*
 * Raw packet submission — synchronous, returns whether queued.
 */

int bridge_submit_raw_packet(RawPacketEvent *ev) {
    return (int)notify(EVENT_RAW_PACKET, ev);
}
