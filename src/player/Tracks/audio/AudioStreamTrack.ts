import type { MediaStreamTrackWrapper } from "../types";
import { audioTime, type WorkerAudioData, type WorkerAudioDataInit } from "./audioTypes";

type WorkletMessage =
    | { kind: "write"; buffer: Float32Array; }
    | { kind: "flush"; }
    | { kind: "close"; };

const workletName = "AudioStreamShim";

function buildWorkletSource(): string {
    // Template literal keeps the code readable and avoids the
    // fragile function.toString() + registerProcessor dance.
    return /* js */`
class AudioStreamProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue  = [];      // Float32Array[]
        this.current = null;   // Float32Array | null
        this.offset  = 0;
        this.active  = true;

        this.port.onmessage = ({ data }) => {
            switch (data.kind) {
                case "write": this.queue.push(data.buffer); break;
                case "flush": this.queue.length = 0; this.current = null; break;
                case "close": this.active = false; break;
            }
        };
    }

    process(_inputs, outputs) {
        const [output] = outputs;
        const channels = output.length;
        const frames   = output[0].length;

        for (let f = 0; f < frames; f++) {
            for (let ch = 0; ch < channels; ch++) {
                if (this.current === null || this.offset >= this.current.length) {
                    this.current = this.queue.shift() ?? null;
                    this.offset  = 0;
                }
                output[ch][f] = this.current !== null ? this.current[this.offset++] : 0;
            }
        }

        return this.active;
    }
}
registerProcessor("${workletName}", AudioStreamProcessor);
`;
}

// ---------------------------------------------------------------------------
// AudioStreamTrack
// ---------------------------------------------------------------------------

export class AudioStreamTrack implements MediaStreamTrackWrapper<WorkerAudioData | WorkerAudioDataInit> {
    public readonly streamindex: number;

    private readonly audioContext: AudioContext;
    private readonly destination: MediaStreamAudioDestinationNode;
    private readonly track: MediaStreamTrack;
    private readonly channels: number;
    private workletNode?: AudioWorkletNode;

    constructor(streamIndex: number, sampleRate = 44100, channels = 2) {
        this.streamindex = streamIndex;
        this.channels = channels;
        this.audioContext = new AudioContext({ sampleRate });
        this.destination = this.audioContext.createMediaStreamDestination();
        [this.track] = this.destination.stream.getAudioTracks();
        this.track.contentHint = "music";
    }

    /** Must be awaited before the first WriteData call. */
    public async initialize(): Promise<void> {
        const blob = new Blob([buildWorkletSource()], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        try {
            await this.audioContext.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }

        this.workletNode = new AudioWorkletNode(this.audioContext, workletName, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [this.channels],
        });
        this.workletNode.connect(this.destination);
    }

    public async writeData(frame: WorkerAudioData | WorkerAudioDataInit, currentTime: number): Promise<void> {
        if (!this.workletNode)
            return;

        const frameTime = audioTime(frame);
        const endTimeSeconds = (frameTime.timestamp + frameTime.duration) / 1_000_000;
        const timeRemaining = endTimeSeconds - currentTime;

        if (timeRemaining <= 0) {
            if (frame.kind === "audioData")
                frame.audioData.close();

            return;
        }

        const audioBuffer = frame.kind === "audioData"
            ? this.copyFromAudioData(frame, timeRemaining)
            : this.viewFromDataBuffer(frame, timeRemaining);

        if (frame.kind === "audioData")
            frame.audioData.close();

        this.postToWorklet({ kind: "write", buffer: audioBuffer }, [audioBuffer.buffer]);
    }

    public seekTo(_time: number, _fastSeek: boolean): Promise<void> {
        this.postToWorklet({ kind: "flush" });
        return Promise.resolve();
    }

    public getTrack(): MediaStreamTrack {
        return this.track;
    }

    public enable(enable: boolean): void {
        this.track.enabled = enable;
    }

    public destroy(): void {
        if (this.workletNode) {
            this.postToWorklet({ kind: "close" });
            this.workletNode.disconnect();
            this.workletNode.port.close();
        }
        this.track.stop();
        this.audioContext.close();
    }

    /** Allocates a new buffer and copies decoded audio into it. */
    private copyFromAudioData(frame: WorkerAudioData, timeRemaining: number): Float32Array {
        const { audioData } = frame;
        const maxFrames = Math.min(
            Math.floor(timeRemaining * audioData.sampleRate),
            audioData.numberOfFrames,
        );
        const buffer = new Float32Array(maxFrames * audioData.numberOfChannels);
        audioData.copyTo(buffer, { planeIndex: 0, format: "f32", frameCount: maxFrames });
        return buffer;
    }

    /**
     * Returns a typed-array *view* into the existing ArrayBuffer — no copy.
     * Ownership is transferred to the worklet via postMessage.
     */
    private viewFromDataBuffer(frame: WorkerAudioDataInit, timeRemaining: number): Float32Array {
        const { dataBuffer } = frame;
        const maxFrames = Math.min(
            Math.floor(timeRemaining * dataBuffer.sampleRate),
            dataBuffer.numberOfFrames);

        return new Float32Array(dataBuffer.data, 0, maxFrames * dataBuffer.numberOfChannels);
    }

    private postToWorklet(message: WorkletMessage, transfer: Transferable[] = []): void {
        this.workletNode?.port.postMessage(message, transfer);
    }
}
