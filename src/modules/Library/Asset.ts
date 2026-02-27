import { type ThumnbnailDesc, type AssetDBFile, type Dictionary, AssetType, type AssetFile, type WorkerSubmitThumbnail, GetFolderPath, isCoverImage } from "../SomeTypes.js";
import { ExtractThumbnail } from "../Video/ExtractThumbnailWorker.js";
import { ffmpegDemuxers } from "../Video/SupportedMedia.js";
import { BrokenImageSVG } from "./ImageToSVG.js";


class MediaDB {
    private DB_NAME = "MediaGalleryDB";
    private DB_VERSION = 1;
    private STORE_NAME = "mediaFiles";
    private db: Promise<IDBDatabase>;

    constructor() {
        this.db = this.init();
    }

    async init(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = (event) => {
                // @ts-ignore
                const db: IDBDatabase = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    const store = db.createObjectStore(this.STORE_NAME, { keyPath: "filePath" });
                    store.createIndex("album", "album");
                    store.createIndex("fileType", "fileType");
                    store.createIndex("lastModified", "lastModified");
                    store.createIndex("createdAt", "createdAt");
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async UpdateFile(file: Asset, thumbnail?: ThumnbnailDesc, albums: string[] = ["Default"]) {
        const database = await this.db;
        const fileType = file.GetType();
        const size = file.handle.size;
        const lastModified = file.handle.lastModified;

        const tx = database.transaction(this.STORE_NAME, "readwrite");
        const store = tx.objectStore(this.STORE_NAME);

        const item: AssetDBFile = {
            filePath: file.handle.path,
            fileType,
            size,
            lastModified,
            album: albums,
            thumbnail: thumbnail ?? null,
            metadata: {
                // additional user metadata
            },
        };

        store.put(item);
        return new Promise<AssetDBFile>((resolve) => tx.oncomplete = () => resolve(item));
    }

    async GetByPath(filePath: string): Promise<AssetDBFile | null> {
        const database = await this.db;
        const tx = database.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        return new Promise((resolve) => {
            const request: IDBRequest<AssetDBFile> = store.get(filePath);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error("Could not get", filePath, "because", request.error);
                resolve(null);
            };
        });
    }

    async GetAll(): Promise<AssetDBFile[] | null> {
        const database = await this.db;
        const tx = database.transaction(this.STORE_NAME, "readonly");
        const store = tx.objectStore(this.STORE_NAME);
        return new Promise((resolve) => {
            const request: IDBRequest<AssetDBFile[]> = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error("Could not get all files because", request.error);
                resolve(null);
            };
        });
    }
}

export class Asset {
    public static loadedAssets: Dictionary<Asset> = {};
    public static imagesPerChunk: number = 50;
    public static imageSize: number = 200;
    public static database: MediaDB = new MediaDB();

    public static GetCount() {
        return Object.values(Asset.loadedAssets).filter(asset => asset.GetType() !== AssetType.UNKNOWN).length;
    }

    public static FilterAssets(filter: (file: Asset) => boolean): Asset[] {
        const foundStuff: Asset[] = [];
        for (let key in Asset.loadedAssets) {
            const data = Asset.loadedAssets[key]!;
            if (filter(data))
                foundStuff.push(data);
        }

        return foundStuff;
    }

    public static LoadImagesToCache(files: AssetFile[]) {
        for (const file of files) {
            Asset.loadedAssets[file.path] = new Asset(file);
        }
    }

    // Recursive file listing
    private static async *getFilesRecursively(entry: FileSystemDirectoryHandle | FileSystemFileHandle, currentPath: string): AsyncGenerator<Asset> {
        if (entry.kind === 'file') {
            const file = await entry.getFile();
            const asset = new Asset(Asset.FileToAssetFile(file));
            yield asset;
        } else if (entry.kind === 'directory') {
            for await (const [name, handle] of entry.entries()) {
                const newPath = currentPath ? `${currentPath}/${name}` : name;
                yield* Asset.getFilesRecursively(handle, newPath);
            }
        }
    }

    public static FileToAssetFile(file: File): AssetFile {
        return {
            name: file.name,
            path: file.webkitRelativePath,
            mimeType: file.type,
            lastModified: file.lastModified,
            url: URL.createObjectURL(file),
            size: file.size,
            file: file
        };
    }

    public static async GetType(path: string) {
        const demuxer = await ffmpegDemuxers;

    }

    public handle: AssetFile;
    public path: string;

    public width: number = -1;
    public height: number = -1;

    public thumbnailUrl: string | null = null;

    constructor(file: AssetFile) {
        this.handle = file;
        this.path = file.path;
    }

    public GetType(): AssetType {
        if (this.handle.mimeType.startsWith("video/") || this.handle.name.endsWith(".mkv"))
            return AssetType.VIDEO;

        if (this.handle.mimeType.startsWith("image/"))
            return AssetType.IMAGE;

        if (this.handle.mimeType.startsWith("audio/"))
            return AssetType.AUDIO;


        return AssetType.UNKNOWN;
    }

    public GetModifiedDate() {
        return this.handle.lastModified;
    }

    public GetUrl() {
        return this.handle.url;
    }

    public async GetThumbnailUrl() {
        if (this.thumbnailUrl) return this.thumbnailUrl;
        const blob = await this.GetThumbnailBlob();

        this.thumbnailUrl = blob ? URL.createObjectURL(blob) : BrokenImageSVG;
        return this.thumbnailUrl;
    }

    private async GetThumbnailBlob(): Promise<Blob | null> {
        let data = await Asset.database.GetByPath(this.handle.path) ?? await Asset.database.UpdateFile(this);

        if (!data.thumbnail) {
            const type = this.GetType();
            let thumbnail: WorkerSubmitThumbnail = await ExtractThumbnail(this.GetUrl());
            if (!thumbnail.image && type === AssetType.AUDIO) {
                const folderPath = GetFolderPath(this.handle.path);
                const availablePosters = Asset.FilterAssets(asset => {
                    const assetFolderPath = GetFolderPath(asset.handle.path);
                    return assetFolderPath === folderPath && isCoverImage(asset.handle.name);
                });

                for (const poster of availablePosters) {
                    const thumbnailOfIt = await poster.GetThumbnailBlob();
                    if (thumbnailOfIt) {
                        thumbnail.image = thumbnailOfIt;
                        thumbnail.width = poster.width;
                        thumbnail.height = poster.height;
                        break;
                    }
                }
            } else if (!thumbnail.image) {
                return null;
            }
            Asset.database.UpdateFile(this, thumbnail);
            data.thumbnail = thumbnail;
        };
        this.width = data.thumbnail.width;
        this.height = data.thumbnail.height;

        return data.thumbnail.image;
    }

    private async getImageDimensions() {
        try {
            if (this.GetType() !== AssetType.IMAGE)
                throw new Error("Not an image");

            const imageBitmap = await createImageBitmap(await (await fetch(this.handle.url)).blob());
            const result = { width: imageBitmap.width, height: imageBitmap.height };
            imageBitmap.close();
            return result;
        } catch {
            console.log("Could not get image data from", this.path);
            return { width: Asset.imageSize, height: Asset.imageSize };
        }
    }
}
