

import type { Dictionary } from "@/core/types";
import AtomicEventer from "../atomicEventer/atomicEventer";
import type { DecodeTemplate, SerializableStuff } from "../atomicEventer/types";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type RtcSeekableWorkerInit, type UrlSeekableWorkerInit } from "./types";
import RingBuffer from "./ringBuffer";
import type { WebSocketOfferSDP, WebSocketAnswerSDP, WebSocketICECandidates, RTCRequestData, WebSocketRequestSeeker, RTCDataRequesttAnswered } from "@/shareplay/types";

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
    private eventer: AtomicEventer<
        SeekerResponseType,
        SeekerRequestType,
        typeof seekerResponseTemplates,
        typeof seekerRequestTemplates>;

    private destroyed = false;
    private currentDataResolver: ((data: null) => void) | undefined;
    private currentSeek: Promise<void> | undefined;


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

        this.eventer = new AtomicEventer(data.atomicBuffers, seekerResponseTemplates, seekerRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));

        this.connection.onicecandidate = this.handleICECandidates.bind(this);
        this.connection.ondatachannel = async (data) => {
            if (this.dataChannel) return;
            data.channel.binaryType = "arraybuffer";
            this.dataChannel = data.channel;

            this.dataLoop();

            this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
                result: 0,
                fileSize: BigInt(await this.totalFileSize)
            });
        };

        port.postMessage({ kind: "requestSeeker", userId: "" } as WebSocketRequestSeeker);
    }

    private async handlePortMessages(ev: MessageEvent<WebSocketOfferSDP | WebSocketAnswerSDP | WebSocketICECandidates>) {
        if (ev.data.kind === "offerSDP") {
            this.fileSizeResolve(ev.data.fileSize);
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

    private async handleEvents(type: SeekerRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerRequestType.SEEK: {
                await this.currentSeek;
                const dataThing = data as { offset: number, urlChange: string; };
                this.currentSeek = this.seek(dataThing.offset);
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

    public async seek(offset: number = 0) {
        if (this.destroyed) return;

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

        this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
            result: 0,
            fileSize: BigInt(fileSize)
        });
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
                    if (data.data instanceof ArrayBuffer)
                        this.ringBuffer.append(new Uint8Array(data.data));
                    else {
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
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, { written: -1n });
            return;
        }

        await this.currentSeek;
        if (this.dataChannel.onmessage) {
            const { promise, resolve } = Promise.withResolvers<void>();
            this.ringBufferFilledNotify = resolve;
            await promise;   
        }

        const currentData = this.ringBuffer.getUsedSpace();
        const availableData = this.ringBufferFileCursor + currentData;
        if (offset < this.ringBufferFileCursor || offset >= availableData) {
            this.repeatPenalty *= 2;
            console.warn("No data. Penalty at ", this.repeatPenalty);
            await new Promise(r => setTimeout(r, this.repeatPenalty));
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, {
                written: 0n,
            });
            return;
        }

        this.repeatPenalty = 1;

        const slightOffset = offset - this.ringBufferFileCursor;
        const allowedSize = Math.min(currentData - slightOffset, size);

        if (Number(ptr) + allowedSize > this.uIntArray.byteLength) {
            const oldSize = this.uIntArray.byteLength;
            this.uIntArray = new Uint8Array(this.sharedBuffer.buffer);
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

        // If the writer is full, this will force it free
        // and return when it sees that its destroyed
        this.ringBufferSpaceNotify();
    }
}
