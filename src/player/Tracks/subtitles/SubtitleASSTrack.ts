import JASSUB from "jassub";
import type { VideoDisplayData, VTTCueArgs } from "./types";
import type { CanvasTrackWrapper } from "../types";

export default class SubtitleASSTrack implements CanvasTrackWrapper<VTTCueArgs, VideoDisplayData> {
    private cues: Map<string, VTTCueArgs> = new Map();

    private header: string;
    private fonts: Uint8Array[];
    private jassub: JASSUB | undefined;
    private colorSpace: "RGB" | "BT709" | "BT601" = 'RGB'
    private canvasCallback: (() => HTMLCanvasElement) | undefined;

    constructor(header: string, fonts: Uint8Array[] = []) {
        this.header = header;
        this.fonts = fonts;
    }

    createCanvas(callback: () => HTMLCanvasElement): void {
        this.canvasCallback = callback;
    }

    async enable(enable: boolean) {
        if (!enable && this.jassub) {
            this.jassub._canvas.style.display = "none";
            while (this.jassub.busy) {
                await new Promise(r => setTimeout(r, 0));
            }
            await this.jassub.destroy();
            this.jassub = undefined;
        }

        if (enable && !this.jassub) {
            if (!this.canvasCallback) throw new Error("Register 'createCanvas' for this Track pls");

            const canvas = this.canvasCallback();
            this.jassub = new JASSUB({
                canvas,
                debug: false,
                subContent: this.header,
                fonts: this.fonts
            });

            canvas.style.display = "";

            await this.jassub.ready;
            await this.jassub?.renderer._setColorSpace(this.colorSpace);

            for (const [_, args] of this.cues) {
                await this.jassub.renderer.processChunk(args.text, args.startTime, args.endTime);
            }
        }
    }

    getCanvas() {
        return this.jassub?._canvas ?? null;
    }

    async writeData(data: VTTCueArgs) {
        const key = `${data.text}|${data.startTime}|${data.endTime}`;
        if (this.cues.has(key))
            return;

        this.cues.set(key, data);

        await this.jassub?.renderer.processChunk(data.text, data.startTime, data.endTime);
    }

    async display(data: VideoDisplayData) {
        await this.jassub?.manualRender(data, false);
    }

    async setColorSpace(colorSpace: "RGB" | "BT709" | "BT601") {
        if (this.colorSpace === colorSpace) return;
        this.colorSpace = colorSpace;
        await this.jassub?.renderer._setColorSpace(colorSpace);
    }

    destroy() {
        this.jassub?.destroy();
    }
}