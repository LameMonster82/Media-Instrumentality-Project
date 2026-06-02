import { parseMetadata } from "@uswriting/exiftool";
import wasmUrl from '@6over3/zeroperl-ts/zeroperl.wasm';
import type { ExifTree, WorkerExifTags, WorkerRequestExif, WorkerRequestThumbnailBlob, WorkerSubmitThumbnailString } from "./types";

// eslint-disable-next-line no-var
declare var self: DedicatedWorkerGlobalScope;

/** @uswriting/exiftool detects if its in the browser by
 * checking if "window" and "document" exist however
 * those do not exists while running in a WebWorker.
 * exiftool works just fine in a WebWorker so idk
 */
// @ts-ignore check top
self.window = {};
// @ts-ignore check top
self.document = {};

const fetchFunc = () => {
    return fetch(wasmUrl);
};

async function extractExif(asset: { name: string; data: Uint8Array | Blob; }): Promise<WorkerExifTags> {

    const output = await parseMetadata(asset, {
        args: ["-a", "-all:all", "-trailer", "-j", "-G0", "-b"],
        transform: (data) => JSON.parse(data),
        fetch: fetchFunc,
    });

    const exifTree: ExifTree = {};
    for (const [key, val] of Object.entries(output.data[0])) {
        if (key === 'SourceFile')
            continue;

        const [group, tag] = key.split(':');
        if (exifTree[group] === undefined) {
            exifTree[group] = {
                name: group,
                tags: []
            };
        }

        exifTree[group].tags.push({
            name: tag,
            value: val as string | number | (string | number)[]
        });
    }

    return {
        kind: "exifTags",
        tree: exifTree
    };
}

async function extractExifThumbnail(asset: { name: string; data: Uint8Array | Blob; }): Promise<string | null> {
    const output = await parseMetadata(asset, {
        args: ["-thumbnailimage", "-b", "-j"],
        transform: (data) => JSON.parse(data),
        fetch: fetchFunc,
    });

    if (!output.success)
        return null;

    const thumb: string | undefined = output.data[0].ThumbnailImage;

    if (thumb === undefined)
        return null;
    return thumb;
}


self.onmessage = async (message: MessageEvent<WorkerRequestThumbnailBlob | WorkerRequestExif>) => {
    switch (message.data.kind) {
        case "thumbnailRequestBlob":
            self.postMessage({
                kind: "thumbnailDataString",
                data: await extractExifThumbnail({ name: message.data.name, data: message.data.blob })
            } as WorkerSubmitThumbnailString);
            break;
        case "exifRequest":
            self.postMessage(await extractExif({ name: message.data.name, data: message.data.blob }));
            break;
    }
};
