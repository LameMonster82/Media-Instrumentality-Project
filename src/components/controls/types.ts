import type { Dictionary } from "@/core/types";

export type ControlStream = {
    isUsed: boolean,
    index: number,
    metadata: Dictionary<string>
}
export type ControlChapter = {
    id: number,
    start: number,
    end: number,
    title: string | undefined
}

declare global {
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
