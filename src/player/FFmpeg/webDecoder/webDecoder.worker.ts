
// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877

import type { DecodeTemplate, SerializableStuff } from "@/player/atomicEventer/types";
import { AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorPrimarieToColorPrimative, AVColorTransferToTransferChar, AVPixelFormatToVideoFormat, AVSampleFormatToAudioFormat, AVSampleFormat } from "../advancedTypes/AVTypes";
import { readAudioFrame, readVideoFrame } from "../structReader";
import { CopyVideoPlanesToBuffer, decoderRequestTemplates, decoderResponseTemplates, WebDecoderRequestType, WebDecoderResponseType, type WebDecoderWorkerInit } from "./types";
import AtomicEventer from "@/player/atomicEventer/atomicEventer";
import type { Dictionary } from "@/core/types";
import canWasm64 from "../advancedTypes/isWasm64";
import type { WorkerAudioDataInit } from "@/player/Tracks/audio/audioTypes";

// eslint-disable-next-line no-var
declare var self: WorkerGlobalScope & typeof globalThis;


class WebDecoder {
    private moduleMemory: WebAssembly.Memory;
    private eventer: AtomicEventer<WebDecoderResponseType, WebDecoderRequestType, typeof decoderResponseTemplates, typeof decoderRequestTemplates>;
    private outputChannel: MessagePort;
    private isVideo: boolean;
    private decoder?: VideoDecoder | AudioDecoder;
    private isFirefox: boolean = false;
    private decoderConfig?: VideoDecoderConfig | AudioDecoderConfig;

    private is64Bit = canWasm64();
    private supportsAudioData: boolean = typeof AudioData !== 'undefined';


    constructor(config: WebDecoderWorkerInit) {
        this.moduleMemory = config.targetBuffer;
        this.eventer = new AtomicEventer(config.inputAtomicBuffers, decoderResponseTemplates, decoderRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));
        this.outputChannel = config.outputChannel;
        this.isVideo = config.isVideo;
        this.isFirefox = navigator.userAgent.match(/firefox|fxios/i) !== null;

