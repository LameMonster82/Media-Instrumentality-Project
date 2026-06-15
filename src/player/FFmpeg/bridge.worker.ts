import seekerWorker from "../seeker/urlSeeker.worker?worker";
import webDecoderWorker from "./webDecoder/webDecoder.worker?worker";
import type { FFmpegWorker } from "@FFmpeg/FFmpegTypes";

import type { MainModule as MainModule32 } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";
import type { MainModule as MainModule64 } from "@FFmpeg/ffmpeg-wasm64/ffmpeg";

import { StreamSupport, type AllTargetWorkerMessages, type WorkerFFmpegInitComplete, type WorkerInitFFmpeg } from "./types";
import { AVColorPrimarieToColorPrimative, AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorTransferToTransferChar, AVLogLevel } from "./advancedTypes/AVTypes";
import getSupportedPixelFormats from "./advancedTypes/supportedPixelFormats";
import canWasm64 from "./advancedTypes/isWasm64";
import AtomicEventer from "../atomicEventer/atomicEventer";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type SeekableWorkerInit } from "../seeker/types";
import type { DecodeTemplate, SerializableStuff } from "../atomicEventer/types";
import type { Dictionary } from "@/core/types";
import { decoderRequestTemplates, decoderResponseTemplates, WebDecoderRequestType, WebDecoderResponseType, type WebDecoderWorkerInit } from "./webDecoder/types";
import { FFmpegRequestEvent, ffmpegRequestTemplate, FFmpegResponseEvent, ffmpegResponseTemplate } from "./advancedTypes/atomicTypes";
import { MediaType, readFileInfo, readReturnType, ResultStatus, type VideoDecoderConfigStruct, type AudioDecoderConfigStruct } from "./structReader";

// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877
// eslint-disable-next-line no-var
declare var self: FFmpegWorker;

type MainModule = MainModule32 | MainModule64;
type Stream = {
    streamIndex: number,
    type: MediaType,
    isSupported: boolean,
    isUsed: boolean,
    worker: Worker | undefined,
    messageChannel: MessageChannel,
    eventer: AtomicEventer<WebDecoderRequestType, WebDecoderResponseType, typeof decoderRequestTemplates, typeof decoderResponseTemplates> | undefined;
};

class FFmpegBridge {
    private module: MainModule | undefined;
    private is64Bit = canWasm64();
    private seekerWorker: Worker;
    private fileSize: bigint = -1n;
    private bufferSize: number = 16384;
    private fileOffset: bigint = 0n;
    private url: string = "";

    private streams: Record<number, Stream> = {};
    private streamSupportPtr: number | BigInt = 0;

    private seekerEventer: AtomicEventer<
        SeekerRequestType,
        SeekerResponseType,
        typeof seekerRequestTemplates,
        typeof seekerResponseTemplates> = new AtomicEventer(undefined, seekerRequestTemplates, seekerResponseTemplates);

    private seekerSeekDone = (_data: { result: number, fileSize: bigint; }) => { };

    private videoEventer: AtomicEventer<
        FFmpegResponseEvent,
        FFmpegRequestEvent,
        typeof ffmpegResponseTemplate,
        typeof ffmpegRequestTemplate> | undefined;

    constructor() {
        this.seekerWorker = seekerWorker({ name: "I download and give data to the ffmpeg thread" });
        this.seekerEventer.receiveEvent(this.handleSeekerEvents.bind(this));
    }

