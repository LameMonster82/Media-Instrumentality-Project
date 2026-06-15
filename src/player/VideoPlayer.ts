import MediaControls from "@/components/controls/Controls";
import ffmpegWorker from "@/player/FFmpeg/bridge.worker?worker";
import AtomicEventer from "./atomicEventer/atomicEventer";
import type { DecodeTemplate } from "./atomicEventer/types";
import type { AllRespondWorkerEventsKind, DictionaryWorkerEvent, RespondEventByKind, WorkerFFmpegInitComplete, WorkerInitFFmpeg } from "./FFmpeg/types";
import { FFmpegRequestEvent, ffmpegRequestTemplate, FFmpegResponseEvent, ffmpegResponseTemplate } from "./FFmpeg/advancedTypes/atomicTypes";
import { MediaType } from "./FFmpeg/structReader";
import WebGPUCompositor from "./webgpu/composer";

export class VideoPlayer2 {
    private video = document.createElement('video');
    private controls: MediaControls;

    private workerEventer: AtomicEventer<
        FFmpegRequestEvent,
        FFmpegResponseEvent,
        typeof ffmpegRequestTemplate,
        typeof ffmpegResponseTemplate
    > = new AtomicEventer(undefined, ffmpegRequestTemplate, ffmpegResponseTemplate);

    private eventCallback: DictionaryWorkerEvent = { initComplete: [] };

    constructor(videoUrl: string) {
        this.video = document.createElement('video');
        //this.video.srcObject = this.mediaSource;
        this.video.src = videoUrl;

        this.workerEventer.receiveEvent(this.handleAtomicEvents.bind(this));
        const worker = ffmpegWorker({ name: "I tell ffmpeg to do the work" });
        worker.onmessage = this.handleSlowEvent.bind(this);
        worker.postMessage({
            url: videoUrl,
            bufferSize: 32 * 1024 * 1024,
            kind: "initFfmpeg",
            eventerBuffers: this.workerEventer.getBuffers(),
        } as WorkerInitFFmpeg);

        window.onbeforeunload = () => {
            worker.terminate();
        };

        this.controls = new MediaControls(this.video, {
            onPlayPause: async (intent?: boolean) => {
                intent ??= this.video.paused;
                if (intent) {
                    await this.video.play();
                    //this.clock.Play();
                } else {
                    //this.clock.Pause();
                    this.video.pause();
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
            getMediaDuration: () => this.video.duration,
            getCurrentTime: () => this.video.currentTime,
            getVolume: () => this.video.volume,
            onVideoTrackSelect: (index: number) => this.updateTrack("video", index),
            onAudioTrackSelect: (index: number) => this.updateTrack("audio", index),
            onSubtitleTrackSelect: (index: number) => this.updateTrack("subtitle", index),
        });
        this.setupEventListeners();

        this.initialize();
    }

    async initialize() {
        const data = await this.waitForSlowEvent("initComplete");

        const canvas = document.createElement('canvas');
        const videoStreamIndex = data.info.streams.findIndex(s => s.type === MediaType.RESULT_VIDEO)!;
        const audioStreamIndex = data.info.streams.findIndex(s => s.type === MediaType.RESULT_AUDIO)!;

        const videoStream = data.info.streams[videoStreamIndex];

        this.workerEventer.sendEvent(FFmpegRequestEvent.SET_STREAM_ACTIVE, {
            streamIndex: videoStreamIndex,
            active: true
        });
        await this.workerEventer.waitUntilEvent(FFmpegResponseEvent.SET_STREAM_DONE);
        this.workerEventer.sendEvent(FFmpegRequestEvent.SET_STREAM_ACTIVE, {
            streamIndex: audioStreamIndex,
            active: true
        });
        await this.workerEventer.waitUntilEvent(FFmpegResponseEvent.SET_STREAM_DONE);

        canvas.width = videoStream.video_config!.coded_width;
        canvas.height = videoStream.video_config!.coded_height;

        const composer = new WebGPUCompositor();
        await composer.init(canvas);

        data.streamPorts[data.info.streams.indexOf(videoStream)].onmessage = (e: MessageEvent<VideoFrame>) => {
            composer.renderVideoFrame(e.data);
        }

        document.getElementById("containerAgain")!.append(canvas);

        while (true) {
            this.workerEventer.sendEvent(FFmpegRequestEvent.REQUEST_DATA, {});
            const data = await this.workerEventer.waitUntilEvent(FFmpegResponseEvent.REQUEST_STATUS);
            console.log(data);
        }
    }

    private setupEventListeners(): void {
        if (this.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            this.initControls();
            this.updateTime();
        } else {
            this.video.onloadedmetadata = () => {
                this.initControls();
                this.updateTime();
            };
        }

    }

    private initControls(): void {
        this.video.addEventListener("pause", () => {
            this.controls.setPlayback(false);
        });

        this.video.addEventListener("play", () => {
            this.controls.setPlayback(true);
        });

        this.video.addEventListener('volumechange', () => this.controls.setVolume(this.video.volume));
        this.video.addEventListener('durationchange', () => this.controls.setDuration(this.video.duration));
        this.video.addEventListener('timeupdate', () => {
            if (this.video.paused) return;
            this.updateTime();

        });

        document.getElementById("containerAgain")!.append(this.controls.controlsContainer);
        this.controls.controlsContainer.style.position = 'unset';
    }

    private updateTime() {
        const currentTime: number = this.video.currentTime;
        const duration: number = this.video.duration;

        this.controls.setDuration(duration);
        this.controls.updateCurrentTime(currentTime, duration);
    }

    private updateTrack(type: "video" | "audio" | "subtitle", index: number): void {
        console.log(`Changing ${type} track to index: ${index}`);
    }

    public getVideo() {
        return this.video;
    }









    private handleAtomicEvents(type: FFmpegResponseEvent, data: DecodeTemplate<(typeof ffmpegResponseTemplate)[FFmpegResponseEvent]>) {
        switch (type) {
            case FFmpegResponseEvent.INIT_STATUS:
            case FFmpegResponseEvent.REQUEST_STATUS:
            case FFmpegResponseEvent.SEEK_STATUS:
        }
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


