let canvas = new OffscreenCanvas(300, 300);
let ctx = canvas.getContext('2d')!;

export function drawTextInTheMiddleOfACanvas(text: string, width: number, height: number, timestamp?: number, duration?: number) {
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 64px Inter"
    ctx.fillStyle = "white";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    return new VideoFrame(canvas, {alpha: "keep", timestamp, duration})
}

export function ImageToDataURL(image: ImageBitmap, maxHeight?: number) {
    if (maxHeight) {
        const sizeDiff = maxHeight / image.height;
        const newWidth = image.width * sizeDiff;

        canvas.width = newWidth;
        canvas.height = maxHeight
    } else {
        canvas.width = image.width;
        canvas.height = image.height
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.convertToBlob({type: "image/jpeg", quality: 0.9});
}

export function VideoFrameToDataURL(image: VideoFrame) {
    canvas.width = image.codedWidth;
    canvas.height = image.codedHeight

    ctx.drawImage(image, 0, 0);
    return canvas.convertToBlob({type: "image/jpeg", quality: 0.9});
}