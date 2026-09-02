import type { SignalingTransport } from "./SignalingTransport";
import { RTCHost } from "./RTCHost";
import {
    PEER_TIMEOUT_MS,
    PING_INTERVAL_MS,
    RTC_CONFIG,
    SEEK_TIMEOUT_MS,
    type LobbyMessage,
    type MediaInfo,
    type RtcSignal,
    type ShareCommand,
    type SharePlayPlayer,
} from "./types";
import type { RemoteFileSource } from "../player/seeker/types";

export type LobbySource = string | File | RemoteFileSource;

/**
 * Peer-coordinated share-play controller.
 *
 * - Membership is derived locally from periodic pings; members that go silent
 *   are removed (kicked).
 * - Play/pause are broadcast and applied immediately.
 * - Seek is a two-phase handshake: every member seeks locally, broadcasts
 *   seekReady, and playback resumes once all members have confirmed (missing
 *   members time out and are kicked).
 * - The peer that announces mediaInfo is the host. In "file" mode the host
 *   serves byte ranges over WebRTC data channels; in "url" mode every client
 *   fetches the URL directly.
 */
export class LobbyController {
    readonly peerId: string = crypto.randomUUID();
    private lobbyId: string;
    private transport: SignalingTransport;

    private lastSeen = new Map<string, number>(); // other members

    private media: MediaInfo | undefined;
    private hostId: string | undefined;
    private mediaEpoch: { ts: number; from: string } | undefined;
    private servedFile: File | undefined;
    private rtcHost: RTCHost | undefined;

    // Peer role RTC (connection to the current host)
    private hostPc: RTCPeerConnection | undefined;
    private mediaChannel: RTCDataChannel | undefined;
    private rangePort: MessagePort | undefined;
    private pendingRangeIds: string[] = [];
    private maxMessageSize = 64 * 1024;

    // Seek coordination
    private activeSeek: { seq: number; from: string } | undefined;
    private seekReadySets = new Map<number, Set<string>>();

    private player: SharePlayPlayer | undefined;

    private pingTimer: number | undefined;
    private pruneTimer: number | undefined;

    onMembersChange: (members: string[]) => void = () => { };
    onMediaChange: (media: MediaInfo | undefined, hostId: string | undefined) => void = () => { };

    constructor(lobbyId: string, transport: SignalingTransport) {
        this.lobbyId = lobbyId;
        this.transport = transport;
        this.transport.onMessage((m) => this.handleMessage(m));
        this.broadcast({ type: "hello", peerId: this.peerId, lobbyId });

        this.pingTimer = window.setInterval(() => this.broadcast({ type: "ping", peerId: this.peerId }), PING_INTERVAL_MS);
        this.pruneTimer = window.setInterval(() => this.pruneStale(), 1000);
    }

    // ---- public API -------------------------------------------------------

    setPlayer(player: SharePlayPlayer): void {
        this.player = player;
        player.setCommandHandler((command) => this.onUserCommand(command));
    }

    /** Become the host serving a local file. */
    hostFile(file: File): void {
        this.servedFile = file;
        this.media = { mode: "file", fileSize: file.size, fileName: file.name };
        this.mediaEpoch = { ts: Date.now(), from: this.peerId };
        this.hostId = this.peerId;
        this.broadcast({ type: "mediaInfo", from: this.peerId, ts: this.mediaEpoch.ts, media: this.media });
        void this.mediaChanged();
    }

    /** Share a URL; every client fetches it directly (no RTC). */
    hostUrl(url: string): void {
        this.media = { mode: "url", fileSize: 0, fileName: url, url };
        this.mediaEpoch = { ts: Date.now(), from: this.peerId };
        this.hostId = this.peerId;
        this.broadcast({ type: "mediaInfo", from: this.peerId, ts: this.mediaEpoch.ts, media: this.media });
        void this.mediaChanged();
    }

    get currentMedia(): MediaInfo | undefined {
        return this.media;
    }

    get isHost(): boolean {
        return this.hostId === this.peerId;
    }

    /** The source to hand to VideoPlayer2, based on the current media + role. */
    getCurrentSource(): LobbySource {
        if (!this.media) throw new Error("No media in the lobby yet");
        if (this.media.mode === "url") return this.media.url!;
        if (this.hostId === this.peerId) return this.servedFile!;
        return this.createRemoteSource();
    }

