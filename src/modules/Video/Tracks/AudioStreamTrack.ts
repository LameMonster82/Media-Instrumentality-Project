import { AudioTime, type StreamTrackNeeds, type WorkerAudioData, type WorkerAudioDataInit, } from "@/modules/SomeTypes";

type WorkletMessage =
    | { kind: "write"; buffer: Float32Array; }
    | { kind: "flush"; }
    | { kind: "close"; };

const WORKLET_NAME = "AudioStreamShim";

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
registerProcessor("${WORKLET_NAME}", AudioStreamProcessor);
`;
}

// ---------------------------------------------------------------------------
// AudioStreamTrack
// ---------------------------------------------------------------------------

export class AudioStreamTrack implements StreamTrackNeeds<WorkerAudioData | WorkerAudioDataInit> {
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
    public async Initialize(): Promise<void> {
        const blob = new Blob([buildWorkletSource()], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        try {
            await this.audioContext.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }

        this.workletNode = new AudioWorkletNode(this.audioContext, WORKLET_NAME, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [this.channels],
        });
        this.workletNode.connect(this.destination);
    }

    public async WriteData(
        frame: WorkerAudioData | WorkerAudioDataInit,
        currentTime: number,
    ): Promise<void> {
        if (!this.workletNode) return;

        const frameTime = AudioTime(frame);
        const endTimeSeconds = (frameTime.timestamp + frameTime.duration) / 1_000_000;
        const timeRemaining = endTimeSeconds - currentTime;

        if (timeRemaining <= 0) {
            if (frame.kind === "audioData") frame.audioData.close();
            return;
        }

        const audioBuffer = frame.kind === "audioData"
            ? this.copyFromAudioData(frame, timeRemaining)
            : this.viewFromDataBuffer(frame, timeRemaining);

        if (frame.kind === "audioData") frame.audioData.close();

        // Transfer the ArrayBuffer — zero-copy hand-off to the worklet thread.
        this.postToWorklet({ kind: "write", buffer: audioBuffer }, [audioBuffer.buffer]);
    }

    public SeekTo(_time: number, _fastSeek: boolean): Promise<void> {
        this.postToWorklet({ kind: "flush" });
        return Promise.resolve();
    }

    public GetTrack(): MediaStreamTrack {
        return this.track;
    }

    public Enable(enable: boolean): void {
        this.track.enabled = enable;
    }

    public Destroy(): void {
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
            dataBuffer.numberOfFrames,
        );
        return new Float32Array(dataBuffer.data, 0, maxFrames * dataBuffer.numberOfChannels);
    }

    private postToWorklet(message: WorkletMessage, transfer: Transferable[] = []): void {
        this.workletNode?.port.postMessage(message, transfer);
    }
}
