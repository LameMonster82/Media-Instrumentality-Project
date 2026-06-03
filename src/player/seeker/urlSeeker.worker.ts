import type { Dictionary } from "@/core/types";
import { AtomicEventer } from "../atomicEventer/atomicEventer";
import type { AtomicEventerBuffers, DecodeTemplate, SerializableEventMap, SerializableStuff } from "../atomicEventer/types";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type SeekableWorkerInit } from "./types";
import { waitATick } from "@/core/utils";
import RingBuffer from "./ringBuffer";


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


class UrlSeeker {
    private url: string;
    private totalFileSize: number = 0;
    private fetchOffset: number = 0;
    private fetchOffsetLimit: number = 0;
    private ringBuffer: RingBuffer;
    private fetchStream: WritableStream<Uint8Array> | undefined;



    private currentOffset: number = 0;
    private keepOldBuffers: number = 1;


    private fetchBuffer: { buffer: Uint8Array, offset: number; }[] = [];
    private isDoingStuff: boolean = false;
    private readerLoop: Promise<void> = Promise.resolve();
    private currReader: ReadableStreamDefaultReader | null = null;
    private sharedBuffer: SharedArrayBuffer;
    private uIntArray: Uint8Array;

    private eventer: AtomicEventer<SerializableEventMap<SeekerResponseType>, SerializableEventMap<SeekerRequestType>>;

    private bufferPopedResolve: ((isAllOk: boolean) => void) | null = null;

    constructor(url: string, targetBuffer: SharedArrayBuffer, atomicBuffers: AtomicEventerBuffers, bufferSize: number = 32 * 1024 * 1024) {
        this.url = url;
        this.ringBuffer = new RingBuffer(bufferSize)

        this.sharedBuffer = targetBuffer;
        this.uIntArray = new Uint8Array(targetBuffer);

        this.eventer = new AtomicEventer(atomicBuffers, seekerResponseTemplates, seekerRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));
    }

    private handleEvents(type: SeekerRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerRequestType.SEEK: {
                const dataThing = data as { offset: number, urlChange: string; };
                return this.seek(dataThing.offset, dataThing.urlChange);
            }
            case SeekerRequestType.REQUEST_DATA: {
                const dataThing = data as {
                    size: number,
                    ptr: bigint,
                    offset: bigint;
                };
                return this.copyDataToWorker(dataThing.size, dataThing.ptr, Number(dataThing.offset));
            }
            case SeekerRequestType.DESTROY: {
                return this.destroy();
            }
        }
    }

    public async seek(offset: number = 0, url: string = this.url) {
        this.url = url;
        this.ringBuffer.emptyBuffer();

        const headers = {
            'Range': `bytes=${offset}-`
        };

        let response: Response;
        try {
            response = await fetch(this.url, { headers });
            if (!response.ok || !response.body) {
                console.error(`Failed to fetch requested resouce: ${headers.Range} on url ${url}`);
                this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
                    result: -1,
                    fileSize: 0n
                });
                return;
            }

            const contentRange = response.headers.get('Content-Range');
            const match = contentRange?.match(/(^bytes)\s+(\d+)\s?-\s?(\d+)?\s?\/?\s?(\d+|\*)?/);
            if (contentRange && match) {
                const start = parseInt(match[2], 10);
                const end = parseInt(match[3] ?? "-1", 10);
                const total = match[4] === '*' ? -1 : parseInt(match[4], 10);

                this.totalFileSize = total;
                this.fetchOffset = start;
                this.fetchOffsetLimit = end === -1 ? total : end;

                if (offset !== start)
                    console.warn(`When requesting the web resources, the server did not respect my wishes of an offset of ${offset} and decided to give me ${start}. Fix yo shit`);
            } else {
                const contentRange = response.headers.get('Content-Lenght')!;

                this.totalFileSize = parseInt(contentRange, 10);
                this.fetchOffset = 0;
                this.fetchOffsetLimit = this.totalFileSize;

                console.warn("The server does not support seeking ranges. This may be slow so bear with me");
            }
        } catch (e) {
            console.error(`Failed to fetch your asset ${this.url}. The reason being is that`, e);
            this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
                result: -1,
                fileSize: 0n
            });
            return;
        }

        const reader = response.body.pipeTo(destination);
    }

    private writableStream() {
        
        this.fetchStream = new WritableStream<Uint8Array>({
            write(chunk) {
                let bytesWritten = 0;
                while (bytesWritten < chunk.byteLength) {
                    const n = this.ringBuffer.append(chunk.subarray(bytesWritten));
                    bytesWritten += n;
                    if (bytesWritten < chunk.byteLength) {
                        // Buffer is full – wait until more space becomes available.
                        // We need a way to be woken up when the consumer discards data.
                        // This requires a promise that discarding can resolve.
                        // For now, we'll outline the mechanism.
                    }
                }
                return Promise.resolve(); // or return a promise that resolves when free space exists
            },
            close() { /* optional: signal end of stream to your logic */ },
            abort(reason) { /* optional: handle cancellation */ },
        });
    }

    private getBufferIndex(offset: number) {
        for (let i = 0; i < this.fetchBuffer.length; i++) {
            const buffer = this.fetchBuffer[i];
            if (buffer.offset <= offset && buffer.offset + buffer.buffer.byteLength > offset)
                return i;
        }
        return -1;
    }

    async copyDataToWorker(size: number, ptr: bigint, offset: number) {

        if (offset >= this.totalFileSize) {
            console.warn("End of file reached");
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, { written: -1n });
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
                await waitATick();
            }

        }

        const buf = this.fetchBuffer[index]!;
        const startOffset = offset - buf.offset;
        const allowedSize = Math.min(buf.buffer.byteLength - startOffset, size);

        //console.log("giving data to", offset);
        if (Number(ptr) + allowedSize > this.uIntArray.byteLength) {
            const oldSize = this.uIntArray.byteLength;
            this.uIntArray = new Uint8Array(this.sharedBuffer);
            console.log(`Uhh buffer not enough. Lets recreate it ${oldSize} -> ${this.uIntArray.byteLength}`);
        }
        this.uIntArray.set(this.fetchBuffer[index]!.buffer.subarray(startOffset, startOffset + allowedSize), Number(ptr));

        this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, {
            written: allowedSize > 0 ? BigInt(allowedSize) : -1n,
        });

        while (index > this.keepOldBuffers) {
            this.fetchBuffer.shift();
            index--;
        }

        this.bufferPopedResolve?.(true);
        this.bufferPopedResolve = null;
    }

    destroy() {
        this.isDoingStuff = false;
        this.currReader?.cancel();
        this.fetchBuffer = [];
    }
}

let seekableStream: UrlSeeker;
self.onmessage = async (e: MessageEvent<SeekableWorkerInit>) => {
    switch (e.data.type) {
        case "init": {
            seekableStream = new UrlSeeker(e.data.url, e.data.targetBuffer, e.data.atomicBuffers, e.data.fetchBufferSize);
            await seekableStream.seek();
        }
    }
};;
