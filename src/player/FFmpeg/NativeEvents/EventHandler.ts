/*
 * EventHandler.ts — Single C→JS dispatch entry point.
 * All C event structs are read from Wasm linear memory at the given
 * pointer and dispatched to the appropriate handler.
 *
 * Replaces all individual globalThis.* EM_JS callbacks.
 */

import type { Demuxer, WorkerSubmitDemuxers } from "@/player/types";
import { submit_video_config, submit_video_frame } from "../hold on/Video";
import { submitAudioConfig, submitAudioFrame } from "../modules/Audio";
import { fetch_video_data, seek_video_data } from "../modules/IO";
import { submit_subtitle_config, submit_subtitle_bitmap, submit_subtitle_ass, submit_attachment } from "../modules/Subtitles";
import { submit_thumbnail } from "../modules/Thumbnail";
import { submit_raw_packet } from "../modules/WebDecoder";
import { workerState } from "../State";
import type { WorkerMediaInfo, WorkerChapterInfo } from "../types";
import StructReader from "./StructReader";

function handleIORead(reader: StructReader, ptr: number): bigint {
    const buf = reader.ptr(IOReadEventOffsets.BUFFER);
    const size = reader.i32(IOReadEventOffsets.BUF_SIZE);
    const result = fetch_video_data(buf, size);
    return BigInt(result);
}

function handleIOSeek(reader: StructReader): bigint {
    const offset = reader.i64(IOSeekEventOffsets.OFFSET);
    const whence = reader.i32(IOSeekEventOffsets.WHENCE);
    return seek_video_data(offset, whence);
}

function handleQueryStream(reader: StructReader): number {
    const streamIndex = reader.i32(QueryStreamEventOffsets.STREAM_INDEX);
    const stream = workerState.streams[streamIndex];
    if (!stream || !stream.isUsed) return -1;
    return stream.isSupported ? 1 : 0;
}

function handleVideoConfig(reader: StructReader): number {
    const config = {
        index: reader.i32(VideoConfigEventOffsets.STREAM_INDEX),
        codec: reader.fixedStr(VideoConfigEventOffsets.CODEC, 256),
        codedHeight: reader.i32(VideoConfigEventOffsets.CODED_HEIGHT),
        codedWidth: reader.i32(VideoConfigEventOffsets.CODED_WIDTH),
        description: reader.ptr(VideoConfigEventOffsets.DESCRIPTION),
        descriptionSize: reader.i32(VideoConfigEventOffsets.DESCRIPTION_SIZE),
        duration: reader.f64(VideoConfigEventOffsets.DURATION),
        colorRange: reader.i32(VideoConfigEventOffsets.COLOR_RANGE),
        colorSpace: reader.i32(VideoConfigEventOffsets.COLOR_SPACE),
        colorPrimative: reader.i32(VideoConfigEventOffsets.COLOR_PRIMARIES),
        colorTransfer: reader.i32(VideoConfigEventOffsets.COLOR_TRANSFER),
    };
    submit_video_config(config);
    return 0;
}

function handleAudioConfig(reader: StructReader): number {
    const config = {
        index: reader.i32(AudioConfigEventOffsets.STREAM_INDEX),
        codec: reader.fixedStr(AudioConfigEventOffsets.CODEC, 256),
        sampleRate: reader.i32(AudioConfigEventOffsets.SAMPLE_RATE),
        numberOfChannels: reader.i32(AudioConfigEventOffsets.NUM_CHANNELS),
        description: reader.ptr(AudioConfigEventOffsets.DESCRIPTION),
        descriptionSize: reader.i32(AudioConfigEventOffsets.DESCRIPTION_SIZE),
        duration: reader.f64(AudioConfigEventOffsets.DURATION),
    };
    submitAudioConfig(config);
    return 0;
}

