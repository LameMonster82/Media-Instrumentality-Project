import { workletName, type AllAudioWorkletMessages, type WorkerAudioDataInit } from "./audioTypes";

class AudioStreamTrackWorker extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private static readonly MAX_PENDING = 4; // tunable; was effectively 2
    private current: WorkerAudioDataInit | null = null;
    private pending: WorkerAudioDataInit[] = [];
    private offset = 0;
    private active = true;


    constructor() {
        super();

        this.port.onmessage = (e: MessageEvent<AllAudioWorkletMessages>) => {
            if (e.data.kind === "audioDataInit") {
                this.pending.push(e.data);
                if (this.pending.length > AudioStreamTrackWorker.MAX_PENDING)
                    this.pending.splice(0, this.pending.length - AudioStreamTrackWorker.MAX_PENDING);
            } else {
                switch (e.data.kind) {
                    case "flush": this.current = null; this.pending.length = 0; this.offset = 0; break;
                    case "close": this.active = false; break;
                }
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const [output] = outputs;

        if (this.current === null && this.pending.length > 0) {
            this.current = this.pending.shift()!;
            this.offset = 0;
        }

        const n = output[0].length;
        let outputOffset = 0;
        while (this.current) {
            const written = this.writeToOutput(this.current, output, outputOffset);
            if (written + outputOffset >= n) break;
            console.warn("UNDERRUN");
            outputOffset = written;
            this.offset = 0;
            this.current = this.pending.shift() ?? null;  // catch-up: oldest already trimmed on overflow
        }

        if (this.current === null) {
            //for (const ch of output) ch.fill(0);      // silence-pad on underrun
            console.warn("NO AUDIO");
            return this.active;
        }

        this.offset += n;
        if (this.offset >= this.current.data[0].length) {
            this.offset = 0;
            this.current = this.pending.shift() ?? null;  // catch-up: oldest already trimmed on overflow
        }

        return this.active;
    }

    private writeToOutput(current: WorkerAudioDataInit, output: Float32Array<ArrayBufferLike>[], offset: number): number {
        const minCh = Math.min(output.length, current.numberOfChannels);
        let written = 0;
        for (let ch = 0; ch < minCh; ch++) {
            const writing = current.data[ch].subarray(this.offset, this.offset + output[ch].length - offset);
            output[ch].set(writing, offset);
            if (ch === 0)
                written = writing.length;
        }

        return written;
    }

    private copyFromObject(data: WorkerAudioDataInit, output: Float32Array[]): number {
        let samplesCopied = 0;
        for (let ch = 0; ch < data.numberOfChannels; ch++) {
            const srcData = data.data[ch].subarray(this.offset, this.offset + output[ch].length);
            output[ch].set(srcData);
            samplesCopied = srcData.length;
        }

        return samplesCopied;
    }
}
registerProcessor(workletName, AudioStreamTrackWorker);