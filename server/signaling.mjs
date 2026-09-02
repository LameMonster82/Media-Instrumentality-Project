import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 8080);
const wss = new WebSocketServer({ port });

// lobbyId -> set of connected sockets
const rooms = new Map();

wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const lobbyId = url.searchParams.get('lobby');

    if (!lobbyId) {
        ws.close(4000, 'missing lobby id');
        return;
    }

    let room = rooms.get(lobbyId);
    if (!room) {
        room = new Set();
        rooms.set(lobbyId, room);
    }
    room.add(ws);

    // Relay every message to everyone else in the lobby. Clients filter on
    // peerId / from / to themselves, so broadcasting back to the sender is
    // harmless.
    ws.on('message', (data) => {
        const text = data.toString();
        for (const client of room) {
            if (client.readyState === 1) client.send(text);
        }
    });

    ws.on('close', () => {
        room.delete(ws);
        if (room.size === 0) rooms.delete(lobbyId);
    });
});

console.log(`share-play signaling server listening on ws://localhost:${port}`);
