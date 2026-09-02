import MediaControls from "@/components/controls/Controls";
import styles from "./videoPlayer.module.css";
import ffmpegWorker from "@/player/FFmpeg/bridge.worker?worker";
import AtomicEventer from "./atomicEventer/atomicEventer";
import { RequestDataStatus, type AllRespondWorkerEventsKind, type DictionaryWorkerEvent, type RespondEventByKind, type WorkerChangeStream, type WorkerFFmpegInitComplete, type WorkerInitFFmpeg } from "./FFmpeg/types";
import { FFmpegRequestEvent, ffmpegRequestTemplate, FFmpegResponseEvent, ffmpegResponseTemplate } from "./FFmpeg/advancedTypes/atomicTypes";
import { AttachmentType, AVMediaType, AVSubtitleType, MediaType } from "./FFmpeg/structReader";
import type { CanvasTrackWrapper, MediaStreamTrackWrapper } from "./Tracks/types";
import { GetVideoTrackCtor } from "./Tracks/video/utils";
import { GetAudioTrackCtor } from "./Tracks/audio/utils";
import { audioTime, type WorkerAudioDataInit } from "./Tracks/audio/audioTypes";
import { Dispositions } from "./FFmpeg/advancedTypes/AVTypes";
import type { BitmapSubArgs, VideoDisplayData, VTTCueArgs } from "./Tracks/subtitles/types";
import type { RemoteFileSource } from "./seeker/types";
import musicIcon from "@Resources/Icons/music.svg?url";

import JASSUB, { webYCbCrMap } from "jassub";
import type { ControlStream } from "@/components/controls/types";
import { extractCoverArt, extractFonts } from "./utils";
import SubtitleTextTrack from "./Tracks/subtitles/SubtitleTextTrack";
import SubtitleASSTrack from "./Tracks/subtitles/SubtitleASSTrack";
import SubtitleBitmapTrack from "./Tracks/subtitles/SubtitleBitmapTrack";

export type PlaybackCommand =
    | { kind: "play" }
    | { kind: "pause" }
    | { kind: "seek"; time: number }; // time in milliseconds

export class VideoPlayer2 {
    // DOM
    private container = document.createElement('div');
    private videoContainer = document.createElement('div');
    private video = document.createElement('video');
    private mediaStream = new MediaStream();
    private controls: MediaControls;
    private posterUrl: string | undefined;

    // Renderer
    private videoRenderer: Map<number, MediaStreamTrackWrapper<VideoFrame>> = new Map();
    private audioRenderer: Map<number, MediaStreamTrackWrapper<AudioData | WorkerAudioDataInit>> = new Map();
    private subtitleRenderer: Map<number, CanvasTrackWrapper<VTTCueArgs | BitmapSubArgs, VideoDisplayData>> = new Map();

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
    private stepFrame: boolean = false;
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

    private commandHandler: ((command: PlaybackCommand) => void) | undefined;

    // FFmpeg
    private worker: Worker;

    constructor(videoSrc: string | File | RemoteFileSource) {
        // DOM
        this.video.classList.add(styles.videoItself);
        this.videoContainer.classList.add(styles.player);
        this.videoContainer.appendChild(this.video);
        this.container.appendChild(this.videoContainer);
        this.video.srcObject = this.mediaStream;
        this.video.autoplay = true;
        this.video.tabIndex = 0;

        this.container.classList.add(styles.videoContainer);

        // Worker
        const worker = ffmpegWorker({ name: "I tell ffmpeg to do the work" });
        worker.onmessage = this.handleSlowEvent.bind(this);

        const transfer: Transferable[] = [];
        if (typeof videoSrc === "object" && videoSrc !== null && !(videoSrc instanceof File) && "port" in videoSrc) {
            transfer.push(videoSrc.port);
        }

        worker.postMessage({
            fileSource: videoSrc,
            bufferSize: 32 * 1024 * 1024,
            kind: "initFfmpeg",
            eventerBuffers: this.workerEventer.getBuffers(),
        } as WorkerInitFFmpeg, transfer);

        window.onbeforeunload = () => {
            worker.terminate();
        };

        this.worker = worker;

        this.workerEventer.receiveEvent((data) => {
            switch (data) {
                case FFmpegResponseEvent.END_OF_FILE:
                    this.endOfFile = true;
                    break;
            }
        });

        // Init
        this.controls = this.initControls();
        this.initMedia().then(this.timeLoop.bind(this));
    }

