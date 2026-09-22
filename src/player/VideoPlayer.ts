import MediaControls from "@/components/controls/Controls";
import styles from "./videoPlayer.module.css";
import ffmpegWorker from "@/player/FFmpeg/bridge.worker?worker";
import rtcSeekerWorker from "./seeker/rtcSeeker.worker?worker";
import { RequestDataStatus, type AllVideoWorkerEvents, type WorkerChangeStream, type WorkerInitFFmpeg } from "./FFmpeg/types";
import { AVMediaType, AVSubtitleType } from "./FFmpeg/structReader";
import type { CanvasTrackWrapper, MediaStreamTrackWrapper } from "./Tracks/types";
import { GetVideoTrackCtor } from "./Tracks/video/utils";
import { GetAudioTrackCtor } from "./Tracks/audio/utils";
import { audioTime, type WorkerAudioDataInit } from "./Tracks/audio/audioTypes";
import { Dispositions } from "./FFmpeg/advancedTypes/AVTypes";
import type { BitmapSubArgs, VideoDisplayData, VTTCueArgs } from "./Tracks/subtitles/types";
import type { OutsideSource, RtcSeekableWorkerInit, SeekerWorkerInit, WorkerRemoteSoruce } from "./seeker/types";
import musicIcon from "@Resources/Icons/music.svg?url";

import { webYCbCrMap } from "jassub";
import type { ControlStream } from "@/components/controls/types";
import { extractCoverArt, extractFonts } from "./utils";
import SubtitleTextTrack from "./Tracks/subtitles/SubtitleTextTrack";
import SubtitleASSTrack from "./Tracks/subtitles/SubtitleASSTrack";
import SubtitleBitmapTrack from "./Tracks/subtitles/SubtitleBitmapTrack";
import QuickPostmessage from "./quickMessage/QuickMessage";
import { HasData, Intent } from "./types";

