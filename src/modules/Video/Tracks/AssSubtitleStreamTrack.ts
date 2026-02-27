import ASS from '../ASS/ass.js';
import type { StreamTrackNeeds } from '@/modules/SomeTypes';

export class AssSubtitles implements StreamTrackNeeds<string> {
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

            this.container.style.width = width + "px";
            this.container.style.height = height + "px";
        });

        const rect = video.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        this.container.style.width = width + "px";
        this.container.style.height = height + "px";

        observer.observe(video);
    }
    public Initialize(): Promise<void> {
        return Promise.resolve();
    }
    public Enable(enable: boolean): void {
        if (enable)
            this.assClasss.show();
        else
            this.assClasss.hide();
    }
    public Destroy(): void {
        this.assClasss.destroy();
        this.container.remove();
    }
    public WriteData(data: string): Promise<void> {
        this.assClasss.addDialogue(data);
        return Promise.resolve();
    }
    public GetTrack(): MediaStreamTrack | null {
        return null;
    }

    public SeekTo(time: number, fastSeek: boolean) {
        this.assClasss.customSeek(time);
        return Promise.resolve();
    }
}
