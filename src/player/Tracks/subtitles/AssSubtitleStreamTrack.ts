import type { MediaStreamTrackWrapper } from '../types.js';
import ASS from './ASS/ass.js';

export class AssSubtitles implements MediaStreamTrackWrapper<string> {
    public container: HTMLDivElement = document.createElement('div');
    private assClasss: ASS;
    constructor(video: HTMLVideoElement, header: string) {
        this.assClasss = new ASS(header, video, {
            container: this.container,
        });

        const observer = new ResizeObserver((resize) => {
            const entry = resize[0];
            const width = entry.contentRect.width;
            const height = entry.contentRect.height;

            this.container.style.width = `${width}px`;
            this.container.style.height = `${height}px`;
        });

        const rect = video.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;

        observer.observe(video);
    }
    public initialize(): Promise<void> {
        return Promise.resolve();
    }
    public enable(enable: boolean): void {
        if (enable)
            this.assClasss.show();
        else
            this.assClasss.hide();
    }
    public destroy(): void {
        this.assClasss.destroy();
        this.container.remove();
    }
    public writeData(data: string): Promise<void> {
        this.assClasss.addDialogue(data);
        return Promise.resolve();
    }
    public getTrack(): MediaStreamTrack | null {
        return null;
    }

    public seekTo(time: number, _fastSeek: boolean) {
        this.assClasss.customSeek(time);
        return Promise.resolve();
    }
}
