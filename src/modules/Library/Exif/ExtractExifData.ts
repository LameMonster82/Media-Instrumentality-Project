import type { Asset } from "../Asset";
import { libexifUrl, PromiseRes, type ExifTree, type WorkerExifTags, type WorkerRequestExif } from "@/modules/SomeTypes";
import { dispose, parseMetadata } from '@uswriting/exiftool';


const { promise: exifDocs, resolve } = PromiseRes<Document>();

fetch("Resources/ExifTags.xml").then(async (e) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(await e.text(), 'application/xml');
    resolve(doc);
});

export async function ExtractExif(asset: Asset): Promise<WorkerExifTags> {
    const output = await parseMetadata({ name: asset.GetName(), data: await asset.AsBlob() }, {
        args: ["-a", "-all:all", "-trailer", "-j", "-G0", "-b"],
        transform: (data) => JSON.parse(data),
        fetch: (...args) => {
            return fetch("node_modules/@6over3/zeroperl-ts/dist/esm/zeroperl.wasm");
        },
    });

    const doc = await exifDocs;

    let exifTree: ExifTree = {};
    for (const [key, val] of Object.entries(output.data[0])) {
        if (key === 'SourceFile')
            continue;

        const [group, tag] = key.split(':');
        if (exifTree[group] == undefined) {
            exifTree[group] = {
                name: doc.getElementById(group)?.querySelector("desc[lang='en']")?.textContent ?? group,
                tags: []
            };
        }

        exifTree[group].tags.push({
            name: doc.querySelector(`tag[name=${tag}]`)?.querySelector("desc[lang='en']")?.textContent ?? tag,
            value: val as string | number | (string | number)[]
        });
    }

    return {
        kind: "exifTags",
        tree: exifTree
    };


    return new Promise<WorkerExifTags>(async resolve => {
        const exifWorker = new Worker(libexifUrl, { type: 'module', name: "I Extract Exif Data for " + asset.GetUrl() });

        const extraImages = ExtractEmbeddedJpegs(asset.GetUrl());

        exifWorker.onerror = (e) => {
            console.error('Worker error:', e);
        };

        exifWorker.onmessage = async (data: MessageEvent<WorkerExifTags>) => {
            switch (data.data.kind) {
                case "exifTags": {
                    data.data.xmpImages.push(...await extraImages);
                    resolve(data.data);
                    exifWorker.postMessage({ kind: "shutdown" });
                    exifWorker.terminate();
                }
            }
        };

        exifWorker.postMessage({
            kind: "exifRequest",
            url: asset.GetUrl(),
            bufferSize: 32768
        } as WorkerRequestExif);
    });
}

function ExtractXMP(buffer: Uint8Array) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

    const start = text.indexOf("<x:xmpmeta");
    const end = text.indexOf("</x:xmpmeta>");

    if (start !== -1 && end !== -1) {
        const xmp = text.slice(start, end + "</x:xmpmeta>".length);
        return xmp;
    } else {
        return null;
    }
}

function ParseXmpItems(xmpString: string): XMPImage[] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmpString, "application/xml");
    const items = Array.from(xmlDoc.getElementsByTagName("Container:Item"));

    return items.map((item, index) => ({
        mime: item.getAttribute("Item:Mime") ?? `Unknown ${index}`,
        length: parseInt(item.getAttribute("Item:Length") ?? "0", 10),
        semantic: item.getAttribute("Item:Semantic") ?? `Unknown ${index}`,
    }));
}

function FindEOIMarker(uint8arr: Uint8Array) {
    for (let i = 0; i < uint8arr.length - 1; i++) {
        if (uint8arr[i] === 0xFF && uint8arr[i + 1] === 0xD9) {
            return i;
        }
    }
    return -1;
}

async function ExtractEmbeddedJpegs(file: string) {
    const buffer = new Uint8Array(await (await fetch(file)).arrayBuffer());

    // 1. Extract XMP
    const xmp = ExtractXMP(buffer);
    if (!xmp) {
        console.warn("No XMP block found");
        return [];
    }

    const items = ParseXmpItems(xmp);
    const primaryEnd = FindEOIMarker(buffer);
    if (primaryEnd === -1) {
        console.warn("No JPEG EOI found");
        return [];
    }

    let offset = primaryEnd + 2;

    for (const item of items) {
        if (item.length > 0) {
            const chunk = buffer.subarray(offset, offset + item.length);

            item.rawData = chunk;
            offset += item.length;
        }
    }
    console.log(items);
    return items;
}
