import type { WebVideoDecoderMessage, WebAudioDecoderMessage } from "@/modules/SomeTypes";
import { CtrlPkg, STATE_EOF, STATE_GOOD, STATE_NOT_INIT, type SeekableWorkerSeek } from "../SharedSeekableStream2";
import { workerState } from "./State";

export function fetch_video_data(ptr: number, size: number)  {
    if (ptr <= 0) return 0;
    // if (false && ptr > (workerState.outModule.HEAPU8 as Uint8Array).byteLength) {
    //     const pageSize = 64 * 1024; // 64 KB
    //     const requiredBytes = ptr + size;
    //     const currentBytes = workerState.outModule.HEAPU8.buffer.byteLength;

    //     const growth = Math.ceil((requiredBytes - currentBytes) / pageSize);
    //     console.log("Uhh, requested to write to a pointer outside memory. Will try to grow with", growth, "and cover it oki ❤️");
    //     workerState.outModule._emscripten_resize_heap(growth);
    // }

    //console.log(outModule.HEAPU8.buffer.byteLength);


    Atomics.wait(workerState.ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);

    Atomics.store(workerState.ctrlBuff, CtrlPkg.REQ_OFFSET, workerState.readOffset);
    Atomics.store(workerState.ctrlBuff, CtrlPkg.REQ_SIZE, BigInt(size));
    Atomics.store(workerState.ctrlBuff, CtrlPkg.REQ_PTR, BigInt(ptr));

    Atomics.store(workerState.ctrlBuff, CtrlPkg.RET_STATE, STATE_NOT_INIT);
    //console.log("read", ptr);
    workerState.seekerChannel.port1?.postMessage("request");
    Atomics.wait(workerState.ctrlBuff, CtrlPkg.RET_STATE, STATE_NOT_INIT);
    //console.log("done read", ptr);

    const state = Atomics.load(workerState.ctrlBuff, CtrlPkg.RET_STATE);
    if (state === STATE_EOF) {
        console.error("EOF :/");
        workerState.endOfFile = true;
        return -2;
    } else if (state !== STATE_GOOD) {
        console.error("Smth not ok?????????????????????????????????????");
        return 0;
    }

    const byteLenght = Number(Atomics.load(workerState.ctrlBuff, CtrlPkg.RET_SIZE));
    if (byteLenght <= 0) {
        if (byteLenght == -2)
            workerState.endOfFile = true;
        return byteLenght;
    }
    //(outModule.HEAPU8 as Uint8Array).set(data!.subarray(0, byteLenght), ptr);

    workerState.readOffset += BigInt(byteLenght);
    //console.log(Number(readOffset) / Number(controlPkg[0]));
    return byteLenght;
};

export function seek_video_data(offset: bigint, whence: number): bigint {
    Atomics.wait(workerState.ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);
    const fileSize = Atomics.load(workerState.ctrlBuff, CtrlPkg.FILE_TOTAL_SIZE);

    if (whence === 1) { // SEEK_CUR
        if (offset > 0x7fffffffffffffffn - workerState.readOffset)
            return -1n;
        offset += workerState.readOffset;
    } else if (whence === 2) { // SEEK_END
        if (offset > 0x7fffffffffffffffn - fileSize)
            return -1n;
        offset += fileSize;
    } else if (whence === 0x10000)
        return fileSize;


    if (offset > fileSize || offset < 0) {
        console.error("Invalid seek offset", offset);
        return -1n;
    }

    workerState.endOfFile = false;

    for (const i in workerState.streams) {
        const index = parseInt(i);
        const stream = workerState.streams[index];
        const webWorker = workerState.webDecodersWorkers[index];
        if (stream.isSupported && webWorker) {
            if (workerState.seekByUser) {
                webWorker.worker.postMessage({ kind: "close", decoderType: stream.type } as WebVideoDecoderMessage | WebAudioDecoderMessage);
            } else {
                webWorker.worker.postMessage({ kind: "flush", decoderType: stream.type } as WebVideoDecoderMessage | WebAudioDecoderMessage);
            }

            webWorker.worker.postMessage({
                kind: "init",
                decoderType: stream.type,
                config: undefined
            } as WebVideoDecoderMessage | WebAudioDecoderMessage);
        }
    }

    Atomics.store(workerState.ctrlBuff, CtrlPkg.REQ_STATE, STATE_NOT_INIT);
    //console.log("offset to", offset);
    workerState.seekerChannel.port1?.postMessage({ type: "seek", offset: Number(offset) } as SeekableWorkerSeek);
    //self.postMessage({ kind: "seek", offset: Number(offset) } as WorkerRequestSeek);
    Atomics.wait(workerState.ctrlBuff, CtrlPkg.REQ_STATE, STATE_NOT_INIT);

    const seekerState = Atomics.load(workerState.ctrlBuff, CtrlPkg.STREAM_STATE);
    if (seekerState !== STATE_GOOD) {
        console.error("Seeker returned bad when tried to seek. Horrors!!!!");
    }
    //console.log("done offset to", offset);
    workerState.readOffset = offset;

    return workerState.readOffset;
};
