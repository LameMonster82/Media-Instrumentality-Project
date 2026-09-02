import urlSeekerWorker from "../seeker/urlSeeker.worker?worker";
import fileSeekerWorker from "../seeker/fileSeeker.worker?worker";
import webDecoderWorker from "./webDecoder/webDecoder.worker?worker";
import type { FFmpegWorker } from "@FFmpeg/FFmpegTypes";

import type { MainModule as MainModule32 } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";
import type { MainModule as MainModule64 } from "@FFmpeg/ffmpeg-wasm64/ffmpeg";

import { RequestDataStatus, StreamSupport, type AllTargetWorkerMessages, type DecoderConfig, type DecoderSupport, type ValidDecoderTypes, type WorkerFFmpegInitComplete, type WorkerInitFFmpeg } from "./types";
import { AVColorPrimarieToColorPrimative, AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorTransferToTransferChar, AVLogLevel, AVPixelFormat } from "./advancedTypes/AVTypes";
import getSupportedPixelFormats from "./advancedTypes/supportedPixelFormats";
import canWasm64 from "./advancedTypes/isWasm64";
import AtomicEventer from "../atomicEventer/atomicEventer";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type FileSeekableWorkerInit, type UrlSeekableWorkerInit } from "../seeker/types";
import type { DecodeTemplate, SerializableStuff } from "../atomicEventer/types";
import type { Dictionary } from "@/core/types";
import { decoderRequestTemplates, decoderResponseTemplates, WebDecoderRequestType, WebDecoderResponseType, type WebDecoderWorkerInit } from "./webDecoder/types";
import { FFmpegRequestEvent, ffmpegRequestTemplate, FFmpegResponseEvent, ffmpegResponseTemplate } from "./advancedTypes/atomicTypes";
import { MediaType, readFileInfo, readReturnType, ResultStatus, type VideoDecoderConfigStruct, type AudioDecoderConfigStruct, AVSubtitleType, AVMediaType, AVPixelFormatArrayToData } from "./structReader";
import type { BitmapSubArgs, VTTCueArgs } from "../Tracks/subtitles/types";

// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877
// eslint-disable-next-line no-var
declare var self: FFmpegWorker;

type MainModule = MainModule32 | MainModule64;
type Stream = {
    streamIndex: number,
    type: AVMediaType,
    isSupported: boolean,
    isUsed: boolean,
    worker: Worker | undefined,
    messageChannel: MessageChannel,
    secondMessageChannel: MessageChannel,
    eventer: AtomicEventer<WebDecoderRequestType, WebDecoderResponseType, typeof decoderRequestTemplates, typeof decoderResponseTemplates> | undefined;
};

class FFmpegBridge {
    private module: MainModule | undefined;
    private is64Bit = canWasm64();
    private isFirefox: boolean = navigator.userAgent.match(/firefox|fxios/i) !== null;

    // Seeker
    private seekerWorker: Worker = null!;
    private fileSize: bigint = -1n;
    private bufferSize: number = 16384;
    private fileOffset: bigint = 0n;

    // File
    private fileUrl: string | File = "";

    // Streams
    private streams: Record<number, Stream> = {};

    // Memory
    private wasmMemory: WebAssembly.Memory;

    // Events
    private seekerEventer: AtomicEventer<
        SeekerRequestType,
        SeekerResponseType,
        typeof seekerRequestTemplates,
        typeof seekerResponseTemplates> = new AtomicEventer(undefined, seekerRequestTemplates, seekerResponseTemplates);

    private videoEventer: AtomicEventer<
        FFmpegResponseEvent,
        FFmpegRequestEvent,
        typeof ffmpegResponseTemplate,
        typeof ffmpegRequestTemplate> | undefined;

