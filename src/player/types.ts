import type { Dictionary, WorkerPostMessage } from "@/core/types";





// This comes from the C Side
export interface Demuxer {
    extensions: string[],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    long_name: string,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    mime_types: string[],
    name: string;
}









export interface WorkerRequestBufferData extends WorkerPostMessage {
    readonly kind: "requestData";
}

export interface WorkerRequestSeek extends WorkerPostMessage {
    readonly kind: "seek";
    readonly offset: number;
}














export interface WorkerSubmitDemuxers extends WorkerPostMessage {
    readonly kind: "demuxerResponse";
    readonly demuxers: Demuxer[];
}

export interface WorkerSubmitExifResult extends WorkerPostMessage {
    readonly kind: "exifResponse";
    readonly status: number;
}

export type AllWorkerMessages =
    WorkerVideoFrame |
    WorkerAudioData | WorkerAudioDataInit |
    WorkerRequestBufferData | WorkerRequestSeek |
    WorkerSubmitStreams | WorkerSeekResult | WorkerMediaInfo |
    WorkerBitmapSubtitle | WorkerChapterInfo | WorkerRequestAnswered | WorkerEndOfFile |
    WorkerAssSubtitle | WorkerEmbedFont | WorkerPostPort | WorkerVideoFrameImageBitmap | WebDecoderQueueMessage | WorkerShutdown;





export const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => e > m ? e : m);
export const bigIntMin = (...args: bigint[]) => args.reduce((m, e) => e < m ? e : m);









export function ReplaceWithIcon(root: HTMLElement, type: AssetType) {
    const brokenSpan = document.createElement("span");
    brokenSpan.classList.add("material-symbols-rounded", "brokenImageError");
    if (type == AssetType.AUDIO) {
        brokenSpan.innerHTML = "audio_file";
        brokenSpan.classList.add("white");
    } else if (type === AssetType.VIDEO) {
        brokenSpan.innerHTML = "movie";
        brokenSpan.classList.add("white");
    } else if (type === AssetType.IMAGE) {
        brokenSpan.innerHTML = "image";
        brokenSpan.classList.add("white");
    }
    else {
        brokenSpan.innerHTML = "broken_image";
    }

    root.appendChild(brokenSpan);
    return brokenSpan;
}



interface WebDecoderMessage<T extends "audio" | "video"> extends WorkerPostMessage {
    kind: 'init' | 'decode' | 'flush' | 'close' | 'reinit';
    decoderType: T;
    streamIndex: number;
    postDataTo: MessagePort | null;
}

export interface WebVideoDecoderMessage extends WebDecoderMessage<"video"> {
    config?: VideoDecoderConfig;
    chunk?: EncodedVideoChunkInit;
}

export interface WebAudioDecoderMessage extends WebDecoderMessage<"audio"> {
    config?: AudioDecoderConfig;
    chunk?: EncodedAudioChunkInit;
}

export interface WebDecoderErrorMessage extends WorkerPostMessage {
    kind: "error",
    error: any,
    decoderState: CodecState;
}

export interface WebDecoderGeneralMessage extends WorkerPostMessage {
    kind: "initialized" | "flushed" | "closed",
}

export interface WebDecoderQueueMessage extends WorkerPostMessage {
    kind: "decoderQueueSize";
    type: "video" | "audio";
    streamIndex: number;
    queue: number;
}
