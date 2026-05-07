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
        "src/modules/Video/FFmpeg/ffmpeg.js",
        "node_modules/@6over3/zeroperl-ts/dist/esm/zeroperl.wasm",
        "Resources/ExifTags.xml"
    ],
    outdir: serveDir,
    entryNames: '[dir]/[name]',
    assetNames: '[dir]/[name]',
    bundle: true,
    format: 'esm',
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
    loader: {
        '.wasm': 'file',
        '.module.css': 'local-css',
        '.xml': 'file',
    },
});

console.log('Done.');
