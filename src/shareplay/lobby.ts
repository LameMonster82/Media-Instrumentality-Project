import type { WebSocketPong, WebSocketRequestRoomCount, WebSocketRequestRoomInfo } from "@Server/types";
import { Intent } from "@/player/types";
import RTCHost from "./RTCHost";
import type { AllWebsocketMessages, DictionaryWebSocketEvent, MessageByKind, RespondEventByKind2, WebSocketConfirmIntent, WebSocketICECandidates, WebSocketIntent, WebSocketIntentRequest, WebSocketIntentStatus, WebSocketNewHost, WebSocketOfferSDP, WebSocketRequestSeeker } from "./types";

type IntentCallback = (time: number) => Promise<void>;
type IntentStatusProvider = () => { intent: Intent; time: number };

export default class Lobby<T extends AllWebsocketMessages = AllWebsocketMessages> {
    private websocket: WebSocket;
    private lobbyId: string | undefined;
    private rtcInfo: RTCConfiguration | undefined;
    private userId = "";
    private hostId: string | null = null;

    private userCount = 0;

    private callbacks: DictionaryWebSocketEvent<T> = {};

    private onPlayCallbacks: IntentCallback[] = [];
    private onPauseCallbacks: IntentCallback[] = [];
    private onSeekCallbacks: IntentCallback[] = [];
    private onUserCountCallbacks: ((count: number) => void)[] = [];
    private intentStatusProvider: IntentStatusProvider | undefined;

    private intentConfirmer: ((intent: Intent) => void) | undefined;

    private hostingFile: File | null = null;
    private rtcHosts: RTCHost[] = [];
    private seekerChannel: MessageChannel | undefined;
    private seekOfferReceived = false;

    private seeking = false;
    private onSeekStateCallbacks: ((seeking: boolean) => void)[] = [];
    private onHostLeftCallbacks: (() => void)[] = [];
    private onErrorCallbacks: ((message: string) => void)[] = [];

    constructor(wsUrl: string) {
        this.websocket = new WebSocket(wsUrl);
        this.websocket.addEventListener("message", this.handleMessages.bind(this));
        this.registerHandlers();
    }

    private registerHandlers(): void {
        const pong = JSON.stringify({ kind: "pong" } as WebSocketPong);
        this.onEvent("ping", () => this.websocket.send(pong));

        this.onEvent("roomCount", (data) => {
            this.userCount = data.count;
            for (const callback of this.onUserCountCallbacks) callback(data.count);
        });

        this.onEvent("intent", async (data) => {
            if (data.intent === Intent.Seek) {
                this.setSeeking(true);
            } else if (this.seeking) {
                // A seek is being synchronized; ignore playback intents until it
                // completes. Confirm anyway so the sender does not hang.
                this.send({ kind: "intentConfirm", intent: data.intent } as WebSocketConfirmIntent);
                return;
            }

            const callbacks = this.intentCallbacksFor(data.intent);
            await Promise.all(callbacks.map((callback) => callback(data.time)));
            this.send({ kind: "intentConfirm", intent: data.intent } as WebSocketConfirmIntent);

            if (data.intent === Intent.Seek) {
                this.setSeeking(false);
            }
        });

        this.onEvent("intentConfirm", (data) => {
            this.intentConfirmer?.(data.intent);
        });

        this.onEvent("hostLeft", () => {
            for (const callback of this.onHostLeftCallbacks) callback();
        });

        this.onEvent("error", (data) => {
            for (const callback of this.onErrorCallbacks) callback(data.message);
        });

        this.onEvent("newHost", (data) => this.handleNewHost(data));

        this.onEvent("requestSeeker", async (data) => {
            await this.handleSeekerRequest(data.userId);
        });

        this.onEvent("offerSDP", (data) => {
            this.seekOfferReceived = true;
            this.seekerChannel?.port1.postMessage(data);
        });

        this.onEvent("answerSDP", async (data) => {
            if (!this.hostingFile) return;
            await this.rtcHosts.find((host) => host.otherID === data.userId)?.setSDP(data.sdp);
        });

        this.onEvent("iceCandidates", async (data) => {
            if (this.hostingFile) {
                await this.rtcHosts.find((host) => host.otherID === data.userId)?.addICECandidates(data.candidate);
            } else {
                this.seekerChannel?.port1.postMessage(data);
            }
        });

        this.onEvent("intentRequest", () => this.handleIntentRequest());
    }

    private handleNewHost(data: WebSocketNewHost): void {
        if (data.hostId) this.hostId = data.hostId;
        this.hostingFile = null;

        // If we joined before the host had a file, our first data request was
        // dropped. Once the host is ready, ask again.
        if (this.seekerChannel && !this.seekOfferReceived) {
            this.send({ kind: "requestSeeker", userId: this.userId } as WebSocketRequestSeeker);
        }
    }

    private async handleSeekerRequest(seekerId: string): Promise<void> {
        if (!this.hostingFile || !this.rtcInfo) return;

        const host = new RTCHost(this.hostingFile, seekerId, this.rtcInfo, (candidate) => {
            this.send({
                kind: "iceCandidates",
                userId: this.userId,
                targetId: seekerId,
                candidate,
            } as WebSocketICECandidates);
        });

        this.rtcHosts.push(host);
        host.createChannel();
        const sdp = await host.getOffer();

        this.send({
            kind: "offerSDP",
            userId: this.userId,
            targetId: seekerId,
            fileSize: this.hostingFile.size,
            sdp,
        } as WebSocketOfferSDP);
    }

