import type { WorkerRequestAnswered, WebVideoDecoderMessage, WebAudioDecoderMessage } from "@/modules/SomeTypes";
import { workerState } from "./State";

export function submit_raw_packet(packetRaw: {
    index: number,
    flags: number;
    timestamp: number,
    duration: number,
    dataPtr: number,
    dataSize: number;
}): number {
    const stream = workerState.streams[packetRaw.index];
    const decoderWorker = workerState.webDecodersWorkers[packetRaw.index];
    if (!stream || !decoderWorker) {
        self.postMessage({ kind: "requestAnswered", status: false } as WorkerRequestAnswered);
        return -1;
    }

    const packetData = workerState.Read(packetRaw.dataPtr, packetRaw.dataPtr + packetRaw.dataSize);


    if (stream.type === "video") {
        const encodedChunk = {
            data: packetData,
            duration: packetRaw.duration,
            timestamp: packetRaw.timestamp,
            type: (((packetRaw.flags || 0) & 1) ? "key" : "delta") as "key" | "delta",
            transfer: [packetData.buffer]
        };

        const postMessage: WebVideoDecoderMessage = {
            kind: "decode",
            decoderType: "video",
            chunk: encodedChunk,
            streamIndex: packetRaw.index,
            postDataTo: null,
            transferable: [packetData.buffer]
        };

        decoderWorker.worker.postMessage(postMessage, [packetData.buffer]);
    } else if (stream.type === "audio") {
        const encodedChunk = {
            data: packetData,
            duration: packetRaw.duration,
            timestamp: packetRaw.timestamp,
            type: "key" as "key",
            transfer: [packetData.buffer]
        };

        const postMessage: WebAudioDecoderMessage = {
            kind: "decode",
            decoderType: "audio",
            chunk: encodedChunk,
            streamIndex: packetRaw.index,
            postDataTo: null,
            transferable: [packetData.buffer]
        };

        decoderWorker.worker.postMessage(postMessage, [packetData.buffer]);
    }
    return 0;
};