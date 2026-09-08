
// Default type of `self` is `WorkerGlobalScope & typeof globalThis`
// https://github.com/microsoft/TypeScript/issues/14877

import { AVColorRangeToColorRange, AVColorSpaceToColorMatrixCoeff, AVColorPrimarieToColorPrimative, AVColorTransferToTransferChar, AVPixelFormatToVideoFormat } from "../advancedTypes/AVTypes";
import { MediaType, readAudioFrame, readVideoFrame } from "../structReader";
import { copyVideoPlanesToBuffer, type AllWebDecoderWorkerMessages, type WebDecoderWorkerInit, type WorkerDecodePacket } from "./types";
import type { WorkerAudioDataInit } from "@/player/Tracks/audio/audioTypes";
import QuickPostmessage from "@/player/quickMessage/QuickMessage";

// eslint-disable-next-line no-var
declare var self: WorkerGlobalScope & typeof globalThis;


class WebDecoder {
    private moduleMemory: WebAssembly.Memory;
    private eventer: QuickPostmessage<AllWebDecoderWorkerMessages>;
    private outputChannel: MessagePort;
    private isVideo: boolean;
    private decoder?: VideoDecoder | AudioDecoder;
    private decoderConfig?: VideoDecoderConfig | AudioDecoderConfig;

    private is64Bit: boolean;
    private supportsAudioData: boolean = typeof AudioData !== 'undefined';
    private isFirefox: boolean = navigator.userAgent.match(/firefox|fxios/i) !== null;


    constructor(config: WebDecoderWorkerInit) {
        this.is64Bit = config.is64Bit;
        this.moduleMemory = config.targetBuffer;
        this.eventer = new QuickPostmessage(self, self);

        this.eventer.addEventListener("decodePacket", (data) => {
            if (data.type === MediaType.RESULT_VIDEO) this.submitVideoPacket(data);
            if (data.type === MediaType.RESULT_AUDIO) this.submitAudioPacket(data);
        });
        this.eventer.addEventListener("reconstruct", (data) => {
            if (data.type === MediaType.RESULT_VIDEO) this.reconstructVideoFrame(data.ptr);
            if (data.type === MediaType.RESULT_AUDIO) this.reconstructAudioFrame(data.ptr);
        });
        this.eventer.addEventListener("reinit", this.reinit.bind(this));

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
                this.eventer.postMessage({ kind: "initStatus", status: -1 });
                throw Error("Error while initing decoders");
            }
        }

        this.eventer.postMessage({ kind: "initStatus", status: 0 });
    }

    private reinit() {
        console.debug("Web decoder reinit at", performance.now());
        if (!this.decoderConfig) {
            return this.eventer.postMessage({ kind: "initStatus", status: 0 });
        }
        try {
            this.decoder?.close();
            if (this.isVideo) {
                this.decoder = this.initializeVideo(this.decoderConfig);
            } else {
                this.decoder = this.initializeAudio(this.decoderConfig as AudioDecoderConfig);
            }
            this.eventer.postMessage({ kind: "initStatus", status: 0 });
        } catch {
            this.eventer.postMessage({ kind: "initStatus", status: 0 });
        }
    }

    private reconstructVideoFrame(ptr: number | bigint) {
        const videoFrame = readVideoFrame(this.moduleMemory.buffer, Number(ptr), this.is64Bit);

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

        this.eventer.postMessage({ kind: "freePtr", type: MediaType.RESULT_VIDEO, ptr });
    }

    private reconstructAudioFrame(ptr: number | bigint) {
        const audioFrame = readAudioFrame(this.moduleMemory.buffer, Number(ptr), this.is64Bit);

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
        this.eventer.postMessage({ kind: "freePtr", type: MediaType.RESULT_AUDIO, ptr });
    }

    submitVideoPacket(info: WorkerDecodePacket) {
        const data = this.isMemoryOver2Gib() ? this.sliceMemory(Number(info.ptr), Number(info.ptr) + info.size) : this.viewMemory(Number(info.ptr), info.size);
        const encodedChunk = new EncodedVideoChunk({
            data: data,
            duration: info.duration,
            timestamp: info.timestamp,
            type: info.isKey ? "key" : "delta"
        });

        this.decoder?.decode(encodedChunk);

        this.eventer.postMessage({ kind: "freePtr", type: MediaType.RESULT_PACKET, ptr: info.ptr });
    }

    submitAudioPacket(info: WorkerDecodePacket) {
        const data = this.isMemoryOver2Gib() ? this.sliceMemory(Number(info.ptr), Number(info.ptr) + info.size) : this.viewMemory(Number(info.ptr), info.size);
        const encodedChunk = new EncodedAudioChunk({
            data: data,
            duration: info.duration,
            timestamp: info.timestamp,
            type: "key"
        });

        this.decoder?.decode(encodedChunk);

        this.eventer.postMessage({ kind: "freePtr", type: MediaType.RESULT_PACKET, ptr: info.ptr });
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

        if (output instanceof AudioData) {
            const finalMessage = copyFromAudioData(output);
            output.close();

            this.outputChannel.postMessage(finalMessage, finalMessage.transfer as Transferable[]);
            return;
        }

        this.outputChannel.postMessage(output, [output]);
    }

    private error(error: DOMException) {
        console.error(`Decoder reported an error:`, error);
        if (this.decoder?.state !== "configured")
            this.eventer.postEvent("fatalError");
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

function copyFromAudioData(frame: AudioData): WorkerAudioDataInit {
    const channels = frame.numberOfChannels;
    const frames = frame.numberOfFrames;

    const output: Float32Array<ArrayBuffer>[] = [];
    for (let ch = 0; ch < channels; ch++) {
        const byteLength = frame.allocationSize({ planeIndex: ch, format: "f32-planar" });
        const buffer = new Float32Array(byteLength / 4);
        frame.copyTo(buffer, { planeIndex: ch, format: "f32-planar" });
        output.push(buffer);
    }

    return {
        kind: "audioDataInit",
        data: output,
        format: "f32",
        numberOfChannels: channels,
        numberOfFrames: frames,
        sampleRate: frame.sampleRate,
        timestamp: frame.timestamp,
        transfer: output.map(b => b.buffer),
    };
}

// Its just gonna live here
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let webDecoder: WebDecoder;
self.onmessage = (data: MessageEvent<WebDecoderWorkerInit>) => {
    switch (data.data.kind) {
        case "initDecoder":
            webDecoder = new WebDecoder(data.data);
            break;
    }
};
