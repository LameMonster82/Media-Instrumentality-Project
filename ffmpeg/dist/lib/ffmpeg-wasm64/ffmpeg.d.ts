// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare var RuntimeExports: {
    /**
     * @param {string|null=} returnType
     * @param {Array=} argTypes
     * @param {Array=} args
     * @param {Object=} opts
     */
    ccall: (ident: any, returnType?: (string | null) | undefined, argTypes?: any[] | undefined, args?: any[] | undefined, opts?: Object | undefined) => any;
    /**
     * @param {string=} returnType
     * @param {Array=} argTypes
     * @param {Object=} opts
     */
    cwrap: (ident: any, returnType?: string | undefined, argTypes?: any[] | undefined, opts?: Object | undefined) => (...args: any[]) => any;
    /**
     * @param {number} ptr
     * @param {string} type
     */
    getValue: (ptr: number, type?: string) => any;
    /**
     * @param {number} ptr
     * @param {number} value
     * @param {string} type
     */
    setValue: (ptr: number, value: number, type?: string) => void;
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
    UTF8ToString: (ptr: number, maxBytesToRead?: number | undefined, ignoreNul?: boolean | undefined) => string;
    /** @type {!Uint8Array} */
    HEAPU8: Uint8Array;
    /** @type {!Uint32Array} */
    HEAPU32: Uint32Array;
    /** not-@type {!BigUint64Array} */
    HEAPU64: any;
};
interface WasmModule {
  _init_ffmpeg(_0: number, _1: number, _2: number, _3: BigInt, _4: number): number;
  _open_file(): BigInt;
  _malloc(_0: BigInt): BigInt;
  _set_stream_support(_0: number, _1: number): void;
  _cleanup_video_frame(_0: BigInt): void;
  _free(_0: BigInt): void;
  _cleanup_audio_frame(_0: BigInt): void;
  _cleanup_subtitle_frame(_0: BigInt): void;
  _seek_to(_0: number): number;
  _poke_for_data(): BigInt;
  _cleanup_packet(_0: BigInt): void;
  _cleanup_info(_0: BigInt): void;
  _get_supported_demuxers(_0: BigInt, _1: number): number;
  _av_dict_iterate(_0: BigInt, _1: BigInt): BigInt;
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
  ___set_stack_limits(_0: BigInt, _1: BigInt): void;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
