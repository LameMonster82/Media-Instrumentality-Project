import type { Dictionary } from "@/core/types";

export type AtomicEventerBuffers = { senderBuffer: SharedArrayBuffer, receiverBuffer: SharedArrayBuffer; };

export type BoolType = { type: "bool"; size: 1; castTo?: unknown; };
export type ByteType = { type: "i8" | "u8"; size: 1; castTo?: unknown; };
export type IntType = { type: "i32" | "u32", size: 4; castTo?: unknown; };
export type FloatType = { type: "f32", size: 4; castTo?: unknown; };
export type BigNumberType = { type: "i64" | "u64", size: 8; castTo?: unknown; };
export type StringType = { type: "str"; };
export type ByteArrayType = { type: "byteArray"; };

export const boolConst: BoolType = { type: "bool", size: 1 };
export const uByteConst: ByteType = { type: "u8", size: 1 };
export const iByteConst: ByteType = { type: "i8", size: 1 };
export const uIntConst: IntType = { type: "u32", size: 4 };
export const iIntConst: IntType = { type: "i32", size: 4 };
export const floatConst: FloatType = { type: "f32", size: 4 };
export const uBigNumConst: BigNumberType = { type: "u64", size: 8 };
export const iBigNumConst: BigNumberType = { type: "i64", size: 8 };
export const stringConst: StringType = { type: "str" };
export const byteArrayConst: ByteArrayType = { type: "byteArray" };

export type SerializableStuff = BoolType | ByteType | IntType | FloatType | BigNumberType | StringType | ByteArrayType;

export const emptyRequest = {} as const;

export type SerializableEventMap<T extends number> = {
    [key in T]: Dictionary<SerializableStuff>;
};

type RuntimeType<S> =
    S extends { castTo: infer C } ? C :
    S extends { type: "bool" } ? boolean :
    S extends { type: "i8" | "u8" | "i32" | "u32" | "f32" } ? number :
    S extends { type: "i64" | "u64" } ? bigint :
    S extends { type: "str" } ? string :
    S extends { type: "byteArray" } ? Uint8Array :
    never;

export type EventData<M> = { -readonly [K in keyof M]: RuntimeType<M[K]> };
