import * as esbuild from 'esbuild';
import htmlPlugin from "@chialab/esbuild-plugin-html";
import workerPlugin from "@chialab/esbuild-plugin-worker"
import http from 'node:http'
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

console.log('Building...')

const serveDir = 'build';

const wellKnownPath = path.join(serveDir, '.well-known', 'appspecific');
fs.mkdirSync(wellKnownPath, { recursive: true });

const devtoolsConfig = {
    workspace: {
        root: process.cwd(),        // Gets your local absolute path automatically
        uuid: crypto.randomUUID()   // Generates the required v4 UUID
    }
};

fs.writeFileSync(
    path.join(wellKnownPath, 'com.chrome.devtools.json'),
    JSON.stringify(devtoolsConfig, null, 2)
);

const ctx = await esbuild.context({
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
    assetNames: '[dir]/[name]',

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

await ctx.watch();
let { hosts, port } = await ctx.serve({
    servedir: serveDir,
    cors: {
        origin: ["*"]
    }

});

const httpsOptions = {
    key: fs.readFileSync('./Resources/local.key'),
    cert: fs.readFileSync('./Resources/local.cert'),

};

https.createServer(httpsOptions, (req, res) => {
    //res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

    const options = {
        hostname: '127.0.0.1',
        port: port,
        path: req.url,
        method: req.method,
        headers: req.headers,
    }

    // Forward each incoming request to esbuild
    const proxyReq = http.request(options, proxyRes => {
        // If esbuild returns "not found", send a custom 404 page
        //console.log(proxyRes)
        if(proxyRes.statusCode === 404) {
            res.writeHead(404, { 'Content-Type': 'text/html' })
            res.end('<h1>404 Stuff :/</h1>')
            proxyRes.pipe(res, { end: true })
            return
        }

        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

        // Otherwise, forward the response from esbuild to the client
        res.writeHead(proxyRes.statusCode, proxyRes.headers)
        proxyRes.pipe(res, { end: true })
    })

    // Forward the body of the request to esbuild
    req.pipe(proxyReq, { end: true })
}).listen(3000)
console.log(`Serving at: https://127.0.0.1:3000`);
