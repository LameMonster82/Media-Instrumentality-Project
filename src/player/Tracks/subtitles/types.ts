export type TextTrackStream = {
    track: TextTrack;
    cues: Set<string>;
}

export type VTTCueArgs = {
    startTime: number,
    endTime: number,
    text: string
}