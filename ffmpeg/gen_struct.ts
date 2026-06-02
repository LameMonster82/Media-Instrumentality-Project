#!/usr/bin/env -S npx tsx
// gen_struct_ts.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// 1. CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs(args: string[]) {
    const options: {
        pointerSize: 4 | 8;
        outputFile: string | null;
        inputFile: string | null;
    } = {
        pointerSize: 8,            // default to 64-bit (LP64 / wasm64)
        outputFile: null,
        inputFile: null,
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === "--pointer-size") {
            i++;
            const val = parseInt(args[i], 10);
            if (val !== 4 && val !== 8) throw new Error("pointer-size must be 4 or 8");
            options.pointerSize = val;
        } else if (arg === "-o") {
            i++;
            options.outputFile = args[i];
        } else if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            options.inputFile = arg;
        }
        i++;
    }

    if (!options.inputFile) throw new Error("No input file specified.");
    return options;
}

// ---------------------------------------------------------------------------
// 3. Type system model
// ---------------------------------------------------------------------------
type TypeInfo = {
    tsType: string;      // TypeScript type string
    size: number;
    alignment: number;
};

function makeTypeMap(pointerSize: number): Record<string, TypeInfo> {
    // LP64 when pointerSize=8, ILP32 when pointerSize=4
    const longSize = pointerSize;         // 4 or 8
    const size_tSize = pointerSize;
    const ptrSize = pointerSize;
    const ptrAlignment = pointerSize;

    const map: Record<string, TypeInfo> = {
        "char": { tsType: "number", size: 1, alignment: 1 },
        "signed char": { tsType: "number", size: 1, alignment: 1 },
        "unsigned char": { tsType: "number", size: 1, alignment: 1 },
        "short": { tsType: "number", size: 2, alignment: 2 },
        "unsigned short": { tsType: "number", size: 2, alignment: 2 },
        "int": { tsType: "number", size: 4, alignment: 4 },
        "unsigned int": { tsType: "number", size: 4, alignment: 4 },
        "long": { tsType: pointerSize === 8 ? "bigint" : "number", size: longSize, alignment: longSize },
        "unsigned long": { tsType: pointerSize === 8 ? "bigint" : "number", size: longSize, alignment: longSize },
        "long long": { tsType: "bigint", size: 8, alignment: 8 },
        "unsigned long long": { tsType: "bigint", size: 8, alignment: 8 },
        "float": { tsType: "number", size: 4, alignment: 4 },
        "double": { tsType: "number", size: 8, alignment: 8 },
        // stdint types (exact widths)
        "int8_t": { tsType: "number", size: 1, alignment: 1 },
        "uint8_t": { tsType: "number", size: 1, alignment: 1 },
        "int16_t": { tsType: "number", size: 2, alignment: 2 },
        "uint16_t": { tsType: "number", size: 2, alignment: 2 },
        "int32_t": { tsType: "number", size: 4, alignment: 4 },
        "uint32_t": { tsType: "number", size: 4, alignment: 4 },
        "int64_t": { tsType: "bigint", size: 8, alignment: 8 },
        "uint64_t": { tsType: "bigint", size: 8, alignment: 8 },
        "size_t": { tsType: pointerSize === 8 ? "bigint" : "number", size: size_tSize, alignment: size_tSize },
        "intptr_t": { tsType: pointerSize === 8 ? "bigint" : "number", size: ptrSize, alignment: ptrAlignment },
        "uintptr_t": { tsType: pointerSize === 8 ? "bigint" : "number", size: ptrSize, alignment: ptrAlignment },
    };
    return map;
}

function getTypeInfo(typeName: string, pointerSize: number): TypeInfo {
    // handle pointer types: "uint8_t*" etc.
    if (typeName.endsWith("*")) {
        const base = typeName.slice(0, -1).trim();
        // We don't need base type for size, but we record tsType as "bigint" (or "number")
        return {
            tsType: pointerSize === 8 ? "bigint" : "number",
            size: pointerSize,
            alignment: pointerSize,
        };
    }
    const map = makeTypeMap(pointerSize);
    const info = map[typeName];
    if (!info) throw new Error(`Unknown type: ${typeName}`);
    return info;
}

