import type { Dictionary, WorkerPostMessage, WorkerShutdown } from "@/core/types";
import type { ChapterInfo } from "../Tracks/subtitles/subtitleStream";


//#region Main -> FFmpeg Worker
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

export interface WorkerRequestAnswered extends WorkerPostMessage {
    readonly kind: "requestAnswered";
    readonly status?: boolean;
}

export interface WorkerEndOfFile extends WorkerPostMessage {
    readonly kind: "endOfFile";
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
    // eslint-disable-next-line @typescript-eslint/naming-convention
    readonly start_time: number;
    /** Time in milliseconds */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    readonly end_time: number;
}


export interface WorkerAssSubtitle extends WorkerPostMessage {
    readonly kind: "subtitleAss";
    readonly streamIndex: number,
    readonly dialog: string;
}

export interface WorkerRequestThumbnail extends WorkerPostMessage {
    readonly kind: "thumbnailRequest";
    readonly url: string;
}

export interface WorkerRequestDemuxers extends WorkerPostMessage {
    readonly kind: "demuxerRequest";
}

export type AllTargetWorkerMessages =
    WorkerInitFFmpeg | WorkerChangeStream | // Video Player
    WorkerInitFFmpegOnlyModule | WorkerRequestThumbnail | // Thumbnail stuff
    WorkerRequestDemuxers | // Demuxers and Exif
    WorkerShutdown;


//#endregion


//#region FFmpeg Worker -> Main Thread

export interface WorkerSubmitStreams extends WorkerPostMessage {
    readonly kind: "streams";
    readonly streams: FFmpegStreams[];
}

//#endregion
