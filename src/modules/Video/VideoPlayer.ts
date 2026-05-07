import { type AllWorkerMessages, type AudioMediaStream, type ChapterInfo, type Dictionary, type FFmpegStreams, ffmpegUrl, PromiseRes, type SubtitleMediaStream, type VideoMediaStream, type WorkerChangeStream, type WorkerInitFFmpeg, type WorkerMediaInfo, type WorkerRequestFfmpegSeek, type WorkerRequestFrames, type WorkerSubmitStreams } from "../SomeTypes.ts";
import { AudioStreamTrack } from "./Tracks/AudioStreamTrack.js";
import { AudioStreamTrackNative } from "./Tracks/AudioStreamTrackNative.js";
import { BitmapSubtitle } from "./Tracks/BitmapSubtitle.js";
import { MediaControls } from "./Controls.tsx";
import { VideoStreamTrack } from "./Tracks/VideoStreamTrack.js";

import { MediaClock } from "./MediaClock";
import { MediaSessionHandler } from "./MediaSessionHandler";
import { AudioManager } from "./AudioManager";
import { VideoManager } from "./VideoManager";
import { Wait, Resolve, WaitATick } from "./VideoUtils";
import { SubtitleManager } from "./Subtitlemanager.ts";
import lightboxStyles from "@/css/Lightbox.module.css";

export class VideoPlayer {
    private video: HTMLVideoElement;
    public get videoElement(): HTMLVideoElement { return this.video; }

    private controls: MediaControls;
    public get mediaControl(): HTMLElement { return this.controls.controlsContainer; }

    private clock: MediaClock;
    private mediaSessionHandler: MediaSessionHandler;
    private subtitleManager!: SubtitleManager;
    private audioManager!: AudioManager;
    private videoManager!: VideoManager;

    private mediaDuration: number = 0;

    private ffmpegWorker: Worker | null = null;
    private availableStreams: FFmpegStreams[] = [];
    private mediaStream: MediaStream = new MediaStream();
    private fileName: string | undefined;
    private mediaInfo: Dictionary<string> = {};
    private chapters: ChapterInfo[] = [];
    private frontIcon: HTMLElement | null = null;

    private hasVideo: boolean = false;
    private hasAudio: boolean = false;

    private endOfFile: boolean = false;
    private isPlaying: boolean = false;

    private bufferPopedResolves: (() => void)[] = [];
    private streamDecoderQueue: number[] = [];

    constructor() {
        this.video = document.createElement('video');
        this.video.playsInline = true;
        this.video.onerror = (e) => {
            console.error(`The video element did not like that: ${e}`);
        };
        this.video.pause();
        this.video.srcObject = this.mediaStream;

        this.clock = new MediaClock();

        this.controls = new MediaControls(this.video, {
            onPlayPause: this.PlayPause.bind(this),
            onSeekTo: (time) => {
                this.seekTo(time);
            },
            onStepFrame: () => {
                this.videoManager?.triggerNextFrame();
                this.clock.Play(); // Step frame simulates tiny play
                this.controls.SetPlayback(true);
            },
            onVolumeChange: (volume) => { this.video.volume = volume; },
            getMediaDuration: () => this.mediaDuration,
            onVideoTrackSelect: (index) => this.UpdateTrack("video", index),
            onAudioTrackSelect: (index) => this.UpdateTrack("audio", index),
            onSubtitleTrackSelect: (index) => this.UpdateTrack("subtitle", index),
            getCurrentTime: () => this.clock.MediaTime(),
            getVolume: () => this.video.volume,
        });

        this.video.addEventListener("pause", () => {
            if (!this.clock.isPlaying) return;
            this.controls.SetPlayback(false);
            this.mediaSessionHandler?.syncPlaybackState(false);
        });

        this.video.addEventListener("play", () => {
            if (this.clock.isPlaying) return;
            this.controls.SetPlayback(true);
            this.mediaSessionHandler?.syncPlaybackState(true);
        });

        this.video.addEventListener("playPauseIntent", () => {
            this.PlayPause(this.clock.isPlaying);
        });

        this.video.addEventListener('volumechange', () => this.controls.SetVolume(this.video.volume));
        this.video.addEventListener('timeDurationUpdate', () => this.controls.SetDuration(this.mediaDuration));

        this.mediaSessionHandler = new MediaSessionHandler(
            this.video,
            () => this.mediaDuration,
            () => this.clock.MediaTime(),
            (time) => this.seekTo(time)
        );

        window.addEventListener('unload', this.Destroy.bind(this));
    }

