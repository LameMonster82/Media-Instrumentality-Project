import { emptyRequest, iBigNumConst, iByteConst, stringConst, uBigNumConst, uByteConst, uIntConst, type AtomicEventerBuffers, type EventDataMap, type SerializableEventMap } from "../atomicEventer/types";

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
        offset: uIntConst,
        urlChange: stringConst
    },
    [SeekerRequestType.REQUEST_DATA]: {
        size: uIntConst,
        ptr: uBigNumConst,
        offset: uBigNumConst
    },
    [SeekerRequestType.DESTROY]: emptyRequest
} as const satisfies SerializableEventMap<SeekerRequestType>;

export const seekerResponseTemplates = {
    [SeekerResponseType.SEEK_DONE]: {
        result: iByteConst,
        fileSize: iBigNumConst,
    },
    [SeekerResponseType.BUFFER_COPIED]: {
        written: iBigNumConst,
    }
} as const satisfies SerializableEventMap<SeekerResponseType>;

export interface SeekableWorkerInit {
    type: "init",
    url: string,
    targetBuffer: SharedArrayBuffer,
    atomicBuffers: AtomicEventerBuffers,
    fetchBufferSize: number;
}