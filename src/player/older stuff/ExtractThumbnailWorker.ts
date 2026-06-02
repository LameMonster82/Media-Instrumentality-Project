import { ffmpegUrl, type WorkerInitFFmpegOnlyModule, type WorkerRequestAnswered, type WorkerRequestBufferData, type WorkerRequestSeek, type WorkerRequestThumbnail, type WorkerShutdown, type WorkerSubmitThumbnail, type WorkerThumbnailDone, type WorkerThumbnailInProgress } from "../SomeTypes.ts";

let requests: { file: string, resolve: (data: WorkerSubmitThumbnail) => void; }[] = [];
let lastPromise: Promise<void> | null = null;
export async function ExtractThumbnail(fileUrl: string) {
    const promise = new Promise<WorkerSubmitThumbnail>(resolve => {
        requests.push({ file: fileUrl, resolve });
    });


    lastPromise ??= new Promise<void>(async resolve => {
        let request = requests.shift();
        while (request) {
            const data = await ExtractThumbnailNow(request.file);
            request.resolve(data);

            request = requests.shift();
        }
        resolve();
        ffmpegWorker?.postMessage({ kind: "shutdown" } as WorkerShutdown);
        ffmpegWorker?.terminate();
        lastPromise = null;
        ffmpegWorker = null;
    });
    return promise;
}


let ffmpegWorker: Worker | null = null;
let awaitFfmpeg: Promise<void> | null = null;
async function ExtractThumbnailNow(fileUrl: string): Promise<WorkerSubmitThumbnail> {
    return new Promise<WorkerSubmitThumbnail>(async resolve => {
        let resolveFfmpeg = () => { };
        if (!ffmpegWorker) {
            awaitFfmpeg = new Promise<void>(resolve => {
                resolveFfmpeg = resolve;
            });
            ffmpegWorker = new Worker(ffmpegUrl, { type: 'module', name: "I Extract the thumbnail for " + fileUrl });

            ffmpegWorker!.onerror = (e) => {
                console.error('Worker error:', e);
            };

            ffmpegWorker!.postMessage({
                kind: "initFfmpegModuleOnly",
                url: fileUrl,
            } as WorkerInitFFmpegOnlyModule);
        }

        let resolveThumbnail = (value: WorkerSubmitThumbnail) => { };
        let promiseThumbnail: Promise<WorkerSubmitThumbnail> | null = null;


        ffmpegWorker.onmessage = async (data: MessageEvent<WorkerSubmitThumbnail | WorkerThumbnailInProgress | WorkerThumbnailDone | WorkerRequestAnswered>) => {
            switch (data.data.kind) {
                case "thumbnailInProgress":
                    return promiseThumbnail = new Promise<WorkerSubmitThumbnail>(res => resolveThumbnail = res);
                case "thumbnailData":
                    return resolveThumbnail(data.data);
                case "thumbnailDone": {
                    console.log("Generating thumbnail for", fileUrl, "returns", data.data.return);
                    if (promiseThumbnail) {``
                        resolve(await promiseThumbnail);
                    } else
                        resolve({ kind: "thumbnailData", image: null, width: 0, height: 0 } as WorkerSubmitThumbnail);
                    return;
                }
                case "requestAnswered":
                    return resolveFfmpeg();


            }
        };

        await awaitFfmpeg;

        ffmpegWorker!.postMessage({
            kind: "thumbnailRequest",
            url: fileUrl,
        } as WorkerRequestThumbnail);
    });
}
