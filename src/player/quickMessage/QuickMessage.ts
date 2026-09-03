import type { WorkerPostMessage } from "@/core/types";

type WorkerEventsKind<T extends WorkerPostMessage> = T["kind"];
type RespondEventByKind<T extends WorkerPostMessage, E extends WorkerEventsKind<T>> = Extract<T, { kind: E; }>;
type DictionaryWorkerEvent<T extends WorkerPostMessage> = {
    [K in WorkerEventsKind<T>]: ((data: RespondEventByKind<T, K>) => void)[] | undefined;
};
type IsKindOnly<M extends WorkerPostMessage> =
    keyof Omit<M, "kind" | "transferable"> extends never ? M : never;

type KindOnlyEvents<T extends WorkerPostMessage> = IsKindOnly<T>["kind"];

type PostMessager = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage(message: any, transfer: Transferable[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    postMessage(message: any): void;
};

type EventReceiver = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener<K extends keyof WorkerEventMap>(type: K, listener: (this: Worker, ev: WorkerEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
};

export default class QuickPostmessage<T extends WorkerPostMessage> {
    private target: PostMessager;
    private oneShotEvents: DictionaryWorkerEvent<T> = {} as DictionaryWorkerEvent<T>;
    private generalEvents: DictionaryWorkerEvent<T> = {} as DictionaryWorkerEvent<T>;

    constructor(target: PostMessager, source: EventReceiver) {
        this.target = target;
        source.addEventListener("message", this.registerOnMessage.bind(this));
    }

    private registerOnMessage(e: MessageEvent<RespondEventByKind<T, WorkerEventsKind<T>>>) {
        const oneShot = this.oneShotEvents[e.data.kind];
        const general = this.generalEvents[e.data.kind];
        if (oneShot) {
            for (const callback of oneShot) {
                callback(e.data);
            }
            oneShot.length = 0;
        }

        if (general) {
            for (const callback of general) {
                callback(e.data);
            }
        }
    }

    public addEventListener<E extends WorkerEventsKind<T>>(event: E, callback: (data: RespondEventByKind<T, E>) => void) {
        this.generalEvents[event] ??= [];
        this.generalEvents[event].push(callback);
    }

    public waitForEvent<E extends WorkerEventsKind<T>>(event: E): Promise<RespondEventByKind<T, E>> {
        const { promise, resolve } = Promise.withResolvers<RespondEventByKind<T, E>>();
        this.oneShotEvents[event] ??= [];
        this.oneShotEvents[event].push(resolve);
        return promise;
    }

    public postMessage(message: T): void {
        if (message.transferable)
            this.target.postMessage(message, message.transferable);
        else this.target.postMessage(message);
    }

    postEvent<E extends KindOnlyEvents<T>>(kind: E): void {
        this.target.postMessage({ kind });
    }

    public postMessageAndWait<E extends WorkerEventsKind<T>>(message: T, wait: E): Promise<RespondEventByKind<T, E>> {
        const promise = this.waitForEvent(wait);
        this.postMessage(message);
        return promise;
    }
}