import type { WorkerPostMessage } from "@/core/types";
import type { FFmpegStream } from "../types";

interface AudioDataInitArrayBuffer extends AudioDataInit {
    data: ArrayBuffer;
}

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
    readonly streamIndex: number;
    readonly dataBuffer: AudioDataInitArrayBuffer;
    readonly transferable: ArrayBufferLike[];
}

export interface AudioFFmpegStream extends FFmpegStream<WorkerAudioData | WorkerAudioDataInit> {
    type: "audio",
    sampleRate: number;
    channels: number;
}

export function audioTime(audio: WorkerAudioDataInit | WorkerAudioData) {
    return {
        timestamp: audio.kind === "audioData" ? audio.audioData.timestamp : audio.dataBuffer.timestamp,
        duration: audio.kind === "audioData" ? audio.audioData.duration! : (audio.dataBuffer.numberOfFrames / audio.dataBuffer.sampleRate) * 1000000
    };
}
