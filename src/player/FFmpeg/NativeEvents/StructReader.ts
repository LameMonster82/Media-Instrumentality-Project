/*
 * StructReader.ts — Typed reader for C structs in Wasm linear memory.
 * Wraps a DataView at the Wasm memory buffer and reads fields at
 * absolute byte addresses.
 */
import type { MainModule } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";

export default class StructReader {
    private dv: DataView;
    private isLE: boolean = true;
    private base: number = 0;

    constructor(private module: MainModule) {
        this.dv = new DataView(module.HEAPU8.buffer);
    }

    setOffset(base: number) {
        this.base = base;
    }

    i32(offset: number): number {
        return this.dv.getInt32(this.base + offset, this.isLE);
    }

    u32(offset: number): number {
        return this.dv.getUint32(this.base + offset, this.isLE);
    }

    i64(offset: number): bigint {
        return this.dv.getBigInt64(this.base + offset, this.isLE);
    }

    f64(offset: number): number {
        return this.dv.getFloat64(this.base + offset, this.isLE);
    }

    ptr(offset: number): number {
        return this.dv.getUint32(this.base + offset, this.isLE);
    }

    str(offset: number): string {
        const ptr = this.ptr(offset);
        if (ptr === 0) return "";
        return this.module.UTF8ToString(ptr);
    }

    bytes(ptrOffset: number, sizeOffset: number): Uint8Array {
        const ptr = this.ptr(ptrOffset);
        const size = this.i32(sizeOffset);
        if (ptr === 0 || size <= 0) return new Uint8Array(0);
        return this.module.HEAPU8.slice(ptr, ptr + size);
    }

    /** Read array of null-terminated string pointers at ptrOffset, count elements */
    strArray(ptrOffset: number, countOffset: number): string[] {
        const count = this.i32(countOffset);
        const ptr = this.ptr(ptrOffset);
        if (ptr === 0 || count <= 0) return [];

        const heap32 = this.module.HEAPU32;
        const result: string[] = [];
        const baseWord = ptr >> 2;
        for (let i = 0; i < count; i++) {
            const strPtr = heap32[baseWord + i];
            result.push(strPtr ? this.module.UTF8ToString(strPtr) : "");
        }
        return result;
    }

    /** Read a fixed-size char array at byte offset */
    fixedStr(offset: number, maxLen: number): string {
        return this.module.UTF8ToString(this.base + offset, maxLen);
    }
}
