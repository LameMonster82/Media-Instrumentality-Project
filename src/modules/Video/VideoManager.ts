import { FrameTime, type WorkerVideoFrame, type WorkerVideoFrameImageBitmap, type FFmpegStreams } from "../SomeTypes.ts";
import type { MediaClock } from "./MediaClock";
import { Wait, Resolve, WaitATick } from "./VideoUtils";
import { VideoStreamTrack } from "./Tracks/VideoStreamTrack.js";

export class VideoManager {
    private framesBuffer: (WorkerVideoFrame | WorkerVideoFrameImageBitmap)[] = [];
    private bufferInsertedResolves: (() => void)[] = [];
    private bufferPoppedResolves: (() => void)[] = [];
    private videoFrameWriting: Promise<void> = Promise.resolve();
    private _nextFrame: boolean = false;

    constructor(
        private clock: MediaClock, 
        private getStreams: () => FFmpegStreams[], 
        private requestVideoTrackCreation: (streamIndex: number) => Promise<VideoStreamTrack>,
        private onRenderPause: () => void 
    ) {
        this.videoLoop();
    }

    public triggerNextFrame() {
        this._nextFrame = true;
    }

    public enqueueVideo(data: WorkerVideoFrame | WorkerVideoFrameImageBitmap, isSeeking: boolean) {
        if (isSeeking) {
            if (data.kind === "videoFrame") data.videoFrame.close();
            return;
        }
        
        this.framesBuffer.push(data);
        Resolve(this.bufferInsertedResolves);
    }

    public isBufferLow(decoderQueueSize: number): boolean {
        return this.framesBuffer.length + decoderQueueSize < 33;
    }

    public isBufferEmpty(decoderQueueSize: number): boolean {
        return this.framesBuffer.length + decoderQueueSize <= 0;
    }

    public onBufferPopped(resolveArray: (() => void)[]) {
        this.bufferPoppedResolves = resolveArray;
    }

    public flush(currentTime: number, evictAll: boolean) {
        if (evictAll) {
            for (const frame of this.framesBuffer) {
                if (frame.kind === "videoFrame") frame.videoFrame.close();
            }
            this.framesBuffer.length = 0;
        } else {
            this.framesBuffer = this.framesBuffer.filter(frame => {
                const { timestamp } = FrameTime(frame);
                const shouldKeep = timestamp / 1000000 >= currentTime;
                if (!shouldKeep && frame.kind === "videoFrame") {
                    frame.videoFrame.close();
                }
                return shouldKeep;
            });
        }
    }

    public canQuickSkip(targetTimeSeconds: number): boolean {
        return this.framesBuffer.some(frame => {
            const { timestamp, duration } = FrameTime(frame);
            return timestamp / 1000000 <= targetTimeSeconds && (timestamp + duration) / 1000000 >= targetTimeSeconds;
        });
    }

    public getLeastBufferTime(mediaDuration: number): number {
        if (this.framesBuffer.length === 0) return mediaDuration;
        let leastTime = 0;
        for (const frame of this.framesBuffer) {
            const { timestamp, duration } = FrameTime(frame);
            leastTime = Math.max(leastTime, (timestamp + duration) / 1000000);
        }
        return leastTime;
    }

    public getBufferInsertedResolvers() {
        return this.bufferInsertedResolves;
    }

    private async videoLoop() {
        while (true) {
            if (!this.clock.isPlaying && !this.clock.isSeeking) {
                await WaitATick();
                continue;
            }

            if (this.framesBuffer.length <= 0) {
                await Wait(this.bufferInsertedResolves);
                continue;
            }

            let frame = this.framesBuffer[0];
            const { timestamp } = FrameTime(frame);
            const timeInSeconds = timestamp / 1000000;

            if (this.clock.currentTime >= timeInSeconds) {
                let streamTrack = this.getStreams()[frame.streamIndex].mediaStream;
                if (!streamTrack || !(streamTrack instanceof VideoStreamTrack)) {
                    streamTrack = await this.requestVideoTrackCreation(frame.streamIndex);
                }

                await this.videoFrameWriting;
                frame = this.framesBuffer.shift()!;
                
                this.videoFrameWriting = (streamTrack as VideoStreamTrack).WriteData(frame);

                if (this._nextFrame) {
                    this._nextFrame = false;
                    this.onRenderPause();
                }

                Resolve(this.bufferPoppedResolves);
            } else {
                await WaitATick();
            }
        }
    }
}