// ---------------------------------------------------------------------------
// 4. Struct parser
// ---------------------------------------------------------------------------
interface StructMember {
    type: string;      // C type as parsed (e.g. "int32_t", "char*")
    name: string;
    arraySize?: number;
}

interface StructDef {
    name: string;
    members: StructMember[];
}

function parseStructs(source: string): StructDef[] {
    const structs: StructDef[] = [];

    // Match: typedef struct { ... } Name;   or   typedef struct Name { ... } Name;
    const structRegex = /typedef\s+struct\s*(?:\w+\s*)?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*(\w+)\s*;/g;
    // Note: the inner pattern handles one level of nested braces (for nested structs/unions),
    // but we won't recursively parse nested members here.

    let match;
    while ((match = structRegex.exec(source)) !== null) {
        const body = match[1];
        const name = match[2];

        // Split body into member declarations
        const memberDecls = body.split(";").map(l => l.trim()).filter(l => l.length > 0);
        const members: StructMember[] = [];

        for (const decl of memberDecls) {
            // Remove inline comments (// ...)
            const cleanDecl = decl.replace(/\/\/.*$/, "").trim();
            if (!cleanDecl) continue;

            // Match: [type qualifiers] type [*] name [array]   // very basic
            // Example: const uint8_t* extradata
            //           int32_t  coded_width
            //           char codec[256]
            const m = cleanDecl.match(
                /^\s*(?:const\s+)?([\w\s*]+?)\s+(\w+)(?:\s*\[(\d+)\])?\s*$/
            );
            if (!m) {
                throw new Error(`Cannot parse member: "${decl}" in struct ${name}`);
            }
            let type = m[1].trim();
            // Handle "unsigned long long", "long long", etc.
            // Already fine.
            // Remove extra whitespace within type
            type = type.replace(/\s+/g, " ");
            const memberName = m[2];
            const arraySize = m[3] ? parseInt(m[3], 10) : undefined;

            members.push({ type, name: memberName, arraySize });
        }

        structs.push({ name, members });
    }

    return structs;
}

interface EnumMember {
    name: string;
    value?: number;
}

function parseEnums(source: string): { name: string; members: EnumMember[]; }[] {
    const enums: { name: string; members: EnumMember[]; }[] = [];
    const regex = /typedef\s+enum\s*\{([^{}]*)\}\s*(\w+)\s*;/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
        const body = match[1];
        const name = match[2];

        // Split by commas, but avoid splitting inside comments or strings (unlikely in enums)
        const items = body.split(",").map(s => s.trim()).filter(s => s.length > 0);
        const members: EnumMember[] = [];
        let nextValue = 0;

        for (const item of items) {
            // Remove inline comments
            const clean = item.replace(/\/\/.*$/, "").trim();
            if (!clean) continue;

            // Match: NAME = VALUE
            const parts = clean.split("=");
            const memberName = parts[0].trim();
            let value: number | undefined;
            if (parts.length > 1) {
                // Parse the value – could be hex (0x...) or decimal
                const valStr = parts[1].trim();
                value = Number(valStr);
                if (isNaN(value)) throw new Error(`Invalid enum value: ${valStr}`);
                nextValue = value + 1;
            } else {
                value = nextValue++;
            }
            members.push({ name: memberName, value });
        }
        enums.push({ name, members });
    }
    return enums;
}

// ---------------------------------------------------------------------------
// 5. Layout calculator (offsets, total size)
// ---------------------------------------------------------------------------
interface FieldLayout {
    name: string;
    type: string;       // original C type
    tsType: string;     // TypeScript type
    offset: number;
    size: number;
}

interface StructLayout {
    name: string;
    fields: FieldLayout[];
    totalSize: number;
    alignment: number;
}

