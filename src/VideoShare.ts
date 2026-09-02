import { VideoPlayer2 } from "./player/VideoPlayer";
import { LobbyController } from "./shareplay/LobbyController";
import { BroadcastChannelSignalingTransport, WebSocketSignalingTransport, type SignalingTransport } from "./shareplay/SignalingTransport";

const createLobbyBtn = document.getElementById("createLobby") as HTMLButtonElement;
const joinInput = document.getElementById("joinInput") as HTMLInputElement;
const joinBtn = document.getElementById("joinLobby") as HTMLButtonElement;
const urlInput = document.getElementById("urlInput") as HTMLInputElement;
const hostUrlBtn = document.getElementById("hostUrl") as HTMLButtonElement;
const inviteRow = document.getElementById("inviteRow") as HTMLDivElement;
const inviteLink = document.getElementById("inviteLink") as HTMLAnchorElement;
const membersEl = document.getElementById("members") as HTMLDivElement;
const dropZone = document.getElementById("dropZone") as HTMLDivElement;
const playerContainer = document.getElementById("playerContainer") as HTMLDivElement;

let lobby: LobbyController | undefined;
let currentPlayer: VideoPlayer2 | undefined;

function makeLobbyId(): string {
    return crypto.randomUUID().slice(0, 8);
}

function inviteUrl(lobbyId: string): string {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("lobby", lobbyId);
    const ws = url.searchParams.get("ws");
    if (ws) url.searchParams.set("ws", ws);
    return url.toString();
}

function makeTransport(lobbyId: string, wsUrl?: string): SignalingTransport {
    if (wsUrl) return new WebSocketSignalingTransport(wsUrl, lobbyId);
    return new BroadcastChannelSignalingTransport(lobbyId);
}

function startLobby(lobbyId: string, wsUrl?: string): void {
    const transport = makeTransport(lobbyId, wsUrl);
    lobby = new LobbyController(lobbyId, transport);

    inviteRow.style.display = "flex";
    inviteLink.href = inviteUrl(lobbyId);
    inviteLink.textContent = inviteUrl(lobbyId);

    lobby.onMembersChange = (members) => {
        membersEl.textContent = `Members: ${members.length} other${members.length === 1 ? "" : "s"}`;
    };

    lobby.onMediaChange = () => {
        swapPlayer();
    };
}

function swapPlayer(): void {
    if (!lobby || !lobby.currentMedia) return;

    // VideoPlayer2 has no explicit destroy yet, so just replace the DOM node.
    const source = lobby.getCurrentSource();
    const player = new VideoPlayer2(source);
    lobby.setPlayer(player);

    playerContainer.replaceChildren(player.getVideo());
    currentPlayer = player;
}

function parseInvite(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
        const url = new URL(trimmed);
        return url.searchParams.get("lobby") ?? url.hash.replace(/^#/, "");
    } catch {
        return trimmed;
    }
}

createLobbyBtn.addEventListener("click", () => {
    const params = new URLSearchParams(location.search);
    startLobby(makeLobbyId(), params.get("ws") ?? undefined);
});

joinBtn.addEventListener("click", () => {
    const lobbyId = parseInvite(joinInput.value);
    if (lobbyId) {
        const params = new URLSearchParams(location.search);
        startLobby(lobbyId, params.get("ws") ?? undefined);
    }
});

hostUrlBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    if (url && lobby) lobby.hostUrl(url);
});

dropZone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => {
        const file = input.files?.[0];
        if (file && lobby) lobby.hostFile(file);
    };
    input.click();
});

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file && lobby) lobby.hostFile(file);
});

// Auto-join from ?lobby=<id>
const initial = new URLSearchParams(location.search);
const initialLobby = initial.get("lobby");
if (initialLobby) {
    startLobby(initialLobby, initial.get("ws") ?? undefined);
    joinInput.value = initialLobby;
}
