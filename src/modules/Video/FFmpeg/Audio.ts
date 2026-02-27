import { WebDecoderWorkerUrl, type WorkerAudioData, type WebDecoderErrorMessage, type WebDecoderGeneralMessage, type WorkerAudioDataInit, type WebAudioDecoderMessage, type WorkerPostPort } from "@/modules/SomeTypes";
import { workerState } from "./State";

export function submit_audio_config(config: { index: number, codec: string, sampleRate: number, numberOfChannels: number, description: number, descriptionSize: number; duration: number; })  {
    if (config.sampleRate === 0 || config.numberOfChannels === 0) {
        console.error("Found unsupported audio stream at", config.index, ".Dropping it!");
        return;
    }

    if (!('AudioDecoder' in self) || config.codec === '') {
        console.warn("AudioDecoder not here? Falling back on ffmpeg");
        const areThereOtherStreams = Object.values(workerState.streams).some(stream => stream.type === "audio" && stream.isUsed);
        // Safari time
        workerState.streams[config.index] = {
            type: "audio",
            index: config.index,
            isSupported: false,
            isUsed: !areThereOtherStreams,
            duration: config.duration,
            sampleRate: config.sampleRate,
            channels: config.numberOfChannels,
            metadata: {},
        };
        return;
    }

    let desc: Uint8Array | undefined;

    if (config.descriptionSize > 0)
        desc = workerState.Read(config.description, config.description + config.descriptionSize);

    const audioConfig: AudioDecoderConfig = {
        codec: config.codec,
        sampleRate: config.sampleRate,
        numberOfChannels: config.numberOfChannels,
        description: desc,
    };

    console.log("trying audio config", audioConfig);
    const supportPromise = AudioDecoder.isConfigSupported(audioConfig);
    supportPromise.then((conf) => {
        console.log("Audio support for index", config.index, "is", conf);
        if (conf.supported) {
            const decoderWorker = new Worker(WebDecoderWorkerUrl, { name: "I decode audio for stream " + config.index });
            decoderWorker.onmessage = (e: MessageEvent<WorkerAudioData | WebDecoderErrorMessage | WebDecoderGeneralMessage>) => {
                if (e.data.kind === "audioData") {
                    const audioData = e.data.audioData;
                    let data = new Float32Array(audioData.numberOfFrames * audioData.numberOfChannels);
                    audioData.copyTo(data, { planeIndex: 0, format: "f32" });

                    const postData: WorkerAudioDataInit = {
                        kind: "audioDataInit",
                        transferable: [data.buffer],
                        streamIndex: config.index,
                        dataBuffer: {
                            data: data.buffer,
                            format: 'f32',
                            numberOfChannels: audioData.numberOfChannels,
                            numberOfFrames: audioData.numberOfFrames,
                            sampleRate: audioData.sampleRate,
                            timestamp: audioData.timestamp
                        }
                    };
                    audioData.close();
                    self.postMessage(postData, postData.transferable);
                }
                else if (e.data.kind === "error" && e.data.decoderState !== "configured") {
                    console.warn("Audio Decoder has was shot in the back ally. Dropping this data and falling back to ffmpeg");
                    workerState.streams[config.index]!.isSupported = false;
                } else if (e.data.kind === "closed") {
                    workerState.webDecodersWorkers[config.index]!.isClosed = true;
                }
            };

            let messageChannel = new MessageChannel();

            const configMessage: WebAudioDecoderMessage = {
                kind: "init",
                decoderType: "audio",
                config: conf.config!,
                streamIndex: config.index,
                postDataTo: messageChannel.port2
            };

            const messageMessage: WorkerPostPort = {
                kind: "portPost",
                streamIndex: config.index,
                port: messageChannel.port1
            };

            workerState.webDecodersWorkers[config.index] = { worker: decoderWorker, isClosed: false };

            self.postMessage(messageMessage, [messageChannel.port1]);
            decoderWorker.postMessage(configMessage, [messageChannel.port2]);
        }
        const areThereOtherStreams = Object.values(workerState.streams).some(stream => stream.type === "audio" && stream.isUsed);
        workerState.streams[config.index] = {
            type: "audio",
            index: config.index,
            isSupported: conf.supported ?? false,
            isUsed: !areThereOtherStreams,
            duration: config.duration,
            sampleRate: config.sampleRate,
            channels: config.numberOfChannels,
            metadata: {}
        };
    });

    workerState.configPromises.push(supportPromise);
};

export function submit_audio_frame(data: { channels: number, sampleRate: number, samples: number, data: number, bytesPerSample: number; ts_js: number; stream_index: number; })  {
    const dataSize = data.channels * data.samples * data.bytesPerSample;
    const buffer = workerState.Read(data.data, data.data + dataSize);

    const postData: WorkerAudioDataInit = {
        kind: "audioDataInit",
        transferable: [buffer.buffer],
        streamIndex: data.stream_index,
        dataBuffer: {
            data: buffer.buffer,
            format: 'f32',
            numberOfChannels: data.channels,
            numberOfFrames: data.samples,
            sampleRate: data.sampleRate,
            // Time comes in seconds
            timestamp: data.ts_js
        }
    };

    self.postMessage(postData, postData.transferable);
};
