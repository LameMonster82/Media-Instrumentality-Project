import { emptyRequest, floatConst, iBigNumConst, stringConst, uBigNumConst, type AtomicEventerBuffers, type SerializableEventMap } from "../atomicEventer/types";

export enum SeekerRequestType {
    SEEK = 0,
    REQUEST_DATA,
    DESTROY
}

export enum SeekerResponseType {
    SEEK_DONE,
    BUFFER_COPIED
}

export const seekerRequestTemplates = {
    [SeekerRequestType.SEEK]: {
        offset: floatConst,
        urlChange: stringConst
    },
    [SeekerRequestType.REQUEST_DATA]: {
        size: floatConst,
        ptr: uBigNumConst,
        offset: uBigNumConst
    },
    [SeekerRequestType.DESTROY]: emptyRequest
} as const satisfies SerializableEventMap<SeekerRequestType>;

export const seekerResponseTemplates = {
    [SeekerResponseType.SEEK_DONE]: {
        result: floatConst,
        fileSize: iBigNumConst,
    },
    [SeekerResponseType.BUFFER_COPIED]: {
        written: iBigNumConst,
    }
} as const satisfies SerializableEventMap<SeekerResponseType>;

export interface UrlSeekableWorkerInit {
    type: "init",
    url: string,
    targetBuffer: WebAssembly.Memory,
    atomicBuffers: AtomicEventerBuffers,
    fetchBufferSize: number;
}

export interface FileSeekableWorkerInit {
    type: "init",
    file: File,
    targetBuffer: WebAssembly.Memory,
    atomicBuffers: AtomicEventerBuffers,
}