    async initialize(dataInfo: WorkerInitFFmpeg) {
        this.module = await this.loadWasmModule(this.is64Bit);
        this.bufferSize = dataInfo.bufferSize;
        this.url = dataInfo.url;

        this.videoEventer = new AtomicEventer(dataInfo.eventerBuffers, ffmpegResponseTemplate, ffmpegRequestTemplate);

        this.videoEventer.receiveEvent(this.handleVideoEvents.bind(this));
        const { promise, resolve } = Promise.withResolvers<{ result: number, fileSize: bigint; }>();
        this.seekerSeekDone = resolve;

        this.seekerWorker.postMessage({
            url: dataInfo.url,
            atomicBuffers: this.seekerEventer.getBuffers(),
            fetchBufferSize: this.bufferSize,
            targetBuffer: this.module.wasmMemory,
            type: "init"
        } as SeekableWorkerInit);

        const seekResults = await promise;
        if (seekResults.result < 0) {
            throw Error("Seeker could not init. Ughhhh");
        }
        this.fileSize = seekResults.fileSize;

        const pixFmts = getSupportedPixelFormats();

        let pixFmtPtr: number | bigint;
        if (this.is64Bit) {
            const module = this.module as MainModule64;
            const size = BigInt(pixFmts.length) * 4n;
            pixFmtPtr = Number(module._malloc(size));
            for (let i = 0; i < pixFmts.length; i++) {
                module.setValue(pixFmtPtr + i * 4, pixFmts[i], 'i32');
            }
            pixFmtPtr = BigInt(pixFmtPtr);
        } else {
            const module = this.module as MainModule32;
            const size = pixFmts.length * 4;
            pixFmtPtr = module._malloc(size);
            for (let i = 0; i < pixFmts.length; i++) {
                module.setValue(pixFmtPtr + i * 4, pixFmts[i], 'i32');
            }
        }

        const ret = this.module._init_ffmpeg(dataInfo.bufferSize, 0, AVLogLevel.AV_LOG_INFO, pixFmtPtr as never, 4);
        if (ret < 0) {
            throw Error("FFmpeg didnt init properly. Dying");
        }

        const fileInfoPtr = this.module._open_file();
        if (Number(fileInfoPtr) === 0)
            throw Error("Could not open the file. Your problem now");

        const fileInfo = readFileInfo(this.module, Number(fileInfoPtr), this.is64Bit);
        console.log(fileInfo);

        this.streamSupportPtr = this.module._malloc((this.is64Bit ? BigInt(fileInfo.nb_streams * 4) : fileInfo.nb_streams * 4) as never);
        this.module._set_stream_support((this.is64Bit ? BigInt(this.streamSupportPtr as never) : this.streamSupportPtr) as never);

        const streamPromises = fileInfo.streams.map((stream, i) => {
            switch (stream.type) {
                case MediaType.RESULT_VIDEO: return this.initVideoStream(i, stream.video_config!);
                case MediaType.RESULT_AUDIO: return this.initAudioStream(i, stream.audio_config!);
                default:
                    console.warn("Unsupported stream type", stream.type);
                    return Promise.resolve({
                        streamIndex: i,
                        type: stream.type,
                        isSupported: false,
                        isUsed: false,
                        messageChannel: new MessageChannel(),
                        worker: undefined,
                        eventer: undefined
                    });
            }
        });

        const streams = await Promise.all(streamPromises);

        for (const stream of streams) {
            this.streams[stream.streamIndex] = stream;
        }
        this.updateFFmpegSupportedStreams();

        const port1s = streams.map(s => s.messageChannel.port1);
        self.postMessage({
            kind: "initComplete",
            info: fileInfo,
            streamPorts: port1s
        } as WorkerFFmpegInitComplete, port1s);

        this.module._cleanup_info(fileInfoPtr as never);
    }

