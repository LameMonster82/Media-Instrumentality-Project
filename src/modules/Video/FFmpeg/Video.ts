import { type VideoMediaStream, WebDecoderWorkerUrl, type WorkerVideoFrame, type WebDecoderErrorMessage, type WebDecoderGeneralMessage, type WebVideoDecoderMessage, type WorkerPostPort } from "@/modules/SomeTypes";
import { AVColorRange, AVColorSpace, AVColorPrimaries, AVColorTransferCharacteristic, AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorPrimarieToColorPrimative, AVColorTransferToTransferChar, AVPictureType, AVPixelFormatToVideoFormat } from "../AVTypes";
import { workerState } from "./State";
import type { FFmpegVideoConfig, FFmpegWorker } from "./ffmpeg";

declare var self: FFmpegWorker;

export function submit_video_config(config: FFmpegVideoConfig) {
    if (!('VideoDecoder' in self) || config.codec === '') {
        console.warn("VideoDecoder not here? Falling back on ffmpeg");

        // Safari time
        workerState.streams[config.index] = <VideoMediaStream> {
            type: "video",
            index: config.index,
            isSupported: false,
            isUsed: !workerState.AreThereOtherStreams("video"),
            duration: config.duration,
        };
        return;
    }

    let desc: Uint8Array | undefined;

    if (config.descriptionSize > 0)
        desc = workerState.Read(config.description, config.description + config.descriptionSize);

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

    workerState.configPromises.push(CheckVideoConfig(vidConfig, config));
    //self.postMessage({ type: "videoConfig", data: vidConfig });
};

async function CheckVideoConfig(configWeb: VideoDecoderConfig, config: FFmpegVideoConfig) {
    console.log("Checking video config", configWeb);
    const conf = await VideoDecoder.isConfigSupported(configWeb);

    console.log("Video support for index", config.index, "is", conf);
    if (conf.supported) {
        const decoderWorker = new Worker(WebDecoderWorkerUrl, { name: "I decode video for stream " + config.index });
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
                workerState.streams[config.index]!.isSupported = false;
            } else if (e.data.kind === "closed") {
                workerState.webDecodersWorkers[config.index]!.isClosed = true;
            } else {
                console.error("Unexpected message from the VideoDecoder :/", e.data);
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
            streamIndex: config.index,
            port: messageChannel.port1
        };

        workerState.webDecodersWorkers[config.index] = { worker: decoderWorker, isClosed: false };

        self.postMessage(messageMessage, [messageChannel.port1]);
        decoderWorker.postMessage(configMessage, [messageChannel.port2]);
    }

    workerState.streams[config.index] = {
        type: "video",
        index: config.index,
        isSupported: conf.supported ?? false,
        isUsed: !workerState.AreThereOtherStreams("video"),
        duration: config.duration,
        metadata: {},
        mediaStream: undefined
    };
}

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

export function submit_video_frame(frame: FrameFromFfmpeg) {
    if (frame.width === 0 || frame.height === 0) return;

    const wasmBuffer = (workerState.outModule.wasmMemory as WebAssembly.Memory).buffer;

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
