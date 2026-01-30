
import { readdir } from "node:fs/promises";
import { join } from "node:path";

interface AssetFile {
    readonly name: string,
    readonly path: string,
    readonly mimeType: string,
    readonly lastModified: number,
    readonly url: string
}

const libraryDir = "/var/Espresso/Photo Instrumentality Project/Images";

async function GetFile(file: string | null, headers) {
    if (!file) return new Response("Missing file parameter", { status: 400 });

    // Prevent directory traversal
    if (file.includes("..") || file.includes("/")) {
        return new Response("Invalid file name", { status: 400 });
    }

    const path = `${libraryDir}/${file}`;
    const bunFile = Bun.file(path);
    if (!(await bunFile.exists())) {
        return new Response("File not found", { status: 404 });
    }

    const start = Number(headers
        .get("Range")
        ?.split(',').at(0)
        ?.split('=').at(1)
        ?.split('-').at(0) || 0);

    //console.debug(start);

    return new Response(bunFile.slice(start, bunFile.size, bunFile.type), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${bunFile.size}/${bunFile.size}`,
        },
      });
}

function addcors(response: Response): Response {
    response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    return response;
}

await Bun.build({
    entrypoints: [
        "test.html",
        "index.html",
        "src/modules/Library/Video/FFmpegOutput.ts",
        "src/modules/Library/Video/VideoStreamTrack.ts",
        "src/modules/Library/Video/ExtractThumbnailWorker.ts",
        "src/modules/Library/Video/WebCodecDecoder.ts",
        "src/modules/Library/Video/ffmpeg.js"
    ],
    splitting: false,
    outdir: './build',
    sourcemap: 'linked',
    naming: {
        entry: '[dir]/[name].[ext]',
        chunk: '[dir]/[name].[ext]',
        asset: '[dir]/[name].[ext]',
    },
});

const serverStuff = Bun.serve({
    routes: {
        // Most specific first
        "/api/fileList": async () => {
            return Response.json({ files: assetFiles ?? [] });
        },
        "/api/getFile": req => GetFile(new URL(req.url).searchParams.get("path"), req.headers),
        "/test": () =>
            addcors(new Response(Bun.file("./build/test.html"))),
        "/": () =>
            addcors(new Response(Bun.file("./build/index.html"))),
        "/*": async req => {
            const url = new URL(req.url);
            const file = Bun.file("./build/" + url.pathname);
            if (!(await file.exists())) {
                return new Response("Not Found", { status: 404 });
            }
            
            return addcors(new Response(file));
        },
    },
    development: true,
    port: 5006,
    hostname: 'localhost',
    idleTimeout: 255
});

console.log("Bun is Serving now at", serverStuff.url.href);

const fileList = await readdir(libraryDir);
const assetFiles = await Promise.all(fileList.map(async file => {
    const bunFile = Bun.file(join(libraryDir, file));
    return {
        name: bunFile.name,
        path: file,
        mimeType: bunFile.type,
        lastModified: bunFile.lastModified,
        url: "https://media-demo.llamas.dev/api/getFile?path=" + file
    } as AssetFile
}))

