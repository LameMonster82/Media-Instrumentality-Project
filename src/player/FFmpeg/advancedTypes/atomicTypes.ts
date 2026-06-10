import { emptyRequest, floatConst, type SerializableEventMap } from "@/player/atomicEventer/types";

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
        time: floatConst
    },
} as const satisfies SerializableEventMap<FFmpegRequestEvent>;

export const ffmpegResponseTemplate = {
    [FFmpegResponseEvent.INIT_STATUS]: {
        status: floatConst
    },
    [FFmpegResponseEvent.REQUEST_STATUS]: {
        status: floatConst
    },
    [FFmpegResponseEvent.SEEK_STATUS]: {
        status: floatConst
    },
} as const satisfies SerializableEventMap<FFmpegResponseEvent>;
