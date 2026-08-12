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

export class AudioStreamTrack implements MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    private readonly audioContext: AudioContext;
    private readonly destination: MediaStreamAudioDestinationNode;
    private readonly track: MediaStreamTrack;
    private readonly channels: number;
    private workletNode?: AudioWorkletNode;

    constructor(sampleRate = 44100, channels = 2) {
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

    public async writeData(frame: AudioData | WorkerAudioDataInit, currentTime: number): Promise<void> {
        if (!this.workletNode)
            return;

        // const frameTime = audioTime(frame);
        // const endTimeSeconds = (frameTime.timestamp + frameTime.duration) / 1_000_000;
        // const timeRemaining = endTimeSeconds - currentTime;

        // if (timeRemaining <= 0) {
        //     if (frame instanceof AudioData)
        //         frame.close();

        //     return;
        // }

        const audioBuffer = frame instanceof AudioData
            ? this.copyFromAudioData(frame)
            : new Float32Array(frame.data.buffer);

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
    private copyFromAudioData(frame: AudioData): Float32Array {
        const channels = frame.numberOfChannels;
        const frames = frame.numberOfFrames;
        const buffer = new Float32Array(frames * channels);

        if (frame.format?.endsWith("-planar")) {
            const plane = new Float32Array(frames);
            for (let ch = 0; ch < channels; ch++) {
                frame.copyTo(plane, { planeIndex: ch, format: "f32-planar", frameCount: frames });
                for (let i = 0; i < frames; i++) {
                    buffer[i * channels + ch] = plane[i];
                }
            }
        } else {
            frame.copyTo(buffer, { planeIndex: 0, format: "f32", frameCount: frames });
        }

        return buffer;
    }

    private postToWorklet(message: WorkletMessage, transfer: Transferable[] = []): void {
        this.workletNode?.port.postMessage(message, transfer);
    }
}
