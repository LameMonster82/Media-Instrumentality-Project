import type { WorkerPostMessage } from "@/core/types";

/** Timestamp and duration in Microseconds */
export interface WorkerAudioDataInit extends WorkerPostMessage {
    readonly kind: "audioDataInit";
    readonly data: Float32Array<ArrayBuffer>[];
    readonly format: AudioSampleFormat;
    readonly numberOfChannels: number;
    readonly numberOfFrames: number;
    readonly sampleRate: number;
    readonly timestamp: number;
    transfer?: ArrayBuffer[];
}

export interface WorkerAudioFlush extends WorkerPostMessage {
    readonly kind: "flush"
}
export interface WorkerAudioClose extends WorkerPostMessage {
    readonly kind: "close"
}

export type AllAudioWorkletMessages = WorkerAudioDataInit | WorkerAudioFlush | WorkerAudioClose;

export function audioTime(audio: AudioData | WorkerAudioDataInit) {
    return {
        timestamp: audio.timestamp,
        duration: audio instanceof AudioData ? audio.duration! : (audio.numberOfFrames / audio.sampleRate) * 1000000
    };
}


export const workletName = "AudioStreamShim";