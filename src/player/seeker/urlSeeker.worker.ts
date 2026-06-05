import type { Dictionary } from "@/core/types";
import AtomicEventer from "../atomicEventer/atomicEventer";
import type { AtomicEventerBuffers, DecodeTemplate, SerializableStuff } from "../atomicEventer/types";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type SeekableWorkerInit } from "./types";
import RingBuffer from "./ringBuffer";

class UrlSeeker {
    private url: string;

    private totalFileSize: number = 0;
    private fetchOffset: number = 0;
    private fetchOffsetLimit: number = 0;

    private fetchStream: WritableStream<Uint8Array> | undefined;

    private ringBuffer: RingBuffer;
    private ringBufferSpaceNotify: () => void = () => { };
    private ringBufferFileCursor = 0;

    private sharedBuffer: SharedArrayBuffer;
    private uIntArray: Uint8Array;
    private eventer: AtomicEventer<
        SeekerResponseType,
        SeekerRequestType,
        typeof seekerResponseTemplates,
        typeof seekerRequestTemplates>;

    private destroyed = false;
    private lastSeek: Promise<void> = Promise.resolve();

    constructor(url: string, targetBuffer: SharedArrayBuffer, atomicBuffers: AtomicEventerBuffers, bufferSize: number = 32 * 1024 * 1024) {
        this.url = url;
        this.ringBuffer = new RingBuffer(bufferSize);

        this.sharedBuffer = targetBuffer;
        this.uIntArray = new Uint8Array(targetBuffer);

        this.eventer = new AtomicEventer(atomicBuffers, seekerResponseTemplates, seekerRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));
    }

    private async handleEvents(type: SeekerRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerRequestType.SEEK: {
                const dataThing = data as { offset: number, urlChange: string; };
                this.fetchStream?.abort();
                await this.lastSeek;
                this.lastSeek = this.seek(dataThing.offset, dataThing.urlChange);
                return;
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

    public async seek(offset: number = 0, url: string = this.url): Promise<void> {
        if (this.destroyed) return;

        if (this.url === url &&
            this.ringBufferFileCursor <= offset &&
            this.fetchOffsetLimit > offset) {

            // We seeked in already available data. We will be ok
            this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
                result: 0,
                fileSize: BigInt(this.totalFileSize),
            });
            return;
        }

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
            const match = contentRange?.match(/^bytes\s+(\d+)\s?-\s?(\d+)?\s?\/?\s?(\d+|\*)?/);
            if (contentRange && match) {
                const start = parseInt(match[2], 10);
                const end = match[3] === '*' ? -1 : parseInt(match[3], 10);
                const total = match[4] === '*' ? -1 : parseInt(match[4], 10);

                this.totalFileSize = total;
                this.fetchOffset = start;
                this.fetchOffsetLimit = end === -1 ? total : end;

                if (offset !== start)
                    console.warn(`When requesting the web resources, the server did not respect my wishes of an offset of ${offset} and decided to give me ${start}. Fix yo shit`);
            } else {
                const contentRange = response.headers.get('Content-Length')!;

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

        if (this.destroyed) return;

        this.ringBufferFileCursor = this.fetchOffset;

        let streamAbort = false;
        let { promise, resolve } = Promise.withResolvers<void>();
        this.ringBufferSpaceNotify = resolve;

        this.fetchStream = new WritableStream<Uint8Array>({
            start: () => {
                this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
                    result: 0,
                    fileSize: BigInt(this.totalFileSize)
                });
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
            close() { /* optional: signal end of stream to your logic */ },
            abort(_reason) {
                streamAbort = true;
            },
        });

        const reader = response.body.pipeTo(this.fetchStream);
        await reader;
        if (this.destroyed) return;

        if (!streamAbort && this.fetchOffsetLimit < this.totalFileSize)
            return this.seek(this.fetchOffsetLimit);
    }

    copyDataToWorker(size: number, ptr: bigint, offset: number) {
        if (offset >= this.totalFileSize) {
            console.warn("End of file reached");
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, { written: -1n });
            return;
        }

        const currentData = this.ringBuffer.getUsedSpace();
        if (offset < this.ringBufferFileCursor || offset >= this.ringBufferFileCursor + currentData) {
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, {
                written: 0n,
            });
            return;
        }

        const slightOffset = offset - this.ringBufferFileCursor;
        const allowedSize = Math.min(currentData - slightOffset, size);

        if (Number(ptr) + allowedSize > this.uIntArray.byteLength) {
            const oldSize = this.uIntArray.byteLength;
            this.uIntArray = new Uint8Array(this.sharedBuffer);
            console.log(`Uhh buffer not enough. Lets recreate it ${oldSize} -> ${this.uIntArray.byteLength}`);
        }

        const writtenData = this.ringBuffer.copyTo(this.uIntArray, Number(ptr), allowedSize, slightOffset);
        this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, {
            written: BigInt(writtenData),
        });

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
self.onmessage = async (e: MessageEvent<SeekableWorkerInit>) => {
    switch (e.data.type) {
        case "init": {
            seekableStream = new UrlSeeker(e.data.url, e.data.targetBuffer, e.data.atomicBuffers, e.data.fetchBufferSize);
            await seekableStream.seek();
        }
    }
};
