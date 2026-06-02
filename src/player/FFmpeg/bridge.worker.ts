import { workerState } from "./State";

import { CtrlPkg, STATE_NOT_INIT, type SeekableWorkerSeek, STATE_GOOD, type SeekableWorkerCtrlBuf } from "../SharedSeekableStream2";
import type { FFmpegWorker } from "@FFmpeg/FFmpegTypes";

import type { MainModule } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";

import ffmpeg32 from "@FFmpeg/ffmpeg-wasm32/ffmpeg-wasm32.wasm";
import ffmpeg64 from "@FFmpeg/ffmpeg-wasm64/ffmpeg-wasm64.wasm";
import { SeekableWorkerUrl } from "@/modules_old/SomeTypes";

import { WaitATick } from "../older stuff/VideoUtils";
import type { WorkerSubmitThumbnail } from "@/exif/types";

import type { AllTargetWorkerMessages, WorkerSubmitStreams } from "./types";
import type { AllStreamTrackTypes } from "../Tracks/types";

// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877
// eslint-disable-next-line no-var
declare var self: FFmpegWorker;

/** Slow communication between main thread and the FFmpeg TS bridge
 *  Used for stuff that is rarely called and is not latency dependant
 */
self.onmessage = async (e: MessageEvent<AllTargetWorkerMessages>) => {
    switch (e.data.kind) {
        // case "requestFrames":
        //     requestFrame();
        //     return;
        case "changeStream":
            for (const indexStr in workerState.streams) {
                const index = parseInt(indexStr);
                if (workerState.streams[index].type === e.data.type)
                    workerState.streams[index].isUsed = (e.data.toIndex === index);
            }

            self.postMessage({ kind: "streams", streams: streamsWithoudDecoder(), firstTimeSending: false } as WorkerSubmitStreams);
            return;
        // case "seekFfmpeg":
        //     await askFFmpegToSeek(e.data.seconds);
        //     return;
        case "initFfmpeg":
            await initializeFFmpeg(e.data);
            return;
        case "initFfmpegModuleOnly":
            workerState.outModule = await loadWasmModule(e.data);
            self.postMessage({ kind: "requestAnswered" } as WorkerRequestAnswered);
            return;
        case "thumbnailRequest": {
            try {
                const bitmap = await createImageBitmap(await (await fetch(e.data.url)).blob());
                const blob = await ImageToDataURL(bitmap);

                const postData: WorkerSubmitThumbnail = {
                    kind: "thumbnailData",
                    image: blob,omething is happening here. See you soon!
                    width: bitmap.width,
                    height: bitmap.height,
                    transferable: [blob]
                };
                self.postMessage({ kind: "thumbnailInProgress" } as WorkerThumbnailInProgress);
                self.postMessage(postData);
                self.postMessage({ kind: "thumbnailDone", return: 0 } as WorkerThumbnailDone);
                bitmap.close();
                return;
            } catch (g) {
                console.warn("File may not be supported by the browser:", g, " Lets try ffmpeg:", e.data.url);
            }

            workerState.readOffset = 0n;
            Atomics.store(workerState.ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);
            workerState.seekerChannel.port1?.postMessage({ type: "seek", offset: 0, urlChange: e.data.url } as SeekableWorkerSeek);
            Atomics.wait(workerState.ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);
            const retSeeker = Atomics.load(workerState.ctrlBuff, CtrlPkg.STREAM_STATE);
            if (retSeeker !== STATE_GOOD) {
                console.warn("Seeker did not return good :(");
                self.postMessage({ kind: "thumbnailDone", return: -1 } as WorkerThumbnailDone);
            } else {
                try {
                   const ret = workerState.outModule._extract_thumbnail();
                    self.postMessage({ kind: "thumbnailDone", return: ret } as WorkerThumbnailDone);
                } catch {
                    self.postMessage({ kind: "thumbnailDone", return: -1 } as WorkerThumbnailDone);
                }

            }

            return;
        }
        case "demuxerRequest": {
            workerState.outModule._get_supported_demuxers();
            return;
        }
        case "shutdown": {
            for (const indexStr in workerState.webDecodersWorkers) {
                const webWorker = workerState.webDecodersWorkers[indexStr];
                webWorker.worker.postMessage({ kind: "close" } as WebVideoDecoderMessage | WebAudioDecoderMessage);
                webWorker.worker.terminate();
            }
            //seekerWorker?.postMessage({ type: "destroy" } as SeekableWorkerDestroy);
            workerState.seekerWorker?.terminate();
            self.postMessage({ kind: "shutdown" } as WorkerShutdown);
        }
    }
};




























