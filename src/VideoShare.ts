import type { RemoteFileSource } from "./player/seeker/types";
import { Intent } from "./player/types";
import { VideoPlayer2 } from "./player/VideoPlayer";
import Lobby from "./shareplay/lobby";
import styles from "./VideoShare.module.css";

const signalingPort = 8080;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

const app = el<HTMLDivElement>("app");
const topbar = el<HTMLElement>("topbar");
const brand = el<HTMLDivElement>("brand");
const brandIcon = el<HTMLElement>("brandIcon");
const lobbyControls = el<HTMLDivElement>("lobbyControls");
const createLobbyBtn = el<HTMLButtonElement>("createLobby");
const joinInput = el<HTMLInputElement>("joinInput");
const joinBtn = el<HTMLButtonElement>("joinLobby");
const lobbyStatus = el<HTMLDivElement>("lobbyStatus");
const membersIcon = el<HTMLElement>("members");
const membersCount = el<HTMLSpanElement>("membersCount");
const inviteLink = el<HTMLAnchorElement>("inviteLink");
const stage = el<HTMLElement>("stage");
const playerContainer = el<HTMLDivElement>("playerContainer");
const emptyState = el<HTMLDivElement>("emptyState");
const dropZone = el<HTMLButtonElement>("dropZone");
const dropZoneIcon = el<HTMLElement>("dropZoneIcon");
const notice = el<HTMLDivElement>("notice");

app.classList.add(styles.app);
topbar.classList.add(styles.topbar);
brand.classList.add(styles.brand);
brandIcon.classList.add(styles.brandIcon);
lobbyControls.classList.add(styles.lobbyControls);
lobbyStatus.classList.add(styles.lobbyStatus);
membersIcon.classList.add(styles.members);
membersCount.classList.add(styles.membersCount);
inviteLink.classList.add(styles.inviteLink);
stage.classList.add(styles.stage);
playerContainer.classList.add(styles.playerContainer);
emptyState.classList.add(styles.emptyState);
dropZone.classList.add(styles.dropZone);
dropZoneIcon.classList.add(styles.dropZoneIcon);
notice.classList.add(styles.notice, styles.hidden);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let lobby: Lobby | undefined;
let player: VideoPlayer2 | undefined;
let hostedFile: File | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signalingUrl(): string {
    const configured = import.meta.env.VITE_SIGNALING_URL;
    if (configured) return configured;
    return `ws://${location.hostname}:${signalingPort}`;
}

function buildInviteUrl(lobbyId: string): string {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("lobby", lobbyId);
    return url.toString();
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

function showPlayer(): void {
    emptyState.classList.add(styles.hidden);
    playerContainer.classList.remove(styles.hidden);
}

let noticeTimer: number | undefined;

function showNotice(message: string, isError = false): void {
    notice.textContent = message;
    notice.classList.toggle(styles.noticeError, isError);
    notice.classList.remove(styles.hidden);

    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
        notice.classList.add(styles.hidden);
    }, 5000);
}

// ---------------------------------------------------------------------------
// Lobby lifecycle
// ---------------------------------------------------------------------------

async function startLobby(lobbyId?: string): Promise<Lobby> {
    if (lobby) return lobby;

    const query = lobbyId ? `?lobby=${encodeURIComponent(lobbyId)}` : "";
    const instance = new Lobby(`${signalingUrl()}${query}`);
    lobby = instance;

    instance.onUserCount((count) => {
        membersCount.textContent = `${count} in room`;
    });

    instance.onHostLeft(() => {
        showNotice("The host has left the lobby.", true);
        player?.pause();
    });

    try {
        const id = await instance.connect();
        inviteLink.href = buildInviteUrl(id);
        inviteLink.dataset.url = buildInviteUrl(id);

        // If a file was already playing locally before this lobby was created,
        // announce ourselves as the host and wire up sync right away.
        if (!lobbyId && hostedFile && player) {
            instance.setAsHost(hostedFile);
            wireSync(instance, player);
        }

        return instance;
    } catch (error) {
        lobby = undefined;
        throw error;
    }
}

