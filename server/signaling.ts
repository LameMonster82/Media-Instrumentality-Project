import { WebSocketServer, WebSocket } from 'ws';
import type { WebSocketError, WebSocketHostLeft, WebSocketPing, WebSocketRoomCount, WebSocketRoomInfo } from '@Server/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 8080);
const PING_INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 5_000;

// Used when Cloudflare TURN credentials are not configured so the server still
// works on a local network (host candidates are enough for most LAN setups).
const FALLBACK_RTC: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface Client {
    id: string;
    ws: WebSocket;
    alive: boolean;
    turnUsername: string | undefined;
    rtcInfo: Promise<RTCConfiguration>;
}

interface Room {
    id: string;
    clients: Map<string, Client>;
    hostId: string | null;
}

const rooms = new Map<string, Room>();

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

type WireMessage = {
    kind: string;
    [key: string]: unknown;
};

function send(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function sendTo(room: Room, targetId: string, message: object): void {
    const target = room.clients.get(targetId);
    if (target) send(target.ws, message);
}

function broadcast(room: Room, message: object, exceptId?: string): void {
    for (const client of room.clients.values()) {
        if (client.id === exceptId) continue;
        send(client.ws, message);
    }
}

function roomCountMessage(room: Room): WebSocketRoomCount {
    return { kind: 'roomCount', count: room.clients.size };
}

function roomInfoMessage(room: Room, client: Client, rtcInfo: RTCConfiguration): WebSocketRoomInfo {
    return {
        kind: 'roomInfo',
        id: room.id,
        userId: client.id,
        hostId: room.hostId,
        pingTime: PING_TIMEOUT_MS,
        rtcInfo,
    };
}

// ---------------------------------------------------------------------------
// TURN credential management (best effort)
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out')), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

async function createRtcConfig(): Promise<{ config: RTCConfiguration; turnUsername: string | undefined }> {
    const tokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID;
    const apiKey = process.env.CLOUDFLARE_TURN_TOKEN_API;

    if (!tokenId || !apiKey) return { config: FALLBACK_RTC, turnUsername: undefined };

    try {
        const response = await withTimeout(
            fetch(
                `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ttl: 86400 }),
                },
            ),
            5000,
        );

        if (!response.ok) throw new Error(`TURN credential request failed with ${response.status}`);

        const config = (await response.json()) as RTCConfiguration;
        const turnUsername = config.iceServers?.find((server) => server.username)?.username;
        return { config, turnUsername };
    } catch (error) {
        console.warn('Falling back to public STUN:', error);
        return { config: FALLBACK_RTC, turnUsername: undefined };
    }
}

async function revokeTurnCredentials(username: string | undefined): Promise<void> {
    if (!username) return;

    const tokenId = process.env.CLOUDFLARE_TURN_TOKEN_ID;
    const apiKey = process.env.CLOUDFLARE_TURN_TOKEN_API;
    if (!tokenId || !apiKey) return;

    try {
        await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/${username}/revoke`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}` },
            },
        );
    } catch (error) {
        console.warn('Failed to revoke TURN credentials:', error);
    }
}

// ---------------------------------------------------------------------------
// Room management
// ---------------------------------------------------------------------------

function getOrCreateRoom(requestedId: string | null): Room {
    if (requestedId) {
        const existing = rooms.get(requestedId);
        if (existing) return existing;
    }

    const room: Room = {
        id: requestedId ?? crypto.randomUUID().slice(0, 8),
        clients: new Map(),
        hostId: null,
    };
    rooms.set(room.id, room);
    return room;
}

function removeClient(room: Room, client: Client): void {
    if (!room.clients.delete(client.id)) return;

    void revokeTurnCredentials(client.turnUsername);

    if (client.ws.readyState === WebSocket.OPEN) client.ws.close();
    client.ws.terminate();

    const wasHost = room.hostId === client.id;
    if (wasHost) room.hostId = null;

    if (room.clients.size === 0) {
        rooms.delete(room.id);
    } else {
        if (wasHost) {
            broadcast(room, { kind: 'hostLeft' } satisfies WebSocketHostLeft);
        }
        broadcast(room, roomCountMessage(room));
    }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

async function handleMessage(client: Client, room: Room, raw: string): Promise<void> {
    let message: WireMessage;
    try {
        message = JSON.parse(raw) as WireMessage;
    } catch {
        return;
    }

    switch (message.kind) {
        case 'pong':
            client.alive = true;
            return;

        case 'requestRoomCount':
            send(client.ws, roomCountMessage(room));
            return;

        case 'requestRoomInfo': {
            const rtcInfo = await client.rtcInfo;
            send(client.ws, roomInfoMessage(room, client, rtcInfo));
            return;
        }

        case 'newHost':
            room.hostId = client.id;
            broadcast(room, { kind: 'newHost', hostId: client.id }, client.id);
            return;

        case 'requestSeeker': {
            if (!room.hostId) return;
            sendTo(room, room.hostId, { kind: 'requestSeeker', userId: client.id });
            return;
        }

        case 'offerSDP':
        case 'answerSDP':
        case 'iceCandidates': {
            const targetId = message.targetId;
            if (typeof targetId === 'string') {
                sendTo(room, targetId, message);
            } else {
                broadcast(room, message, client.id);
            }
            return;
        }

        default:
            // intents, confirmations and status messages are shared with the room.
            broadcast(room, message, client.id);
            return;
    }
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws: WebSocket, req: { url?: string }) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const requestedLobbyId = url.searchParams.get('lobby');

    // Joining a specific lobby requires it to exist. Creating a lobby (no id)
    // always succeeds and allocates a fresh id.
    if (requestedLobbyId && !rooms.has(requestedLobbyId)) {
        send(ws, { kind: 'error', message: 'Lobby not found' } satisfies WebSocketError);
        ws.close();
        return;
    }

    const room = getOrCreateRoom(requestedLobbyId);
    const client: Client = {
        id: crypto.randomUUID().slice(0, 8),
        ws,
        alive: true,
        turnUsername: undefined,
        rtcInfo: Promise.resolve(FALLBACK_RTC),
    };

    client.rtcInfo = createRtcConfig().then(({ config, turnUsername }) => {
        client.turnUsername = turnUsername;
        return config;
    });

    room.clients.set(client.id, client);

    // A ping is sent immediately so the client's first-message handshake can
    // complete and it can then request its room info.
    send(client.ws, { kind: 'ping' } satisfies WebSocketPing);
    broadcast(room, roomCountMessage(room), client.id);

    ws.on('message', (data: { toString(): string }) => {
        void handleMessage(client, room, data.toString()).catch((error) => {
            console.error('Failed to handle message:', error);
        });
    });

    ws.on('close', () => removeClient(room, client));
    ws.on('error', () => removeClient(room, client));
});

const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
        for (const client of room.clients.values()) {
            if (!client.alive) {
                removeClient(room, client);
                continue;
            }

            client.alive = false;
            send(client.ws, { kind: 'ping' } satisfies WebSocketPing);
        }
    }
}, PING_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

console.log(`share-play signaling server listening on ws://localhost:${PORT}`);
