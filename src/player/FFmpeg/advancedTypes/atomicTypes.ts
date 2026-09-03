import { boolConst, emptyRequest, floatConst, uBigNumConst, type SerializableEventMap } from "@/player/atomicEventer/types";

export enum FFmpegRequestEvent {
    REQUEST_DATA,
    SEEK,
}

export enum FFmpegResponseEvent {
    INIT_STATUS,
    REQUEST_STATUS,
    SET_STREAM_DONE,
    SEEK_STATUS,
    END_OF_FILE
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
        status: floatConst,
        packetType: floatConst
    },
    [FFmpegResponseEvent.SEEK_STATUS]: {
        status: floatConst
    },
    [FFmpegResponseEvent.SET_STREAM_DONE]: emptyRequest,
    [FFmpegResponseEvent.END_OF_FILE]: emptyRequest
} as const satisfies SerializableEventMap<FFmpegResponseEvent>;
