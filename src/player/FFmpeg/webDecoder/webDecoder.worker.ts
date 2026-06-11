
// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877

import type { DecodeTemplate, SerializableStuff } from "@/player/atomicEventer/types";
import { AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorPrimarieToColorPrimative, AVColorTransferToTransferChar } from "../advancedTypes/AVTypes";
import type { AudioDecoderConfigStruct, VideoDecoderConfigStruct } from "../structReader";
import { decoderRequestTemplates, decoderResponseTemplates, WebDecoderRequestType, WebDecoderResponseType, type WebDecoderWorkerInit } from "./types";
import AtomicEventer from "@/player/atomicEventer/atomicEventer";
import type { Dictionary } from "@/core/types";

// eslint-disable-next-line no-var
declare var self: WorkerGlobalScope & typeof globalThis;


class WebDecoder {
    private moduleMemory: WebAssembly.Memory;
    private eventer: AtomicEventer<WebDecoderResponseType, WebDecoderRequestType, typeof decoderResponseTemplates, typeof decoderRequestTemplates>;
    private outputChannel: MessagePort;
    private isVideo: boolean;
    private decoder: VideoDecoder | AudioDecoder;


    constructor(config: WebDecoderWorkerInit) {
        this.moduleMemory = config.targetBuffer;
        this.eventer = new AtomicEventer(config.inputAtomicBuffers, decoderResponseTemplates, decoderRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));
        this.outputChannel = config.outputChannel;
        this.isVideo = config.isVideo;

        try {
            if (this.isVideo) {
                if (!config.videoConfig)
                    throw Error("Trying to init Video decoder without a video config");
                
                this.decoder = this.initializeVideo(config.videoConfig);
            } else {
                if (!config.audioConfig)
                    throw Error("Trying to init Audio decoder without an audio config");
                
                this.decoder = this.initializeAudio(config.audioConfig);
            }
        } catch (_e) {
            this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: -1 });
            throw Error("Error while initing decoders");
        }

        this.eventer.sendEvent(WebDecoderResponseType.INIT_DONE, { result: 0 });
    }

    private handleEvents(type: WebDecoderRequestType, data: DecodeTemplate<Dictionary<SerializableStuff>>) {
        switch (type) {
            case WebDecoderRequestType.DECODE_VIDEO: {
                this.submitVideoPacket(data as { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; });
                break;
            }
            case WebDecoderRequestType.DECODE_AUDIO: {
                this.submitAudioPacket(data as { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; });
                break;
            }
            case WebDecoderRequestType.REINIT: {
                console.log("ughhhhhhhhhhhhhhhhhh");
            }
        }
    }

    submitVideoPacket(info: { ptr: number, size: number, duration: number, timestamp: number, isKey: boolean; }) {
        const encodedChunk = new EncodedVideoChunk({
            data: this.viewMemory(info.ptr, info.ptr + info.size),
            duration: info.duration,
            timestamp: info.timestamp,
            type: info.isKey ? "key" : "delta"
        });

        this.decoder.decode(encodedChunk);
    }

    submitAudioPacket(info: { ptr: number, size: number, duration: number, timestamp: number; }) {
        const encodedChunk = new EncodedAudioChunk({
            data: this.viewMemory(info.ptr, info.ptr + info.size),
            duration: info.duration,
            timestamp: info.timestamp,
            type: "key"
        });

        this.decoder.decode(encodedChunk);
    }

    initializeVideo(config: VideoDecoderConfigStruct): VideoDecoder {
        const decoder = new VideoDecoder({ error: this.error.bind(this), output: this.output.bind(this) });

        decoder.configure({
            codec: config.codec,
            codedWidth: config.coded_width,
            codedHeight: config.coded_height,
            colorSpace: {
                fullRange: AVColorRangeToColorRange(config.color_range),
                matrix: AVColorSpaceToColorMatrixCoeff(config.color_space) as VideoMatrixCoefficients,
                primaries: AVColorPrimarieToColorPrimative(config.color_primaries) as VideoColorPrimaries,
                transfer: AVColorTransferToTransferChar(config.color_trc) as VideoTransferCharacteristics
            },
            description: this.sliceMemory(config.description, config.description + config.description_size),
        });

        return decoder;
    }

    initializeAudio(config: AudioDecoderConfigStruct): AudioDecoder {
        const decoder = new AudioDecoder({ error: this.error.bind(this), output: this.output.bind(this) });

        decoder.configure({
            codec: config.codec,
            numberOfChannels: config.num_channels,
            sampleRate: config.sample_rate,
            description: this.sliceMemory(config.description, config.description + config.description_size),
        });

        return decoder;
    }

    private output(output: VideoFrame | AudioData) {
        // NOTE: Depending on how firefox feels like, it
        // might be beneficial to convert the VideoFrame
        // to an ImageBitmap or similar. Firefox DOES support
        // YUV and similar color formats but sometimes it ends
        // up converting them to an RGBX one. That is not much
        // of an issue but it tends to be very slow.
        // If this happens with WebGPU too then we better
        // get the performance penatly here at a decoder stage
        // instead at the presentation stage
        this.outputChannel.postMessage(output, [output]);
    }

    private error(error: DOMException) {
        console.error(`Decoder reported an error:`, error);
    }

    private sliceMemory(start: number, end: number): Uint8Array {
        const totalMemory = new Uint8Array(this.moduleMemory.buffer);
        return totalMemory.slice(start, end);
    }

    private viewMemory(start: number, end: number): Uint8Array {
        return new Uint8Array(this.moduleMemory.buffer, start, end);
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
