import type { Dictionary } from "@/core/types";
import type { FFmpegStream, MediaStreamTrackWrapper } from "../types";

export type BitmapSubtitleInfo = {
    image: Blob | File,
    startTime: number,
    endTime: number,
    positionX: number,
    positionY: number,
    width: number,
    height: number
}

export interface SubtitleFFmpegStream extends FFmpegStream<BitmapSubtitleInfo | string> {
    type: "subtitle";
    decoderConfig: undefined;
    mediaStream: MediaStreamTrackWrapper<BitmapSubtitleInfo | string>;
    assHeader: string;
}

export type ChapterInfo = {
    index: number;
    /** Time in seconds */
    start: number;
    /** Time in seconds */
    end: number;
    data: Dictionary<string>;
};