        if (!config.justToCombineStuff) {
            try {
                if (this.isVideo) {
                    if (!config.videoConfig)
                        throw Error("Trying to init Video decoder without a video config");

                    this.decoder = this.initializeVideo(config.videoConfig);
                    this.decoderConfig = config.videoConfig;
                } else {
                    if (!config.audioConfig)
                        throw Error("Trying to init Audio decoder without an audio config");

                    this.decoder = this.initializeAudio(config.audioConfig);
                    this.decoderConfig = config.audioConfig;
                }
            } catch (_e) {
                this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: -1 });
                throw Error("Error while initing decoders");
            }
        }

        this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: 0 });
    }

    // If the ffmpeg wasm memory exceeds 4GB, we cant pass
    // the FFmpeg memory buffer directly to any constructor
    // and for it to copy out the data using planes.
    // Chrome seems to not like it
    private async handleEvents(type: WebDecoderRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case WebDecoderRequestType.DECODE_VIDEO: {
                this.submitVideoPacket(data as { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; packetPtr: number; });
                break;
            }
            case WebDecoderRequestType.DECODE_AUDIO: {
                this.submitAudioPacket(data as { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; packetPtr: number; });
                break;
            }
            case WebDecoderRequestType.REINIT: {
                console.debug("Web decoder reinit at", performance.now());
                if (!this.decoderConfig) {
                    return this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: 0 });
                }
                try {
                    this.decoder?.reset();
                    if (this.isVideo) {
                        this.decoder = this.initializeVideo(this.decoderConfig);
                    } else {
                        this.decoder = this.initializeAudio(this.decoderConfig as AudioDecoderConfig);
                    }
                    this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: 0 });
                } catch {
                    this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: -1 });
                }
                break;
            }
            case WebDecoderRequestType.RECONSTRUCT_VIDEO_FRAME: {
                const { ptr } = data as { ptr: number; };
                const video_frame = readVideoFrame(this.moduleMemory.buffer, ptr, this.is64Bit);

                let format = AVPixelFormatToVideoFormat(video_frame.format);

                const visible_width = video_frame.width - video_frame.crop_left - video_frame.crop_right;
                const visible_height = video_frame.height - video_frame.crop_top - video_frame.crop_bottom;

                let layout: PlaneLayout[] = [];
                let transfer: ArrayBufferLike[] = [];
                let targetBuffer: AllowSharedBufferSource = this.moduleMemory.buffer;
                if (this.isMemoryOver2Gib()) {
                    targetBuffer = new Uint8Array(video_frame.buffer_size);
                    layout = CopyVideoPlanesToBuffer(
                        format, video_frame.width, video_frame.height,
                        this.moduleMemory.buffer,
                        video_frame.src_data.map(s => Number(s)), video_frame.src_linesize,
                        targetBuffer as Uint8Array<ArrayBuffer>);
                    transfer = [targetBuffer.buffer];
                } else {
                    for (let i = 0; i < video_frame.src_data.length; i++) {
                        const data = Number(video_frame.src_data[i]);
                        if (data === 0) continue;
                        const linesize = Math.abs(video_frame.src_linesize[i]);
                    
                        layout.push({
                            offset: data,
                            stride: linesize
                        });
                    }
                }

                // @ts-ignore
                const frame = new VideoFrame(targetBuffer, {
                    codedHeight: video_frame.height,
                    codedWidth: video_frame.width,
                    colorSpace: {
                        fullRange: AVColorRangeToColorRange(video_frame.color_range),
                        matrix: AVColorSpaceToColorMatrixCoeff(video_frame.color_space) as VideoMatrixCoefficients,
                        primaries: AVColorPrimarieToColorPrimative(video_frame.color_primaries) as VideoColorPrimaries,
                        transfer: AVColorTransferToTransferChar(video_frame.color_transfer) as VideoTransferCharacteristics
                    },
                    displayHeight: visible_height,
                    displayWidth: visible_width,
                    duration: video_frame.dur_js,
                    format: format as VideoPixelFormat,
                    timestamp: video_frame.ts_js,
                    visibleRect: {
                        x: video_frame.crop_left,
                        y: video_frame.crop_top,
                        width: visible_width,
                        height: visible_height
                    },
                    layout,
                    transfer,
                });

                this.output(frame);

                this.eventer.sendEvent(WebDecoderResponseType.FREE_VIDEO_PTR, { ptr });
                break;
            }
            case WebDecoderRequestType.RECONSTRUCT_AUDIO_FRAME: {
                const { ptr } = data as { ptr: number; };
                const audio_frame = readAudioFrame(this.moduleMemory.buffer, ptr, this.is64Bit);

                const ffmpegMemory = new Uint8Array(this.moduleMemory.buffer);
                let dataData: Uint8Array<ArrayBuffer> = ffmpegMemory.slice(Number(audio_frame.src_data[0]), Number(audio_frame.src_data[0]) + audio_frame.linesize);

                let audio: AudioData | WorkerAudioDataInit;
                let transfer = [];
                // if (this.supportsAudioData) {
                //     audio = new AudioData({
                //         data: dataData,
                //         format: 'f32',
                //         numberOfChannels: audio_frame.channels,
                //         numberOfFrames: audio_frame.samples,
                //         sampleRate: audio_frame.sample_rate,
                //         timestamp: audio_frame.ts_js,
                //         transfer: [dataData.buffer]
                //     });
                //     transfer.push(audio);
                //     this.output(audio);
                // } else {

                audio = {
                    kind: "audioDataInit",

                    data: dataData,
                    format: 'f32',
                    numberOfChannels: audio_frame.channels,
                    numberOfFrames: audio_frame.samples,
                    sampleRate: audio_frame.sample_rate,
                    timestamp: audio_frame.ts_js,
                    transfer: [dataData.buffer]
                };

                transfer.push(dataData.buffer);
                this.outputChannel.postMessage(audio, transfer);
                // }

                this.eventer.sendEvent(WebDecoderResponseType.FREE_AUDIO_PTR, { ptr });
            }
        }
    }

    submitVideoPacket(info: { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; packetPtr: number; }) {
        const data = this.isMemoryOver2Gib() ? this.sliceMemory(info.ptr, info.ptr + info.size) : this.viewMemory(info.ptr, info.size);
        const encodedChunk = new EncodedVideoChunk({
            data: data,
            duration: info.duration,
            timestamp: info.timestamp,
            type: info.isKey ? "key" : "delta"
        });

        this.decoder?.decode(encodedChunk);

        this.eventer.sendEvent(WebDecoderResponseType.PACKET_PUBLISHED, { packetPtr: info.packetPtr });
    }

    submitAudioPacket(info: { ptr: number, size: number, duration: number, timestamp: number; packetPtr: number; }) {
        const data = this.isMemoryOver2Gib() ? this.sliceMemory(info.ptr, info.ptr + info.size) : this.viewMemory(info.ptr, info.size);
        const encodedChunk = new EncodedAudioChunk({
            data: data,
            duration: info.duration,
            timestamp: info.timestamp,
            type: "key"
        });

        this.decoder?.decode(encodedChunk);

        this.eventer.sendEvent(WebDecoderResponseType.PACKET_PUBLISHED, { packetPtr: info.packetPtr });
    }

    initializeVideo(config: VideoDecoderConfig): VideoDecoder {
        const decoder = new VideoDecoder({ error: this.error.bind(this), output: this.output.bind(this) });
        decoder.configure(config);

        return decoder;
    }

    initializeAudio(config: AudioDecoderConfig): AudioDecoder {
        const decoder = new AudioDecoder({ error: this.error.bind(this), output: this.output.bind(this) });
        decoder.configure(config);

        return decoder;
    }

    private async output(output: VideoFrame | AudioData) {
        // NOTE: Depending on how firefox feels like, it
        // might be beneficial to convert the VideoFrame
        // to RGBA or RGBX. Firefox DOES support
        // YUV and similar color formats but it will convert 
        // them to RGBX upon presentation. That is not much
        // of an issue but it tends to be very slow.
        // Better take the performance hit here

        if (this.isFirefox
            && output instanceof VideoFrame
            && output.format !== 'RGBA'
            && output.format !== 'RGBX') {

            let buffer = new Uint8Array(output.allocationSize({
                format: 'RGBA',
            }));
            await output.copyTo(buffer, { format: 'RGBA' });
            output = new VideoFrame(buffer, {
                codedWidth: output.codedWidth,
                codedHeight: output.codedHeight,
                format: 'RGBA',
                timestamp: output.timestamp,
                displayWidth: output.displayWidth,
                displayHeight: output.displayHeight,
                duration: output.duration ?? undefined,
            });
        }

        this.outputChannel.postMessage(output, [output]);
    }

    private error(error: DOMException) {
        console.error(`Decoder reported an error:`, error);
        if (this.decoder?.state !== "configured")
            this.eventer.sendEvent(WebDecoderResponseType.FATAL_ERROR, { result: -1 });
    }

    private sliceMemory(start: number, end: number): Uint8Array {
        const totalMemory = new Uint8Array(this.moduleMemory.buffer);
        return totalMemory.slice(start, end);
    }

    private viewMemory(start: number, lenght: number): Uint8Array {
        return new Uint8Array(this.moduleMemory.buffer, start, lenght);
    }

    private isMemoryOver2Gib(): boolean {
        return this.moduleMemory.buffer.byteLength >= 2147483648;
    }
}

// Its just gonna live here
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let webDecoder: WebDecoder;
self.onmessage = (data: MessageEvent<WebDecoderWorkerInit>) => {
    switch (data.data.type) {
        case "init":
            webDecoder = new WebDecoder(data.data);
            break;
    }
};
