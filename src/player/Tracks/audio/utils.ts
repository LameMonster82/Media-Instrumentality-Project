import type { MediaStreamTrackWrapper } from "../types";
import { AudioStreamTrack } from "./AudioStreamTrack";
import { AudioStreamTrack2 } from "./AudioStreamTrack2";
import { AudioStreamTrackNative } from "./AudioStreamTrackNative";
import type { WorkerAudioDataInit } from "./audioTypes";

/** "AudioStreamTrackNative" and "AudioStreamTrack2" have failed due to
 *  video stream vs audio context stream clock desync. Chrome doesnt take
 *  it well
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function GetAudioTrackCtor(): new () => MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    //if (AudioStreamTrackNative.isSupported())
    //    return AudioStreamTrackNative;
    //else
        return AudioStreamTrack;
}