// eslint-disable-next-line @typescript-eslint/naming-convention
const DEBUG = import.meta.env.DEV;

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
    private videoFrameBuffer: VideoFrame[] = [];
    private audioFrameBuffer: (AudioData | WorkerAudioDataInit)[] = [];

    // Time
    private mediaTime: DOMHighResTimeStamp = 0;
    private paused: boolean = true;
    private seeking: boolean = false;
    private stepFrame: boolean = false;
    private duration: number = 0;
    private volume: number = 1;

    // Control
    private externallyControlled: boolean = false;

    // Status
    private initDone = false;
    private endOfFile = false;

    // Events    
    private workerEventer2: QuickPostmessage<AllVideoWorkerEvents>;

    private onPlayCB: ((time: number, selfPromise: Promise<unknown>) => void)[] = [];
    private onPauseCB: ((time: number, selfPromise: Promise<unknown>) => void)[] = [];
    private onSeekCB: ((time: number, selfPromise: Promise<unknown>) => void)[] = [];

    // FFmpeg
    private worker: Worker;
    private rtcSeeker: Worker | undefined;
    private dataForSeeker: SeekerWorkerInit | undefined

    private initPromise = Promise.withResolvers<void>();

    constructor(videoSrc: string | File | WorkerRemoteSoruce, externallyControlled: boolean) {
        this.externallyControlled = externallyControlled;

        // DOM
        this.video.classList.add(styles.videoItself);
        this.videoContainer.classList.add(styles.player);
        this.videoContainer.appendChild(this.video);
        this.container.appendChild(this.videoContainer);
        this.video.srcObject = this.mediaStream;
        this.video.autoplay = true;
        this.video.muted = true;
        this.video.tabIndex = 0;

        this.video.addEventListener("click", () => {
            if (this.controls.getLoadingState()) return;
            this.controls.playPause();
        });

        this.container.classList.add(styles.videoContainer);

        // Worker
        const worker = ffmpegWorker({ name: "I tell ffmpeg to do the work" });
        const isRemote = typeof videoSrc === "object" && !(videoSrc instanceof File) && videoSrc.kind === "remoteSource";

        let sourceSrc: string | File | OutsideSource;
        if (isRemote) {
            sourceSrc = { kind: "outsideSource" };
        } else {
            sourceSrc = videoSrc as string | File;
        }

        worker.postMessage({
            fileSource: sourceSrc,
            bufferSize: 32 * 1024 * 1024,
            kind: "initFfmpeg",
        } as WorkerInitFFmpeg);

        
        window.onbeforeunload = () => {
            worker.terminate();
        };
        
        
        this.worker = worker;
        this.workerEventer2 = new QuickPostmessage(worker, worker);
        
        this.workerEventer2.addEventListener("endOfFile", (_data) => {
            this.endOfFile = true;
        });

        if (isRemote) {
            this.workerEventer2.waitForEvent("initSeeker").then(async data => {
                this.dataForSeeker = data;
                videoSrc.resolveInfo();
            })
        }

        // Init
        this.controls = this.initControls();
        this.initMedia().then(this.timeLoop.bind(this));
    }

    public initRTCSeeker(channel: RTCDataChannel, fileSize: number) {
        // RTCDataChannel has this funny quirk that it becomes untransferable when it touches any async code
        // meaning if you want to transfer it to another thread, it has to be asap.
        // No, not even as a promise resolve result. NO ASYNC. NO FUN ALLOWED!!!!!!!
        this.rtcSeeker = rtcSeekerWorker({ name: "I steal the file from your friend over WebRTC Data channels" });

        this.rtcSeeker.postMessage({
            fileSize: fileSize,
            channel: channel,
            bufferSize: this.dataForSeeker!.bufferSize,
            atomicBuffers: this.dataForSeeker!.atomicBuffers,
            targetBuffer: this.dataForSeeker!.targetBuffer,
            kind: "initSeeker"
        } as RtcSeekableWorkerInit, [channel]);
    }

    private callIntent(intent: Intent, time: number, selfPromise: Promise<unknown>) {
        let whatToDo: ((time: number, selfPromise: Promise<unknown>) => void)[] | undefined;
        if (intent === Intent.Play)
            whatToDo = this.onPlayCB;
        else if (intent === Intent.Pause)
            whatToDo = this.onPauseCB;
        else if (intent === Intent.Seek)
            whatToDo = this.onSeekCB;

        for (const callback of whatToDo ?? []) {
            callback(time, selfPromise);
        }
    }

    private initControls(): MediaControls {
        const controls = new MediaControls(this.video, {
            onPlayPause: async (intent?: boolean) => {
                if (this.controls.getLoadingState()) return this.paused;
                intent ??= this.paused;
                if (this.endOfFile && intent && this.duration <= this.mediaTime) {
                    const seek = this.seekTo(0);
                    this.callIntent(Intent.Seek, 0, seek);
                    await seek;
                    const play = this.play();
                    this.callIntent(Intent.Play, this.mediaTime, play);
                    try { this.video.play(); } catch { }
                    this.controls.setPlayback(intent);
                    return intent;
                }
                if (intent) {
                    this.callIntent(Intent.Play, this.mediaTime, this.play()); // this.play()
                    try {
                        this.video.play();
                    } catch { }
                } else {
                    this.callIntent(Intent.Pause, this.mediaTime, this.pause()); // this.pause()
                }
                this.controls.setPlayback(intent);
                return intent;
            },
            onSeekTo: (time: number) => {
                if (this.controls.getLoadingState()) return;
                this.callIntent(Intent.Seek, time * 1000, this.seekTo(time * 1000)); // this.seekTo()
            },
            onStepFrame: () => {
                //this.videoManager?.triggerNextFrame();
                //this.clock.Play();
                if (this.controls.getLoadingState()) return;
                if (this.videoFrameBuffer[0]) {
                    this.mediaTime = this.videoFrameBuffer[0].timestamp / 1000;
                    this.stepFrame = true;
                    this.callIntent(Intent.Pause, this.mediaTime, Promise.resolve());
                }
            },
            onVolumeChange: (volume: number) => {
                this.volume = volume;
                for (const renderer of this.audioRenderer.values())
                    renderer.setVolume?.(volume);
            },
            getMediaDuration: () => this.duration / 1000,
            getCurrentTime: () => this.mediaTime / 1000,
            getVolume: () => this.volume,
            onVideoTrackSelect: (index: number) => this.updateTrack("video", index),
            onAudioTrackSelect: (index: number) => this.updateTrack("audio", index),
            onSubtitleTrackSelect: (index: number) => this.updateTrack("subtitle", index),
        });

        this.container.append(controls.controlsContainer);
        controls.controlsContainer.classList.add(styles.unsetPosition);

        return controls;
    }

    private async initMedia() {
        const data = await this.workerEventer2.waitForEvent("initFFmpegStatus");

        if (data.status < 0 || data.info === null || data.streamPorts === null)
            throw new Error(`FFmpeg failed to init the media with status ${data.status}`);

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
            await renderer.initialize?.();

            const track = renderer.getTrack?.();
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
                    renderer.startTime = stream.startTime / 1000;
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
                    renderer.startTime = stream.startTime / 1000;
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
                            renderer.startTime = stream.startTime / 1000000;
                            await renderer.enable(enabled);
                            this.subtitleRenderer.set(i, renderer);
                            break;
                        }
                        case AVSubtitleType.SUBTITLE_ASS: {
                            const renderer = new SubtitleASSTrack(stream.subtitle_config!.subtitle_header, fonts);
                            renderer.createCanvas(createCanvas.bind(this));
                            renderer.startTime = stream.startTime / 1000000;

                            await renderer.enable(enabled);
                            this.subtitleRenderer.set(i, renderer);
                            break;
                        }
                        case AVSubtitleType.SUBTITLE_BITMAP: {
                            const renderer = new SubtitleBitmapTrack();
                            renderer.createCanvas(createCanvas.bind(this));
                            renderer.startTime = stream.startTime / 1000000;
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
            const messageChannel = data.streamPorts!.get(i);
            if (!messageChannel) return;

            messageChannel.onmessage = (e: MessageEvent<T>) => {
                if (type === AVMediaType.AVMEDIA_TYPE_VIDEO && this.activeVideoStream !== i) return;
                if (type === AVMediaType.AVMEDIA_TYPE_AUDIO && this.activeAudioStream !== i) return;
                buffer.push(e.data);
                buffer.sort((a, b) => {
                    if (a === null) return 1;
                    if (b === null) return -1;
                    return a.timestamp - b.timestamp;
                });
            };
        };

        const handleMessageSub = <T extends { timestamp: number; }>(i: number, renderer: CanvasTrackWrapper<unknown, unknown> | undefined) => {
            if (!renderer) return;
            const messageChannel = data.streamPorts!.get(i);
            if (!messageChannel) return;

            messageChannel.onmessage = async (e: MessageEvent<T>) => {
                await renderer.writeData(e.data);
            };
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

        this.initPromise.resolve();
    }

    private async requestData() {
        const lastTime = performance.now();
        const data = await this.workerEventer2.postMessageAndWait({ kind: "requestData" }, "dataAnswer");

        if(DEBUG)
            console.timeStamp("Request Data", lastTime, performance.now(), "Request Data", "Video Player", "secondary-dark");

        if (data.status === RequestDataStatus.ERR) {
            console.error("Handle random error from ffmpeg");
            return;
        };
        if (data.status === RequestDataStatus.EOF) this.endOfFile = true;
        if (data.status === RequestDataStatus.DECODED_BY_OTHER_THREAD) {
            // if (data.packetType === MediaType.RESULT_VIDEO) {
            //     this.videoFrameBuffer.push(null);
            // } else if (data.packetType === MediaType.RESULT_AUDIO) {
            //     this.audioFrameBuffer.push(null);
            // } else if (data.packetType === MediaType.RESULT_SUBTITLE) {
            //     // TODO but probably wont be seperately decoded
            // }
        }
    }

    private async timeLoop() {
        const clock = new Int32Array(new SharedArrayBuffer(4));
        const sleep = (ms: number) => Atomics.waitAsync(clock, 0, 0, ms).value;

        let lastTime = performance.now();
        let feedBufferPromise: Promise<void> | null = null;
        let isFeedingDone = true;
        while (true) {
            const diff = performance.now() - lastTime;
            if(DEBUG)
                console.timeStamp("Time Loop", lastTime, lastTime + diff, "Time Loop", "Video Player", "primary-light");

            lastTime = performance.now();

            if (this.initDone && !this.endOfFile && !this.seeking && isFeedingDone) {
                feedBufferPromise = this.feedBuffers()?.then(() => { isFeedingDone = true; }) ?? null;
                isFeedingDone = !!!feedBufferPromise;
            }

            if ((this.paused && !this.stepFrame) || this.seeking) {
                await sleep(4);
                continue;
            }

            const hasData = this.hasDataToWrite();
            if (hasData === HasData.False && (!this.endOfFile && !isFeedingDone)) {
                await (feedBufferPromise ?? sleep(4));
                continue;
            }

            this.mediaTime = Math.max(0, Math.min(this.mediaTime + diff, this.duration));
            this.updateTime();

            // Allow time to flow first
            let delta = this.getTimeUntilNextFrame(this.mediaTime);
            if (hasData === HasData.TrueButFirstFrameInFuture) {
                delta = Math.min(delta, 30);
                if (delta > 0) {
                    //const now = performance.now();
                    if (feedBufferPromise)
                        await Promise.race([feedBufferPromise, sleep(delta)]);
                    else await sleep(delta);
                    //console.debug("Actual:", performance.now() - now, " vs Reported:", delta);
                    //console.timeStamp("Atomic sleep Actual", now, performance.now(), "Atomic sleep - Actual", "Video Player", "primary-light");
                    //console.timeStamp("Atomic sleep Reported", now, now + delta, "Atomic sleep - Reported", "Video Player", "primary-light");
                    // await (feedBufferPromise ?? stub());
                    continue;
                }
            }

            while (await this.renderData() && !this.stepFrame) { };

            if (this.endOfFile && this.mediaTime === this.duration) {
                this.pause();
            }
            this.stepFrame = false;

            if (hasData === HasData.False)
                await sleep(4);
        }
    }

    private feedBuffers() {
        if (this.activeVideoStream >= 0 && this.videoFrameBuffer.length < 16) {
            return this.requestData();
        } else if (this.activeAudioStream >= 0 && this.audioFrameBuffer.length < 16) {
            return this.requestData();
        }
        return null;
    }

    private hasDataToWrite(time?: number): HasData {
        time ??= this.mediaTime;

        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);

        const timeBy1000 = time / 1000;
        const hasBuffers = (stream: MediaStreamTrackWrapper<VideoFrame | AudioData | WorkerAudioDataInit>, buffers: { timestamp: number; }[]) => {
            const firstFrameTime = buffers[0].timestamp / 1000;
            const lastFrameTime = buffers[buffers.length - 1].timestamp / 1000;
            const currTime = time - (stream.latency?.(timeBy1000) ?? 0) + stream.startTime;

            if (currTime < firstFrameTime)
                return HasData.TrueButFirstFrameInFuture;
            if (currTime < lastFrameTime)
                return HasData.TrueWithingBuffer;
            return HasData.OldBuffers;
        };

        let thing = HasData.False;
        if (videoStream && this.videoFrameBuffer.length > 0) { 
            thing = Math.max(thing, hasBuffers(videoStream, this.videoFrameBuffer));
        }

        if (audioStream && this.audioFrameBuffer.length > 0) {
            thing = Math.max(thing, hasBuffers(audioStream, this.audioFrameBuffer));
        }

        return thing
    }

    private getTimeUntilNextFrame(time: number): number {
        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);

        const timeBy1000 = time / 1000;
        const hasBuffers = (stream: MediaStreamTrackWrapper<VideoFrame | AudioData | WorkerAudioDataInit>, buffers: { timestamp: number; }[]) => {
            const firstFrameTime = buffers[0].timestamp / 1000;
            const currTime = time - (stream.latency?.(timeBy1000) ?? 0) + stream.startTime;

            return firstFrameTime - currTime;
        };

        let delta = Number.MAX_SAFE_INTEGER;
        if (videoStream && this.videoFrameBuffer.length > 0) {
            delta = Math.min(delta, hasBuffers(videoStream, this.videoFrameBuffer));
        }

        if (audioStream && this.audioFrameBuffer.length > 0) {
            delta = Math.min(delta, hasBuffers(audioStream, this.audioFrameBuffer));
        }

        return delta === Number.MAX_SAFE_INTEGER ? 4 : delta;
    }


    private async renderData() {
        const promises = [];
        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);
        const subtitleStream = this.subtitleRenderer.get(this.activeSubtitleStream);
        const timeBy1000 = this.mediaTime / 1000;

        const writeToStream = async <T extends VideoFrame | AudioData | WorkerAudioDataInit>(stream: MediaStreamTrackWrapper<T>, buffers: T[]) => { 
            const currTime = this.mediaTime - (stream.latency?.(timeBy1000) ?? 0) + stream.startTime;
            const frameTime = buffers[0].timestamp / 1000;
            if (frameTime > currTime) return false;
            const frame = buffers.shift()!;

            if (frame instanceof VideoFrame) {
                const { displayWidth, displayHeight, codedWidth, codedHeight, colorSpace } = frame;
                this.videoContainer.style.setProperty("--videoWidth", displayWidth.toString());
                this.videoContainer.style.setProperty("--videoHeight", displayHeight.toString());
                this.videoContainer.style.setProperty("--codecWidth", codedWidth.toString());
                this.videoContainer.style.setProperty("--codecHeight", codedHeight.toString());

                if (colorSpace.matrix)
                    await subtitleStream?.setColorSpace?.(webYCbCrMap[colorSpace.matrix]);

                if (subtitleStream) {
                    promises.push(subtitleStream.display({
                        expectedDisplayTime: performance.now(),
                        mediaTime: this.mediaTime,
                        width: displayWidth,
                        height: displayHeight,
                    }));
                }
            }

            await stream.writeData(frame);
            // The frame could already be closed but just in case
            if (frame instanceof VideoFrame || frame instanceof AudioData)
                frame.close();

            return true
        }

        if (videoStream && this.videoFrameBuffer.length > 0) {
            promises.push(writeToStream(videoStream, this.videoFrameBuffer))
        }
        if (audioStream && this.audioFrameBuffer.length > 0) {
            promises.push(writeToStream(audioStream, this.audioFrameBuffer))
        }

        const wroteData = await Promise.all(promises);

        return wroteData.some(Boolean);
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

        this.video.currentTime = currentTime;
    }

    private intentActiveStreams(intent: Intent, time: number) {
        const videoStream = this.videoRenderer.get(this.activeVideoStream);
        const audioStream = this.audioRenderer.get(this.activeAudioStream);
        const subtitleStream = this.subtitleRenderer.get(this.activeSubtitleStream);

        return Promise.all([
            videoStream?.intent(intent, time),
            audioStream?.intent(intent, time),
            subtitleStream?.intent(intent, time),
        ]);
    }

    private async seek(time: number, force: boolean = false) {
        const now = performance.now();
        const timeStamp = () => DEBUG ? console.timeStamp("Seek", now, performance.now(), "Player", "Video Player", "primary-light") : 0;
        const timeBy1000 = time / 1000;

        if (!force && this.hasDataToWrite(time) === HasData.TrueWithingBuffer) { // We shouldnt fast seek at "TrueButFirstFrameInFuture"
            console.debug("Its your lucky day. You can fast seek!");
            await this.intentActiveStreams(Intent.Seek, timeBy1000);
            this.mediaTime = time;
            this.updateTime();
            timeStamp();
            return;
        }

        this.endOfFile = false;
        const timePromise = this.workerEventer2.waitForEvent("setTime");
        const status = await this.workerEventer2.postMessageAndWait({ kind: "seekTo", time }, "seekStatus");

        //const subtitleStream = this.videoRenderer.get(this.activeVideoStream);
        await this.intentActiveStreams(Intent.Seek, timeBy1000);
        if (status.status !== 0) {
            console.error("Status bad????", status.status);
            timeStamp();
            return;
        }

        for (const frame of this.videoFrameBuffer)
            if (frame)
                frame.close();
        for (const frame of this.audioFrameBuffer)
            if (frame instanceof AudioData)
                frame.close();
        this.videoFrameBuffer.length = 0;
        this.audioFrameBuffer.length = 0;

        let seekedTime: number | undefined = undefined;
        if (this.activeVideoStream !== -1) {
            while (this.videoFrameBuffer.length === 0 && !this.endOfFile)
                await this.requestData();
            if (!this.endOfFile) {
                seekedTime = this.videoFrameBuffer[0].timestamp / 1000;
                const stream = this.videoRenderer.get(this.activeVideoStream);
                if (stream)
                    await stream.writeData(this.videoFrameBuffer[0].clone());
            }
        }
        else if (this.activeAudioStream !== -1) {
            while (this.audioFrameBuffer.length === 0 && !this.endOfFile)
                await this.requestData();

            if (!this.endOfFile)
                seekedTime = this.audioFrameBuffer[0].timestamp / 1000;
        }

        const newTime = this.endOfFile ? undefined : await timePromise;
        this.mediaTime = seekedTime ?? (newTime ? Number(newTime!.time) / 1000 : time);
        this.updateTime();
        timeStamp();
    }

    private async updateTrack(type: "video" | "audio" | "subtitle", index: number): Promise<void> {
        console.log(`Changing ${type} track to index: ${index}`);
        if(!this.externallyControlled)
            this.controls.setLoadingState(true);

        const updateFFmpeg = (i: number, enabled: boolean) => {
            const promise = this.workerEventer2.waitForEvent("ok");

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

        if (!this.externallyControlled)
            this.controls.setLoadingState(false);
    }

    public async play(hackTime?: number) {
        if (hackTime)
            this.mediaTime = hackTime;
        this.controls.setPlayback(true);
        this.paused = false;

        const timeBy1000 = this.mediaTime / 1000;
        await this.intentActiveStreams(Intent.Play, timeBy1000);
    }

    public async pause(hackTime?: number) {
        if (hackTime)
            this.mediaTime = hackTime;
        this.controls.setPlayback(false);
        this.paused = true;

        const timeBy1000 = this.mediaTime / 1000;
        await this.intentActiveStreams(Intent.Pause, timeBy1000);
    }

    /** External seek in milliseconds. Resolves when the seek completes. */
    public async seekTo(timeMs: number): Promise<void> {
        await this.pause();
        this.seeking = true;
        if (!this.externallyControlled)
            this.controls.setLoadingState(true);
        await this.seek(timeMs);
        if (!this.externallyControlled)
            this.controls.setLoadingState(false);
        this.seeking = false;
    }

    public onPlay(callback: (time: number, selfPromise: Promise<unknown>) => void) {
        this.onPlayCB.push(callback);
    }

    public onPause(callback: (time: number, selfPromise: Promise<unknown>) => void) {
        this.onPauseCB.push(callback);
    }

    public onSeek(callback: (time: number, selfPromise: Promise<unknown>) => void) {
        this.onSeekCB.push(callback);
    }

    public setLoadingState(loading: boolean) {
        this.controls.setLoadingState(loading);
    }

    public getVideo() {
        return this.container;
    }

    public init() {
        return this.initPromise.promise;
    }

    public isPaused() {
        return this.paused;
    }

    public isSeek() {
        return this.seeking;
    }

    public getTime() {
        return this.mediaTime;
    }
}