    async GetFileReady(file: string, fileName?: string, thumbnailUrl?: string, inCaseWeAddAContainer?: (element: HTMLElement) => void, bufferSize: number = 32768) {
        this.fileName = fileName ?? file;

        let resolvPlayer = () => { };

        this.subtitleManager = new SubtitleManager(this.video, () => this.availableStreams);
        this.audioManager = new AudioManager(this.clock, () => this.availableStreams, (idx) => this.createAudioStream(this.availableStreams[idx]));
        this.videoManager = new VideoManager(this.clock, () => this.availableStreams, async (idx) => await this.createVideoStream(this.availableStreams[idx]), () => {
            this.PlayPause(false);
        });

        this.audioManager.onBufferPopped(this.bufferPopedResolves);
        this.videoManager.onBufferPopped(this.bufferPopedResolves);

        this.ffmpegWorker = new Worker(ffmpegUrl, { type: 'module', name: "I tell ffmpeg to do the work" });

        const messageHandler = async (e: MessageEvent<AllWorkerMessages>) => {
            switch (e.data.kind) {
                case "streams":
                    if (this.availableStreams.length > 0) {
                        for (const i in e.data.streams) {
                            const index = parseInt(i);
                            this.availableStreams[index] ??= e.data.streams[index];
                            this.availableStreams[index].isUsed = e.data.streams[index].isUsed;
                        }
                        return;
                    } else {
                        this.InitStreams(e.data);
                    }
                    return resolvPlayer();
                case "requestAnswered":
                    Resolve(this.audioManager.getBufferInsertedResolvers());
                    Resolve(this.videoManager.getBufferInsertedResolvers());
                    return;
                case "endOfFile":
                    this.endOfFile = true;
                    return;
                case "videoFrame":
                case "FrameBitmapConstructor":
                    return this.videoManager.enqueueVideo(e.data, this.clock.isSeeking);
                case "audioData":
                case "audioDataInit":
                    return this.audioManager.enqueueAudio(e.data, this.clock.isSeeking);
                case "seek": return console.error("Uhh stuff moved");
                case "requestData": return console.error("Uhh stuff moved2");
                case "doneSeeking":
                    return this.SeekFinished(true);
                case "mediaInfo":
                    this.mediaInfo = e.data.data;
                    document.title = this.mediaInfo["title"] ?? this.mediaInfo["TITLE"] ?? this.fileName;
                    this.mediaSessionHandler.setMetadata(document.title, this.mediaInfo["artist"] ?? this.mediaInfo["ARTIST"], this.mediaInfo["album"] ?? this.mediaInfo["ALBUM"], thumbnailUrl);
                    return;
                case "chapterInfo":
                    this.chapters.push(e.data.data);
                    this.controls.UpdateChapters(this.chapters);
                    return;
                case "subtitleBitmap":
                    return this.subtitleManager.addSubtitleBitmap(e.data, this.mediaDuration);
                case "subtitleAss":
                    return this.subtitleManager.addSubtitleAss(e.data, this.clock.isPlaying, inCaseWeAddAContainer);
                case "fontFile":
                    return this.subtitleManager.addFontFile(e.data);
                case "portPost": {
                    e.data.port.onmessage = (j) => messageHandler(j); // Route hardware port through the same pipeline
                    break;
                }
                case "decoderQueueSize": {
                    while (e.data.streamIndex > this.streamDecoderQueue.length) this.streamDecoderQueue.push(0);
                    this.streamDecoderQueue[e.data.streamIndex] = e.data.queue;
                }
            }
        };

        this.ffmpegWorker.onmessage = messageHandler;
        this.ffmpegWorker.onerror = (e) => console.error('Worker error:', e);

        this.ffmpegWorker.postMessage({
            kind: "initFfmpeg",
            url: file,
            bufferSize: bufferSize,
        } as WorkerInitFFmpeg);

        return new Promise<void>(res => resolvPlayer = res);
    }

