import type { MediaClock } from "./MediaClock";
import type { AudioStreamTrack } from "./Tracks/audio/AudioStreamTrack";
import type { AudioStreamTrackNative } from "./Tracks/audio/AudioStreamTrackNative";
import type { WorkerAudioData, WorkerAudioDataInit } from "./Tracks/audio/audioTypes";
import type { AnyStreamTrack } from "./Tracks/types";


export class AudioManager {
    private audiosBuffer: (WorkerAudioData | WorkerAudioDataInit)[] = [];
    private bufferInsertedResolves: (() => void)[] = [];
    private bufferPoppedResolves: (() => void)[] = [];
    private audioFrameWriting: Promise<void> = Promise.resolve();

    private clock: MediaClock;
    private getStreams: () => AnyStreamTrack[];
    private requestAudioTrackCreation: (streamIndex: number) => AudioStreamTrack | AudioStreamTrackNative;

    constructor(clock: MediaClock, getStreams: () => AnyStreamTrack[], newTrackCreator: (streamIndex: number) => AudioStreamTrack | AudioStreamTrackNative) {
        this.clock = clock;
        this.getStreams = getStreams;
        this.requestAudioTrackCreation = newTrackCreator;
        this.audioLoop();
    }

    public enqueueAudio(data: WorkerAudioDataInit | WorkerAudioData, isSeeking: boolean) {
        if (isSeeking) {
            if (data.kind === "audioData") data.audioData.close();
            return;
        }

        this.audiosBuffer.push(data);
        this.audiosBuffer.sort((a, b) => {
            const aTime = a.kind === "audioData" ? a.audioData.timestamp : a.dataBuffer.timestamp;
            const bTime = b.kind === "audioData" ? b.audioData.timestamp : b.dataBuffer.timestamp;
            return aTime - bTime;
        });

        Resolve(this.bufferInsertedResolves);
    }

    public isBufferLow(decoderQueueSize: number): boolean {
        return this.audiosBuffer.length + decoderQueueSize < 33;
    }

    public isBufferEmpty(decoderQueueSize: number): boolean {
        return this.audiosBuffer.length + decoderQueueSize <= 0;
    }

    public onBufferPopped(resolveArray: (() => void)[]) {
        this.bufferPoppedResolves = resolveArray;
    }

    public flush(currentTime: number, evictAll: boolean) {
        if (evictAll) {
            for (const audio of this.audiosBuffer) {
                if (audio.kind === "audioData") audio.audioData.close();
            }
            this.audiosBuffer.length = 0;
        } else {
            this.audiosBuffer = this.audiosBuffer.filter(audio => {
                const { timestamp } = AudioTime(audio);
                const shouldKeep = timestamp / 1000000 >= currentTime;
                if (!shouldKeep && audio.kind === "audioData") {
                    audio.audioData.close();
                }
                return shouldKeep;
            });
        }
    }

    public canQuickSkip(targetTimeSeconds: number): boolean {
        return this.audiosBuffer.some(audio => {
            const { timestamp, duration } = AudioTime(audio);
            return timestamp / 1000000 <= targetTimeSeconds && (timestamp + duration) / 1000000 >= targetTimeSeconds;
        });
    }

    public getLeastBufferTime(mediaDuration: number): number {
        if (this.audiosBuffer.length === 0) return mediaDuration;
        let leastTime = 0;
        for (const audio of this.audiosBuffer) {
            const { timestamp, duration } = AudioTime(audio);
            leastTime = Math.max(leastTime, (timestamp + duration) / 1000000);
        }
        return leastTime;
    }

    public getBufferInsertedResolvers() {
        return this.bufferInsertedResolves;
    }

    private async audioLoop() {
        while (true) {
            if (!this.clock.isPlaying && !this.clock.isSeeking) {
                await WaitATick();
                continue;
            }

            if (this.audiosBuffer.length <= 0) {
                await Wait(this.bufferInsertedResolves);
                continue;
            }

            let data = this.audiosBuffer[0];
            const { timestamp, duration } = AudioTime(data);
            const timeInSeconds = timestamp / 1000000;

            if (this.clock.RealTime() >= timeInSeconds - (duration / 1000000)) {
                let streamTrack = this.getStreams()[data.streamIndex].mediaStream;

                if (!streamTrack || (!(streamTrack instanceof AudioStreamTrack) && !(streamTrack instanceof AudioStreamTrackNative))) {
                    streamTrack = this.requestAudioTrackCreation(data.streamIndex);
                }

                await this.audioFrameWriting;
                this.clock.AdvanceMediaTime(timeInSeconds);
                data = this.audiosBuffer.shift()!;
                this.audioFrameWriting = streamTrack.WriteData(data, this.clock.RealTime());

                Resolve(this.bufferPoppedResolves);
            } else {
                await WaitATick();
            }
        }
    }
}
