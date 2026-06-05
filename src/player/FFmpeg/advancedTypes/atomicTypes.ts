import { emptyRequest, iByteConst, uIntConst, type SerializableEventMap } from "@/player/atomicEventer/types";

export enum FFmpegRequestEvent {
    REQUEST_DATA,
    SEEK,
}

export enum FFmpegResponseEvent {
    INIT_STATUS,
    REQUEST_STATUS,
    SEEK_STATUS,
}

export const ffmpegRequestTemplate = {
    [FFmpegRequestEvent.REQUEST_DATA]: emptyRequest,
    [FFmpegRequestEvent.SEEK]: {
        time: uIntConst
    },
} as const satisfies SerializableEventMap<FFmpegRequestEvent>;

export const ffmpegResponseTemplate = {
    [FFmpegResponseEvent.INIT_STATUS]: {
        status: iByteConst
    },
    [FFmpegResponseEvent.REQUEST_STATUS]: {
        status: iByteConst
    },
    [FFmpegResponseEvent.SEEK_STATUS]: {
        status: iByteConst
    },
} as const satisfies SerializableEventMap<FFmpegResponseEvent>;
