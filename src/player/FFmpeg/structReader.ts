/* eslint-disable @typescript-eslint/naming-convention */
import type { MainModule as MainModule32 } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";
import type { MainModule as MainModule64 } from "@FFmpeg/ffmpeg-wasm64/ffmpeg";
import type { AVChromaLocation, AVColorPrimaries, AVColorRange, AVColorSpace, AVColorTransferCharacteristic } from "./advancedTypes/AVTypes";

// An AI generated view of @ffmpeg/include types.
// TODO: find a better way to convert structs and enums to types

type MainModule = MainModule32 | MainModule64;

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function readCString(view: DataView, ptr: number): string {
    if (ptr === 0) return "";
    // Read bytes until null
    let offset = ptr;
    const bytes: number[] = [];
    while (true) {
        const byte = view.getUint8(offset);
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

export interface ChapterInfo {
    id: bigint;        // int64_t
    start: number;     // double
    end: number;       // double
    metadata: Record<string, string>;     // AVDictionary* – left for user to implement
}

export interface StreamInfo {
    type: MediaType;
    duration: number;
    video_config: VideoDecoderConfigStruct | null;
    audio_config: AudioDecoderConfigStruct | null;
    subtitle_config: ASSSubtitleConfigStruct | null;
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
    src_data: number[];      // array of 8 pointers (uint8_t*)
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
    status: number;
    stream_index: number;
    type: MediaType;
    video_frame: VideoFrame | null;
    audio_frame: AudioFrame | null;
    packet_data: number;          // AVPacket* pointer
    packet_size: number;
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
// Size helpers (in bytes)
// ----------------------------------------------------------------------

function sizeOfChapterInfo(is64Bit: boolean): number {
    const ptrSize = is64Bit ? 8 : 4;
    return 24 + ptrSize; // id(8) + start(8) + end(8) + metadata(ptr)
}

function sizeOfStreamInfo(is64Bit: boolean): number {
    // 32-bit: 32, 64-bit: 48 (computed with alignment)
    return is64Bit ? 48 : 32;
}

function sizeOfFileInfo(is64Bit: boolean): number {
    return is64Bit ? 64 : 48;
}

function sizeOfVideoFrame(is64Bit: boolean): number {
    // Rough estimate: many int32 fields + pointers.
    // We'll compute dynamically in the parser; not needed for arrays.
    // Return a sufficiently large value (no array of VideoFrame is used directly)
    return 200;
}

function sizeOfAudioFrame(is64Bit: boolean): number {
    return 64;
}

function sizeOfReturnType(is64Bit: boolean): number {
    const ptrSize = is64Bit ? 8 : 4;
    return 4 + 4 + ptrSize + ptrSize + ptrSize; // status(4) + type(4) + video_frame + audio_frame + packet
}

function sizeOfVideoDecoderConfig(is64Bit: boolean): number {
    const ptrSize = is64Bit ? 8 : 4;
    return 256 + 4 + 4 + ptrSize + 4 + 4 + 4 + 4 + 4 + 4; // codec(256) + coded_width(4) + coded_height(4) + description(ptr) + description_size(4) + color_range(4) + color_primaries(4) + color_trc(4) + color_space(4) + chroma_location(4)
}

function sizeOfAudioDecoderConfig(is64Bit: boolean): number {
    const ptrSize = is64Bit ? 8 : 4;
    return 256 + 4 + 4 + ptrSize + 4; // codec(256) + sample_rate(4) + num_channels(4) + description(ptr) + description_size(4)
}

function sizeOfASSSubtitleConfig(is64Bit: boolean): number {
    const ptrSize = is64Bit ? 8 : 4;
    return 4 + ptrSize; // subtitle_header_size(4) + subtitle_header(ptr)
}

function sizeOfSmallerDemux(is64Bit: boolean): number {
    const ptrSize = is64Bit ? 8 : 4;
    return ptrSize * 4; // four pointers
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
    const view = new DataView(module.wasmMemory.buffer);
    let off = offset;
    const id = view.getBigInt64(off, true); off += 8;
    const start = view.getFloat64(off, true); off += 8;
    const end = view.getFloat64(off, true); off += 8;
    const metadataPtr = readPointer(view, off, is64Bit);

    const metadata = readAVDict(module, metadataPtr, is64Bit);
    // metadata handling left to user
    return { id, start, end, metadata };
}

export function readStreamInfo(module: MainModule, offset: number, is64Bit: boolean): StreamInfo {
    const view = new DataView(module.wasmMemory.buffer);
    let off = offset;
    const type = view.getInt32(off, true) as MediaType; off += 4;
    // align to 8 bytes for double (if needed)
    if (is64Bit) off = align(off, 8);
    const duration = view.getFloat64(off, true); off += 8;
    const videoConfigPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const audioConfigPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const subtitleConfigPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const metadataPtr = readPointer(view, off, is64Bit);
    const metadata = readAVDict(module, metadataPtr, is64Bit);
    // Recursively parse nested configs if pointers are non-zero
    const video_config = videoConfigPtr !== 0 ? readVideoDecoderConfig(module, videoConfigPtr, is64Bit) : null;
    const audio_config = audioConfigPtr !== 0 ? readAudioDecoderConfig(module, audioConfigPtr, is64Bit) : null;
    const subtitle_config = subtitleConfigPtr !== 0 ? readASSSubtitleConfig(module.wasmMemory.buffer, subtitleConfigPtr, is64Bit) : null;
    return { type, duration, video_config, audio_config, subtitle_config, metadata };
}

export function readFileInfo(module: MainModule, offset: number, is64Bit: boolean): FileInfo {
    const view = new DataView(module.wasmMemory.buffer);
    let off = offset;
    const duration = view.getBigInt64(off, true); off += 8;
    const start_time = view.getBigInt64(off, true); off += 8;
    const bitrate = view.getBigInt64(off, true); off += 8;
    const nb_stream_groups = view.getUint32(off, true); off += 4;
    const nb_chapters = view.getUint32(off, true); off += 4;
    const nb_streams = view.getUint32(off, true); off += 4;
    // align for pointer if 64-bit
    if (is64Bit) off = align(off, 8);
    const metadataPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const chaptersPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const streamsPtr = readPointer(view, off, is64Bit);

    const metadata = readAVDict(module, metadataPtr, is64Bit);
    // Read arrays
    const chapters: ChapterInfo[] = [];
    if (chaptersPtr !== 0) {
        const chapSize = sizeOfChapterInfo(is64Bit);
        for (let i = 0; i < nb_chapters; i++) {
            chapters.push(readChapterInfo(module, chaptersPtr + i * chapSize, is64Bit));
        }
    }
    const streams: StreamInfo[] = [];
    if (streamsPtr !== 0) {
        const streamSize = sizeOfStreamInfo(is64Bit);
        for (let i = 0; i < nb_streams; i++) {
            streams.push(readStreamInfo(module, streamsPtr + i * streamSize, is64Bit));
        }
    }
    return { duration, start_time, bitrate, nb_stream_groups, nb_chapters, nb_streams, metadata, chapters, streams };
}

export function readVideoFrame(buffer: ArrayBuffer, offset: number, is64Bit: boolean): VideoFrame {
    const view = new DataView(buffer);
    let off = offset;
    const width = view.getInt32(off, true); off += 4;
    const height = view.getInt32(off, true); off += 4;
    const crop_top = view.getInt32(off, true); off += 4;
    const crop_bottom = view.getInt32(off, true); off += 4;
    const crop_left = view.getInt32(off, true); off += 4;
    const crop_right = view.getInt32(off, true); off += 4;
    const format = view.getInt32(off, true); off += 4;
    const key_frame = view.getInt32(off, true); off += 4;
    const pict_type = view.getInt32(off, true); off += 4;
    const pts = view.getBigInt64(off, true); off += 8;
    const ts_js = view.getFloat64(off, true); off += 8;
    const time_base_num = view.getInt32(off, true); off += 4;
    const time_base_den = view.getInt32(off, true); off += 4;
    const duration = view.getBigInt64(off, true); off += 8;
    const dur_js = view.getFloat64(off, true); off += 8;
    // src_data[8] – each is pointer (uint8_t*)
    const src_data: number[] = [];
    for (let i = 0; i < 8; i++) {
        src_data.push(readPointer(view, off, is64Bit));
        off += is64Bit ? 8 : 4;
    }
    // src_linesize[8] – int32_t each
    const src_linesize: number[] = [];
    for (let i = 0; i < 8; i++) {
        src_linesize.push(view.getInt32(off, true));
        off += 4;
    }
    const color_range = view.getInt32(off, true); off += 4;
    const color_space = view.getInt32(off, true); off += 4;
    const color_primaries = view.getInt32(off, true); off += 4;
    const color_transfer = view.getInt32(off, true); off += 4;
    const stream_index = view.getInt32(off, true); off += 4;
    return {
        width, height, crop_top, crop_bottom, crop_left, crop_right,
        format, key_frame, pict_type, pts, ts_js, time_base_num, time_base_den,
        duration, dur_js, src_data, src_linesize, color_range, color_space,
        color_primaries, color_transfer, stream_index
    };
}

export function readAudioFrame(buffer: ArrayBuffer, offset: number, is64Bit: boolean): AudioFrame {
    const view = new DataView(buffer);
    let off = offset;
    const channels = view.getInt32(off, true); off += 4;
    const samples = view.getInt32(off, true); off += 4;
    const sample_rate = view.getInt32(off, true); off += 4;
    const dataPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const bytes_per_sample = view.getInt32(off, true); off += 4;
    const ts_js = view.getFloat64(off, true); off += 8;
    const stream_index = view.getInt32(off, true); off += 4;
    return { channels, samples, sample_rate, data: dataPtr, bytes_per_sample, ts_js, stream_index };
}

export function readReturnType(buffer: ArrayBuffer, offset: number, is64Bit: boolean): ReturnType {
    const view = new DataView(buffer);
    let off = offset;
    const status = view.getInt32(off, true); off += 4;
    const stream_index = view.getUint32(off, true); off += 4;
    const type = view.getInt32(off, true) as MediaType; off += 4;
    const videoFramePtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const audioFramePtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const packetPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const packetSize = view.getInt32(off, true); off += 4;
    const video_frame = videoFramePtr !== 0 ? readVideoFrame(buffer, videoFramePtr, is64Bit) : null;
    const audio_frame = audioFramePtr !== 0 ? readAudioFrame(buffer, audioFramePtr, is64Bit) : null;
    return { status, stream_index, type, video_frame, audio_frame, packet_data: packetPtr, packet_size: packetSize };
}

export function readVideoDecoderConfig(module: MainModule, offset: number, is64Bit: boolean): VideoDecoderConfigStruct {
    const view = new DataView(module.wasmMemory.buffer);
    let off = offset;
    const codec = module.UTF8ToString(off); off += 256;
    const coded_width = view.getInt32(off, true); off += 4;
    const coded_height = view.getInt32(off, true); off += 4;
    const descriptionPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const description_size = view.getInt32(off, true); off += 4;
    const color_range = view.getInt32(off, true); off += 4;
    const color_primaries = view.getInt32(off, true); off += 4;
    const color_trc = view.getInt32(off, true); off += 4;
    const color_space = view.getInt32(off, true); off += 4;
    const chroma_location = view.getInt32(off, true);
    return { codec, coded_width, coded_height, description: descriptionPtr, description_size, color_range, color_primaries, color_trc, color_space, chroma_location };
}

export function readAudioDecoderConfig(module: MainModule, offset: number, is64Bit: boolean): AudioDecoderConfigStruct {
    const view = new DataView(module.wasmMemory.buffer);
    let off = offset;
    const codec = module.UTF8ToString(off); off += 256;
    const sample_rate = view.getInt32(off, true); off += 4;
    const num_channels = view.getInt32(off, true); off += 4;
    const descriptionPtr = readPointer(view, off, is64Bit); off += is64Bit ? 8 : 4;
    const description_size = view.getInt32(off, true);
    return { codec, sample_rate, num_channels, description: descriptionPtr, description_size };
}

export function readASSSubtitleConfig(buffer: ArrayBufferLike, offset: number, is64Bit: boolean): ASSSubtitleConfigStruct {
    const view = new DataView(buffer);
    let off = offset;
    const subtitle_header_size = view.getInt32(off, true); off += 4;
    const subtitle_headerPtr = readPointer(view, off, is64Bit);
    return { subtitle_header_size, subtitle_header: subtitle_headerPtr };
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
