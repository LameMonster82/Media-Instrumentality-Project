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

/**
 * Page controller for VideoShare.
 *
 * Members are declared in runtime-lifetime order, so reading the class from top
 * to bottom follows the page's own lifecycle:
 *
 *   init -> lobby -> player setup -> intents -> hosting -> helpers
 */
export class VideoShare {
    // -----------------------------------------------------------------------
    // Init (construction)
    // -----------------------------------------------------------------------

    private readonly app = el<HTMLDivElement>("app");
    private readonly topbar = el<HTMLElement>("topbar");
    private readonly brand = el<HTMLDivElement>("brand");
    private readonly brandIcon = el<HTMLElement>("brandIcon");
    private readonly lobbyControls = el<HTMLDivElement>("lobbyControls");
    private readonly createLobbyBtn = el<HTMLButtonElement>("createLobby");
    private readonly joinInput = el<HTMLInputElement>("joinInput");
    private readonly joinBtn = el<HTMLButtonElement>("joinLobby");
    private readonly lobbyStatus = el<HTMLDivElement>("lobbyStatus");
    private readonly membersIcon = el<HTMLElement>("members");
    private readonly membersCount = el<HTMLSpanElement>("membersCount");
    private readonly bandwithDisplay = el<HTMLSpanElement>("bandwithDisplay");
    private readonly inviteLink = el<HTMLAnchorElement>("inviteLink");
    private readonly stage = el<HTMLElement>("stage");
    private readonly playerContainer = el<HTMLDivElement>("playerContainer");
    private readonly emptyState = el<HTMLDivElement>("emptyState");
    private readonly dropZone = el<HTMLButtonElement>("dropZone");
    private readonly dropZoneIcon = el<HTMLElement>("dropZoneIcon");
    private readonly notice = el<HTMLDivElement>("notice");

    private lobby: Lobby | undefined;
    private player: VideoPlayer2 | undefined;
    private hostedFile: File | undefined;
    private noticeTimer: number | undefined;

    constructor() {
        this.init();
    }

    /** Style the shell, bind the UI, then honour an ?lobby=<id> deep link. */
    public init(): void {
        this.applyStyles();
        this.bindEvents();
        this.autoJoinFromUrl();
    }

    private applyStyles(): void {
        this.app.classList.add(styles.app);
        this.topbar.classList.add(styles.topbar);
        this.brand.classList.add(styles.brand);
        this.brandIcon.classList.add(styles.brandIcon);
        this.lobbyControls.classList.add(styles.lobbyControls);
        this.lobbyStatus.classList.add(styles.lobbyStatus);
        this.membersIcon.classList.add(styles.members);
        this.membersCount.classList.add(styles.membersCount);
        this.bandwithDisplay.classList.add(styles.membersCount);
        this.inviteLink.classList.add(styles.inviteLink);
        this.stage.classList.add(styles.stage);
        this.playerContainer.classList.add(styles.playerContainer);
        this.emptyState.classList.add(styles.emptyState);
        this.dropZone.classList.add(styles.dropZone);
        this.dropZoneIcon.classList.add(styles.dropZoneIcon);
        this.notice.classList.add(styles.notice, styles.hidden);
    }

    private bindEvents(): void {
        this.createLobbyBtn.addEventListener("click", () => {
            void this.startLobby();
        });

        this.joinBtn.addEventListener("click", () => {
            const lobbyId = this.parseInvite(this.joinInput.value);
            if (!lobbyId) return;
            void this.joinLobby(lobbyId);
        });

        this.inviteLink.addEventListener("click", (event) => {
            event.preventDefault();
            const url = this.inviteLink.dataset.url;
            if (!url) return;

            void navigator.clipboard.writeText(url).then(() => {
                this.inviteLink.textContent = "Copied!";
                setTimeout(() => (this.inviteLink.textContent = "Copy invite link"), 1500);
            });
        });

        this.dropZone.addEventListener("click", () => this.pickFile());

        this.dropZone.addEventListener("dragover", (event) => {
            event.preventDefault();
            this.dropZone.classList.add(styles.dragover);
        });

        this.dropZone.addEventListener("dragleave", () => {
            this.dropZone.classList.remove(styles.dragover);
        });

        this.dropZone.addEventListener("drop", (event) => {
            event.preventDefault();
            this.dropZone.classList.remove(styles.dragover);
            const file = event.dataTransfer?.files?.[0];
            if (file) this.hostFile(file);
        });
    }

    private autoJoinFromUrl(): void {
        const initialLobby = new URLSearchParams(location.search).get("lobby");
        if (!initialLobby) return;

        this.joinInput.value = initialLobby;
        void this.joinLobby(initialLobby);
    }

    // -----------------------------------------------------------------------
    // Lobby lifecycle
    // -----------------------------------------------------------------------

