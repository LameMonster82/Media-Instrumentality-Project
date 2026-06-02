// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    /**
     * @param {string|null=} returnType
     * @param {Array=} argTypes
     * @param {Array=} args
     * @param {Object=} opts
     */
    function ccall(ident: any, returnType?: (string | null) | undefined, argTypes?: any[] | undefined, args?: any[] | undefined, opts?: any | undefined): any;
    /**
     * @param {string=} returnType
     * @param {Array=} argTypes
     * @param {Object=} opts
     */
    function cwrap(ident: any, returnType?: string | undefined, argTypes?: any[] | undefined, opts?: any | undefined): any;
    let wasmMemory: any;
    /**
     * @param {number} ptr
     * @param {number} value
     * @param {string} type
     */
    function setValue(ptr: number, value: number, type?: string): void;
    /**
     * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
     * emscripten HEAP, returns a copy of that string as a Javascript String object.
     *
     * @param {number} ptr
     * @param {number=} maxBytesToRead - An optional length that specifies the
     *   maximum number of bytes to read. You can omit this parameter to scan the
     *   string until the first 0 byte. If maxBytesToRead is passed, and the string
     *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
     *   string will cut short at that byte index.
     * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
     * @return {string}
     */
    function UTF8ToString(ptr: number, maxBytesToRead?: number | undefined, ignoreNul?: boolean | undefined): string;
    let HEAPU8: Uint8Array;
    let HEAPU32: Uint32Array;
}
interface WasmModule {
  _init_ffmpeg(_0: number, _1: number): void;
  _get_supported_demuxers(): void;
  _malloc(_0: BigInt): BigInt;
  _free(_0: BigInt): void;
  _get_exif(): number;
  _open_file(_0: number, _1: BigInt): number;
  _get_data(): number;
  _seek_to(_0: number): number;
  _cleanup(): void;
  _extract_thumbnail(): number;
  _emscripten_builtin_free(_0: BigInt): void;
  _emscripten_builtin_malloc(_0: BigInt): BigInt;
  ___libc_free(_0: BigInt): void;
  ___libc_malloc(_0: BigInt): BigInt;
  _strndup(_0: BigInt, _1: BigInt): BigInt;
  __ZdaPv(_0: BigInt): void;
  __ZdaPvm(_0: BigInt, _1: BigInt): void;
  __ZdlPv(_0: BigInt): void;
  __ZdlPvm(_0: BigInt, _1: BigInt): void;
  __Znam(_0: BigInt): BigInt;
  __ZnamSt11align_val_t(_0: BigInt, _1: BigInt): BigInt;
  __Znwm(_0: BigInt): BigInt;
  __ZnwmSt11align_val_t(_0: BigInt, _1: BigInt): BigInt;
  ___libc_calloc(_0: BigInt, _1: BigInt): BigInt;
  ___libc_realloc(_0: BigInt, _1: BigInt): BigInt;
  _emscripten_builtin_calloc(_0: BigInt, _1: BigInt): BigInt;
  _emscripten_builtin_realloc(_0: BigInt, _1: BigInt): BigInt;
  _malloc_size(_0: BigInt): BigInt;
  _malloc_usable_size(_0: BigInt): BigInt;
  _reallocf(_0: BigInt, _1: BigInt): BigInt;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
