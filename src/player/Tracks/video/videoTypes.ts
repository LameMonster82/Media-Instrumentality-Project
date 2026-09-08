import type { WorkerPostMessage } from "@/core/types";

/** It is supposed to kinda copy the return type of MediaStreamTrackGenerator()
 * where you have a media stream and a writable stream where you can write frames
 * into.
 *
 * https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackGenerator#instance_properties
 */
export interface MediaStreamTrackWritable<T> extends MediaStreamTrack {
    writable: WritableStream<T>
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
