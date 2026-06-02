export enum WebDecoderEventTypes {
    DECODE,
    FLUSH,
    CLOSE,
}

export enum WebDecoderFrameKeyType {
    KEY,
    DELTA
}

export type WebDecoderDecode = {
    type: WebDecoderFrameKeyType,
    timestamp: number,
    duration: number,
    dataPtr: bigint;
};

export type WebDecoderEvents =
    { type: WebDecoderEventTypes.DECODE, data: WebDecoderDecode; } |
    { type: WebDecoderEventTypes.FLUSH, data: null; } |
    { type: WebDecoderEventTypes.CLOSE, data: null; };
