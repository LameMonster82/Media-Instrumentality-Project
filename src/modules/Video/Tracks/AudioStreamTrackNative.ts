import type { StreamTrackNeeds, WorkerAudioData, WorkerAudioDataInit } from "@/modules/SomeTypes";

export class AudioStreamTrackNative implements StreamTrackNeeds<WorkerAudioData | WorkerAudioDataInit> {
    private writableStream: WritableStream<AudioData>;
    private track: MediaStreamTrackGenerator<AudioData>;

    public static IsSupported(): boolean {
        return 'MediaStreamTrackGenerator' in self && 'AudioData' in self;
    }

    constructor() {
        if (!AudioStreamTrackNative.IsSupported())
            throw new Error("Native not supported. Use AudioStreamTrack instead");

        const track = new MediaStreamTrackGenerator({ kind: 'audio' });
        this.writableStream = track.writable;
        this.track = track;
    }


    Initialize(): Promise<void> {
        return Promise.resolve();
    }
    Enable(enable: boolean): void {
        if (this.track)
            this.track.enabled = enable;
    }

    async WriteData(audioData: WorkerAudioData | WorkerAudioDataInit): Promise<void> {
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

    GetTrack(): MediaStreamTrackGenerator<AudioData> {
        return this.track;
    }

    SeekTo(time: number, fastSeek: boolean): Promise<void> {
        return Promise.resolve();
    }

    Destroy(): void {
        this.track?.stop();
        this.writableStream?.abort();
    }

}
