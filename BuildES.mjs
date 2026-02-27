import * as esbuild from 'esbuild';
import htmlPlugin from "@chialab/esbuild-plugin-html";
import workerPlugin from "@chialab/esbuild-plugin-worker"
import http from 'node:http'
import https from 'node:https';
import fs from 'node:fs';

console.log('Building...')

const ctx = await esbuild.context({
    entryPoints: [
        "index.html",
        "src/modules/Library/Exif/ExifWorker.ts",
        "src/modules/Library/Exif/libexif.mjs",
        "src/modules/Video/FFmpeg/FFmpegBridge.ts",
        "src/modules/Video/VideoStreamTrack.ts",
        "src/modules/Video/ExtractThumbnailWorker.ts",
        "src/modules/Video/FFmpeg/WebCodecDecoder.ts",
        "src/modules/Video/SharedSeekableStream2.ts",
        "src/modules/Video/FFmpeg/ffmpeg.js"
    ],
    outdir: './build',
    sourcemap: 'external',

    // Esbuild automatically appends the extension, so omit `.[ext]`
    entryNames: '[dir]/[name]',
    assetNames: '[dir]/[name]',

    // Required for `chunkNames` to take effect in esbuild
    bundle: true,
    format: 'esm',
    platform: 'browser',
    plugins: [htmlPlugin()],
    target: ['esnext'],
    supported: {
        'top-level-await': true
    },

    sourcemap: true,
    outdir: 'build',

    loader: { '.wasm': 'file' },
});

//await ctx.watch();
let { hosts, port } = await ctx.serve({
    servedir: 'build',
    cors: {
        origin: ["*"]
    }

});

const httpsOptions = {
    key: fs.readFileSync('./local.key'),
    cert: fs.readFileSync('./local.cert'),

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