async function joinLobby(lobbyId: string): Promise<void> {
    try {
        const instance = await startLobby(lobbyId);
        mountSeekerPlayer(instance);
    } catch {
        showNotice("That lobby doesn't exist.", true);
    }
}

// ---------------------------------------------------------------------------
// Player mounting + sync
// ---------------------------------------------------------------------------

function wireSync(instance: Lobby, current: VideoPlayer2): void {
    current.onPlay((time) => instance.intent(Intent.Play, time));
    current.onPause((time) => instance.intent(Intent.Pause, time));
    current.onSeek((time) => instance.intent(Intent.Seek, time));

    instance.onPlay((time) => {
        current.play(time);
        return Promise.resolve();
    });
    instance.onPause((time) => {
        current.pause(time);
        return Promise.resolve();
    });
    instance.onSeek((time) => current.seekTo(time));

    instance.onSeekStateChange((seeking) => current.setLocked(seeking));

    instance.onIntentStatus(() => {
        let intent = Intent.Play;
        if (current.isSeek()) intent = Intent.Seek;
        else if (current.isPaused()) intent = Intent.Pause;
        return { intent, time: current.getTime() };
    });
}

async function syncInitialState(instance: Lobby, current: VideoPlayer2): Promise<void> {
    await current.init();
    if (instance.hostFile() !== null) return;

    const status = await instance.getStatus();
    const currentTime = current.getTime();

    if (Math.abs(status.time - currentTime) > 1000) {
        await current.seekTo(status.time);
    }

    if (status.intent === Intent.Play) {
        current.play(status.time);
    } else {
        current.pause(status.time);
    }
}

function mountLocalPlayer(file: File): void {
    const current = new VideoPlayer2(file);
    player = current;
    playerContainer.replaceChildren(current.getVideo());
    showPlayer();
}

function mountHostPlayer(instance: Lobby, file: File): void {
    const current = new VideoPlayer2(file);
    player = current;
    wireSync(instance, current);
    playerContainer.replaceChildren(current.getVideo());
    showPlayer();
}

function mountSeekerPlayer(instance: Lobby): void {
    const port = instance.setupSeekerChannel();
    const remoteFile: RemoteFileSource = {
        kind: "remote",
        port,
        info: instance.getRTCInfo()!,
    };

    const current = new VideoPlayer2(remoteFile);
    player = current;
    wireSync(instance, current);
    playerContainer.replaceChildren(current.getVideo());
    showPlayer();

    void syncInitialState(instance, current);
}

// ---------------------------------------------------------------------------
// Hosting a file
// ---------------------------------------------------------------------------

function hostFile(file: File): void {
    hostedFile = file;
    if (lobby) {
        lobby.setAsHost(file);
        mountHostPlayer(lobby, file);
    } else {
        mountLocalPlayer(file);
    }
}

function pickFile(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => {
        const file = input.files?.[0];
        if (file) hostFile(file);
    };
    input.click();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

createLobbyBtn.addEventListener("click", () => {
    void startLobby();
});

joinBtn.addEventListener("click", () => {
    const lobbyId = parseInvite(joinInput.value);
    if (!lobbyId) return;
    void joinLobby(lobbyId);
});

inviteLink.addEventListener("click", (event) => {
    event.preventDefault();
    const url = inviteLink.dataset.url;
    if (!url) return;

    void navigator.clipboard.writeText(url).then(() => {
        inviteLink.textContent = "Copied!";
        setTimeout(() => (inviteLink.textContent = "Copy invite link"), 1500);
    });
});

dropZone.addEventListener("click", pickFile);

dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add(styles.dragover);
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove(styles.dragover);
});

dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove(styles.dragover);
    const file = event.dataTransfer?.files?.[0];
    if (file) hostFile(file);
});

// ---------------------------------------------------------------------------
// Auto-join from ?lobby=<id>
// ---------------------------------------------------------------------------

const initialLobby = new URLSearchParams(location.search).get("lobby");
if (initialLobby) {
    joinInput.value = initialLobby;
    void joinLobby(initialLobby);
}
