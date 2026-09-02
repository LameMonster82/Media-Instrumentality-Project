import type JASSUB from "jassub";

export type TextTrackStream = {
    track: TextTrack;
    cues: Set<string>;
}

export type VTTCueArgs = {
    startTime: number,
    endTime: number,
    text: string
};

export type ASSTrackStream = {
    track: JASSUB;
    cues: Set<string>;
    hasColorspace: boolean;
};

export type BitmapTrackStream = {
    canvas: CanvasCaptureMediaStreamTrack;
    cues: Set<string>;
};

export type BitmapSubArgs = {
    x: number;
    y: number;
    codecWidth: number;
    codecHeight: number;
    startTime: number,
    endTime: number,
    frame?: ImageBitmap,
    uuid: string;
};

export type VideoDisplayData = Pick<VideoFrameCallbackMetadata, 'expectedDisplayTime' | 'width' | 'height' | 'mediaTime'>;