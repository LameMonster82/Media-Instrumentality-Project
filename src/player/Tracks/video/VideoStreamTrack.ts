import { promiseRes } from "@/core/utils";
import type { MediaStreamTrackWrapper } from "../types";
import type { AllVideoFrameTypes, MediaStreamTrackWritable, WorkerVideoFrame, WorkerVideoFrameBufferInit, WorkerVideoFrameImageBitmap } from "./videoTypes";
import { WebGLCanvas } from "./WebGLCanvas";
import { getFrameSize } from "./utils";
import safariVideoTrackWorker from "./videoTrack.worker?worker";

export class VideoStreamTrack implements MediaStreamTrackWrapper<VideoFrame | ImageBitmap> {
    private writableStream: WritableStream<ImageBitmap | VideoFrame> | undefined;
    private worker: Worker | undefined;
    private track: MediaStreamTrackWritable<VideoFrame | ImageBitmap> | undefined;

    public async initialize() {
        this.track = await this.createTrackGenerator();
        this.track!.contentHint = "motion";
        this.writableStream = this.track.writable;
    }

    private async createTrackGenerator(): Promise<MediaStreamTrackWritable<VideoFrame | ImageBitmap>> {
        if ('MediaStreamTrackGenerator' in self) {
            // Chrome or browsers supporting MediaStreamTrackGenerator natively
            return new MediaStreamTrackGenerator({ kind: 'video' });
        } else if (navigator.userAgent.includes('Safari') && parseInt(navigator.userAgent.match(/Version\/(\d+)/)?.[1] || '0') >= 18) {
            // Safari 18.0+ using Web Worker
            return this.createSafariTrack();
        } else {
            // Older Safari or Firefox fallback
            return this.createWebGLTrack();
        }
    }

    public async writeData(frame: VideoFrame | ImageBitmap): Promise<void> {
        
        /*
        if (frameData.kind === "videoFrame") {
            frame = frameData.videoFrame;
        } else if (frameData.kind === "FrameBitmapConstructor") {
            if (this.isBitmapRenderer && !this.worker) {
                frame = frameData.imageBitmap;
            } else {
                frame = new VideoFrame(frameData.imageBitmap, frameData.videoInfo);
            }
        } else {
            frameData.videoInfo.transfer = [frameData.videoBuffer.buffer];
            frame = new VideoFrame(frameData.videoBuffer, frameData.videoInfo);
        }
        */

        if (this.worker) {
            this.worker.postMessage(frame, [frame]);
            return;
        }

        const writer = this.writableStream!.getWriter();
        try {
            await writer.write(frame);
        } finally {
            writer.releaseLock();
        }
    }

    enable(enable: boolean) {
        if (this.track)
            this.track.enabled = enable;
    }

    createSafariTrack() {
        const { promise, resolve } = promiseRes<MediaStreamTrackWritable<VideoFrame>>();

        this.worker = safariVideoTrackWorker({ name: "Web worker that holds VideoTrackGenerator more or less" });
        this.worker.addEventListener('message', (e: MessageEvent<{ track: MediaStreamTrack; }>) => {
            resolve(e.data.track as MediaStreamTrackWritable<VideoFrame>);
        }, { once: true });


        this.worker.postMessage({ type: 'init' });
        return promise;
    }

    createWebGLTrack(): MediaStreamTrackWritable<VideoFrame | ImageBitmap> {
        const canvas = document.createElement("canvas"); // No Recording on Offscreen Canvases
        const glCanvas = new WebGLCanvas(canvas);
        // NOTE: We cant move this to a web worker because we CANT CAPTURE A CANVAS
        const stream = canvas.captureStream();
        const track = stream.getVideoTracks()[0];
        let canvasWidth = canvas.width;
        let canvasHeight = canvas.height;

        // Turn it into a writable stream
        const trackWritable = track as MediaStreamTrackWritable<VideoFrame | ImageBitmap>;
        trackWritable.writable = new WritableStream<VideoFrame>({
            async write(frame: VideoFrame | ImageBitmap) {
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

    createBitmapTrack(): MediaStreamTrackWritable<VideoFrame | ImageBitmap> {
        const canvas = document.createElement("canvas"); // No Recording on Offscreen Canvases
        const context = canvas.getContext('bitmaprenderer', { alpha: false })!;
        // NOTE: We cant move this to a web worker because we CANT CAPTURE A CANVAS
        const stream = canvas.captureStream();
        const track = stream.getVideoTracks()[0];
        let canvasWidth = canvas.width;
        let canvasHeight = canvas.height;

        const trackWritable = track as MediaStreamTrackWritable<VideoFrame | ImageBitmap>;
        trackWritable.writable = new WritableStream<ImageBitmap | VideoFrame>({
            async write(frame: ImageBitmap | VideoFrame) {
                if (frame instanceof VideoFrame) {
                    const frame2 = await createImageBitmap(frame);
                    frame.close();
                    frame = frame2;
                }

                if (canvasWidth !== frame.width || canvasHeight !== frame.height) {
                    canvas.width = canvasWidth = frame.width;
                    canvas.height = canvasHeight = frame.height;
                }

                context.transferFromImageBitmap(frame);
                frame.close();
            }
        });
        return trackWritable;
    }

    getTrack(): MediaStreamTrackWritable<VideoFrame | ImageBitmap> {
        return this.track!;
    }

    seekTo(_time: number, _fastSeek: boolean): Promise<void> {
        return Promise.resolve();
    }

    destroy() {
        this.track?.stop();
        this.writableStream?.abort();
        this.worker?.terminate();
    }
}

