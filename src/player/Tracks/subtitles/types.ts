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
}