    private initControls(): MediaControls {
        const controls = new MediaControls(this.video, {
            onPlayPause: async (intent?: boolean) => {
                intent ??= this.paused;
                if (this.commandHandler) {
                    this.commandHandler({ kind: intent ? "play" : "pause" });
                    this.controls.setPlayback(intent);
                    return intent;
                }
                if (this.endOfFile && intent && this.duration <= this.mediaTime) {
                    await this.seek(0);
                    return intent;
                }
                if (intent) {
                    this.play();
                    try {
                        this.video.play();
                    } catch { }
                } else {
                    this.pause();
                }
                this.controls.setPlayback(intent);
                return intent;
            },
            onSeekTo: (time: number) => {
                if (this.commandHandler) {
                    this.commandHandler({ kind: "seek", time: time * 1000 });
                    return;
                }
                this.pause();
                this.seek(time * 1000);
            },
            onStepFrame: () => {
                //this.videoManager?.triggerNextFrame();
                //this.clock.Play();
                if (this.videoFrameBuffer[0]) {
                    this.mediaTime = this.videoFrameBuffer[0].timestamp / 1000;
                    this.stepFrame = true;
                }
            },
            onVolumeChange: (volume: number) => {
                this.video.volume = volume;
            },
            getMediaDuration: () => this.duration / 1000,
            getCurrentTime: () => this.mediaTime / 1000,
            getVolume: () => this.video.volume,
            onVideoTrackSelect: (index: number) => this.updateTrack("video", index),
            onAudioTrackSelect: (index: number) => this.updateTrack("audio", index),
            onSubtitleTrackSelect: (index: number) => this.updateTrack("subtitle", index),
        });

        this.video.addEventListener('volumechange', () => this.controls.setVolume(this.video.volume));

        this.container.append(controls.controlsContainer);
        controls.controlsContainer.classList.add(styles.unsetPosition);

        return controls;
    }

