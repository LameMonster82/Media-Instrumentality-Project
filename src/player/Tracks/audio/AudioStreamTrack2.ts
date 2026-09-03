import type { MediaStreamTrackWrapper } from "../types";
import type { WorkerAudioDataInit } from "./audioTypes";

export class AudioStreamTrack2 implements MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit> {
    private readonly audioContext: AudioContext;
    private readonly destination: MediaStreamAudioDestinationNode;
    private readonly track: MediaStreamTrack;
    private readonly maxLookahead = 0.1;

    private activeSources: Set<AudioBufferSourceNode> = new Set();
    private nextStartTime = 0;

    constructor(sampleRate = 44100, _channels = 2) {
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
        // No worklet module to load for the AudioBufferSourceNode path.
    }

    async stealPlayEvent(): Promise<void> {
        if (this.audioContext.state !== 'running') {
            await this.audioContext.resume();
        }
    }

    public async writeData(frame: AudioData | WorkerAudioDataInit): Promise<void> {
        if (frame instanceof AudioData) {
            frame = this.copyFromAudioData(frame);
        }

        const buffer = this.audioContext.createBuffer(
            frame.numberOfChannels,
            frame.numberOfFrames,
            frame.sampleRate
        );

        for (let ch = 0; ch < frame.numberOfChannels; ch++) {
            buffer.copyToChannel(frame.data[ch], ch);
        }

        const source = this.audioContext.createBufferSource();
        source.playbackRate.value = 1;
        source.buffer = buffer;
        source.connect(this.destination);

        const now = this.audioContext.currentTime;

        // Too much already queued: drop this frame so latency can't grow without bound.
        if (this.nextStartTime > now + this.maxLookahead) {
            return;
        }

        const startTime = Math.max(now, this.nextStartTime);
        source.start(startTime);
        this.nextStartTime = startTime + buffer.duration;

        this.activeSources.add(source);
        source.onended = () => this.activeSources.delete(source);
    }

    public seekTo(_time: number, _fastSeek: boolean): Promise<void> {
        for (const source of this.activeSources) {
            try { source.stop(); } catch { }
        }
        this.activeSources.clear();
        this.nextStartTime = 0;
        return Promise.resolve();
    }

    public getTrack(): MediaStreamTrack {
        return this.track;
    }

    public enable(enable: boolean): void {
        this.track.enabled = enable;
    }

    public destroy(): void {
        for (const source of this.activeSources) {
            try { source.stop(); } catch { }
        }
        this.activeSources.clear();
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
}
