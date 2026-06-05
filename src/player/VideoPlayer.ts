import MediaControls from "@/components/controls/Controls";
import ffmpegWorker from "@/player/FFmpeg/bridge.worker?worker"
import AtomicEventer from "./atomicEventer/atomicEventer";
import { ffmpegRequestTemplate, FFmpegResponseEvent, ffmpegResponseTemplate, type FFmpegRequestEvent } from "./FFmpeg/atomicTypes";
import type { DecodeTemplate } from "./atomicEventer/types";

export class VideoPlayer2 {
    private video = document.createElement('video');
    private mediaSource = new MediaSource();
    private controls: MediaControls;

    private workerEventer: AtomicEventer<
        FFmpegRequestEvent,
        FFmpegResponseEvent,
        typeof ffmpegRequestTemplate,
        typeof ffmpegResponseTemplate
    > = new AtomicEventer(undefined, ffmpegRequestTemplate, ffmpegResponseTemplate);

    constructor(videoUrl: string) {
        this.video = document.createElement('video');
        //this.video.srcObject = this.mediaSource;
        this.video.src = videoUrl;https://youtu.be/dLtRtdg67PU?si=GmVoSW4Bpt43rDTm

        this.workerEventer.receiveEvent(this.handleAtomicEvents.bind(this));
        const worker = ffmpegWorker({ name: "I tell ffmpeg to do the work but kinda better" });

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
    }

    private handleAtomicEvents(type: FFmpegResponseEvent, data: DecodeTemplate<(typeof ffmpegResponseTemplate)[FFmpegResponseEvent]>) {
        switch (type) {
            case FFmpegResponseEvent.INIT_STATUS:
            case FFmpegResponseEvent.REQUEST_STATUS:
            case FFmpegResponseEvent.SEEK_STATUS:
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
        return this.video
    }
}
