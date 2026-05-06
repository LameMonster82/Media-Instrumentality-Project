export class MediaClock {
    private startTimestamp: number = 0;
    private _currentTime: number = 0; // In seconds
    private _isPlaying: boolean = false;
    private _isSeeking: boolean = false;

    public get currentTime(): number {
        if (this._isPlaying && !this._isSeeking) {
            const now = performance.now();
            return this._currentTime + ((now - this.startTimestamp) / 1000);
        }
        return this._currentTime;
    }

    public get isPlaying(): boolean {
        return this._isPlaying;
    }

    public get isSeeking(): boolean {
        return this._isSeeking;
    }

    public play() {
        if (this._isPlaying) return;
        this.startTimestamp = performance.now();
        this._isPlaying = true;
    }

    public pause() {
        if (!this._isPlaying) return;
        this._currentTime = this.currentTime; // lock exact pause time
        this._isPlaying = false;
    }

    public seek(timeSeconds: number) {
        this._currentTime = timeSeconds;
        if (this._isPlaying) {
            this.startTimestamp = performance.now();
        }
    }

    public setSeeking(seeking: boolean) {
        if (seeking) {
            if (this._isPlaying) this._currentTime = this.currentTime; // freeze time
        } else {
            if (this._isPlaying) this.startTimestamp = performance.now(); // resume time
        }
        this._isSeeking = seeking;
    }
}