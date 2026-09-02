import type { CanvasTrackWrapper } from "../types";
import type { BitmapSubArgs, VideoDisplayData } from "./types";

export default class SubtitleBitmapTrack implements CanvasTrackWrapper<BitmapSubArgs, VideoDisplayData> {
    private canvas: HTMLCanvasElement | undefined;
    private ctx: CanvasRenderingContext2D | undefined;

    private buffer: BitmapSubArgs[] = [];
    private activeSubs: string[] = [];

    constructor() {

    }
    
    createCanvas(callback: () => HTMLCanvasElement): void {
        const canvas = callback();
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true })!;
    }

    async enable(enable: boolean) {
        if (!this.canvas) throw new Error("Register 'createCanvas' for this Track pls");
        this.canvas.style.display = enable ? "" : "none";
    }

    getCanvas() {
        return this.canvas ?? null;
    }

    async writeData(data: BitmapSubArgs) {
        const lastFrame = this.buffer[this.buffer.length - 1];
        if (lastFrame && lastFrame.endTime === 0) {
            lastFrame.endTime = data.startTime;
        }
        if (!data.frame) return;
        this.buffer.push(data);

        this.buffer.sort((a, b) => {
            return a.startTime - b.startTime;
        });
    }

    async display(data: VideoDisplayData) {
        if (!this.canvas || !this.ctx) throw new Error("Register 'createCanvas' for this Track pls");
        const subtitlesToRemove: string[] = [];
        for (const sub of this.buffer) {
            if (!sub.frame) continue;
            const hasBegun = sub.startTime / 1000 < data.mediaTime;
            const hasEnded = sub.endTime !== 0 && sub.endTime / 1000 < data.mediaTime;
            const hasBeenRendered = this.activeSubs.includes(sub.uuid);

            if (!hasBegun) {
                // Nothing
                continue;
            } else if (hasBegun && !hasEnded && !hasBeenRendered) {
                if (this.canvas.width !== sub.codecWidth ||
                    this.canvas.height !== sub.codecHeight) {
                    this.canvas.width = sub.codecWidth;
                    this.canvas.height = sub.codecHeight;
                }
                this.canvas.style.setProperty("--codecWidth", sub.codecWidth.toString());
                this.canvas.style.setProperty("--codecHeight", sub.codecHeight.toString());

                this.ctx.drawImage(sub.frame, sub.x, sub.y, sub.frame.width, sub.frame.height);
                this.activeSubs.push(sub.uuid);
            } else if (hasBegun && hasEnded && hasBeenRendered) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                subtitlesToRemove.push(sub.uuid);

                for (const id of this.activeSubs) {
                    const sub2 = this.buffer.find(s => s.uuid === id);
                    if (sub2 && sub2.uuid !== sub.uuid) {
                        this.ctx.drawImage(sub.frame, sub.x, sub.y, sub.frame.width, sub.frame.height);
                    }
                }
            } else if (hasBegun && hasEnded && !hasBeenRendered) {
                subtitlesToRemove.push(sub.uuid);
            }
        }

        for (const id of subtitlesToRemove) {
            const sub2 = this.buffer.find(s => s.uuid === id);
            if (sub2) sub2.frame?.close();
        }

        this.buffer = this.buffer.filter(s => !subtitlesToRemove.includes(s.uuid));
        this.activeSubs = this.activeSubs.filter(s => !subtitlesToRemove.includes(s));
    }

    destroy() {
        for (const frame of this.buffer) {
            frame.frame?.close();
        }
    }
}