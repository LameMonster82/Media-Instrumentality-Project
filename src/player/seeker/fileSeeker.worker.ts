import SharedSeekerControls, { Operation, type RequestEvent, type SeekEvent } from "./sharedControl";
import type { FileSeekableWorkerInit } from "./types";

class FileSeeker {
    private file: File;

    private sharedBuffer: WebAssembly.Memory;
    private uIntArray: Uint8Array;
    private eventer: SharedSeekerControls;

    constructor(file: File, targetBuffer: WebAssembly.Memory, atomicBuffers: SharedArrayBuffer) {
        this.file = file;

        this.sharedBuffer = targetBuffer;
        this.uIntArray = new Uint8Array(targetBuffer.buffer);

        this.eventer = new SharedSeekerControls(atomicBuffers);
        this.eventer.setFileSize(BigInt(this.file.size));
        this.eventer.pumpEvents(this.handleEvents.bind(this))
    }

    private async handleEvents(data: RequestEvent | SeekEvent) {
        if (data.type === Operation.REQUEST_DATA) {
            await this.copyDataToWorker(Number(data.size), data.ptr, Number(data.offset));
        } else if (data.type === Operation.SEEK) {
            this.seek(Number(data.offset));
        }
    }

    public seek(_offset: number = 0): void {
        this.eventer.seekDone();
    }

    async copyDataToWorker(size: number, ptr: bigint, offset: number) {
        if (offset >= this.file.size) {
            console.warn("End of file reached");
            this.eventer.bufferCopied(-1n);
            return;
        }

        if (Number(ptr) + size > this.uIntArray.byteLength) {
            const oldSize = this.uIntArray.byteLength;
            this.uIntArray = new Uint8Array(this.sharedBuffer.buffer);
            console.debug(`Uhh buffer not enough. Lets recreate it ${oldSize} -> ${this.uIntArray.byteLength}`);
        }

        const fileDataBlob = this.file.slice(offset, offset + size);
        const data = await fileDataBlob.bytes();

        this.uIntArray.set(data, Number(ptr));

        this.eventer.bufferCopied(BigInt(size));
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
