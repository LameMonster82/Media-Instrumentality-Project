import type { MediaStreamTrackWrapper } from "../types";
import { VideoStreamTrackChrome } from "./VideoStreamTrackChrome";
import { VideoStreamTrackFallback } from "./VideoStreamTrackFallback";
import { VideoStreamTrackSafari } from "./VideoStreamTrackSafari";

export function getFrameSize(frame: ImageBitmap | VideoFrame, displaySize: boolean = false): { width: number, height: number; } {
    let width;
    let height;
    if (frame instanceof VideoFrame) {
        if (displaySize) {
            width = frame.codedWidth;
            height = frame.codedHeight;
        } else {
            width = frame.displayWidth;
            height = frame.displayHeight;
        }
    } else {
        width = frame.width;
        height = frame.height;
    }

    return { width, height };
}

export function GetVideoTrackCtor(): new () => MediaStreamTrackWrapper<VideoFrame> {
    if ('MediaStreamTrackGenerator' in self) {
        // Chrome or browsers supporting MediaStreamTrackGenerator natively
        return VideoStreamTrackChrome;
    } else if (navigator.userAgent.includes('Safari') && parseInt(navigator.userAgent.match(/Version\/(\d+)/)?.[1] || '0') >= 18) {
        // Safari 18.0+ using Web Worker
        return VideoStreamTrackSafari;
    } else {
        // Older Safari or Firefox fallback
        return VideoStreamTrackFallback;
    }
}
