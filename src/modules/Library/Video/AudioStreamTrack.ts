import { AudioTime, StreamTrackNeeds, WorkerAudioData, WorkerAudioDataInit, WritableAudioContext } from "../SomeTypes.js";

interface SendData {
    kind: "sendData";
    array: Float32Array;
}

interface SendCleanup {
    kind: "cleanup"
}

interface SendShutdown {
    kind: "shutDown";
}

export class AudioStreamTrack implements StreamTrackNeeds<WorkerAudioData | WorkerAudioDataInit> {
    private track: MediaStreamTrack;
    private writer: WritableStream<Float32Array>;
    private audioContext: AudioContext;
    private workletNode: AudioWorkletNode | undefined;
    public readonly streamindex: number;

    constructor(streamIndex: number, sampleRate: number = 44100, channels: number = 2) {
        this.audioContext = new AudioContext({ sampleRate });
        const dest = this.audioContext.createMediaStreamDestination();
        const [track] = dest.stream.getAudioTracks();
        const ac = this.audioContext;
        this.streamindex = streamIndex;
        const thisThis = this;

        (track as any).writable = new WritableStream({
            async start(controller: WritableStreamDefaultController) {
                (this as WritableAudioContext).arrays = [];

                function worklet() {
                    registerProcessor("mstg-shim", class Processor extends AudioWorkletProcessor {
                        arrays: Float32Array[] = [];
                        arrayOffset: number = 0;
                        array?: Float32Array;
                        emptyArray: Float32Array = new Float32Array(0);
                        enabled: boolean = true;

                        constructor() {
                            super();

                            this.port.onmessage = (e: MessageEvent<SendData | SendShutdown | SendCleanup>) => {
                                if (e.data.kind === "sendData")
                                    this.arrays.push(e.data.array);
                                else if (e.data.kind === "cleanup")
                                    this.arrays.length = 0;
                                else if (e.data.kind === "shutDown")
                                    this.enabled = false;
                            };
                        }

                        process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
                            const output = outputs[0]; // output[channel][sample]
                            const numChannels = output.length;
                            const frameLength = output[0].length;

                            for (let i = 0; i < frameLength; i++) {
                                for (let c = 0; c < numChannels; c++) {
                                    if (!this.array || this.arrayOffset >= this.array.length) {
                                        this.array = this.arrays.shift() || this.emptyArray;
                                        this.arrayOffset = 0;
                                    }
                                    output[c][i] = this.array[this.arrayOffset++] || 0;
                                }
                            }
                            return this.enabled;
                        }
                    });
                }

                await ac.audioWorklet.addModule(`data:text/javascript,(${worklet.toString()})()`);

                const node = new AudioWorkletNode(ac, "mstg-shim",
                    {
                        numberOfInputs: 0,
                        numberOfOutputs: 1,
                        outputChannelCount: [channels] // <- Replace with dynamic value
                    }
                );



                node.connect(dest);
                thisThis.workletNode = node;
                (this as WritableAudioContext).node = node;

                return track;
            },

            write(audioData: Float32Array) {
                (this as WritableAudioContext).node?.port.postMessage({ kind: "sendData", array: audioData }, [audioData.buffer]);
            },
        });

        track.contentHint = "music";
        this.track = track;
        this.writer = (track as any).writable;
    }


    public Initialize(): Promise<void> {
        return Promise.resolve();
    }

    // Method to process raw audio data and play it back
    async WriteData(frame: WorkerAudioData | WorkerAudioDataInit, currentTime: number): Promise<void> {
        let audioDataBuffer: Float32Array;
        const frameTime = AudioTime(frame);
        const leftTime = ((frameTime.timestamp + frameTime.duration) / 1000000)  - currentTime;
        if (frame.kind === "audioData") {
            if (leftTime <= 0) {
                frame.audioData.close();
                return;
            }
            let maxSamples = Math.floor(leftTime * frame.audioData.sampleRate);
            maxSamples = Math.min(maxSamples, frame.audioData.numberOfFrames);
            audioDataBuffer = new Float32Array(maxSamples * frame.audioData.numberOfChannels);
            frame.audioData.copyTo(audioDataBuffer, { planeIndex: 0, format: "f32", frameCount: maxSamples });
        } else {
            if (leftTime <= 0) {
                return;
            }
            let maxSamples = Math.floor(leftTime * frame.dataBuffer.sampleRate);
            maxSamples = Math.min(maxSamples, frame.dataBuffer.numberOfFrames);
            audioDataBuffer = new Float32Array(frame.dataBuffer.data,0, (maxSamples * frame.dataBuffer.numberOfChannels));
        }

        const writer = this.writer!.getWriter();
        try {
            //const chunks = this.splitInto128FrameChunks(rawData, this.channels);
            await writer.write(new Float32Array(audioDataBuffer));
        } finally {
            writer.releaseLock();
        }

        if (frame.kind === "audioData")
            frame.audioData.close();
    }
    public SeekTo(time: number, fastSeek: boolean): Promise<void> {
        this.workletNode?.port.postMessage({ kind: 'cleanup' } as SendCleanup);
        return Promise.resolve();
    }

    public GetTrack(): MediaStreamTrack {
        return this.track;
    }

    public Enable(enable: boolean) {
        this.track.enabled = enable;
    }

    public Destroy() {
        this.workletNode?.disconnect();
        this.workletNode?.port.postMessage({ kind: 'shutDown' } as SendShutdown);
        this.workletNode?.port.close();
        this.track.stop();
        this.writer.abort();
        this.audioContext.close();
    }
}

function splitInto128FrameChunks(
        packedData: ArrayBuffer,
        channels: number
    ): Float32Array[] {
        const framesPerChunk = 128;
        const chunkSize = framesPerChunk * channels;

        const totalFrames = (packedData.byteLength / 4) / channels;
        const numChunks = Math.floor(totalFrames / framesPerChunk);

        const chunks: Float32Array[] = [];

        for (let i = 0; i < numChunks; i++) {
            const start = i * chunkSize;
            const end = start + chunkSize;
            chunks.push(new Float32Array(packedData.slice(start, end)));
        }

        return chunks;
    }

    function cutBufferToDuration(
        data: Float32Array,
        durationSeconds: number,
        sampleRate: number,
        channels: number
    ): Float32Array {
        const maxSamples = Math.floor(durationSeconds * sampleRate * channels);
        if (data.length <= maxSamples) return data;
        return data.subarray(0, maxSamples);
    }