    private async InitStreams(streams: WorkerSubmitStreams, loading?: SVGSVGElement) {
        this.availableStreams = streams.streams;

        const videoStream = this.availableStreams.find(stream => stream.type == "video" && stream.isUsed);
        if (videoStream) {
            this.hasVideo = true;
            await this.createVideoStream(videoStream as VideoMediaStream);
        }

        const audioStream = this.availableStreams.find(stream => stream.type == "audio" && stream.isUsed);
        if (audioStream) {
            this.hasAudio = true;
            this.createAudioStream(audioStream as AudioMediaStream);
        }

        this.controls.UpdateVideoTracks(this.availableStreams.filter(s => s.type === "video") as VideoMediaStream[]);
        this.controls.UpdateAudioTracks(this.availableStreams.filter(s => s.type === "audio") as AudioMediaStream[]);
        this.controls.UpdateSubtitleTracks(this.availableStreams.filter(s => s.type === "subtitle") as SubtitleMediaStream[]);

        this.controls.SetDuration(this.mediaDuration);
        this.controls.UpdateCurrentTime(0, this.mediaDuration);

        this.mediaSessionHandler.setup();

        this.bufferingLoop();
        this.startBufferUIUpdateLoop();

        await this.RequestFrame();

        const playButton = this.CreatePlayButton(() => {
            this.PlayPause(true);
        });
        this.video.parentElement?.appendChild(playButton);
    }

    private async PlayPause(intent?: boolean) {
        intent ??= !this.isPlaying;
        if (!intent) {
            this.clock.Pause();
            this.video.pause();
        } else {
            this.clock.Play();
            await this.video.play();
        }
        this.isPlaying = intent;
        this.controls.SetPlayback(intent);
        return intent;
    }

    private startBufferUIUpdateLoop() {
        const updateBufferBar = () => {
            let leastTimeVideo = this.hasVideo ? this.videoManager.getLeastBufferTime(this.mediaDuration) : this.mediaDuration;
            let leastTimeAudio = this.hasAudio ? this.audioManager.getLeastBufferTime(this.mediaDuration) : this.mediaDuration;

            const leastTime = Math.min(leastTimeVideo, leastTimeAudio);
            this.controls.setBufferProgress((leastTime / this.mediaDuration) * 100);

            Promise.race([
                Wait(this.videoManager.getBufferInsertedResolvers()),
                Wait(this.audioManager.getBufferInsertedResolvers())
            ]).then(updateBufferBar.bind(this));
        };
        updateBufferBar();
    }

    private async bufferingLoop() {
        if (!this.ffmpegWorker) return;
        while (true) {
            if (this.clock.isPlaying) {
                this.controls.UpdateCurrentTime(this.clock.MediaTime());
            }

            if (this.clock.isSeeking) {
                await WaitATick();
                continue;
            }

            if (!this.AreBuffersLow()) {
                await Wait(this.bufferPopedResolves);
            }

            if (this.AreBuffersLow()) {
                if (this.endOfFile) {
                    if (this.AreBuffersEmpty()) {
                        const { promise, resolve } = PromiseRes<void>();
                        let isDone = false;
                        const call = async () => {
                            if (isDone) return;
                            isDone = true;
                            this.endOfFile = false;
                            await this.seekTo(0);
                            this.PlayPause(true);
                            resolve();
                        };
                        const playButton = this.CreatePlayButton(call.bind(this));
                        this.video.addEventListener('playPauseIntent', call.bind(this), { once: true });
                        this.video.parentElement?.appendChild(playButton);
                        this.controls.SetPlayback(false);

                        await promise;
                        continue;
                    } else {
                        await WaitATick();
                    }
                } else {
                    await this.RequestFrame();
                }

            } else {
                await WaitATick();
            }
        }
    }

