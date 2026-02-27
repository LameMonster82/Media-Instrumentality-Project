import type { AssSubtitles } from "./Video/Tracks/AssSubtitleStreamTrack.js"
import type { AudioStreamTrack } from "./Video/Tracks/AudioStreamTrack.js";
import type { AudioStreamTrackNative } from "./Video/Tracks/AudioStreamTrackNative.js";
import type { BitmapSubtitle } from "./Video/Tracks/BitmapSubtitle.js";
import type { VideoStreamTrack } from "./Video/Tracks/VideoStreamTrack.js";

export interface Dictionary<T> {
    [key: string]: T;
}

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

export interface VideoTrackGenerator {
    track: MediaStreamTrack,
    muted: boolean,
    writable: WritableStream<VideoFrame>;
}

export interface WritableAudioContext extends WritableStream<EncodedAudioChunk> {
    arrays?: Float32Array[];
    node?: AudioWorkletNode;
}

export type XMPImage = {
    mime: string;
    length: number;
    semantic: string;
    rawData?: Uint8Array;
    url?: string;
};

declare global {
    interface Window {
        VideoTrackGenerator: {
            new(): VideoTrackGenerator;
        };


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

interface AudioDataInitArrayBuffer extends AudioDataInit {
    data: ArrayBuffer;
}

interface FFmpegMediaStream {
    type: string,
    index: number,
    isSupported: boolean,
    isUsed: boolean;
    duration: number,
    metadata: Dictionary<string>;
    mediaStream?: StreamTrackNeeds<any>;
}

export interface Demuxer {
    extensions: string[],
    long_name: string,
    mime_types: string[],
    name: string;
}

export interface VideoMediaStream extends FFmpegMediaStream {
    type: "video";
    mediaStream?: VideoStreamTrack;
}

export interface AudioMediaStream extends FFmpegMediaStream {
    type: "audio",
    sampleRate: number;
    channels: number;
    mediaStream?: AudioStreamTrack | AudioStreamTrackNative;
}

export type SubtitleStreams = BitmapSubtitle | AssSubtitles;

export interface SubtitleMediaStream extends FFmpegMediaStream {
    type: "subtitle";
    decoderConfig?: undefined;
    mediaStream?: SubtitleStreams;
    assHeader?: string;
}

export type FFmpegStreams = VideoMediaStream | AudioMediaStream | SubtitleMediaStream;

interface WorkerPostMessage {
    readonly kind: string;
    readonly transferable?: Transferable[];
}

export interface WorkerVideoFrame extends WorkerPostMessage {
    readonly kind: "videoFrame";
    /** Timestamp and duration in Microseconds */
    readonly streamIndex: number;
    readonly videoFrame: VideoFrame;
    readonly transferable: VideoFrame[];
}

// Ended up not using it. Use it in places that WorkerVideoFrame is
export interface WorkerVideoFrameBufferInit extends WorkerPostMessage {
    readonly kind: "videoConstructor";
    /** Timestamp and duration in Microseconds */
    readonly streamIndex: number;
    readonly videoInfo: VideoFrameBufferInit;
    readonly videoBuffer: Uint8Array;
    readonly transferable: ArrayBufferLike[];
}

export interface WorkerVideoFrameImageBitmap extends WorkerPostMessage {
    readonly kind: "FrameBitmapConstructor";
    /** Timestamp and duration in Microseconds */
    readonly streamIndex: number;
    readonly videoInfo: VideoFrameBufferInit;
    readonly imageBitmap: ImageBitmap;
}

export interface WorkerAudioData extends WorkerPostMessage {
    readonly kind: "audioData";
    /** Timestamp and duration in Microseconds */
    readonly streamIndex: number;
    readonly audioData: AudioData;
    readonly transferable: AudioData[];
}

export interface WorkerAudioDataInit extends WorkerPostMessage {
    readonly kind: "audioDataInit";
    /** Timestamp and duration in Microseconds */
    readonly streamIndex: number;
    readonly dataBuffer: AudioDataInitArrayBuffer;
    readonly transferable: ArrayBufferLike[];
}

export interface WorkerRequestBufferData extends WorkerPostMessage {
    readonly kind: "requestData";
}

export interface WorkerRequestSeek extends WorkerPostMessage {
    readonly kind: "seek";
    readonly offset: number;
}

export interface WorkerSubmitStreams extends WorkerPostMessage {
    readonly kind: "streams";
    readonly streams: FFmpegStreams[];
}

export interface WorkerSubmitThumbnail extends WorkerPostMessage {
    readonly kind: "thumbnailData";
    image: Blob | null;
    width: number;
    height: number;
}

export interface WorkerRequestThumbnail extends WorkerPostMessage {
    readonly kind: "thumbnailRequest";
    readonly url: string;
}

export interface WorkerRequestDemuxers extends WorkerPostMessage {
    readonly kind: "demuxerRequest";
}

export interface WorkerRequestExif extends WorkerPostMessage {
    readonly kind: "exifRequest";
    readonly url: string;
    readonly bufferSize: number;
}

export interface WorkerShutdown extends WorkerPostMessage {
    readonly kind: "shutdown";
}

export interface WorkerSubmitDemuxers extends WorkerPostMessage {
    readonly kind: "demuxerResponse";
    readonly demuxers: Demuxer[];
}

export interface WorkerSubmitExifResult extends WorkerPostMessage {
    readonly kind: "exifResponse";
    readonly status: number;
}

export type AllWorkerMessages =
    WorkerVideoFrame |
    WorkerAudioData | WorkerAudioDataInit |
    WorkerRequestBufferData | WorkerRequestSeek |
    WorkerSubmitStreams | WorkerSeekResult | WorkerMediaInfo |
    WorkerBitmapSubtitle | WorkerChapterInfo | WorkerRequestAnswered |
    WorkerAssSubtitle | WorkerEmbedFont | WorkerPostPort | WorkerVideoFrameImageBitmap | WebDecoderQueueMessage | WorkerShutdown;

export interface WorkerInitFFmpeg extends WorkerPostMessage {
    readonly kind: "initFfmpeg";
    readonly url: string;
    readonly bufferSize: number;
}

export interface WorkerInitFFmpegOnlyModule extends WorkerPostMessage {
    readonly kind: "initFfmpegModuleOnly";
    readonly url?: string;
}

export interface WorkerChangeStream extends WorkerPostMessage {
    readonly kind: "changeStream";
    readonly type: "video" | "audio" | "subtitle";
    readonly toIndex: number;
}

export interface WorkerRequestFrames extends WorkerPostMessage {
    readonly kind: "requestFrames";
}

export interface WorkerRequestAnswered extends WorkerPostMessage {
    readonly kind: "requestAnswered";
    readonly status?: boolean;
}

export interface WorkerRequestFfmpegSeek extends WorkerPostMessage {
    readonly kind: "seekFfmpeg";
    readonly seconds: number;
}

export interface WorkerThumbnailDone extends WorkerPostMessage {
    readonly kind: "thumbnailDone";
    readonly return: number;
}

export interface WorkerThumbnailInProgress extends WorkerPostMessage {
    readonly kind: "thumbnailInProgress";
}

export interface WorkerSeekResult extends WorkerPostMessage {
    readonly kind: "doneSeeking";
    readonly return: number;
}

export interface WorkerMediaInfo extends WorkerPostMessage {
    readonly kind: "mediaInfo";
    readonly data: Dictionary<string>;
}

export interface WorkerEmbedFont extends WorkerPostMessage {
    readonly kind: "fontFile";
    readonly data: Uint8Array;
    readonly fontFamily: string | null;
    readonly fileName: string;
}

export interface WorkerPostPort extends WorkerPostMessage {
    readonly kind: "portPost";
    readonly streamIndex: number;
    readonly port: MessagePort;
}

export interface WorkerExifTags extends WorkerPostMessage {
    readonly kind: "exifTags";
    readonly tags: {
        title: string,
        name: string,
        desc: string,
        value: string;
    }[];
    readonly xmpImages: XMPImage[];

}


export type ChapterInfo = {
    index: number;
    /** Time in seconds */
    start: number;
    /** Time in seconds */
    end: number;
    data: Dictionary<string>;
};

export interface WorkerChapterInfo extends WorkerPostMessage {
    readonly kind: "chapterInfo";
    /** Time in seconds */
    readonly data: ChapterInfo;
}

export interface WorkerBitmapSubtitle extends WorkerPostMessage {
    readonly kind: "subtitleBitmap";
    readonly streamIndex: number,
    readonly image: Blob;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Time in microseconds */
    readonly timestamp: number;
    /** Time in milliseconds */
    readonly start_time: number;
    /** Time in milliseconds */
    readonly end_time: number;
}


export interface WorkerAssSubtitle extends WorkerPostMessage {
    readonly kind: "subtitleAss";
    readonly streamIndex: number,
    readonly dialog: string;
}

export type AllTargetWorkerMessages =
    WorkerInitFFmpeg | WorkerChangeStream | WorkerRequestFrames | WorkerRequestFfmpegSeek | // Video Player
    WorkerInitFFmpegOnlyModule | WorkerRequestThumbnail | // Thumbnail stuff
    WorkerRequestDemuxers |// Demuxers and Exif
    WorkerShutdown;

export interface AssetFile {
    readonly name: string,
    readonly path: string,
    readonly mimeType: string,
    readonly lastModified: number,
    readonly url: string;
    readonly size: number;
    readonly file?: File;
}

export const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => e > m ? e : m);
export const bigIntMin = (...args: bigint[]) => args.reduce((m, e) => e < m ? e : m);

export function generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0,
            v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export enum AssetType {
    IMAGE,
    VIDEO,
    AUDIO,
    FOLDER,
    UNKNOWN
}

export type ThumnbnailDesc = {
    image: Blob | null,
    width: number,
    height: number,
};

export type AssetDBFile = {
    filePath: string,
    fileType: AssetType,
    size: number,
    lastModified: number,
    album: string[],
    thumbnail: ThumnbnailDesc | null,
    metadata: {
        // additional user metadata
    },
};

export function GetFolderPath(filePath: string): string {
    const lastSlashIndex = filePath.lastIndexOf('/');
    if (lastSlashIndex === -1) return ''; // No folder path found
    return filePath.substring(0, lastSlashIndex);
}

export function isCoverImage(fileName: string): boolean {
    switch (fileName.toLowerCase()) {
        case 'cover.jpg':
        case 'cover.jpeg':
        case 'cover.png':
        case 'folder.jpg':
        case 'folder.jpeg':
        case 'folder.png':
        case 'front.jpg':
        case 'front.jpeg':
        case 'front.png':
        case 'album.jpg':
        case 'album.jpeg':
        case 'album.png':
        case 'artwork.jpg':
        case 'artwork.jpeg':
        case 'artwork.png':
        case 'thumb.jpg':
        case 'thumb.jpeg':
        case 'thumb.png':
        case 'back.jpg':
        case 'back.jpeg':
        case 'back.png':
        case 'disc.jpg':
        case 'disc.jpeg':
        case 'disc.png':
        case 'inlay.jpg':
        case 'inlay.jpeg':
        case 'inlay.png':
        case 'artist.jpg':
        case 'artist.jpeg':
        case 'artist.png':
            return true;

        default:
            return false;
    }
}

export function ReplaceWithIcon(root: HTMLElement, type: AssetType) {
    const brokenSpan = document.createElement("span");
    brokenSpan.classList.add("material-symbols-rounded", "brokenImageError");
    if (type == AssetType.AUDIO) {
        brokenSpan.innerHTML = "audio_file";
        brokenSpan.classList.add("white");
    } else if (type === AssetType.VIDEO) {
        brokenSpan.innerHTML = "movie";
        brokenSpan.classList.add("white");
    } else if (type === AssetType.IMAGE) {
        brokenSpan.innerHTML = "image";
        brokenSpan.classList.add("white");
    }
    else {
        brokenSpan.innerHTML = "broken_image";
    }

    root.appendChild(brokenSpan);
    return brokenSpan;
}

export interface StreamTrackNeeds<T> {
    Initialize(): Promise<void>;
    Enable(enable: boolean): void;
    Destroy(): void;
    WriteData(data: T, currentTime?: number): Promise<void>;
    SeekTo(time: number, fastSeek: boolean): Promise<void>;
    GetTrack(): MediaStreamTrack | null;
}

interface WebDecoderMessage<T extends "audio" | "video"> extends WorkerPostMessage {
    kind: 'init' | 'decode' | 'flush' | 'close';
    decoderType: T;
    streamIndex: number;
    postDataTo: MessagePort | null;
}

export interface WebVideoDecoderMessage extends WebDecoderMessage<"video"> {
    config?: VideoDecoderConfig;
    chunk?: EncodedVideoChunkInit;
}

export interface WebAudioDecoderMessage extends WebDecoderMessage<"audio"> {
    config?: AudioDecoderConfig;
    chunk?: EncodedAudioChunkInit;
}

export interface WebDecoderErrorMessage extends WorkerPostMessage {
    kind: "error",
    error: any,
    decoderState: CodecState;
}

export interface WebDecoderGeneralMessage extends WorkerPostMessage {
    kind: "initialized" | "flushed" | "closed",
}

export interface WebDecoderQueueMessage extends WorkerPostMessage {
    kind: "decoderQueueSize";
    type: "video" | "audio";
    streamIndex: number;
    queue: number;
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
export function WaitATick(): Promise<void> {
    return new Promise<void>(res => {
        //tickResolves.push(res);
        //tickChannel.port2.postMessage("haha");
        setTimeout(res, 0);
    });
}

export function PromiseRes<T>() {
    let resolve: (e: T) => void = () => { };
    const promise = new Promise<T>(res => resolve = res);
    return { promise, resolve };
}

export function FrameTime(frame: WorkerVideoFrameBufferInit | WorkerVideoFrame | WorkerVideoFrameImageBitmap) {
    return {
        timestamp: frame.kind === "videoFrame" ? frame.videoFrame.timestamp : frame.videoInfo.timestamp,
        duration: frame.kind === "videoFrame" ? frame.videoFrame.duration! : frame.videoInfo.duration!
    };
}

export function AudioTime(audio: WorkerAudioDataInit | WorkerAudioData) {
    return {
        timestamp: audio.kind === "audioData" ? audio.audioData.timestamp : audio.dataBuffer.timestamp,
        duration: audio.kind === "audioData" ? audio.audioData.duration! : (audio.dataBuffer.numberOfFrames / audio.dataBuffer.sampleRate) * 1000000
    };
}


export const libexifUrl = new URL('src/modules/Library/Exif/ExifWorker.js', location.origin);
export const ffmpegUrl = new URL('src/modules/Video/FFmpeg/FFmpegBridge.js', location.origin);
export const SeekableWorkerUrl = new URL('src/modules/Video/SharedSeekableStream2.js', location.origin);
export const videoStreamWorkerUrl = new URL('src/modules/Video/VideoStreamTrack.js', location.origin);
export const WebDecoderWorkerUrl = new URL('src/modules/Video/WebCodecDecoder.js', location.origin);

export function FormatBytes(bytes: number, decimals = 2): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals || 2;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}
