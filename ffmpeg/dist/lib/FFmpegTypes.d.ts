import type { AVColorRange, AVColorSpace, AVColorPrimaries, AVColorTransferCharacteristic } from "@/player/FFmpeg/advancedTypes/AVTypes";

export interface FFmpegWorker extends DedicatedWorkerGlobalScope {
    _ffmpeg_notify: (eventType: number, ptr: number) => number;
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
