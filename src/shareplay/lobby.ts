import type { WebSocketPing, WebSocketPong, WebSocketRequestRoomCount, WebSocketRequestRoomInfo, WebSocketRoomInfo } from "@Server/types";
import { type AllWebsocketMessages, type DictionaryWebSocketEvent, type MessageByKind, type RespondEventByKind2, type WebSocketConfirmIntent, type WebSocketIntent, type WebSocketIntentRequest, type WebSocketIntentStatus, type WebSocketNewHost, type WebSocketOfferSDP } from "./types";
import { Intent } from "@/player/types";
import RTCHost from "./RTCHost";

export default class Lobby<T extends AllWebsocketMessages = AllWebsocketMessages> {
    private websocker: WebSocket;
    private lobbyId: string | undefined;
    private rtcInfo: RTCConfiguration | undefined;

    private userCount: number = 0;

    private callbacks: DictionaryWebSocketEvent<T> = {};

    private onPlayCB: ((time: number) => Promise<void>)[] = [];
    private onPauseCB: ((time: number) => Promise<void>)[] = [];
    private onSeekCB: ((time: number) => Promise<void>)[] = [];
    private onUserCountUpdate: ((count: number) => void)[] = [];
    private onIntentTime: (() => { intent: Intent, time: DOMHighResTimeStamp; }) | undefined;

    private intentCatcher: ((intent: Intent) => void) | undefined = () => { };

    private userID = crypto.randomUUID();
    private hostingFile: File | null = null;
    private rtcHosts: RTCHost[] = [];
    private firstPing: Promise<void>;
    private seekerChannel: MessageChannel | undefined;

    constructor(ws: string) {
        this.websocker = new WebSocket(ws);
        this.websocker.addEventListener("message", this.handleMessages.bind(this));

        const pong = JSON.stringify({ kind: "pong" } as WebSocketPong);
        this.onEvent("ping", () => {
            this.websocker.send(pong);
        })

        const firstPing = Promise.withResolvers<void>();
        this.firstPing = firstPing.promise;
        this.waitForEvent("ping").then(() => firstPing.resolve());
        this.onEvent("roomCount", (data) => {
            this.userCount = data.count;
            for (const callback of this.onUserCountUpdate)
                callback(data.count);
        });

        this.onEvent("intent", async (data) => {
            let whatToDo: ((time: number) => Promise<void>)[] | undefined;
            if (data.intent === Intent.Play)
                whatToDo = this.onPlayCB;
            else if (data.intent === Intent.Pause)
                whatToDo = this.onPauseCB;
            else if (data.intent === Intent.Seek)
                whatToDo = this.onSeekCB;

            await Promise.all(whatToDo?.map(p => p(data.time)) ?? []);


            this.websocker.send(JSON.stringify({
                kind: "intentConfirm",
                intent: data.intent,
            } as WebSocketConfirmIntent));
        })

        this.onEvent("intentConfirm", (data) => {
            if(this.intentCatcher)
                this.intentCatcher(data.intent);
        })

        this.onEvent("newHost", () => {
            this.hostingFile = null;
        });

        this.onEvent("requestSeeker", async (data) => {
            if (!this.hostingFile) return;

            const otherPeer = data.userId;

            const host = new RTCHost(this.hostingFile, otherPeer, this.rtcInfo!);
            this.rtcHosts.push(host);
            host.createChannel();
            const sdp = await host.getOffer();

            this.websocker.send(JSON.stringify({
                kind: "offerSDP",
                userId: otherPeer,
                fileSize: this.hostingFile.size,
                sdp
            } as WebSocketOfferSDP));
        });
        this.onEvent("offerSDP", (data) => {
            this.seekerChannel?.port1.postMessage(data);
        })
        this.onEvent("answerSDP", async (data) => {
            this.seekerChannel?.port1.postMessage(data);
            if (!this.hostingFile) return;
            const host = this.rtcHosts.find(h => h.otherID === data.userId);

            await host?.setSDP(data.sdp);
        });
        this.onEvent("iceCandidates", async (data) => {
            this.seekerChannel?.port1.postMessage(data);
            if (!this.hostingFile) return;
            const host = this.rtcHosts.find(h => h.otherID === data.userId);

            await host?.addICECandidates(data.candidate);
        });

        this.onEvent("intentRequest", () => {
            if (!this.hostingFile) return;

            const intentTime = this.onIntentTime ? this.onIntentTime() : { intent: Intent.Play, time: 0 };

            this.websocker.send(JSON.stringify({
                kind: "intentStatus",
                intent: intentTime.intent,
                time: intentTime.time
            } as WebSocketIntentStatus))
        })


    }

