import type { MediaStreamTrackWrapper } from "../types";
import type { MediaStreamTrackWritable } from "./videoTypes";

export class VideoStreamTrackChrome implements MediaStreamTrackWrapper<VideoFrame> {
    private writableStream: WritableStream<VideoFrame>;
    private track: MediaStreamTrackWritable<VideoFrame>;
    private writer: WritableStreamDefaultWriter<VideoFrame>;
    private frameWriteTime: number = 0;

    constructor() {
        this.track = new MediaStreamTrackGenerator({ kind: 'video' });
        this.track.contentHint = "motion";
        this.writableStream = this.track.writable;
        this.writer = this.writableStream.getWriter();
    }
    async initialize() { }
    async stealPlayEvent() { }
    latency() { return this.frameWriteTime }

    public async writeData(frame: VideoFrame): Promise<void> {
        const now = performance.now();
        await this.writer.write(frame);
        this.frameWriteTime = performance.now() - now;
    }

    enable(enable: boolean) {
        this.track.enabled = enable;
    }

    getTrack(): MediaStreamTrackWritable<VideoFrame> {
        return this.track;
    }

    async seekTo(_time: number, _fastSeek: boolean): Promise<void> { }

    destroy() {
        this.track.stop();
        this.writer.close();
    }
}

