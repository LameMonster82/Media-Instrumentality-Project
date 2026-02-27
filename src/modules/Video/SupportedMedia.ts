import { ffmpegUrl, type Demuxer, type WorkerInitFFmpegOnlyModule, type WorkerRequestAnswered, type WorkerRequestDemuxers, type WorkerSubmitDemuxers } from "../SomeTypes.ts";


let resolveDemuxers: (demuxers: Demuxer[]) => void;
export const ffmpegDemuxers = new Promise<Demuxer[]>(res =>
    resolveDemuxers = res
);


let resolveFfmpeg = () => { };
const ffmpegWorker = new Worker(ffmpegUrl, { type: 'module', name: "I check what codecs ffmpeg supports" });
const awaitFfmpeg = new Promise<void>(resolve => {
    resolveFfmpeg = resolve;
});
ffmpegWorker.onmessage = async (data: MessageEvent<WorkerRequestAnswered | WorkerSubmitDemuxers>) => {
    switch (data.data.kind) {
        case "requestAnswered":
            return resolveFfmpeg();
        case "demuxerResponse":
            console.log("demuxers: ", data.data.demuxers);
            resolveDemuxers(data.data.demuxers);
            ffmpegWorker.terminate();
            return;
    }

}

ffmpegWorker.postMessage({
    kind: "initFfmpegModuleOnly",
} as WorkerInitFFmpegOnlyModule);

await awaitFfmpeg;

ffmpegWorker.postMessage({ kind: "demuxerRequest" } as WorkerRequestDemuxers);

