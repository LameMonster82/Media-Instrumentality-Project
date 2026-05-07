import * as esbuild from 'esbuild';
import htmlPlugin from "@chialab/esbuild-plugin-html";
import fs from 'node:fs';
import path from 'node:path';

console.log('Building...')

const serveDir = 'build';

await esbuild.build({
    entryPoints: [
        "VideoControls.html",
        "index.html",
        "src/modules/Library/Exif/ExifWorker.ts",
        "src/modules/Library/Exif/libexif.mjs",
        "src/modules/Video/FFmpeg/FFmpegBridge.ts",
        "src/modules/Video/Tracks/VideoStreamTrack.ts",
        "src/modules/Video/ExtractThumbnailWorker.ts",
        "src/modules/Video/FFmpeg/WebCodecDecoder.ts",
        "src/modules/Video/SharedSeekableStream2.ts",
        "ffmpeg/dist/lib/ffmpeg-wasm32/ffmpeg.mjs",
        "ffmpeg/dist/lib/ffmpeg-wasm64/ffmpeg.mjs",
        "ffmpeg/dist/lib/ffmpeg-wasm32/ffmpeg-wasm32.wasm",
        "ffmpeg/dist/lib/ffmpeg-wasm64/ffmpeg-wasm64.wasm",
        "Resources/ExifTags.xml"
    ],
    outdir: serveDir,
    sourcemap: 'external',

    // Esbuild automatically appends the extension, so omit `.[ext]`
    entryNames: '[dir]/[name]',
    assetNames: 'Resources/[name]-[hash]',

    // Required for `chunkNames` to take effect in esbuild
    bundle: true,
    format: 'esm',
    splitting: true,
    platform: 'browser',
    plugins: [htmlPlugin(), {
        name: "node-externals",
        setup(build) {
            build.onResolve({ filter: /^node:/ }, args => ({
                path: args.path,
                external: true,
            }));
        },
    }],
    target: ['esnext'],
    supported: {
        'top-level-await': true
    },

    sourcemap: true,
    outdir: 'build',

    loader: {
        '.wasm': 'file',
        '.module.css': 'local-css',
        '.xml': 'file',
        '.ttf': 'file',
    },
});

console.log('Done.');
