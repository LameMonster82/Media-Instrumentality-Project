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
            audio = this.audioDataInitToAudioData(audioData);
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

    audioDataInitToAudioData(data: WorkerAudioDataInit) {
        const outData = new Float32Array(data.data.map(d => d.length).reduce((a, b) => a + b));
        let format = data.format;

        if (data.format.endsWith("-planar")) {
            debugger
        } else {
            let offset = 0;
            for (const buffer of data.data) {
                outData.set(buffer, offset);
                offset += buffer.length;
            }
            format = format + "-planar" as AudioSampleFormat;
        }

        return new AudioData({
            format: format,
            numberOfChannels: data.numberOfChannels,
            numberOfFrames: data.numberOfFrames,
            sampleRate: data.sampleRate,
            timestamp: data.timestamp,
            data: outData,
            transfer: [outData.buffer]
        });
    }
}
