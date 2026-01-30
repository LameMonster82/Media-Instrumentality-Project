#!/usr/bin/env bun
await Bun.build({
    entrypoints: [
        "index.html",
        "test.html",
        "src/modules/Library/Exif/ExifWorker.ts",
        "src/modules/Library/Exif/libexif.mjs",
        "src/modules/Library/Video/FFmpegOutput.ts",
        "src/modules/Library/Video/VideoStreamTrack.ts",
        "src/modules/Library/Video/ExtractThumbnailWorker.ts",
        "src/modules/Library/Video/WebCodecDecoder.ts",
        "src/modules/Library/Video/SharedSeekableStream2.ts",
        "src/modules/Library/Video/ffmpeg.js"
    ],
    outdir: './build',
    sourcemap: 'inline',
    naming: {
        entry: '[dir]/[name].[ext]',
        chunk: '[dir]/[name].[ext]',
        asset: '[dir]/[name].[ext]',
    },
});

const header = Bun.file("./_headers");
await Bun.write("./build/_headers", header);


