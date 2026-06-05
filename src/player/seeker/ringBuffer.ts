export default class RingBuffer {
    private cursor: number = 0;
    private writtenCursor: number = 0;
    private buffer: Uint8Array;

    constructor(bufferSize: number) {
        this.buffer = new Uint8Array(bufferSize);
    }

    get totalSpace(): number {
        return this.buffer.length - 1;
    }

    getFreeSpace(): number {
        if (this.writtenCursor >= this.cursor) {
            return this.buffer.byteLength - (this.writtenCursor - this.cursor) - 1;
        } else {
            return (this.cursor - this.writtenCursor) - 1;
        }
    }

    getUsedSpace(): number {
        return (this.writtenCursor - this.cursor + this.buffer.length) % this.buffer.length;
    }

    append(data: Uint8Array): number {
        const free = this.getFreeSpace();
        if (free === 0) return 0;
        const toCopy = Math.min(data.length, free);

        // first part: from writePos to end of buffer
        const firstPart = Math.min(toCopy, this.buffer.length - this.writtenCursor);
        this.buffer.set(data.subarray(0, firstPart), this.writtenCursor);
        // second part: from start of buffer
        const secondPart = toCopy - firstPart;
        if (secondPart > 0) {
            this.buffer.set(data.subarray(firstPart, firstPart + secondPart), 0);
        }
        this.writtenCursor = (this.writtenCursor + toCopy) % this.buffer.length;
        return toCopy;
    }

    copyTo(target: Uint8Array, targetPtr: number, size: number, sourceOffset = 0, eatTheData = true): number {
        const offsetCursor = this.cursor + sourceOffset;
        const readable = (this.writtenCursor - offsetCursor + this.buffer.length) % this.buffer.length;
        const toCopy = Math.min(size, readable);
        if (toCopy === 0) return 0;

        const firstPart = Math.min(toCopy, this.buffer.length - offsetCursor);
        target.set(this.buffer.subarray(offsetCursor, offsetCursor + firstPart), targetPtr);
        const secondPart = toCopy - firstPart;
        if (secondPart > 0) {
            target.set(this.buffer.subarray(0, secondPart), targetPtr + firstPart);
        }
        if (eatTheData) {
            this.cursor = (offsetCursor + toCopy) % this.buffer.length;
        }
        return toCopy;
    }

    discard(size: number) {
        size = Math.min(size, this.getUsedSpace());
        this.cursor = (this.cursor + size) % this.buffer.length;
    }

    emptyBuffer() {
        this.cursor = 0;
        this.writtenCursor = 0;
    }
}
