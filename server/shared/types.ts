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
    id: string
    userId: string
    hostId: string | null
    pingTime: number
    rtcInfo: RTCConfiguration
}

export interface WebSocketHostLeft extends WebSocketMessage {
    kind: "hostLeft"
}

export interface WebSocketError extends WebSocketMessage {
    kind: "error"
    message: string
}
