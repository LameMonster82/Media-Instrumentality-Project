import seekerWorker from "../seeker/urlSeeker.worker?worker";
import webDecoderWorker from "./webDecoder/webDecoder.worker?worker";
import type { FFmpegWorker } from "@FFmpeg/FFmpegTypes";

import type { MainModule as MainModule32 } from "@FFmpeg/ffmpeg-wasm32/ffmpeg";
import type { MainModule as MainModule64 } from "@FFmpeg/ffmpeg-wasm64/ffmpeg";

import type { AllTargetWorkerMessages, WorkerInitFFmpeg } from "./types";
import { AVColorPrimarieToColorPrimative, AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorTransferToTransferChar, AVLogLevel } from "./advancedTypes/AVTypes";
import getSupportedPixelFormats from "./advancedTypes/supportedPixelFormats";
import canWasm64 from "./advancedTypes/isWasm64";
import { readFileInfo, type VideoDecoderConfigStruct } from "./structReader";
import AtomicEventer from "../atomicEventer/atomicEventer";
import { seekerRequestTemplates, SeekerRequestType, seekerResponseTemplates, SeekerResponseType, type SeekableWorkerInit } from "../seeker/types";
import type { DecodeTemplate, SerializableStuff } from "../atomicEventer/types";
import type { Dictionary } from "@/core/types";

// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877
// eslint-disable-next-line no-var
declare var self: FFmpegWorker;

type MainModule = MainModule32 | MainModule64;

let bridge: FFmpegBridge;

class FFmpegBridge {
    private module: MainModule | undefined;
    private is64Bit = canWasm64();
    private seekerWorker: Worker;
    private fileSize: bigint = -1n;
    private bufferSize: number = 16384;
    private fileOffset: bigint = 0n;
    private url: string = "";

    private seekerEventer: AtomicEventer<
        SeekerRequestType,
        SeekerResponseType,
        typeof seekerRequestTemplates,
        typeof seekerResponseTemplates> = new AtomicEventer(undefined, seekerRequestTemplates, seekerResponseTemplates);

    private seekerSeekDone = (_data: { result: number, fileSize: bigint; }) => { };

    constructor() {
        this.seekerWorker = seekerWorker({ name: "I download and give data to the ffmpeg thread" });
        this.seekerEventer.receiveEvent(this.handleSeekerEvents.bind(this));
    }

    async initialize(dataInfo: WorkerInitFFmpeg) {
        this.module = await this.loadWasmModule(this.is64Bit);
        this.bufferSize = dataInfo.bufferSize;
        this.url = dataInfo.url;

        const { promise, resolve } = Promise.withResolvers<{ result: number, fileSize: bigint; }>();
        this.seekerSeekDone = resolve;

        this.seekerWorker.postMessage({
            url: dataInfo.url,
            atomicBuffers: this.seekerEventer.getBuffers(),
            fetchBufferSize: 32 * 1024 * 1024,
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

        let ret: number | BigInt = this.module._init_ffmpeg(dataInfo.bufferSize, 0, AVLogLevel.AV_LOG_INFO, pixFmtPtr as never, 4);
        if (ret < 0) {
            throw Error("FFmpeg didnt init properly. Dying");
        }

        ret = this.module._open_file();
        if (Number(ret) === 0)
            throw Error("Could not open the file. Your problem now");

        const fileInfo = readFileInfo(this.module, Number(ret), this.is64Bit);
        console.log(fileInfo);








        // console.log("File opened with result:", result);


        // //////////////////////////////////////////////////////

        // Promise.all(workerState.configPromises).then(() => {
        //     for (const keyS of Object.keys(workerState.streams)) {
        //         const key = parseInt(keyS);
        //         workerState.streams[key]!.metadata = workerState.streamMetadatas[key]!;
        //     }
        //     const strippedStreams = streamsWithoudDecoder();
        //     self.postMessage({ kind: "streams", streams: strippedStreams } as WorkerSubmitStreams);
        // });
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

    private async handleSeekerEvents(type: SeekerResponseType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case SeekerResponseType.SEEK_DONE: {
                this.seekerSeekDone(data as { result: number, fileSize: bigint; });
                break;
            }
            case SeekerResponseType.BUFFER_COPIED: {
                console.log(" buffer copioed")
            }
        }
    }

    public readPacket(ptr: bigint, size: number)  {
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

        this.seekerEventer.sendEvent(SeekerRequestType.SEEK, {offset: Number(offset), urlChange: this.url});
        const results = this.seekerEventer.lockUntilEvent(SeekerResponseType.SEEK_DONE);

        const seekerState = results.result
        if (seekerState !== 0) {
            console.error("Seeker returned bad when tried to seek. Horrors!!!!");
        }
        //console.log("done offset to", offset);
        this.fileOffset = offset;

        return this.fileOffset;
    };

    private async initVideoStream(streamIndex: number, config: VideoDecoderConfigStruct) {
        if (!this.module) throw Error("No ffmpeg module. Whate te fyucj");

        const result = await VideoDecoder.isConfigSupported({
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

        if (!result.supported) return false;

        const worker = webDecoderWorker({ name: `I decode stream Video Stream #${streamIndex}` });
    }
}

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
