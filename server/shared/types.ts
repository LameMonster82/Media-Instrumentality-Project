export interface WebSocketMessage {
    kind: string
}

export interface WebSocketRequestRoomCount extends WebSocketMessage {
    kind: "requestRoomCount"
}

export interface WebSocketRoomCount extends WebSocketMessage {
    kind: "roomCount"
    count: number
}

export interface WebSocketPing extends WebSocketMessage {
    kind: "ping"
}

export interface WebSocketPong extends WebSocketMessage {
    kind: "pong"
}

export interface WebSocketRequestRoomInfo extends WebSocketMessage {
    kind: "requestRoomInfo"
}

export interface WebSocketRoomInfo extends WebSocketMessage {
    kind: "roomInfo"
    id: string,
    pingTime: number,
    rtcInfo: RTCConfiguration
}