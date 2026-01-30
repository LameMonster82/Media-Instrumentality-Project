import { PromiseRes, SeekableWorkerUrl, type WorkerExifTags, type WorkerMediaInfo, type WorkerRequestExif, type WorkerShutdown } from "../SomeTypes";
import { CtrlPkg, STATE_EOF, STATE_GOOD, STATE_NOT_INIT, type SeekableWorkerCtrlBuf } from "../Video/SharedSeekableStream2";
import type { MainModule } from "./libexif";
import libexif_wasm from "./libexif.mjs";

//@ts-ignore
import exifWasmImport from "./libexif.wasm";


const exifWasm = exifWasmImport;
let outModule: MainModule;
let ctrlBuff: BigInt64Array;
let readOffset: bigint = 0n;
let endOfFile = false;
let seekerWorker: Worker;
let seekerChannel = new MessageChannel();
let exifData: WorkerExifTags = {
    kind: "exifTags",
    tags: [],
    xmpImages: []
}

async function LoadWasmModule(dataInfo: WorkerRequestExif) {
    const newModule = await libexif_wasm({
        locateFile: (file: string) => file.endsWith(".wasm") ? exifWasm : file,
        onRuntimeInitialized: () => {
            console.log("Libexif WebAssembly initialized.");
        },
    }) as MainModule;

    if (dataInfo.url) {
        const { promise, resolve } = PromiseRes<void>();
        seekerWorker = new Worker(SeekableWorkerUrl, { type: 'module', name: "I buffer the file " + dataInfo.url });
        seekerWorker.onmessage = (e: MessageEvent<SeekableWorkerCtrlBuf>) => {
            if (e.data.type === "ctrlBuffer") {
                ctrlBuff = e.data.buffer;
                resolve();
            }
        };
        const buf = dataInfo.bufferSize ?? 32768;
        seekerWorker.postMessage({
            type: "init",
            url: dataInfo.url,
            buffsize: buf,
            port: seekerChannel.port2,
            sharedBuffer: newModule.wasmMemory
        }, [seekerChannel.port2]);
        await promise;
    }

    return newModule;
}

// @ts-ignore
self.fetch_data = (ptr: number, size: number) => {
    if (ptr <= 0) return 0;
    //console.log(outModule.HEAPU8.buffer.byteLength);


    Atomics.wait(ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);

    Atomics.store(ctrlBuff, CtrlPkg.REQ_OFFSET, readOffset);
    Atomics.store(ctrlBuff, CtrlPkg.REQ_SIZE, BigInt(size));
    Atomics.store(ctrlBuff, CtrlPkg.REQ_PTR, BigInt(ptr));

    Atomics.store(ctrlBuff, CtrlPkg.RET_STATE, STATE_NOT_INIT);
    //console.log("read", ptr);
    seekerChannel.port1?.postMessage("request");
    Atomics.wait(ctrlBuff, CtrlPkg.RET_STATE, STATE_NOT_INIT);
    //console.log("done read", ptr);

    const state = Atomics.load(ctrlBuff, CtrlPkg.RET_STATE);
    if (state === STATE_EOF) {
        console.error("EOF :/");
        endOfFile = true;
        return -2;
    } else if (state !== STATE_GOOD) {
        console.error("Smth not ok?????????????????????????????????????");
        return 0;
    }

    const byteLenght = Number(Atomics.load(ctrlBuff, CtrlPkg.RET_SIZE));
    if (byteLenght <= 0) {
        if (byteLenght == -2)
            endOfFile = true;
        return byteLenght;
    }
    //(outModule.HEAPU8 as Uint8Array).set(data!.subarray(0, byteLenght), ptr);

    readOffset += BigInt(byteLenght);
    //console.log(Number(readOffset) / Number(controlPkg[0]));
    return byteLenght;
};

// @ts-ignore
self.submit_exif_tag = (title: string, name: string, desc: string, value: string) => {
    exifData.tags.push({
        title, name, desc, value
    });
}

self.onmessage = async (e: MessageEvent<WorkerRequestExif | WorkerShutdown>) => {
    switch (e.data.kind) {
        case "exifRequest": {
            outModule = await LoadWasmModule(e.data);
            let ret = outModule._get_exif(e.data.bufferSize);
            console.log("Libexif returned", ret);
            self.postMessage(exifData);
            return;
        }
        case "shutdown": {
            //seekerWorker?.postMessage({ type: "destroy" } as SeekableWorkerDestroy);
            seekerWorker?.terminate();
            self.postMessage({ kind: "shutdown" } as WorkerShutdown);
            return;
        }
    }
};