    constructor() {
        // 33554432 / 65536
        const initial = this.is64Bit ? 512n : 512;
        const maximum = this.is64Bit ? 262144n : 32768;
        const adress = this.is64Bit ? 'i64' : 'i32';
        
        this.wasmMemory = new WebAssembly.Memory({
            // @ts-ignore BigInt is ok dw
            initial: initial,
            // @ts-ignore BigInt is ok dw
            maximum: maximum,
            address: adress,
            shared: true,
        });
    }

    async initialize(dataInfo: WorkerInitFFmpeg) {
        this.module = await this.loadWasmModule();

        // Parent Thread control
        this.videoEventer = new AtomicEventer(dataInfo.eventerBuffers, ffmpegResponseTemplate, ffmpegRequestTemplate);
        this.videoEventer.receiveEvent(this.handleVideoEvents.bind(this));

        // Seeker
        this.fileUrl = dataInfo.fileSource;
        this.bufferSize = dataInfo.bufferSize;

        if (typeof dataInfo.fileSource === "string") {
            this.seekerWorker = urlSeekerWorker({ name: "I download and give data to the ffmpeg thread" });
            this.seekerEventer.receiveEvent(this.handleSeekerEvents.bind(this));

            this.seekerWorker.postMessage({
                url: this.fileUrl,
                atomicBuffers: this.seekerEventer.getBuffers(),
                fetchBufferSize: this.bufferSize,
                targetBuffer: this.wasmMemory,
                type: "init"
            } as UrlSeekableWorkerInit);
        } else if (dataInfo.fileSource instanceof File) {
            this.seekerWorker = fileSeekerWorker({ name: "I read the local file and give data to the ffmpeg thread" });
            this.seekerEventer.receiveEvent(this.handleSeekerEvents.bind(this));

            this.seekerWorker.postMessage({
                file: dataInfo.fileSource,
                atomicBuffers: this.seekerEventer.getBuffers(),
                targetBuffer: this.wasmMemory,
                type: "init"
            } as FileSeekableWorkerInit);
        }

        const seekResults = await this.seekerEventer.waitUntilEvent(SeekerResponseType.SEEK_DONE);
        if (seekResults === null || seekResults.data.result < 0) {
            throw Error("Seeker could not init. Ughhhh");
        }
        this.fileSize = seekResults.data.fileSize;

        // Supported Pixel formats. Limit to RGBA only for firefox
        const pixFmts = this.isFirefox ? [AVPixelFormat.AV_PIX_FMT_RGBA] : getSupportedPixelFormats();
        const pixFmtPtr = AVPixelFormatArrayToData(this.module, pixFmts, this.is64Bit);

        // Init FFmpeg
        const ret = this.module._init_ffmpeg(dataInfo.bufferSize, 0, AVLogLevel.AV_LOG_INFO, pixFmtPtr as never, 6);
        if (ret < 0) {
            throw Error("FFmpeg didnt init properly. Dying");
        }

        // Open File
        const fileInfoPtr = this.module._open_file();
        if (Number(fileInfoPtr) === 0)
            throw Error("Could not open the file. Your problem now");

        const fileInfo = readFileInfo(this.module, this.wasmMemory.buffer, Number(fileInfoPtr), this.is64Bit);
        console.log(fileInfo);

        // Stream Setup
        const streams = fileInfo.streams.values().toArray();
        const streamPromises = streams.filter(s =>
            s.type === AVMediaType.AVMEDIA_TYPE_VIDEO
            || s.type === AVMediaType.AVMEDIA_TYPE_AUDIO
            || s.type === AVMediaType.AVMEDIA_TYPE_SUBTITLE
        ).map((stream, i) => {
            switch (stream.type) {
                case AVMediaType.AVMEDIA_TYPE_VIDEO: return this.initStream(i, stream.type, this.videoStructToConfig(stream.video_config!));
                case AVMediaType.AVMEDIA_TYPE_AUDIO: return this.initStream(i, stream.type, this.audioStructToConfig(stream.audio_config!));
                case AVMediaType.AVMEDIA_TYPE_SUBTITLE: {
                    return Promise.resolve({
                        streamIndex: i,
                        type: stream.type,
                        isSupported: false,
                        isUsed: false,
                        messageChannel: new MessageChannel(),
                        secondMessageChannel: new MessageChannel(),
                        worker: undefined,
                        eventer: undefined
                    });
                }
                default:
                    console.warn("Unsupported stream type", stream.type);
                    return Promise.resolve({
                        streamIndex: i,
                        type: stream.type,
                        isSupported: false,
                        isUsed: false,
                        messageChannel: new MessageChannel(),
                        secondMessageChannel: new MessageChannel(),
                        worker: undefined,
                        eventer: undefined
                    });
            }
        });

        const streamResolves = await Promise.all(streamPromises);

        for (const stream of streamResolves) {
            this.streams[stream.streamIndex] = stream;
        }
        this.updateFFmpegSupportedStreams();

        const port1s = new Map(streamResolves.map(s => [s.streamIndex, s.messageChannel.port1] as const));
        const port1sAgain = new Map(streamResolves.map(s => [s.streamIndex, s.secondMessageChannel.port1] as const));
        self.postMessage({
            kind: "initComplete",
            info: fileInfo,
            streamPorts: port1s,
            streamPorts2: port1sAgain
        } as WorkerFFmpegInitComplete, [...port1s.values(), ...port1sAgain.values()]);

        this.module._cleanup_info(fileInfoPtr as never);
    }