function handleSubtitleConfig(reader: StructReader): number {
    const config = {
        stream_index: reader.i32(SubtitleConfigEventOffsets.STREAM_INDEX),
        duration: reader.i32(SubtitleConfigEventOffsets.DURATION),
        header_ptr: reader.ptr(SubtitleConfigEventOffsets.HEADER_PTR),
        header_size: reader.i32(SubtitleConfigEventOffsets.HEADER_SIZE),
    };
    submit_subtitle_config(config);
    return 0;
}

function handleRawPacket(reader: StructReader): number {
    const packet = {
        index: reader.i32(RawPacketEventOffsets.STREAM_INDEX),
        flags: reader.i32(RawPacketEventOffsets.FLAGS),
        timestamp: reader.f64(RawPacketEventOffsets.TS_JS),
        duration: reader.f64(RawPacketEventOffsets.DUR_JS),
        dataPtr: reader.ptr(RawPacketEventOffsets.DATA),
        dataSize: reader.i32(RawPacketEventOffsets.DATA_SIZE),
    };
    return submit_raw_packet(packet);
}

function handleVideoFrame(reader: StructReader): number {
    const off = VideoFrameEventOffsets;

    const srcData: number[] = [];
    const srcLinesize: number[] = [];
    for (let i = 0; i < 8; i++) {
        srcData[i] = reader.ptr(off.SRC_DATA + i * 4);
        srcLinesize[i] = reader.i32(off.SRC_LINESIZE + i * 4);
    }

    submit_video_frame({
        width: reader.i32(off.WIDTH),
        height: reader.i32(off.HEIGHT),
        crop_top: reader.i32(off.CROP_TOP),
        crop_bottom: reader.i32(off.CROP_BOTTOM),
        crop_left: reader.i32(off.CROP_LEFT),
        crop_right: reader.i32(off.CROP_RIGHT),
        format: reader.i32(off.FORMAT),
        key_frame: reader.i32(off.KEY_FRAME),
        pict_type: reader.i32(off.PICT_TYPE),
        pts: Number(reader.i64(off.PTS)),
        ts_js: reader.f64(off.TS_JS),
        time_base_num: reader.i32(off.TIME_BASE_NUM),
        time_base_den: reader.i32(off.TIME_BASE_DEN),
        duration: Number(reader.i64(off.DURATION)),
        duration_js: reader.f64(off.DUR_JS),
        src_data: srcData,
        src_linesize: srcLinesize,
        colorRange: reader.i32(off.COLOR_RANGE),
        colorSpace: reader.i32(off.COLOR_SPACE),
        colorPrimative: reader.i32(off.COLOR_PRIMARIES),
        colorTransfer: reader.i32(off.COLOR_TRANSFER),
        stream_index: reader.i32(off.STREAM_INDEX),
    });
    return 0;
}

function handleAudioFrame(reader: StructReader): number {
    const off = AudioFrameEventOffsets;
    submitAudioFrame({
        channels: reader.i32(off.CHANNELS),
        samples: reader.i32(off.SAMPLES),
        sampleRate: reader.i32(off.SAMPLE_RATE),
        data: reader.ptr(off.DATA),
        bytesPerSample: reader.i32(off.BYTES_PER_SAMPLE),
        ts_js: reader.f64(off.TS_JS),
        stream_index: reader.i32(off.STREAM_INDEX),
    });
    return 0;
}

function handleSubtitleBitmap(reader: StructReader): number {
    const off = SubtitleBitmapEventOffsets;
    submit_subtitle_bitmap({
        stream_index: reader.i32(off.STREAM_INDEX),
        data: reader.ptr(off.DATA),
        data_size: reader.i32(off.DATA_SIZE),
        x: reader.i32(off.X),
        y: reader.i32(off.Y),
        width: reader.i32(off.WIDTH),
        height: reader.i32(off.HEIGHT),
        ts_js: reader.i64(off.TS_JS),
        dur_js: reader.i64(off.DUR_JS),
        coded_width: reader.i32(off.CODED_WIDTH),
        coded_height: reader.i32(off.CODED_HEIGHT),
    });
    return 0;
}

