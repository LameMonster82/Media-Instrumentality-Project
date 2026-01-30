import { generateUUID, StreamTrackNeeds } from "../SomeTypes.js";

export type BitmapSubtitleInfo = {
    image: Blob | File,
    startTime: number,
    endTime: number,
    positionX: number,
    positionY: number,
    width: number,
    height: number
}

export class BitmapSubtitle implements StreamTrackNeeds<BitmapSubtitleInfo> {
    private track: TextTrack;
    private style: HTMLStyleElement;
    private video: HTMLVideoElement;

    constructor(video: HTMLVideoElement, metadata: { [key: string]: string; }) {
        // Create a new text track for bitmap subtitles
        const title = metadata["title"] ?? metadata["TITLE"] ?? metadata["language"] ?? metadata["LANGUAGE"] ?? `unknown :/`;
        const language = metadata["language"] ?? metadata["LANGUAGE"] ?? metadata["title"] ?? metadata["TITLE"] ?? `en`;

        this.track = video.addTextTrack("subtitles", title, language);
        this.track.mode = "showing";

        // Create and append style element for cue styling
        this.style = document.createElement('style');
        document.head.appendChild(this.style);
        this.video = video;
        
        const resizeObserver = new ResizeObserver((entries) => {
            this.ResizeEvent();

            console.log("Size changed");
        });
        resizeObserver.observe(video);

        this.ResizeEvent();
    }
    public Initialize(): Promise<void> {
        return Promise.resolve()
    }

    public GetTrack(): MediaStreamTrack | null {
        return null;
    }

    /**
     * Adds an image subtitle at the specified time and position
     * @param image - The image to display as subtitle
     * @param startTime - Start time in seconds
     * @param endTime - End time in seconds
     * @param position - Vertical position (0-100)
     * @param line - Line position (0-100)
     */
    WriteData(data: BitmapSubtitleInfo) {
        // Create object URL for the image
        const imageUrl = URL.createObjectURL(data.image);

        // Create unique ID for this cue
        const cueId = `bitmap-${generateUUID()}`;
        

        // Create VTTCue with empty text but positioned
        const cue = new VTTCue(data.startTime, data.endTime, `<c>                                                                    </c>`);
        cue.snapToLines = false;
        cue.position = 50;
        cue.line = 50;
        cue.align = "center";
        cue.id = cueId;

        const widthScale = data.width / this.video.videoWidth;
        const heightScale = data.height / this.video.videoHeight;
        const xposScale = data.positionX / this.video.videoWidth;
        const yposScale = data.positionY / this.video.videoHeight;


        // Add specific styling for this cue
        // background-size: calc((${width}px / var(--video-width) * var(--video-rect-width))) calc((${height}px / var(--video-height) * var(--video-rect-height)));
        // background-position: top calc(var(--video-rect-height) / 2 - ((var(--video-height) / 2) - ${positionY}px)) left calc(var(--video-rect-width) / 2 - ((var(--video-width) / 2) - ${positionX}px));
        const cssRule = `
            video::cue(#${cueId}) {
                background: transparent;
                color: transparent;
                background-image: url("${imageUrl}");
                background-size: calc(${widthScale} * var(--video-rect-width)) calc(${heightScale} * var(--video-rect-height));
                background-repeat: no-repeat;
                background-position:
                    top calc(${yposScale} * var(--video-rect-height))
                    left calc(${xposScale} * var(--video-rect-width));
                font-size: var(--video-rect-height);
            }
        `;

        this.style.textContent += cssRule;

        this.track.addCue(cue);
        this.video.pause();

        return Promise.resolve();
    }

    Enable(enable: boolean) {
        this.track.mode = enable ? "showing" : "disabled";
    }

    ResizeEvent() {
        const rect = this.video.getBoundingClientRect();
        this.video.style.setProperty('--video-rect-top', `${rect.top.toString()}px`);
        this.video.style.setProperty('--video-rect-left', `${rect.left.toString()}px`);
        this.video.style.setProperty('--video-rect-width', `${rect.width.toString()}px`);
        this.video.style.setProperty('--video-rect-height', `${rect.height.toString()}px`);
        this.video.style.setProperty('--video-width', `${this.video.videoWidth.toString()}px`);
        this.video.style.setProperty('--video-height', `${this.video.videoHeight.toString()}px`);
    }

    /**
     * Cleans up resources by revoking object URLs
     */
    Destroy(): void {
        // Remove all cues
        while (this.track.cues?.length) {
            const cue = this.track.cues[0];
            const styleContent = this.style.textContent;
            const urlMatch = styleContent?.match(new RegExp(`#${cue.id}[^}]*url\\("([^"]+)"`, 'i'));
            if (urlMatch?.[1]) {
                URL.revokeObjectURL(urlMatch[1]);
            }
            this.track.removeCue(cue);
        }

        // Remove style element
        this.style.remove();
    }

    public SeekTo(time: number, fastSeek: boolean) {
        return Promise.resolve();
    }
}