    private async initMedia() {
        const data = await this.waitForSlowEvent("initComplete");

        // --- Metadata
        this.duration = Number(data.info.duration) / 1000;
        this.updateTime();

        // --- Attachments
        const streams = data.info.streams.values().toArray();
        const fonts = extractFonts(streams);
        const cover = extractCoverArt(streams);


        for (const [index, stream] of data.info.streams) {
            if (!!!(stream.disposition & Dispositions.AV_DISPOSITION_DEFAULT))
                continue;

            if (stream.type === AVMediaType.AVMEDIA_TYPE_VIDEO)
                this.activeVideoStream = index;
            if (stream.type === AVMediaType.AVMEDIA_TYPE_AUDIO)
                this.activeAudioStream = index;
            if (stream.type === AVMediaType.AVMEDIA_TYPE_SUBTITLE)
                this.activeSubtitleStream = index;
        }

        // We can now wait for cover when we know if there is a video stream
        this.firstFrameAsPoster(cover ?? undefined);

        // --- Renderers
        const videoStreams: ControlStream[] = [{ index: -1, isUsed: false, metadata: { title: "Disable" } }];
        const audioStreams: ControlStream[] = [{ index: -1, isUsed: false, metadata: { title: "Disable" } }];
        const subtitleStreams: ControlStream[] = [{ index: -1, isUsed: false, metadata: { title: "Disable" } }];

        // eslint-disable-next-line @typescript-eslint/naming-convention
        const initStream = async <T extends MediaStreamTrackWrapper<unknown>>(enabled: boolean, Renderer: new (...args: unknown[]) => T, ...args: unknown[]): Promise<T> => {
            const renderer = new Renderer(...args ?? []);
            await renderer.initialize();

            const track = renderer.getTrack();
            if (track) {
                track.enabled = enabled;
                this.mediaStream.addTrack(track);
            }

            return renderer;
        };

        for (const [i, stream] of data.info.streams) {
            let enabled = false;
            switch (stream.type) {
                case AVMediaType.AVMEDIA_TYPE_VIDEO: {
                    if (this.activeVideoStream === -1)
                        this.activeVideoStream = i;
                    if (this.activeVideoStream === i)
                        enabled = true;
                    const renderer = await initStream(enabled, GetVideoTrackCtor());
                    this.videoRenderer.set(i, renderer);
                    videoStreams.push({
                        index: i,
                        isUsed: enabled,
                        metadata: stream.metadata
                    });
                    break;
                }
                case AVMediaType.AVMEDIA_TYPE_AUDIO: {
                    if (this.activeAudioStream === -1)
                        this.activeAudioStream = i;
                    if (this.activeAudioStream === i)
                        enabled = true;
                    const renderer = await initStream(enabled, GetAudioTrackCtor(),
                        stream.audio_config!.sample_rate, stream.audio_config!.num_channels);
                    this.audioRenderer.set(i, renderer);
                    audioStreams.push({
                        index: i,
                        isUsed: enabled,
                        metadata: stream.metadata
                    });
                    break;
                }
                case AVMediaType.AVMEDIA_TYPE_SUBTITLE: {
                    if (this.activeSubtitleStream === -1)
                        this.activeSubtitleStream = i;
                    if (this.activeSubtitleStream === i)
                        enabled = true;

                    let bitmapCanvas: HTMLCanvasElement | undefined;
                    const createCanvas = (resuse: boolean = false) => {
                        const canvas = resuse && bitmapCanvas ? bitmapCanvas : document.createElement('canvas');
                        canvas.classList.add(styles.canvasOverlay);
                        canvas.style.display = "none";
                        this.videoContainer.appendChild(canvas);
                        if (resuse) bitmapCanvas = canvas;
                        return canvas;
                    };

                    switch (stream.subtitle_config!.type) {
                        case AVSubtitleType.SUBTITLE_TEXT: {
                            const renderer = new SubtitleTextTrack(this.video, stream.metadata["title"], stream.metadata["language"]);
                            renderer.createCanvas(createCanvas.bind(this));
                            await renderer.enable(enabled);
                            this.subtitleRenderer.set(i, renderer);
                            break;
                        }
                        case AVSubtitleType.SUBTITLE_ASS: {
                            const renderer = new SubtitleASSTrack(stream.subtitle_config!.subtitle_header, fonts);
                            renderer.createCanvas(createCanvas.bind(this));

                            await renderer.enable(enabled);
                            this.subtitleRenderer.set(i, renderer);
                            break;
                        }
                        case AVSubtitleType.SUBTITLE_BITMAP: {
                            const renderer = new SubtitleBitmapTrack();
                            renderer.createCanvas(createCanvas.bind(this));
                            await renderer.enable(enabled);
                            this.subtitleRenderer.set(i, renderer);
                            break;
                        }
                        default: {
                            // TODO
                            console.error("Implement subtitle type!!!!");
                            continue;
                        }
                    }
                    subtitleStreams.push({
                        index: i,
                        isUsed: enabled,
                        metadata: stream.metadata
                    });
                    break;
                }
                default:
                    continue;
            }

            this.worker.postMessage({
                kind: "changeStream",
                index: i,
                enabled: enabled
            } as WorkerChangeStream);
        }
        //this.subtitleRenderer = await initStream(subtitleStreamIndex, GetSubtitleTrackCtor());

        this.controls.updateVideoTracks(videoStreams);
        this.controls.updateAudioTracks(audioStreams);
        this.controls.updateSubtitleTracks(subtitleStreams);

        this.controls.updateChapters(data.info.chapters.map(c => {
            return {
                id: Number(c.id),
                start: c.start,
                end: c.end,
                title: c.metadata["title"],
            };
        }));

        const updateBufferedState = <T extends { timestamp: number; }>(buffer: (T | null)[]) => {
            for (let index = buffer.length - 1; index > 0; index--) {
                const frame = buffer[index];
                if (frame === null) continue;

                this.controls.setBufferProgress(((frame.timestamp / 1000) / this.duration) * 100);
                break;
            }
        };

        // Message Handling
        const handleMessage = <T extends { timestamp: number; }>(i: number, buffer: (T | null)[], type: AVMediaType) => {
            const messageChannel = data.streamPorts.get(i);
            const messageChannel2 = data.streamPorts2.get(i);
            if (!messageChannel || !messageChannel2) return;

            messageChannel.onmessage = (e: MessageEvent<T>) => {
                if (type === AVMediaType.AVMEDIA_TYPE_VIDEO && this.activeVideoStream !== i) return;
                if (type === AVMediaType.AVMEDIA_TYPE_AUDIO && this.activeAudioStream !== i) return;
                const index = buffer.indexOf(null);

                if (index > -1)
                    buffer[index] = e.data;
                else buffer.push(e.data);

                buffer.sort((a, b) => {
                    if (a === null) return 1;
                    if (b === null) return -1;
                    return a.timestamp - b.timestamp;
                });

                // if (this.activeVideoStream !== -1) {
                //     updateBufferedState(this.videoFrameBuffer);
                // } else if (this.activeAudioStream !== -1) {
                //     updateBufferedState(this.audioFrameBuffer);
                // }
            };
            messageChannel2.onmessage = messageChannel.onmessage;
        };

        const handleMessageSub = <T extends { timestamp: number; }>(i: number, renderer: CanvasTrackWrapper<unknown, unknown> | undefined) => {
            if (!renderer) return;
            const messageChannel = data.streamPorts.get(i);
            const messageChannel2 = data.streamPorts2.get(i);
            if (!messageChannel || !messageChannel2) return;

            messageChannel.onmessage = async (e: MessageEvent<T>) => {
                await renderer.writeData(e.data);
            };
            messageChannel2.onmessage = messageChannel.onmessage;
        };

        for (const [i, stream] of data.info.streams) {
            switch (stream.type) {
                case AVMediaType.AVMEDIA_TYPE_VIDEO: handleMessage(i, this.videoFrameBuffer, stream.type); break;
                case AVMediaType.AVMEDIA_TYPE_AUDIO: handleMessage(i, this.audioFrameBuffer, stream.type); break;
                case AVMediaType.AVMEDIA_TYPE_SUBTITLE: handleMessageSub(i, this.subtitleRenderer.get(i)); break;
                default:
                    continue;
            }
        }

        //this.controls.updateAudioTracks(audios)

        this.initDone = true;
        this.controls.setLoadingState(false);
    }