    destroy(): void {
        window.clearInterval(this.pingTimer);
        window.clearInterval(this.pruneTimer);
        this.teardownPeerRtc();
        this.teardownHostRtc();
        this.transport.close();
    }

    // ---- membership -------------------------------------------------------

    private broadcast(message: LobbyMessage): void {
        this.transport.send(message);
    }

    private members(): string[] {
        return [...this.lastSeen.keys()];
    }

    private pruneStale(): void {
        const now = Date.now();
        let changed = false;
        for (const [id, ts] of this.lastSeen) {
            if (now - ts > PEER_TIMEOUT_MS) {
                this.lastSeen.delete(id);
                changed = true;
            }
        }
        if (changed) this.onMembersChange(this.members());
    }

    // ---- message handling -------------------------------------------------

    private handleMessage(msg: LobbyMessage): void {
        switch (msg.type) {
            case "hello": {
                if (msg.peerId === this.peerId) return;
                const isNew = !this.lastSeen.has(msg.peerId);
                this.lastSeen.set(msg.peerId, Date.now());
                if (isNew) {
                    // Re-introduce ourselves so the newcomer learns about us too.
                    this.broadcast({ type: "hello", peerId: this.peerId, lobbyId: this.lobbyId });
                    // If we're the host, re-announce the current media for the newcomer.
                    if (this.hostId === this.peerId && this.media && this.mediaEpoch) {
                        this.broadcast({ type: "mediaInfo", from: this.peerId, ts: this.mediaEpoch.ts, media: this.media });
                    }
                    this.onMembersChange(this.members());
                }
                break;
            }
            case "ping": {
                if (msg.peerId === this.peerId) return;
                const isNew = !this.lastSeen.has(msg.peerId);
                this.lastSeen.set(msg.peerId, Date.now());
                if (isNew) this.onMembersChange(this.members());
                break;
            }
            case "signal": {
                if (msg.to !== this.peerId) return;
                void this.handleSignal(msg.from, msg.data);
                break;
            }
            case "command": {
                if (msg.from === this.peerId) return;
                this.handleCommand(msg.from, msg.seq, msg.command);
                break;
            }
            case "seekReady": {
                if (msg.from === this.peerId) return;
                this.addSeekReady(msg.from, msg.seq);
                break;
            }
            case "mediaInfo": {
                if (msg.from === this.peerId) return;
                this.handleMediaInfo(msg.from, msg.ts, msg.media);
                break;
            }
        }
    }

    // ---- media / host -----------------------------------------------------

    private handleMediaInfo(from: string, ts: number, media: MediaInfo): void {
        if (this.mediaEpoch && (this.mediaEpoch.ts > ts || (this.mediaEpoch.ts === ts && this.mediaEpoch.from > from)))
            return;
        this.mediaEpoch = { ts, from };
        this.hostId = from;
        this.media = media;
        void this.mediaChanged();
    }

    private async mediaChanged(): Promise<void> {
        if (this.media?.mode === "file") {
            if (this.hostId === this.peerId) {
                this.setupHost();
            } else {
                await this.connectToHost(this.hostId!);
            }
        } else {
            this.teardownPeerRtc();
            if (this.hostId !== this.peerId) this.teardownHostRtc();
        }
        this.onMediaChange(this.media, this.hostId);
    }

    private setupHost(): void {
        if (!this.servedFile) return;
        if (!this.rtcHost) {
            this.rtcHost = new RTCHost(this.servedFile);
            this.rtcHost.onSignal = (to, data) => this.broadcast({ type: "signal", from: this.peerId, to, data });
        } else {
            this.rtcHost.setFile(this.servedFile);
        }
    }

    // ---- RTC --------------------------------------------------------------

    private async handleSignal(from: string, data: RtcSignal): Promise<void> {
        if (this.hostId === this.peerId) {
            await this.rtcHost?.handleSignal(from, data);
            return;
        }

        // Peer role: signals only come from our host.
        if (from !== this.hostId || !this.hostPc) return;
        if ("sdp" in data) {
            await this.hostPc.setRemoteDescription(data.sdp);
        } else {
            await this.hostPc.addIceCandidate(data.ice);
        }
    }

