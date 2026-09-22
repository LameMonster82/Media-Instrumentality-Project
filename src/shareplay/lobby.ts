import type { WebSocketPong, WebSocketRequestRoomCount, WebSocketRequestRoomInfo } from "@Server/types";
import { Intent } from "@/player/types";
import RTCHost from "./RTCHost";
import type { AllWebsocketMessages, DictionaryWebSocketEvent, MessageByKind, RespondEventByKind2, WebSocketConfirmIntent, WebSocketICECandidates, WebSocketIntent, WebSocketIntentRequest, WebSocketIntentStatus, WebSocketNewHost, WebSocketOfferSDP, WebSocketRequestSeeker } from "./types";
import type { WorkerRemoteSoruce } from "@/player/seeker/types";

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
    private queueOfIncomingIntents: WebSocketIntent[] = [];
    private handlingIncomingIntent: boolean = false;
    private queueOfOutgoingIntents: { intent: Intent; time: number; selfPromise: Promise<unknown>}[] = [];
    private handlingOutgoingIntent: boolean = false;

    private intentConfirmer: ((intent: Intent) => void) | undefined;

    private hostingFile: File | null = null;
    private rtcHosts: RTCHost[] = [];
    private seekerConnection: RTCPeerConnection | undefined;
    private seekerFileSize: (size: number) => void = () => {};
    private seekOfferReceived = false;

    private loadingState = false;
    private onLoadingStateCallback: ((seeking: boolean) => void)[] = [];
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
            if (!this.handlingIncomingIntent)
                this.handleIntentResponse(data);
            else this.queueOfIncomingIntents.push(data);
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

        this.onEvent("offerSDP", async (data) => {
            this.seekOfferReceived = true;
            if (this.seekerConnection) {
                this.seekerFileSize(data.fileSize);

                await this.seekerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));

                const answer = await this.seekerConnection.createAnswer();
                await this.seekerConnection.setLocalDescription(answer);

                this.send({
                    kind: 'answerSDP',
                    userId: this.userId,
                    targetId: this.hostId ?? undefined,
                    sdp: this.seekerConnection.localDescription?.toJSON()!
                });
            }
        });

        this.onEvent("answerSDP", async (data) => {
            if (this.hostingFile)
                await this.rtcHosts.find((host) => host.otherID === data.userId)?.setSDP(data.sdp);
            else
                await this.seekerConnection?.setRemoteDescription(new RTCSessionDescription(data.sdp));
        });

        this.onEvent("iceCandidates", async (data) => {
            if (this.hostingFile) {
                await this.rtcHosts.find((host) => host.otherID === data.userId)?.addICECandidates(data.candidate);
            } else {
                await this.seekerConnection?.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        });

        this.onEvent("intentRequest", () => this.handleIntentRequest());
    }

    private handleNewHost(data: WebSocketNewHost): void {
        if (data.hostId) this.hostId = data.hostId;
        this.hostingFile = null;

        // If we joined before the host had a file, our first data request was
        // dropped. Once the host is ready, ask again.
        if (this.seekerConnection && !this.seekOfferReceived) {
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

    private async handleIntentResponse(data: WebSocketIntent) {
        this.handlingIncomingIntent = true;
        this.setLoadingState(true);

        const callbacks = this.intentCallbacksFor(data.intent);
        await Promise.all(callbacks.map((callback) => callback(data.time)));
        this.send({ kind: "intentConfirm", intent: data.intent } as WebSocketConfirmIntent);

        await this.waitForEvent("intentConfirmGlobal");
        this.setLoadingState(false);

        this.handlingIncomingIntent = false;
        const nextEvent = this.queueOfIncomingIntents.shift();
        if (nextEvent)
            this.handleIntentResponse(nextEvent);
    }

    private intentCallbacksFor(intent: Intent): IntentCallback[] {
        switch (intent) {
            case Intent.Play: return this.onPlayCallbacks;
            case Intent.Pause: return this.onPauseCallbacks;
            case Intent.Seek: return this.onSeekCallbacks;
            default: return [];
        }
    }

    private setLoadingState(loading: boolean): void {
        if (this.loadingState === loading) return;
        this.loadingState = loading;
        for (const callback of this.onLoadingStateCallback) callback(loading);
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

    public async setupRemoteChannel(channelCB: (channel: RTCDataChannel, fileSize: number ) => void): Promise<void> {
        const { promise: sizePromise, resolve: sizeResolve } = Promise.withResolvers<number>();
        this.seekerFileSize = sizeResolve;
        this.seekerConnection = new RTCPeerConnection(this.rtcInfo!);
        this.seekerConnection.ondatachannel = (channel) => {
            channelCB(channel.channel, fileSize);
        }
        this.seekerConnection.onicecandidate = (data) => {
            if (!data.candidate) return;

            this.send({
                kind: "iceCandidates",
                userId: this.userId,
                targetId: this.hostId ?? undefined,
                candidate: data.candidate.toJSON()
            });
        };

        this.send({ kind: "requestSeeker", userId: this.userId });
        const fileSize = await sizePromise;
    }

    public async intent(intent: Intent, time: number, selfPromise: Promise<unknown>): Promise<void> {
        if (this.handlingOutgoingIntent) {
            this.queueOfOutgoingIntents.push({ intent, time, selfPromise });
            return;
        }
        this.handlingOutgoingIntent = true;
        this.setLoadingState(true);

        this.send({ kind: "intent", intent, time });

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

        await selfPromise;
        this.send({ kind: "intentConfirmGlobal" });

        this.setLoadingState(false);

        this.handlingOutgoingIntent = false;
        const nextEvent = this.queueOfOutgoingIntents.shift();
        if (nextEvent)
            this.intent(nextEvent.intent, nextEvent.time, nextEvent.selfPromise);
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

    public onLoadingStateChange(callback: (loading: boolean) => void): void {
        this.onLoadingStateCallback.push(callback);
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
