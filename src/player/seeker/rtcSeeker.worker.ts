

import type { RtcSeekableWorkerAddChannel, RtcSeekableWorkerInit } from "./types";
import type { RTCSeekTo, RTCSeekAnswer, RTCAnnounceSpace, RTCBlockSize } from "@/shareplay/types";
import SharedSeekerControls, { Operation, type RequestEvent, type SeekEvent } from "./sharedControl";

// eslint-disable-next-line @typescript-eslint/naming-convention
const DEBUG = import.meta.env.DEV;

export default class RTCSeeker {
    private dataChannels: { channel: RTCDataChannel; isSeeking: boolean, seekResolves: () => void }[] = [];

    private totalFileSize: number;

    // UintArray for data, null for in-flight, undefined for missing
    private buffers: Map<number, Uint8Array | null> = new Map();
    private maxBufferSize: number;
    private blockSize: Promise<number>;
    private blockSizeResolve: (data: number) => void;
    private fileCursor: number = 0;

    private sharedBuffer: WebAssembly.Memory;
    private uIntArray: Uint8Array;
    private eventer: SharedSeekerControls;

    private destroyed = false;
    private currentSeek: Promise<void> | undefined;

    constructor(data: RtcSeekableWorkerInit, bufferSize: number = 32 * 1024 * 1024) {
        this.maxBufferSize = bufferSize;
        this.totalFileSize = data.fileSize;

        this.sharedBuffer = data.targetBuffer;
        this.uIntArray = new Uint8Array(data.targetBuffer.buffer);

        this.eventer = new SharedSeekerControls(data.atomicBuffers);
        this.eventer.setFileSize(BigInt(data.fileSize));

        const { promise, resolve } = Promise.withResolvers<number>();
        this.blockSize = promise;
        this.blockSizeResolve = resolve;

        // It might immediately pump an event
        this.eventer.pumpEvents(this.handleEvents.bind(this));
    }

    public addDataChannel(channel: RTCDataChannel) {
        const index = this.dataChannels.push({ channel, isSeeking: false, seekResolves: () => { } }) - 1;
        if (index === 0) this.startSampler();

        channel.binaryType = "arraybuffer";
        channel.onmessage = async (data: MessageEvent<ArrayBuffer | string>) => {
            const channel = this.dataChannels[index];
            if (data.data instanceof ArrayBuffer) {
                if (channel.isSeeking) return;
                this.bytesPerChannel[index] = (this.bytesPerChannel[index] ?? 0) + data.data.byteLength - 8;
                const view = new DataView(data.data);
                const offset = Number(view.getBigUint64(0, true));
                const dataSize = data.data.byteLength - 8;
                const endOfData = offset + dataSize;

                if (this.fileCursor > endOfData || this.fileCursor + this.maxBufferSize < offset) {
                    //console.warn("A buffer was sent that seems to be out of range? Dropping it");
                    return;
                }

                if (this.buffers.get(offset)) {
                    //console.error("Duplicate blocks are being sent to the RTC Seeker. WHy???? ", offset);
                    return;
                }

                if (dataSize !== await this.blockSize && endOfData < this.totalFileSize) {
                    //console.error("We got a block of data that is not aligned with the buffer. Something is mega wrong");
                    return;
                }

                this.buffers.set(offset, new Uint8Array(data.data, 8));
            } else {
                const msg = JSON.parse(data.data) as RTCSeekAnswer | RTCBlockSize;
                if (msg.kind === "seekAnswer") channel.seekResolves();
                else if (msg.kind === "blockSize") this.blockSizeResolve(msg.blockSize);
            }
        };
    }

    private async handleEvents(data: RequestEvent | SeekEvent) {
        if (data.type === Operation.REQUEST_DATA) {
            await this.copyDataToWorker(Number(data.size), data.ptr, Number(data.offset));
        } else if (data.type === Operation.SEEK) {
            await this.currentSeek;
            this.currentSeek = this.seek(Number(data.offset));
            await this.currentSeek;
        }
    }

    public async seek(offset: number = 0) {
        if (this.destroyed) return;
        const now = performance.now();

        const bufferOffset = Math.floor(offset / await this.blockSize) * await this.blockSize;
        if (this.buffers.has(bufferOffset)) {
            this.buffers.forEach((_, key) => {
                if (key < bufferOffset) this.buffers.delete(key);
            });
            
            this.fileCursor = offset;
            this.eventer.seekDone();
            if (DEBUG)
                console.timeStamp("RTC Seek", now, performance.now(), "Seeker", "Video Player", "tertiary-dark");
            return;
        }

        const seekPromises: Promise<void>[] = [];
        for (const channel of this.dataChannels) {
            if (channel.channel.readyState !== "open") {
                const { promise: connectPromise, resolve: connectResolve } = Promise.withResolvers<void>();
                channel.channel.onopen = () => {
                    channel.channel.onopen = null;
                    connectResolve();
                };
                await connectPromise;
            }
            
            const { promise, resolve } = Promise.withResolvers<void>();
            channel.seekResolves = resolve;
            channel.isSeeking = true;
            promise.then(() => channel.isSeeking = false);
            channel.channel.send(JSON.stringify({
                kind: "seekTo",
                offset,
            } as RTCSeekTo));

            seekPromises.push(promise);
        }

        await Promise.all(seekPromises);

        this.buffers.clear();
        this.fileCursor = offset;

        this.announceFreeSpace();

        this.eventer.seekDone();
        if (DEBUG)
            console.timeStamp("RTC Seek", now, performance.now(), "Seeker", "Video Player", "tertiary-dark");
    }

