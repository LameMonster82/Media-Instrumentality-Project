import type { Dictionary } from "@/modules/SomeTypes";
import type { AVColorPrimaries, AVColorRange, AVColorSpace, AVColorTransferCharacteristic, AVPictureType } from "@/modules/Video/FFmpeg/AVTypes";

export interface FFmpegWorker extends DedicatedWorkerGlobalScope {
    is_stream_supported: (stream_index: number) => 0 | 1 | -1;
    submit_raw_packet: (packetRaw: {
        index: number;
        flags: number;
        timestamp: number;
        duration: number;
        dataPtr: number;
        dataSize: number;
    }) => number;
    submit_video_frame: (frame: {
        width: number;
        height: number;
        crop_top: number;
        crop_bottom: number;
        crop_left: number;
        crop_right: number;
        format: number;
        key_frame: number;
        pict_type: AVPictureType;
        pts: bigint;
        ts_js: number;
        time_base_num: number;
        time_base_den: number;
        duration: bigint;
        duration_js: number;
        src_data: number;
        src_linesize: number;
        colorRange: AVColorRange;
        colorSpace: AVColorSpace;
        colorPrimative: AVColorPrimaries;
        colorTransfer: AVColorTransferCharacteristic;
        stream_index: number;
    }) => void;
    submit_audio_frame: (data: {
        channels: number;
        sampleRate: number;
        samples: number;
        data: number;
        bytesPerSample: number;
        ts_js: number;
        stream_index: number;
    }) => void;
    submit_subtitle_bitmap: (data: {
        stream_index: number;
        data: number;
        data_size: number;
        x: number;
        y: number;
        width: number;
        height: number;
        ts_js: bigint;
        start_ms: bigint;
        end_ms: bigint;
    }) => void;
    submit_subtitle_ass: (data: {
        stream_index: number;
        dialog: string;
        start_time: bigint;
        end_time: bigint;
    }) => void;
    seek_video_data: (offset: bigint, whence: number) => bigint;
    submit_thumbnail: (data: {
        is_raw: number;
        data: number;
        data_size: number;
        width: number;
        height: number;
        format: number;
    }) => void;
    submit_demuxers: (data: {
        extension: string;
        long_name: string;
        mime_type: string;
        name: string;
    }[]) => void;
    fetch_video_data: (ptr: number, size: number) => number,
    submit_file_info: (stream_index: number, data: {
        [key: string]: string;
    }) => void,
    submit_attachment: (metadata: Dictionary<string>, data: number, data_size: number) => void,
    submit_video_config: (config: FFmpegVideoConfig) => void,
    submit_audio_config: (config: FFmpegAudioConfig) => void,
    submit_subtitle_config: (data: {
        stream_index: number,
        duration: number;
        header_ptr: number,
        header_size: number;
    }) => void,
    submit_chapter_info: (chapter_index: bigint, start_js: bigint, end_js: bigint, data: { [key: string]: string; }) => void,
}

export type FFmpegVideoConfig = {
    index: number, codec: string, codedHeight: number, codedWidth: number, description: number, descriptionSize: number; duration: number;
    colorRange: AVColorRange;
    colorSpace: AVColorSpace;
    colorPrimative: AVColorPrimaries;
    colorTransfer: AVColorTransferCharacteristic;
};

export type FFmpegAudioConfig = {
    index: number,
    codec: string,
    sampleRate: number,
    numberOfChannels: number,
    description: number,
    descriptionSize: number;
    duration: number;
}


