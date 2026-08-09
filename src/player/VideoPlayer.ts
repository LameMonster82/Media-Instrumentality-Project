import MediaControls from "@/components/controls/Controls";
import ffmpegWorker from "@/player/FFmpeg/bridge.worker?worker";
import AtomicEventer from "./atomicEventer/atomicEventer";
import { RequestDataStatus, type AllRespondWorkerEventsKind, type DictionaryWorkerEvent, type RespondEventByKind, type WorkerFFmpegInitComplete, type WorkerInitFFmpeg } from "./FFmpeg/types";
import { FFmpegRequestEvent, ffmpegRequestTemplate, FFmpegResponseEvent, ffmpegResponseTemplate } from "./FFmpeg/advancedTypes/atomicTypes";
import { AVSubtitleType, MediaType } from "./FFmpeg/structReader";
import type { MediaStreamTrackWrapper } from "./Tracks/types";
import { GetVideoTrackCtor } from "./Tracks/video/utils";
import { GetAudioTrackCtor } from "./Tracks/audio/utils";
import type { WorkerAudioDataInit } from "./Tracks/audio/audioTypes";
import { Dispositions } from "./FFmpeg/advancedTypes/AVTypes";
import type { TextTrackStream, VTTCueArgs } from "./Tracks/subtitles/types";

export class VideoPlayer2 {
    // DOM
    private video = document.createElement('video');
    private mediaStream = new MediaStream();
    private controls: MediaControls;

    // Renderer
    private videoRenderer: Map<number, MediaStreamTrackWrapper<VideoFrame>> = new Map();
    private audioRenderer: Map<number, MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit>> = new Map();
    private subtitleTextRenderer: Map<number, TextTrackStream> = new Map();

    private activeVideoStream: number = -1;
    private activeAudioStream: number = -1;
    private activeSubtitleStream: number = -1;
        
    // Buffer
    private videoFrameBuffer: (VideoFrame | null)[] = [];
    private audioFrameBuffer: ((AudioData | WorkerAudioDataInit) | null)[] = [];

    // Time
    private mediaTime: DOMHighResTimeStamp = 0;
    private paused: boolean = true;
    private seeking: boolean = false;
    private duration: number = 0;

    // Status
    private initDone = false;
    private dataRequested: boolean = false;
    private endOfFile = false;

    // Events
    private eventCallback: DictionaryWorkerEvent = { initComplete: [] };
    private workerEventer: AtomicEventer<
        FFmpegRequestEvent,
        FFmpegResponseEvent,
        typeof ffmpegRequestTemplate,
        typeof ffmpegResponseTemplate
    > = new AtomicEventer(undefined, ffmpegRequestTemplate, ffmpegResponseTemplate);

    constructor(videoSrc: string | File) {
        // DOM
        this.video = document.createElement('video');
        this.video.srcObject = this.mediaStream;
        this.video.autoplay = true;

        let track = this.video.addTextTrack("captions", "Captions", "en");
        track.mode = "showing";
        for (let i = 0; i < 1000; i++) {
            track.addCue(new VTTCue(i, i + 1, i.toString()));

        }

        // Worker
        const worker = ffmpegWorker({ name: "I tell ffmpeg to do the work" });
        worker.onmessage = this.handleSlowEvent.bind(this);
        worker.postMessage({
            fileSource: videoSrc,
            bufferSize: 32 * 1024 * 1024,
            kind: "initFfmpeg",
            eventerBuffers: this.workerEventer.getBuffers(),
        } as WorkerInitFFmpeg);

        window.onbeforeunload = () => {
            worker.terminate();
        };

        // Init
        this.controls = this.initControls();
        this.initMedia().then(this.timeLoop.bind(this));
    }

    private initControls(): MediaControls {
        const controls = new MediaControls(this.video, {
            onPlayPause: async (intent?: boolean) => {
                intent ??= this.paused;
                if (intent) {
                    this.Play();
                    try {
                        this.video.play();
                    } catch { }
                } else {
                    this.Pause();
                }
                this.controls.setPlayback(intent);
                return intent;
            },
            onSeekTo: (time: number) => {
                this.video.currentTime = time;
            },
            onStepFrame: () => {
                //this.videoManager?.triggerNextFrame();
                //this.clock.Play();
                this.controls.setPlayback(true);
            },
            onVolumeChange: (volume: number) => {
                this.video.volume = volume;
            },
            getMediaDuration: () => this.duration,
            getCurrentTime: () => this.mediaTime,
            getVolume: () => this.video.volume,
            onVideoTrackSelect: (index: number) => this.updateTrack("video", index),
            onAudioTrackSelect: (index: number) => this.updateTrack("audio", index),
            onSubtitleTrackSelect: (index: number) => this.updateTrack("subtitle", index),
        });

        this.video.addEventListener('volumechange', () => this.controls.setVolume(this.video.volume));

        document.getElementById("containerAgain")!.append(controls.controlsContainer);
        controls.controlsContainer.style.position = 'unset';

        return controls;
    }

