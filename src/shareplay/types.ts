// Shared types for the share-play (watch-together) feature.

export type ShareCommand =
    | { kind: "play" }
    | { kind: "pause" }
    | { kind: "seek"; time: number }; // time in milliseconds

export interface MediaInfo {
    mode: "file" | "url";
    fileSize: number;
    fileName: string;
    url?: string;
}

export type RtcSignal =
    | { sdp: RTCSessionDescriptionInit }
    | { ice: RTCIceCandidateInit };

// Messages broadcast through the signaling transport. The transport is assumed
// to be lobby-scoped (a room per lobbyId), so every member receives every
// message and filters on its own.
export type LobbyMessage =
    | { type: "hello"; peerId: string; lobbyId: string }
    | { type: "ping"; peerId: string }
    | { type: "signal"; from: string; to: string; data: RtcSignal }
    | { type: "command"; from: string; seq: number; command: ShareCommand }
    | { type: "seekReady"; from: string; seq: number }
    | { type: "mediaInfo"; from: string; ts: number; media: MediaInfo };

export const PING_INTERVAL_MS = 5000;
export const PEER_TIMEOUT_MS = 15000; // 3 missed pings
export const SEEK_TIMEOUT_MS = 10000;

// Free STUN + free hosted TURN (Open Relay by Metered). Swap credentials when
// moving to a dedicated TURN account / coturn.
export const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
        {
            urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443"],
            username: "openrelayproject",
            credential: "openrelayproject",
        },
    ],
};

// Minimal surface the share controller needs from VideoPlayer2.
export interface SharePlayPlayer {
    play(): void;
    pause(): void;
    seekTo(timeMs: number): Promise<void>;
    setCommandHandler(handler: (command: ShareCommand) => void): void;
}
