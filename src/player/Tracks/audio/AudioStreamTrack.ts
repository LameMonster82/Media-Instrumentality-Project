import type { MediaStreamTrackWrapper } from "../types";
import { workletName, type AllAudioWorkletMessages, type WorkerAudioDataInit } from "./audioTypes";

import audioWorklet from "./audio.worker.js?url";

export class AudioStreamTrack implements MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    private readonly audioContext: AudioContext;
    private readonly destination: MediaStreamAudioDestinationNode;
    private readonly track: MediaStreamTrack;
    private readonly channels: number;
    private workletNode?: AudioWorkletNode;

    constructor(sampleRate = 44100, channels = 2) {
        this.channels = channels;
        this.audioContext = new AudioContext({ sampleRate, latencyHint: 0 });
        this.destination = this.audioContext.createMediaStreamDestination();
        [this.track] = this.destination.stream.getAudioTracks();
        this.track.contentHint = "music";
    }

    /** Must be awaited before the first WriteData call. */
    public async initialize(): Promise<void> {
        await this.audioContext.audioWorklet.addModule(audioWorklet);

        this.workletNode = new AudioWorkletNode(this.audioContext, workletName, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [this.channels],
        });
        this.workletNode.connect(this.destination);
    }

    async stealPlayEvent(): Promise<void> {
        if (this.audioContext.state !== 'running') {
            await this.audioContext.resume();
        }
    }

    public async writeData(frame: AudioData | WorkerAudioDataInit): Promise<void> {
        if (!this.workletNode)
            return;

        if (frame instanceof AudioData) {
            frame = this.copyFromAudioData(frame);
        }
        this.postToWorklet(frame, frame.transfer);
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

    private copyFromAudioData(frame: AudioData): WorkerAudioDataInit {
        const channels = frame.numberOfChannels;
        const frames = frame.numberOfFrames;

        const output: Float32Array<ArrayBuffer>[] = [];
        if (frame.format?.endsWith("-planar")) {
            for (let ch = 0; ch < channels; ch++) {
                const byteLength = frame.allocationSize({
                    planeIndex: ch,
                    format: "f32-planar",
                });

                const buffer = new Float32Array(byteLength / 4);
                frame.copyTo(buffer, {
                    planeIndex: ch,
                    format: "f32-planar",
                });

                output.push(buffer);
            }
        } else {
            // Interleaved source: one buffer containing frames * channels floats.
            const byteLength = frame.allocationSize({
                planeIndex: 0,
                format: "f32",
            });

            const srcBuffer = new Float32Array(byteLength / 4);
            frame.copyTo(srcBuffer, {
                planeIndex: 0,
                format: "f32",
            });

            for (let ch = 0; ch < channels; ch++) {
                const buffer = new Float32Array(frames);

                for (let f = 0; f < frames; f++) {
                    buffer[f] = srcBuffer[f * channels + ch];
                }

                output.push(buffer);
            }
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

    private postToWorklet(message: AllAudioWorkletMessages, transfer: Transferable[] = []): void {
        this.workletNode?.port.postMessage(message, transfer);
    }
}
