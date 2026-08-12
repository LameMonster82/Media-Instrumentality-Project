import type { MediaStreamTrackWrapper } from "../types";
import { AudioStreamTrack } from "./AudioStreamTrack";
import { AudioStreamTrackNative } from "./AudioStreamTrackNative";
import type { WorkerAudioDataInit } from "./audioTypes";

export function GetAudioTrackCtor(): new () => MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    if (AudioStreamTrackNative.isSupported() && false)
        return AudioStreamTrackNative
    else
        return AudioStreamTrack
}