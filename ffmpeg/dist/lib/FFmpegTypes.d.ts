export interface FFmpegWorker extends DedicatedWorkerGlobalScope {
    read_packet: (ptr: bigint, size: number) => number;
    seek_packet: (offset: bigint, whence: number) => bigint;
    send_sw_frame: (returnPtr: number | bigint) => void;
    set_timestamp: (time: bigint) => void;
}
