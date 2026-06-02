import type { WorkerPostMessage } from "@/core/types";

export type ExifTree = Record<string, { name: string, tags: { name: string, value: string | number | (string | number)[]; }[]; }>;

export interface WorkerExifTags extends WorkerPostMessage {
    readonly kind: "exifTags";
    readonly tree: ExifTree
}

export interface WorkerRequestThumbnailBlob extends WorkerPostMessage {
    readonly kind: "thumbnailRequestBlob";
    readonly name: string;
    readonly blob: Blob;
}

export interface WorkerRequestExif extends WorkerPostMessage {
    readonly kind: "exifRequest";
    readonly name: string;
    readonly blob: Blob;
}

export interface WorkerSubmitThumbnailString extends WorkerPostMessage {
    readonly kind: "thumbnailDataString";
    readonly data: string | null;
}

export interface WorkerSubmitThumbnail extends WorkerPostMessage {
    readonly kind: "thumbnailData";
    image: Blob | null;
    width: number;
    height: number;
}
