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
export interface WorkerAudioDataInit extends WorkerPostMessage, AudioDataInit {
    readonly kind: "audioDataInit";
    readonly streamIndex: number;
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
