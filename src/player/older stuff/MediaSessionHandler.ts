import { generateSilentWave } from "./VideoUtils";

export class MediaSessionHandler {
    private dummyAudio: HTMLAudioElement | undefined;

    constructor(
        private video: HTMLVideoElement,
        private getMediaDuration: () => number,
        private getCurrentTime: () => number,
        private onSeekRequest: (time: number) => void
    ) {}

    public setup() {
        const base64Audio = generateSilentWave(60, 44100, 16, 1);
        this.dummyAudio = new Audio(base64Audio);
        this.dummyAudio.loop = true;
        this.dummyAudio.controls = true;

        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                this.video.dispatchEvent(new Event("playPauseIntent"));
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                this.video.dispatchEvent(new Event("playPauseIntent"));
            });

            const defaultSkipTime = 10;
            navigator.mediaSession.setActionHandler('seekbackward', (event) => {
                const skipTime = event.seekOffset || defaultSkipTime;
                this.onSeekRequest(this.getCurrentTime() - skipTime);
                this.updateMediaSessionPos();
            });

            navigator.mediaSession.setActionHandler('seekforward', (event) => {
                const skipTime = event.seekOffset || defaultSkipTime;
                this.onSeekRequest(this.getCurrentTime() + skipTime);
                this.updateMediaSessionPos();
            });

            navigator.mediaSession.setActionHandler('seekto', (event) => {
                this.onSeekRequest(event.seekTime || 0);
                this.updateMediaSessionPos();
            });
        }
    }

    public syncPlaybackState(isPlaying: boolean) {
        if (isPlaying) {
            this.dummyAudio?.play();
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing";
        } else {
            this.dummyAudio?.pause();
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
        }
    }

    public updateMediaSessionPos() {
        if ('mediaSession' in navigator && this.getMediaDuration() > 0) {
            navigator.mediaSession.setPositionState({
                duration: this.getMediaDuration(),
                playbackRate: 1,
                position: this.getCurrentTime()
            });
        }
    }

    public setMetadata(title: string, artist?: string, album?: string, thumbnailUrl?: string) {
        if ('mediaSession' in navigator) {
            const artworks = thumbnailUrl ? [{ src: thumbnailUrl }] : [];
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title,
                artist: artist,
                album: album,
                artwork: artworks
            });
        }
    }

    public destroy() {
        this.dummyAudio?.remove();
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = null;
        }
    }
}