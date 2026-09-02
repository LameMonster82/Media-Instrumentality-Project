import type { CanvasTrackWrapper } from "../types";
import type { VideoDisplayData, VTTCueArgs } from "./types";

export default class SubtitleTextTrack implements CanvasTrackWrapper<VTTCueArgs, VideoDisplayData> {
    private track: TextTrack;
    private cues: Set<string> = new Set();

    constructor(video: HTMLVideoElement, title?: string, language?: string) {
        this.track = video.addTextTrack("subtitles", title, language);
    }

    createCanvas(_callback: () => HTMLCanvasElement): void {
        
    }
    getCanvas(): HTMLCanvasElement | null {
        return null
    }
    
    async enable(enable: boolean) {
        this.track.mode = enable ? "showing" : "disabled";
    }
    
    async writeData(data: VTTCueArgs) {
        const key = `${data.text}|${data.startTime}|${data.endTime}`;
        if (this.cues.has(key))
            return;
        
        this.track.addCue(new VTTCue(data.startTime, data.endTime, data.text));
    }
    async display(_data: VideoDisplayData) {
        // done by the video element
    }

    destroy(): void {
        // nothing to do here
    }
}