function computeLayout(def: StructDef, pointerSize: number): StructLayout {
    const fields: FieldLayout[] = [];
    let currentOffset = 0;
    let structAlignment = 1;

    for (const m of def.members) {
        let info: TypeInfo;
        let actualSize: number;

        if (m.arraySize) {
            // Array type: size = elementSize * count, alignment = elementAlignment
            const elemInfo = getTypeInfo(m.type, pointerSize);
            actualSize = elemInfo.size * m.arraySize;
            info = {
                tsType: elemInfo.tsType,   // we'll later wrap in Array<> or Uint8Array
                size: actualSize,
                alignment: elemInfo.alignment,
            };
        } else {
            info = getTypeInfo(m.type, pointerSize);
            actualSize = info.size;
        }

        // Align current offset
        const alignedOffset = Math.ceil(currentOffset / info.alignment) * info.alignment;
        if (alignedOffset > currentOffset) {
            // Padding inserted
            currentOffset = alignedOffset;
        }

        // Resolve TS type for the field
        let tsType = info.tsType;
        if (m.arraySize) {
            if (m.type === "char" || m.type === "signed char" || m.type === "unsigned char") {
                tsType = "Uint8Array";   // char arrays become byte buffers
            } else {
                tsType = `Array<${tsType}>`; // generic array (TypeScript doesn't enforce length)
            }
        }

        fields.push({
            name: m.name,
            type: m.type + (m.arraySize ? `[${m.arraySize}]` : ""),
            tsType,
            offset: currentOffset,
            size: actualSize,
        });

        currentOffset += actualSize;
        structAlignment = Math.max(structAlignment, info.alignment);
    }

    // Struct final size padded to alignment
    const totalSize = Math.ceil(currentOffset / structAlignment) * structAlignment;

    return {
        name: def.name,
        fields,
        totalSize,
        alignment: structAlignment,
    };
}

// ---------------------------------------------------------------------------
// 6. Code generation
// ---------------------------------------------------------------------------
function generateTS(layout: StructLayout, pointerSize: number): string {
    const lines: string[] = [];

    lines.push(`/** Total struct size: ${layout.totalSize} bytes, alignment: ${layout.alignment} */`);

    // Interface
    lines.push(`export interface ${layout.name} {`);
    for (const f of layout.fields) {
        lines.push(`  /** offset: ${f.offset}, size: ${f.size} */`);
        lines.push(`  ${f.name}: ${f.tsType};`);
    }
    lines.push("}");
    lines.push("");

    // Offsets object
    lines.push(`export const ${layout.name}Offsets = {`);
    for (const f of layout.fields) {
        lines.push(`  ${f.name}: ${f.offset},`);
    }
    lines.push("} as const;");
    lines.push("");

    // Size constant
    lines.push(`export const ${layout.name}Size = ${layout.totalSize};`);

    return lines.join("\n");
}

function generateEnum(enumDef: { name: string; members: EnumMember[]; }): string {
    const lines: string[] = [];
    lines.push(`export enum ${enumDef.name} {`);
    for (const m of enumDef.members) {
        lines.push(`  ${m.name} = ${m.value},`);
    }
    lines.push("}");
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------------------
async function main() {
    const opts = parseArgs(process.argv.slice(2));

    const source = fs.readFileSync(opts.inputFile!, "utf8");

    const structs = parseStructs(source);
     const enums = parseEnums(source);
    if (structs.length === 0 && enums.length === 0) {
        console.error("No struct or enum definitions found.");
        process.exit(1);
    }

    const outputParts: string[] = [];

    // Enums first
    for (const e of enums) {
        outputParts.push(generateEnum(e));
    }

    for (const def of structs) {
        const layout = computeLayout(def, opts.pointerSize);
        outputParts.push(generateTS(layout, opts.pointerSize));
    }

    const output = outputParts.join("\n\n");

    if (opts.outputFile) {
        fs.writeFileSync(opts.outputFile, output, "utf8");
        console.error(`Written to ${opts.outputFile}`);
    } else {
        console.log(output);
    }
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
