import type { Intent } from "@/player/types";
import type { WebSocketError, WebSocketHostLeft, WebSocketMessage, WebSocketPing, WebSocketPong, WebSocketRequestRoomCount, WebSocketRequestRoomInfo, WebSocketRoomCount, WebSocketRoomInfo } from "@Server/types";

export interface WebSocketIntent extends WebSocketMessage {
    kind: "intent";
    intent: Intent;
    time: number;
}

export interface WebSocketConfirmIntent extends WebSocketMessage {
    kind: "intentConfirm";
    intent: Intent;
}

export interface WebSocketIntentRequest extends WebSocketMessage {
    kind: "intentRequest";
}

export interface WebSocketIntentStatus extends WebSocketMessage {
    kind: "intentStatus";
    intent: Intent;
    time: number;
}

export interface WebSocketRequestSeeker extends WebSocketMessage {
    kind: "requestSeeker";
    userId: string;
}

export interface WebSocketOfferSDP extends WebSocketMessage {
    kind: "offerSDP";
    userId: string;
    targetId: string;
    fileSize: number;
    sdp: RTCSessionDescriptionInit;
}

export interface WebSocketAnswerSDP extends WebSocketMessage {
    kind: "answerSDP";
    userId: string;
    targetId?: string;
    sdp: RTCSessionDescriptionInit;
}

export interface WebSocketICECandidates extends WebSocketMessage {
    kind: "iceCandidates";
    userId: string;
    targetId?: string;
    candidate: RTCIceCandidateInit;
}

export interface WebSocketNewHost extends WebSocketMessage {
    kind: "newHost";
    hostId?: string;
}

export type AllWebsocketMessages = WebSocketRequestRoomCount | WebSocketRoomCount | WebSocketRoomInfo | WebSocketPing | WebSocketPong | WebSocketRequestRoomInfo | WebSocketError | WebSocketHostLeft |
    WebSocketIntent | WebSocketConfirmIntent | WebSocketIntentRequest | WebSocketIntentStatus | WebSocketRequestSeeker | WebSocketNewHost |
    WebSocketOfferSDP | WebSocketAnswerSDP | WebSocketICECandidates;

export type MessageByKind<T extends WebSocketMessage> = T["kind"];
export type RespondEventByKind2<T extends WebSocketMessage, E extends MessageByKind<T>> = Extract<T, { kind: E; }>;
export type DictionaryWebSocketEvent<T extends WebSocketMessage> = {
    [K in MessageByKind<T>]?: { callback: (data: RespondEventByKind2<T, K>) => void; once: boolean; }[];
};

export interface RTCRequestData extends WebSocketMessage {
    kind: "requestData";
    offset: number;
    size: number;
}

export interface RTCDataRequesttAnswered extends WebSocketMessage {
    kind: "requestAnswered";
}
