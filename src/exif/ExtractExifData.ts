import { promiseRes } from "@/core/utils";
import exifXml from "@Resources/ExifTags.xml";
import type { WorkerExifTags, WorkerRequestExif, WorkerRequestThumbnailBlob, WorkerSubmitThumbnail, WorkerSubmitThumbnailString } from "./types";
import type Asset from "@/assets/asset";

const workerUrl = new URL('src/modules/Library/Exif/ExifWorker.js', import.meta.url);
const docs = fetch(exifXml);
const parser = new DOMParser();

const { promise: docPromise, resolve: docResolve } = promiseRes<Document>();
docs.then(async t => {
    const text = await t.text();
    const doc = parser.parseFromString(text, 'application/xml');
    docResolve(doc);
})



export async function extractExif(asset: Asset): Promise<WorkerExifTags> {
    const worker = new Worker(workerUrl, { type: 'module', name: "I run exiftools on your media" });

    const { promise, resolve } = promiseRes<WorkerExifTags>();
    worker.onmessage = (message: MessageEvent<WorkerExifTags>) => {
        switch (message.data.kind) {
            case "exifTags":
                resolve(message.data);
                worker.terminate();
                break;
        }
    };

    worker.postMessage({
        kind: "exifRequest",
        name: asset.getName(),
        blob: await asset.asBlob()
    } as WorkerRequestExif);

    const data = await promise;
    const doc = await docPromise;

    for (const key of Object.keys(data.tree)) {
        data.tree[key].name = doc.getElementById(key)?.querySelector("desc[lang='en']")?.textContent ?? key;

        for (const tag of data.tree[key].tags) {
            tag.name = doc.querySelector(`tag[name=${tag.name}]`)?.querySelector("desc[lang='en']")?.textContent ?? tag.name;
        }
    }

    return data;
}

export async function extractExifThumbnail(asset: Asset): Promise<WorkerSubmitThumbnail | null> {
    const worker = new Worker(workerUrl, { type: 'module', name: `I use exiftools for a thumbnail on ${asset.getName()}` });

    const { promise, resolve } = promiseRes<WorkerSubmitThumbnailString>();
    worker.onmessage = (message: MessageEvent<WorkerSubmitThumbnailString>) => {
        switch (message.data.kind) {
            case "thumbnailDataString":
                resolve(message.data);
                break;
        }
    };

    worker.postMessage({
        kind: "thumbnailRequestBlob",
        name: asset.getName(),
        blob: await asset.asBlob()
    } as WorkerRequestThumbnailBlob);

    const thumb = (await promise).data;
    worker.terminate();
    if (thumb === null)
        return null;

    const mime = getMimeType(thumb);
    const fixed = thumb.replace("base64:", 'base64,');
    const src = `data:${mime};${fixed}`;

    const image = new Image();
    const { promise: imagePromise, resolve: imageResolve } = promiseRes<WorkerSubmitThumbnail | null>();
    image.onload = async () => {
        imageResolve({
            kind: "thumbnailData",
            width: image.naturalWidth,
            height: image.naturalHeight,
            image: await (await fetch(src)).blob()
        });
    };
    image.onerror = () => {
        imageResolve(null);
    };

    image.src = src;
    return await imagePromise;
}

function getMimeType(base64: string) {
    if (base64.startsWith('base64:/9j/')) return 'image/jpeg';
    if (base64.startsWith('base64:iVBORw0KGgo')) return 'image/png';
    if (base64.startsWith('base64:R0lGOD')) return 'image/gif';
    if (base64.startsWith('base64:UklGR')) return 'image/webp';
    return undefined; // fallback
}
