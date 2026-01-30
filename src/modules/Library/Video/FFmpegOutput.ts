/// <reference lib="webworker" />

import { type AllTargetWorkerMessages, type AudioMediaStream, type Demuxer, type Dictionary, type FFmpegStreams, PromiseRes, SeekableWorkerUrl, type VideoMediaStream, WaitATick, type WebAudioDecoderMessage, type WebDecoderErrorMessage, type WebDecoderGeneralMessage, type WebVideoDecoderMessage, type WorkerAssSubtitle, type WorkerAudioData, type WorkerAudioDataInit, type WorkerBitmapSubtitle, type WorkerChapterInfo, type WorkerEmbedFont, type WorkerInitFFmpeg, type WorkerInitFFmpegOnlyModule, type WorkerMediaInfo, type WorkerPostPort, type WorkerRequestAnswered, type WorkerRequestBufferData, type WorkerRequestDemuxers, type WorkerRequestExif, type WorkerRequestSeek, type WorkerSeekResult, type WorkerShutdown, type WorkerSubmitDemuxers, type WorkerSubmitStreams, type WorkerSubmitThumbnail, type WorkerThumbnailDone, type WorkerThumbnailInProgress, type WorkerVideoFrame, type WorkerVideoFrameBufferInit } from "../SomeTypes.js";
import { AVColorPrimaries, AVColorPrimarieToColorPrimative, AVColorRange, AVColorRangeToColorRange, AVColorSpace, AVColorSpaceToColorMatrixCoeff, AVColorTransferCharacteristic, AVColorTransferToTransferChar, AVLogLevel, AVPictureType, AVPixelFormatToVideoFormat, supported_pxl_formats } from "./AVTypes.js";
import ffwasmplayer, { type MainModule } from "./ffmpeg.js";

//@ts-ignore
import ffwasmImport from "./ffmpeg.wasm";
import { drawTextInTheMiddleOfACanvas, ImageToDataURL, VideoFrameToDataURL } from "./QuickDrawCanvas.js";
import { CtrlPkg, type SeekableWorkerCtrlBuf, type SeekableWorkerDestroy, type SeekableWorkerRequest, type SeekableWorkerSeek, SharedSeekableStream2, STATE_EOF, STATE_GOOD, STATE_NOT_INIT } from "./SharedSeekableStream2.js";

type FrameFromFfmpeg = {
    width: number;
    height: number;
    crop_top: number;
    crop_bottom: number;
    crop_left: number;
    crop_right: number;
    format: number;
    key_frame: number;
    pict_type: AVPictureType;
    pts: bigint; // int64_t
    ts_js: number;
    time_base_num: number;
    time_base_den: number;
    duration: bigint; // int64_t
    duration_js: number;
    src_data: number,
    src_linesize: number,
    colorRange: AVColorRange;
    colorSpace: AVColorSpace;
    colorPrimative: AVColorPrimaries;
    colorTransfer: AVColorTransferCharacteristic;
    stream_index: number;
};


const ffmpegWasm = ffwasmImport;
let outModule: MainModule;
let streams: Dictionary<FFmpegStreams> = {};
let streamMetadatas: Dictionary<Dictionary<string>> = {};
let webDecodersWorkers: Dictionary<{ worker: Worker, isClosed: boolean; }> = {};
let assSubtitleMap: Dictionary<string[]> = {};
let endOfFile = false;
let seekByUser = false;
let readOffset = 0n;
let configPromises: Promise<VideoDecoderSupport | AudioDecoderSupport>[] = [];
let seekerWorker: Worker | undefined;
let ctrlBuff: BigInt64Array;
let seekerChannel = new MessageChannel();

function streamsWithoudDecoder() {
    return Object.keys(streams).map(key => {
        const newStream = {} as FFmpegStreams;
        Object.assign(newStream, streams[parseInt(key)]);
        return newStream;
    });
}

async function RequestFrame() {
    if (!outModule || endOfFile) return;

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
        ret = outModule._get_data();
        if (ret == -1) {
            console.error("FFmpeg had an error");
            break;
        } else if (ret == 1) {
            //await new Promise<void>(r => setTimeout(r, 50));
            continue; // try again
        } else if (ret == 0 || ret == 3) {
            break;
        } else if (ret == 2) {
            endOfFile = true;
            break;
        } // AVERROR_EOF
    }

    if (ret !== 3)
        self.postMessage({ kind: "requestAnswered", status: true } as WorkerRequestAnswered);
    return;
}

