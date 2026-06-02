import type { MediaStreamTrackWrapper } from "../types";
import type { WorkerAudioData, WorkerAudioDataInit } from "./audioTypes";

export class AudioStreamTrackNative implements MediaStreamTrackWrapper<WorkerAudioData | WorkerAudioDataInit> {
    private writableStream: WritableStream<AudioData>;
    private track: MediaStreamTrackGenerator<AudioData>;

    public static isSupported(): boolean {
        return 'MediaStreamTrackGenerator' in self && 'AudioData' in self;
    }

    constructor() {
        if (!AudioStreamTrackNative.isSupported())
            throw new Error("Native not supported. Use **AudioStreamTrack** instead");

        const track = new MediaStreamTrackGenerator({ kind: 'audio' });
        this.writableStream = track.writable;
        this.track = track;
    }


    initialize(): Promise<void> {
        return Promise.resolve();
    }
    enable(enable: boolean): void {
        if (this.track)
            this.track.enabled = enable;
    }

    async writeData(audioData: WorkerAudioData | WorkerAudioDataInit): Promise<void> {
        let audio;
        if (audioData.kind === "audioData") {
            audio = audioData.audioData;
        } else {
            audioData.dataBuffer.transfer = audioData.transferable as ArrayBuffer[];
            audio = new AudioData(audioData.dataBuffer);
        }

        const writer = this.writableStream.getWriter();
        try {
            await writer.write(audio);
        } finally {
            writer.releaseLock();
        }
    }

    getTrack(): MediaStreamTrackGenerator<AudioData> {
        return this.track;
    }

    seekTo(_time: number, _fastSeek: boolean): Promise<void> {
        return Promise.resolve();
    }

    destroy(): void {
        this.track?.stop();
        this.writableStream?.abort();
    }

}