    private async requestData() {
        if (this.dataRequested) return;
        this.dataRequested = true;
        await this.workerEventer.sendEvent(FFmpegRequestEvent.REQUEST_DATA, {}, true);
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

    private async timeLoop() {
        const stub = () => new Promise(resolve => setTimeout(resolve, 0));
        let lastTime = performance.now();
        while (true) {
            const diff = performance.now() - lastTime;
            lastTime = performance.now();

            if (this.initDone && !this.endOfFile && !this.seeking)
                this.feedVideoBuffer();


            if ((this.paused && !this.stepFrame) || this.seeking) {
                await stub();
                continue;
            }

            if (!this.hasDataToWrite()) {
                await stub();
            }

            this.mediaTime = Math.max(0, Math.min(this.mediaTime + diff, this.duration));

            while (await this.renderData() && !this.stepFrame) { };
            this.updateTime();

            if (this.endOfFile && this.mediaTime === this.duration) {
                this.pause();
            }
            this.stepFrame = false;
        }
    }

    private feedVideoBuffer() {
        if (this.videoFrameBuffer.length < 16) {
            this.requestData();
        } else {
            const hasFrame = this.videoFrameBuffer.some(v => v !== null);
            if (!hasFrame) {
                this.requestData();
            }
        }
    }

    private hasDataToWrite() {
        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);

        if (this.videoFrameBuffer[0] instanceof VideoFrame && videoStream) {
            const frame = this.videoFrameBuffer[0];
            if (frame.timestamp / 1000 <= this.mediaTime) {
                return true;
            }
        }

        if (this.audioFrameBuffer[0] && audioStream) {
            const frame = this.audioFrameBuffer[0];
            const { timestamp } = audioTime(frame);
            if (timestamp / 1000 <= this.mediaTime) {
                return true;
            }
        }

        return false;
    }


    private async renderData() {
        const promises = [];
        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);
        const subtitleStream = this.subtitleRenderer.get(this.activeSubtitleStream);