function handleSubtitleAss(reader: StructReader): number {
    const off = SubtitleAssEventOffsets;
    submit_subtitle_ass({
        stream_index: reader.i32(off.STREAM_INDEX),
        dialog: reader.str(off.DIALOG),
        start_time: reader.i64(off.START_TIME),
        end_time: reader.i64(off.END_TIME),
    });
    return 0;
}

function handleSubtitleEmpty(reader: StructReader): number {
    const off = SubtitleEmptyEventOffsets;
    // Note: no main-thread handler exists for this yet; sent for potential
    // future use (e.g., clearing active subtitle display).
    self.postMessage({
        kind: "emptySubtitle",
        stream_index: reader.i32(off.STREAM_INDEX),
        ts_js: reader.i64(off.TS_JS),
    } as any);
    return 0;
}

function handleFileInfo(reader: StructReader, ptr: number): number {
    const off = MetadataEventOffsets;
    const streamIndex = reader.i32(off.STREAM_INDEX);
    const keys = reader.strArray(off.KEYS, off.COUNT);
    const values = reader.strArray(off.VALUES, off.COUNT);

    const metadata: { [key: string]: string; } = {};
    for (let i = 0; i < keys.length; i++) {
        metadata[keys[i]] = values[i];
    }

    if (streamIndex === -1) {
        self.postMessage({ kind: "mediaInfo", data: metadata } as WorkerMediaInfo);
    } else {
        workerState.streamMetadatas[streamIndex] = metadata;
    }
    return 0;
}

function handleChapterInfo(reader: StructReader): number {
    const off = ChapterInfoEventOffsets;
    const chapterIndex = reader.i32(off.CHAPTER_INDEX);
    const keys = reader.strArray(off.KEYS, off.COUNT);
    const values = reader.strArray(off.VALUES, off.COUNT);

    const metadata: { [key: string]: string; } = {};
    for (let i = 0; i < keys.length; i++) {
        metadata[keys[i]] = values[i];
    }

    self.postMessage({
        kind: "chapterInfo",
        data: {
            index: chapterIndex,
            start: Number(reader.i64(off.START_JS)) / 1000000,
            end: Number(reader.i64(off.END_JS)) / 1000000,
            data: metadata,
        },
    } as WorkerChapterInfo);
    return 0;
}

function handleAttachment(reader: StructReader): number {
    const off = AttachmentEventOffsets;
    const keys = reader.strArray(off.KEYS, off.COUNT);
    const values = reader.strArray(off.VALUES, off.COUNT);
    const dataPtr = reader.ptr(off.DATA);
    const dataSize = reader.i32(off.DATA_SIZE);

    const metadata: { [key: string]: string; } = {};
    for (let i = 0; i < keys.length; i++) {
        metadata[keys[i]] = values[i];
    }

    submit_attachment(metadata, dataPtr, dataSize);
    return 0;
}

function handleDemuxers(reader: StructReader): number {
    const off = DemuxersEventOffsets;
    const extensions = reader.strArray(off.EXTENSIONS, off.COUNT);
    const longNames = reader.strArray(off.LONG_NAMES, off.COUNT);
    const mimeTypes = reader.strArray(off.MIME_TYPES, off.COUNT);
    const names = reader.strArray(off.NAMES, off.COUNT);

    const demuxers: Demuxer[] = names.map((name, i) => ({
        extensions: extensions[i] ? extensions[i].split(",") : [],
        mime_types: mimeTypes[i] ? mimeTypes[i].split(",") : [],
        long_name: longNames[i] || name,
        name: name,
    }));

    self.postMessage({ kind: "demuxerResponse", demuxers } as WorkerSubmitDemuxers);
    return 0;
}

function handleThumbnail(reader: StructReader): number {
    const off = ThumbnailEventOffsets;
    submit_thumbnail({
        is_raw: reader.i32(off.IS_RAW),
        data: reader.ptr(off.DATA),
        data_size: reader.i32(off.DATA_SIZE),
        width: reader.i32(off.WIDTH),
        height: reader.i32(off.HEIGHT),
        format: reader.i32(off.FORMAT),
    });
    return 0;
}

