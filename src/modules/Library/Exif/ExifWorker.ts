
import type { WorkerExifTags, ExifTree, WorkerRequestThumbnailBlob, WorkerRequestExif, WorkerSubmitThumbnailString } from "@/modules/SomeTypes";
import { parseMetadata } from "@uswriting/exiftool";
import wasmUrl from '@6over3/zeroperl-ts/zeroperl.wasm';

declare var self: DedicatedWorkerGlobalScope;
// @ts-ignore
self.window = {};
// @ts-ignore
self.document = {};

const fetchFunc = (...args: unknown[]) => {
    return fetch(wasmUrl);
};

async function ExtractExif(asset: { name: string; data: Uint8Array | Blob; }): Promise<WorkerExifTags> {

    const output = await parseMetadata(asset, {
        args: ["-a", "-all:all", "-trailer", "-j", "-G0", "-b"],
        transform: (data) => JSON.parse(data),
        fetch: fetchFunc,
    });

    let exifTree: ExifTree = {};
    for (const [key, val] of Object.entries(output.data[0])) {
        if (key === 'SourceFile')
            continue;

        const [group, tag] = key.split(':');
        if (exifTree[group] == undefined) {
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

async function ExtractExifThumbnail(asset: { name: string; data: Uint8Array | Blob; }): Promise<string | null> {
    const output = await parseMetadata(asset, {
        args: ["-thumbnailimage", "-b", "-j"],
        transform: (data) => JSON.parse(data),
        fetch: fetchFunc,
    });

    if (!output.success)
        return null;

    const thumb: string | undefined = output.data[0].ThumbnailImage;

    if (thumb == undefined)
        return null;
    return thumb;
}


self.onmessage = async (message: MessageEvent<WorkerRequestThumbnailBlob | WorkerRequestExif>) => {
    switch (message.data.kind) {
        case "thumbnailRequestBlob":
            self.postMessage({
                kind: "thumbnailDataString",
                data: await ExtractExifThumbnail({ name: message.data.name, data: message.data.blob })
            } as WorkerSubmitThumbnailString);
            break;
        case "exifRequest":
            self.postMessage(await ExtractExif({ name: message.data.name, data: message.data.blob }));
            break;
    }
};
