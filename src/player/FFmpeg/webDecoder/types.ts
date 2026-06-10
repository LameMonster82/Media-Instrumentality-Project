import { boolConst, emptyRequest, floatConst, type AtomicEventerBuffers, type SerializableEventMap } from "@/player/atomicEventer/types";
import type { AudioDecoderConfigStruct, VideoDecoderConfigStruct } from "../structReader";

export enum WebDecoderRequestType {
    DECODE_VIDEO = 0,
    DECODE_AUDIO,
    REINIT
}

export enum WebDecoderResponseType {
    INIT_DONE = 0,
    FATAL_ERROR
}

export const decoderRequestTemplates = {
    [WebDecoderRequestType.DECODE_VIDEO]: {
        ptr: floatConst,
        size: floatConst,
        duration: floatConst,
        timestamp: floatConst,
        isKey: boolConst
    },
    [WebDecoderRequestType.DECODE_AUDIO]: {
        ptr: floatConst,
        size: floatConst,
        duration: floatConst,
        timestamp: floatConst,
    },
    [WebDecoderRequestType.REINIT]: emptyRequest
} as const satisfies SerializableEventMap<WebDecoderRequestType>;

export const decoderResponseTemplates = {
    [WebDecoderResponseType.INIT_DONE]: {
        result: floatConst,
    },
    [WebDecoderResponseType.FATAL_ERROR]: {
        result: floatConst
    }
} as const satisfies SerializableEventMap<WebDecoderResponseType>;

export interface WebDecoderWorkerInit {
    type: "init",
    isVideo: boolean,
    targetBuffer: WebAssembly.Memory,
    inputAtomicBuffers: AtomicEventerBuffers,
    videoConfig: VideoDecoderConfigStruct,
    audioConfig: AudioDecoderConfigStruct,
    outputChannel: MessagePort
}
