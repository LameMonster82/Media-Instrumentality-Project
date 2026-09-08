import type { RemoteFileSource } from "./player/seeker/types";
import { Intent } from "./player/types";
import { VideoPlayer2 } from "./player/VideoPlayer";
import Lobby from "./shareplay/lobby";

// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-var
declare var self: Window;

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

let lobby: Lobby | undefined;
let currentPlayer: VideoPlayer2 | undefined;

function inviteUrl(lobbyId: string): string {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("lobby", lobbyId);
    const ws = url.searchParams.get("ws");
    if (ws) url.searchParams.set("ws", ws);
    return url.toString();
}

async function startLobby(wsUrl: string, lobbyId?: string): Promise<void> {
    let more = "";
    if (lobbyId)
        more = `?lobby=${encodeURIComponent(lobbyId)}`
    lobby = new Lobby(`${wsUrl}${more}`);

    lobbyId = await lobby.connect();

    inviteRow.style.display = "flex";
    inviteLink.href = inviteUrl(lobbyId);
    inviteLink.textContent = inviteUrl(lobbyId);

    lobby.onUserCount((members) => {
        membersEl.textContent = `Members: ${members} other${members === 1 ? "" : "s"}`;
    });
}

function swapPlayer(): void {
    if (!lobby) return;

    const file = lobby.hostFile();
    if (file) {
        currentPlayer = new VideoPlayer2(file);
    } else {
        const port = lobby.setupSeekerChannel();
        const remoteFile: RemoteFileSource = {
            kind: "remote",
            port: port,
            info: lobby.getRTCInfo()!,
        }
        currentPlayer = new VideoPlayer2(remoteFile);
    }

    const inetntEvent = async (intent: Intent, time: number) => {
        currentPlayer!.setLoadingState(true);
        await lobby!.intent(intent, time);
        currentPlayer!.setLoadingState(false);
    }

    lobby.onIntentStatus(() => {
        let intent = Intent.Play;
        if (currentPlayer!.isPaused())
            intent = Intent.Pause;
        if (currentPlayer!.isSeek())
            intent = Intent.Seek;
        return {
            intent,
            time: currentPlayer!.getTime()
        }
    })

    currentPlayer.onPlay((time) => lobby!.intent(Intent.Play, time));
    currentPlayer.onPause((time) => lobby!.intent(Intent.Pause, time));
    currentPlayer.onSeek((time) => lobby!.intent(Intent.Seek, time));

    lobby.onPlay((time) => { currentPlayer!.play(time); return Promise.resolve(); });
    lobby.onPause((time) => { currentPlayer!.pause(time); return Promise.resolve(); })
    lobby.onSeek((time) => currentPlayer!.seekTo(time))

    playerContainer.replaceChildren(currentPlayer.getVideo());

    currentPlayer.init().then(async () => {
        if (lobby!.hostFile() !== null) return;
        const status = await lobby!.getStatus();
        const currTime = currentPlayer!.getTime();
        if (status.time - 1 > currTime || status.time + 1 < currTime) {
            await currentPlayer!.seekTo(status.time);
        }

        if (status.intent === Intent.Play) {
            currentPlayer!.play(status.time);
        } else {
            currentPlayer!.pause(status.time);
        }
    })
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
    startLobby("ws://localhost:8080");
});

joinBtn.addEventListener("click", () => {
    const lobbyId = parseInvite(joinInput.value);
    if (lobbyId) {
        startLobby("ws://localhost:8080", lobbyId);
    }
});

hostUrlBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    //if (url && lobby) lobby.hostUrl(url);
});

dropZone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => {
        const file = input.files?.[0];
        if (file && lobby) {
            lobby.setAsHost(file);
            swapPlayer();
        }
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
    if (file && lobby) {
        lobby.setAsHost(file);
        swapPlayer();
    }
});

// Auto-join from ?lobby=<id>
const initial = new URLSearchParams(location.search);
const initialLobby = initial.get("lobby");
if (initialLobby) {
    joinInput.value = initialLobby;
    await startLobby("ws://localhost:8080", initialLobby);
    swapPlayer();
}