/*
 * Single dispatch function registered as globalThis._ffmpeg_notify.
 * Called from the C EM_JS notify() bridge.
 * Returns 0 for fire-and-forget events, or the operation result for
 * synchronous events (IO, queries, raw packet submission).
 */
export function ffmpegNotify(eventType: number, ptr: number): number {
    if (!workerState.outModule) return 0;

    const reader = new StructReader(workerState.outModule, ptr);

    switch (eventType) {
        case EventType.IO_READ:
            return Number(handleIORead(reader, ptr));

        case EventType.IO_SEEK:
            return Number(handleIOSeek(reader));

        case EventType.QUERY_STREAM:
            return handleQueryStream(reader);

        case EventType.RAW_PACKET:
            return handleRawPacket(reader);

        case EventType.VIDEO_CONFIG:
            return handleVideoConfig(reader);

        case EventType.AUDIO_CONFIG:
            return handleAudioConfig(reader);

        case EventType.SUBTITLE_CONFIG:
            return handleSubtitleConfig(reader);

        case EventType.VIDEO_FRAME:
            return handleVideoFrame(reader);

        case EventType.AUDIO_FRAME:
            return handleAudioFrame(reader);

        case EventType.SUBTITLE_BITMAP:
            return handleSubtitleBitmap(reader);

        case EventType.SUBTITLE_ASS:
            return handleSubtitleAss(reader);

        case EventType.SUBTITLE_EMPTY:
            return handleSubtitleEmpty(reader);

        case EventType.FILE_INFO:
            return handleFileInfo(reader, ptr);

        case EventType.CHAPTER_INFO:
            return handleChapterInfo(reader);

        case EventType.ATTACHMENT:
            return handleAttachment(reader);

        case EventType.DEMUXERS:
            return handleDemuxers(reader);

        case EventType.THUMBNAIL:
            return handleThumbnail(reader);

        default:
            console.warn("Unknown event type:", eventType);
            return 0;
    }
}

type EventReciever = (eventType: number, ptr: number) => number;
export default function notifyEvents(eventCallback: () => number | bigint): EventReciever {
    const reader = new StructReader(workerState.outModule);

    const notifyReciever: EventReciever = (eventType: number, ptr: number) => {
        reader.setOffset(ptr);

        switch (eventType) {
            case EventType.IO_READ:
                return Number(handleIORead(reader, ptr));

            case EventType.IO_SEEK:
                return Number(handleIOSeek(reader));

            case EventType.QUERY_STREAM:
                return handleQueryStream(reader);

            case EventType.RAW_PACKET:
                return handleRawPacket(reader);

            case EventType.VIDEO_CONFIG:
                return handleVideoConfig(reader);

            case EventType.AUDIO_CONFIG:
                return handleAudioConfig(reader);

            case EventType.SUBTITLE_CONFIG:
                return handleSubtitleConfig(reader);

            case EventType.VIDEO_FRAME:
                return handleVideoFrame(reader);

            case EventType.AUDIO_FRAME:
                return handleAudioFrame(reader);

            case EventType.SUBTITLE_BITMAP:
                return handleSubtitleBitmap(reader);

            case EventType.SUBTITLE_ASS:
                return handleSubtitleAss(reader);

            case EventType.SUBTITLE_EMPTY:
                return handleSubtitleEmpty(reader);

            case EventType.FILE_INFO:
                return handleFileInfo(reader, ptr);

            case EventType.CHAPTER_INFO:
                return handleChapterInfo(reader);

            case EventType.ATTACHMENT:
                return handleAttachment(reader);

            case EventType.DEMUXERS:
                return handleDemuxers(reader);

            case EventType.THUMBNAIL:
                return handleThumbnail(reader);

            default:
                console.warn("Unknown event type:", eventType);
                return 0;
        }
    };

    return notifyReciever;

};
