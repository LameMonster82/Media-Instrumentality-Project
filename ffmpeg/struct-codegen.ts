#!/usr/bin/env node
/**
 *
 *
 *
 * TRIGGER WARNING: AI generated stuff. I really cant be bothered to write
 * a proper parser
 *
 *
 *
 * struct-codegen.ts
 *
 * Parses Clang's `-fdump-record-layouts` output and emits, for every NON-foreign
 * record, a TypeScript interface plus a reader function that decodes the struct
 * out of an ArrayBuffer at a given byte offset.
 *
 * "Foreign" records are those whose dump name begins with "struct " (these are the
 * FFmpeg / system structs you only hold pointers to). They are parsed but skipped
 * for generation. They are still used to auto-detect the target pointer size.
 *
 * Usage:
 *   node --experimental-strip-types struct-codegen.ts layout.txt > structs.ts
 *   node --experimental-strip-types struct-codegen.ts layout.txt structs.ts
 *   # or with tsx / ts-node:
 *   npx tsx struct-codegen.ts layout.txt structs.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Field {
    offset: number;
    cType: string; // the C type as printed by clang, e.g. "const enum AVPixelFormat *"
    name: string;
}

interface Record {
    name: string; // e.g. "BridgeContext" or "struct AVIOContext"
    foreign: boolean; // true when name starts with "struct "/"union "/"class "
    fields: Field[];
    sizeof: number;
    alignof: number;
}

interface Decoded {
    tsType: string; // "number" | "bigint" | "Uint8Array"
    /** Produces the RHS expression that reads the field. `off` is the field offset. */
    read: (off: number) => string;
    note?: string; // optional comment appended to the field
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const RECORD_MARKER = "*** Dumping AST Record Layout";
const LINE_RE = /^([^|]*)\|(.*)$/; // left part (offset or spaces) | right part (indent + content)
const SIZEOF_RE = /\[sizeof=(\d+),\s*align=(\d+)\]/;
const FIELD_RE = /^(.*?)\s+([A-Za-z_]\w*)\s*$/; // greedy type ... lazy, then trailing identifier

function leadingSpaces(s: string): number {
    const m = /^( *)/.exec(s);
    return m ? m[1].length : 0;
}

function parseDump(text: string): Record[] {
    const blocks = text
        .split(RECORD_MARKER)
        .map((b) => b.trim())
        .filter(Boolean);

    const records: Record[] = [];

    for (const block of blocks) {
        const rawLines = block.split("\n");

        const parsed = rawLines
            .map((line) => {
                const m = LINE_RE.exec(line);
                if (!m) return null;
                const left = m[1];
                const right = m[2];
                const offMatch = /(-?\d+)/.exec(left);
                return {
                    offset: offMatch ? parseInt(offMatch[1], 10) : NaN,
                    indent: leadingSpaces(right),
                    content: right.trim(),
                };
            })
            .filter((p): p is NonNullable<typeof p> => p !== null && p.content !== "");

        if (parsed.length === 0) continue;

        // First parsed line is the record header (its name).
        const header = parsed[0];
        const name = header.content;
        const foreign = /^(struct|union|class)\s/.test(name);

        // The sizeof/align summary line.
        const summary = parsed.find((p) => p.content.startsWith("[sizeof"));
        let sizeof = 0;
        let alignof = 1;
        if (summary) {
            const sm = SIZEOF_RE.exec(summary.content);
            if (sm) {
                sizeof = parseInt(sm[1], 10);
                alignof = parseInt(sm[2], 10);
            }
        }

        // Field candidates: everything after the header that has a numeric offset and
        // is not the summary line and not a nested base/anonymous member.
        const candidates = parsed
            .slice(1)
            .filter((p) => !Number.isNaN(p.offset) && !p.content.startsWith("["));

        // Only keep the shallowest indent level (top-level members). Anything deeper is
        // a member of an embedded/anonymous record and would be double-counted.
        const minIndent = candidates.reduce(
            (min, p) => Math.min(min, p.indent),
            Infinity
        );

        const fields: Field[] = [];
        for (const c of candidates) {
            if (c.indent !== minIndent) continue;
            const fm = FIELD_RE.exec(c.content);
            if (!fm) continue; // e.g. an anonymous member with no name — skip
            fields.push({ offset: c.offset, cType: fm[1].trim(), name: fm[2] });
        }

        records.push({ name, foreign, fields, sizeof, alignof });
    }

    return records;
}

