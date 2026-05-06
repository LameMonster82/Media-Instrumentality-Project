import { MediaControls } from "./modules/Video/Controls";
import { MediaClock } from "./modules/Video/MediaClock";

interface IVideoManager {
    triggerNextFrame(): void;
}


class VideoPlayerApp {
    private video: HTMLVideoElement;
    private controls!: MediaControls; // Initialized in onloadedmetadata

    private videoManager: IVideoManager = {
        triggerNextFrame: () => console.log("Manager stepping frame")
    };
    private clock: MediaClock;

    constructor(videoId: string) {
        const el = document.getElementById(videoId);
        if (!(el instanceof HTMLVideoElement)) {
            throw new Error("Element is not a video element");
        }
        this.video = el;
        this.setupEventListeners();
        this.clock = new MediaClock();
    }

    private setupEventListeners(): void {
        if (this.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
            this.initControls();
            this.UpdateTime();
        } else {
            this.video.onloadedmetadata = () => {
                this.initControls();
                this.UpdateTime();
            };
        }

    }

    private initControls(): void {
        this.controls = new MediaControls(this.video, {
            onPlayToggle: async (intentPlay: boolean) => {
                if (intentPlay) {
                    await this.video.play();
                    this.clock.play();
                } else {
                    this.clock.pause();
                    this.video.pause();
                }
                this.controls.SyncPlaybackState(!this.video.paused);
            },
            onSeekTo: (time: number) => {
                this.video.currentTime = time;
            },
            onStepFrame: () => {
                this.videoManager?.triggerNextFrame();
                this.clock.play();
                this.controls.SyncPlaybackState(true);
            },
            onVolumeChange: (volume: number) => {
                this.video.volume = volume;
            },
            getMediaDuration: () => this.video.duration,
            getCurrentTime: () => this.video.currentTime,
            getVolume: () => this.video.volume,
            onVideoTrackSelect: (index: number) => this.UpdateTrack("video", index),
            onAudioTrackSelect: (index: number) => this.UpdateTrack("audio", index),
            onSubtitleTrackSelect: (index: number) => this.UpdateTrack("subtitle", index),
        });

        this.video.addEventListener("pause", () => {
            this.controls.SyncPlaybackState(false);
        });

        this.video.addEventListener("play", () => {
            this.controls.SyncPlaybackState(true);
        });

        this.video.addEventListener("playPauseIntent", () => {
            if (this.clock.isPlaying) {
                this.clock.pause();
                this.video.pause();
            } else {
                this.clock.play();
                this.video.play();
            }
        });

        this.video.addEventListener('volumechange', () => this.controls.SyncVolumeState(this.video.volume));
        this.video.addEventListener('durationchange', () => this.controls.SetDuration(this.video.duration));
        this.video.addEventListener('timeupdate', (e) => {
            if (!this.clock.isPlaying) return;
            this.UpdateTime();

        });

        document.getElementById("containerAgain")!.append(this.controls.controlsContainer);
        this.controls.controlsContainer.style.position = 'unset';
    }

    private UpdateTime() {
        const currentTime: number = this.video.currentTime;
        const duration: number = this.video.duration;

        this.controls.SetDuration(duration);
        this.controls.UpdateCurrentTime(currentTime, duration);
    }

    private UpdateTrack(type: "video" | "audio" | "subtitle", index: number): void {
        console.log(`Changing ${type} track to index: ${index}`);
    }
}

// Initialization
const app = new VideoPlayerApp('testVideo');