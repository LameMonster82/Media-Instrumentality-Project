export enum AssetType {
    IMAGE,
    VIDEO,
    AUDIO,
    TEXT,
    FOLDER,
    UNKNOWN
}

export interface AssetFile {
    readonly name: string,
    readonly path: string,
    readonly mimeType: string,
    readonly lastModified: number,
    readonly url: string;
    readonly size: number;
    readonly file?: File;
}

export type ThumnbnailDesc = {
    image: Blob | null,
    width: number,
    height: number,
};

export type AssetDBFile = {
    filePath: string,
    fileType: AssetType,
    size: number,
    lastModified: number,
    album: string[],
    thumbnail: ThumnbnailDesc | null,
    metadata: {
        // additional user metadata
    },
};