    async connect(): Promise<string> {
        if (this.lobbyId) return this.lobbyId;
        await this.firstPing;
        this.websocker.send(JSON.stringify({ kind: "requestRoomCount" } as WebSocketRequestRoomCount));
        this.websocker.send(JSON.stringify({ kind: "requestRoomInfo" } as WebSocketRequestRoomInfo));
        const roomId = await this.waitForEvent("roomInfo");
        this.lobbyId = roomId.id;
        this.rtcInfo = roomId.rtcInfo;

        return roomId.id;
    }

    public setAsHost(file: File) {
        this.hostingFile = file;
        this.websocker.send(JSON.stringify({ kind: "newHost" } as WebSocketNewHost));
    }

    public hostFile() {
        return this.hostingFile;
    }

    public getRTCInfo() {
        return this.rtcInfo ?? null
    }

    public setupSeekerChannel() {
        this.seekerChannel = new MessageChannel();
        this.seekerChannel.port1.onmessage = (e: MessageEvent<T>) => {
            const anyData = e.data as any;
            if (typeof anyData.userId === "string") {
                anyData.userId = this.userID;
            }
            this.websocker.send(JSON.stringify(anyData));
        }


        return this.seekerChannel.port2;
    }

    public async intent(intent: Intent, time: number) {
        let count = 0;
        let { promise, resolve } = Promise.withResolvers<void>();
        this.intentCatcher = (confirmedIntent) => {
            if (confirmedIntent == intent) {
                count += 1;
                if (count >= this.userCount - 1)
                    resolve();
            }
        }
        
        this.websocker.send(JSON.stringify({
            kind: "intent",
            intent: intent,
            time,
        } as WebSocketIntent));

        if(this.userCount - 1 > 0)
            await promise;
        this.intentCatcher = undefined;
    }

    public onPlay(callback: (time: number) => Promise<void>) {
        this.onPlayCB.push(callback);
    }
    public onPause(callback: (time: number) => Promise<void>) {
        this.onPauseCB.push(callback);
    }
    public onSeek(callback: (time: number) => Promise<void>) {
        this.onSeekCB.push(callback);
    }
    public onUserCount(callback: (count: number) => void) {
        this.onUserCountUpdate.push(callback);
    }

    public onIntentStatus(callback: () => { intent: Intent, time: DOMHighResTimeStamp; }) {
        this.onIntentTime = callback;
    }

    public getStatus() {
        const promise = this.waitForEvent('intentStatus');
        this.websocker.send(JSON.stringify({ kind: "intentRequest"} as WebSocketIntentRequest))
        return promise;
    }

    private waitForEvent<E extends MessageByKind<T>>(event: E): Promise<RespondEventByKind2<T, E>> {
        const { promise, resolve } = Promise.withResolvers<RespondEventByKind2<T, E>>();
        this.onEvent(event, resolve, true);
        return promise;
    }

    private onEvent<E extends MessageByKind<T>>(
        event: E,
        callback: (data: RespondEventByKind2<T, E>) => void,
        once = false
    ) {
        let callbacks = this.callbacks[event];
        if (!callbacks) {
            callbacks = [];
            this.callbacks[event] = callbacks;
        }

        callbacks.push({ callback, once });
    }

    private handleMessages(ev: MessageEvent<string>) {
        const data = JSON.parse(ev.data);
        const kind = data.kind as MessageByKind<T>;
        const event = this.callbacks[kind] ?? [];

        for (const c of event) {
            c.callback(data as RespondEventByKind2<T, MessageByKind<T>>);
        }

        const filtered = event.filter(e => !e.once);
        this.callbacks[kind] = filtered;
    }
}