import { AtomicEventer } from "../atomicEventer/atomicEventer";
import type { AtomicEventerBuffers, SerializableEventMap } from "../atomicEventer/types";
import { seekerRequestTemplates, seekerResponseTemplates, SeekerResponseType, type SeekerRequestType } from "./types";


export const STATE_NOT_INIT = 0n;
export const STATE_GOOD = 1n;
export const STATE_EOF = 2n;
export const STATE_UHHHH = 3n;

export enum CtrlPkg {
    STREAM_STATE,
    FILE_TOTAL_SIZE,
    REQ_STATE,
    REQ_SIZE,
    REQ_OFFSET,
    REQ_PTR,
    RET_SIZE,
    RET_STATE,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __LENGTH
}


export class SharedSeekableStream2 {
    private url: string;
    private currentOffset: number = 0;
    private keepOldBuffers: number = 1;
    private totalSize: number = 0;

    private fetchBuffer: { buffer: Uint8Array, offset: number; }[] = [];
    private isDoingStuff: boolean = false;
    private bufferSize: number;
    private readerLoop: Promise<void> = Promise.resolve();
    private currReader: ReadableStreamDefaultReader | null = null;
    private sharedBuffer: SharedArrayBuffer;
    private uIntArray: Uint8Array;

    private eventer: AtomicEventer<SerializableEventMap<SeekerResponseType>, SerializableEventMap<SeekerRequestType>>;

    private bufferPopedResolve: ((isAllOk: boolean) => void) | null = null;

    constructor(url: string, targetBuffer: SharedArrayBuffer, atomicBuffers: AtomicEventerBuffers, bufferSize: number = 16384) {
        this.url = url;
        this.bufferSize = bufferSize;

        this.sharedBuffer = targetBuffer;
        this.uIntArray = new Uint8Array(targetBuffer);

        this.eventer = new AtomicEventer(atomicBuffers, seekerResponseTemplates, seekerRequestTemplates);
    }

    public async start(offset: number = 0, url: string = this.url) {
        offset = Math.max(offset - 1, 0);
        if ((this.url === url || url === undefined) && this.getBufferIndex(offset) !== -1) {
            // Offset is inside already buffered buffer. Speed up stuff
            // Cleanup will happen at next read
            //this.currentOffset = offset;
            this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, { result: 0 });
            return;
        }

        this.url = url;

        // Abort the old stream
        this.isDoingStuff = false;
        this.bufferPopedResolve?.(false);
        this.bufferPopedResolve = null;
        this.currReader?.cancel();
        await this.readerLoop;
        console.log("Starting fetch");

        this.currentOffset = offset;
        this.fetchBuffer = [];
        const headers = {
            'Range': `bytes=${offset}-`
        };

        const response = await new Promise<Response | null>(resolve => {
            fetch(this.url, {
                headers,
            }).then(response => {
                if (!response.ok || !response.body) {
                    console.error(`Fetch failed with range: ${headers.Range} on url ${url}`);
                    return resolve(null);
                }
                if (!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) {
                    console.error(`Requested range not met: ${response.headers.get('content-range')} on url ${url}`);
                    return resolve(null);
                }

                resolve(response);
            }, err => {
                console.error(`Misc error on fetch: ${err} with url ${url}`);
                resolve(null);
            });
        });

        if (response === null || !response.body) {
            this.eventer.sendEvent(SeekerResponseType.INIT_DONE, {
                result: -1,
                fileSize: -1n,
            });
            return;
        }


        const reader = response.body.getReader();
        await new Promise<void>(res => this.readerLoop = this.readStream(reader, res));
        this.currReader = reader;

