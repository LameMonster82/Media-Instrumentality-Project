import { WaitATick } from "../SomeTypes.js";

export const TOTAL_SIZE = 0;
export const LOAD_STATE = 1;

export const SET_BUF_SIZE = 0;
export const REQ_BUF_SIZE = 1;
export const REQ_OFFSET = 2;


export class SharedSeekableStream {
    private url: string;
    private currentOffset: number = 0;
    public keepOldBuffers: number = 1;
    private totalSize: number = 0;

    private controlPkg: SharedArrayBuffer = new SharedArrayBuffer(2 * BigInt64Array.BYTES_PER_ELEMENT);
    private controlPkgView: BigInt64Array = new BigInt64Array(this.controlPkg);

    private dataBuffer: SharedArrayBuffer;
    private dataView: Uint8Array;

    private controlBuffer: SharedArrayBuffer = new SharedArrayBuffer(3 * BigInt64Array.BYTES_PER_ELEMENT);
    private controlView: BigInt64Array = new BigInt64Array(this.controlBuffer);

    private fetchBuffer: { buffer: Uint8Array, offset: number; }[] = [];
    private isDoingStuff: boolean = false;
    private bufferSize: number;
    private readerLoop: Promise<void> = Promise.resolve();
    private currReader: ReadableStreamDefaultReader | null = null;

    private bufferPopedResolve: ((isAllOk: boolean) => void) | null = null;

    constructor(url: string, maxSize: number = 16384, bufferSize: number = 163840) {
        this.url = url;
        this.bufferSize = bufferSize;

        this.dataBuffer = new SharedArrayBuffer(maxSize);
        this.dataView = new Uint8Array(this.dataBuffer);

        Atomics.store(this.controlPkgView, 1, -1n);

        // Global Buffer (controlPkg)
        // 0: Total Size
        // 1: Stream loading State

        // Per instance buffer (controlView)
        // 0: Set Buffer Size
        // 1: Requested Buffer Size
        // 2: Requested Offset
    }

    public getSharedBuffers() {
        return {
            dataBuffer: this.dataBuffer,
            controlBuffer: this.controlBuffer,
            controlPkg: this.controlPkg
        };
    }

    public async start(offset: number = 0, url: string = this.url) {
        offset = Math.max(offset - 1, 0);
        if (this.url === url && this.getBufferIndex(offset) !== -1) {
            // Offset is inside already buffered buffer. Speed up stuff
            // Cleanup will happen at next read
            //this.currentOffset = offset;
            Atomics.store(this.controlPkgView, 1, 0n);
            Atomics.notify(this.controlPkgView, 1);
            return;
        }

        this.url = url;
        

        Atomics.store(this.controlPkgView, 1, -1n);
        Atomics.store(this.controlPkgView, 0, 0n); // Total Size

        // Abort the old stream
        this.isDoingStuff = false;
        this.bufferPopedResolve?.(false);
        this.bufferPopedResolve = null;
        await this.readerLoop;

        this.currentOffset = offset;
        this.fetchBuffer = [];
        const headers = {
            'Range': `bytes=${offset}-`
        };

        const response = await fetch(this.url, {
            headers,
        });

        if (!response.ok || !response.body) {
            throw new Error(`Fetch failed with range: ${headers.Range}`);
        }
        if (!response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) {
            throw new Error(`Requested range not met: ${response.headers.get('content-range')}`);
        }
        const reader = response.body.getReader();
        await new Promise<void>(res => this.readerLoop = this.ReadStream(reader, res))
        this.currReader = reader;

        this.totalSize = parseInt(response.headers.get('Content-Length') || '0') + offset;
        Atomics.store(this.controlPkgView, 0, BigInt(this.totalSize)); // totalFileSize
        Atomics.store(this.controlPkgView, 1, 0n);
        Atomics.notify(this.controlPkgView, 1); // Notify that the stream is loaded
    }

    private async ReadStream(reader: ReadableStreamDefaultReader<Uint8Array>, resolveFirst: () => void) {
        this.isDoingStuff = true;
        while (this.isDoingStuff) {
            if (this.fetchBuffer.length > 1) {
                const fullSize = this.fetchBuffer.map(buf => buf.buffer.byteLength).reduce((p1, p2) => p1 + p2);
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
        const bufSize = Number(Atomics.load(this.controlView, 1));
        const offset = Number(Atomics.load(this.controlView, 2));

        if (offset >= this.totalSize) {
            console.log("End of file reached");
            Atomics.store(this.controlView, 0, -2n);
            Atomics.notify(this.controlView, 0);
            return;
        }

        let index = -1;
        while (index === -1) {
            index = this.getBufferIndex(offset);
            if (index === -1) {
                // try evicting old buffers
                for (let i = 0; i < this.fetchBuffer.length; i++) {
                    const buffer = this.fetchBuffer[i];
                    if (buffer.offset <= offset) {
                        this.fetchBuffer.slice(i, 1);
                        this.bufferPopedResolve?.(true);
                        this.bufferPopedResolve = null;
                    }
                        
                }
                await WaitATick();
            }
                
        }



        const buf = this.fetchBuffer[index]!;
        const startOffset = offset - buf.offset;
        const allowedSize = Math.min(buf.buffer.byteLength - startOffset, bufSize, this.dataView.byteLength);

        //console.log("giving data to", offset);

        this.dataView.set(this.fetchBuffer[index]!.buffer.subarray(startOffset, startOffset + allowedSize));

        if (allowedSize <= 0) {
            Atomics.store(this.controlView, 0, -1n);
        } else {
            Atomics.store(this.controlView, 0, BigInt(allowedSize));
        }
        
        //console.log("done giving data to", offset);
        Atomics.notify(this.controlView, 0);

        while (index > this.keepOldBuffers) {
            this.fetchBuffer.shift();
            index--;
            this.bufferPopedResolve?.(true);
            this.bufferPopedResolve = null;
        }
    }

    Destroy() {
        this.isDoingStuff = false;
        this.currReader?.cancel();
        this.fetchBuffer = [];
    }
}
