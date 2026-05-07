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
}
interface WasmModule {
  _custom_read_packet(_0: number, _1: number, _2: number): number;
  _custom_write_packet(_0: number, _1: number, _2: number): number;
  _custom_seek_packet(_0: number, _1: BigInt, _2: number): BigInt;
  _malloc(_0: number): number;
  _videoStreamToConfig(_0: number): number;
  _free(_0: number): void;
  _init_ffmpeg(_0: number, _1: number): void;
  _get_supported_demuxers(): void;
  _get_exif(): number;
  _open_file(_0: number, _1: number): number;
  _get_data(): number;
  _seek_to(_0: number): number;
  _cleanup(): void;
  _extract_thumbnail(): number;
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
