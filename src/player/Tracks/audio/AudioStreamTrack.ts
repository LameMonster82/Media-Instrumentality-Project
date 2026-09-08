import type { MediaStreamTrackWrapper } from "../types";
import { workletName, type AllAudioWorkletMessages, type WorkerAudioDataInit } from "./audioTypes";

import audioWorklet from "./audio.worker.js?url";
import { Intent } from "@/player/types";

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

    latency(): number {
        return this.audioContext.outputLatency * 100;
    }

    /** Must be awaited before the first WriteData call. */
    public async initialize(): Promise<void> {

        const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
        console.log(supportedConstraints);

        await this.audioContext.audioWorklet.addModule(audioWorklet);

        this.workletNode = new AudioWorkletNode(this.audioContext, workletName, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [this.channels],
        });
        this.workletNode.connect(this.destination);
    }

    public async writeData(frame: AudioData | WorkerAudioDataInit): Promise<void> {
        if (!this.workletNode)
            return;

        if (frame instanceof AudioData) {
            frame = this.copyFromAudioData(frame);
        }

        //console.log(this.audioContext, this.workletNode)
        this.workletNode?.port.postMessage(frame, frame.transfer as Transferable[]);
    }

    public async intent(intent: Intent, _time: number) {
        if (intent === Intent.Play) {
            await this.audioContext.resume()
        } else if (intent === Intent.Pause) {
            await this.audioContext.suspend();
        } else if (intent === Intent.Seek) {
            this.workletNode?.port.postMessage({ kind: "flush" });
        }
    }

    public getTrack(): MediaStreamTrack {
        return this.track;
    }

    public enable(enable: boolean): void {
        this.track.enabled = enable;
    }

    public destroy(): void {
        if (this.workletNode) {
            this.workletNode?.port.postMessage({ kind: "flush" });
            this.workletNode.disconnect();
            this.workletNode.port.close();
        }
        this.track.stop();
        this.audioContext.close();
    }

    private copyFromAudioData(frame: AudioData): WorkerAudioDataInit {
        const channels = frame.numberOfChannels;
        const frames = frame.numberOfFrames;

        const output: Float32Array<ArrayBuffer>[] = [];
        for (let ch = 0; ch < channels; ch++) {
            const byteLength = frame.allocationSize({ planeIndex: ch, format: "f32-planar" });
            const buffer = new Float32Array(byteLength / 4);
            frame.copyTo(buffer, { planeIndex: ch, format: "f32-planar" });
            output.push(buffer);
        }

        return {
            kind: "audioDataInit",
            data: output,
            format: "f32",
            numberOfChannels: channels,
            numberOfFrames: frames,
            sampleRate: frame.sampleRate,
            timestamp: frame.timestamp,
            transfer: output.map(b => b.buffer),
        };
    }
}
