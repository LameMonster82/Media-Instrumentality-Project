import { HIGH_BUFFER, LOW_BUFFER, type RTCAnnounceSpace, type RTCHosterWorkerInit, type RTCSeekTo, type RTCBlockSize, type RTCSeekAnswer } from "./types";

class RTCHoster {
    private file: File;
    private channels: {
        channel: RTCDataChannel
        freeSpaceMap: number[],
        isSeeking: boolean,
        isReading: boolean,
        currentReadPromise: Promise<void>,
    }[] = [];
    private maxBlockSize: number | undefined;
    private scratchBuffer: Uint8Array<ArrayBuffer> | undefined;

    constructor(data: RTCHosterWorkerInit) {
        this.file = data.file;

        for (const channel of data.channels)
            this.addChannel(channel);
    }

    private addChannel(channel: RTCDataChannel) {
        const pump = async () => {
            const info = this.channels[index];
            if (info.isSeeking || 
                info.channel.bufferedAmount >= HIGH_BUFFER ||
                this.maxBlockSize === undefined || this.scratchBuffer === undefined ||
                info.channel.readyState !== "open") return;

            const { promise, resolve } = Promise.withResolvers<void>();
            info.currentReadPromise = promise;
            info.isReading = true;
            let nextPtr;
            while (!info.isSeeking && (nextPtr = info.freeSpaceMap.shift()) !== undefined) {
                const data = await this.file.slice(nextPtr, nextPtr + this.maxBlockSize).arrayBuffer();
                if (info.isSeeking) break;

                new DataView(this.scratchBuffer.buffer).setBigUint64(0, BigInt(nextPtr), true);
                this.scratchBuffer.set(new Uint8Array(data), 8);
                try {
                    info.channel.send(this.scratchBuffer.subarray(0, data.byteLength + 8));
                } catch {
                    // we failed to send the data
                    // put the pointer back and we will try next time
                    info.freeSpaceMap.unshift(nextPtr);
                    break;
                }

                if (info.channel.bufferedAmount >= HIGH_BUFFER)
                    break;
            }

            info.isReading = false;
            resolve();
        };
        channel.bufferedAmountLowThreshold = LOW_BUFFER;
        channel.onbufferedamountlow = pump.bind(this)
        
        const index = this.channels.push({
            channel,
            freeSpaceMap: [],
            isSeeking: false,
            isReading: false,
            currentReadPromise: Promise.resolve(),
        }) - 1;

        channel.onmessage = async (ev) => {
            if (typeof ev.data !== "string") return;
            const data = JSON.parse(ev.data) as RTCSeekTo | RTCAnnounceSpace;
            const info = this.channels[index];

            if (data.kind === "seekTo") {
                // optionally there is an offset but who cares
                info.isSeeking = true;
                info.freeSpaceMap.length = 0;
                await info.currentReadPromise;
                info.isSeeking = false;
                info.channel.send(JSON.stringify({
                    kind: "seekAnswer"
                } as RTCSeekAnswer));
            } else if (data.kind === "updateFreeSpace") {
                info.freeSpaceMap.push(...data.freeSpace);
            }

            if (!info.isReading)
                pump();
        }
    }

    public async setBlockSize(size: number) {
        this.maxBlockSize = size - 8; // padding for ptr
        this.scratchBuffer = new Uint8Array(size);
        for (const { channel } of this.channels) {
            if (channel.readyState !== "open") {
                const { promise, resolve } = Promise.withResolvers();
                channel.onopen = resolve;
                await promise;
            }
            channel.send(JSON.stringify({
                kind: "blockSize",
                blockSize: this.maxBlockSize
            } as RTCBlockSize));
        }

    }
}

let hosterStream: RTCHoster;
self.onmessage = async (e: MessageEvent<RTCHosterWorkerInit | RTCBlockSize>) => {
    switch (e.data.kind) {
        case "init": {
            hosterStream = new RTCHoster(e.data);
            break;
        }
        case "blockSize": {
            hosterStream?.setBlockSize(e.data.blockSize);
            break;
        }
    }
};