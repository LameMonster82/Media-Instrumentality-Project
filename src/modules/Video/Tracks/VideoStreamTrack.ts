import {type WorkerVideoFrame, type WorkerVideoFrameBufferInit, type StreamTrackNeeds, type WorkerVideoFrameImageBitmap, videoStreamWorkerUrl, type VideoTrackGenerator } from "@/modules/SomeTypes";
import { WebGLCanvas } from "./WebGLCanvas.js";

export class VideoStreamTrack implements StreamTrackNeeds<WorkerVideoFrame | WorkerVideoFrameBufferInit | WorkerVideoFrameImageBitmap> {
    private writableStream: WritableStream<VideoFrame> | undefined;
    private worker: Worker | undefined;
    private track: MediaStreamTrack | undefined;
    private isBitmapRenderer: boolean = false;

    public async Initialize() {
        this.track = await this.createTrackGenerator();
        this.track!.contentHint = "motion";
        // @ts-ignore
        if (this.track.writable)
            // @ts-ignore
            this.writableStream = this.track.writable;
    }

    private async createTrackGenerator(): Promise<MediaStreamTrackGenerator<VideoFrame> | MediaStreamTrack> {
        if ('MediaStreamTrackGenerator' in self) {
            // Chrome or browsers supporting MediaStreamTrackGenerator natively
            return new MediaStreamTrackGenerator({ kind: 'video' });
        } else if (navigator.userAgent.includes('Safari') && parseInt(navigator.userAgent.match(/Version\/(\d+)/)?.[1] || '0') >= 18) {
            // Safari 18.0+ using Web Worker
            return this.CreateSafariTrack();
        } else {
            this.isBitmapRenderer = true;
            // Older Safari or Firefox fallback
            return this.CreateBitmapTrack();
        }
    }

    public async WriteData(frameData: WorkerVideoFrame | WorkerVideoFrameBufferInit | WorkerVideoFrameImageBitmap): Promise<void> {
        let frame: VideoFrame;
        if (frameData.kind === "videoFrame") {
            frame = frameData.videoFrame;
        } else if (frameData.kind === "FrameBitmapConstructor") {
            if (this.isBitmapRenderer) {
                frame = (frameData as any).imageBitmap;
            } else {
                frame = new VideoFrame(frameData.imageBitmap, frameData.videoInfo);
            }
        }
        else {
            // @ts-ignore
            frameData.videoInfo.transfer = [frameData.videoBuffer.buffer];
            frame = new VideoFrame(frameData.videoBuffer, frameData.videoInfo);
        }
        if (this.worker) {
            return new Promise((resolve) => {
                this.worker!.onmessage = () => resolve();
                this.worker!.postMessage(frame, [frame]);
            });
        }

        const writer = this.writableStream!.getWriter();
        try {
            await writer.write(frame);
        } finally {
            writer.releaseLock();
        }
    }

    public Enable(enable: boolean) {
        if (this.track)
            this.track.enabled = enable;
    }

    CreateSafariTrack() {
        this.worker = new Worker(videoStreamWorkerUrl, { type: 'module' });
        return new Promise<MediaStreamTrack>((resolve) => {
            this.worker!.onmessage = (e) => {
                if (e.data.track) {
                    resolve(e.data.track as MediaStreamTrack);
                }
            };
            this.worker!.postMessage({ type: 'init' });
        });
    }

    CreateWebGLTrack(): MediaStreamTrack {
        const canvas = document.createElement("canvas"); // No Recording on Offscreen Canvases
        const glCanvas = new WebGLCanvas(canvas);
        // NOTE: We cant move this to a web worker because we CANT CAPTURE A CANVAS
        const stream = canvas.captureStream();
        const track = stream.getVideoTracks()[0] as any;
        let canvasWidth = canvas.width;
        let canvasHeight = canvas.height;
        track.writable = new WritableStream<VideoFrame>({
            async write(frame: VideoFrame) {
                if (canvasWidth !== frame.displayWidth || canvasHeight !== frame.displayHeight) {
                    canvas.width = canvasWidth = frame.displayWidth;
                    canvas.height = canvasHeight = frame.displayHeight;
                    glCanvas.UpdateViewport();
                }

                glCanvas.DrawFrame(frame);
            }
        });
        return track;
    }

    CreateBitmapTrack(): MediaStreamTrack {
        const canvas = document.createElement("canvas"); // No Recording on Offscreen Canvases
        const context = canvas.getContext('bitmaprenderer', { alpha: false })!;
        // NOTE: We cant move this to a web worker because we CANT CAPTURE A CANVAS
        const stream = canvas.captureStream();
        const track = stream.getVideoTracks()[0] as any;
        let canvasWidth = canvas.width;
        let canvasHeight = canvas.height;
        track.writable = new WritableStream<ImageBitmap | VideoFrame>({
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
        return track;
    }

    GetTrack(): MediaStreamTrack {
        return this.track!;
    }

    SeekTo(time: number, fastSeek: boolean): Promise<void> {
        return Promise.resolve();
    }

    Destroy() {
        this.track?.stop();
        this.writableStream?.abort();
        this.worker?.terminate();
    }
}

// Worker stuff for VideoTrackGenerator
let videoGen: VideoTrackGenerator | undefined;
let videoWriter: WritableStreamDefaultWriter<VideoFrame> | undefined;
self.onmessage = async (e: MessageEvent<VideoFrame | { type: 'init'; }>) => {
    if (e.data instanceof VideoFrame) {
        await videoWriter!.write(e.data);
        self.postMessage({ type: "done" });
    } else if (e.data.type == "init") {
        videoGen = new self.VideoTrackGenerator();
        videoWriter = videoGen!.writable.getWriter();
        // @ts-ignore
        self.postMessage({ track: videoGen.track }, [videoGen.track]);
    }
};
