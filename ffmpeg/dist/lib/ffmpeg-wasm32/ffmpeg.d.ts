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
    function cwrap(ident: any, returnType?: string | undefined, argTypes?: any[] | undefined, opts?: any | undefined): (...args: any[]) => any;
    let wasmMemory: any;
    /**
     * @param {number} ptr
     * @param {string} type
     */
    function getValue(ptr: number, type?: string): any;
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
    let HEAPU64: any;
}
interface WasmModule {
  _init_ffmpeg(_0: number, _1: number, _2: number, _3: number, _4: number): number;
  _malloc(_0: number): number;
  _open_file(): number;
  _set_stream_support(_0: number, _1: number): void;
  _cleanup_video_frame(_0: number): void;
  _free(_0: number): void;
  _cleanup_audio_frame(_0: number): void;
  _seek_to(_0: number): number;
  _poke_for_data(): number;
  _cleanup_packet(_0: number): void;
  _cleanup_info(_0: number): void;
  _get_supported_demuxers(_0: number, _1: number): number;
  _av_dict_iterate(_0: number, _1: number): number;
  _emscripten_builtin_free(_0: number): void;
  _emscripten_builtin_malloc(_0: number): number;
  ___libc_free(_0: number): void;
  ___libc_malloc(_0: number): number;
  _strndup(_0: number, _1: number): number;
  __ZdaPv(_0: number): void;
  __ZdaPvm(_0: number, _1: number): void;
  __ZdlPv(_0: number): void;
  __ZdlPvm(_0: number, _1: number): void;
  __Znam(_0: number): number;
  __ZnamSt11align_val_t(_0: number, _1: number): number;
  __Znwm(_0: number): number;
  __ZnwmSt11align_val_t(_0: number, _1: number): number;
  ___libc_calloc(_0: number, _1: number): number;
  ___libc_realloc(_0: number, _1: number): number;
  _emscripten_builtin_calloc(_0: number, _1: number): number;
  _emscripten_builtin_realloc(_0: number, _1: number): number;
  _malloc_size(_0: number): number;
  _malloc_usable_size(_0: number): number;
  _reallocf(_0: number, _1: number): number;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
