import { workerState } from "./State";

import { type AllTargetWorkerMessages, type WorkerSubmitStreams, type WorkerRequestAnswered, type WorkerSubmitThumbnail, type WorkerThumbnailInProgress, type WorkerThumbnailDone, type WebVideoDecoderMessage, type WebAudioDecoderMessage, type WorkerShutdown, PromiseRes, SeekableWorkerUrl, WaitATick, type WorkerInitFFmpeg, type WorkerInitFFmpegOnlyModule, type WorkerSeekResult, type WorkerMediaInfo, type WorkerChapterInfo, type Demuxer, type WorkerSubmitDemuxers, type FFmpegStreams, type WorkerEndOfFile } from "@/modules/SomeTypes";
import { AVLogLevel, AVPixelFormatToVideoFormat, supported_pxl_formats } from "./AVTypes";
import { ImageToDataURL, VideoFrameToDataURL } from "../QuickDrawCanvas";
import { CtrlPkg, STATE_NOT_INIT, type SeekableWorkerSeek, STATE_GOOD, type SeekableWorkerCtrlBuf } from "../SharedSeekableStream2";
import type { FFmpegWorker } from "@FFmpeg/FFmpegTypes";

import { fetch_video_data, seek_video_data } from "./IO";
import { submit_subtitle_config, submit_subtitle_bitmap, submit_subtitle_ass, submit_attachment } from "./Subtitles";
import { submit_video_config, submit_video_frame } from "./Video";
import { submit_audio_config, submit_audio_frame } from "./Audio";

import { submit_raw_packet } from "./WebDecoder";
import type { MainModule } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";

// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877
declare var self: FFmpegWorker;

async function RequestFrame() {
    if (!workerState.outModule || workerState.endOfFile) return;

    // let smallestQueue = 0;
    // Object.keys(streams).map(key => {
    //     const stream = streams[parseInt(key)];
    //     if (!stream.isUsed) return;
    //     smallestQueue = Math.max(smallestQueue, stream.decoder?.decodeQueueSize ?? 0);
    // });

    // if (smallestQueue >= 30) return;

    // < 0 == Error
    // 0 == All good
    // 1 == AVERROR(EAGAIN)
    // 2 == EOF
    // 3 == Raw packet. Deffer "requestAnswered" to decoder

    let ret;

    while (true) {
        ret = workerState.outModule._get_data();
        if (ret == -1) {
            console.error("FFmpeg had an error");
            break;
        } else if (ret == 1) {
            //await new Promise<void>(r => setTimeout(r, 50));
            continue; // try again
        } else if (ret == 0 || ret == 3) {
            break;
        } else if (ret == 2 || ret == -541478725) {
            workerState.endOfFile = true;
            self.postMessage({ kind: "endOfFile" } as WorkerEndOfFile);
            break;
        } // AVERROR_EOF
    }

    if (ret !== 3)
        self.postMessage({ kind: "requestAnswered", status: true } as WorkerRequestAnswered);
    return;
}