async function AskFFmpegToSeek(time: number) {
    seekByUser = true;
    let ret = outModule._seek_to(time);
    if (ret < 0) {
        console.error("Error seeking to", time);
    }
    while (true) {
        for (const indexStr in webDecodersWorkers) {
            const index = parseInt(indexStr);
            if (!webDecodersWorkers[index]!.isClosed) {
                await WaitATick();
                continue;
            }

        }
        break;
    }
    self.postMessage({ kind: "doneSeeking", return: ret } as WorkerSeekResult);
    seekByUser = false;
    return;
}

async function LoadWasmModule(dataInfo: WorkerInitFFmpeg | WorkerInitFFmpegOnlyModule) {
    const newModule = await ffwasmplayer({
        locateFile: (file: string) => file.endsWith(".wasm") ? ffmpegWasm : file,
        onRuntimeInitialized: () => {
            console.log("FFmpeg WebAssembly initialized.");
        },
    });

    if (dataInfo.url) {
        const { promise, resolve } = PromiseRes<void>();
        seekerWorker = new Worker(SeekableWorkerUrl, { type: 'module', name: "I buffer the file " + dataInfo.url });
        seekerWorker.onmessage = (e: MessageEvent<SeekableWorkerCtrlBuf>) => {
            if (e.data.type === "ctrlBuffer") {
                ctrlBuff = e.data.buffer;
                resolve();
            }
        };
        const buf = (dataInfo as WorkerInitFFmpeg).bufferSize ?? 32768;
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

async function InitializeFFmpeg(dataInfo: WorkerInitFFmpeg) {
    outModule = await LoadWasmModule(dataInfo);

    outModule._init_ffmpeg(dataInfo.bufferSize, AVLogLevel.AV_LOG_INFO);

    const pixFmtPtr = outModule._malloc(supported_pxl_formats.length * 4);
    const view = new Uint8Array();
    for (let i = 0; i < supported_pxl_formats.length; i++) {
        outModule.setValue(pixFmtPtr + i * 4, supported_pxl_formats[i], 'i32');
    }

    const result = outModule._open_file(4, pixFmtPtr);
    console.log("File opened with result:", result);

    Promise.all(configPromises).then(() => {
        for (const keyS of Object.keys(streams)) {
            const key = parseInt(keyS);
            streams[key]!.metadata = streamMetadatas[key]!;
        }
        const strippedStreams = streamsWithoudDecoder();
        self.postMessage({ kind: "streams", streams: strippedStreams } as WorkerSubmitStreams);
    });
}

// @ts-ignore Fetch from the media file to ffmpeg
self.fetch_video_data = (ptr: number, size: number) => {
    if (ptr <= 0) return 0;
    if (false && ptr > (outModule.HEAPU8 as Uint8Array).byteLength) {
        const pageSize = 64 * 1024; // 64 KB
        const requiredBytes = ptr + size;
        const currentBytes = outModule.HEAPU8.buffer.byteLength;

        const growth = Math.ceil((requiredBytes - currentBytes) / pageSize);
        console.log("Uhh, requested to write to a pointer outside memory. Will try to grow with", growth, "and cover it oki ❤️");
        outModule._emscripten_resize_heap(growth);
    }

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
self.submit_file_info = (stream_index: number, data: { [key: string]: string; }) => {
    if (stream_index === -1) // File Info
        self.postMessage({ kind: "mediaInfo", data } as WorkerMediaInfo);
    else {
        streamMetadatas[stream_index] = data;
    }
};

// @ts-ignore
self.submit_attachment = (metadata: Dictionary<string>, data: number, data_size: number) => {
    const buffer = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(data, data + data_size);
    const filename = metadata["filename"];
    if (filename && (filename.toLowerCase().endsWith(".ttf") || filename.toLowerCase().endsWith(".otf"))) {
        let fontFamily: string | null = null;
        try {
            fontFamily = extractFontNameFromBuffer(buffer.buffer);
        } catch (e) {
            fontFamily = null;
        }
        const postFont: WorkerEmbedFont = {
            kind: "fontFile",
            fileName: filename,
            fontFamily: fontFamily,
            data: buffer,
            transferable: [buffer.buffer]
        };

        // @ts-ignore
        self.postMessage(postFont, postFont.transferable);
    } else {
        console.warn(metadata, buffer);
    }

};

// @ts-ignore
self.submit_video_config = (config: {
    index: number, codec: string, codedHeight: number, codedWidth: number, description: number, descriptionSize: number; duration: number;
    colorRange: AVColorRange;
    colorSpace: AVColorSpace;
    colorPrimative: AVColorPrimaries;
    colorTransfer: AVColorTransferCharacteristic;
}) => {
    if (!('VideoDecoder' in self) || config.codec === '') {
        console.warn("VideoDecoder not here? Falling back on ffmpeg");
        const areThereOtherStreams = Object.values(streams).some(stream => stream.type === "video" && stream.isUsed);

        // Safari time
        streams[config.index] = <VideoMediaStream> {
            type: "video",
            index: config.index,
            isSupported: false,
            isUsed: !areThereOtherStreams,
            duration: config.duration,
        };
        return;
    }

    let desc: Uint8Array | undefined;

    if (config.descriptionSize > 0)
        desc = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(config.description, config.description + config.descriptionSize);

    const vidConfig: VideoDecoderConfig = {
        codec: config.codec,
        codedWidth: config.codedWidth,
        codedHeight: config.codedHeight,
        description: desc,
        optimizeForLatency: false,
        colorSpace: {
            fullRange: AVColorRangeToColorRange(config.colorRange),
            matrix: AVColorSpaceToColorMatrixCoeff(config.colorSpace) as VideoMatrixCoefficients,
            primaries: AVColorPrimarieToColorPrimative(config.colorPrimative) as VideoColorPrimaries,
            transfer: AVColorTransferToTransferChar(config.colorTransfer) as VideoTransferCharacteristics
        },
        //hardwareAcceleration: "prefer-software"
    };

    console.log("trying video config", vidConfig);
    const supportPromise = VideoDecoder.isConfigSupported(vidConfig);
    supportPromise.then((conf) => {
        console.log("Video support for index", config.index, "is", conf);
        if (conf.supported) {
            const decoderWorker = new Worker(new URL('WebCodecDecoder.js', import.meta.url), { name: "I decode video for stream " + config.index });
            decoderWorker.onmessage = (e: MessageEvent<WorkerVideoFrame | WebDecoderErrorMessage | WebDecoderGeneralMessage>) => {
                if (e.data.kind === "videoFrame") {
                    const postData: WorkerVideoFrame = {
                        kind: "videoFrame",
                        videoFrame: e.data.videoFrame,
                        streamIndex: config.index,
                        transferable: [e.data.videoFrame]
                    };

                    self.postMessage(postData, postData.transferable);
                } else if (e.data.kind === "error" && e.data.decoderState !== "configured") {
                    console.warn("Video Decoder has was shot in the back ally. Dropping this data and falling back to ffmpeg");
                    streams[config.index]!.isSupported = false;
                } else if (e.data.kind === "closed") {
                    webDecodersWorkers[config.index]!.isClosed = true;
                }
            };

            let messageChannel = new MessageChannel();

            const configMessage: WebVideoDecoderMessage = {
                kind: "init",
                decoderType: "video",
                config: conf.config!,
                streamIndex: config.index,
                postDataTo: messageChannel.port2
            };

            const messageMessage: WorkerPostPort = {
                kind: "portPost",
                port: messageChannel.port1
            };

            webDecodersWorkers[config.index] = { worker: decoderWorker, isClosed: false };

            self.postMessage(messageMessage, [messageChannel.port1]);
            decoderWorker.postMessage(configMessage, [messageChannel.port2]);
        }
        const areThereOtherStreams = Object.values(streams).some(stream => stream.type === "video" && stream.isUsed);
        streams[config.index] = {
            type: "video",
            index: config.index,
            isSupported: conf.supported ?? false,
            isUsed: !areThereOtherStreams,
            duration: config.duration,
            metadata: {},
            mediaStream: undefined
        };
    });
    configPromises.push(supportPromise);

    //self.postMessage({ type: "videoConfig", data: vidConfig });
};

// @ts-ignore
self.submit_audio_config = (config: { index: number, codec: string, sampleRate: number, numberOfChannels: number, description: number, descriptionSize: number; duration: number; }) => {
    if (config.sampleRate === 0 || config.numberOfChannels === 0) {
        console.error("Found unsupported audio stream at", config.index, ".Dropping it!");
        return;
    }

    if (!('AudioDecoder' in self) || config.codec === '') {
        console.warn("AudioDecoder not here? Falling back on ffmpeg");
        const areThereOtherStreams = Object.values(streams).some(stream => stream.type === "audio" && stream.isUsed);
        // Safari time
        streams[config.index] = {
            type: "audio",
            index: config.index,
            isSupported: false,
            isUsed: !areThereOtherStreams,
            duration: config.duration,
            sampleRate: config.sampleRate,
            channels: config.numberOfChannels,
            metadata: {},
        };
        return;
    }

    let desc: Uint8Array | undefined;

    if (config.descriptionSize > 0)
        desc = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(config.description, config.description + config.descriptionSize);

    const audioConfig: AudioDecoderConfig = {
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.numberOfChannels,
        description: desc,
    };

    console.log("trying audio config", audioConfig);
    const supportPromise = AudioDecoder.isConfigSupported(audioConfig);
    supportPromise.then((conf) => {
        console.log("Audio support for index", config.index, "is", conf);
        if (conf.supported) {
            const decoderWorker = new Worker(new URL('WebCodecDecoder.js', import.meta.url), { name: "I decode audio for stream " + config.index });
            decoderWorker.onmessage = (e: MessageEvent<WorkerAudioData | WebDecoderErrorMessage | WebDecoderGeneralMessage>) => {
                if (e.data.kind === "audioData") {
                    const audioData = e.data.audioData;
                    let data = new Float32Array(audioData.numberOfFrames * audioData.numberOfChannels);
                    audioData.copyTo(data, { planeIndex: 0, format: "f32" });

                    const postData: WorkerAudioDataInit = {
                        kind: "audioDataInit",
                        transferable: [data.buffer],
                        streamIndex: config.index,
                        dataBuffer: {
                            data: data.buffer,
                            format: 'f32',
                            numberOfChannels: audioData.numberOfChannels,
                            numberOfFrames: audioData.numberOfFrames,
                            sampleRate: audioData.sampleRate,
                            timestamp: audioData.timestamp
                        }
                    };
                    audioData.close();
                    self.postMessage(postData, postData.transferable);
                }
                else if (e.data.kind === "error" && e.data.decoderState !== "configured") {
                    console.warn("Audio Decoder has was shot in the back ally. Dropping this data and falling back to ffmpeg");
                    streams[config.index]!.isSupported = false;
                } else if (e.data.kind === "closed") {
                    webDecodersWorkers[config.index]!.isClosed = true;
                }
            };

            let messageChannel = new MessageChannel();

            const configMessage: WebAudioDecoderMessage = {
                kind: "init",
                decoderType: "audio",
                config: conf.config!,
                streamIndex: config.index,
                postDataTo: messageChannel.port2
            };

            const messageMessage: WorkerPostPort = {
                kind: "portPost",
                port: messageChannel.port1
            };

            webDecodersWorkers[config.index] = { worker: decoderWorker, isClosed: false };

            self.postMessage(messageMessage, [messageChannel.port1]);
            decoderWorker.postMessage(configMessage, [messageChannel.port2]);
        }
        const areThereOtherStreams = Object.values(streams).some(stream => stream.type === "audio" && stream.isUsed);
        streams[config.index] = {
            type: "audio",
            index: config.index,
            isSupported: conf.supported ?? false,
            isUsed: !areThereOtherStreams,
            duration: config.duration,
            sampleRate: config.sampleRate,
            channels: config.numberOfChannels,
            metadata: {}
        };
    });

    configPromises.push(supportPromise);
};

// @ts-ignore
self.submit_subtitle_config = (data: { stream_index: number, duration: number; header_ptr: number, header_size: number; }) => {
    let assHeader: string | undefined;
    if (data.header_size > 0) {
        const buffer = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(data.header_ptr, data.header_ptr + data.header_size);
        if (buffer.length > 13 &&
            buffer.subarray(0, 13).toString() === "91,83,99,114,105,112,116,32,73,110,102,111,93") { // check if its ASS

            assHeader = new TextDecoder().decode(buffer);
        } else {
            console.warn("Unknown subtitle header for stream ", data.stream_index, "here is header", buffer);
        }
    }

    const areThereOtherStreams = Object.values(streams).some(stream => stream.type === "subtitle" && stream.isUsed);
    streams[data.stream_index] = {
        type: "subtitle",
        index: data.stream_index,
        isSupported: false, // No native decoder
        isUsed: !areThereOtherStreams,
        duration: data.duration,
        assHeader: assHeader,
        metadata: {}
    };
};

// @ts-ignore
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

// @ts-ignore
self.is_stream_supported = (stream_index: number) => {
    const stream = streams[stream_index];
    if (!stream || !stream.isUsed) return -1;
    return stream.isSupported ? 1 : 0;
};

// @ts-ignore
self.submit_raw_packet = (packetRaw: {
    index: number,
    flags: number;
    timestamp: number,
    duration: number,
    dataPtr: number,
    dataSize: number;
}): number => {
    const stream = streams[packetRaw.index];
    const decoderWorker = webDecodersWorkers[packetRaw.index];
    if (!stream || !decoderWorker) {
        self.postMessage({ kind: "requestAnswered", status: false } as WorkerRequestAnswered);
        return -1;
    }

    const packetData = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(packetRaw.dataPtr, packetRaw.dataPtr + packetRaw.dataSize);


    if (stream.type === "video") {
        const encodedChunk = {
            data: packetData,
            duration: packetRaw.duration,
            timestamp: packetRaw.timestamp,
            type: (((packetRaw.flags || 0) & 1) ? "key" : "delta") as "key" | "delta",
            transfer: [packetData.buffer]
        };

        const postMessage: WebVideoDecoderMessage = {
            kind: "decode",
            decoderType: "video",
            chunk: encodedChunk,
            streamIndex: packetRaw.index,
            postDataTo: null,
            transferable: [packetData.buffer]
        };

        decoderWorker.worker.postMessage(postMessage, [packetData.buffer]);
    } else if (stream.type === "audio") {
        const encodedChunk = {
            data: packetData,
            duration: packetRaw.duration,
            timestamp: packetRaw.timestamp,
            type: "key" as "key",
            transfer: [packetData.buffer]
        };

        const postMessage: WebAudioDecoderMessage = {
            kind: "decode",
            decoderType: "audio",
            chunk: encodedChunk,
            streamIndex: packetRaw.index,
            postDataTo: null,
            transferable: [packetData.buffer]
        };

        decoderWorker.worker.postMessage(postMessage, [packetData.buffer]);
    }
    return 0;
};

// @ts-ignore
self.submit_video_frame = (frame: FrameFromFfmpeg) => {
    if (frame.width === 0 || frame.height === 0) return;

    const wasmBuffer = (outModule.wasmMemory as WebAssembly.Memory).buffer;

    const dataArray = new Int32Array(wasmBuffer, frame.src_data, 8);
    const linesizeArray = new Int32Array(wasmBuffer, frame.src_linesize, 8);

    const layouts: { offset: number; stride: number; }[] = [];
    for (let i = 0; i < 8; i++) {
        const linesize = linesizeArray[i]!;
        const data = dataArray[i]!;

        if (linesize <= 0)
            break;

        layouts.push({ offset: data, stride: linesize });
    }

    const videoInit: VideoFrameBufferInit = {
        codedWidth: frame.width,
        codedHeight: frame.height,
        format: AVPixelFormatToVideoFormat(frame.format) as VideoPixelFormat,
        timestamp: Math.max(Number(frame.ts_js), 0),
        duration: frame.duration_js,
        colorSpace: {
            fullRange: AVColorRangeToColorRange(frame.colorRange),
            matrix: AVColorSpaceToColorMatrixCoeff(frame.colorSpace) as VideoMatrixCoefficients,
            primaries: AVColorPrimarieToColorPrimative(frame.colorPrimative) as VideoColorPrimaries,
            transfer: AVColorTransferToTransferChar(frame.colorTransfer) as VideoTransferCharacteristics
        },
        layout: layouts
    };

    const videoFrame = new VideoFrame(wasmBuffer, videoInit);

    const postData: WorkerVideoFrame = {
        kind: "videoFrame",
        videoFrame: videoFrame,
        streamIndex: frame.stream_index,
        transferable: [videoFrame]
    };

    self.postMessage(postData, postData.transferable);
};

// @ts-ignore
self.submit_audio_frame = (data: { channels: number, sampleRate: number, samples: number, data: number, bytesPerSample: number; ts_js: number; stream_index: number; }) => {
    const dataSize = data.channels * data.samples * data.bytesPerSample;
    const buffer = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(data.data, data.data + dataSize);

    const postData: WorkerAudioDataInit = {
        kind: "audioDataInit",
        transferable: [buffer.buffer],
        streamIndex: data.stream_index,
        dataBuffer: {
            data: buffer.buffer,
            format: 'f32',
            numberOfChannels: data.channels,
            numberOfFrames: data.samples,
            sampleRate: data.sampleRate,
            // Time comes in seconds
            timestamp: data.ts_js
        }
    };

    self.postMessage(postData, postData.transferable);
};

// @ts-ignore
self.submit_subtitle_bitmap = (data: { stream_index: number, data: number, data_size: number, x: number, y: number, width: number, height: number, ts_js: bigint, start_ms: bigint, end_ms: bigint; }) => {
    const buffer = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(data.data, data.data + data.data_size);

    const imageData = new ImageData(new Uint8ClampedArray(buffer), data.width, data.height);
    createImageBitmap(imageData).then((imageBitmap) => {
        ImageToDataURL(imageBitmap).then((blob) => {
            const postData: WorkerBitmapSubtitle = {
                kind: "subtitleBitmap",
                streamIndex: data.stream_index,
                image: blob,
                x: data.x,
                y: data.y,
                width: data.width,
                height: data.height,
                timestamp: Number(data.ts_js),
                start_time: Number(data.start_ms),
                end_time: Number(data.end_ms),
                transferable: [blob]
            };
            self.postMessage(postData);
        });
    });
};

// @ts-ignore
self.submit_subtitle_ass = (data: { stream_index: number, dialog: string, start_time: bigint, end_time: bigint; }) => {
    assSubtitleMap[data.stream_index] ??= [];
    let frameNum = data.dialog.substring(0, data.dialog.indexOf(','));
    if (assSubtitleMap[data.stream_index].includes(frameNum))
        return;
    assSubtitleMap[data.stream_index].push(frameNum);

    const start = new Date(Number(data.start_time) / 1000).toISOString().split('T')[1].split('Z')[0];
    const end = new Date(Number(data.end_time) / 1000).toISOString().split('T')[1].split('Z')[0];


    let dialog = data.dialog.substring(data.dialog.indexOf(',') + 1);
    let layer = dialog.substring(0, dialog.indexOf(','));
    let restOfIt = dialog.substring(dialog.indexOf(',') + 1);


    dialog = `Dialogue: ${layer},${start},${end},${restOfIt}`;
    const postData: WorkerAssSubtitle = {
        kind: "subtitleAss",
        streamIndex: data.stream_index,
        dialog: dialog
    };
    self.postMessage(postData);
};

// @ts-ignore
self.seek_video_data = (offset: bigint, whence: number): bigint => {
    Atomics.wait(ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);
    const fileSize = Atomics.load(ctrlBuff, CtrlPkg.FILE_TOTAL_SIZE);

    if (whence === 1) { // SEEK_CUR
        if (offset > 0x7fffffffffffffffn - readOffset)
            return -1n;
        offset += readOffset;
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

    endOfFile = false;

    for (const i in streams) {
        const index = parseInt(i);
        const stream = streams[index];
        const webWorker = webDecodersWorkers[index];
        if (stream.isSupported && webWorker) {
            if (seekByUser) {
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

    Atomics.store(ctrlBuff, CtrlPkg.REQ_STATE, STATE_NOT_INIT);
    //console.log("offset to", offset);
    seekerChannel.port1?.postMessage({ type: "seek", offset: Number(offset) } as SeekableWorkerSeek);
    //self.postMessage({ kind: "seek", offset: Number(offset) } as WorkerRequestSeek);
    Atomics.wait(ctrlBuff, CtrlPkg.REQ_STATE, STATE_NOT_INIT);

    const seekerState = Atomics.load(ctrlBuff, CtrlPkg.STREAM_STATE);
    if (seekerState !== STATE_GOOD) {
        console.error("Seeker returned bad when tried to seek. Horrors!!!!");
    }
    //console.log("done offset to", offset);
    readOffset = offset;

    return readOffset;
};

// @ts-ignore
self.submit_thumbnail = (data: { is_raw: number, data: number, data_size: number, width: number, height: number; format: number; }) => {
    self.postMessage({ kind: "thumbnailInProgress" } as WorkerThumbnailInProgress);
    const buffer = new Uint8Array((outModule.wasmMemory as WebAssembly.Memory).buffer).slice(data.data, data.data + data.data_size);
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

// @ts-ignore
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

self.onmessage = async (e: MessageEvent<AllTargetWorkerMessages>) => {
    switch (e.data.kind) {
        case "requestFrames":
            RequestFrame();
            return;
        case "changeStream":
            for (const indexStr in streams) {
                const index = parseInt(indexStr);
                if (streams[index].type === e.data.type)
                    streams[index].isUsed = (e.data.toIndex === index);
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
            outModule = await LoadWasmModule(e.data);
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

            readOffset = 0n;
            Atomics.store(ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);
            seekerChannel.port1?.postMessage({ type: "seek", offset: 0, urlChange: e.data.url } as SeekableWorkerSeek);
            Atomics.wait(ctrlBuff, CtrlPkg.STREAM_STATE, STATE_NOT_INIT);
            const retSeeker = Atomics.load(ctrlBuff, CtrlPkg.STREAM_STATE);
            if (retSeeker !== STATE_GOOD) {
                console.warn("Seeker did not return good :(");
                self.postMessage({ kind: "thumbnailDone", return: -1 } as WorkerThumbnailDone);
            } else {
                const ret = outModule._extract_thumbnail();
                self.postMessage({ kind: "thumbnailDone", return: ret } as WorkerThumbnailDone);
            }

            return;
        }
        case "demuxerRequest": {
            outModule._get_supported_demuxers();
            return;
        }
        case "shutdown": {
            for (const indexStr in webDecodersWorkers) {
                const webWorker = webDecodersWorkers[indexStr];
                webWorker.worker.postMessage({ kind: "close" } as WebVideoDecoderMessage | WebAudioDecoderMessage);
                webWorker.worker.terminate();
            }
            //seekerWorker?.postMessage({ type: "destroy" } as SeekableWorkerDestroy);
            seekerWorker?.terminate();
            self.postMessage({ kind: "shutdown" } as WorkerShutdown);
        }
    }
};
self.onerror = (e) => {
    console.error('Worker error:', e);
};
function extractFontNameFromBuffer(buffer: ArrayBuffer) {
    const data = new DataView(buffer);

    // Offset 4 bytes: number of tables
    const numTables = data.getUint16(4);

    // Search for 'name' table in the table directory (starts at byte 12)
    let nameTableOffset = null;
    let nameTableLength = null;
    for (let i = 0; i < numTables; i++) {
        const entryOffset = 12 + i * 16;
        const tag = String.fromCharCode(
            data.getUint8(entryOffset),
            data.getUint8(entryOffset + 1),
            data.getUint8(entryOffset + 2),
            data.getUint8(entryOffset + 3)
        );
        if (tag === 'name') {
            nameTableOffset = data.getUint32(entryOffset + 8);
            nameTableLength = data.getUint32(entryOffset + 12);
            break;
        }
    }

    if (nameTableOffset === null) throw new Error('No name table found');

    const nameCount = data.getUint16(nameTableOffset + 2);
    const stringOffset = nameTableOffset + data.getUint16(nameTableOffset + 4);

    for (let i = 0; i < nameCount; i++) {
        const recOffset = nameTableOffset + 6 + i * 12;

        const nameID = data.getUint16(recOffset + 6);
        const length = data.getUint16(recOffset + 8);
        const offset = data.getUint16(recOffset + 10);

        // We prefer platform ID 3 (Windows), encoding 1 (Unicode BMP)
        const platformID = data.getUint16(recOffset);
        const encodingID = data.getUint16(recOffset + 2);
        const languageID = data.getUint16(recOffset + 4);

        if ((nameID === 1 || nameID === 4) && platformID === 3 && encodingID === 1) {
            const strBytes = new Uint8Array(buffer, stringOffset + offset, length);
            const decoder = new TextDecoder('utf-16be');
            const name = decoder.decode(strBytes);
            return name;
        }
    }

    throw new Error('No usable font name found');
}
