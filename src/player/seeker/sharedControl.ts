// byte 0-3: Lock/Unlock (aligned)
// byte 4-7: Operation
// byte 8-15: File size u64 (1)
// byte 16-23: requested offset u64 (2)
// byte 24-31: ptr to write to u64 (3)
// byte 32-39: size of the request u64 (4)
// byte 40-47: Written i64 (5)

// eslint-disable-next-line @typescript-eslint/naming-convention
const BUFFER_SIZE = 64;
// eslint-disable-next-line @typescript-eslint/naming-convention
const DEBUG = import.meta.env.DEV;

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

        const memorySB = memory ?? new SharedArrayBuffer(BUFFER_SIZE);
        this.memory = new Int32Array(memorySB);
        this.memory64 = new BigInt64Array(memorySB);
        this.memoryU64 = new BigUint64Array(memorySB);

        const { promise, resolve } = Promise.withResolvers<void>();
        this.destroyedPromise = promise;
        this.destroyedResolve = resolve;

        if(memory === undefined)
            Atomics.store(this.memory, 1, Operation.NO_EVENT);
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
            let waiter = Atomics.waitAsync(this.memory, 0, 0);
            if (waiter.async) {
                await Promise.race([waiter.value, this.destroyedPromise]);
                if (this.destroyed) continue;
            }

            if (Atomics.load(this.memory, 0) === 0)
                continue;

            
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
            Atomics.store(this.memory, 0, 2);
            Atomics.notify(this.memory, 0);

            waiter = Atomics.waitAsync(this.memory, 0, 2);
            if (waiter.async) {
                await Promise.race([waiter.value, this.destroyedPromise]);
                if (this.destroyed) continue;
            }
        }
    }

    seek(offset: bigint) {
        const now = performance.now();
        Atomics.store(this.memoryU64, 2, offset);
        Atomics.store(this.memory, 1, Operation.SEEK);

        Atomics.store(this.memory, 0, 1);
        Atomics.notify(this.memory, 0);
        Atomics.wait(this.memory, 0, 1);

        const event = Atomics.load(this.memory, 1);
        this.clearEvent();
        if (DEBUG)
            console.timeStamp("Seek", now, performance.now(), "Shared Message", "Video Player")

        return event === Operation.SEEK_DONE;
    }

    async seekAsync(offset: bigint) {
        const now = performance.now();
        Atomics.store(this.memoryU64, 2, offset);
        Atomics.store(this.memory, 1, Operation.SEEK);

        Atomics.store(this.memory, 0, 1);
        Atomics.notify(this.memory, 0);
        await Atomics.waitAsync(this.memory, 0, 1).value;

        const event = Atomics.load(this.memory, 1);
        this.clearEvent();
        if (DEBUG)
            console.timeStamp("Seek Async", now, performance.now(), "Shared Message", "Video Player")

        return event === Operation.SEEK_DONE;
    }

    seekDone() {
        const now = performance.now();
        Atomics.store(this.memory, 1, Operation.SEEK_DONE);
        if (DEBUG)
            console.timeStamp("Seek ACK", now, performance.now(), "Shared Message", "Video Player")
    }

    requestData(ptr: bigint, offset: bigint, size: bigint) {
        const now = performance.now();
        Atomics.store(this.memoryU64, 2, offset);
        Atomics.store(this.memoryU64, 3, ptr);
        Atomics.store(this.memoryU64, 4, size);
        Atomics.store(this.memory, 1, Operation.REQUEST_DATA);

        Atomics.store(this.memory, 0, 1);
        Atomics.notify(this.memory, 0);
        Atomics.wait(this.memory, 0, 1);

        const written = Atomics.load(this.memory64, 5);
        this.clearEvent();
        if (DEBUG)
            console.timeStamp("Request Data", now, performance.now(), "Shared Message", "Video Player")

        return written;
    }

    bufferCopied(howMuch: bigint) {
        const now = performance.now();
        Atomics.store(this.memory64, 5, howMuch);
        Atomics.store(this.memory, 1, Operation.BUFFER_COPIED);
        if(DEBUG)
            console.timeStamp("Buffer ACK", now, performance.now(), "Shared Message", "Video Player")
    }

    clearEvent() {
        Atomics.store(this.memory, 1, Operation.NO_EVENT);
        Atomics.store(this.memory, 0, 0);
        Atomics.notify(this.memory, 0);
    }

    destroy() {
        this.destroyedResolve();
    }
}