import { workletName, type AllAudioWorkletMessages, type WorkerAudioDataInit } from "./audioTypes";

class AudioStreamTrackWorker extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private static readonly MAX_PENDING = 4; // tunable; was effectively 2
    private current: WorkerAudioDataInit | null = null;
    private pending: WorkerAudioDataInit[] = [];
    private offset = 0;
    private active = true;
    private paused = false;


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
                    case "pause": this.paused = true; break;
                    case "play": this.paused = false; break;
                    case "close": this.active = false; break;
                }
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const [output] = outputs;

        if (this.paused) {
            for (const ch of output) ch.fill(0);
            return this.active;
        }

        const n = output[0].length;
        const numOut = output.length;
        let outPos = 0;

        while (outPos < n) {
            if (this.current === null && this.pending.length > 0) {
                this.current = this.pending.shift()!;
                this.offset = 0;
            }

            if (this.current === null) {
                for (let ch = 0; ch < numOut; ch++)
                    output[ch].fill(0, outPos, n);
                return this.active;
            }

            const frame = this.current;
            const numCh = Math.min(numOut, frame.numberOfChannels);
            const copy = Math.min(frame.data[0].length - this.offset, n - outPos);

            for (let ch = 0; ch < numCh; ch++)
                output[ch].set(frame.data[ch].subarray(this.offset, this.offset + copy), outPos);
            for (let ch = numCh; ch < numOut; ch++)
                output[ch].fill(0, outPos, outPos + copy);

            this.offset += copy;
            outPos += copy;

            if (this.offset >= frame.data[0].length) {
                this.offset = 0;
                this.current = null;
            }
        }

        return this.active;
    }
}
registerProcessor(workletName, AudioStreamTrackWorker);