    private async initMedia() {
        const data = await this.waitForSlowEvent("initComplete");

        // Metadata
        this.duration = Number(data.info.duration) / 1000;
        this.updateTime();


        // Renderers
        const initStream = async <T extends MediaStreamTrackWrapper<unknown>>(enabled: boolean, Renderer: new () => T): Promise<T> => {
            let renderer = new Renderer();
            await renderer.initialize();

            const track = renderer.getTrack();
            if (track) {
                track.enabled = enabled;
                this.mediaStream.addTrack(track);
            }

            return renderer;
        };

        this.activeVideoStream = data.info.streams.findIndex(s => s.type === MediaType.RESULT_VIDEO && !!(s.disposition & Dispositions.AV_DISPOSITION_DEFAULT));
        this.activeAudioStream = data.info.streams.findIndex(s => s.type === MediaType.RESULT_AUDIO && !!(s.disposition & Dispositions.AV_DISPOSITION_DEFAULT));
        this.activeSubtitleStream = data.info.streams.findIndex(s => s.type === MediaType.RESULT_SUBTITLE && !!(s.disposition & Dispositions.AV_DISPOSITION_DEFAULT));

        for (let i = 0; i < data.info.streams.length; i++) {
            const stream = data.info.streams[i];

            let enabled = false;
            switch (stream.type) {
                case MediaType.RESULT_VIDEO: {
                    if (this.activeVideoStream === -1)
                        this.activeVideoStream = i;
                    if (this.activeVideoStream === i)
                        enabled = true;
                    let renderer = await initStream(enabled, GetVideoTrackCtor());
                    this.videoRenderer.set(i, renderer);
                    break;
                }
                case MediaType.RESULT_AUDIO: {
                    if (this.activeAudioStream === -1)
                        this.activeAudioStream = i;
                    if (this.activeAudioStream === i)
                        enabled = true;
                    let renderer = await initStream(enabled, GetAudioTrackCtor());
                    this.audioRenderer.set(i, renderer);
                    break;
                }
                case MediaType.RESULT_SUBTITLE: {
                    switch (stream.subtitle_config!.type) {
                        case AVSubtitleType.SUBTITLE_TEXT: {
                            let track = this.video.addTextTrack("subtitles", stream.metadata["title"], stream.metadata["language"]);
                            track.mode = enabled ? "showing" : "disabled";
                            this.subtitleTextRenderer.set(i, {
                                track,
                                cues: new Set()
                            });
                            break;
                        }
                        default: {
                            // TODO
                            console.error("Implement subtitle type!!!!");
                            continue;
                        }
                    }
                    if (this.activeSubtitleStream === -1)
                        this.activeSubtitleStream = i;
                    if (this.activeSubtitleStream === i)
                        enabled = true;
                }
            }

            this.workerEventer.sendEvent(FFmpegRequestEvent.SET_STREAM_ACTIVE, {
                streamIndex: i,
                active: enabled
            });

            await this.workerEventer.waitUntilEvent(FFmpegResponseEvent.SET_STREAM_DONE);
        }
        //this.subtitleRenderer = await initStream(subtitleStreamIndex, GetSubtitleTrackCtor());



        // Message Handling
        const handleMessage = <T extends { timestamp: number; }>(i: number, buffer: (T | null)[]) => {
            const messageChannel = data.streamPorts.get(i);
            const messageChannel2 = data.streamPorts2.get(i);
            if (!messageChannel || !messageChannel2) return;

            messageChannel.onmessage = (e: MessageEvent<T>) => {
                const index = buffer.indexOf(null);

                if (index > -1)
                    buffer[index] = e.data;
                else buffer.push(e.data);

                buffer.sort((a, b) => {
                    if (a == null) return 1;
                    if (b == null) return -1;
                    return a.timestamp - b.timestamp;
                });
            };
            messageChannel2.onmessage = messageChannel.onmessage;
        };

        for (let i = 0; i < data.info.streams.length; i++) {
            const stream = data.info.streams[i];

            switch (stream.type) {
                case MediaType.RESULT_VIDEO: handleMessage(i, this.videoFrameBuffer); break;
                case MediaType.RESULT_AUDIO: handleMessage(i, this.audioFrameBuffer); break;
                case MediaType.RESULT_SUBTITLE: {
                    switch (stream.subtitle_config!.type) {
                        case AVSubtitleType.SUBTITLE_TEXT:
                            const messageChannel = data.streamPorts.get(i);
                            const messageChannel2 = data.streamPorts2.get(i);
                            if (!messageChannel || !messageChannel2) break;

                            const stream = this.subtitleTextRenderer.get(i);
                            if(stream)
                                messageChannel.onmessage = (e: MessageEvent<VTTCueArgs>) => {
                                    const key = `${e.data.text}|${e.data.startTime}|${e.data.endTime}`;
                                    if (stream!.cues.has(key))
                                        return;

                                    stream!.track.addCue(new VTTCue(e.data.startTime, e.data.endTime, e.data.text));
                                }
                            break;
                        default:
                            // TODO
                            break;
                    }
                }
            }
        }

        this.firstFrameAsPoster();
        this.initDone = true;
    }

