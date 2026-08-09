
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
    private isFirefox: boolean = false;


    constructor(config: WebDecoderWorkerInit) {
        this.moduleMemory = config.targetBuffer;
        this.eventer = new AtomicEventer(config.inputAtomicBuffers, decoderResponseTemplates, decoderRequestTemplates);
        this.eventer.receiveEvent(this.handleEvents.bind(this));
        this.outputChannel = config.outputChannel;
        this.isVideo = config.isVideo;
        this.isFirefox = navigator.userAgent.match(/firefox|fxios/i) !== null;

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
            data: this.viewMemory(info.ptr, info.size),
            duration: info.duration,
            timestamp: info.timestamp,
            type: info.isKey ? "key" : "delta"
        });

        this.decoder.decode(encodedChunk);

        this.eventer.sendEvent(WebDecoderResponseType.PACKET_PUBLISHED, {});
    }

    submitAudioPacket(info: { ptr: number, size: number, duration: number, timestamp: number; }) {
        const encodedChunk = new EncodedAudioChunk({
            data: this.viewMemory(info.ptr, info.size),
            duration: info.duration,
            timestamp: info.timestamp,
            type: "key"
        });

        this.decoder.decode(encodedChunk);

        this.eventer.sendEvent(WebDecoderResponseType.PACKET_PUBLISHED, {});
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
            })
        }

        this.outputChannel.postMessage(output, [output]);
    }

    private error(error: DOMException) {
        console.error(`Decoder reported an error:`, error);
    }

    private sliceMemory(start: number, end: number): Uint8Array {
        const totalMemory = new Uint8Array(this.moduleMemory.buffer);
        return totalMemory.slice(start, end);
    }

    private viewMemory(start: number, lenght: number): Uint8Array {
        return new Uint8Array(this.moduleMemory.buffer, start, lenght);
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
