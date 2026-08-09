

import type { Dictionary } from "@/core/types";
import AtomicEventer from "../atomicEventer/atomicEventer";
import type { AtomicEventerBuffers, DecodeTemplate, SerializableStuff } from "../atomicEventer/types";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type FileSeekableWorkerInit, type UrlSeekableWorkerInit } from "./types";
import RingBuffer from "./ringBuffer";

class FileSeeker {
    private file: File;

    private sharedBuffer: WebAssembly.Memory;
    private uIntArray: Uint8Array;
    private eventer: AtomicEventer<
        SeekerResponseType,
        SeekerRequestType,
        typeof seekerResponseTemplates,
        typeof seekerRequestTemplates>;

    constructor(file: File, targetBuffer: WebAssembly.Memory, atomicBuffers: AtomicEventerBuffers) {
        this.file = file;

        this.sharedBuffer = targetBuffer;
        this.uIntArray = new Uint8Array(targetBuffer.buffer);

        this.eventer = new AtomicEventer(atomicBuffers, seekerResponseTemplates, seekerRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));
    }

    private async handleEvents(type: SeekerRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerRequestType.SEEK: {
                const dataThing = data as { offset: number, urlChange: string; };
                this.seek(dataThing.offset);
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

    public seek(offset: number = 0): void {
        this.eventer.sendEvent(SeekerResponseType.SEEK_DONE, {
            result: 0,
            fileSize: BigInt(this.file.size)
        });
    }

    async copyDataToWorker(size: number, ptr: bigint, offset: number) {
        if (offset >= this.file.size) {
            console.warn("End of file reached");
            this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, { written: -1n });
            return;
        }

        if (Number(ptr) + size > this.uIntArray.byteLength) {
            const oldSize = this.uIntArray.byteLength;
            this.uIntArray = new Uint8Array(this.sharedBuffer.buffer);
            console.log(`Uhh buffer not enough. Lets recreate it ${oldSize} -> ${this.uIntArray.byteLength}`);
        }

        const fileDataBlob = this.file.slice(offset, offset + size);
        const data = await fileDataBlob.bytes();

        this.uIntArray.set(data, Number(ptr));

        this.eventer.sendEvent(SeekerResponseType.BUFFER_COPIED, {
            written: BigInt(size),
        });
    }

    destroy() {

    }
}

let seekableStream: FileSeeker;
self.onmessage = async (e: MessageEvent<FileSeekableWorkerInit>) => {
    switch (e.data.type) {
        case "init": {
            seekableStream = new FileSeeker(e.data.file, e.data.targetBuffer, e.data.atomicBuffers);
            await seekableStream.seek();
        }
    }
};
