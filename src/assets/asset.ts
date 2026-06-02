import type { Dictionary } from "@/core/types";
import { AssetType, type AssetDBFile, type AssetFile, type ThumnbnailDesc } from "./types";
import { brokenImageSVG } from "../components/ImageToSVG";

class MediaDB {
    private dbName = "MediaGalleryDB";
    private dbVersion = 1;
    private storeName = "mediaFiles";

    private db: Promise<IDBDatabase>;

    constructor() {
        this.db = this.init();
    }

    async init(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (event) => {
                const db: IDBDatabase = event.target!.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: "filePath" });
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

    async updateFile(file: Asset, thumbnail?: ThumnbnailDesc, albums: string[] = ["Default"]) {
        const database = await this.db;
        const fileType = file.getType();
        const size = file.handle.size;
        const lastModified = file.handle.lastModified;

        const tx = database.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);

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

    async getByPath(filePath: string): Promise<AssetDBFile | null> {
        const database = await this.db;
        const tx = database.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
        return new Promise((resolve) => {
            const request: IDBRequest<AssetDBFile> = store.get(filePath);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error("Could not get", filePath, "because", request.error);
                resolve(null);
            };
        });
    }

    async getAll(): Promise<AssetDBFile[] | null> {
        const database = await this.db;
        const tx = database.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
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

export default class Asset {
    public static loadedAssets: Dictionary<Asset> = {};
    public static imagesPerChunk: number = 50;
    public static imageSize: number = 200;
    public static database: MediaDB = new MediaDB();

    public static getCount() {
        return Object.values(Asset.loadedAssets).filter(asset => asset.getType() !== AssetType.UNKNOWN).length;
    }

    public static filterAssets(filter: (file: Asset) => boolean): Asset[] {
        const foundStuff: Asset[] = [];
        for (const key in Asset.loadedAssets) {
            const data = Asset.loadedAssets[key]!;
            if (filter(data))
                foundStuff.push(data);
        }

        return foundStuff;
    }

    public static loadImagesToCache(files: AssetFile[]) {
        for (const file of files) {
            Asset.loadedAssets[file.path] = new Asset(file);
        }
    }

    // Recursive file listing
    private static async *getFilesRecursively(entry: FileSystemDirectoryHandle | FileSystemFileHandle, currentPath: string): AsyncGenerator<Asset> {
        if (entry.kind === 'file') {
            const file = await entry.getFile();
            const asset = new Asset(Asset.fileToAssetFile(file));
            yield asset;
        } else if (entry.kind === 'directory') {
            for await (const [name, handle] of entry.entries()) {
                const newPath = currentPath ? `${currentPath}/${name}` : name;
                yield* Asset.getFilesRecursively(handle, newPath);
            }
        }
    }

    public static fileToAssetFile(file: File): AssetFile {
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

    public static async getType(path: string) {
        //const demuxer = await ffmpegDemuxers;
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

    public getType(): AssetType {
        if (this.handle.mimeType.startsWith("video/") || this.handle.name.endsWith(".mkv"))
            return AssetType.VIDEO;

        if (this.handle.mimeType.startsWith("image/"))
            return AssetType.IMAGE;

        if (this.handle.mimeType.startsWith("audio/"))
            return AssetType.AUDIO;

        if (this.handle.mimeType.startsWith("text/"))
            return AssetType.TEXT;


        return AssetType.UNKNOWN;
    }

    public getModifiedDate() {
        return this.handle.lastModified;
    }

    public getUrl() {
        return this.handle.url;
    }

    public getName() {
        return this.path.split("/").pop() ?? "";
    }

    public async asBlob() {
        const response = await fetch(this.getUrl());
        return await response.blob();
    }

    public async getThumbnailUrl() {
        if (this.thumbnailUrl) return this.thumbnailUrl;
        const blob = await this.getThumbnailBlob();

        this.thumbnailUrl = blob ? URL.createObjectURL(blob) : brokenImageSVG;
        return this.thumbnailUrl;
    }

    private async getThumbnailBlob(): Promise<Blob | null> {
        const data = await Asset.database.getByPath(this.handle.path) ?? await Asset.database.updateFile(this);

        if (!data.thumbnail) {
            const type = this.getType();
            if (type === AssetType.TEXT) {
                return null;
            }

            let thumbnail = await ExtractExifThumbnail(this);
            if(!thumbnail)
                thumbnail = await ExtractFFmpegThumbnail(this.getUrl());

            if (!thumbnail.image && type === AssetType.AUDIO) {
                const folderPath = getFolderPath(this.handle.path);
                const availablePosters = Asset.filterAssets(asset => {
                    const assetFolderPath = getFolderPath(asset.handle.path);
                    return assetFolderPath === folderPath && isCoverImage(asset.handle.name);
                });

                for (const poster of availablePosters) {
                    const thumbnailOfIt = await poster.getThumbnailBlob();
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
            Asset.database.updateFile(this, thumbnail);
            data.thumbnail = thumbnail;
        };
        this.width = data.thumbnail.width;
        this.height = data.thumbnail.height;

        return data.thumbnail.image;
    }

    private async getImageDimensions() {
        try {
            if (this.getType() !== AssetType.IMAGE)
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

function getFolderPath(filePath: string): string {
    const lastSlashIndex = filePath.lastIndexOf('/');
    if (lastSlashIndex === -1) return ''; // No folder path found
    return filePath.substring(0, lastSlashIndex);
}

function isCoverImage(fileName: string): boolean {
    switch (fileName.toLowerCase()) {
        case 'cover.jpg':
        case 'cover.jpeg':
        case 'cover.png':
        case 'folder.jpg':
        case 'folder.jpeg':
        case 'folder.png':
        case 'front.jpg':
        case 'front.jpeg':
        case 'front.png':
        case 'album.jpg':
        case 'album.jpeg':
        case 'album.png':
        case 'artwork.jpg':
        case 'artwork.jpeg':
        case 'artwork.png':
        case 'thumb.jpg':
        case 'thumb.jpeg':
        case 'thumb.png':
        case 'back.jpg':
        case 'back.jpeg':
        case 'back.png':
        case 'disc.jpg':
        case 'disc.jpeg':
        case 'disc.png':
        case 'inlay.jpg':
        case 'inlay.jpeg':
        case 'inlay.png':
        case 'artist.jpg':
        case 'artist.jpeg':
        case 'artist.png':
            return true;
        default:
            return false;
    }
}