    private AreBuffersLow(): boolean {
        let videoLow = false;
        let audioLow = false;

        const activeVideo = this.availableStreams.find(s => s.isUsed && s.type == "video");
        if (activeVideo) {
            videoLow = this.videoManager.isBufferLow(this.streamDecoderQueue[activeVideo.index] ?? 0);
        }

        const activeAudio = this.availableStreams.find(s => s.isUsed && s.type == "audio");
        if (activeAudio) {
            audioLow = this.audioManager.isBufferLow(this.streamDecoderQueue[activeAudio.index] ?? 0);
        }

        return videoLow || audioLow;
    }

    private AreBuffersEmpty(): boolean {
        let videoEmpty = true;
        let audioEmpty = true;

        const activeVideo = this.availableStreams.find(s => s.isUsed && s.type == "video");
        if (activeVideo) {
            videoEmpty = this.videoManager.isBufferEmpty(this.streamDecoderQueue[activeVideo.index] ?? 0);
        }

        const activeAudio = this.availableStreams.find(s => s.isUsed && s.type == "audio");
        if (activeAudio) {
            audioEmpty = this.audioManager.isBufferEmpty(this.streamDecoderQueue[activeAudio.index] ?? 0);
        }

        return videoEmpty && audioEmpty;
    }

    private async RequestFrame() {
        this.ffmpegWorker!.postMessage({ kind: "requestFrames" } as WorkerRequestFrames);

        await Promise.race([
            Wait(this.videoManager.getBufferInsertedResolvers()),
            Wait(this.audioManager.getBufferInsertedResolvers())
        ]);
    }

    private async seekTo(time: number) {
        if (this.clock.isSeeking) return;

        let canQuickSkipVideo = this.hasVideo ? this.videoManager.canQuickSkip(time) : true;
        let canQuickSkipAudio = this.hasAudio ? this.audioManager.canQuickSkip(time) : true;

        if (!canQuickSkipVideo || !canQuickSkipAudio) {
            this.clock.SetSeeking(true);
            this.videoManager.flush(0, true);
            this.audioManager.flush(0, true);

            this.ffmpegWorker?.postMessage({ kind: "seekFfmpeg", seconds: time } as WorkerRequestFfmpegSeek);
        }

        this.endOfFile = false;

        this.clock.Seek(time);
        this.controls.UpdateCurrentTime(time);
        this.video.dispatchEvent(new Event("seek"));

        if (canQuickSkipAudio && canQuickSkipVideo) {
            this.SeekFinished(false);
        }
    }

    private SeekFinished(evictBuffers: boolean) {
        this.videoManager.flush(this.clock.MediaTime(), evictBuffers);
        this.audioManager.flush(this.clock.MediaTime(), evictBuffers);

        this.clock.SetSeeking(false);

        for (const stream of this.availableStreams) {
            stream.mediaStream?.SeekTo(this.clock.MediaTime(), !evictBuffers);
        }

        this.endOfFile = false;

        Resolve(this.bufferPopedResolves);
    }

    private async createVideoStream(streamInfo: FFmpegStreams) {
        const videoPlayer = new VideoStreamTrack();
        await videoPlayer.Initialize();

        for (const streaStr in this.availableStreams) {
            const index2 = parseInt(streaStr);
            const player = this.availableStreams[index2];
            if (player.type === "video" && player.mediaStream) {
                this.mediaStream.removeTrack(player.mediaStream.GetTrack());
            }
        }
        this.mediaDuration = Math.max(streamInfo.duration, this.mediaDuration);
        this.video.dispatchEvent(new Event('timeDurationUpdate'));
        this.availableStreams[streamInfo.index].mediaStream = videoPlayer;
        this.mediaStream.addTrack(videoPlayer.GetTrack());
        return videoPlayer;
    }