    private handleIntentRequest(): void {
        if (!this.hostingFile) return;

        const status = this.intentStatusProvider?.() ?? { intent: Intent.Play, time: 0 };
        this.send({ kind: "intentStatus", intent: status.intent, time: status.time } as WebSocketIntentStatus);
    }

    private intentCallbacksFor(intent: Intent): IntentCallback[] {
        switch (intent) {
            case Intent.Play: return this.onPlayCallbacks;
            case Intent.Pause: return this.onPauseCallbacks;
            case Intent.Seek: return this.onSeekCallbacks;
            default: return [];
        }
    }

    private setSeeking(seeking: boolean): void {
        if (this.seeking === seeking) return;
        this.seeking = seeking;
        for (const callback of this.onSeekStateCallbacks) callback(seeking);
    }

    async connect(): Promise<string> {
        if (this.lobbyId) return this.lobbyId;

        const error = this.waitForEvent("error").then((data) => {
            throw new Error(data.message);
        });

        // The server sends an immediate ping on a successful join; an error (and
        // close) is sent instead when the lobby does not exist.
        await Promise.race([this.waitForEvent("ping"), error]);

        this.send({ kind: "requestRoomCount" } as WebSocketRequestRoomCount);
        this.send({ kind: "requestRoomInfo" } as WebSocketRequestRoomInfo);

        const info = await Promise.race([this.waitForEvent("roomInfo"), error]);

        this.lobbyId = info.id;
        this.userId = info.userId;
        this.hostId = info.hostId;
        this.rtcInfo = info.rtcInfo;

        return info.id;
    }

    public setAsHost(file: File): void {
        this.hostingFile = file;
        this.send({ kind: "newHost" } as WebSocketNewHost);
    }

    public hostFile(): File | null {
        return this.hostingFile;
    }

    public getRTCInfo(): RTCConfiguration | null {
        return this.rtcInfo ?? null;
    }

    public setupSeekerChannel(): MessagePort {
        this.seekerChannel = new MessageChannel();

        this.seekerChannel.port1.onmessage = (event: MessageEvent) => {
            const message = event.data as { kind: string; userId?: string; targetId?: string };
            message.userId = this.userId;

            if (message.kind === "answerSDP" || message.kind === "iceCandidates") {
                message.targetId = this.hostId ?? undefined;
            }

            this.websocket.send(JSON.stringify(message));
        };

        return this.seekerChannel.port2;
    }

    public async intent(intent: Intent, time: number): Promise<void> {
        if (this.seeking) return;

        if (intent === Intent.Seek) this.setSeeking(true);

        this.send({ kind: "intent", intent, time } as WebSocketIntent);

        const others = this.userCount - 1;
        if (others > 0) {
            let confirmed = 0;
            const { promise, resolve } = Promise.withResolvers<void>();
            this.intentConfirmer = (confirmedIntent) => {
                if (confirmedIntent !== intent) return;
                confirmed += 1;
                if (confirmed >= others) resolve();
            };

            await promise;
            this.intentConfirmer = undefined;
        }

        if (intent === Intent.Seek) this.setSeeking(false);
    }

    public onPlay(callback: IntentCallback): void {
        this.onPlayCallbacks.push(callback);
    }

    public onPause(callback: IntentCallback): void {
        this.onPauseCallbacks.push(callback);
    }

    public onSeek(callback: IntentCallback): void {
        this.onSeekCallbacks.push(callback);
    }

    public onUserCount(callback: (count: number) => void): void {
        this.onUserCountCallbacks.push(callback);
    }

    public onIntentStatus(provider: IntentStatusProvider): void {
        this.intentStatusProvider = provider;
    }

    public onSeekStateChange(callback: (seeking: boolean) => void): void {
        this.onSeekStateCallbacks.push(callback);
    }

    public onHostLeft(callback: () => void): void {
        this.onHostLeftCallbacks.push(callback);
    }

    public onError(callback: (message: string) => void): void {
        this.onErrorCallbacks.push(callback);
    }

    public getStatus(): Promise<WebSocketIntentStatus> {
        const promise = this.waitForEvent("intentStatus");
        this.send({ kind: "intentRequest" } as WebSocketIntentRequest);
        return promise;
    }

    private send(message: AllWebsocketMessages): void {
        this.websocket.send(JSON.stringify(message));
    }

    private waitForEvent<E extends MessageByKind<T>>(event: E): Promise<RespondEventByKind2<T, E>> {
        const { promise, resolve } = Promise.withResolvers<RespondEventByKind2<T, E>>();
        this.onEvent(event, resolve, true);
        return promise;
    }

    private onEvent<E extends MessageByKind<T>>(
        event: E,
        callback: (data: RespondEventByKind2<T, E>) => void,
        once = false,
    ): void {
        let callbacks = this.callbacks[event];
        if (!callbacks) {
            callbacks = [];
            this.callbacks[event] = callbacks;
        }

        callbacks.push({ callback, once });
    }

    private handleMessages(event: MessageEvent<string>): void {
        const data = JSON.parse(event.data);
        const kind = data.kind as MessageByKind<T>;
        const listeners = this.callbacks[kind] ?? [];

        for (const listener of listeners) {
            listener.callback(data as RespondEventByKind2<T, MessageByKind<T>>);
        }

        this.callbacks[kind] = listeners.filter((listener) => !listener.once);
    }
}
