import type { Dictionary, WorkerAssSubtitle, WorkerBitmapSubtitle, WorkerEmbedFont } from "@/modules/SomeTypes";
import { ImageToDataURL } from "../QuickDrawCanvas";
import { workerState } from "./State";

export function submit_subtitle_config(data: { stream_index: number, duration: number; header_ptr: number, header_size: number; }) {
    let assHeader: string | undefined;
    if (data.header_size > 0) {
        const buffer = workerState.Read(data.header_ptr, data.header_ptr + data.header_size);
        if (buffer.length > 13 &&
            buffer.subarray(0, 13).toString() === "91,83,99,114,105,112,116,32,73,110,102,111,93") { // check if its ASS

            assHeader = new TextDecoder().decode(buffer);
        } else {
            console.warn("Unknown subtitle header for stream ", data.stream_index, "here is header", buffer);
        }
    }

    const areThereOtherStreams = Object.values(workerState.streams).some(stream => stream.type === "subtitle" && stream.isUsed);
    workerState.streams[data.stream_index] = {
        type: "subtitle",
        index: data.stream_index,
        isSupported: false, // No native decoder
        isUsed: !areThereOtherStreams,
        duration: data.duration,
        assHeader: assHeader,
        metadata: {}
    };
};

export function submit_subtitle_bitmap(data: { stream_index: number, data: number, data_size: number, x: number, y: number, width: number, height: number, ts_js: bigint, start_ms: bigint, end_ms: bigint; })  {
    const buffer = workerState.Read(data.data, data.data + data.data_size);

    const imageData = new ImageData(new Uint8ClampedArray(buffer), data.width, data.height);
    createImageBitmap(imageData).then((imageBitmap) => {
        ImageToDataURL(imageBitmap).then((blob) => {
            const postData: WorkerBitmapSubtitle = {
                kind: "subtitleBitmap",
                streamIndex: data.stream_index,
                image: blob,
                x: data.x,
                y: data.y,
                width: data.width,
                height: data.height,
                timestamp: Number(data.ts_js),
                start_time: Number(data.start_ms),
                end_time: Number(data.end_ms),
                transferable: [blob]
            };
            self.postMessage(postData);
        });
    });
};


export function submit_subtitle_ass(data: { stream_index: number, dialog: string, start_time: bigint, end_time: bigint; })  {
    workerState.assSubtitleMap[data.stream_index] ??= [];
    let frameNum = data.dialog.substring(0, data.dialog.indexOf(','));
    if (workerState.assSubtitleMap[data.stream_index].includes(frameNum))
        return;
    workerState.assSubtitleMap[data.stream_index].push(frameNum);

    const start = new Date(Number(data.start_time) / 1000).toISOString().split('T')[1].split('Z')[0];
    const end = new Date(Number(data.end_time) / 1000).toISOString().split('T')[1].split('Z')[0];


    let dialog = data.dialog.substring(data.dialog.indexOf(',') + 1);
    let layer = dialog.substring(0, dialog.indexOf(','));
    let restOfIt = dialog.substring(dialog.indexOf(',') + 1);


    dialog = `Dialogue: ${layer},${start},${end},${restOfIt}`;
    const postData: WorkerAssSubtitle = {
        kind: "subtitleAss",
        streamIndex: data.stream_index,
        dialog: dialog
    };
    self.postMessage(postData);
};

export function submit_attachment(metadata: Dictionary<string>, data: number, data_size: number) {
    const buffer = workerState.Read(data, data + data_size);
    const filename = metadata["filename"];
    if (filename && (filename.toLowerCase().endsWith(".ttf") || filename.toLowerCase().endsWith(".otf"))) {
        let fontFamily: string | null = null;
        try {
            fontFamily = extractFontNameFromBuffer (buffer.buffer);
        } catch (e) {
            fontFamily = null;
        }
        const postFont: WorkerEmbedFont = {
            kind: "fontFile",
            fileName: filename,
            fontFamily: fontFamily,
            data: buffer,
            transferable: [buffer.buffer]
        };

        self.postMessage(postFont, postFont.transferable ?? []);
    } else {
        console.warn("Not a recognized font:", metadata, buffer);
    }

};

function extractFontNameFromBuffer(buffer: ArrayBuffer) {
    const data = new DataView(buffer);

    // Offset 4 bytes: number of tables
    const numTables = data.getUint16(4);

    // Search for 'name' table in the table directory (starts at byte 12)
    let nameTableOffset = null;
    let nameTableLength = null;
    for (let i = 0; i < numTables; i++) {
        const entryOffset = 12 + i * 16;
        const tag = String.fromCharCode(
            data.getUint8(entryOffset),
            data.getUint8(entryOffset + 1),
            data.getUint8(entryOffset + 2),
            data.getUint8(entryOffset + 3)
        );
        if (tag === 'name') {
            nameTableOffset = data.getUint32(entryOffset + 8);
            nameTableLength = data.getUint32(entryOffset + 12);
            break;
        }
    }

    if (nameTableOffset === null) throw new Error('No name table found');

    const nameCount = data.getUint16(nameTableOffset + 2);
    const stringOffset = nameTableOffset + data.getUint16(nameTableOffset + 4);

    for (let i = 0; i < nameCount; i++) {
        const recOffset = nameTableOffset + 6 + i * 12;

        const nameID = data.getUint16(recOffset + 6);
        const length = data.getUint16(recOffset + 8);
        const offset = data.getUint16(recOffset + 10);

        // We prefer platform ID 3 (Windows), encoding 1 (Unicode BMP)
        const platformID = data.getUint16(recOffset);
        const encodingID = data.getUint16(recOffset + 2);
        const languageID = data.getUint16(recOffset + 4);

        if ((nameID === 1 || nameID === 4) && platformID === 3 && encodingID === 1) {
            const strBytes = new Uint8Array(buffer, stringOffset + offset, length);
            const decoder = new TextDecoder('utf-16be');
            const name = decoder.decode(strBytes);
            return name;
        }
    }

    throw new Error('No usable font name found');
}