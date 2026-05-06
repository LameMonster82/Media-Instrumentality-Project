import { AssSubtitles } from "./Tracks/AssSubtitleStreamTrack.js";
import { BitmapSubtitle, type BitmapSubtitleInfo } from "./Tracks/BitmapSubtitle.js";
import { parseFontFilename } from "./VideoUtils";
import type { WorkerAssSubtitle, WorkerBitmapSubtitle, WorkerEmbedFont, FFmpegStreams, SubtitleMediaStream } from "../SomeTypes.ts";

export class SubtitleManager {
    constructor(private video: HTMLVideoElement, private getStreams: () => FFmpegStreams[]) {}

    public addSubtitleBitmap(subtitle: WorkerBitmapSubtitle, mediaDuration: number) {
        const streams = this.getStreams();
        let stream = streams[subtitle.streamIndex];
        
        if (!stream.mediaStream) {
            stream.mediaStream = new BitmapSubtitle(this.video, stream.metadata);
        }
        
        const data: BitmapSubtitleInfo = {
            image: subtitle.image,
            startTime: 0,
            endTime: mediaDuration,
            positionX: subtitle.x,
            positionY: subtitle.y,
            width: subtitle.width,
            height: subtitle.height
        };
        (stream.mediaStream as BitmapSubtitle).WriteData(data);
    }

    public addSubtitleAss(subtitle: WorkerAssSubtitle, isPlaying: boolean, inCaseWeAddAContainer?: (element: HTMLElement) => void) {
        const streams = this.getStreams();
        let stream = streams[subtitle.streamIndex] as SubtitleMediaStream;
        
        if (!stream.assHeader) {
            console.warn("ASS subtitles without a header??");
            return;
        }
        
        if (!stream.mediaStream) {
            const assClass = new AssSubtitles(this.video, stream.assHeader);
            stream.mediaStream = assClass;
            
            if (inCaseWeAddAContainer) {
                inCaseWeAddAContainer(assClass.container);
            } else {
                this.video.parentElement?.appendChild(assClass.container);
            }
            
            if (isPlaying) this.video.dispatchEvent(new Event("play"));
        }
        (stream.mediaStream as AssSubtitles).WriteData(subtitle.dialog);
    }

    public addFontFile(fontInfo: WorkerEmbedFont) {
        const stuff = fontInfo.fontFamily 
            ? { family: fontInfo.fontFamily, weight: undefined, style: undefined } 
            : parseFontFilename(fontInfo.fileName);

        const font = new FontFace(stuff.family, fontInfo.data as any, {
            style: stuff.style,
            weight: stuff.weight
        });
        
        // @ts-ignore
        document.fonts.add(font);
    }
}