    /** Connect (once) to the signaling server, creating the lobby if needed. */
    public async startLobby(lobbyId?: string): Promise<Lobby> {
        if (this.lobby) return this.lobby;

        const query = lobbyId ? `?lobby=${encodeURIComponent(lobbyId)}` : "";
        const instance = new Lobby(`${this.signalingUrl()}${query}`);
        this.lobby = instance;

        instance.onUserCount((count) => {
            this.membersCount.textContent = `${count} in room`;
        });

        instance.onHostLeft(() => {
            this.showNotice("The host has left the lobby.", true);
            this.player?.pause();
        });

        try {
            const id = await instance.connect();
            this.inviteLink.href = this.buildInviteUrl(id);
            this.inviteLink.dataset.url = this.buildInviteUrl(id);

            // If a file was already playing locally before this lobby was
            // created, announce ourselves as the host and wire up sync now.
            if (!lobbyId && this.hostedFile && this.player) {
                instance.setAsHost(this.hostedFile);
                this.wireSync(instance, this.player);
            }

            return instance;
        } catch (error) {
            this.lobby = undefined;
            throw error;
        }
    }

    /** Join an existing lobby and start streaming its host's file. */
    public async joinLobby(lobbyId: string): Promise<void> {
        try {
            const instance = await this.startLobby(lobbyId);
            this.mountSeekerPlayer(instance);
        } catch {
            this.showNotice("That lobby doesn't exist.", true);
        }
    }

    // -----------------------------------------------------------------------
    // Player setup
    // -----------------------------------------------------------------------

    private showPlayer(): void {
        this.emptyState.classList.add(styles.hidden);
        this.playerContainer.classList.remove(styles.hidden);
    }

    /** Play a local file, with no lobby attached. */
    private mountLocalPlayer(file: File): void {
        const current = new VideoPlayer2(file, true);
        this.player = current;
        this.playerContainer.replaceChildren(current.getVideo());
        this.showPlayer();
    }

    /** Play a local file and drive the lobby from it. */
    private mountHostPlayer(instance: Lobby, file: File): void {
        const current = new VideoPlayer2(file, true);
        this.player = current;
        this.wireSync(instance, current);
        this.playerContainer.replaceChildren(current.getVideo());
        this.showPlayer();
    }

    /** Play whatever the lobby's host is serving, over the seeker channel. */
    private mountSeekerPlayer(instance: Lobby): void {
        const port = instance.setupSeekerChannel();
        const remoteFile: RemoteFileSource = {
            kind: "remote",
            port,
            info: instance.getRTCInfo()!,
        };

        const current = new VideoPlayer2(remoteFile, true);
        this.player = current;
        this.wireSync(instance, current);
        this.playerContainer.replaceChildren(current.getVideo());
        this.showPlayer();

        this.readBandswith(current);
        void this.syncInitialState(instance, current);
    }

    // -----------------------------------------------------------------------
    // Intents / playback sync
    // -----------------------------------------------------------------------

    /** Mirror playback in both directions between the lobby and a player. */
    private wireSync(lobby: Lobby, player: VideoPlayer2): void {
        player.onPlay((time, promise) => lobby.intent(Intent.Play, time, promise));
        player.onPause((time, promise) => lobby.intent(Intent.Pause, time, promise));
        player.onSeek((time, promise) => lobby.intent(Intent.Seek, time, promise));

        lobby.onPlay((time) => player.play(time));
        lobby.onPause((time) => player.pause(time));
        lobby.onSeek((time) => player.seekTo(time));

        lobby.onLoadingStateChange((loading) => player.setLoadingState(loading));

        lobby.onIntentStatus(() => {
            let intent = Intent.Play;
            if (player.isSeek()) intent = Intent.Seek;
            else if (player.isPaused()) intent = Intent.Pause;
            return { intent, time: player.getTime() };
        });
    }

    /** Catch a freshly joined seeker up to the host's current state. */
    private async syncInitialState(instance: Lobby, current: VideoPlayer2): Promise<void> {
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

    private async readBandswith(current: VideoPlayer2) {
        while (true) {
            this.bandwithDisplay.textContent = `${current.getBandwith()} MB/s`;
            await new Promise(r => setTimeout(r, 100));
        }
    }

    // -----------------------------------------------------------------------
    // Hosting a file
    // -----------------------------------------------------------------------

    private hostFile(file: File): void {
        this.hostedFile = file;
        if (this.lobby) {
            this.lobby.setAsHost(file);
            this.mountHostPlayer(this.lobby, file);
        } else {
            this.mountLocalPlayer(file);
        }
    }

    private pickFile(): void {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "video/*";
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) this.hostFile(file);
        };
        input.click();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private signalingUrl(): string {
        const configured = import.meta.env.VITE_SIGNALING_URL;
        if (configured) return configured;
        return `ws://${location.hostname}:${signalingPort}`;
    }

    private buildInviteUrl(lobbyId: string): string {
        const url = new URL(location.href);
        url.search = "";
        url.hash = "";
        url.searchParams.set("lobby", lobbyId);
        return url.toString();
    }

    private parseInvite(raw: string): string | undefined {
        const trimmed = raw.trim();
        if (!trimmed) return undefined;

        try {
            const url = new URL(trimmed);
            return url.searchParams.get("lobby") ?? url.hash.replace(/^#/, "");
        } catch {
            return trimmed;
        }
    }

    private showNotice(message: string, isError = false): void {
        this.notice.textContent = message;
        this.notice.classList.toggle(styles.noticeError, isError);
        this.notice.classList.remove(styles.hidden);

        if (this.noticeTimer) clearTimeout(this.noticeTimer);
        this.noticeTimer = window.setTimeout(() => {
            this.notice.classList.add(styles.hidden);
        }, 5000);
    }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

new VideoShare();
