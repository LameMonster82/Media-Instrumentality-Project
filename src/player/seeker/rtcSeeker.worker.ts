

import type { RtcSeekableWorkerInit } from "./types";
import RingBuffer from "./ringBuffer";
import { type RTCSeekTo, type RTCSeekAnswer, type RTCAnnounceSpace, HIGH_BUFFER } from "@/shareplay/types";
import SharedSeekerControls, { Operation, type RequestEvent, type SeekEvent } from "./sharedControl";

// eslint-disable-next-line @typescript-eslint/naming-convention
const DEBUG = import.meta.env.DEV;

export default class RTCSeeker {
    private dataChannel: RTCDataChannel;

    private totalFileSize: number;

    private ringBuffer: RingBuffer;
    private ringBufferFileCursor = 0;

    private sharedBuffer: WebAssembly.Memory;
    private uIntArray: Uint8Array;
    private eventer: SharedSeekerControls;

    private destroyed = false;
    private currentSeek: Promise<void> | undefined;


    private seekResolve: () => void = () => { };


    constructor(data: RtcSeekableWorkerInit, bufferSize: number = 32 * 1024 * 1024) {
        this.ringBuffer = new RingBuffer(bufferSize);

        this.totalFileSize = data.fileSize;

        this.sharedBuffer = data.targetBuffer;
        this.uIntArray = new Uint8Array(data.targetBuffer.buffer);

        this.eventer = new SharedSeekerControls(data.atomicBuffers);
        
        this.dataChannel = data.channel;
        this.dataChannel.binaryType = "arraybuffer";
        this.eventer.setFileSize(BigInt(data.fileSize));
        
        // It might immediately pump an event
        this.eventer.pumpEvents(this.handleEvents.bind(this));

        this.dataChannel.onmessage = (data: MessageEvent<ArrayBuffer | string>) => {
            if (data.data instanceof ArrayBuffer) {
                this.ringBuffer.append(new Uint8Array(data.data));
            } else {
                const msg = JSON.parse(data.data) as RTCSeekAnswer;
                if (msg.kind === "seekAnswer") this.seekResolve();
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
        
        if (this.dataChannel.readyState !== "open") {
            const { promise: connectPromise, resolve: connectResolve } = Promise.withResolvers<void>();
            this.dataChannel.onopen = () => {
                this.dataChannel.onopen = null;
                connectResolve();
            };
            await connectPromise;
        }
        
        const { promise, resolve } = Promise.withResolvers<void>();
        this.seekResolve = resolve;
        this.dataChannel.send(JSON.stringify({
            kind: "seekTo",
            offset,
            freeSpace: this.ringBuffer.totalSpace
        } as RTCSeekTo));
        
        await promise;
        
        this.ringBuffer.emptyBuffer();
        this.ringBufferFileCursor = offset;
        
        if(DEBUG)
            console.timeStamp("RTC Seek", now, performance.now(), "Seeker", "Video Player", "tertiary-dark");
        
        this.eventer.seekDone();
    }
    
    async copyDataToWorker(size: number, ptr: bigint, offset: number) {
        const now = performance.now();
        if (offset >= this.totalFileSize) {
            console.debug("End of file reached");
            this.eventer.bufferCopied(-1n);
            return;
        }

        //await this.currentSeek;
        //if (this.dataChannel.onmessage) {
        //    const { promise, resolve } = Promise.withResolvers<void>();
        //    this.ringBufferFilledNotify = resolve;
        //    await promise;
        //}

        const currentData = this.ringBuffer.getUsedSpace();
        const availableData = this.ringBufferFileCursor + currentData;
        if (offset < this.ringBufferFileCursor || offset >= availableData) {
            console.warn("No data from RTC to copy :/");
            await new Promise(r => setTimeout(r, 16));
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

        if(DEBUG)
            console.timeStamp("RTC Copy out", now, performance.now(), "Seeker", "Video Player", "tertiary-dark");

        this.ringBufferFileCursor = offset + writtenData;
        this.announceFreeSpace();
    }

    announceFreeSpace() {
        this.dataChannel.send(JSON.stringify({
            kind: "updateFreeSpace",
            freeSpace: Math.max(this.ringBuffer.getFreeSpace() - HIGH_BUFFER, 0),
        } as RTCAnnounceSpace))
    }

    destroy() {
        this.destroyed = true;
    }
}

let seekableStream: RTCSeeker;
self.onmessage = async (e: MessageEvent<RtcSeekableWorkerInit>) => {
    switch (e.data.kind) {
        case "initSeeker": {
            seekableStream = new RTCSeeker(e.data, e.data.bufferSize);
        }
    }
};
