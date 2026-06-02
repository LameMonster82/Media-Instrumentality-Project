import type { VideoTrackGenerator } from "./videoTypes";

// eslint-disable-next-line no-var
declare var self: DedicatedWorkerGlobalScope;


let videoGen: VideoTrackGenerator | undefined;
let videoWriter: WritableStreamDefaultWriter<VideoFrame> | undefined;
self.onmessage = async (e: MessageEvent<VideoFrame | { type: 'init'; }>) => {
    if (e.data instanceof VideoFrame) {
        await videoWriter!.write(e.data);
        //self.postMessage({ type: "done" });
    } else if (e.data.type === "init") {
        videoGen = new self.VideoTrackGenerator();
        videoWriter = videoGen!.writable.getWriter();
        self.postMessage({ track: videoGen.track }, [videoGen.track]);
    }
};