    async copyDataToWorker(size: number, ptr: bigint, offset: number) {
        const now = performance.now();
        if (offset >= this.totalFileSize) {
            console.debug("End of file reached");
            this.eventer.bufferCopied(-1n);
            return;
        }

        const bufferOffset = Math.floor(offset / await this.blockSize) * await this.blockSize;
        let buffToCursorDiff = offset - bufferOffset;
        let allowedSize = Math.min(size, this.totalFileSize - offset);
        let chunk;
        let chunkOffset = 0;
        while (allowedSize > 0 && (chunk = this.buffers.get(bufferOffset + chunkOffset)) && chunk) {
            if (chunk.byteLength > allowedSize) {
                // we might not have an aligned copy
                // in this case we can cut the buffer short
                // and leave it in the buffer storage
                chunk = chunk.subarray(0, allowedSize);
            } else {
                // consume the entry
                this.buffers.delete(bufferOffset + chunkOffset);
            }

            if (buffToCursorDiff) {
                // offset the first chunk forward
                chunk = chunk.subarray(buffToCursorDiff);
                buffToCursorDiff = 0;
            }

            if (Number(ptr) + chunkOffset + chunk.byteLength > this.uIntArray.byteLength) {
                const oldSize = this.uIntArray.byteLength;
                this.uIntArray = new Uint8Array(this.sharedBuffer.buffer);
                console.debug(`Uhh buffer not enough. Lets recreate it ${oldSize} -> ${this.uIntArray.byteLength}`);
            }

            this.uIntArray.set(chunk, Number(ptr) + chunkOffset);

            allowedSize -= chunk.byteLength;
            chunkOffset += chunk.byteLength;
        }

        if (chunkOffset === 0) {
            // RTC doesnt have data yet. Lets stall
            await new Promise(r => setTimeout(r, 16));
        }

        this.eventer.bufferCopied(BigInt(chunkOffset));
        this.fileCursor += chunkOffset;

        if (DEBUG)
            console.timeStamp("RTC Copy out", now, performance.now(), "Seeker", "Video Player", "tertiary-dark");

        this.announceFreeSpace();
    }

    async announceFreeSpace() {
        const blockSize = await this.blockSize;
        const blockOffset = this.dataChannels.length;

        for (let i = 0; i < this.dataChannels.length; i++) {
            const channel = this.dataChannels[i];
            
            const bufferStart = Math.floor(this.fileCursor / blockSize) * blockSize;
            const bufferEnd = Math.min(bufferStart + this.maxBufferSize, this.totalFileSize)

            const mapOfFreeSpace: number[] = [];
            for (let ptr = bufferStart + (blockSize * i);
                ptr < bufferEnd;
                ptr += blockSize * blockOffset)
            {
                if (!this.buffers.has(ptr)) {
                    mapOfFreeSpace.push(ptr);
                    this.buffers.set(ptr, null);
                }
            }

            channel.channel.send(JSON.stringify({
                kind: "updateFreeSpace",
                freeSpace: mapOfFreeSpace
            } as RTCAnnounceSpace));
        }
    }

    private bytesPerChannel: number[] = [];
    private lastSample: number[] = [];
    private lastSampleAt = 0;
    private bandwidth = 0;

    private startSampler() {
        this.lastSampleAt = performance.now();
        setInterval(() => {
            const now = performance.now();
            const elapsed = (now - this.lastSampleAt) / 1000;
            if (elapsed <= 0) return;

            let instant = 0;
            for (let i = 0; i < this.dataChannels.length; i++) {
                const delta = this.bytesPerChannel[i] - this.lastSample[i];
                this.lastSample[i] = this.bytesPerChannel[i];
                instant += delta;
            }
            this.lastSampleAt = now;

            this.bandwidth = instant / elapsed;
            if (!Number.isFinite(this.bandwidth)) this.bandwidth = 0;
            self.postMessage({ kind: "bandwidth", value: this.bandwidth });
        }, 500);
    }

    destroy() {
        this.destroyed = true;
    }
}

let seekableStream: RTCSeeker;
self.onmessage = async (e: MessageEvent<RtcSeekableWorkerInit | RtcSeekableWorkerAddChannel>) => {
    switch (e.data.kind) {
        case "initSeeker": {
            seekableStream = new RTCSeeker(e.data, e.data.bufferSize);
            break;
        }
        case "addChannel": {
            seekableStream.addDataChannel(e.data.channel);
        }
    }
};
