// vite.config.ts
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
    root: '.',
    base: "",
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            // Your custom aliases from the error messages
            '@Resources': path.resolve(__dirname, 'Resources'),
            '@FFmpeg': path.resolve(__dirname, 'ffmpeg/dist/lib'),
            'custom-jsx/jsx-runtime': path.resolve(__dirname, 'src/core/jsx/runtime.ts'),
            'custom-jsx/jsx-dev-runtime': path.resolve(__dirname, 'src/core/jsx/runtime.ts'),
        },
    },

    assetsInclude: ['**/*.MP4', '**/*.xml', '**/*.wasm'],

    esbuild: {
        jsxImportSource: "custom-jsx",
        jsxFactory: 'custom-jsx/jsx-runtime.jsx', // or whatever you export
        jsxFragment: 'custom-jsx/jsx-runtime.Fragment',
    },

    server: {
        https: {
            key: fs.readFileSync('./Resources/local.key'),
            cert: fs.readFileSync('./Resources/local.cert'),
        },
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        cors: true,
    },

    build: {
        outDir: 'build',
        sourcemap: true,
        rollupOptions: {
            input: {
                main: 'index.html',
                videoControls: 'VideoControls.html',
            },
        },
    },

    worker: {
        format: 'es',
    },
});
