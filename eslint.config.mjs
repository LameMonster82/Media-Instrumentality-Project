import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
    // Global ignores
    {
        ignores: [
            "build/",
            "dist/",
            "node_modules/",
            "ffmpeg/dist/",
            "**/*.wasm",
            "**/*.mjs",        // FFmpeg worker glue files
            "Resources/",
        ],
    },
    // Base config for all TypeScript/TSX files
    {
        files: ["src/**/*.ts", "src/**/*.tsx", "*.ts", "*.mjs"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: "./tsconfig.json",
                ecmaVersion: "latest",
                sourceType: "module",
            },
            globals: {
                // Browser + Worker globals (tsconfig lib covers this,
                // but explicit is safer for linting)
                window: "readonly",
                document: "readonly",
                HTMLElement: "readonly",
                HTMLVideoElement: "readonly",
                HTMLDialogElement: "readonly",
                VideoFrame: "readonly",
                AudioData: "readonly",
                EncodedVideoChunk: "readonly",
                EncodedAudioChunk: "readonly",
                AudioDecoder: "readonly",
                VideoDecoder: "readonly",
                OffscreenCanvas: "readonly",
                ImageBitmap: "readonly",
                WebAssembly: "readonly",
                SharedArrayBuffer: "readonly",
                Atomics: "readonly",
                BigInt64Array: "readonly",
                MessageChannel: "readonly",
                MessagePort: "readonly",
                Worker: "readonly",
                Blob: "readonly",
                File: "readonly",
                FileSystemFileHandle: "readonly",
                FileSystemDirectoryHandle: "readonly",
                MediaStream: "readonly",
                MediaStreamTrack: "readonly",
                MediaStreamTrackGenerator: "readonly",
                AudioWorkletNode: "readonly",
                WritableStream: "readonly",
                ReadableStream: "readonly",
                IDBDatabase: "readonly",
                IDBRequest: "readonly",
                IntersectionObserver: "readonly",
                MutationObserver: "readonly",
                AbortController: "readonly",
                DedicatedWorkerGlobalScope: "readonly",
                WorkerGlobalScope: "readonly",
                Navigator: "readonly",
                URL: "readonly",
                location: "readonly",
                navigator: "readonly",
                performance: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                btoa: "readonly",
                atob: "readonly",
                fetch: "readonly",
                indexedDB: "readonly",
                self: "readonly",
                requestAnimationFrame: "readonly",
                cancelAnimationFrame: "readonly",
                structuredClone: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            // ── TypeScript-specific ──
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/consistent-type-imports": [
                "error",
                { prefer: "type-imports", fixStyle: "separate-type-imports" },
            ],
            "@typescript-eslint/no-import-type-side-effects": "error",
            "@typescript-eslint/no-empty-interface": "warn",
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/ban-ts-comment": [
                "warn",
                { "ts-ignore": "allow-with-description" },
            ],
            "@typescript-eslint/array-type": ["error", { default: "array" }],
            // ── Naming conventions ──
            "@typescript-eslint/naming-convention": [
                "error",
                // Variables/functions: camelCase
                {
                    selector: ["variable", "function"],
                    format: ["camelCase"],
                    leadingUnderscore: "allow",
                },
                // Exported functions (components): PascalCase allowed
                {
                    selector: "function",
                    modifiers: ["exported"],
                    format: ["camelCase"],
                },
                // Parameters: camelCase
                {
                    selector: "parameter",
                    format: ["camelCase"],
                    leadingUnderscore: "allow",
                },
                // Class/interface/type/enum members: PascalCase for static, camelCase for instance
                {
                    selector: ["class", "interface", "typeLike", "enum"],
                    format: ["PascalCase"],
                },
                {
                    selector: "classMethod",
                    format: ["camelCase"],
                },
                {
                    selector: "classProperty",
                    format: ["camelCase"],
                },
                // Allow UPPER_CASE for enum members and exported constants
                {
                    selector: "enumMember",
                    format: ["UPPER_CASE", "PascalCase"],
                },
                // Type properties (interfaces, type literals): camelCase
                {
                    selector: "typeProperty",
                    format: ["camelCase", "PascalCase", "UPPER_CASE"],
                },
                // Don't enforce naming on imported/destructured bindings
                {
                    selector: "variable",
                    modifiers: ["destructured"],
                    format: null,
                },
            ],
            // ── General best practices ──
            // "no-console": ["warn", { allow: ["warn", "error"] }],
            "prefer-const": "error",
            "no-var": "error",
            "eqeqeq": ["error", "always"],
            "no-throw-literal": "error",
            "prefer-template": "warn",
            "no-debugger": "warn",
            "no-duplicate-imports": "error",
            "no-unused-expressions": "warn",
        },
    },
    // Worker files: allow console.log and DedicatedWorkerGlobalScope-style self
    {
        files: [
            "src/**/FFmpegBridge.ts",
            "src/**/WebCodecDecoder.ts",
            "src/**/ExifWorker.ts",
            "src/**/ExtractThumbnailWorker.ts",
            "src/**/SharedSeekableStream*.ts",
            "src/**/VideoStreamTrack.ts",
        ],
        rules: {
            "@typescript-eslint/no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                // Workers often use `self` patterns
            }],
        },
    },
    // Test files: relax rules
    {
        files: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*Test.ts"],
        rules: {
            "no-console": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/ban-ts-comment": "off",
        },
    },
    // JS/MJS files (FFmpeg glue, ASS parser): minimal rules
    {
        files: ["src/**/*.js", "src/**/*.mjs"],
        rules: {
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/naming-convention": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "no-undef": "warn",
        },
    },
];