// ---------------------------------------------------------------------------
// Pointer-size detection
// ---------------------------------------------------------------------------

function isPointerType(cType: string): boolean {
    // Covers normal pointers ("X *", "X **") and function pointers ("int (*)(...)").
    return cType.includes("*");
}

/**
 * Two adjacent pointer-typed members can never have padding between them (they
 * share the same alignment), so the delta between their offsets is exactly the
 * pointer size. Scan every record (including foreign ones) for such a pair.
 */
function detectPointerSize(records: Record[]): number {
    for (const r of records) {
        for (let i = 0; i + 1 < r.fields.length; i++) {
            const a = r.fields[i];
            const b = r.fields[i + 1];
            if (isPointerType(a.cType) && isPointerType(b.cType)) {
                const delta = b.offset - a.offset;
                if (delta === 4 || delta === 8) return delta;
            }
        }
    }
    return 4; // sane default: wasm32 / emscripten
}

// ---------------------------------------------------------------------------
// C type -> TS type + DataView read
// ---------------------------------------------------------------------------

function classify(cType: string, ptrSize: number): Decoded {
    const ptrRead = (off: number) =>
        ptrSize === 8
            ? `view.getBigUint64(${off}, true)`
            : `view.getUint32(${off}, true)`;
    const ptrTs = ptrSize === 8 ? "bigint" : "number";

    // Pointers (including function pointers) are opaque handles into wasm memory.
    if (isPointerType(cType)) {
        return { tsType: ptrTs, read: ptrRead, note: "pointer / handle" };
    }

    // Strip qualifiers and tag keywords; collapse whitespace.
    let t = cType
        .replace(/\b(const|volatile|enum|struct|union)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Fixed-size array, e.g. "char [32]" -> raw bytes.
    const arr = /^(.+?)\s*\[(\d+)\]$/.exec(t);
    if (arr) {
        const count = parseInt(arr[2], 10);
        const elem = classify(arr[1].trim(), ptrSize);
        // Estimate element size from the element's read method.
        const elemSize = readSize(elem.read(0));
        const bytes = count * (elemSize || 1);
        return {
            tsType: "Uint8Array",
            read: (off) => `new Uint8Array(buffer, offset + ${off}, ${bytes})`,
            note: `${arr[1].trim()}[${count}] — raw bytes (decode as needed)`,
        };
    }

    const dv = (m: string, off: number) => `view.${m}(${off}, true)`;

    switch (t) {
        case "char":
        case "signed char":
            return { tsType: "number", read: (o) => dv("getInt8", o) };
        case "unsigned char":
        case "_Bool":
        case "bool":
            return { tsType: "number", read: (o) => dv("getUint8", o) };

        case "short":
        case "short int":
        case "signed short":
            return { tsType: "number", read: (o) => dv("getInt16", o) };
        case "unsigned short":
        case "unsigned short int":
            return { tsType: "number", read: (o) => dv("getUint16", o) };

        case "int":
        case "signed":
        case "signed int":
            return { tsType: "number", read: (o) => dv("getInt32", o) };
        case "unsigned":
        case "unsigned int":
            return { tsType: "number", read: (o) => dv("getUint32", o) };

        case "long":
        case "long int":
        case "signed long":
            return ptrSize === 8
                ? { tsType: "bigint", read: (o) => dv("getBigInt64", o), note: "long (64-bit on this target)" }
                : { tsType: "number", read: (o) => dv("getInt32", o), note: "long (32-bit on this target)" };
        case "unsigned long":
        case "unsigned long int":
            return ptrSize === 8
                ? { tsType: "bigint", read: (o) => dv("getBigUint64", o), note: "unsigned long (64-bit on this target)" }
                : { tsType: "number", read: (o) => dv("getUint32", o), note: "unsigned long (32-bit on this target)" };

        case "long long":
        case "long long int":
        case "int64_t":
            return { tsType: "bigint", read: (o) => dv("getBigInt64", o) };
        case "unsigned long long":
        case "uint64_t":
            return { tsType: "bigint", read: (o) => dv("getBigUint64", o) };

        case "int8_t":
            return { tsType: "number", read: (o) => dv("getInt8", o) };
        case "uint8_t":
            return { tsType: "number", read: (o) => dv("getUint8", o) };
        case "int16_t":
            return { tsType: "number", read: (o) => dv("getInt16", o) };
        case "uint16_t":
            return { tsType: "number", read: (o) => dv("getUint16", o) };
        case "int32_t":
            return { tsType: "number", read: (o) => dv("getInt32", o) };
        case "uint32_t":
            return { tsType: "number", read: (o) => dv("getUint32", o) };

        case "float":
            return { tsType: "number", read: (o) => dv("getFloat32", o) };
        case "double":
            return { tsType: "number", read: (o) => dv("getFloat64", o) };

        default:
            // Anything left over with no '*' is almost always an enum (clang prints the
            // tag, which we stripped). Enums are int-sized.
            return {
                tsType: "number",
                read: (o) => dv("getInt32", o),
                note: `assumed enum/int-sized (${cType})`,
            };
    }
}

/** Best-effort byte size from a generated read expression, for array sizing. */
function readSize(expr: string): number {
    if (/Int8|Uint8/.test(expr)) return 1;
    if (/Int16|Uint16/.test(expr)) return 2;
    if (/Int32|Uint32|Float32/.test(expr)) return 4;
    if (/BigInt64|BigUint64|Float64/.test(expr)) return 8;
    return 0;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
    return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function generate(records: Record[], ptrSize: number): string {
    const out: string[] = [];
    out.push(`// AUTO-GENERATED by struct-codegen.ts — DO NOT EDIT BY HAND.`);
    out.push(`// Decoded little-endian; pointer size = ${ptrSize} bytes (${ptrSize === 8 ? "MEMORY64" : "wasm32"}).`);
    out.push(`// Re-run the generator whenever the C layout changes.`);
    out.push(``);
    out.push(`/**`);
    out.push(` * NOTE on growable memory: under -sALLOW_MEMORY_GROWTH the wasm ArrayBuffer is`);
    out.push(` * replaced on growth, detaching old views. Always pass a CURRENT buffer`);
    out.push(` * (e.g. Module.HEAPU8.buffer) on each call; never cache the buffer or a view.`);
    out.push(` */`);
    out.push(``);

    const dedup = new Set<string>();
    const generated = records.filter((r) => {
        const hasAlready = dedup.has(r.name);
        dedup.add(r.name);
        return !r.foreign && !hasAlready
    });
    const skipped = records.filter((r) => r.foreign);

    if (skipped.length) {
        out.push(`// Skipped (foreign 'struct '-prefixed records, held only as pointers):`);
        out.push(`//   ${skipped.map((r) => r.name).join(", ")}`);
        out.push(``);
    }

    for (const r of generated) {
        const decoded = r.fields.map((f) => ({ f, d: classify(f.cType, ptrSize) }));

        // Interface
        out.push(`export interface ${r.name} {`);
        const widest = Math.max(0, ...decoded.map(({ f }) => `${f.name}:`.length));
        for (const { f, d } of decoded) {
            const left = pad(`  ${f.name}:`, widest + 2);
            const note = d.note ? ` ${d.note};` : "";
            out.push(`${left} ${d.tsType}; // @${f.offset} ${f.cType}${note}`);
        }
        out.push(`}`);
        out.push(``);

        // Layout constants
        out.push(`export const SIZEOF_${r.name} = ${r.sizeof};`);
        out.push(`export const ALIGNOF_${r.name} = ${r.alignof};`);
        out.push(`export const OFFSETS_${r.name} = {`);
        for (const { f } of decoded) out.push(`  ${f.name}: ${f.offset},`);
        out.push(`} as const;`);
        out.push(``);

        // Reader
        out.push(`export function read${r.name}(buffer: ArrayBufferLike, offset = 0): ${r.name} {`);
        out.push(`  const view = new DataView(buffer, offset, SIZEOF_${r.name});`);
        out.push(`  return {`);
        for (const { f, d } of decoded) {
            out.push(`    ${f.name}: ${d.read(f.offset)},`);
        }
        out.push(`  };`);
        out.push(`}`);
        out.push(``);
    }

    return out.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
    const [, , inPath, outPath] = process.argv;
    if (!inPath) {
        console.error("usage: struct-codegen.ts <layout-dump.txt> [out.ts]");
        process.exit(2);
    }
    const text = readFileSync(inPath, "utf8");
    const records = parseDump(text);
    const ptrSize = detectPointerSize(records);
    const code = generate(records, ptrSize);
    if (outPath) {
        writeFileSync(outPath, code);
        console.error(
            `Wrote ${outPath} — ${records.filter((r) => !r.foreign).length} struct(s), pointer size ${ptrSize}.`
        );
    } else {
        process.stdout.write(code);
    }
}

main();
