import type { Intent } from "@/player/types";
import type { MediaStreamTrackWrapper } from "../types";
import type { WorkerAudioDataInit } from "./audioTypes";

export class AudioStreamTrackNative implements MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    private writableStream: WritableStream<AudioData>;
    private track: MediaStreamTrackGenerator<AudioData>;
    private writer: WritableStreamDefaultWriter<AudioData>;

    public startTime: number = 0;

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

    enable(enable: boolean): void {
        this.track.enabled = enable;
    }

    async writeData(audioData: AudioData | WorkerAudioDataInit): Promise<void> {
        let audio;
        if (audioData instanceof AudioData) {
            audio = audioData;
        } else {
            audioData.transfer = audioData.transferable as ArrayBuffer[];
            audio = new AudioData({
                format: audioData.format,
                numberOfChannels: audioData.numberOfChannels,
                numberOfFrames: audioData.numberOfFrames,
                sampleRate: audioData.sampleRate,
                timestamp: audioData.timestamp,
                data: audioData.data[0],
                transfer: audioData.data.map(d => d.buffer)
            });
        }

        await this.writer.write(audio);
    }

    getTrack(): MediaStreamTrackGenerator<AudioData> {
        return this.track;
    }

    intent(_intent: Intent, _time: number): Promise<void> {
        return Promise.resolve();
    }

    destroy(): void {
        this.track.stop();
        this.writer.close();
    }

}
