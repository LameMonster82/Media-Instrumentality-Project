import type { Dictionary } from "@/core/types";

export type ControlStream = {
    isUsed: boolean,
    index: number,
    metadata: Dictionary<string>
}
export type ControlChapter = {
    id: number,
    start: number,
    end: number,
    title: string | undefined
}



