import { workletName, type AllAudioWorkletMessages, type WorkerAudioDataInit } from "./audioTypes";

class AudioStreamTrackWorker extends AudioWorkletProcessor implements AudioWorkletProcessorImpl {
    private nextOne: WorkerAudioDataInit | null = null;
    private current: WorkerAudioDataInit | null = null;
    private offset: number = 0;
    private active: boolean = true;

    constructor() {
        super();

        this.port.onmessage = (e: MessageEvent<AllAudioWorkletMessages>) => {
            if (e.data.kind === "audioDataInit") {
                if (this.current !== null)
                    this.nextOne = e.data;
                else {
                    this.current = e.data;
                    this.offset = 0;
                }
            } else {
                switch (e.data.kind) {
                    case "flush": this.current = null; this.nextOne = null; this.offset = 0; break;
                    case "close": this.active = false; break;
                }
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const [output] = outputs;

        if (this.current === null) {
            for (const channel of output) {
                channel.fill(0);
            }
        } else {
            let samplesCopied = 0;
            const minChannels = Math.min(this.current.numberOfChannels, output.length);
            for (let ch = 0; ch < minChannels; ch++) {
                const srcData = this.current.data[ch].subarray(this.offset, this.offset + output[ch].length);
                output[ch].set(srcData);

                if (ch === 0)
                    samplesCopied = srcData.length;
            }

            this.offset += samplesCopied;
            if (this.offset >= this.current.data[0].length) {
                this.swapBuffers();
            }
        }

        return this.active;
    }

    swapBuffers() {
        this.current = this.nextOne;
        this.offset = 0;
        this.nextOne = null;
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