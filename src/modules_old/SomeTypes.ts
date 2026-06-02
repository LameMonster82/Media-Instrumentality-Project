import type { AssSubtitles } from "./Video/Tracks/AssSubtitleStreamTrack.js"
import type { AudioStreamTrack } from "./Video/Tracks/AudioStreamTrack.js";
import type { AudioStreamTrackNative } from "./Video/Tracks/AudioStreamTrackNative.js";
import type { BitmapSubtitle } from "./Video/Tracks/BitmapSubtitle.js";
import type { VideoStreamTrack } from "./Video/Tracks/VideoStreamTrack.js";



export interface WorkerDataTypes {
    arrayToUrl: Uint8Array;
    generateThumbnail: { blob: Blob; maxHeight: number; };
    blobToUrl: Blob;
    pathToUrl: string;
    getWidthHeight: string;
    renderVideo: { path: string, url: string, canvas: OffscreenCanvas; };
}

export type MediaThing = {
    Name: string,
    Index: number,
    Time: number,
    Codec: string,

    Size?: { Width: number, Height: number; },
    FrameRate?: number,

    Channels?: number,
    SampleRate?: number;
};

export type VideoInfo = {
    Videos: MediaThing[],
    Audios: MediaThing[],
    Subtitles: MediaThing[];
    Time: number;
    DataFiles: string[];
};

export type VideoProgressData = {
    Frame: number;
    Fps: number;
    Stream0_0Q: number;
    Bitrate: string;
    TotalSize: string;
    OutTimeUs: number;
    OutTimeMs: number;
    OutTime: string;
    DupFrames: number;
    DropFrames: number;
    Speed: number;
    Progress: string;
};

export interface SegmentTimeline {
    S: Array<{
        t?: number;  // time, optional for first segment
        d: number;   // duration
        r?: number;  // repeat count, optional for repeated segments
    }>;
}

export interface SegmentTemplate {
    timescale: number;
    initialization: string;
    media: string;
    startNumber: number;
    SegmentTimeline: SegmentTimeline;
}

export interface Representation {
    id: string;
    mimeType: string;
    codecs: string;
    bandwidth: number;
    width?: number;
    height?: number;
    sar?: string;
    audioSamplingRate?: number;
    AudioChannelConfiguration?: {
        schemeIdUri: string;
        value: number;
    };
    SegmentTemplate: SegmentTemplate;
}

export interface AdaptationSet {
    id: string;
    contentType: string;
    startWithSAP: string;
    segmentAlignment: string;
    bitstreamSwitching: string;
    frameRate?: string;
    maxWidth?: number;
    maxHeight?: number;
    par?: string;
    lang?: string;
    Representation: Representation[];
}

export interface Root {
    AdaptationSet: AdaptationSet[];
}



export interface WritableAudioContext extends WritableStream<EncodedAudioChunk> {
    arrays?: Float32Array[];
    node?: AudioWorkletNode;
}

declare global {
    interface Window {
        MediaStreamTrackGenerator: typeof MediaStreamTrackGenerator;
    }

    /**
     * The **`MediaStreamTrackGenerator`** interface of the Insertable Streams API that creates
     * Writable streams for WebCodec Data like Video Frames or Audio.
     * Only Chrome-based browsers for now
     *
     * [MDN Reference](https://developer.mozilla.org/docs/Web/API/MediaStreamTrackGenerator)
     */
    export interface MediaStreamTrackGenerator<T extends VideoFrame | AudioData = VideoFrame | AudioData>
        extends MediaStreamTrack {
        readonly writable: WritableStream<T>;
    }

    export var MediaStreamTrackGenerator: {
        new(options: { kind: "video"; }): MediaStreamTrackGenerator<VideoFrame>;
        new(options: { kind: "audio"; }): MediaStreamTrackGenerator<AudioData>;
        prototype: MediaStreamTrackGenerator;
    };

    interface HTMLVideoElement {
        /** Enters fullscreen mode.
         *
         *  [Apple Dev Page](https://developer.apple.com/documentation/webkitjs/htmlvideoelement/1633500-webkitenterfullscreen)
         */
        webkitEnterFullscreen(): void;
        /** A Boolean value indicating whether the video can be played in fullscreen mode.
         *
         *  [Apple Dev Page](https://developer.apple.com/documentation/webkitjs/htmlvideoelement/1628805-webkitsupportsfullscreen)
         */
        readonly webkitSupportsFullscreen: boolean;
    }
}



export type EventStuff = "seekStart" | "seekEnd" |
    "bufferRequestAnswered" | "bufferedVideo" |
    "bufferedAudio" | "bufferPoped";

const tickChannel = new MessageChannel();
let tickResolves: (() => void)[] = [];
tickChannel.port1.onmessage = () => {
    for (const res of tickResolves)
        res();
    tickResolves.length = 0;
};


export function FrameTime(frame: WorkerVideoFrameBufferInit | WorkerVideoFrame | WorkerVideoFrameImageBitmap) {
    return {
        timestamp: frame.kind === "videoFrame" ? frame.videoFrame.timestamp : frame.videoInfo.timestamp,
        duration: frame.kind === "videoFrame" ? frame.videoFrame.duration! : frame.videoInfo.duration!
    };
}



export const ffmpegUrl = new URL('src/modules/Video/FFmpeg/FFmpegBridge.js', location.origin);
export const SeekableWorkerUrl = new URL('src/modules/Video/SharedSeekableStream2.js', location.origin);
export const videoStreamWorkerUrl = new URL('src/modules/Video/VideoStreamTrack.js', location.origin);
export const WebDecoderWorkerUrl = new URL('src/modules/Video/FFmpeg/WebCodecDecoder.js', location.origin);


