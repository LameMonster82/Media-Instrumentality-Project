

import type { RtcSeekableWorkerInit } from "./types";
import RingBuffer from "./ringBuffer";
import type { WebSocketOfferSDP, WebSocketAnswerSDP, WebSocketICECandidates, RTCRequestData, WebSocketRequestSeeker, RTCDataRequesttAnswered } from "@/shareplay/types";
import SharedSeekerControls, { Operation, type RequestEvent, type SeekEvent } from "./sharedControl";

export default class RTCSeeker {
    private connection: RTCPeerConnection;
    private port: MessagePort;
    private dataChannel: RTCDataChannel | undefined;

    private totalFileSize: Promise<number>;
    private fileSizeResolve: (fileSize: number) => void;

    private ringBuffer: RingBuffer;
    private ringBufferSpaceNotify: () => void = () => { };
    private ringBufferFilledNotify: () => void = () => { };
    private ringBufferDoneNotify: () => void = () => { };
    private ringBufferFileCursor = 0;

    private sharedBuffer: WebAssembly.Memory;
    private uIntArray: Uint8Array;
    private eventer: SharedSeekerControls;

    private destroyed = false;
    private currentDataResolver: ((data: null) => void) | undefined;
    private currentSeek: Promise<void> | undefined;
    private channelPromise: Promise<void>;


    constructor(data: RtcSeekableWorkerInit, info: RTCConfiguration, port: MessagePort, bufferSize: number = 32 * 1024 * 1024) {
        this.connection = new RTCPeerConnection(info);
        this.ringBuffer = new RingBuffer(bufferSize);

        const { promise, resolve } = Promise.withResolvers<number>();

        this.totalFileSize = promise;
        this.fileSizeResolve = resolve;

        port.onmessage = this.handlePortMessages.bind(this);
        this.port = port;
        this.sharedBuffer = data.targetBuffer;
        this.uIntArray = new Uint8Array(data.targetBuffer.buffer);

        this.eventer = new SharedSeekerControls(data.atomicBuffers);
        const { promise: promiseChannel, resolve: resolveChannel } = Promise.withResolvers<void>();
        this.channelPromise = promiseChannel;
        
        this.connection.onicecandidate = this.handleICECandidates.bind(this);
        this.connection.ondatachannel = async (data) => {
            if (this.dataChannel) return;
            data.channel.binaryType = "arraybuffer";
            this.dataChannel = data.channel;
            
            this.dataLoop();
            resolveChannel();
        };
        
        port.postMessage({ kind: "requestSeeker", userId: "" } as WebSocketRequestSeeker);

        // It might immediately pump an event
        this.eventer.pumpEvents(this.handleEvents.bind(this));
    }

    private async handlePortMessages(ev: MessageEvent<WebSocketOfferSDP | WebSocketAnswerSDP | WebSocketICECandidates>) {
        if (ev.data.kind === "offerSDP") {
            this.fileSizeResolve(ev.data.fileSize);
            this.eventer.setFileSize(BigInt(ev.data.fileSize));
            await this.connection.setRemoteDescription(new RTCSessionDescription(ev.data.sdp));

            const answer = await this.connection.createAnswer();
            await this.connection.setLocalDescription(answer);

            this.port.postMessage({
                kind: 'answerSDP',
                userId: "",
                sdp: this.connection.localDescription?.toJSON()
            } as WebSocketAnswerSDP);
        } else if (ev.data.kind === "answerSDP") {
            await this.connection.setRemoteDescription(new RTCSessionDescription(ev.data.sdp));
        } else if (ev.data.kind === "iceCandidates") {
            await this.connection.addIceCandidate(new RTCIceCandidate(ev.data.candidate));
        }
    }

    private handleICECandidates(data: RTCPeerConnectionIceEvent) {
        if (!data.candidate) return;
        this.port.postMessage({
            kind: "iceCandidates",
            userId: "",
            candidate: data.candidate.toJSON()
        } as WebSocketICECandidates);
    }

    private async handleEvents(data: RequestEvent | SeekEvent) {
        await this.channelPromise;
        if (data.type === Operation.REQUEST_DATA) {
            await this.copyDataToWorker(Number(data.size), data.ptr, Number(data.offset));
        } else if (data.type === Operation.SEEK) {
            await this.currentSeek;
            this.currentSeek = this.seek(Number(data.offset));
        }
    }

    public async seek(offset: number = 0) {
        if (this.destroyed) return;

        console.debug("seeking to", offset);

        const fileSize = await this.totalFileSize;
        if (offset >= fileSize)
            debugger;

        if (this.dataChannel?.onmessage) {
            const { promise, resolve } = Promise.withResolvers<void>();
            this.ringBufferDoneNotify = resolve;
            await promise;
        }

        this.ringBuffer.emptyBuffer();
        this.ringBufferFileCursor = offset;
        this.ringBufferSpaceNotify();

        console.debug("seek done");

        this.eventer.seekDone();
    }

    private async dataLoop() {
        const fileSize = await this.totalFileSize;
        while (!this.destroyed) {
            await this.currentSeek;
            const freeSpace = this.ringBuffer.getFreeSpace();
            const usedSpace = this.ringBuffer.getUsedSpace();
            const fileOffset = this.ringBufferFileCursor + usedSpace;
            const totalUnreadSpace = Math.max(fileSize - fileOffset, 0);

            const size = Math.min(totalUnreadSpace, freeSpace);

            if (size > 0) {
                const { promise, resolve } = Promise.withResolvers<void>();
                this.dataChannel!.onmessage = (data: MessageEvent<ArrayBuffer | RTCDataRequesttAnswered>) => {
                    if (data.data instanceof ArrayBuffer) {
                        this.ringBuffer.append(new Uint8Array(data.data));
                    } else {
                        // "requestAnswered" arrives as a JSON string.
                        resolve();
                    }
                };

                this.dataChannel!.send(JSON.stringify({
                    kind: "requestData",
                    offset: fileOffset,
                    size: size
                } as RTCRequestData));

                await promise;

                this.dataChannel!.onmessage = null;
                this.ringBufferFilledNotify();
                this.ringBufferDoneNotify();

                await new Promise(r => setTimeout(r, 16));
            } else {
                const { promise, resolve } = Promise.withResolvers<void>();
                this.ringBufferSpaceNotify = resolve;
                await promise;
            }
        }
    }

    private repeatPenalty = 1;
    async copyDataToWorker(size: number, ptr: bigint, offset: number) {
        if (!this.dataChannel || offset >= await this.totalFileSize) {
            console.warn("End of file reached");
            this.eventer.bufferCopied(-1n);
            return;
        }

        await this.currentSeek;
        //if (this.dataChannel.onmessage) {
        //    const { promise, resolve } = Promise.withResolvers<void>();
        //    this.ringBufferFilledNotify = resolve;
        //    await promise;
        //}

        const currentData = this.ringBuffer.getUsedSpace();
        const availableData = this.ringBufferFileCursor + currentData;
        if (offset < this.ringBufferFileCursor || offset >= availableData) {
            this.repeatPenalty *= 2;
            console.warn("No data. Penalty at ", this.repeatPenalty);
            await new Promise(r => setTimeout(r, this.repeatPenalty));
            this.eventer.bufferCopied(0n);
            return;
        }

        this.repeatPenalty = 1;

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

        // If the writer is full, this will force it free
        // and return when it sees that its destroyed
        this.ringBufferSpaceNotify();
    }
}
