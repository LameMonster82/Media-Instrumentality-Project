import { emptyRequest, stringConst, uBigNumConst, uByteConst, uIntConst, type SerializableEventMap } from "../atomicEventer/types";

export enum SeekerRequestType {
    SEEK = 0,
    REQUEST_DATA,
    DESTROY
}

export enum SeekerResponseType {
    INIT_DONE = 0,
    SEEK_DONE,
    BUFFER_COPIED
}

export const seekerRequestTemplates: SerializableEventMap<SeekerRequestType> = {
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

export const seekerResponseTemplates: SerializableEventMap<SeekerResponseType> = {
    [SeekerResponseType.INIT_DONE]: {
        result: uByteConst,
        fileSize: uBigNumConst,
    },
    [SeekerResponseType.SEEK_DONE]: {
        result: uByteConst,
    },
    [SeekerResponseType.BUFFER_COPIED]: {
        written: uBigNumConst,
    }
} as const satisfies SerializableEventMap<SeekerResponseType>;
