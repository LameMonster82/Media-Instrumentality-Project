export interface UrlSeekableWorkerInit {
    type: "init",
    url: string,
    targetBuffer: WebAssembly.Memory,
    atomicBuffers: SharedArrayBuffer,
    fetchBufferSize: number;
}

export interface FileSeekableWorkerInit {
    type: "init",
    file: File,
    targetBuffer: WebAssembly.Memory,
    atomicBuffers: SharedArrayBuffer,
}

export interface RtcSeekableWorkerInit {
    kind: "initRtcSeekr",
    fileSize: number,
    targetBuffer: WebAssembly.Memory,
    atomicBuffers: SharedArrayBuffer,
    bufferSize: number,
}

export interface WorkerRemoteSoruce {
    readonly kind: "remoteSource";
}

export interface RemoteFileSource {
    readonly kind: "remote";
    readonly port: MessagePort;
    readonly info: RTCConfiguration;
}
