import type { MediaStreamTrackWrapper } from "../types";
import { workletName, type WorkerAudioDataInit } from "./audioTypes";

import audioWorklet from "./audio.worker.js?worker&url";
import { Intent } from "@/player/types";

export class AudioStreamTrack implements MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    private readonly audioContext: AudioContext;
    private readonly channels: number;
    private readonly gain: GainNode;
    private workletNode?: AudioWorkletNode;
    private enabled = true;
    private volume = 1;
    private technicalLatency = 0;

    public startTime: number = 0;

    constructor(sampleRate = 44100, channels = 2) {
        this.channels = channels;
        this.audioContext = new AudioContext({ sampleRate });
        this.gain = this.audioContext.createGain();
        this.gain.connect(this.audioContext.destination);
        this.audioContext.suspend();
    }

    latency(currentTime: number): number {
        return currentTime - (this.technicalLatency + this.audioContext.currentTime)
    }

    /** Must be awaited before the first WriteData call. */
    public async initialize(): Promise<void> {
        await this.audioContext.audioWorklet.addModule(audioWorklet);

        this.workletNode = new AudioWorkletNode(this.audioContext, workletName, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [this.channels],
        });
        this.workletNode.connect(this.gain);
    }

    public async writeData(frame: AudioData | WorkerAudioDataInit, time: number): Promise<void> {
        if (!this.workletNode)
            return;

        if (frame instanceof AudioData) {
            frame = this.copyFromAudioData(frame);
        }
        //console.log(frame.timestamp, frame.numberOfFrames, frame.sampleRate);

        this.workletNode?.port.postMessage(frame, frame.transfer as Transferable[]);
    }

    public async intent(intent: Intent, time: number) {
        this.technicalLatency = time - this.audioContext.currentTime;
        if (intent === Intent.Play) {
            await this.audioContext.resume();
            this.workletNode?.port.postMessage({ kind: "play" });
        } else if (intent === Intent.Pause) {
            await this.audioContext.suspend();
            this.workletNode?.port.postMessage({ kind: "pause" });
        } else if (intent === Intent.Seek) {
            this.workletNode?.port.postMessage({ kind: "flush" });
        }
    }

    public enable(enable: boolean): void {
        this.enabled = enable;
        this.updateGain();
    }

    public setVolume(volume: number): void {
        this.volume = volume;
        this.updateGain();
    }

    public destroy(): void {
        this.workletNode?.disconnect();
        this.workletNode?.port.close();
        this.audioContext.close();
    }

    private updateGain(): void {
        this.gain.gain.value = this.enabled ? this.volume : 0;
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
