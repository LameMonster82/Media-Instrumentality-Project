import { WebSocketServer, WebSocket } from 'ws';
import type { WebSocketPing, WebSocketPong, WebSocketRequestRoomCount, WebSocketRequestRoomInfo, WebSocketRoomCount, WebSocketRoomInfo } from "@Server/types";

const PING_TIMER = 5000;
const PING = JSON.stringify({ kind: 'ping' } as WebSocketPing);
interface Client {
    ws: WebSocket,
    pingTimer: NodeJS.Timeout,
    pingResolve: ((t: boolean) => void) | undefined;
}


const port = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port });

// lobbyId -> set of connected sockets
const rooms = new Map<string, Client[]>();

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let lobbyId = url.searchParams.get('lobby');

    let room: Client[] | undefined = undefined;
    if (lobbyId)
        room = rooms.get(lobbyId);

    if (!room) {
        room = [];
        lobbyId = crypto.randomUUID().slice(0, 8);
        rooms.set(lobbyId, room);
    }
    if (room.some(r => r.ws === ws)) {
        return;
    }

    const cred = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.CLOUDFLARE_TURN_TOKEN_ID}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_TOKEN_API}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ ttl: 86400 })
    });
    if (!cred.ok) {
        console.log(cred);
        throw new Error();
    }

    const info = await cred.json() as RTCConfiguration;

    const disconnect = () => {
        const filtered = room.filter(c => c.ws !== ws);
        ws.close();
        if (filtered.length === 0) {
            rooms.delete(lobbyId!);
        } else {
            rooms.set(lobbyId!, filtered);
            const roomCount = JSON.stringify({ kind: "roomCount", count: filtered.length } as WebSocketRoomCount);
            for (const client of room) {
                if (client.ws.readyState === WebSocket.OPEN)
                    client.ws.send(roomCount);
            }
        }
    };

    const pingTimer = setInterval(async () => {
        const { promise, resolve } = Promise.withResolvers<boolean>();
        clientRoom.pingResolve = resolve;
        ws.send(PING);
        const timeout = new Promise<boolean>(r => setTimeout(() => r(false), PING_TIMER));
        const result = await Promise.race([promise, timeout]);

        if (!result) {
            disconnect();
        }

    }, PING_TIMER * 2);

    const clientRoom: Client = {
        ws,
        pingTimer,
        pingResolve: undefined
    };

    room.push(clientRoom);


    ws.on('message', (data) => {
        const text = data.toString();
        const jsonify = JSON.parse(text) as WebSocketPong | WebSocketRequestRoomInfo | WebSocketRequestRoomCount;
        if (jsonify.kind === "pong") {
            if (clientRoom.pingResolve)
                clientRoom.pingResolve(true);
            return;
        }
        if (jsonify.kind === "requestRoomInfo") {
            ws.send(JSON.stringify({
                kind: "roomInfo",
                id: lobbyId,
                userCount: room.length,
                pingTime: PING_TIMER,
                rtcInfo: info
            } as WebSocketRoomInfo));
            return;
        }
        if (jsonify.kind === "requestRoomCount") {
            ws.send(JSON.stringify({
                kind: "roomCount",
                count: room.length
            } as WebSocketRoomCount));
        }

        for (const client of room) {
            if (client.ws.readyState === WebSocket.OPEN && client.ws !== ws)
                client.ws.send(text);
        }
    });

    ws.on('close', disconnect);
    ws.send(PING);

    for (const client of room) {
        if (client.ws.readyState === WebSocket.OPEN && client.ws !== ws)
            client.ws.send(JSON.stringify({
                kind: "roomCount",
                count: room.length
            } as WebSocketRoomCount));
    }
});

console.log(`share-play signaling server listening on ws://localhost:${port}`);