    private createAudioStream(streamInfo: FFmpegStreams) {
        let audioPlayer: AudioStreamTrack | AudioStreamTrackNative;
        if (AudioStreamTrackNative.IsSupported()) {
            audioPlayer = new AudioStreamTrackNative();
        } else {
            // @ts-ignore
            audioPlayer = new AudioStreamTrack(streamInfo.index, streamInfo.sampleRate, streamInfo.channels);
        }

        for (const streaStr in this.availableStreams) {
            const index2 = parseInt(streaStr);
            const player = this.availableStreams[index2];
            if (player.type === "audio" && player.mediaStream) {
                this.mediaStream.removeTrack(player.mediaStream.GetTrack());
            }
        }
        this.mediaDuration = Math.max(streamInfo.duration, this.mediaDuration);
        this.video.dispatchEvent(new Event('timeDurationUpdate'));
        this.availableStreams[streamInfo.index].mediaStream = audioPlayer;
        this.mediaStream.addTrack(audioPlayer.GetTrack());
        return audioPlayer;
    }

    private UpdateTrack(type: "video" | "audio" | "subtitle", value: number) {
        for (const streaStr in this.availableStreams) {
            const index2 = parseInt(streaStr);
            const player = this.availableStreams[index2];
            if (player.type === "subtitle" && player.mediaStream) {
                player.mediaStream?.Enable(value === index2);
            } else if ((player.type === 'video' || player.type === 'audio') && player.mediaStream) {
                if (value === index2) {
                    this.mediaStream.addTrack(player.mediaStream.GetTrack()!);
                } else {
                    this.mediaStream.removeTrack(player.mediaStream.GetTrack()!);
                }
            }
        }
        this.ffmpegWorker?.postMessage({ kind: "changeStream", type: type, toIndex: value } as WorkerChangeStream);
        this.seekTo(this.clock.MediaTime());
    }

    public Destroy() {
        this.mediaSessionHandler?.destroy();
        this.frontIcon?.remove();

        this.videoManager?.flush(0, true);
        this.audioManager?.flush(0, true);

        this.availableStreams.forEach(stream => stream.mediaStream?.Destroy());
        this.availableStreams.length = 0;

        if (this.ffmpegWorker) {
            this.ffmpegWorker.onmessage = (e: MessageEvent<AllWorkerMessages>) => {
                if (e.data.kind === "shutdown") {
                    this.ffmpegWorker?.terminate();
                    this.ffmpegWorker = null;
                }
            };
            this.ffmpegWorker.postMessage({ kind: "shutdown" });
            setTimeout(() => this.ffmpegWorker?.terminate(), 3000);
        }

        this.controls.controlsContainer.remove();
        this.videoElement.remove();

        window.removeEventListener('unload', this.Destroy.bind(this));
    }

    private CreatePlayButton(onClick: () => void): HTMLSpanElement {
        const playButton = document.createElement('span');
        playButton.classList.add('zoomin', 'material-symbols-rounded', lightboxStyles.LightboxPreview);
        playButton.style.position = 'fixed';
        playButton.style.color = 'white';
        playButton.style.fontSize = 'min(25vh,25vw)';
        playButton.style.lineHeight = '90vh';
        playButton.style.zIndex = "1003";
        playButton.style.textAlign = "center";
        playButton.style.transition = "unset";
        playButton.onclick = () => {
            playButton.remove();
            onClick();
        };
        playButton.innerHTML = 'play_arrow';
        this.video.addEventListener("playPauseIntent", () => {
            playButton.remove();
        }, { once: true });

        return playButton;
    }
}
