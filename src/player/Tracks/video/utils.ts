export function getFrameSize(frame: ImageBitmap | VideoFrame, displaySize: boolean = false): { width: number, height: number; } {
    let width;
    let height;
    if (frame instanceof VideoFrame) {
        if (displaySize) {
            width = frame.codedWidth;
            height = frame.codedHeight;
        } else {
            width = frame.displayWidth;
            height = frame.displayHeight;
        }
    } else {
        width = frame.width;
        height = frame.height;
    }

    return { width, height };
}
