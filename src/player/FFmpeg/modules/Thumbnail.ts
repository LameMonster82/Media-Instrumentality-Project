/*
 * Thumbnail.ts — Handles thumbnail data from FFmpeg.
 */
import { workerState } from "./State";
import { ImageToDataURL, VideoFrameToDataURL } from "../older stuff/QuickDrawCanvas";
import { AVPixelFormatToVideoFormat } from "./AVTypes";
import type { WorkerSubmitThumbnail, WorkerThumbnailInProgress } from "../types";

export function submit_thumbnail(data: {
    is_raw: number;
    data: number;
    data_size: number;
    width: number;
    height: number;
    format: number;
}) {
    self.postMessage({ kind: "thumbnailInProgress" } as WorkerThumbnailInProgress);
    const buffer = workerState.readMemory(data.data, data.data + data.data_size);

    if (data.is_raw === 1) {
        const frame = new VideoFrame(buffer, {
            codedWidth:  data.width,
            codedHeight: data.height,
            format:      AVPixelFormatToVideoFormat(data.format) as VideoPixelFormat,
            timestamp:   0,
        });

        VideoFrameToDataURL(frame).then((blob) => {
            frame.close();
            const postData: WorkerSubmitThumbnail = {
                kind:     "thumbnailData",
                image:    blob,
                width:    data.width,
                height:   data.height,
                transferable: [blob],
            };
            self.postMessage(postData);
        });
    } else {
        createImageBitmap(new Blob([buffer])).then((imageBitmap) => {
            ImageToDataURL(imageBitmap).then((blob) => {
                const postData: WorkerSubmitThumbnail = {
                    kind:     "thumbnailData",
                    image:    blob,
                    width:    imageBitmap.width,
                    height:   imageBitmap.height,
                    transferable: [blob],
                };
                self.postMessage(postData);
            });
        });
    }
}
