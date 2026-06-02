// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let HEAPU8: any;
    let wasmMemory: any;
}
interface WasmModule {
  _free(_0: number): void;
  _get_exif(_0: number): number;
  _malloc(_0: number): number;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
