import type { WorkerPostMessage } from "@/core/types";
import type { FFmpegStream } from "../types";

/** You can add a byte array that will be used directly in the creation
 * of the frame. The browser will take ownership of it rather than copying it
 * Its unknown which browsers support it but it doesnt hurt to have it
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/VideoFrame#transfer_2
 */
export interface VideoFrameBufferInitZeroCopy extends VideoFrameBufferInit {
    transfer?: ArrayBufferLike[]
}

/** It is supposed to kinda copy the return type of MediaStreamTrackGenerator()
 * where you have a media stream and a writable stream where you can write frames
 * into.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackGenerator#instance_properties
 */
export interface MediaStreamTrackWritable<T> extends MediaStreamTrack {
    writable: WritableStream<T>
}

/** Timestamp and duration in Microseconds */
export interface WorkerVideoFrame extends WorkerPostMessage {
    readonly kind: "videoFrame";

    readonly streamIndex: number;
    readonly videoFrame: VideoFrame;
    readonly transferable: VideoFrame[];
}

// Ended up not using it. Use it in places that WorkerVideoFrame is
export interface WorkerVideoFrameBufferInit extends WorkerPostMessage {
    readonly kind: "videoConstructor";
    /** Timestamp and duration in Microseconds */
    readonly streamIndex: number;
    readonly videoInfo: VideoFrameBufferInitZeroCopy;
    readonly videoBuffer: Uint8Array;
    readonly transferable: ArrayBufferLike[];
}

/** Timestamp and duration in Microseconds */
export interface WorkerVideoFrameImageBitmap extends WorkerPostMessage {
    readonly kind: "FrameBitmapConstructor";
    readonly streamIndex: number;
    readonly videoInfo: VideoFrameBufferInitZeroCopy;
    readonly imageBitmap: ImageBitmap;
}

export type AllVideoFrameTypes = WorkerVideoFrame; // | WorkerVideoFrameBufferInit | WorkerVideoFrameImageBitmap;

export interface VideoFFmpegStream extends FFmpegStream<AllVideoFrameTypes> {
    type: "video";
}

export interface VideoTrackGenerator {
    track: MediaStreamTrack,
    muted: boolean,
    writable: WritableStream<VideoFrame>;
}

declare global {
    interface DedicatedWorkerGlobalScope {
        /** The VideoTrackGenerator interface of the Insertable Streams for
         * MediaStreamTrack API has a WritableStream property that acts as
         * a MediaStreamTrack source, by consuming a stream of
         * VideoFrames as input.
         *
         * For some reason its not in spec. Probably because its only supported
         * on Safari 18+. Still incredibly faster than a canvas
         *
         * https://developer.mozilla.org/en-US/docs/Web/API/VideoTrackGenerator
         * */
        VideoTrackGenerator: {
            new(): VideoTrackGenerator;
        };


        MediaStreamTrackGenerator: typeof MediaStreamTrackGenerator;
    }
}
