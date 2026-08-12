import type { WorkerPostMessage } from "@/core/types";
import type { FFmpegStream } from "../types";

/** Timestamp and duration in Microseconds */
export interface WorkerAudioData extends WorkerPostMessage {
    readonly kind: "audioData";
    readonly streamIndex: number;
    readonly audioData: AudioData;
    readonly transferable: AudioData[];
}

/** Timestamp and duration in Microseconds */
export interface WorkerAudioDataInit extends WorkerPostMessage {
    readonly kind: "audioDataInit";
    readonly data: Uint8Array;
    readonly format: AudioSampleFormat;
    readonly numberOfChannels: number;
    readonly numberOfFrames: number;
    readonly sampleRate: number;
    readonly timestamp: number;
    readonly transfer?: ArrayBufferLike[];
}

export type AllAudioFrameTypes = WorkerAudioData | WorkerAudioDataInit;

export interface AudioFFmpegStream extends FFmpegStream<AllAudioFrameTypes> {
    type: "audio",
    sampleRate: number;
    channels: number;
}

export function audioTime(audio: AudioData | WorkerAudioDataInit) {
    return {
        timestamp: audio.timestamp,
        duration: audio instanceof AudioData ? audio.duration! : (audio.numberOfFrames / audio.sampleRate) * 1000000
    };
}
