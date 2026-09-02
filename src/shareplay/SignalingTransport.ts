import type { LobbyMessage } from "./types";

/**
 * A lobby-scoped broadcast channel for share-play signaling. Implementations
 * only need to deliver every message to every member of the lobby; the
 * LobbyController does all filtering/coordination itself.
 */
export interface SignalingTransport {
    send(message: LobbyMessage): void;
    onMessage(handler: (message: LobbyMessage) => void): void;
    close(): void;
}

/**
 * Same-origin cross-tab transport. Useful for local dev/testing without a
 * signaling server. Each lobby gets its own BroadcastChannel name.
 */
export class BroadcastChannelSignalingTransport implements SignalingTransport {
    private channel: BroadcastChannel;
    private handler?: (message: LobbyMessage) => void;

    constructor(lobbyId: string) {
        this.channel = new BroadcastChannel(`videoshare:${lobbyId}`);
        this.channel.onmessage = (e: MessageEvent<LobbyMessage>) => this.handler?.(e.data);
    }

    send(message: LobbyMessage): void {
        this.channel.postMessage(message);
    }

    onMessage(handler: (message: LobbyMessage) => void): void {
        this.handler = handler;
    }

    close(): void {
        this.channel.close();
    }
}

/**
 * WebSocket transport. `url` is the signaling server endpoint; the server is
 * responsible for routing messages to the rest of the lobby room.
 */
export class WebSocketSignalingTransport implements SignalingTransport {
    private ws: WebSocket;
    private handler?: (message: LobbyMessage) => void;

    constructor(url: string, lobbyId: string) {
        const sep = url.includes("?") ? "&" : "?";
        this.ws = new WebSocket(`${url}${sep}lobby=${encodeURIComponent(lobbyId)}`);
        this.ws.onmessage = (e: MessageEvent<string>) => {
            try {
                this.handler?.(JSON.parse(e.data) as LobbyMessage);
            } catch {
                console.error("Bad signaling message:", e.data);
            }
        };
    }

    send(message: LobbyMessage): void {
        this.ws.send(JSON.stringify(message));
    }

    onMessage(handler: (message: LobbyMessage) => void): void {
        this.handler = handler;
    }

    close(): void {
        this.ws.close();
    }
}