        if (this.videoFrameBuffer[0] instanceof VideoFrame && videoStream) {
            let frame = this.videoFrameBuffer[0];
            if (frame.timestamp / 1000 <= this.mediaTime) {
                frame = this.videoFrameBuffer.shift()!;
                if ((subtitleStream as SubtitleASSTrack | undefined)?.setColorSpace && frame.colorSpace.matrix) {
                    await (subtitleStream as SubtitleASSTrack).setColorSpace(webYCbCrMap[frame.colorSpace.matrix]);
                }
                const promise = videoStream.writeData(frame);
                promise.then(() => frame.close());
                promises.push(promise);

                this.videoContainer.style.setProperty("--videoWidth", this.video.videoWidth.toString());
                this.videoContainer.style.setProperty("--videoHeight", this.video.videoHeight.toString());
                this.videoContainer.style.setProperty("--codecWidth", this.video.videoWidth.toString());
                this.videoContainer.style.setProperty("--codecHeight", this.video.videoHeight.toString());
            }
        } else if (videoStream) {
            console.debug("Low on Video Frames");
        }

        if (this.audioFrameBuffer[0] !== undefined && this.audioFrameBuffer[0] !== null && audioStream) {
            let frame = this.audioFrameBuffer[0];
            const { timestamp } = audioTime(frame);
            if (timestamp / 1000 <= this.mediaTime) {
                frame = this.audioFrameBuffer.shift()!;
                const promise = audioStream.writeData(frame, this.mediaTime);
                promise.then(() => {
                    if (frame instanceof AudioData)
                        frame.close();
                });
                promises.push(promise);
            }
        } else if (audioStream) {
            console.debug("Low on Audio Frames");
        }

        if (subtitleStream) {
            await subtitleStream.display({
                expectedDisplayTime: performance.now(),
                mediaTime: this.mediaTime,
                width: this.video.videoWidth,
                height: this.video.videoHeight,
            });
        }

        //await Promise.all(promises);