    private async connectToHost(hostId: string): Promise<void> {
        this.teardownPeerRtc();

        const pc = new RTCPeerConnection(RTC_CONFIG);
        this.hostPc = pc;

        pc.onicecandidate = (e) => {
            if (e.candidate)
                this.broadcast({ type: "signal", from: this.peerId, to: hostId, data: { ice: e.candidate.toJSON() } });
        };

        const channel = pc.createDataChannel("media", { ordered: true, maxMessageSize: 256 * 1024 } as RTCDataChannelInit);
        this.mediaChannel = channel;
        channel.onmessage = (e) => this.onMediaData(e.data);

        const openPromise = new Promise<void>((resolve) => {
            channel.onopen = () => resolve();
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.broadcast({ type: "signal", from: this.peerId, to: hostId, data: { sdp: pc.localDescription!.toJSON() } });

        await openPromise;
        this.maxMessageSize = pc.sctp?.maxMessageSize ?? 64 * 1024;
    }

    private onMediaData(data: unknown): void {
        if (typeof data === "string") return;
        const id = this.pendingRangeIds.shift();
        if (id && this.rangePort) {
            this.rangePort.postMessage({ type: "range", id, bytes: data as ArrayBuffer }, [data as ArrayBuffer]);
        }
    }

    private createRemoteSource(): RemoteFileSource {
        const channel = new MessageChannel();
        this.rangePort = channel.port1;
        this.pendingRangeIds = [];

        channel.port1.onmessage = (e: MessageEvent<{ type: string; id: string; offset: number; size: number }>) => {
            const msg = e.data;
            if (msg.type === "requestRange") {
                this.pendingRangeIds.push(msg.id);
                this.mediaChannel?.send(JSON.stringify({ type: "requestRange", offset: msg.offset, size: msg.size }));
            }
        };
        channel.port1.start();

        return { kind: "remote", port: channel.port2, fileSize: this.media!.fileSize, maxMessageSize: this.maxMessageSize };
    }

    private teardownPeerRtc(): void {
        this.mediaChannel?.close();
        this.mediaChannel = undefined;
        this.hostPc?.close();
        this.hostPc = undefined;
        this.rangePort?.close();
        this.rangePort = undefined;
        this.pendingRangeIds = [];
    }

    private teardownHostRtc(): void {
        this.rtcHost?.close();
        this.rtcHost = undefined;
    }

    // ---- commands ---------------------------------------------------------

    private onUserCommand(command: ShareCommand): void {
        if (command.kind === "play" || command.kind === "pause") {
            this.broadcast({ type: "command", from: this.peerId, seq: 0, command });
            this.applyLocal(command);
        } else {
            const seq = Date.now();
            this.activeSeek = { seq, from: this.peerId };
            this.broadcast({ type: "command", from: this.peerId, seq, command });
            void this.performSeek(seq, command.time);
        }
    }

    private handleCommand(from: string, seq: number, command: ShareCommand): void {
        if (command.kind === "play" || command.kind === "pause") {
            this.applyLocal(command);
            return;
        }

        if (this.activeSeek && this.isStale(seq, from, this.activeSeek.seq, this.activeSeek.from)) return;
        this.activeSeek = { seq, from };
        void this.performSeek(seq, command.time);
    }

    private isStale(seq: number, from: string, curSeq: number, curFrom: string): boolean {
        if (seq !== curSeq) return seq < curSeq;
        return from < curFrom; // tie broken by peerId
    }

    private applyLocal(command: ShareCommand): void {
        if (!this.player) return;
        if (command.kind === "play") this.player.play();
        else if (command.kind === "pause") this.player.pause();
        else void this.player.seekTo(command.time);
    }

    private async performSeek(seq: number, timeMs: number): Promise<void> {
        this.player?.pause();
        await this.player?.seekTo(timeMs);
        this.broadcast({ type: "seekReady", from: this.peerId, seq });
        this.addSeekReady(this.peerId, seq);
        await this.waitForAllSeekReady(seq);
        this.player?.play();
    }

    private addSeekReady(from: string, seq: number): void {
        let set = this.seekReadySets.get(seq);
        if (!set) {
            set = new Set();
            this.seekReadySets.set(seq, set);
        }
        set.add(from);
    }

    private async waitForAllSeekReady(seq: number): Promise<void> {
        const start = Date.now();
        while (true) {
            const ready = this.seekReadySets.get(seq) ?? new Set();
            const missing = this.members().filter((id) => !ready.has(id));

            if (missing.length === 0) return;

            if (Date.now() - start > SEEK_TIMEOUT_MS) {
                for (const id of missing) this.lastSeen.delete(id);
                this.onMembersChange(this.members());
                return;
            }

            await new Promise((r) => setTimeout(r, 100));
        }
    }
}
