
// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877

import type { DecodeTemplate, SerializableStuff } from "@/player/atomicEventer/types";
import { AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorPrimarieToColorPrimative, AVColorTransferToTransferChar, AVPixelFormatToVideoFormat } from "../advancedTypes/AVTypes";
import { readAudioFrame, readVideoFrame } from "../structReader";
import { copyVideoPlanesToBuffer, decoderRequestTemplates, decoderResponseTemplates, WebDecoderRequestType, WebDecoderResponseType, type WebDecoderWorkerInit } from "./types";
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
    private decoderConfig?: VideoDecoderConfig | AudioDecoderConfig;
    
    private is64Bit = canWasm64();
    private supportsAudioData: boolean = typeof AudioData !== 'undefined';
    private isFirefox: boolean = navigator.userAgent.match(/firefox|fxios/i) !== null;


    constructor(config: WebDecoderWorkerInit) {
        this.moduleMemory = config.targetBuffer;
        this.eventer = new AtomicEventer(config.inputAtomicBuffers, decoderResponseTemplates, decoderRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));
        this.outputChannel = config.outputChannel;
        this.isVideo = config.isVideo;

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

    private async handleEvents(type: WebDecoderRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case WebDecoderRequestType.DECODE_VIDEO: {
                this.submitVideoPacket(data as { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; packetPtr: number; streamIndex: number; });
                break;
            }
            case WebDecoderRequestType.DECODE_AUDIO: {
                this.submitAudioPacket(data as { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; packetPtr: number; streamIndex: number;});
                break;
            }
            case WebDecoderRequestType.REINIT: {
                console.debug("Web decoder reinit at", performance.now());
                if (!this.decoderConfig) {
                    return this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: 0 });
                }
                try {
                    this.decoder?.close();
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
                const videoFrame = readVideoFrame(this.moduleMemory.buffer, ptr, this.is64Bit);

                const format = AVPixelFormatToVideoFormat(videoFrame.format);

                const visibleWidth = videoFrame.width - videoFrame.crop_left - videoFrame.crop_right;
                const visibleHeight = videoFrame.height - videoFrame.crop_top - videoFrame.crop_bottom;

                let layout: PlaneLayout[] = [];
                let transfer: ArrayBufferLike[] = [];
                let targetBuffer: AllowSharedBufferSource = this.moduleMemory.buffer;

                if (this.isFirefox || this.isMemoryOver2Gib()) {
                    targetBuffer = new Uint8Array(videoFrame.buffer_size);
                    layout = copyVideoPlanesToBuffer(
                        format, videoFrame.width, videoFrame.height,
                        this.moduleMemory.buffer,
                        videoFrame.src_data.map(s => Number(s)), videoFrame.src_linesize,
                        targetBuffer as Uint8Array<ArrayBuffer>);
                    transfer = [targetBuffer.buffer];
                } else {
                    for (let i = 0; i < videoFrame.src_data.length; i++) {
                        const data = Number(videoFrame.src_data[i]);
                        if (data === 0) continue;
                        const linesize = Math.abs(videoFrame.src_linesize[i]);
                    
                        layout.push({
                            offset: data,
                            stride: linesize
                        });
                    }
                }

                // @ts-ignore transfer is in fact, valid
                const frame = new VideoFrame(targetBuffer, {
                    codedHeight: videoFrame.height,
                    codedWidth: videoFrame.width,
                    colorSpace: {
                        fullRange: AVColorRangeToColorRange(videoFrame.color_range),
                        matrix: AVColorSpaceToColorMatrixCoeff(videoFrame.color_space) as VideoMatrixCoefficients,
                        primaries: AVColorPrimarieToColorPrimative(videoFrame.color_primaries) as VideoColorPrimaries,
                        transfer: AVColorTransferToTransferChar(videoFrame.color_transfer) as VideoTransferCharacteristics
                    },
                    displayHeight: visibleHeight,
                    displayWidth: visibleWidth,
                    duration: videoFrame.dur_js,
                    format: format as VideoPixelFormat,
                    timestamp: videoFrame.ts_js,
                    visibleRect: {
                        x: videoFrame.crop_left,
                        y: videoFrame.crop_top,
                        width: visibleWidth,
                        height: visibleHeight
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
                const audioFrame = readAudioFrame(this.moduleMemory.buffer, ptr, this.is64Bit);
                
                const dataData: Float32Array<ArrayBuffer>[] = [];
                for (let ch = 0; ch < audioFrame.channels; ch++) {
                    const ptr = Number(audioFrame.src_data[ch]);
                    const stuff = this.sliceMemory(ptr, ptr + audioFrame.linesize);
                    dataData.push(new Float32Array(stuff.buffer));
                }

                const audio: WorkerAudioDataInit = {
                    kind: "audioDataInit",

                    data: dataData,
                    format: 'f32',
                    numberOfChannels: audioFrame.channels,
                    numberOfFrames: audioFrame.samples,
                    sampleRate: audioFrame.sample_rate,
                    timestamp: audioFrame.ts_js,
                    transfer: dataData.map(d => d.buffer)
                };

                // @ts-ignore yeeah transfer is ok
                this.outputChannel.postMessage(audio, audio.transfer);
                this.eventer.sendEvent(WebDecoderResponseType.FREE_AUDIO_PTR, { ptr });
            }
        }
    }

    submitVideoPacket(info: { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; packetPtr: number; streamIndex: number; }) {
        const data = this.isMemoryOver2Gib() ? this.sliceMemory(info.ptr, info.ptr + info.size) : this.viewMemory(info.ptr, info.size);
        const encodedChunk = new EncodedVideoChunk({
            data: data,
            duration: info.duration,
            timestamp: info.timestamp,
            type: info.isKey ? "key" : "delta"
        });

        this.decoder?.decode(encodedChunk);

        this.eventer.sendEvent(WebDecoderResponseType.PACKET_PUBLISHED, { packetPtr: info.packetPtr, streamIndex: info.streamIndex });
    }

    submitAudioPacket(info: { ptr: number, size: number, duration: number, timestamp: number; packetPtr: number;  streamIndex: number;}) {
        const data = this.isMemoryOver2Gib() ? this.sliceMemory(info.ptr, info.ptr + info.size) : this.viewMemory(info.ptr, info.size);
        const encodedChunk = new EncodedAudioChunk({
            data: data,
            duration: info.duration,
            timestamp: info.timestamp,
            type: "key"
        });

        this.decoder?.decode(encodedChunk);

        this.eventer.sendEvent(WebDecoderResponseType.PACKET_PUBLISHED, { packetPtr: info.packetPtr, streamIndex: info.streamIndex});
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
        // to RGBA. Firefox DOES support
        // YUV and similar color formats but it will convert 
        // them to RGBA upon presentation. That is not much
        // of an issue but it tends to be very slow.
        // Better take the performance hit here

        if (this.isFirefox
            && output instanceof VideoFrame
            && output.format !== 'RGBA') {

            const buffer = new Uint8Array(output.allocationSize({
                format: 'RGBA',
            }));
            await output.copyTo(buffer, { format: 'RGBA' });
            const newOutput = new VideoFrame(buffer, {
                codedWidth: output.codedWidth,
                codedHeight: output.codedHeight,
                format: 'RGBA',
                timestamp: output.timestamp,
                displayWidth: output.displayWidth,
                displayHeight: output.displayHeight,
                duration: output.duration ?? undefined,
            });
            output.close();
            output = newOutput;
        }

        this.outputChannel.postMessage(output, [output]);
    }

    private error(error: DOMException) {
        console.error(`Decoder reported an error:`, error);
        if (this.decoder?.state !== "configured")
            this.eventer.sendEvent(WebDecoderResponseType.FATAL_ERROR, { result: -1 });
    }

    private sliceMemory(start: number, end: number): Uint8Array<ArrayBuffer> {
        const totalMemory = new Uint8Array(this.moduleMemory.buffer);
        return totalMemory.slice(start, end);
    }

    private viewMemory(start: number, lenght: number): Uint8Array<ArrayBuffer> {
        return new Uint8Array<ArrayBuffer>(this.moduleMemory.buffer, start, lenght);
    }

    /** Checks if the ffmpeg module memory is over 2GiB.
     *  If its over 2GiB then chrome is unable to use the
     *  SharedArrayBuffer directly and we will have to
     *  manually slice the frame out in order to put it
     *  in a VideoFrame
     */
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
