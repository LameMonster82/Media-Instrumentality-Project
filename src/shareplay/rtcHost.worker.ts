import { HIGH_BUFFER, LOW_BUFFER, type RTCAnnounceSpace, type RTCHosterWorkerInit, type RTCSeekAnswer, type RTCSeekTo, type RTCUpdateMaxMsgSize } from "./types";

class RTCHoster {
    private file: File;
    private channel: RTCDataChannel;
    public maxSize: number;

    private fileCursor = 0;
    private freeSpace: number = 0;

    private cancelReadingResolve: () => void = () => { };
    private spaceResolve: () => void = () => { };
    private cancelReading = false;
    private lastSeek: Promise<void> | null = null;

    constructor(data: RTCHosterWorkerInit) {
        this.file = data.file;
        this.channel = data.channel;
        this.maxSize = data.maxSize;

        this.channel.bufferedAmountLowThreshold = LOW_BUFFER;
        this.channel.onbufferedamountlow = () => {
            if (this.cancelReading || this.lastSeek !== null) return; // Buffer flushing or already in action
            this.lastSeek = this.seek(this.fileCursor);
        }
        this.channel.onmessage = this.handleMessages.bind(this);
    }

    async seek(offset: number) {
        const { promise: cancelPromise, resolve: cancelResolve } = Promise.withResolvers<void>();
        this.cancelReadingResolve = cancelResolve;

        this.fileCursor = offset;
        const reader = this.file.slice(offset).stream().getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done || this.cancelReading) break;
                if (this.freeSpace <= 0) {
                    const { promise: spacePromise, resolve: spaceResolve } = Promise.withResolvers<void>();
                    this.spaceResolve = spaceResolve;
                    await Promise.race([spacePromise, cancelPromise]);
                    if (this.cancelReading) break;
                }
                
                let dataToSend = value.byteLength;
                try {
                    while (dataToSend > 0 && this.channel.bufferedAmount < HIGH_BUFFER) {
                        const start = value.byteLength - dataToSend;
                        const subArray = value.subarray(start, start + Math.min(this.maxSize, dataToSend));
                        this.channel.send(subArray);
                        this.freeSpace -= subArray.byteLength;
                        this.fileCursor += subArray.byteLength;
                        dataToSend -= subArray.byteLength;
                    }
                } catch { }

                if (this.channel.bufferedAmount >= HIGH_BUFFER)
                    break;
            }
        } finally {
            reader.releaseLock();
        }
        this.lastSeek = null;
    }

    async handleMessages(ev: MessageEvent<string>) {
        if (typeof ev.data !== "string") return;
        const data = JSON.parse(ev.data) as RTCSeekTo | RTCAnnounceSpace;

        if (data.kind === "seekTo") {
            this.cancelReading = true;
            this.cancelReadingResolve();
            await this.lastSeek;
            this.freeSpace = data.freeSpace;
            this.cancelReading = false;
            this.lastSeek = this.seek(data.offset);
            this.channel.send(JSON.stringify({
                kind: "seekAnswer"
            } as RTCSeekAnswer))
        } else if (data.kind === "updateFreeSpace") {
            this.freeSpace = data.freeSpace;
            this.spaceResolve();
        }
    }
}

let hosterStream: RTCHoster;
self.onmessage = async (e: MessageEvent<RTCHosterWorkerInit | RTCUpdateMaxMsgSize>) => {
    switch (e.data.kind) {
        case "init": {
            hosterStream = new RTCHoster(e.data);
            break;
        }
        case "updateMsgSize": {
            if (hosterStream)
                hosterStream.maxSize = e.data.maxSize;
            break;
        }
    }
};