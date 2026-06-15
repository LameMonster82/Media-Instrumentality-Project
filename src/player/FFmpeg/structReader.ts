/* eslint-disable @typescript-eslint/naming-convention */
import type { MainModule as MainModule32 } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";
import type { MainModule as MainModule64 } from "@FFmpeg/ffmpeg-wasm64/ffmpeg";
import type { AVChromaLocation, AVColorPrimaries, AVColorRange, AVColorSpace, AVColorTransferCharacteristic } from "./advancedTypes/AVTypes";

import * as Glue32 from "@FFmpeg/ffmpeg-wasm32/structs-wasm32";
import * as Glue64 from "@FFmpeg/ffmpeg-wasm64/structs-wasm64";

// An AI generated view of @ffmpeg/include types.
// TODO: find a better way to convert structs and enums to types

type MainModule = MainModule32 | MainModule64;

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function readCString(view: Uint8Array, ptr: number): string {
    // Read bytes until null
    let offset = ptr;
    const bytes: number[] = [];
    while (true) {
        const byte = view[offset];
        if (byte === 0) break;
        bytes.push(byte);
        offset++;
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

function align(offset: number, alignment: number): number {
    return (offset + alignment - 1) & ~(alignment - 1);
}

// Read a pointer (32-bit or 64-bit)
function readPointer(view: DataView, offset: number, is64Bit: boolean): number {
    return is64Bit ? Number(view.getBigUint64(offset, true)) : view.getUint32(offset, true);
}

// ----------------------------------------------------------------------
// Interfaces
// ----------------------------------------------------------------------

export enum MediaType {
    RESULT_VIDEO = 0,
    RESULT_AUDIO = 1,
    RESULT_SUBTITLE = 2,
    RESULT_PACKET = 3,
}

export enum ResultStatus {
    RESULT_OK = 0,           /* data consumed, frame emitted or packet forwarded */
    RESULT_NEED_MORE = 1,    /* EAGAIN — call get_data again */
    RESULT_EOF = 2,          /* end of file reached */
    RESULT_RAW_PACKET = 10,  /* packet was forwarded to WebCodecs decoder */
    RESULT_ERR_GENERIC = -1, /* fatal error */
    RESULT_ERR_SKIP = -3,    /* stream not used — skip silently */
    RESULT_UNREACHABLE = -4, /* Unreachable place??? */
}

export interface ChapterInfo {
    id: bigint;        // int64_t
    start: number;     // double
    end: number;       // double
    metadata: Record<string, string>;     // AVDictionary* – left for user to implement
}

export interface StreamInfo {
    type: MediaType;
    duration: number;
    video_config: VideoDecoderConfigStruct | null | undefined;
    audio_config: AudioDecoderConfigStruct | null | undefined;
    subtitle_config: ASSSubtitleConfigStruct | null | undefined;
    metadata: Record<string, string>;     // AVDictionary*
}

export interface FileInfo {
    duration: bigint;
    start_time: bigint;
    bitrate: bigint;
    nb_stream_groups: number;
    nb_chapters: number;
    nb_streams: number;
    metadata: Record<string, string>;     // AVDictionary*
    chapters: ChapterInfo[];
    streams: StreamInfo[];
}

export interface VideoFrame {
    width: number;
    height: number;
    crop_top: number;
    crop_bottom: number;
    crop_left: number;
    crop_right: number;
    format: number;
    key_frame: number;
    pict_type: number;
    pts: bigint;
    ts_js: number;
    time_base_num: number;
    time_base_den: number;
    duration: bigint;
    dur_js: number;
    src_data: (number | bigint)[];      // array of 8 pointers (uint8_t*)
    src_linesize: number[];  // array of 8 int32_t
    color_range: AVColorRange;
    color_space: AVColorSpace;
    color_primaries: AVColorPrimaries;
    color_transfer: AVColorTransferCharacteristic;
    stream_index: number;
}

export interface AudioFrame {
    channels: number;
    samples: number;
    sample_rate: number;
    data: number;            // uint8_t* pointer
    bytes_per_sample: number;
    ts_js: number;
    stream_index: number;
}

export interface ReturnType {
    status: ResultStatus;
    stream_index: number;
    type: MediaType;
    video_frame: VideoFrame | null;
    audio_frame: AudioFrame | null;

    flags: number;
    packet_data: number;          // AVPacket* pointer
    packet_size: number;

    timestamp: bigint;
    duration: bigint;
}

export interface VideoDecoderConfigStruct {
    codec: string;                  // char[256]
    coded_width: number;
    coded_height: number;
    description: number;            // uint8_t* pointer
    description_size: number;
    color_range: AVColorRange;
    color_primaries: AVColorPrimaries;
    color_trc: AVColorTransferCharacteristic;
    color_space: AVColorSpace;
    chroma_location: AVChromaLocation;
}

export interface AudioDecoderConfigStruct {
    codec: string;
    sample_rate: number;
    num_channels: number;
    description: number;            // uint8_t* pointer
    description_size: number;
}

export interface ASSSubtitleConfigStruct {
    subtitle_header_size: number;
    subtitle_header: number;        // uint8_t* pointer
}

export interface SmallerDemux {
    extensions: string;
    long_name: string;
    mime_type: string;
    name: string;
}

// ----------------------------------------------------------------------
// Parsing functions
// ----------------------------------------------------------------------

export function readAVDict(module: MainModule, ptr: number, is64Bit: boolean): Record<string, string> {
    const dict: Record<string, string> = {};
    let prevEntry: number | bigint = 0;

    let ptr2: number | bigint = ptr;
    if (is64Bit)
        ptr2 = BigInt(ptr);

    if (is64Bit)
        prevEntry = BigInt(prevEntry);

    while (true) {
        const entryPtr: number | BigInt = module._av_dict_iterate(ptr2 as never, prevEntry as never);
        const entryPtr2 = Number(entryPtr);
        if (entryPtr2 === 0) break;

        const keyPtr = module.getValue(entryPtr2, '*');
        const valuePtr = module.getValue(entryPtr2 + (is64Bit ? 8 : 4), '*');

        const key = module.UTF8ToString(keyPtr);
        const value = module.UTF8ToString(valuePtr);
        dict[key] = value;

        if (is64Bit) {
            prevEntry = BigInt(entryPtr as never);
        } else {
            prevEntry = Number(entryPtr);
        }
    }

    return dict;
}

export function readChapterInfo(module: MainModule, offset: number, is64Bit: boolean): ChapterInfo {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readChapterInfo(module.wasmMemory.buffer, offset);

    const metadata = readAVDict(module, Number(info.metadata), is64Bit);
    return {
        id: info.id,
        start: info.start,
        end: info.end,
        metadata
    };
}

export function readStreamInfo(module: MainModule, offset: number, is64Bit: boolean): StreamInfo {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readStreamInfo(module.wasmMemory.buffer, offset);

    const metadata = readAVDict(module, Number(info.metadata), is64Bit);
    // Recursively parse nested configs if pointers are non-zero
    let video_config: VideoDecoderConfigStruct | undefined | null;
    let audio_config: AudioDecoderConfigStruct | undefined | null;
    let subtitle_config: ASSSubtitleConfigStruct | undefined | null;

    if (info.type === MediaType.RESULT_VIDEO) {
        video_config = info.video_config !== 0 ? readVideoDecoderConfig(module.wasmMemory.buffer, Number(info.video_config), is64Bit) : null;
    } else if (info.type === MediaType.RESULT_AUDIO) {
        audio_config = info.audio_config !== 0 ? readAudioDecoderConfig(module.wasmMemory.buffer, Number(info.audio_config), is64Bit) : null;
    } else if (info.type === MediaType.RESULT_SUBTITLE) {
        subtitle_config = info.subtitle_config !== 0 ? readASSSubtitleConfig(module.wasmMemory.buffer, Number(info.subtitle_config), is64Bit) : null;
    }

    return {
        type: info.type,
        duration: info.duration,
        video_config,
        audio_config,
        subtitle_config,
        metadata
    };
}

export function readFileInfo(module: MainModule, offset: number, is64Bit: boolean): FileInfo {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readFileInfo(module.wasmMemory.buffer, offset);

    const metadata = readAVDict(module, Number(info.metadata), is64Bit);
    // Read arrays
    const chapters: ChapterInfo[] = [];
    if (Number(info.chapters) !== 0) {
        const chapSize = glue.SIZEOF_ChapterInfo;
        const chaptersPtr = Number(info.chapters);
        for (let i = 0; i < info.nb_chapters; i++) {
            chapters.push(readChapterInfo(module, chaptersPtr + i * chapSize, is64Bit));
        }
    }
    const streams: StreamInfo[] = [];
    if (Number(info.streams) !== 0) {
        const streamSize = glue.SIZEOF_StreamInfo;
        const streamsPtr = Number(info.streams);
        for (let i = 0; i < info.nb_streams; i++) {
            streams.push(readStreamInfo(module, streamsPtr + i * streamSize, is64Bit));
        }
    }
    return {
        duration: info.duration,
        start_time: info.start_time,
        bitrate: info.bitrate,
        nb_stream_groups: info.nb_stream_groups,
        nb_chapters: info.nb_chapters,
        nb_streams: info.nb_streams,
        metadata,
        chapters,
        streams
    };
}

export function readVideoFrame(buffer: ArrayBuffer, offset: number, is64Bit: boolean): VideoFrame {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readVideoFrame(buffer, offset);

    const view = new DataView(info.src_data.buffer);
    const src_data: (number | bigint)[] = [];
    for (let i = 0; i < 8; i++) {
        if (is64Bit) {
            src_data.push(view.getBigUint64(i * 8, true));
        } else {
            src_data.push(view.getUint32(i * 4, true));
        }
    }

    const view2 = new DataView(info.src_linesize.buffer);
    const src_linesize: number[] = [];
    for (let i = 0; i < 8; i++) {
        src_linesize.push(view2.getInt32(i * 4));
    }

    return {
        width: info.width,
        height: info.height,
        crop_top: info.crop_top,
        crop_bottom: info.crop_bottom,
        crop_left: info.crop_left,
        crop_right: info.crop_right,
        format: info.format,
        key_frame: info.key_frame,
        pict_type: info.pict_type,
        pts: info.pts,
        ts_js: info.ts_js,
        time_base_num: info.time_base_num,
        time_base_den: info.time_base_den,
        duration: info.duration,
        dur_js: info.dur_js,
        src_data,
        src_linesize,
        color_range: info.color_range,
        color_space: info.color_space,
        color_primaries: info.color_primaries,
        color_transfer: info.color_transfer,
        stream_index: info.stream_index
    };
}

export function readAudioFrame(buffer: ArrayBuffer, offset: number, is64Bit: boolean): AudioFrame {
    const glue = is64Bit ? Glue64 : Glue32;
    return glue.readAudioFrame(buffer, offset);
}

export function readReturnType(buffer: ArrayBuffer, offset: number, is64Bit: boolean): ReturnType {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readReturnType(buffer, offset);

    const video_frame = Number(info.video_frame) !== 0 ? readVideoFrame(buffer, Number(info.video_frame), is64Bit) : null;
    const audio_frame = Number(info.audio_frame) !== 0 ? readAudioFrame(buffer, Number(info.audio_frame), is64Bit) : null;

    return {
        status: info.status,
        stream_index: info.stream_index,
        type: info.type,
        video_frame,
        audio_frame,
        flags: info.flags,
        packet_data: Number(info.packet_data),
        packet_size: info.packet_size,
        timestamp: info.timestamp,
        duration: info.duration
    };
}

export function readVideoDecoderConfig(buffer: ArrayBuffer, offset: number, is64Bit: boolean): VideoDecoderConfigStruct {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readVideoDecoderConfig(buffer, offset);

    return {
        codec: readCString(info.codec, 0),                  // char[256]
        coded_width: info.coded_width,
        coded_height: info.coded_height,
        description: Number(info.description),            // uint8_t* pointer
        description_size: info.description_size,
        color_range: info.color_range,
        color_primaries: info.color_primaries,
        color_trc: info.color_trc,
        color_space: info.color_space,
        chroma_location: info.chroma_location,
    };
}

export function readAudioDecoderConfig(buffer: ArrayBuffer, offset: number, is64Bit: boolean): AudioDecoderConfigStruct {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readAudioDecoderConfig(buffer, offset);
    return {
        codec: readCString(info.codec, 0),
        sample_rate: info.sample_rate,
        num_channels: info.num_channels,
        description: Number(info.description),
        description_size: info.description_size
    };
}

export function readASSSubtitleConfig(buffer: ArrayBufferLike, offset: number, is64Bit: boolean): ASSSubtitleConfigStruct {
    const glue = is64Bit ? Glue64 : Glue32;
    const info = glue.readASSSubtitleConfig(buffer, offset);
    return {
        subtitle_header_size: info.subtitle_header_size,
        subtitle_header: Number(info.subtitle_header)
    };
}

export function readSmallerDemux(buffer: ArrayBufferLike, offset: number, is64Bit: boolean): SmallerDemux {
    const view = new DataView(buffer);
    let off = offset;
    const extensionsPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const long_namePtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const mime_typePtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const namePtr = readPointer(view, off, is64Bit);
    const extensions = extensionsPtr !== 0 ? readCString(view, extensionsPtr) : "";
    const long_name = long_namePtr !== 0 ? readCString(view, long_namePtr) : "";
    const mime_type = mime_typePtr !== 0 ? readCString(view, mime_typePtr) : "";
    const name = namePtr !== 0 ? readCString(view, namePtr) : "";
    return { extensions, long_name, mime_type, name };
}