async function AskFFmpegToSeek(time: number) {
    workerState.seekByUser = true;
    let ret = workerState.outModule._seek_to(time);
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

async function LoadWasmModule(dataInfo: WorkerInitFFmpeg | WorkerInitFFmpegOnlyModule) {
    const wasm64 = await supportsWasm64();
    const wasmName = wasm64 ? "ffmpeg-wasm64" : "ffmpeg-wasm32";
    const { default: FFmpegModule } = wasm64 ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg.mjs")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg.mjs"));

    const newModule = await FFmpegModule({
        locateFile: (file: string, scriptDirectory: string) => {
            console.log(file, scriptDirectory);
            return `${location.origin}/ffmpeg/dist/lib/${wasmName}/${file}`
        },
        mainScriptUrlOrBlob: `${location.origin}/ffmpeg/dist/lib/${wasmName}/ffmpeg.js`,
        onRuntimeInitialized: () => {
            console.log("FFmpeg WebAssembly initialized.");
        },
    }) as MainModule;

    if (dataInfo.url) {
        const { promise, resolve } = PromiseRes<void>();
        workerState.seekerWorker = new Worker(SeekableWorkerUrl, { type: 'module', name: "I buffer the file " + dataInfo.url });
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

async function InitializeFFmpeg(dataInfo: WorkerInitFFmpeg) {
    workerState.outModule = await LoadWasmModule(dataInfo);

    workerState.outModule._init_ffmpeg(dataInfo.bufferSize, AVLogLevel.AV_LOG_INFO);

    const pixFmtPtr = workerState.outModule._malloc(supported_pxl_formats.length * 4);
    const view = new Uint8Array();
    for (let i = 0; i < supported_pxl_formats.length; i++) {
        // @ts-ignore
        workerState.outModule.setValue(pixFmtPtr + i * 4, supported_pxl_formats[i], 'i32');
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

self.onmessage = async (e: MessageEvent<AllTargetWorkerMessages>) => {
    switch (e.data.kind) {
        case "requestFrames":
            RequestFrame();
            return;
        case "changeStream":
            for (const indexStr in workerState.streams) {
                const index = parseInt(indexStr);
                if (workerState.streams[index].type === e.data.type)
                    workerState.streams[index].isUsed = (e.data.toIndex === index);
            }

            self.postMessage({ kind: "streams", streams: streamsWithoudDecoder(), firstTimeSending: false } as WorkerSubmitStreams);
            return;
        case "seekFfmpeg":
            await AskFFmpegToSeek(e.data.seconds);
            return;
        case "initFfmpeg":
            await InitializeFFmpeg(e.data);
            return;
        case "initFfmpegModuleOnly":
            workerState.outModule = await LoadWasmModule(e.data);
            self.postMessage({ kind: "requestAnswered" } as WorkerRequestAnswered);
            return;
        case "thumbnailRequest": {
            try {
                const bitmap = await createImageBitmap(await (await fetch(e.data.url)).blob());
                const blob = await ImageToDataURL(bitmap);

                const postData: WorkerSubmitThumbnail = {
                    kind: "thumbnailData",
                    image: blob,
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
self.onerror = (e) => {
    console.error('Worker error:', e);
};

// IO
self.fetch_video_data = fetch_video_data;
self.seek_video_data = seek_video_data;

// Video
self.submit_video_config = submit_video_config;
self.submit_video_frame = submit_video_frame;

// Audio
self.submit_audio_config = submit_audio_config;
self.submit_audio_frame = submit_audio_frame;

// Subtitles
self.submit_subtitle_config = submit_subtitle_config;
self.submit_subtitle_bitmap = submit_subtitle_bitmap;
self.submit_subtitle_ass = submit_subtitle_ass;
self.submit_attachment = submit_attachment;

// WebDecoder
self.submit_raw_packet = submit_raw_packet;


// Misc
self.submit_file_info = (stream_index: number, data: { [key: string]: string; }) => {
    if (stream_index === -1) // File Info
        self.postMessage({ kind: "mediaInfo", data } as WorkerMediaInfo);
    else {
        workerState.streamMetadatas[stream_index] = data;
    }
};
self.submit_chapter_info = (chapter_index: bigint, start_js: bigint, end_js: bigint, data: { [key: string]: string; }) => {
    console.log("Chapter", chapter_index, "starting at", start_js, "and ending at", end_js, "with info", data);
    self.postMessage({
        kind: "chapterInfo",
        data: {
            index: Number(chapter_index),
            start: Number(start_js) / 1000000,
            end: Number(end_js) / 1000000,
            data
        }
    } as WorkerChapterInfo);
};

self.is_stream_supported = (stream_index: number) => {
    const stream = workerState.streams[stream_index];
    if (!stream || !stream.isUsed) return -1;
    return stream.isSupported ? 1 : 0;
};

self.submit_thumbnail = (data: { is_raw: number, data: number, data_size: number, width: number, height: number; format: number; }) => {
    self.postMessage({ kind: "thumbnailInProgress" } as WorkerThumbnailInProgress);
    const buffer = workerState.Read(data.data, data.data + data.data_size);
    //console.log(data);

    if (data.is_raw == 1) {
        const frame = new VideoFrame(buffer, {
            codedWidth: data.width,
            codedHeight: data.height,
            format: AVPixelFormatToVideoFormat(data.format) as VideoPixelFormat,
            timestamp: 0,
        });

        VideoFrameToDataURL(frame).then((blob) => {
            frame.close();
            const postData: WorkerSubmitThumbnail = {
                kind: "thumbnailData",
                image: blob,
                width: data.width,
                height: data.height,
                transferable: [blob]
            };
            self.postMessage(postData);
        });
    } else {
        createImageBitmap(new Blob([buffer])).then((imageBitmap) => {
            ImageToDataURL(imageBitmap).then((blob) => {
                const postData: WorkerSubmitThumbnail = {
                    kind: "thumbnailData",
                    image: blob,
                    width: imageBitmap.width,
                    height: imageBitmap.height,
                    transferable: [blob]
                };
                self.postMessage(postData);
            });
        });
    }
};

self.submit_demuxers = (data: {
    extension: string,
    long_name: string,
    mime_type: string,
    name: string;
}[]) => {
    let demuxers: Demuxer[] = data.map((demux) => {
        return {
            extensions: demux.extension.length <= 0 ? [] : demux.extension.split(","),
            mime_types: demux.mime_type.length <= 0 ? [] : demux.mime_type.split(","),
            long_name: demux.long_name,
            name: demux.long_name
        };
    });

    self.postMessage({ kind: "demuxerResponse", demuxers } as WorkerSubmitDemuxers);
};

function streamsWithoudDecoder() {
    return Object.keys(workerState.streams).map(key => {
        const newStream = {} as FFmpegStreams;
        Object.assign(newStream, workerState.streams[parseInt(key)]);
        return newStream;
    });
}

async function supportsWasm64() {
  const wasm64Module = new Uint8Array([
    0x00,0x61,0x73,0x6d, // magic
    0x01,0x00,0x00,0x00, // version

    // memory section
    0x05, // section id
    0x04, // section length
    0x01, // one memory
    0x04, // memory64 + max present
    0x01, // min = 1
    0x01  // max = 1
  ]);

  // WebAssembly.validate checks if the module is valid
  try {
    await WebAssembly.compile(wasm64Module);
    return true;
  } catch {
    return false;
  }
}

