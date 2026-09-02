import { boolConst, emptyRequest, floatConst, type AtomicEventerBuffers, type SerializableEventMap } from "@/player/atomicEventer/types";
import type { AudioDecoderConfigStruct, VideoDecoderConfigStruct } from "../structReader";
import type { ExtendedVideoFormats } from "../advancedTypes/AVTypes";

export enum WebDecoderRequestType {
    DECODE_VIDEO = 0,
    DECODE_AUDIO,
    REINIT,
    RECONSTRUCT_VIDEO_FRAME,
    RECONSTRUCT_AUDIO_FRAME
}

export enum WebDecoderResponseType {
    INIT_DONE = 0,
    FATAL_ERROR,
    PACKET_PUBLISHED,
    FREE_VIDEO_PTR,
    FREE_AUDIO_PTR
}

export const decoderRequestTemplates = {
    [WebDecoderRequestType.DECODE_VIDEO]: {
        ptr: floatConst,
        size: floatConst,
        duration: floatConst,
        timestamp: floatConst,
        isKey: boolConst,
        packetPtr: floatConst
    },
    [WebDecoderRequestType.DECODE_AUDIO]: {
        ptr: floatConst,
        size: floatConst,
        duration: floatConst,
        timestamp: floatConst,
        packetPtr: floatConst
    },
    [WebDecoderRequestType.REINIT]: emptyRequest,
    [WebDecoderRequestType.RECONSTRUCT_VIDEO_FRAME]: {
        ptr: floatConst
    },
    [WebDecoderRequestType.RECONSTRUCT_AUDIO_FRAME]: {
        ptr: floatConst
    }
} as const satisfies SerializableEventMap<WebDecoderRequestType>;

export const decoderResponseTemplates = {
    [WebDecoderResponseType.INIT_DONE]: {
        result: floatConst,
    },
    [WebDecoderResponseType.FATAL_ERROR]: {
        result: floatConst
    },
    [WebDecoderResponseType.PACKET_PUBLISHED]: {
        packetPtr: floatConst
    },
    [WebDecoderResponseType.FREE_VIDEO_PTR]: {
        ptr: floatConst
    },
    [WebDecoderResponseType.FREE_AUDIO_PTR]: {
        ptr: floatConst
    }
} as const satisfies SerializableEventMap<WebDecoderResponseType>;

export interface WebDecoderWorkerInit {
    type: "init",
    isVideo: boolean,
    justToCombineStuff: boolean,
    targetBuffer: WebAssembly.Memory,
    inputAtomicBuffers: AtomicEventerBuffers,
    videoConfig: VideoDecoderConfig | undefined,
    audioConfig: AudioDecoderConfig | undefined,
    outputChannel: MessagePort;
}

interface PlaneDescriptor {
    width: number;
    height: number;
    bytesPerElement: number;
}

/**
 * Returns the plane layout for the given format and image dimensions.
 * For 10/12‑bit formats, bytesPerElement is 2 (16‑bit little‑endian).
 */
function getPlaneDescriptors(
    format: ExtendedVideoFormats,
    width: number,
    height: number
): PlaneDescriptor[] {
    const is10or12 = /P10|P12/.test(format);
    const bpp = is10or12 ? 2 : 1; // bytes per element for planar formats

    // Helper for subsampled width/height (use ceil to be safe)
    const halfW = Math.ceil(width / 2);
    const halfH = Math.ceil(height / 2);

    switch (format) {
        // Packed 32‑bit RGB
        case "BGRA":
        case "BGRX":
        case "RGBA":
        case "RGBX":
            return [{ width, height, bytesPerElement: 4 }];

        // I420 (YUV 4:2:0) – 3 planes
        case "I420":
        case "I420P10":
        case "I420P12":
            return [
                { width, height, bytesPerElement: bpp },          // Y
                { width: halfW, height: halfH, bytesPerElement: bpp }, // U
                { width: halfW, height: halfH, bytesPerElement: bpp }, // V
            ];

        // I422 (YUV 4:2:2) – 3 planes
        case "I422":
        case "I422P10":
        case "I422P12":
            return [
                { width, height, bytesPerElement: bpp },          // Y
                { width: halfW, height, bytesPerElement: bpp },   // U
                { width: halfW, height, bytesPerElement: bpp },   // V
            ];

        // I444 (YUV 4:4:4) – 3 planes
        case "I444":
        case "I444P10":
        case "I444P12":
            return [
                { width, height, bytesPerElement: bpp },          // Y
                { width, height, bytesPerElement: bpp },          // U
                { width, height, bytesPerElement: bpp },          // V
            ];

        // NV12 – 2 planes: Y, and interleaved UV (each row has width bytes)
        case "NV12":
            return [
                { width, height, bytesPerElement: 1 },            // Y
                { width, height: halfH, bytesPerElement: 1 },     // UV (width bytes per row)
            ];

        // I420A – 4 planes: Y, U, V, Alpha
        case "I420A":
        case "I420AP10":
        case "I420AP12":
            return [
                { width, height, bytesPerElement: bpp },          // Y
                { width: halfW, height: halfH, bytesPerElement: bpp }, // U
                { width: halfW, height: halfH, bytesPerElement: bpp }, // V
                { width, height, bytesPerElement: bpp },          // A
            ];

        // I422A – 4 planes: Y, U, V, Alpha
        case "I422A":
        case "I422AP10":
        case "I422AP12":
            return [
                { width, height, bytesPerElement: bpp },          // Y
                { width: halfW, height, bytesPerElement: bpp },   // U
                { width: halfW, height, bytesPerElement: bpp },   // V
                { width, height, bytesPerElement: bpp },          // A
            ];

        // I444A – 4 planes: Y, U, V, Alpha
        case "I444A":
        case "I444AP10":
        case "I444AP12":
            return [
                { width, height, bytesPerElement: bpp },          // Y
                { width, height, bytesPerElement: bpp },          // U
                { width, height, bytesPerElement: bpp },          // V
                { width, height, bytesPerElement: bpp },          // A
            ];

        default:
            throw new Error(`Unsupported format: ${format}`);
    }
}

export function copyVideoPlanesToBuffer(format: ExtendedVideoFormats, width: number, height: number, src: ArrayBuffer, srcData: number[], srcLinesize: number[], dst: Uint8Array<ArrayBuffer>) {
    const planes = getPlaneDescriptors(format, width, height);

    let offset = 0;
    const layout: PlaneLayout[] = [];
    const srcU8 = new Uint8Array(src); // Created once outside the loop

    for (let i = 0; i < planes.length; i++) {
        const plane = planes[i];
        const srcPtr = srcData[i];
        const stride = Math.abs(srcLinesize[i]);
        
        const planeSize = stride * plane.height;
        dst.set(srcU8.subarray(srcPtr, srcPtr + planeSize), offset);
        layout.push({
            offset,
            stride
        });
        offset += planeSize;
    }

    return layout;
}