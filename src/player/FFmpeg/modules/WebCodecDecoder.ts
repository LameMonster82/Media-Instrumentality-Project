/// <reference lib="webworker" />
import type { WorkerAudioData } from "../Tracks/audio/audioTypes";
import type { VideoFrameBufferInitZeroCopy, WorkerVideoFrame, WorkerVideoFrameImageBitmap } from "../Tracks/video/videoTypes";
import type { WebAudioDecoderMessage, WebDecoderGeneralMessage, WebVideoDecoderMessage, WorkerRequestAnswered } from "../types";

declare var self: DedicatedWorkerGlobalScope;

let decoder: AudioDecoder | VideoDecoder | null = null;
let decoderType: "video" | "audio" | null = null;
let config: VideoDecoderConfig | AudioDecoderConfig | undefined = undefined;
let streamIndex = -1;
const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
let target: DedicatedWorkerGlobalScope | MessagePort = self;

self.onmessage = async (event: MessageEvent<WebVideoDecoderMessage | WebAudioDecoderMessage>) => {
    try {
        switch (event.data.kind) {
            case 'reinit':
            case 'init':
                event.data.config ??= config;
                initDecoder(event.data, event.data.kind === 'reinit');
                self.postMessage({ kind: 'initialized' } as WebDecoderGeneralMessage);
                break;

            case 'decode':
                if (!decoder || !event.data.chunk) {
                    throw new Error('Decoder not initialized or missing chunk');
                }
                streamIndex = event.data.streamIndex;
                if (event.data.decoderType === "video") {
                    const encodedChunk = new EncodedVideoChunk(event.data.chunk);
                    decoder.decode(encodedChunk);
                } else if (event.data.decoderType === "audio") {
                    const encodedChunk = new EncodedAudioChunk(event.data.chunk);
                    decoder.decode(encodedChunk);
                }
                SendQueueMessage();
                target.postMessage({ kind: "requestAnswered", status: true } as WorkerRequestAnswered);
                break;

            case 'flush':
                decoder?.flush();
                self.postMessage({ kind: 'flushed' } as WebDecoderGeneralMessage);
                break;

            case 'close':
                decoder?.close();
                decoder = null;
                self.postMessage({ kind: 'closed' } as WebDecoderGeneralMessage);
                break;
        }
    } catch (error) {
        // @ts-ignore
        self.postMessage({ kind: 'error', error: error.message });
    }
};

function initDecoder(message: WebVideoDecoderMessage | WebAudioDecoderMessage, reinit: boolean = false) {
    if (!reinit) {
        decoderType = message.decoderType;
        target = message.postDataTo ?? self;
    }

    const callbacks = {
        output: async (frame: VideoFrame | AudioData) => {
            SendQueueMessage();
            let postMessage: WorkerVideoFrame | WorkerVideoFrameImageBitmap | WorkerAudioData;
            if (decoderType === "video") {
                frame = frame as VideoFrame;
                if (isFirefox) {
                    const frameInit: VideoFrameBufferInit = {
                        codedHeight: frame.codedHeight,
                        codedWidth: frame.codedWidth,
                        displayHeight: frame.displayHeight,
                        displayWidth: frame.displayWidth,
                        duration: frame.duration ?? undefined,
                        format: "RGBX",
                        timestamp: frame.timestamp,
                        visibleRect: frame.visibleRect ?? undefined,
                    };

                    const imageBitmap = await createImageBitmap(frame);
                    frame.close();

                    postMessage = {
                        kind: "FrameBitmapConstructor",
                        streamIndex: streamIndex,
                        imageBitmap: imageBitmap,
                        videoInfo: frameInit,
                        transferable: [imageBitmap]
                    };
                } else {
                    postMessage = {
                        kind: "videoFrame",
                        streamIndex: streamIndex,
                        videoFrame: frame,
                        transferable: [frame]
                    };
                }
            } else if (decoderType === "audio") {
                frame = frame as AudioData;
                postMessage = {
                    kind: "audioData",
                    streamIndex: streamIndex,
                    audioData: frame,
                    transferable: [frame]
                };
            } else {
                return;
            }

            target.postMessage(postMessage, postMessage.transferable ?? []);
        },
        error: (error: Error) => {
            self.postMessage({ kind: 'error', error: error.message });
        }
    };

    decoder = message.decoderType === 'video'
        ? new VideoDecoder({ ...message.config, ...callbacks })
        : new AudioDecoder({ ...message.config, ...callbacks });

    if(!reinit)
        config = message.config;

    decoder.ondequeue = () => {
        SendQueueMessage();
    }

    // @ts-ignore
    decoder.configure(config);
}

function SendQueueMessage() {
    // Technically the decoder should never be null when
    // calling this function but there may be a race condition
    // where when the decoder is closed,
    // it sends a last dequeue message but for some reason gets
    // nulled out of nowhere
    if (decoderType == null || decoder == null) return;
    const postMessage: WebDecoderQueueMessage = {
        kind: "decoderQueueSize",
        type: decoderType,
        streamIndex: streamIndex,
        queue: decoder.decodeQueueSize
    };

    target.postMessage(postMessage);
}

async function FrameToRGBFrame(frame: VideoFrame): Promise<VideoFrame> {
    if (frame.format == "RGBA" || frame.format == "RGBX")
        return frame;

    let buffer = new Uint8Array(frame.allocationSize({ format: "RGBX" }));
    let planes: PlaneLayout[];
    if (frame.format == "BGRA" || frame.format == "BGRX") {
        planes = await frame.copyTo(buffer);
        // let planeX = planes[0];
        // planes[0] = planes[2];
        // planes[2] = planeX;

        for (let i = 0; i < buffer.length; i += 4) {
            const temp = buffer[i];
            buffer[i] = buffer[i + 2]; // R ← B
            buffer[i + 2] = temp;     // B ← R
        }
    } else {
        planes = await frame.copyTo(buffer, { format: "RGBX" });
    }

    const frameInit: VideoFrameBufferInitZeroCopy = {
        codedHeight: frame.codedHeight,
        codedWidth: frame.codedWidth,
        colorSpace: frame.colorSpace,
        displayHeight: frame.displayHeight,
        displayWidth: frame.displayWidth,
        duration: frame.duration ?? undefined,
        format: "RGBX",
        layout: planes,
        timestamp: frame.timestamp,
        visibleRect: frame.visibleRect ?? undefined,
        transfer: [buffer.buffer]
    };
    frame.close();
    return new VideoFrame(buffer, frameInit);
}
