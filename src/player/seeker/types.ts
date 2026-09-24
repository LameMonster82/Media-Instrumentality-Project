export interface SeekerWorkerInit {
    kind: "initSeeker",
    targetBuffer: WebAssembly.Memory,
    atomicBuffers: SharedArrayBuffer,
    bufferSize: number;
}

export interface UrlSeekableWorkerInit extends SeekerWorkerInit {
    url: string,
}

export interface FileSeekableWorkerInit extends SeekerWorkerInit {
    file: File,
}

export interface RtcSeekableWorkerInit extends SeekerWorkerInit {
    fileSize: number,
}

export interface RtcSeekableWorkerAddChannel {
    kind: "addChannel"
    channel: RTCDataChannel
}


export interface OutsideSource {
    kind: "outsideSource";
}

export interface WorkerRemoteSoruce {
    readonly kind: "remoteSource";
    readonly resolveInfo: () => void;
}