        return promises.length > 0;
    }

    private async firstFrameAsPoster(cover: Blob | undefined) {
        const coverMaker = (data: Blob | undefined) => {
            if (data) {
                const url = URL.createObjectURL(data);
                this.video.poster = url;
                this.posterUrl = url;
            }
        };
        if (cover) {
            coverMaker(cover);
            return;
        }

        if (this.activeVideoStream === -1) {
            this.video.poster = musicIcon;
            this.posterUrl = musicIcon;
            return;
        }

        while (!(this.videoFrameBuffer[0] instanceof VideoFrame)) {
            await new Promise<void>(r => setTimeout(r, 0));
        }

        const frame = this.videoFrameBuffer[0] as VideoFrame;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;

        canvas.width = frame.codedWidth;
        canvas.height = frame.codedHeight;

        ctx.drawImage(frame, 0, 0);
        canvas.toBlob(data => {
            coverMaker(data ?? undefined);
        }, 'image/jpeg', 0.8);
        canvas.remove();
    }

    private updateTime() {
        const currentTime: number = this.mediaTime / 1000;
        const duration: number = this.duration / 1000;

        this.controls.setDuration(duration);
        this.controls.updateCurrentTime(currentTime);

        this.video.currentTime = duration;
    }

    private async seek(time: number, force: boolean = false) {
        if (this.seeking) return;
        this.mediaTime = time;
        this.seeking = true;
        this.controls.setLoadingState(true);
        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);
        if (this.activeVideoStream !== -1 && !force) {
            if (this.videoFrameBuffer.some(f => f
                && f.timestamp / 1000 <= time
                && (f.timestamp + f.duration!) / 1000 > time)) {

                console.log("Its your lucky day. You can fast seek!");

                await videoStream?.seekTo(time, true);
                await audioStream?.seekTo(time, true);
                this.seeking = false;
                this.controls.setLoadingState(false);
                return;
            }
        }

        if (this.activeVideoStream === -1 && this.activeAudioStream !== -1 && !force) {
            if (this.audioFrameBuffer.some(f => {
                if (f === null) return false;
                const { timestamp, duration } = audioTime(f);
                return timestamp / 1000 <= time
                    && (timestamp + duration!) / 1000 > time;
            })) {

                console.log("Its your lucky day. You can fast seek!");

                await videoStream?.seekTo(time, true);
                await audioStream?.seekTo(time, true);
                this.seeking = false;
                this.controls.setLoadingState(false);
                return;
            }
        }
        console.debug("Seeking started at", performance.now());
        this.endOfFile = false;
        await this.workerEventer.sendEvent(FFmpegRequestEvent.SEEK, { time: time }, true);
        for (const frame of this.videoFrameBuffer)
            if (frame)
                frame.close();
        for (const frame of this.audioFrameBuffer)
            if (frame instanceof AudioData)
                frame.close();
        this.videoFrameBuffer.length = 0;
        this.audioFrameBuffer.length = 0;

        //const subtitleStream = this.videoRenderer.get(this.activeVideoStream);
        await videoStream?.seekTo(time, true);
        await audioStream?.seekTo(time, true);

        const status = await this.workerEventer.waitUntilEvent(FFmpegResponseEvent.SEEK_STATUS);
        console.debug("Seeking finishing at", performance.now());
        if (status?.data.status !== 0) {
            console.error("Status bad????", status?.data.status);
            return;
        }

        const timePromise = this.workerEventer.waitUntilEvent(FFmpegResponseEvent.SET_TIME);

        if (this.activeVideoStream !== -1)
            while (this.videoFrameBuffer.length === 0)
                await this.requestData();
        else if (this.activeAudioStream !== -1)
            while (this.audioFrameBuffer.length === 0)
                await this.requestData();

        const newTime = await timePromise;
        this.mediaTime = Number(newTime!.data.time) / 1000;
        this.seeking = false;
        this.controls.setLoadingState(false);

        // In share-play mode the controller holds playback until every member
        // has confirmed the seek; only resume here for standalone playback.
        console.debug("Playing media at", performance.now());
        if (!this.commandHandler)
            this.play();
    }

    private async updateTrack(type: "video" | "audio" | "subtitle", index: number): Promise<void> {
        console.log(`Changing ${type} track to index: ${index}`);
        this.controls.setLoadingState(true);

        const updateFFmpeg = (i: number, enabled: boolean) => {
            const { promise, resolve } = Promise.withResolvers();
            this.worker.addEventListener("message", resolve, { once: true });

            this.worker.postMessage({
                kind: "changeStream",
                index: i,
                enabled: enabled
            } as WorkerChangeStream);

            return promise;
        };

        switch (type) {
            case "video": {
                this.activeVideoStream = index;
                for (const [i, stream] of this.videoRenderer) {
                    const enabled = index === i;
                    stream.enable(enabled);
                    await updateFFmpeg(i, enabled);
                }
                this.videoFrameBuffer.length = 0;
                break;
            }
            case "audio": {
                this.activeAudioStream = index;
                for (const [i, stream] of this.audioRenderer) {
                    const enabled = index === i;
                    stream.enable(enabled);
                    await updateFFmpeg(i, enabled);
                }
                this.audioFrameBuffer.length = 0;
                break;
            }
            case "subtitle": {
                this.activeSubtitleStream = -1;

                // Kinda odd but first disable all unused streams 
                for (const [i, stream] of this.subtitleRenderer) {
                    const enabled = index === i;
                    if (!enabled) {
                        await stream.enable(enabled);
                        await updateFFmpeg(i, enabled);
                    }
                }

                // Then enable the correct one. This is in case the same canvas is used by another stream
                const stream = this.subtitleRenderer.get(index);
                if (stream) {
                    await stream.enable(true);
                    await updateFFmpeg(index, true);
                }

                this.activeSubtitleStream = index;

                break;
            }
        }

        this.controls.setLoadingState(false);
    }

    public play() {
        this.controls.setPlayback(true);
        this.paused = false;

        for (const [_, stream] of this.audioRenderer) {
            stream.stealPlayEvent();
        }
    }

    public pause() {
        this.controls.setPlayback(false);
        this.paused = true;
    }

    /** External seek in milliseconds. Resolves when the seek completes. */
    public async seekTo(timeMs: number): Promise<void> {
        await this.seek(timeMs);
    }

    /** Routes user-initiated play/pause/seek to the share-play controller. */
    public setCommandHandler(handler: (command: PlaybackCommand) => void): void {
        this.commandHandler = handler;
    }

    public getVideo() {
        return this.container;
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
