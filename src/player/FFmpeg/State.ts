import type { Dictionary } from "@/core/types";
import type { MainModule } from "@FFmpeg/ffmpeg-wasm32/ffmpeg.js";
import type { AllStreamTrackTypes } from "../Tracks/types";
import type { AtomicEventer } from "../atomicEventer/atomicEventer";
import type { SeekerRequestType, SeekerResponseType } from "../seeker/types";
import type { SerializableEventMap } from "../atomicEventer/types";


export class WorkerState {
    public seekerEventer: AtomicEventer<SerializableEventMap<SeekerRequestType>, SerializableEventMap<SeekerResponseType>> = null!;





    public outModule: MainModule = null!;
    public streams: Dictionary<AllStreamTrackTypes> = {};
    public streamMetadatas: Dictionary<Dictionary<string>> = {};
    public webDecodersWorkers: Dictionary<{ worker: Worker, isClosed: boolean; }> = {};
    public assSubtitleMap: Dictionary<string[]> = {};
    public endOfFile: boolean = false;
    public seekByUser: boolean = false;
    public readOffset: bigint = 0n;
    public configPromises: Promise<unknown>[] = [];
    public seekerWorker: Worker | undefined;
    public ctrlBuff: BigInt64Array = null!;
    public seekerChannel: MessageChannel = new MessageChannel();

    public readMemory(start?: number | undefined, end?: number | undefined) {
        return new Uint8Array((this.outModule.wasmMemory as WebAssembly.Memory).buffer).slice(start, end);
    }

    public isStreamTypeUsed(type: "video" | "audio" | "subtitle"): boolean {
        return Object.values(workerState.streams).some(stream => stream.type === type && stream.isUsed);
    }
};

export const workerState = new WorkerState();