        this.totalSize = parseInt(response.headers.get('Content-Length') || '0') + offset;
        this.eventer.sendEvent(SeekerResponseType.INIT_DONE, {
            result: 0,
            fileSize: BigInt(this.totalSize),
        });
    }

    private async readStream(reader: ReadableStreamDefaultReader<Uint8Array>, resolveFirst: () => void) {
        this.isDoingStuff = true;
        while (this.isDoingStuff) {
            if (this.fetchBuffer.length > 1) {
                const fullSize = this.fetchBuffer.map(buf => buf.buffer.byteLength - buf.offset).reduce((p1, p2) => p1 + p2);
                if (fullSize >= this.bufferSize) {
                    const isOk = await new Promise<boolean>(res => this.bufferPopedResolve = res);
                    if (!isOk) {
                        reader.cancel();
                        return;
                    }
                    continue;
                }
            }
            const { value, done } = await reader.read();

            if (!this.isDoingStuff || done) {
                reader.cancel();
                console.log("Stopping fetch");
                return;
            }


            this.fetchBuffer.push({ buffer: value, offset: this.currentOffset });
            this.currentOffset += value.buffer.byteLength;
            resolveFirst();
        }
    }

    private getBufferIndex(offset: number) {
        for (let i = 0; i < this.fetchBuffer.length; i++) {
            const buffer = this.fetchBuffer[i];
            if (buffer.offset <= offset && buffer.offset + buffer.buffer.byteLength > offset)
                return i;
        }
        return -1;
    }

    async copyDataToWorker() {
        const bufSize = Number(Atomics.load(this.controlView, CtrlPkg.REQ_SIZE));
        const offset = Number(Atomics.load(this.controlView, CtrlPkg.REQ_OFFSET));
        const targetPtr = Number(Atomics.load(this.controlView, CtrlPkg.REQ_PTR));

        if (offset >= this.totalSize) {
            console.warn("End of file reached");
            Atomics.store(this.controlView, CtrlPkg.RET_STATE, STATE_EOF);
            Atomics.notify(this.controlView, CtrlPkg.RET_STATE);
            return;
        }

        let index = -1;
        while (index === -1) {
            index = this.getBufferIndex(offset);
            if (index === -1) {
                // try evicting old buffers
                const oldBufCount = this.fetchBuffer.length;
                this.fetchBuffer = this.fetchBuffer.filter(b => b.offset > offset);

                if (this.fetchBuffer.length < oldBufCount) {
                    this.bufferPopedResolve?.(true);
                    this.bufferPopedResolve = null;
                }

                console.log("No buffer available. Fetching");
                await WaitATick();
            }

        }



        const buf = this.fetchBuffer[index]!;
        const startOffset = offset - buf.offset;
        const allowedSize = Math.min(buf.buffer.byteLength - startOffset, bufSize);

        //console.log("giving data to", offset);
        if (targetPtr + allowedSize > this.uIntArray.length) {
            const oldSize = this.uIntArray.length;
            this.uIntArray = new Uint8Array(this.sharedBuffer);
            console.log(`Uhh buffer not enough. Lets recreate it ${oldSize} -> ${this.uIntArray.length}`);
        }
        this.uIntArray.set(this.fetchBuffer[index]!.buffer.subarray(startOffset, startOffset + allowedSize), targetPtr);

        if (allowedSize <= 0) {
            console.warn("End of file");
            Atomics.store(this.controlView, CtrlPkg.RET_SIZE, -1n);
        } else {
            Atomics.store(this.controlView, CtrlPkg.RET_SIZE, BigInt(allowedSize));
        }

        Atomics.store(this.controlView, CtrlPkg.RET_STATE, STATE_GOOD);
        //console.log("done giving data to", offset);
        Atomics.notify(this.controlView, CtrlPkg.RET_STATE);

        while (index > this.keepOldBuffers) {
            this.fetchBuffer.shift();
            index--;
        }

        this.bufferPopedResolve?.(true);
        this.bufferPopedResolve = null;
    }

    RequestWatcher() {
        if (this.isDoingStuff && Atomics.load(this.controlView, CtrlPkg.RET_STATE) == STATE_NOT_INIT) {
            this.copyDataToWorker().then(() => {
                this.RequestWatcher();
            });
        } else {
            WaitATick().then(() => {
                this.RequestWatcher();
            });
        }
    }

    Destroy() {
        this.isDoingStuff = false;
        this.currReader?.cancel();
        this.fetchBuffer = [];
    }
}

export interface SeekableWorkerInit { type: "init", url: string, buffsize: number, port: MessagePort, sharedBuffer: WebAssembly.Memory; }
export interface SeekableWorkerSeek { type: "seek", offset: number; urlChange?: string; };
export interface SeekableWorkerRequest { type: "request"; target: SharedArrayBuffer; }
export interface SeekableWorkerDestroy { type: "destroy"; }
export interface SeekableWorkerCtrlBuf { type: "ctrlBuffer", buffer: BigInt64Array<SharedArrayBuffer>; }

let seekableStream: SharedSeekableStream2;
let port: MessagePort;

// Fast-path "request" maybe??
const messageEvent = async (e: MessageEvent<"request" | SeekableWorkerInit | SeekableWorkerSeek | SeekableWorkerDestroy>) => {
    let type = typeof (e.data) == "string" ? e.data : e.data.type;
    switch (type) {
        case "init": {
            const data = e.data as SeekableWorkerInit;
            seekableStream = new SharedSeekableStream2(data.url, data.buffsize, data.sharedBuffer);
            await seekableStream.start();
            const ctrlBuf = seekableStream.GetCtrlBuff();
            port = data.port;
            port.onmessage = messageEvent;
            return self.postMessage({ type: "ctrlBuffer", buffer: ctrlBuf });
        }
        case "seek": {
            const data = e.data as SeekableWorkerSeek;
            return seekableStream.start(data.offset, data.urlChange);
        }
        case "request": {
            return seekableStream.copyDataToWorker();
        }
        case "destroy": {
            return seekableStream.Destroy();
        }

    }
};
self.onmessage = messageEvent;