    async loadWasmModule() {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegModuleUrl } = this.is64Bit ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg.mjs?url")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg.mjs?url"));
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegWasm } = this.is64Bit ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg-wasm64.wasm?url")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg-wasm32.wasm?url"));

        // Loaded as a plain runtime URL (not a bundled import) so Vite's
        // worker-detection transform never runs over emscripten's pthread
        // `new Worker(new URL(...))` codegen inside this file.
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegModule } = await import(/* @vite-ignore */ FFmpegModuleUrl);

        const newModule = await FFmpegModule({
            locateFile: (_file: string, _scriptDirectory: string) => location.origin + FFmpegWasm,
            mainScriptUrlOrBlob: FFmpegModuleUrl,
            onRuntimeInitialized: () => {
                console.log("FFmpeg WebAssembly initialized.");
            },
            printWithColors: true,
            wasmMemory: this.wasmMemory
        });

        return newModule as MainModule;
    }

    private handleSeekerEvents(type: SeekerResponseType, _data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerResponseType.BUFFER_COPIED: {
                console.log(" buffer copioed");
            }
        }
    }

    private async handleVideoEvents(type: FFmpegRequestEvent, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case FFmpegRequestEvent.REQUEST_DATA: {
                const result = this.getFFmpegData();
                return this.videoEventer?.sendEvent(FFmpegResponseEvent.REQUEST_STATUS, {
                    status: result.status,
                    packetType: result.packetType,
                });
            };
            case FFmpegRequestEvent.SEEK: {
                console.debug("FFmpeg got the seeker at", performance.now());
                const data2 = data as { time: number; };
                const promises = [];
                for (const index in this.streams) {
                    const stream = this.streams[index];
                    const promise = stream?.eventer?.waitUntilEvent(WebDecoderResponseType.INIT_DONE) ?? Promise.resolve();
                    stream.eventer?.sendEvent(WebDecoderRequestType.REINIT, {});
                    promises.push(promise);
                }
                console.debug("Starting ffmpeg seek", performance.now());
                const ret = this.module!._seek_to(data2.time / 1000);
                console.debug("Seek finished with status:", ret, "at", performance.now(), "Now waiting for web decoders");
                await Promise.all(promises);
                console.debug("Web decoders flushed. We good!", performance.now());
                this.videoEventer?.sendEvent(FFmpegResponseEvent.SEEK_STATUS, { status: ret });
                break;
            }
            case FFmpegRequestEvent.SET_STREAM_ACTIVE: {
                const data2 = data as { streamIndex: number, active: boolean; };
                this.streams[data2.streamIndex].isUsed = data2.active;
                this.updateFFmpegSupportedStreams();
                this.videoEventer!.sendEvent(FFmpegResponseEvent.SET_STREAM_DONE, {});
                break;
            }
        }
    }

    private getFFmpegData(): { status: RequestDataStatus, packetType: number; } {
        try {
            while (true) {
                const resPtr = this.module!._poke_for_data();
                const rsult = readReturnType(this.wasmMemory.buffer, Number(resPtr), this.is64Bit, false);
                switch (rsult.status) {
                    case ResultStatus.RESULT_OK: return { status: RequestDataStatus.IMMEDIATE_RESPOSNE, packetType: -1 };
                    case ResultStatus.RESULT_ERR_SKIP:
                    case ResultStatus.RESULT_NEED_MORE: continue;
                    case ResultStatus.RESULT_EOF: return { status: RequestDataStatus.EOF, packetType: -1 };
                    case ResultStatus.RESULT_RAW_PACKET: {
                        const packetType = this.sendPacketToDecoder(rsult);
                        return { status: RequestDataStatus.DECODED_BY_OTHER_THREAD, packetType };
                    }
                    case ResultStatus.RESULT_ERR_GENERIC: throw Error("We got an error from FFmpeg :/");
                    case ResultStatus.RESULT_UNREACHABLE: debugger;
                }
            }
        } catch {
            return { status: RequestDataStatus.ERR, packetType: -1 };
        }
    }

    private sendPacketToDecoder(rsult: ReturnType<typeof readReturnType>): AVMediaType {
        const streamIndex = rsult.stream_index;
        const stream = this.streams[streamIndex];
        const event = stream.type === AVMediaType.AVMEDIA_TYPE_AUDIO
            ? WebDecoderRequestType.DECODE_AUDIO
            : WebDecoderRequestType.DECODE_VIDEO;

        if (stream.type !== AVMediaType.AVMEDIA_TYPE_VIDEO && stream.type !== AVMediaType.AVMEDIA_TYPE_AUDIO)
            throw Error("We got a packet to HW decode that is not a video or audio???");

        stream.eventer!.sendEvent(event, {
            ptr: Number(rsult.packet_data),
            size: rsult.packet_size,
            duration: Number(rsult.duration),
            timestamp: Number(rsult.timestamp),
            isKey: (rsult.flags & 1) === 1,
            packetPtr: Number(rsult.packet)
        });
        return stream.type;
    }

    public readPacket(ptr: bigint, size: number) {
        ptr = BigInt(ptr);
        if (ptr <= 0n) return 0;

        let written = 0n;
        while (written === 0n) {
            this.seekerEventer.sendEvent(SeekerRequestType.REQUEST_DATA, { offset: this.fileOffset, size, ptr });
            const results = this.seekerEventer.lockUntilEvent(SeekerResponseType.BUFFER_COPIED);

            written = results.written;
            if (written === 0n)
                console.warn("Seeker wrote 0 bytes. Smth may not be ok");
        }
        //console.log("done read", ptr);

        if (written === -1n) {
            console.error("EOF :/");
            this.videoEventer?.sendEvent(FFmpegResponseEvent.END_OF_FILE, {});
            return 0;
        }

        this.fileOffset += written;
        return Number(written);
    };

    public seekPacket(offset: bigint, whence: number): bigint {
        offset = BigInt(offset);
        if (whence === 1) { // SEEK_CUR
            if (offset > 0x7fffffffffffffffn - this.fileOffset)
                return -1n;
            offset += this.fileOffset;
        } else if (whence === 2) { // SEEK_END
            if (offset > 0x7fffffffffffffffn - this.fileSize)
                return -1n;
            offset += this.fileSize;
        } else if (whence === 0x10000)
            return this.fileSize;


        if (offset > this.fileSize || offset < 0) {
            console.error("Invalid seek offset", offset);
            return -1n;
        }

        this.seekerEventer.sendEvent(SeekerRequestType.SEEK, { offset: Number(offset), urlChange: "" });
        const results = this.seekerEventer.lockUntilEvent(SeekerResponseType.SEEK_DONE);

        const seekerState = results.result;
        if (seekerState !== 0) {
            console.error("Seeker returned bad when tried to seek. Horrors!!!!");
        }
        //console.log("done offset to", offset);
        this.fileOffset = offset;

        return this.fileOffset;
    };

    public getSWFrame(dataReturn: number | bigint) {
        const rsult = readReturnType(this.wasmMemory.buffer, Number(dataReturn), this.is64Bit, false);

        if (rsult.status !== ResultStatus.RESULT_OK) {
            console.error("SW Frame but its not ok?");
            return;
        }

        switch (rsult.type) {
            case MediaType.RESULT_VIDEO: {
                this.streams[rsult.stream_index].eventer?.sendEvent(WebDecoderRequestType.RECONSTRUCT_VIDEO_FRAME, { ptr: Number(rsult.video_frame_ptr) });
                break;
            }
            case MediaType.RESULT_AUDIO: {
                this.streams[rsult.stream_index].eventer?.sendEvent(WebDecoderRequestType.RECONSTRUCT_AUDIO_FRAME, { ptr: Number(rsult.audio_frame_ptr) });
                break;
            }
            case MediaType.RESULT_SUBTITLE: {

                switch (rsult.subtitle_type) {
                    case AVSubtitleType.SUBTITLE_BITMAP: {
                        if (rsult.subtitle_frame === null) {
                            console.error("Got a SW Subtitle frame without the frame??");
                            return;
                        }

                        const frame = rsult.subtitle_frame;
                        const size = frame.width * frame.height * 4;

                        const rgba = new Uint8ClampedArray(this.module!.HEAPU8.subarray(Number(frame.rgba_buff), Number(frame.rgba_buff) + size));

                        createImageBitmap(new ImageData(rgba, frame.width, frame.height)).then(bitmap => {
                            this.streams[rsult.stream_index].secondMessageChannel.port2.postMessage({
                                x: frame.x,
                                y: frame.y,
                                codecWidth: frame.codecWidth,
                                codecHeight: frame.codecHeight,
                                startTime: Number(rsult.timestamp),
                                endTime: Number(rsult.duration),
                                frame: bitmap,
                                uuid: crypto.randomUUID()
                            } as BitmapSubArgs, [bitmap]);
                        }, err => {
                            console.warn("Could not turn the subtitle into a bitmap. :/", err);
                        }).finally(() => {
                            this.module!._cleanup_subtitle_frame(rsult.subtitle_frame_ptr as number & BigInt);
                        });

                        break;
                    }
                    case AVSubtitleType.SUBTITLE_TEXT:
                    case AVSubtitleType.SUBTITLE_ASS: {
                        if (rsult.subtitle_text === null) {
                            console.error("Got a SW Subtitle text without the text??");
                            return;
                        }

                        this.streams[rsult.stream_index].secondMessageChannel.port2.postMessage({
                            startTime: Number(rsult.timestamp),
                            endTime: Number(rsult.duration),
                            text: rsult.subtitle_text
                        } as VTTCueArgs);
                        break;
                    }
                    default:
                    case AVSubtitleType.SUBTITLE_NONE: {
                        console.error("Subtitle unhandled");
                        return;
                    }
                }
            }
        }
    }

    public setTimestamp(time: bigint) {
        this.videoEventer?.sendEvent(FFmpegResponseEvent.SET_TIME, { time });
    }

    private async initStream<T extends ValidDecoderTypes = ValidDecoderTypes>(streamIndex: number,
        type: T,
        config: DecoderConfig[T]): Promise<Stream> {
        if (!this.module) throw Error("No ffmpeg module. Whate te fyucj");
        const messageChannel = new MessageChannel();
        const secondMessageChannel = new MessageChannel();
        const unsupportedResults = {
            streamIndex: streamIndex,
            type: type,
            isSupported: false,
            isUsed: false,
            worker: undefined,
            messageChannel,
            secondMessageChannel,
            eventer: undefined
        };

        let decoderResult;
        try {
            // @ts-expect-error TODO fight the TS compiler
            decoderResult = await this.isStreamSupported(type, config);
        } catch {

        }
        if (!(decoderResult?.supported ?? false)) {
            console.warn("Looks like your HW doesnt support", config.codec);
        }

        const titleThing = type === AVMediaType.AVMEDIA_TYPE_VIDEO ? "Video" : (type === AVMediaType.AVMEDIA_TYPE_AUDIO ? "Audio" : "Unknown");
        const worker = webDecoderWorker({ name: `I decode stream ${titleThing} Stream #${streamIndex}` });
        const eventer = new AtomicEventer(undefined, decoderRequestTemplates, decoderResponseTemplates);

        eventer.receiveEvent((event, data) => {
            this.handleWebDecoderEvent(streamIndex, event, data);
        });

        const initDonePromise = eventer.waitUntilEvent(WebDecoderResponseType.INIT_DONE);
        worker.postMessage({
            type: "init",
            isVideo: type === AVMediaType.AVMEDIA_TYPE_VIDEO,
            justToCombineStuff: decoderResult?.supported === true ? false : true,
            targetBuffer: this.wasmMemory,
            inputAtomicBuffers: eventer.getBuffers(),
            audioConfig: type === AVMediaType.AVMEDIA_TYPE_AUDIO ? config : undefined,
            videoConfig: type === AVMediaType.AVMEDIA_TYPE_VIDEO ? config : undefined,
            outputChannel: messageChannel.port2
        } as WebDecoderWorkerInit, [messageChannel.port2]);

        const result = await initDonePromise;

        if (result === null || result.data.result < 0) {
            worker.terminate();
            return unsupportedResults;
        }

        return {
            streamIndex,
            type: type,
            isSupported: decoderResult?.supported ?? false,
            isUsed: false,
            messageChannel,
            secondMessageChannel,
            worker: worker,
            eventer: eventer
        };
    }

    private isStreamSupported(type: AVMediaType.AVMEDIA_TYPE_VIDEO, config: VideoDecoderConfig): Promise<VideoDecoderSupport>;
    private isStreamSupported(type: AVMediaType.AVMEDIA_TYPE_AUDIO, config: AudioDecoderConfig): Promise<AudioDecoderSupport>;
    private isStreamSupported<T extends ValidDecoderTypes>(
        type: T,
        config: DecoderConfig[T]
    ): Promise<DecoderSupport[T]> {
        if (type === AVMediaType.AVMEDIA_TYPE_VIDEO) {
            return VideoDecoder.isConfigSupported(config as VideoDecoderConfig) as Promise<DecoderSupport[T]>;
        } else if (type === AVMediaType.AVMEDIA_TYPE_AUDIO) {
            return AudioDecoder.isConfigSupported(config as AudioDecoderConfig) as Promise<DecoderSupport[T]>;
        } else {
            throw Error("Unsupported Decoder");
        }
    }

    private handleWebDecoderEvent(streamIndex: number, type: WebDecoderResponseType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case WebDecoderResponseType.INIT_DONE: {
                const data2 = data as { result: number; };
                if (data2.result < 0)
                    console.error("Web Decoder init failed with error", data.result, `for stream #${streamIndex}`);
                else console.log(`Web Decoder init for stream #${streamIndex} succeeded :D`);

                break;
            }
            case WebDecoderResponseType.FATAL_ERROR: {
                console.error(`Web decoder for stream #${streamIndex} has died. Switching to SW decoding`);
                this.streams[streamIndex].isSupported = false;
                //this.streams[streamIndex].eventer = undefined;

                //this.streams[streamIndex].worker?.terminate();
                //this.streams[streamIndex].worker = undefined;

                this.updateFFmpegSupportedStreams();
                break;
            }
            case WebDecoderResponseType.FREE_VIDEO_PTR: {
                const { ptr } = data as { ptr: number; };
                this.module!._cleanup_video_frame((this.is64Bit ? BigInt(ptr) : ptr) as number & BigInt);
                break;
            }
            case WebDecoderResponseType.FREE_AUDIO_PTR: {
                const { ptr } = data as { ptr: number; };
                this.module!._cleanup_audio_frame((this.is64Bit ? BigInt(ptr) : ptr) as number & BigInt);
                break;
            }
            case WebDecoderResponseType.PACKET_PUBLISHED: {
                const { packetPtr } = data as { packetPtr: number; };
                this.module!._cleanup_packet((this.is64Bit ? BigInt(packetPtr) : packetPtr) as number & BigInt);
            }
        }
    }

    private updateFFmpegSupportedStreams() {
        if (!this.module) throw Error("No Module. What????");

        for (const [index, stream] of Object.entries(this.streams)) {
            const index2 = parseInt(index);

            // TODO set back to HW support
            let streamSupport = StreamSupport.HW_SUPPORT;
            if (!stream.isSupported) {
                streamSupport = StreamSupport.SW_SUPPORT;
            }
            if (!stream.isUsed) {
                streamSupport = StreamSupport.UNUSED;
            }

            this.module._set_stream_support(index2, streamSupport);
        }
    }

    private videoStructToConfig(config: VideoDecoderConfigStruct): VideoDecoderConfig {
        const description = this.module!.HEAPU8.slice(config.description, config.description + config.description_size);
        return {
            codec: config.codec,
            codedWidth: config.coded_width,
            codedHeight: config.coded_height,
            colorSpace: {
                fullRange: AVColorRangeToColorRange(config.color_range),
                matrix: AVColorSpaceToColorMatrixCoeff(config.color_space) as VideoMatrixCoefficients,
                primaries: AVColorPrimarieToColorPrimative(config.color_primaries) as VideoColorPrimaries,
                transfer: AVColorTransferToTransferChar(config.color_trc) as VideoTransferCharacteristics
            },
            description: description.byteLength > 0 ? description : undefined,
            hardwareAcceleration: "no-preference",
        };
    }

    private audioStructToConfig(config: AudioDecoderConfigStruct): AudioDecoderConfig {
        const description = this.module!.HEAPU8.slice(config.description, config.description + config.description_size);
        const format = config.sample_format >= 0
            ? (["u8", "s16", "s32", "f32"] as const)[config.sample_format]
            : undefined;

        return {
            codec: config.codec,
            numberOfChannels: config.num_channels,
            sampleRate: config.sample_rate,
            description: description.byteLength > 0 ? description : undefined,
            ...(format ? { format } : {}),
        } as AudioDecoderConfig;
    }
}


let bridge: FFmpegBridge;
/**
 * Slow communication between main thread and the FFmpeg TS bridge
 * Used for stuff that is rarely called and is not latency dependant
 */
self.onmessage = async (e: MessageEvent<AllTargetWorkerMessages>) => {
    switch (e.data.kind) {
        case "initFfmpeg": {
            bridge = new FFmpegBridge();
            self.read_packet = bridge.readPacket.bind(bridge);
            self.seek_packet = bridge.seekPacket.bind(bridge);
            self.send_sw_frame = bridge.getSWFrame.bind(bridge);
            self.set_timestamp = bridge.setTimestamp.bind(bridge);
            bridge.initialize(e.data);
            break;
        }
        case "changeStream":
        case "initFfmpegModuleOnly":
        case "thumbnailRequest":
        case "demuxerRequest":
        case "shutdown":
            console.log("idk :/");
    }
};
