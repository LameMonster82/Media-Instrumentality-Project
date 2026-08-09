import type { Dictionary } from "@/core/types";
import type { AudioFFmpegStream } from "./audio/audioTypes";
import type { VideoFFmpegStream } from "./video/videoTypes";
import type { SubtitleFFmpegStream } from "./subtitles old/subtitleStream";

export interface MediaStreamTrackWrapper<T> {
    initialize(): Promise<void>;
    enable(enable: boolean): void;
    getTrack(): MediaStreamTrack | null;
    writeData(data: T, currentTime?: number): Promise<void>;
    seekTo(time: number, fastSeek: boolean): Promise<void>;
    destroy(): void;
}

export type AnyMediaStreamTrack = MediaStreamTrackWrapper<unknown>;

export type AllStreamTrackTypes = AudioFFmpegStream | VideoFFmpegStream | SubtitleFFmpegStream;

export interface FFmpegStream<T> {
    type: string,
    index: number,
    isSupported: boolean,
    isUsed: boolean;
    duration: number,
    metadata: Dictionary<string>;
    mediaStream?: MediaStreamTrackWrapper<T>;
}

declare global {
    interface Window {
        MediaStreamTrackGenerator: typeof MediaStreamTrackGenerator;
    }

    /**
     * The **`MediaStreamTrackGenerator`** interface of the Insertable Streams API that creates
     * Writable streams for WebCodec Data like Video Frames or Audio.
     * Only supported by Chrome-based browsers for now
     *
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrackGenerator)
     */
    export interface MediaStreamTrackGenerator<T extends VideoFrame | AudioData = VideoFrame | AudioData>
        extends MediaStreamTrack {
        readonly writable: WritableStream<T>;
    }


    // eslint-disable-next-line no-var, @typescript-eslint/naming-convention
    export var MediaStreamTrackGenerator: {
        new(options: { kind: "video"; }): MediaStreamTrackGenerator<VideoFrame>;
        new(options: { kind: "audio"; }): MediaStreamTrackGenerator<AudioData>;
        prototype: MediaStreamTrackGenerator;
    };
}
