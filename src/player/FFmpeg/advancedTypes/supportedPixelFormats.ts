import { AVPixelFormat, VideoFormatToAVPixelFormat, type ExtendedVideoFormats } from "./AVTypes";

// Typescript/mdn doesnt provide the full list because Firefox and for somee reason Safari, do not support HDR VideoFrame creation
function testSupportedPixelFormats() {
    const supportedPxlFormats = [AVPixelFormat.AV_PIX_FMT_NONE];
    function getEstimatedBufferSize(format: ExtendedVideoFormats, width: number, height: number) {
        const pixels = width * height;

        switch (format) {
            case "I420":
            case "NV12":
                return pixels * 1.5; // 8-bit 4:2:0
            case "I420A":
                return pixels * 2.5;
            case "I422":
                return pixels * 2;
            case "I444":
            case "I422A":
                return pixels * 3;
            case "I420P10":
            case "I420P12":
            case "I422P10":
            case "I422P12":
            case "I444P10":
            case "I444P12":
                return pixels * 3 * 2; // 3 planes × 2 bytes each
            case "I420AP10":
            case "I420AP12":
            case "I422AP10":
            case "I422AP12":
            case "I444AP10":
            case "I444AP12":
                return pixels * 4 * 2; // 3 planes × 2 bytes each
            case "RGBA":
            case "RGBX":
            case "BGRA":
            case "BGRX":
            case "I444A":
                return pixels * 4;
            default:
                return pixels * 4;
        }
    }

    extendedVideoFormatsArray.forEach(format => {
        try {
            const width = 16, height = 16;
            const size = getEstimatedBufferSize(format, width, height);
            const data = new Uint8Array(size);

            const frame = new VideoFrame(data, {
                format: format as VideoPixelFormat,
                codedWidth: width,
                codedHeight: height,
                timestamp: 0
            });
            frame.close(); // cleanup
            //console.log(format, "is supported");
            supportedPxlFormats.unshift(VideoFormatToAVPixelFormat(format));
        } catch (_e) {
            //console.log(format, "is NOT supported");
        }
    });

    return supportedPxlFormats;
}

export const extendedVideoFormatsArray: ExtendedVideoFormats[] = [
    "I420", "I420P10", "I420P12",
    "I420A", "I420AP10", "I420AP12",
    "I422", "I422P10", "I422P12",
    "I422A", "I422AP10", "I422AP12",
    "I444", "I444P10", "I444P12",
    "I444A", "I444AP10", "I444AP12",
    "NV12", "RGBA", "RGBX", "BGRA", "BGRX"
];

let supportedFormats: AVPixelFormat[] | undefined;
export default function getSupportedPixelFormats() {
    supportedFormats ??= testSupportedPixelFormats();
    return supportedFormats;
}
