import urlSeekerWorker from "../seeker/urlSeeker.worker?worker";
import fileSeekerWorker from "../seeker/fileSeeker.worker?worker";
import webDecoderWorker from "./webDecoder/webDecoder.worker?worker";
import type { FFmpegWorker } from "@FFmpeg/FFmpegTypes";

import type { MainModule as MainModule32 } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";
import type { MainModule as MainModule64 } from "@FFmpeg/ffmpeg-wasm64/ffmpeg";

import { RequestDataStatus, StreamSupport, type AllTargetWorkerMessages, type DecoderConfig, type DecoderSupport, type ValidDecoderTypes, type WorkerFFmpegInitComplete, type WorkerInitFFmpeg } from "./types";
import { AVColorPrimarieToColorPrimative, AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorTransferToTransferChar, AVLogLevel, AVPixelFormatToVideoFormat, AVSampleFormatToAudioFormat } from "./advancedTypes/AVTypes";
import getSupportedPixelFormats from "./advancedTypes/supportedPixelFormats";
import canWasm64 from "./advancedTypes/isWasm64";
import AtomicEventer from "../atomicEventer/atomicEventer";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type FileSeekableWorkerInit, type UrlSeekableWorkerInit } from "../seeker/types";
import type { DecodeTemplate, SerializableStuff } from "../atomicEventer/types";
import type { Dictionary } from "@/core/types";
import { decoderRequestTemplates, decoderResponseTemplates, WebDecoderRequestType, WebDecoderResponseType, type WebDecoderWorkerInit } from "./webDecoder/types";
import { FFmpegRequestEvent, ffmpegRequestTemplate, FFmpegResponseEvent, ffmpegResponseTemplate } from "./advancedTypes/atomicTypes";
import { MediaType, readFileInfo, readReturnType, ResultStatus, type VideoDecoderConfigStruct, type AudioDecoderConfigStruct, AVSubtitleType } from "./structReader";
import type { WorkerAudioDataInit } from "../Tracks/audio/audioTypes";
import type { VTTCueArgs } from "../Tracks/subtitles/types";

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
    secondMessageChannel: MessageChannel,
    eventer: AtomicEventer<WebDecoderRequestType, WebDecoderResponseType, typeof decoderRequestTemplates, typeof decoderResponseTemplates> | undefined;
};

class FFmpegBridge {
    private module: MainModule | undefined;
    private is64Bit = canWasm64();
    private supportsAudioData: boolean = typeof AudioData !== 'undefined';

    // Seeker
    private seekerWorker: Worker = null!;
    private fileSize: bigint = -1n;
    private bufferSize: number = 16384;
    private fileOffset: bigint = 0n;

    // File
    private fileUrl: string | File = "";

    private streams: Record<number, Stream> = {};
    private streamSupportPtr: number | BigInt = 0;