    private async timeLoop() {
        let lastTime  = performance.now();
        while (true) {
            if(performance.now() - lastTime < 1)
                await new Promise(r => setTimeout(r, 0));

            if (this.initDone && !this.endOfFile)
                this.feedVideoBuffer();

            if (this.paused || this.seeking) continue;

            const diff = performance.now() - lastTime;
            lastTime = performance.now();
            this.mediaTime = Math.max(0, Math.min(this.mediaTime + diff, this.duration));

            while (await this.renderData()) { };
            this.updateTime();

            if (this.endOfFile && this.mediaTime === this.duration) {
                this.Pause();
            }
        }
    }

    private feedVideoBuffer() {
        if (this.videoFrameBuffer.length < 16) {
            if (!this.dataRequested)
                this.requestData();
        } else {
            const hasFrame = this.videoFrameBuffer.some(v => v !== null);
            if (!hasFrame && !this.dataRequested) {
                this.requestData();
            }
        }
    }

    private async requestData() {
        this.dataRequested = true;
        this.workerEventer.sendEvent(FFmpegRequestEvent.REQUEST_DATA, {});
        const data = await this.workerEventer.waitUntilEvent(FFmpegResponseEvent.REQUEST_STATUS);

        if (data!.data.status === RequestDataStatus.ERR) {
            console.error("Handle random error from ffmpeg");
            return;
        };
        if (data!.data.status === RequestDataStatus.EOF) this.endOfFile = true;
        if (data!.data.status === RequestDataStatus.DECODED_BY_OTHER_THREAD) {
            if (data!.data.packetType === MediaType.RESULT_VIDEO) {
                this.videoFrameBuffer.push(null);
            } else if (data!.data.packetType === MediaType.RESULT_AUDIO) {
                this.audioFrameBuffer.push(null);
            } else if (data!.data.packetType === MediaType.RESULT_SUBTITLE) {
                // TODO but probably wont be seperately decoded
            }
        }

        this.dataRequested = false;
    }


    private async renderData() {
        let promises = [];
        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);
        //const subtitleStream = this.subtitleRenderer.get(this.activeSubtitleStream);

        if (this.videoFrameBuffer[0] instanceof VideoFrame && videoStream) {
            let frame = this.videoFrameBuffer[0];
            if (frame.timestamp / 1000 <= this.mediaTime) {
                frame = this.videoFrameBuffer.shift()!;
                const promise = videoStream.writeData(frame);
                promise.then(() => frame.close());
                promises.push(promise);
            }
        } else if(videoStream) {
            console.warn("Low on Video Frames");
        }

        if (this.audioFrameBuffer[0] !== undefined && this.audioFrameBuffer[0] !== null && audioStream) {
            let frame = this.audioFrameBuffer[0];
            if (frame.timestamp / 1000 <= this.mediaTime) {
                frame = this.audioFrameBuffer.shift()!;
                const promise = audioStream.writeData(frame, this.mediaTime);
                promise.then(() => {
                    if (frame instanceof AudioData)
                        frame.close();
                });
                promises.push(promise);
            }
        } else if(audioStream) {
            console.warn("Low on Audio Frames");
        }

        //await Promise.all(promises);
        return promises.length > 0;
        // TODO if subtitles
    }

    private async firstFrameAsPoster() {
        while (!(this.videoFrameBuffer[0] instanceof VideoFrame)) {
            await new Promise<void>(r => setTimeout(r, 0));
        }

        const frame = this.videoFrameBuffer[0] as VideoFrame;

        const canvas = document.createElement('canvas');
        canvas.width = frame.codedWidth;
        canvas.height = frame.codedHeight;

        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(frame, 0, 0);
        const data = canvas.toDataURL('image/jpeg');
        this.video.poster = data;
        canvas.remove();
    }

    private updateTime() {
        const currentTime: number = this.mediaTime / 1000;
        const duration: number = this.duration / 1000;

        this.controls.setDuration(duration);
        this.controls.updateCurrentTime(currentTime, duration);

        this.video.currentTime = duration;
    }

    private updateTrack(type: "video" | "audio" | "subtitle", index: number): void {
        console.log(`Changing ${type} track to index: ${index}`);
    }

    public Play() {
        this.controls.setPlayback(true);
        this.paused = false;
    }

    public Pause() {
        this.controls.setPlayback(false);
        this.paused = true;
    }

    public getVideo() {
        return this.video;
    }

    private handleSlowEvent(e: MessageEvent<WorkerFFmpegInitComplete>) {
        const events = this.eventCallback[e.data.kind];
        if (!events) return;

        for (const callback of events) {
            callback(e.data);
        }

        this.eventCallback[e.data.kind] = [];
    }

    private waitForSlowEvent<E extends AllRespondWorkerEventsKind>(event: E): Promise<RespondEventByKind<E>> {
        const { promise, resolve } = Promise.withResolvers<RespondEventByKind<E>>();
        this.eventCallback[event] ??= [];
        this.eventCallback[event].push(resolve);
        return promise;
    }
}
