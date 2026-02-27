export class SharedSeekableStream_thr {
    private url: string;
    private maxSize: number;
    private currentOffset: number = 0;
    private abortController: AbortController | null = null;

    private controlPkg: SharedArrayBuffer = new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT);
    private controlPkgView: Int32Array = new Int32Array(this.controlPkg);

    private currPkgHistory: SharedArrayBuffer;
    private currPkgView: Int32Array;

    private dataBuffers: SharedArrayBuffer[] = [];
    private dataViews: Uint8Array[] = [];

    private controlBuffers: SharedArrayBuffer[] = [];
    private controlViews: Int32Array[] = [];

    private fetchBuffer: { life: number, buffer: Uint8Array, offset: number; }[] = [];
    private isDoingStuff: boolean = false;
    private bufferRange: number;
    private instances: number;

    constructor(url: string, instances: number, maxSize: number = 16384, bufferTimes: number = 16) {
        this.url = url;
        this.maxSize = maxSize;
        this.bufferRange = bufferTimes;
        this.instances = instances;

        for (let i = 0; i < instances; i++) {
            const dataBuffer = new SharedArrayBuffer(this.maxSize);
            const dataView = new Uint8Array(dataBuffer);

            const controlBuffer = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
            const controlViews = new Int32Array(controlBuffer);

            this.dataBuffers.push(dataBuffer);
            this.dataViews.push(dataView);
            this.controlBuffers.push(controlBuffer);
            this.controlViews.push(controlViews);
        }

        this.currPkgHistory = new SharedArrayBuffer(instances * Int32Array.BYTES_PER_ELEMENT);
        this.currPkgView = new Int32Array(this.currPkgHistory);

        Atomics.store(this.controlPkgView, 0, -1); // Last Pkg

        // Global Buffer
        // 0: Last Pkg Offset
        // 1: Total Size
        // 2: Stream loading State
        // 3: Pkg Submit State
        // 4: Buffer Req in Progress

        // Per instance buffer
        // 0: Control Value & Set Buffer Size
        // 1: Requested Offset
        // 2: Curr Pkg Offset
    }

    public getSharedBuffers() {
        return {
            dataBuffer: this.dataBuffers,
            controlBuffer: this.controlBuffers,
            controlPkg: this.controlPkg,
            historyPkg: this.currPkgHistory,
        };
    }

    public async start(offset: number = 0) {
        // Abort the old stream
        this.abortController?.abort();
        this.isDoingStuff = false;

        Atomics.store(this.controlPkgView, 0, -1); // Last Pkg
        Atomics.store(this.controlPkgView, 1, 0); // Total Size

        for (let i = 0; i < this.instances; i++) {
            const controlView = this.controlViews[i]!;
            Atomics.store(controlView, 0, 0); // Control Value
            Atomics.store(controlView, 1, -1); // Request Offset
        }

        this.currentOffset = offset;
        this.abortController = new AbortController();
        this.fetchBuffer = [];
        const headers = {
            'Range': `bytes=${offset}-`
        };

        const response = await fetch(this.url, {
            headers,
            signal: this.abortController.signal
        });

        if (!response.ok || !response.body) {
            throw new Error(`Fetch failed with range: ${headers.Range}`);
        }

        Atomics.store(this.controlPkgView, 1, parseInt(response.headers.get('Content-Length') || '0')); // totalFileSize
        Atomics.store(this.controlPkgView, 2, 0);
        Atomics.notify(this.controlPkgView, 2); // Notify that the stream is loaded

        const reader = response.body.getReader();
        this.ReadStream(reader);
    }

    private async ReadStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
        let unusedChunk: Uint8Array | null = null;
        this.isDoingStuff = true;
        while (this.isDoingStuff) {
            while (this.fetchBuffer.length >= this.bufferRange) {
                await new Promise(requestAnimationFrame);
            }

            const { value, done } = await reader.read();

            if (!this.isDoingStuff || done) return;

            let valuePos = 0;
            if (unusedChunk) {
                const remaining = this.maxSize - unusedChunk.length;
                const newChunk = new Uint8Array(this.maxSize);
                newChunk.set(unusedChunk, 0);
                const remainingChunk = value.subarray(0, remaining);
                newChunk.set(remainingChunk, unusedChunk.length);
                this.fetchBuffer.push({ life: this.instances, buffer: newChunk, offset: this.currentOffset });
                valuePos = remaining;
                this.currentOffset += newChunk.length;
                unusedChunk = null;
            }

            while (valuePos + this.maxSize < value.length) {
                const chunk = value.subarray(valuePos, valuePos + this.maxSize);
                this.fetchBuffer.push({ life: this.instances, buffer: chunk, offset: this.currentOffset });
                valuePos += chunk.length;
                this.currentOffset += chunk.length;
            }

            if (valuePos < value.length) {
                unusedChunk = value.subarray(valuePos);
            }
        }
    }

    WAKEUP(instanceIndex: number) {
        Atomics.store(this.controlPkgView, 4, 1); // Request in progress
        const reqOffset = Atomics.load(this.controlViews[instanceIndex]!, 1)!;
        const nextChunk = this.fetchBuffer.findIndex(buf => buf.offset === reqOffset);
        if (nextChunk >= 0) {
            this.dataViews[instanceIndex]!.set(this.fetchBuffer[nextChunk]!.buffer);
            this.fetchBuffer[nextChunk]!.life--;
            //this.controlViews[instanceIndex]![0]! = this.fetchBuffer[nextChunk]!.buffer.length;
            Atomics.store(this.controlViews[instanceIndex]!, 0, this.fetchBuffer[nextChunk]!.buffer.length); // availableBytes
        } else {
            console.log("Searching for non existing item");
            //this.controlViews[instanceIndex]![0]! = -1;
            Atomics.store(this.controlViews[instanceIndex]!, 0, -1); // No more data
        }
        Atomics.notify(this.controlViews[instanceIndex]!, 0); // Notify that there is new data
        if (nextChunk >= 0 && this.fetchBuffer[nextChunk]!.life <= 0) {
            this.fetchBuffer.splice(nextChunk, 1);
        }
        //this.controlPkgView[4] = 0;
        Atomics.store(this.controlPkgView, 4, 0); // Request in progress done
        Atomics.notify(this.controlPkgView, 4, 1); // Notify that the request is done
    }

    public stop() {
        this.abortController?.abort();
    }

    public GetEarliestWorker() {
        let earliestPkg = Number.MAX_SAFE_INTEGER;
        let earliestWorker = -1;
        for (let i = 0; i < this.instances; i++) {
            const pkg = Atomics.load(this.controlViews[i]!, 2);
            if (pkg < earliestPkg) { 
                earliestPkg = pkg;
                earliestWorker = i;
            }
        }

        return {earliestWorker, earliestPkg};
    }
}
