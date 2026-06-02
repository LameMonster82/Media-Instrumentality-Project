export class MediaClock {
    private startTimestamp: number = 0;
    private currentTime: number = 0; // In seconds
    private mediaClock: number = 0;

    public isPlaying: boolean = false;
    public isSeeking: boolean = false;

    public RealTime(): number {
        if (this.isPlaying && !this.isSeeking) {
            const now = performance.now();
            return this.currentTime + ((now - this.startTimestamp) / 1000);
        }
        return this.currentTime;
    }

    public MediaTime(): number {
        return this.mediaClock;
    }

    public AdvanceMediaTime(time: number) {
        this.mediaClock = time;
    }

    public Play() {
        if (this.isPlaying) return;
        this.startTimestamp = performance.now();
        this.isPlaying = true;
    }

    public Pause() {
        if (!this.isPlaying) return;
        this.currentTime = this.RealTime(); // lock exact pause time
        this.isPlaying = false;
    }

    public Seek(timeSeconds: number) {
        this.currentTime = timeSeconds;
        if (this.isPlaying) {
            this.startTimestamp = performance.now();
        }
    }

    public SetSeeking(seeking: boolean) {
        if (seeking) {
            if (this.isPlaying) this.currentTime = this.RealTime(); // freeze time
        } else {
            if (this.isPlaying) this.startTimestamp = performance.now(); // resume time
        }
        this.isSeeking = seeking;
    }
}
