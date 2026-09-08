import type { MediaStreamTrackWrapper } from "../types";
import type { MediaStreamTrackWritable } from "./videoTypes";
import { WebGLCanvas } from "./WebGLCanvas";
import { getFrameSize } from "./utils";
import type { Intent } from "@/player/types";

export class VideoStreamTrackFallback implements MediaStreamTrackWrapper<VideoFrame> {
    private writableStream: WritableStream<VideoFrame>;
    private track: MediaStreamTrackWritable<VideoFrame>;
    private writer: WritableStreamDefaultWriter<VideoFrame>;
    private frameTimeWrite = 0;

    public startTime: number = 0;

    constructor() {
        this.track = this.createBitmapTrack()
        this.track.contentHint = "motion";
        this.writableStream = this.track.writable;
        this.writer = this.writableStream.getWriter();
    }

    latency(): number {
        return this.frameTimeWrite;
    }

    public async writeData(frame: VideoFrame): Promise<void> {
        const now = performance.now();
        await this.writer.write(frame);
        this.frameTimeWrite = performance.now() - now;
    }

    enable(enable: boolean) {
        this.track.enabled = enable;
    }

    createWebGLTrack(): MediaStreamTrackWritable<VideoFrame> {
        const canvas = document.createElement("canvas"); // No Recording on Offscreen Canvases
        const glCanvas = new WebGLCanvas(canvas);
        // NOTE: We cant move this to a web worker because we CANT CAPTURE A CANVAS
        const stream = canvas.captureStream();
        const track = stream.getVideoTracks()[0];
        let canvasWidth = canvas.width;
        let canvasHeight = canvas.height;

        // Turn it into a writable stream
        const trackWritable = track as MediaStreamTrackWritable<VideoFrame>;
        trackWritable.writable = new WritableStream<VideoFrame>({
            async write(frame: VideoFrame) {
                const { width, height } = getFrameSize(frame, true);
                if (canvasWidth !== width || canvasHeight !== height) {
                    canvas.width = canvasWidth = width;
                    canvas.height = canvasHeight = height;
                    glCanvas.updateViewport();
                }

                glCanvas.drawFrame(frame);
            }
        });
        return trackWritable;
    }

    createBitmapTrack(): MediaStreamTrackWritable<VideoFrame> {
        const canvas = document.createElement("canvas"); // No Recording on Offscreen Canvases
        const context = canvas.getContext('bitmaprenderer', { alpha: false })!;
        // NOTE: We cant move this to a web worker because we CANT CAPTURE A CANVAS
        const stream = canvas.captureStream();
        const track = stream.getVideoTracks()[0];
        let canvasWidth = canvas.width;
        let canvasHeight = canvas.height;

        const trackWritable = track as MediaStreamTrackWritable<VideoFrame>;
        trackWritable.writable = new WritableStream<VideoFrame>({
            async write(frame: VideoFrame) {
                const frame2 = await createImageBitmap(frame);
                //frame.close();

                if (canvasWidth !== frame2.width || canvasHeight !== frame2.height) {
                    canvas.width = canvasWidth = frame2.width;
                    canvas.height = canvasHeight = frame2.height;
                }

                context.transferFromImageBitmap(frame2);
                frame2.close();
            }
        });
        return trackWritable;
    }

    getTrack(): MediaStreamTrackWritable<VideoFrame> {
        return this.track;
    }

    intent(_intent: Intent, _time: number): Promise<void> {
        return Promise.resolve();
    }

    destroy() {
        this.track.stop();
        this.writer.close();
    }
}