    async loadWasmModule(canWasm64: boolean) {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegModule } = canWasm64 ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg.mjs")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg.mjs"));
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegModuleUrl } = canWasm64 ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg.mjs?url")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg.mjs?url"));
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegWasm } = canWasm64 ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg-wasm64.wasm?url")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg-wasm32.wasm?url"));

        const newModule = await FFmpegModule({
            locateFile: (_file: string, _scriptDirectory: string) => location.origin + FFmpegWasm,
            mainScriptUrlOrBlob: FFmpegModuleUrl,
            onRuntimeInitialized: () => {
                console.log("FFmpeg WebAssembly initialized.");
            },
        });

        return newModule as MainModule;
    }

    private handleSeekerEvents(type: SeekerResponseType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerResponseType.SEEK_DONE: {
                this.seekerSeekDone(data as { result: number, fileSize: bigint; });
                break;
            }
            case SeekerResponseType.BUFFER_COPIED: {
                console.log(" buffer copioed");
            }
        }
    }

    private handleVideoEvents(type: FFmpegRequestEvent, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case FFmpegRequestEvent.REQUEST_DATA: {
                while (true) {
                    const resPtr = this.module!._poke_for_data();
                    const rsult = readReturnType(this.module!.wasmMemory.buffer, Number(resPtr), this.is64Bit);

                    switch (rsult.status) {
                        case ResultStatus.RESULT_OK: {
                            console.error("Not yet to handle that");
                            continue;
                        }
                        case ResultStatus.RESULT_ERR_SKIP:
                        case ResultStatus.RESULT_NEED_MORE: {
                            continue;
                        }
                        case ResultStatus.RESULT_EOF: {
                            console.error("EOFFF");
                            return;
                        }
                        case ResultStatus.RESULT_RAW_PACKET: {
                            const streamIndex = rsult.stream_index;
                            let event = WebDecoderRequestType.DECODE_VIDEO;
                            if (this.streams[streamIndex].type === MediaType.RESULT_AUDIO) {
                                event = WebDecoderRequestType.DECODE_AUDIO;
                            } else if (this.streams[streamIndex].type !== MediaType.RESULT_VIDEO) {
                                throw Error("We got a packet to HW decode that is not a video or audio???");
                            }

                            this.streams[streamIndex].eventer!.sendEvent(event, {
                                ptr: Number(rsult.packet_data),
                                size: rsult.packet_size,
                                duration: Number(rsult.duration),
                                timestamp: Number(rsult.timestamp),
                                isKey: (rsult.flags & 1) === 1
                            });
                            break;
                        }
                        case ResultStatus.RESULT_ERR_GENERIC: {
                            console.error("We got an error from FFmpeg :/");
                            break;
                        }
                        case ResultStatus.RESULT_UNREACHABLE: {
                            debugger;
                        }
                    }
                }
                break;
            }
            case FFmpegRequestEvent.SEEK: {
                console.log("Soon");
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

    public readPacket(ptr: bigint, size: number) {
        if (ptr <= 0) return 0;

        this.seekerEventer.sendEvent(SeekerRequestType.REQUEST_DATA, { offset: this.fileOffset, size, ptr });
        const results = this.seekerEventer.lockUntilEvent(SeekerResponseType.BUFFER_COPIED);
        //console.log("done read", ptr);

        const written = results.written;
        if (written === -1n) {
            console.error("EOF :/");
            return -2;
        }

        if (written === 0n)
            console.warn("Seeker wrote 0 bytes. Smth may not be ok");

        this.fileOffset += written;
        return Number(written);
    };

    public seekPacket(offset: bigint, whence: number): bigint {
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

        this.seekerEventer.sendEvent(SeekerRequestType.SEEK, { offset: Number(offset), urlChange: this.url });
        const results = this.seekerEventer.lockUntilEvent(SeekerResponseType.SEEK_DONE);

        const seekerState = results.result;
        if (seekerState !== 0) {
            console.error("Seeker returned bad when tried to seek. Horrors!!!!");
        }
        //console.log("done offset to", offset);
        this.fileOffset = offset;

        return this.fileOffset;
    };

    public sendSWFrame(ptr: number | bigint) {
        console.warn("Implement me");
    }

    private async initVideoStream(streamIndex: number, config: VideoDecoderConfigStruct): Promise<Stream> {
        if (!this.module) throw Error("No ffmpeg module. Whate te fyucj");
        const messageChannel = new MessageChannel();
        const unsupportedResults = {
            streamIndex,
            type: MediaType.RESULT_VIDEO,
            isSupported: false,
            isUsed: false,
            worker: undefined,
            messageChannel,
            eventer: undefined
        };

        let decoderResult;
        try {
            decoderResult = await VideoDecoder.isConfigSupported({
                codec: config.codec,
                codedWidth: config.coded_width,
                codedHeight: config.coded_height,
                colorSpace: {
                    fullRange: AVColorRangeToColorRange(config.color_range),
                    matrix: AVColorSpaceToColorMatrixCoeff(config.color_space) as VideoMatrixCoefficients,
                    primaries: AVColorPrimarieToColorPrimative(config.color_primaries) as VideoColorPrimaries,
                    transfer: AVColorTransferToTransferChar(config.color_trc) as VideoTransferCharacteristics
                },
                description: this.module!.HEAPU8.slice(config.description, config.description + config.description_size),
            });
        } catch {
            return unsupportedResults;
        }

        if (!decoderResult.supported)
            return unsupportedResults;

        const worker = webDecoderWorker({ name: `I decode stream Video Stream #${streamIndex}` });
        const eventer = new AtomicEventer(undefined, decoderRequestTemplates, decoderResponseTemplates);

        eventer.receiveEvent((event, data) => {
            this.handleWebDecoderEvent(streamIndex, event, data);
        });

        const initDonePromise = eventer.waitUntilEvent(WebDecoderResponseType.INIT_DONE);
        worker.postMessage({
            type: "init",
            isVideo: true,
            targetBuffer: this.module.wasmMemory,
            inputAtomicBuffers: eventer.getBuffers(),
            audioConfig: undefined,
            videoConfig: config,
            outputChannel: messageChannel.port2
        } as WebDecoderWorkerInit, [messageChannel.port2]);

        const result = await initDonePromise;

        if (result === null || result.data.result < 0) {
            worker.terminate();
            return unsupportedResults;
        }

        return {
            streamIndex,
            type: MediaType.RESULT_VIDEO,
            isSupported: true,
            isUsed: false,
            messageChannel,
            worker: worker,
            eventer: eventer
        };
    }

    private async initAudioStream(streamIndex: number, config: AudioDecoderConfigStruct): Promise<Stream> {
        if (!this.module) throw Error("No ffmpeg module. Whate te fyucj");
        const messageChannel = new MessageChannel();
        const unsupportedResults = {
            streamIndex,
            type: MediaType.RESULT_AUDIO,
            isSupported: false,
            isUsed: false,
            messageChannel,
            worker: undefined,
            eventer: undefined
        };

        let decoderResult;
        try {
            decoderResult = await AudioDecoder.isConfigSupported({
                codec: config.codec,
                numberOfChannels: config.num_channels,
                sampleRate: config.sample_rate,
                description: this.module!.HEAPU8.slice(config.description, config.description + config.description_size),
            });
        } catch {
            return unsupportedResults;
        }

        if (!decoderResult.supported)
            return unsupportedResults;

        const worker = webDecoderWorker({ name: `I decode stream Audio Stream #${streamIndex}` });
        const eventer = new AtomicEventer(undefined, decoderRequestTemplates, decoderResponseTemplates);

        eventer.receiveEvent((event, data) => {
            this.handleWebDecoderEvent(streamIndex, event, data);
        });

        const initDonePromise = eventer.waitUntilEvent(WebDecoderResponseType.INIT_DONE);
        worker.postMessage({
            type: "init",
            isVideo: false,
            targetBuffer: this.module.wasmMemory,
            inputAtomicBuffers: eventer.getBuffers(),
            audioConfig: config,
            videoConfig: undefined,
            outputChannel: messageChannel.port2
        } as WebDecoderWorkerInit, [messageChannel.port2]);

        const result = await initDonePromise;

        if (result === null || result.data.result < 0) {
            worker.terminate();
            return unsupportedResults;
        }

        return {
            streamIndex,
            type: MediaType.RESULT_AUDIO,
            isSupported: true,
            isUsed: false,
            messageChannel,
            worker: worker,
            eventer: eventer
        };
    }

    private initSubtitleStream(streamIndex: number) {
        const messageChannel = new MessageChannel();
        return {
            streamIndex,
            type: MediaType.RESULT_SUBTITLE,
            isSupported: false,
            isUsed: false,
            messageChannel,
            worker: undefined,
            eventer: undefined
        };
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
                this.streams[streamIndex].eventer = undefined;

                this.streams[streamIndex].worker?.terminate();
                this.streams[streamIndex].worker = undefined;

                this.updateFFmpegSupportedStreams();
                break;
            }
        }
    }

    private updateFFmpegSupportedStreams() {
        if (!this.module) throw Error("No Module. What????");
        const view = new DataView(this.module.wasmMemory.buffer);

        const ptr = Number(this.streamSupportPtr);
        for (const [index, stream] of Object.entries(this.streams)) {
            const index2 = parseInt(index);
            const streamPtr = ptr + (index2 * 4);

            let streamSupport = StreamSupport.HW_SUPPORT;
            if (!stream.isUsed) {
                streamSupport = StreamSupport.UNUSED;
            }
            if (!stream.isSupported) {
                // TODO: Change to SW Support
                streamSupport = StreamSupport.UNUSED;
            }
            view.setInt32(streamPtr, streamSupport, true);
        }
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
            self.send_sw_frame = bridge.sendSWFrame.bind(bridge);
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
