import type { MediaStreamTrackWrapper } from "../types";
import type { WorkerAudioData, WorkerAudioDataInit } from "./audioTypes";

export class AudioStreamTrackNative implements MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    private writableStream: WritableStream<AudioData>;
    private track: MediaStreamTrackGenerator<AudioData>;
    private writer: WritableStreamDefaultWriter<AudioData>;

    public static isSupported(): boolean {
        return 'MediaStreamTrackGenerator' in self && 'AudioData' in self;
    }

    constructor() {
        if (!AudioStreamTrackNative.isSupported())
            throw new Error("Native not supported. Use **AudioStreamTrack** instead");

        const track = new MediaStreamTrackGenerator({ kind: 'audio' });
        this.writableStream = track.writable;
        this.track = track;
        this.writer = this.writableStream.getWriter();
    }


    initialize(): Promise<void> {
        return Promise.resolve();
    }
    enable(enable: boolean): void {
        if (this.track)
            this.track.enabled = enable;
    }

    async writeData(audioData: AudioData | WorkerAudioDataInit): Promise<void> {
        let audio;
        if (audioData instanceof AudioData) {
            audio = audioData;
        } else {
            audioData.transfer = audioData.transferable as ArrayBuffer[];
            audio = new AudioData(audioData);
        }

        await this.writer.write(audio);
    }

    getTrack(): MediaStreamTrackGenerator<AudioData> {
        return this.track;
    }

    seekTo(_time: number, _fastSeek: boolean): Promise<void> {
        return Promise.resolve();
    }

    destroy(): void {
        this.track.stop();
        this.writer.close();
    }

}