    // Events
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

    }

    async initialize(dataInfo: WorkerInitFFmpeg) {
        this.module = await this.loadWasmModule(this.is64Bit);

        // Parent Thread control
        this.videoEventer = new AtomicEventer(dataInfo.eventerBuffers, ffmpegResponseTemplate, ffmpegRequestTemplate);
        this.videoEventer.receiveEvent(this.handleVideoEvents.bind(this));

        // Seeker
        const { promise, resolve } = Promise.withResolvers<{ result: number, fileSize: bigint; }>();
        this.seekerSeekDone = resolve;
        this.fileUrl = dataInfo.fileSource;
        this.bufferSize = dataInfo.bufferSize;

        if (typeof dataInfo.fileSource === "string") {
            this.seekerWorker = urlSeekerWorker({ name: "I download and give data to the ffmpeg thread" });
            this.seekerEventer.receiveEvent(this.handleSeekerEvents.bind(this));

            this.seekerWorker.postMessage({
                url: this.fileUrl,
                atomicBuffers: this.seekerEventer.getBuffers(),
                fetchBufferSize: this.bufferSize,
                targetBuffer: this.module.wasmMemory,
                type: "init"
            } as UrlSeekableWorkerInit);
        } else if (dataInfo.fileSource instanceof File) {
            this.seekerWorker = fileSeekerWorker({ name: "I read the local file and give data to the ffmpeg thread" });
            this.seekerEventer.receiveEvent(this.handleSeekerEvents.bind(this));

            this.seekerWorker.postMessage({
                file: dataInfo.fileSource,
                atomicBuffers: this.seekerEventer.getBuffers(),
                targetBuffer: this.module.wasmMemory,
                type: "init"
            } as FileSeekableWorkerInit);
        }

        const seekResults = await promise;
        if (seekResults.result < 0) {
            throw Error("Seeker could not init. Ughhhh");
        }
        this.fileSize = seekResults.fileSize;

        // Supported Pixel formats
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

        // Init FFmpeg
        const ret = this.module._init_ffmpeg(dataInfo.bufferSize, 0, AVLogLevel.AV_LOG_INFO, pixFmtPtr as never, 4);
        if (ret < 0) {
            throw Error("FFmpeg didnt init properly. Dying");
        }

        // Open File
        const fileInfoPtr = this.module._open_file();
        if (Number(fileInfoPtr) === 0)
            throw Error("Could not open the file. Your problem now");

        const fileInfo = readFileInfo(this.module, Number(fileInfoPtr), this.is64Bit);
        console.log(fileInfo);

        // Stream Setup
        this.streamSupportPtr = this.module._malloc((this.is64Bit ? BigInt(fileInfo.nb_streams * 4) : fileInfo.nb_streams * 4) as never);
        this.module._set_stream_support((this.is64Bit ? BigInt(this.streamSupportPtr as never) : this.streamSupportPtr) as never);

        const streamPromises = fileInfo.streams.map((stream, i) => {
            switch (stream.type) {
                case MediaType.RESULT_VIDEO: return this.initStream(i, stream.type, this.VideoStructToConfig(stream.video_config!));
                case MediaType.RESULT_AUDIO: return this.initStream(i, stream.type, this.AudioStructToConfig(stream.audio_config!));
                case MediaType.RESULT_SUBTITLE:
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

        const streams = await Promise.all(streamPromises);

        for (const stream of streams) {
            this.streams[stream.streamIndex] = stream;
        }
        this.updateFFmpegSupportedStreams();

        const port1s = new Map(streams.map(s => [s.streamIndex, s.messageChannel.port1] as const));
        const port1sAgain = new Map(streams.map(s => [s.streamIndex, s.secondMessageChannel.port1] as const));
        self.postMessage({
            kind: "initComplete",
            info: fileInfo,
            streamPorts: port1s,
            streamPorts2: port1sAgain
        } as WorkerFFmpegInitComplete, [...port1s.values(), ...port1sAgain.values()]);

        this.module._cleanup_info(fileInfoPtr as never);
    }

    async loadWasmModule(canWasm64: boolean) {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegModuleUrl } = canWasm64 ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg.mjs?url")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg.mjs?url"));
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { default: FFmpegWasm } = canWasm64 ? (await import("@FFmpeg/ffmpeg-wasm64/ffmpeg-wasm64.wasm?url")) : (await import("@FFmpeg/ffmpeg-wasm32/ffmpeg-wasm32.wasm?url"));

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
            printWithColors: true
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
                const result = this.getFFmpegData();
                return this.videoEventer?.sendEvent(FFmpegResponseEvent.REQUEST_STATUS, {
                    status: result.status,
                    packetType: result.packetType,
                });
            };
            case FFmpegRequestEvent.SEEK: return console.log("Soon");
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
                const rsult = readReturnType(this.module!.wasmMemory.buffer, Number(resPtr), this.is64Bit);
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

    private sendPacketToDecoder(rsult: ReturnType<typeof readReturnType>): MediaType {
        const streamIndex = rsult.stream_index;
        const stream = this.streams[streamIndex];
        const event = stream.type === MediaType.RESULT_AUDIO
            ? WebDecoderRequestType.DECODE_AUDIO
            : WebDecoderRequestType.DECODE_VIDEO;

        if (stream.type !== MediaType.RESULT_AUDIO && stream.type !== MediaType.RESULT_VIDEO)
            throw Error("We got a packet to HW decode that is not a video or audio???");

        stream.eventer!.sendEvent(event, {
            ptr: Number(rsult.packet_data),
            size: rsult.packet_size,
            duration: Number(rsult.duration),
            timestamp: Number(rsult.timestamp),
            isKey: (rsult.flags & 1) === 1
        });

        const packet = rsult.packet;
        stream.eventer!.waitUntilEvent(WebDecoderResponseType.PACKET_PUBLISHED).then(() => {
            this.module!._cleanup_packet(packet as any);
        });
        return stream.type;
    }

    public readPacket(ptr: bigint, size: number) {
        if (ptr <= 0) return 0;

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
            return -2;
        }

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

    public getSWFrame(data_return: number | bigint) {
        const rsult = readReturnType(this.module!.wasmMemory.buffer, Number(data_return), this.is64Bit);

        if (rsult.status !== ResultStatus.RESULT_OK) {
            console.error("SW Frame but its not ok?");
            return;
        }

        switch (rsult.type) {
            case MediaType.RESULT_VIDEO: {
                if (rsult.video_frame == null) {
                    console.error("Got a SW Video frame without the frame??");
                    return;
                }

                let layout: PlaneLayout[] = [];
                for (let i = 0; i < rsult.video_frame.src_data.length; i++) {
                    const offset = Number(rsult.video_frame.src_data[i]);
                    const stride = rsult.video_frame.src_linesize[i];

                    if (offset !== 0) {
                        layout.push({
                            offset,
                            stride
                        });
                    }

                }

                const visible_width = rsult.video_frame.width - rsult.video_frame.crop_left - rsult.video_frame.crop_right;
                const visible_height = rsult.video_frame.height - rsult.video_frame.crop_top - rsult.video_frame.crop_bottom;

                const frame = new VideoFrame(this.module!.HEAPU8.buffer, {
                    codedHeight: rsult.video_frame.height,
                    codedWidth: rsult.video_frame.width,
                    colorSpace: {
                        fullRange: AVColorRangeToColorRange(rsult.video_frame.color_range),
                        matrix: AVColorSpaceToColorMatrixCoeff(rsult.video_frame.color_space) as VideoMatrixCoefficients,
                        primaries: AVColorPrimarieToColorPrimative(rsult.video_frame.color_primaries) as VideoColorPrimaries,
                        transfer: AVColorTransferToTransferChar(rsult.video_frame.color_transfer) as VideoTransferCharacteristics
                    },
                    displayHeight: visible_height,
                    displayWidth: visible_width,
                    duration: rsult.video_frame.dur_js,
                    format: AVPixelFormatToVideoFormat(rsult.video_frame.format) as VideoPixelFormat,
                    layout: layout,
                    timestamp: rsult.video_frame.ts_js,
                    visibleRect: {
                        x: rsult.video_frame.crop_left,
                        y: rsult.video_frame.crop_top,
                        width: visible_width,
                        height: visible_height
                    }
                });

                this.streams[rsult.stream_index].secondMessageChannel.port2.postMessage(frame, [frame]);
                this.module!._cleanup_video_frame(rsult.video_frame_ptr as any);
                break;
            }
            case MediaType.RESULT_AUDIO: {
                if (rsult.audio_frame == null) {
                    console.error("Got a SW Audio frame without the frame??");
                    return;
                }
                const bufferSizeBytes = rsult.audio_frame.samples * rsult.audio_frame.channels * rsult.audio_frame.bytes_per_sample;
                const data = this.module!.HEAPU8.slice(rsult.audio_frame.data, rsult.audio_frame.data + bufferSizeBytes);

                let audio: AudioData | WorkerAudioDataInit;
                let transfer = [];
                if (this.supportsAudioData) {
                    audio = new AudioData({
                        data: data,
                        format: AVSampleFormatToAudioFormat(rsult.audio_frame.format),
                        numberOfChannels: rsult.audio_frame.channels,
                        numberOfFrames: rsult.audio_frame.samples,
                        sampleRate: rsult.audio_frame.sample_rate,
                        timestamp: rsult.audio_frame.ts_js,
                        transfer: [data.buffer]
                    });
                    transfer.push(audio);
                } else {
                    audio = {
                        kind: "audioDataInit",
                        streamIndex: rsult.stream_index,

                        data: data,
                        format: AVSampleFormatToAudioFormat(rsult.audio_frame.format),
                        numberOfChannels: rsult.audio_frame.channels,
                        numberOfFrames: rsult.audio_frame.samples,
                        sampleRate: rsult.audio_frame.sample_rate,
                        timestamp: rsult.audio_frame.ts_js,
                        transfer: [data.buffer]
                    };

                    transfer.push(data.buffer);
                }

                this.streams[rsult.stream_index].secondMessageChannel.port2.postMessage(audio, transfer);
                this.module!._cleanup_audio_frame(rsult.audio_frame_ptr as any);
                break;
            }
            case MediaType.RESULT_SUBTITLE: {

                switch (rsult.subtitle_type) {
                    case AVSubtitleType.SUBTITLE_BITMAP: {
                        if (rsult.subtitle_frame == null) {
                            console.error("Got a SW Subtitle frame without the frame??");
                            return;
                        }

                        // const indices = this.module!.HEAPU8.subarray(Number(rsult.subtitle_frame.src_data[0]), rsult.subtitle_frame.src_linesize[0]  * rect.h);
                        // const pallete = this.module!.HEAPU8.subarray(Number(rsult.subtitle_frame.src_data[1]), rsult.subtitle_frame.nb_colors * 4);

                        // const lut = new Uint32Array(rsult.subtitle_frame.nb_colors);
                        // for (let i = 0; i < rsult.subtitle_frame.nb_colors; i++) {
                        //     const o = i * 4;
                        //     const b = palette[o];
                        //     const g = palette[o + 1];
                        //     const r = palette[o + 2];
                        //     const a = palette[o + 3];
                        //     // native-endian (LE) uint32 write with byte pattern [R,G,B,A] in memory
                        //     lut[i] = (a << 24) | (b << 16) | (g << 8) | r;
                        // }

                        // const imageData = new ImageData(width, height);
                        // const dst32 = new Uint32Array(imageData.data.buffer);

                        // for (let y = 0; y < height; y++) {
                        //     const srcRow = y * indexLinesize;
                        //     const dstRow = y * width;
                        //     for (let x = 0; x < width; x++) {
                        //         dst32[dstRow + x] = lut[indices[srcRow + x]];
                        //     }
                        // }
                        break;
                    }
                    case AVSubtitleType.SUBTITLE_TEXT: {
                        if (rsult.subtitle_text == null) {
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
                    case AVSubtitleType.SUBTITLE_ASS:
                    case AVSubtitleType.SUBTITLE_NONE: {
                        console.error("Subtitle unhandled");
                        return;
                    }
                }
            }
        }


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
            // TODO fight the TS compiler
            // @ts-expect-error
            decoderResult = await this.IsStreamSupported(type, config);
        } catch {
            return unsupportedResults;
        }

        if (!decoderResult.supported)
            return unsupportedResults;

        const titleThing = type === MediaType.RESULT_VIDEO ? "Video" : (type === MediaType.RESULT_AUDIO ? "Audio" : "Unknown");
        const worker = webDecoderWorker({ name: `I decode stream ${titleThing} Stream #${streamIndex}` });
        const eventer = new AtomicEventer(undefined, decoderRequestTemplates, decoderResponseTemplates);

        eventer.receiveEvent((event, data) => {
            this.handleWebDecoderEvent(streamIndex, event, data);
        });

        const initDonePromise = eventer.waitUntilEvent(WebDecoderResponseType.INIT_DONE);
        worker.postMessage({
            type: "init",
            isVideo: type === MediaType.RESULT_VIDEO,
            targetBuffer: this.module.wasmMemory,
            inputAtomicBuffers: eventer.getBuffers(),
            audioConfig: type === MediaType.RESULT_AUDIO ? config : undefined,
            videoConfig: type === MediaType.RESULT_VIDEO ? config : undefined,
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
            isSupported: true,
            isUsed: false,
            messageChannel,
            secondMessageChannel,
            worker: worker,
            eventer: eventer
        };
    }

    private IsStreamSupported(type: MediaType.RESULT_VIDEO, config: VideoDecoderConfig): Promise<VideoDecoderSupport>;
    private IsStreamSupported(type: MediaType.RESULT_AUDIO, config: AudioDecoderConfig): Promise<AudioDecoderSupport>;
    private IsStreamSupported<T extends ValidDecoderTypes>(
        type: T,
        config: DecoderConfig[T]
    ): Promise<DecoderSupport[T]> {
        if (type === MediaType.RESULT_VIDEO) {
            return VideoDecoder.isConfigSupported(config as VideoDecoderConfig) as Promise<DecoderSupport[T]>;
        } else if (type == MediaType.RESULT_AUDIO) {
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

            // TODO set back to HW support
            let streamSupport = StreamSupport.HW_SUPPORT;
            if (!stream.isUsed) {
                streamSupport = StreamSupport.UNUSED;
            }
            if (!stream.isSupported) {
                streamSupport = StreamSupport.SW_SUPPORT;
            }

            view.setInt32(streamPtr, streamSupport, true);
        }
    }

    private VideoStructToConfig(config: VideoDecoderConfigStruct): VideoDecoderConfig {
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
            description: this.module!.HEAPU8.slice(config.description, config.description + config.description_size),
        };
    }

    private AudioStructToConfig(config: AudioDecoderConfigStruct): AudioDecoderConfig {
        return {
            codec: config.codec,
            numberOfChannels: config.num_channels,
            sampleRate: config.sample_rate,
            description: this.module!.HEAPU8.slice(config.description, config.description + config.description_size),
        };
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
