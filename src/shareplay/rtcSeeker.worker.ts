import type { Dictionary } from "@/core/types";
import AtomicEventer from "../player/atomicEventer/atomicEventer";
import type { AtomicEventerBuffers, DecodeTemplate, SerializableStuff } from "../player/atomicEventer/types";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type RtcSeekableWorkerInit } from "../player/seeker/types";
import RingBuffer from "../player/seeker/ringBuffer";

/**
 * Peer side of the media transfer.
 *
 * A prefetch loop continuously asks the host for fixed-size byte ranges over a
 * MessagePort (bridged to the host's WebRTC data channel) and appends them to a
 * RingBuffer. `copyDataToWorker` then drains the RingBuffer synchronously so it
 * never stalls FFmpeg; if the requested offset hasn't been buffered yet it
 * reports `written = 0` and the bridge simply retries.
 */
class RtcSeeker {
    private static readonly MAX_IN_FLIGHT = 4;

    private chunkSize: number;

    private fileSize: number;
    private ringBuffer: RingBuffer;
    private ringBufferFileCursor = 0; // absolute file offset of ring buffer start
    private fetchOffset = 0;          // next absolute offset to request

    private sharedBuffer: WebAssembly.Memory;
    private uIntArray: Uint8Array;
    private port: MessagePort;

    private pending = new Map<string, { gen: number; resolve: (bytes: ArrayBuffer | null) => void; }>();
    private nextId = 0;
    private generation = 0;

    private destroyed = false;
    private spaceWaiter: (() => void) | undefined;

    private eventer: AtomicEventer<
        SeekerResponseType,
        SeekerRequestType,
        typeof seekerResponseTemplates,
        typeof seekerRequestTemplates>;

    constructor(port: MessagePort, fileSize: number, targetBuffer: WebAssembly.Memory, atomicBuffers: AtomicEventerBuffers, bufferSize = 32 * 1024 * 1024, maxMessageSize = 64 * 1024) {
        this.chunkSize = Math.max(16 * 1024, maxMessageSize);
        this.fileSize = fileSize;
        this.ringBuffer = new RingBuffer(bufferSize);
        this.sharedBuffer = targetBuffer;
        this.uIntArray = new Uint8Array(targetBuffer.buffer);
        this.port = port;

        this.port.onmessage = (e: MessageEvent<{ type: string; id: string; bytes: ArrayBuffer; }>) => {
            this.onRange(e.data);
        };

        this.eventer = new AtomicEventer(atomicBuffers, seekerResponseTemplates, seekerRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));

        this.seek(0);
        void this.prefetch();
    }

    private seek(offset: number) {

        // Ranges are requested on demand, so a seek just re-anchors the
        // prefetch cursor and empties stale buffered data.
        this.generation++;
        this.ringBuffer.emptyBuffer();
        this.ringBufferFileCursor = offset;
        this.fetchOffset = offset;
        this.notifySpace();
        this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
            result: 0,
            fileSize: BigInt(this.fileSize),
        });
    }

    private handleEvents(type: SeekerRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerRequestType.SEEK: {
                const d = data as { offset: number; urlChange: string; };
                this.seek(d.offset);
                break;
            }
            case SeekerRequestType.REQUEST_DATA: {
                const d = data as { size: number; ptr: bigint; offset: bigint; };
                return this.copyDataToWorker(d.size, d.ptr, Number(d.offset));
            }
            case SeekerRequestType.DESTROY: {
                this.destroy();
                break;
            }
        }
    }

    private onRange(msg: { type: string; id: string; bytes: ArrayBuffer; }): void {
        if (msg.type !== "range") return;
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);

        if (entry.gen === this.generation && msg.bytes.byteLength > 0) {
            entry.resolve(msg.bytes);
        } else {
            entry.resolve(null);
        }
    }

    private async appendToRing(bytes: ArrayBuffer): Promise<void> {
        const data = new Uint8Array(bytes);
        let written = 0;
        while (written < data.length) {
            const n = this.ringBuffer.append(data.subarray(written));
            written += n;
            if (written < data.length) await this.waitForSpace();
        }
    }

    private requestChunk(): Promise<ArrayBuffer | null> {
        const size = Math.min(this.chunkSize, this.fileSize - this.fetchOffset);
        const id = (this.nextId++).toString();
        const gen = this.generation;
        const bytesPromise = new Promise<ArrayBuffer | null>((resolve) => {
            this.pending.set(id, { gen, resolve });
        });

        this.port.postMessage({ type: "requestRange", id, offset: this.fetchOffset, size });
        this.fetchOffset += size;
        return bytesPromise;
    }

    private async prefetch(): Promise<void> {
        const inFlight: Promise<ArrayBuffer | null>[] = [];

        while (!this.destroyed) {
            // Keep a small window of requests in flight to hide round-trip latency.
            while (!this.destroyed
                && inFlight.length < RtcSeeker.MAX_IN_FLIGHT
                && this.fetchOffset < this.fileSize
                && this.ringBuffer.getFreeSpace() >= this.chunkSize) {
                inFlight.push(this.requestChunk());
            }

            if (inFlight.length === 0) {
                if (this.fetchOffset >= this.fileSize) {
                    await new Promise((r) => setTimeout(r, 50));
                } else {
                    await this.waitForSpace();
                }
                continue;
            }

            const bytes = await inFlight.shift()!;
            if (bytes) await this.appendToRing(bytes);
        }
    }

    private copyDataToWorker(size: number, ptr: bigint, offset: number) {
        if (offset >= this.fileSize) {
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, { written: -1n });
            return;
        }

        const used = this.ringBuffer.getUsedSpace();
        if (offset < this.ringBufferFileCursor || offset >= this.ringBufferFileCursor + used) {
            // Not buffered yet — tell the bridge to retry.
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, { written: 0n });
            return;
        }

        const slightOffset = offset - this.ringBufferFileCursor;
        const allowed = Math.min(used - slightOffset, size);

        if (Number(ptr) + allowed > this.uIntArray.byteLength) {
            this.uIntArray = new Uint8Array(this.sharedBuffer.buffer);
        }

        const written = this.ringBuffer.copyTo(this.uIntArray, Number(ptr), allowed, slightOffset);
        this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, { written: BigInt(written) });
        this.ringBufferFileCursor = offset + written;
        this.notifySpace();
    }

    private waitForSpace(): Promise<void> {
        return new Promise((resolve) => {
            this.spaceWaiter = resolve;
        });
    }

    private notifySpace(): void {
        this.spaceWaiter?.();
        this.spaceWaiter = undefined;
    }

    private destroy(): void {
        this.destroyed = true;
        this.notifySpace();
        this.port.close();
    }
}

let seekableStream: RtcSeeker;
self.onmessage = (e: MessageEvent<RtcSeekableWorkerInit>) => {
    switch (e.data.type) {
        case "init": {
            seekableStream = new RtcSeeker(e.data.port, e.data.fileSize, e.data.targetBuffer, e.data.atomicBuffers, e.data.bufferSize, e.data.maxMessageSize);
            break;
        }
    }
};
