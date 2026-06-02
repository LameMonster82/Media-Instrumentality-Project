export interface Dictionary<T> {
    [key: string]: T;
}

export interface WorkerPostMessage {
    readonly kind: string;
    readonly transferable?: Transferable[];
}

export interface WorkerShutdown extends WorkerPostMessage {
    readonly kind: "shutdown";
}