async function requestFrame() {
    if (!workerState.outModule || workerState.endOfFile) return;

    let ret: ActionResult;

    while (true) {
        ret = workerState.outModule._get_data();
        if (ret === ActionResult.NEED_MORE) {
            continue;
        }
        if (ret === ActionResult.OK || ret === ActionResult.RAW_PACKET) {
            break;
        }
        if (ret === ActionResult.EOF) {
            workerState.endOfFile = true;
            self.postMessage({ kind: "endOfFile" } as WorkerEndOfFile);
            break;
        }
        if (ret === ActionResult.ERR_SKIP) {
            break;
        }
        console.error("FFmpeg had an error, code:", ret);
        break;
    }

    if (ret !== ActionResult.RAW_PACKET)
        self.postMessage({ kind: "requestAnswered", status: true } as WorkerRequestAnswered);
    return;
}

async function askFFmpegToSeek(time: number) {
    workerState.seekByUser = true;
    const ret = workerState.outModule._seek_to(time);
    if (ret < 0) {
        console.error("Error seeking to", time);
    }
    while (true) {
        for (const indexStr in workerState.webDecodersWorkers) {
            const index = parseInt(indexStr);
            if (!workerState.webDecodersWorkers[index]!.isClosed) {
                await WaitATick();
                continue;
            }

        }
        break;
    }
    workerState.endOfFile = false;
    self.postMessage({ kind: "doneSeeking", return: ret } as WorkerSeekResult);
    workerState.seekByUser = false;
    return;
}

async function loadWasmModule(dataInfo: WorkerInitFFmpeg | WorkerInitFFmpegOnlyModule) {
    const wasm64 = true; //await supportsWasm64();
    const wasmName = wasm64 ? "ffmpeg-wasm64" : "ffmpeg-wasm32";
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { default: FFmpegModule } = wasm64 ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg.mjs")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg.mjs"));

    const newModule = await FFmpegModule({
        locateFile: (_file: string, _scriptDirectory: string) => `${location.origin}/${wasm64 ? ffmpeg64 : ffmpeg32}`,
        mainScriptUrlOrBlob: `${location.origin}/ffmpeg/dist/lib/${wasmName}/ffmpeg.js`,
        onRuntimeInitialized: () => {
            console.log("FFmpeg WebAssembly initialized.");
        },
    }) as MainModule;

    if (dataInfo.url) {
        const { promise, resolve } = Promise.withResolvers<void>();
        workerState.seekerWorker = new Worker(SeekableWorkerUrl, { type: 'module', name: `I buffer the file ${dataInfo.url}` });
        workerState.seekerWorker.onmessage = (e: MessageEvent<SeekableWorkerCtrlBuf>) => {
            if (e.data.type === "ctrlBuffer") {
                workerState.ctrlBuff = e.data.buffer;
                resolve();
            }
        };
        const buf = (dataInfo as WorkerInitFFmpeg).bufferSize ?? 32768;
        workerState.seekerWorker.postMessage({
            type: "init",
            url: dataInfo.url,
            buffsize: buf,
            port: workerState.seekerChannel.port2,
            sharedBuffer: newModule.wasmMemory
        }, [workerState.seekerChannel.port2]);
        await promise;
    }

    return newModule;
}

async function initializeFFmpeg(dataInfo: WorkerInitFFmpeg) {
    workerState.outModule = await loadWasmModule(dataInfo);

    workerState.outModule._init_ffmpeg(dataInfo.bufferSize, AVLogLevel.AV_LOG_INFO);

    const pixFmts = getSupportedPixelFormats();
    const pixFmtPtr = workerState.outModule._malloc(pixFmts.length * 4);
    for (let i = 0; i < pixFmts.length; i++) {
        workerState.outModule.setValue(pixFmtPtr + i * 4, pixFmts[i], 'i32');
    }

    const result = workerState.outModule._open_file(4, pixFmtPtr);
    console.log("File opened with result:", result);

    Promise.all(workerState.configPromises).then(() => {
        for (const keyS of Object.keys(workerState.streams)) {
            const key = parseInt(keyS);
            workerState.streams[key]!.metadata = workerState.streamMetadatas[key]!;
        }
        const strippedStreams = streamsWithoudDecoder();
        self.postMessage({ kind: "streams", streams: strippedStreams } as WorkerSubmitStreams);
    });
}


self.onerror = (e) => {
    console.error('Worker error:', e);
};

// Single C→JS dispatch bridge
self._ffmpeg_notify = ffmpegNotify;

function streamsWithoudDecoder() {
    return Object.keys(workerState.streams).map(key => {
        const newStream = {} as AllStreamTrackTypes;
        Object.assign(newStream, workerState.streams[parseInt(key)]);
        return newStream;
    });
}

