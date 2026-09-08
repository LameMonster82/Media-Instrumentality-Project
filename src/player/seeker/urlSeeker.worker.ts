

import type { UrlSeekableWorkerInit } from "./types";
import RingBuffer from "./ringBuffer";
import SharedSeekerControls, { Operation, type RequestEvent, type SeekEvent } from "./sharedControl";

class UrlSeeker {
    private url: string;

    private totalFileSize: number = 0;
    private fetchOffset: number = 0;
    private fetchOffsetLimit: number = 0;

    private fetchStream: WritableStream<Uint8Array> | undefined;
    private fetchAbortController = new AbortController();

    private ringBuffer: RingBuffer;
    private ringBufferSpaceNotify: () => void = () => { };
    private ringBufferFileCursor = 0;

    private sharedBuffer: WebAssembly.Memory;
    private uIntArray: Uint8Array;
    private eventer: SharedSeekerControls;

    private destroyed = false;
    private lastSeek: Promise<void> = Promise.resolve();

    constructor(url: string, targetBuffer: WebAssembly.Memory, atomicBuffers: SharedArrayBuffer, bufferSize: number = 32 * 1024 * 1024) {
        this.url = url;
        this.ringBuffer = new RingBuffer(bufferSize);

        this.sharedBuffer = targetBuffer;
        this.uIntArray = new Uint8Array(targetBuffer.buffer);

        this.eventer = new SharedSeekerControls(atomicBuffers);
        this.eventer.pumpEvents(this.handleEvents.bind(this));
    }

    private async handleEvents(data: RequestEvent | SeekEvent) {
        if (data.type === Operation.REQUEST_DATA) {
            this.copyDataToWorker(Number(data.size), data.ptr, Number(data.offset));
        } else if (data.type === Operation.SEEK) {
            this.lastSeek = this.seek(Number(data.offset));
        }
    }

    public async seek(offset: number = 0, url: string = this.url, emptyBuffer: boolean = true): Promise<void> {
        if (this.destroyed) return;

        if (this.url === url &&
            this.ringBufferFileCursor <= offset &&
            this.fetchOffsetLimit > offset) {

            // We seeked in already available data. We will be ok
            this.eventer.seekDone();
            return;
        }

        try {
            this.fetchAbortController.abort();
        } catch {

        }

        await this.lastSeek;

        this.url = url;
        if (emptyBuffer)
            this.ringBuffer.emptyBuffer();

        this.eventer.setFileSize(0n);

        const headers = {
            'Range': `bytes=${offset}-`
        };

        let response: Response;
        try {
            response = await fetch(this.url, { headers });
            if (!response.ok || !response.body) {
                console.error(`Failed to fetch requested resouce: ${headers.Range} on url ${url}`);
                this.eventer.seekDone();
                return;
            }

            const contentRange = response.headers.get('Content-Range');
            const match = contentRange?.match(/^bytes\s+(\d+)\s?-\s?(\d+)?\s?\/?\s?(\d+|\*)?/);
            if (contentRange && match) {
                const start = parseInt(match[1], 10);
                const end = match[2] === '*' ? -1 : parseInt(match[2], 10);
                const total = match[3] === '*' ? -1 : parseInt(match[3], 10);

                this.totalFileSize = total;
                this.fetchOffset = start;
                this.fetchOffsetLimit = end === -1 ? total - 1 : end;

                if (offset !== start)
                    console.warn(`When requesting the web resources, the server did not respect my wishes of an offset of ${offset} and decided to give me ${start}. Fix yo shit`);
            } else {
                const contentRange = response.headers.get('Content-Length')!;

                this.totalFileSize = parseInt(contentRange, 10);
                this.fetchOffset = 0;
                this.fetchOffsetLimit = this.totalFileSize - 1;

                console.warn("The server does not support seeking ranges. This may be slow so bear with me");
            }
        } catch (e) {
            console.error(`Failed to fetch your asset ${this.url}. The reason being is that`, e);
            this.eventer.seekDone();
            return;
        }

        this.eventer.setFileSize(BigInt(this.totalFileSize));

        if (this.destroyed) return;

        this.ringBufferFileCursor = this.fetchOffset;

        let streamAbort = false;
        let { promise, resolve } = Promise.withResolvers<void>();
        this.ringBufferSpaceNotify = resolve;

        this.fetchStream = new WritableStream<Uint8Array>({
            start: () => {
                this.eventer.seekDone();
            },
            write: async (chunk) => {
                if (this.destroyed) return;

                let bytesWritten = 0;
                while (bytesWritten < chunk.byteLength) {
                    const n = this.ringBuffer.append(chunk.subarray(bytesWritten));
                    bytesWritten += n;
                    if (bytesWritten < chunk.byteLength) {
                        // Buffer is full - wait until more space becomes available.
                        await promise;
                        const { promise: promise2, resolve: resolve2 } = Promise.withResolvers<void>();
                        promise = promise2;
                        resolve = resolve2;
                        this.ringBufferSpaceNotify = resolve;
                    }
                }
            },
            close: async () => {
                while (this.ringBuffer.getUsedSpace() > 0) {
                    await promise;
                    const { promise: promise2, resolve: resolve2 } = Promise.withResolvers<void>();
                    promise = promise2;
                    resolve = resolve2;
                    this.ringBufferSpaceNotify = resolve;
                }
            },
            abort(_reason) {
                streamAbort = true;
            },
        });

        this.fetchAbortController = new AbortController();
        const reader = response.body.pipeTo(this.fetchStream, { signal: this.fetchAbortController.signal });
        await reader;
        if (this.destroyed) return;

        if (!streamAbort && this.fetchOffsetLimit < this.totalFileSize - 1)
            return this.seek(this.fetchOffsetLimit, this.url, false);
    }

    copyDataToWorker(size: number, ptr: bigint, offset: number) {
        if (offset >= this.totalFileSize) {
            console.warn("End of file reached");
            this.eventer.bufferCopied(-1n);
            return;
        }

        const currentData = this.ringBuffer.getUsedSpace();
        if (offset < this.ringBufferFileCursor || offset >= this.ringBufferFileCursor + currentData) {
            this.eventer.bufferCopied(0n);
            return;
        }

        const slightOffset = offset - this.ringBufferFileCursor;
        const allowedSize = Math.min(currentData - slightOffset, size);

        if (Number(ptr) + allowedSize > this.uIntArray.byteLength) {
            const oldSize = this.uIntArray.byteLength;
            this.uIntArray = new Uint8Array(this.sharedBuffer.buffer);
            console.debug(`Uhh buffer not enough. Lets recreate it ${oldSize} -> ${this.uIntArray.byteLength}`);
        }

        const writtenData = this.ringBuffer.copyTo(this.uIntArray, Number(ptr), allowedSize, slightOffset);
        this.eventer.bufferCopied(BigInt(writtenData));

        this.ringBufferSpaceNotify();
        this.ringBufferFileCursor = offset + writtenData;
    }

    destroy() {
        this.destroyed = true;
        this.fetchStream?.abort();

        // If the writer is full, this will force it free
        // and return when it sees that its destroyed
        this.ringBufferSpaceNotify();
    }
}

let seekableStream: UrlSeeker;
self.onmessage = async (e: MessageEvent<UrlSeekableWorkerInit>) => {
    switch (e.data.type) {
        case "init": {
            seekableStream = new UrlSeeker(e.data.url, e.data.targetBuffer, e.data.atomicBuffers, e.data.fetchBufferSize);
            await seekableStream.seek();
        }
    }
};
