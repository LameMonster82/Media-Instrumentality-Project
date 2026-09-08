// byte 0-3: Lock/Unlock (aligned)
// byte 4-7: Operation
// byte 8-15: File size u64 (1)
// byte 16-23: requested offset u64 (2)
// byte 24-31: ptr to write to u64 (3)
// byte 32-39: size of the request u64 (4)
// byte 40-47: Written i64 (5)

// eslint-disable-next-line @typescript-eslint/naming-convention
const BUFFER_SIZE = 64;
export enum Operation {
    NO_EVENT = -1,
    REQUEST_DATA = 0,
    SEEK,
    BUFFER_COPIED,
    SEEK_DONE
}

export type RequestEvent = { type: Operation.REQUEST_DATA, offset: bigint, ptr: bigint, size: bigint; };
export type SeekEvent = { type: Operation.SEEK, offset: bigint; };


export default class SharedSeekerControls {
    private memory: Int32Array<SharedArrayBuffer>;
    private memory64: BigInt64Array<SharedArrayBuffer>;
    private memoryU64: BigUint64Array<SharedArrayBuffer>;
    private destroyed = false;
    private destroyedPromise: Promise<void>;
    private destroyedResolve: () => void;

    constructor(memory?: SharedArrayBuffer) {
        if ((memory?.byteLength ?? BUFFER_SIZE) < BUFFER_SIZE) {
            throw new Error("SharedArrayBuffer to small");
        }

        memory ??= new SharedArrayBuffer(BUFFER_SIZE);
        this.memory = new Int32Array(memory);
        this.memory64 = new BigInt64Array(memory);
        this.memoryU64 = new BigUint64Array(memory);

        const { promise, resolve } = Promise.withResolvers<void>();
        this.destroyedPromise = promise;
        this.destroyedResolve = resolve;
    }

    getBuffer() {
        return this.memory.buffer;
    }

    getFileSize() {
        return Atomics.load(this.memoryU64, 1);
    }

    setFileSize(size: bigint) {
        return Atomics.store(this.memoryU64, 1, size);
    }

    async pumpEvents(callback: (data: RequestEvent | SeekEvent) => Promise<void>) {
        while (!this.destroyed) {
            const waiter = Atomics.waitAsync(this.memory, 0, 0);
            if (waiter.async) {
                await Promise.race([waiter.value, this.destroyedPromise]);
                if (this.destroyed) continue;
            }

            if (Atomics.load(this.memory, 0) === 0)
                continue;

            Atomics.store(this.memory, 0, 0);

            const event = Atomics.load(this.memory, 1) as Operation;
            if (event === Operation.REQUEST_DATA) {
                const offset = Atomics.load(this.memoryU64, 2);
                const ptr = Atomics.load(this.memoryU64, 3);
                const size = Atomics.load(this.memoryU64, 4);

                await callback({
                    type: Operation.REQUEST_DATA,
                    offset,
                    ptr,
                    size
                });
            } else if (event === Operation.SEEK) {
                const offset = Atomics.load(this.memoryU64, 2);

                await callback({
                    type: Operation.SEEK,
                    offset,
                });
            }
        }
    }

    seek(offset: bigint) {
        Atomics.store(this.memoryU64, 2, offset);
        Atomics.store(this.memory, 1, Operation.SEEK);

        Atomics.store(this.memory, 0, 1);
        Atomics.notify(this.memory, 0);
        Atomics.wait(this.memory, 0, 1);

        const event = Atomics.load(this.memory, 1);
        this.clearEvent();

        return event === Operation.SEEK_DONE;
    }

    async seekAsync(offset: bigint) {
        Atomics.store(this.memoryU64, 2, offset);
        Atomics.store(this.memory, 1, Operation.SEEK);

        Atomics.store(this.memory, 0, 1);
        Atomics.notify(this.memory, 0);
        await Atomics.waitAsync(this.memory, 0, 1).value;

        const event = Atomics.load(this.memory, 1);
        this.clearEvent();

        return event === Operation.SEEK_DONE;
    }

    seekDone() {
        Atomics.store(this.memory, 1, Operation.SEEK_DONE);

        Atomics.store(this.memory, 0, 0);
        Atomics.notify(this.memory, 0);
    }

    requestData(ptr: bigint, offset: bigint, size: bigint) {
        Atomics.store(this.memoryU64, 2, offset);
        Atomics.store(this.memoryU64, 3, ptr);
        Atomics.store(this.memoryU64, 4, size);
        Atomics.store(this.memory, 1, Operation.REQUEST_DATA);

        Atomics.store(this.memory, 0, 1);
        Atomics.notify(this.memory, 0);
        Atomics.wait(this.memory, 0, 1);

        const written = Atomics.load(this.memory64, 5);
        this.clearEvent();

        return written;
    }

    bufferCopied(howMuch: bigint) {
        Atomics.store(this.memory64, 5, howMuch);
        Atomics.store(this.memory, 1, Operation.BUFFER_COPIED);

        Atomics.store(this.memory, 0, 0);
        Atomics.notify(this.memory, 0);
    }

    clearEvent() {
        Atomics.store(this.memory, 1, Operation.NO_EVENT);
    }

    destroy() {
        this.destroyedResolve();
    }
}