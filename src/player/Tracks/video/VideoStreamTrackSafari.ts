import { promiseRes } from "@/core/utils";
import type { MediaStreamTrackWrapper } from "../types";
import type { MediaStreamTrackWritable } from "./videoTypes";
import safariVideoTrackWorker from "./videoTrack.worker?worker";

export class VideoStreamTrackSafari implements MediaStreamTrackWrapper<VideoFrame> {
    private worker: Worker;
    private writableStream: WritableStream<VideoFrame> | undefined;
    private track: MediaStreamTrackWritable<VideoFrame> | undefined;
    private initPromise: Promise<MediaStreamTrackWritable<VideoFrame>>;


    constructor() {
        const { promise, resolve } = promiseRes<MediaStreamTrackWritable<VideoFrame>>();
        this.initPromise = promise;

        this.worker = safariVideoTrackWorker({ name: "Web worker that holds VideoTrackGenerator more or less" });
        this.worker.addEventListener('message', (e: MessageEvent<{ track: MediaStreamTrack; }>) => {
            resolve(e.data.track as MediaStreamTrackWritable<VideoFrame>);
        }, { once: true });


        this.worker.postMessage({ type: 'init' });
    }

    public async initialize() {
        this.track = await this.initPromise;
        this.track.contentHint = "motion";
        this.writableStream = this.track.writable;
    }

    public async writeData(frame: VideoFrame): Promise<void> {
        this.worker.postMessage(frame, [frame]);
    }

    enable(enable: boolean) {
        if (this.track)
            this.track.enabled = enable;
    }

    getTrack(): MediaStreamTrackWritable<VideoFrame> {
        return this.track!;
    }

    seekTo(_time: number, _fastSeek: boolean): Promise<void> {
        return Promise.resolve();
    }

    destroy() {
        this.track?.stop();
        this.writableStream?.close();
        this.worker?.terminate();
    }
}

