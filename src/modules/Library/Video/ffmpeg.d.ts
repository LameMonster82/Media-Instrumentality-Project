// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let HEAPU8: any;
    let wasmMemory: any;
}
interface WasmModule {
  _free(_0: number): void;
  _malloc(_0: number): number;
  __ZdlPvm(_0: number, _1: number): void;
  _custom_read_packet(_0: number, _1: number, _2: number): number;
  _custom_write_packet(_0: number, _1: number, _2: number): number;
  _custom_seek_packet(_0: number, _1: BigInt, _2: number): BigInt;
  _videoStreamToConfig(_0: number): number;
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
  ___libc_calloc(_0: number, _1: number): number;
  ___libc_free(_0: number): void;
  ___libc_malloc(_0: number): number;
  __ZdaPv(_0: number): void;
  __ZdaPvm(_0: number, _1: number): void;
  __ZdlPv(_0: number): void;
  __Znaj(_0: number): number;
  __ZnajSt11align_val_t(_0: number, _1: number): number;
  __Znwj(_0: number): number;
  __ZnwjSt11align_val_t(_0: number, _1: number): number;
  ___libc_realloc(_0: number, _1: number): number;
  _emscripten_builtin_calloc(_0: number, _1: number): number;
  _emscripten_builtin_realloc(_0: number, _1: number): number;
  _malloc_size(_0: number): number;
  _malloc_usable_size(_0: number): number;
  _reallocf(_0: number, _1: number): number;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
