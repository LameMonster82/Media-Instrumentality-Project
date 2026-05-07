import type { Asset } from "../Asset";
import { getMimeType, PromiseRes, type WorkerExifTags, type WorkerRequestExif, type WorkerRequestThumbnailBlob, type WorkerSubmitThumbnail, type WorkerSubmitThumbnailString } from "@/modules/SomeTypes";
import exifXml from "@Resources/ExifTags.xml";

const workerUrl = new URL('src/modules/Library/Exif/ExifWorker.js', import.meta.url);
const docs = fetch(exifXml);
const parser = new DOMParser();

const { promise: docPromise, resolve: docResolve } = PromiseRes<Document>();
docs.then(async t => {
    const text = await t.text();
    const doc = parser.parseFromString(text, 'application/xml');
    docResolve(doc);
})



export async function ExtractExif(asset: Asset): Promise<WorkerExifTags> {
    const worker = new Worker(workerUrl, { type: 'module', name: "I run exiftools on your media" });

    const { promise, resolve } = PromiseRes<WorkerExifTags>();
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
        name: asset.GetName(),
        blob: await asset.AsBlob()
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

export async function ExtractExifThumbnail(asset: Asset): Promise<WorkerSubmitThumbnail | null> {
    const worker = new Worker(workerUrl, { type: 'module', name: "I use exiftools for a thumbnail on " + asset.GetName() });

    const { promise, resolve } = PromiseRes<WorkerSubmitThumbnailString>();
    worker.onmessage = (message: MessageEvent<WorkerSubmitThumbnailString>) => {
        switch (message.data.kind) {
            case "thumbnailDataString":
                resolve(message.data);
                break;
        }
    };

    worker.postMessage({
        kind: "thumbnailRequestBlob",
        name: asset.GetName(),
        blob: await asset.AsBlob()
    } as WorkerRequestThumbnailBlob);

    const thumb = (await promise).data;
    worker.terminate();
    if (thumb == null)
        return null;

    const mime = getMimeType(thumb);
    const fixed = thumb.replace("base64:", 'base64,');
    const src = `data:${mime};${fixed}`;

    const image = new Image();
    const { promise: imagePromise, resolve: imageResolve } = PromiseRes<WorkerSubmitThumbnail | null>();
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
