import { type MainModule } from "./ffmpeg.js";
import { type Dictionary, type FFmpegStreams } from "../../SomeTypes.ts";

export class WorkerState {
    public outModule: MainModule = null!;
    public streams: Dictionary<FFmpegStreams> = {};
    public streamMetadatas: Dictionary<Dictionary<string>> = {};
    public webDecodersWorkers: Dictionary<{ worker: Worker, isClosed: boolean; }> = {};
    public assSubtitleMap: Dictionary<string[]> = {};
    public endOfFile: boolean = false;
    public seekByUser: boolean = false;
    public readOffset: bigint = 0n;
    public configPromises: Promise<any>[] = [];
    public seekerWorker: Worker | undefined;
    public ctrlBuff: BigInt64Array = null!;
    public seekerChannel: MessageChannel = new MessageChannel();

    public Read(start?: number | undefined, end?: number | undefined) {
        return new Uint8Array((this.outModule.wasmMemory as WebAssembly.Memory).buffer).slice(start, end);
    }

    public AreThereOtherStreams(type: "video" | "audio" | "subtitle"): boolean {
        return Object.values(workerState.streams).some(stream => stream.type === type && stream.isUsed);
    }
};

export const workerState = new WorkerState();