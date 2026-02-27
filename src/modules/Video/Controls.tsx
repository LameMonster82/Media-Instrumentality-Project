import styles from '@/css/VideoControls.module.css';
import { createBox } from '@/JSXRuntime/Box';
import type { AudioMediaStream, ChapterInfo, SubtitleMediaStream, VideoMediaStream } from '../SomeTypes';



// Define the contract for how Controls communicate back to the Parent
export interface MediaControlCallbacks {
    onPlayToggle: (intentPlay: boolean) => void;
    onPauseForSeek: () => void;
    onSeekTo: (time: number) => void;
    onStepFrame: () => void;
    onVolumeChange: (volume: number) => void;
    getMediaDuration: () => number;
    onVideoTrackSelect: (index: number) => void,
    onAudioTrackSelect: (index: number) => void,
    onSubtitleTrackSelect: (index: number) => void,
}

export class MediaControls {
    // DOM Elements (Assume these are initialized via constructor/query selectors)
    private controls: HTMLElement;
    private chapterDataList: HTMLDataListElement = null!;
    private progressBarRange: HTMLInputElement = null!;
    private progressBarHold: HTMLDivElement = null!;
    private progressHoverRange: HTMLDivElement = null!;
    private videoSelect: HTMLSelectElement = null!;
    private videoLabel: HTMLLabelElement = null!;
    private audioSelect: HTMLSelectElement = null!;
    private audiolLabel: HTMLLabelElement = null!;
    private subtitleSelect: HTMLSelectElement = null!;
    private subtitleLabel: HTMLLabelElement = null!;
    private playButton: HTMLButtonElement = null!;
    private playIcon: HTMLElement = null!;
    private bufferBar: HTMLSpanElement = null!;
    private numberProgress: HTMLSpanElement = null!;
    private numberDuration: HTMLSpanElement = null!;
    private bufferVolumeBar: HTMLSpanElement = null!;
    private volumeIcon: HTMLElement = null!;
    private volumeControl: HTMLInputElement = null!;
    private fullscreenBtn: HTMLButtonElement = null!;
    private captionIcon: HTMLElement = null!;
    private trackSelector: HTMLDivElement = null!;
    private transmutatedBar: HTMLSpanElement = null!;

    // Internal UI State
    private isPlaying: boolean = false;
    private hasHours: boolean = false;
    private lastVolume: number = 1;
    private lastProgress: string = "-1";
    private lastTime: number = -1;
    private cursorTimeoutId: number = 0;

    private videoElement: HTMLVideoElement;
    private callbacks: MediaControlCallbacks;

    private videoStreams: VideoMediaStream[] = [];
    private audioStreams: AudioMediaStream[] = [];
    private subtitleStreams: SubtitleMediaStream[] = [];

    private chapters: ChapterInfo[] = [];

    constructor(
        videoElement: HTMLVideoElement, // Passed so controls handle fullscreen/cursor
        callbacks: MediaControlCallbacks
    ) {
        this.videoElement = videoElement;
        this.callbacks = callbacks;
        const chapterList = createBox<HTMLDataListElement>();
        this.controls = <div class={ styles.controls }>
            {/* Play button */ }
            <button class={ styles.videoControlBtn } ref={ r => this.playButton = r }>
                <i class="material-symbols-rounded" ref={ r => this.playIcon = r }>
                    play_arrow
                </i>
            </button>

            {/* Progress bar */ }
            <div class={ styles.progressBar } ref={ r => this.progressBarHold = r }>
                <span class={ styles.bufferRange } ref={ r => this.transmutatedBar = r } />
                <datalist id="chaptersForVideo" style={ { display: "block" } } ref={ r => chapterList.element = this.chapterDataList = r } />
                <input
                    type="range"
                    class={ styles.progressRange }
                    defaultValue="0"
                    step="any"
                    min="0"
                    max="100"
                    list={ chapterList.element }
                    ref={ r => this.progressBarRange = r }
                />
                <div
                    class={ styles.progressHoverTooltip }
                    ref={ r => this.progressHoverRange = r }
                    style={ { bottom: "calc(8px / 2 + 3vh / 2 + 10px)" } }
                />
                <span class={ `${styles.bufferRange} ${styles.activeRange}` } ref={ r => this.bufferBar = r } />
            </div>

            {/* Time indicators */ }
            <span class={ `${styles.progressNumber} ${styles.highlighted}` } ref={ r => this.numberProgress = r }>
                0:00
            </span>
            <span class={ styles.progressNumber } ref={ r => this.numberDuration = r }>
                /0:00
            </span>

            {/* Volume */ }
            <div class={ styles.videoControlBtn }>
                <i class="material-symbols-rounded" ref={ r => this.volumeIcon = r }>
                    volume_up
                </i>
                <span class={ `${styles.volumeControl} ${styles.volumeControlRangeContainer}` }>
                    <span class={ styles.bufferRange } style={ { background: "rgb(36,36,36)" } } />
                    <span class={ `${styles.bufferRange} ${styles.activeRange}` } ref={ r => this.bufferVolumeBar = r } />
                    <input
                        type="range"
                        class={ styles.volumeControl }
                        defaultValue="100"
                        max="100"
                        step="1"
                        ref={ r => this.volumeControl = r }
                    />
                </span>
            </div>

            {/* Captions */ }
            <div class={ styles.videoControlBtn }>
                <i class="material-symbols-rounded" ref={ r => this.captionIcon = r }>
                    subtitles
                </i>
                <div class={ styles.trackSelector } data-is-hidden="1" ref={ r => this.trackSelector = r }>
                    <label ref={ r => this.videoLabel = r }>Video</label>
                    <select ref={ r => this.videoSelect = r } onchange={e => this.callbacks.onVideoTrackSelect(parseFloat(this.videoSelect.selectedOptions[0].value) )}/>

                    <label ref={r => this.audiolLabel = r}>Audio</label>
                    <select ref={ r => this.audioSelect = r } onchange={e => this.callbacks.onAudioTrackSelect(parseFloat(this.audioSelect.selectedOptions[0].value) )}/>

                    <label ref={r => this.subtitleLabel = r}>Subtitles</label>
                    <select ref={ r => this.subtitleSelect = r } onchange={e => this.callbacks.onSubtitleTrackSelect(parseFloat(this.subtitleSelect.selectedOptions[0].value) )}/>
                </div>
            </div>

            {/* Fullscreen */ }
            <button class={ styles.videoControlBtn } ref={ r => this.fullscreenBtn = r }>
                <i class="material-symbols-rounded">fullscreen</i>
            </button>
        </div>;

        this.initListeners();
        makeDraggable(this.controls);

        this.UpdateVideoTracks([])
        this.UpdateAudioTracks([]);
        this.UpdateSubtitleTracks([]);
    }

    // ==========================================
    // INITIALIZATION & EVENT LISTENERS
    // ==========================================
    private initListeners() {
        // --- Playback & Seeking ---
        this.playButton.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            this.callbacks.onPlayToggle(this.isPlaying);
        });

        this.progressBarRange.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.callbacks.onPauseForSeek();
        });

        this.progressBarRange.addEventListener('input', (e) => {
            e.stopPropagation();
            this.updateTimeVisuals(this.progressBarRange.valueAsNumber);
        });

        this.progressBarRange.addEventListener('mouseup', (e) => {
            e.stopPropagation();
            this.callbacks.onSeekTo(this.progressBarRange.valueAsNumber);
        });

        // --- Progress Bar Hover ---
        this.progressBarRange.addEventListener('mousemove', (e) => {
            this.progressHoverRange.classList.add('active');
            const rect = this.progressBarRange.getBoundingClientRect();
            const rect2 = this.progressHoverRange.getBoundingClientRect();

            const clickPosition = (e.clientX - rect.left) / rect.width;
            const duration = this.callbacks.getMediaDuration();
            const potentialValue = clickPosition * duration;

            let chapterName = this.chapters.find(c => c.start <= potentialValue && c.end >= potentialValue)?.data["title"] ?? "";
            if (chapterName.length > 0) chapterName = chapterName + "\n";

            this.progressHoverRange.textContent = chapterName + formatSeconds(potentialValue, this.hasHours).time;
            this.progressHoverRange.style.left = `${e.offsetX - rect2.width / 2}px`;
        });

        this.progressBarRange.addEventListener('mouseleave', () => {
            this.progressHoverRange.classList.remove('active');
        });

        // --- Volume ---
        this.volumeIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            let newVolume = 0;
            if (this.lastVolume > 0) { // Currently unmuted, mute it
                newVolume = 0;
            } else { // Currently muted, restore
                newVolume = Math.max(0.01, Math.min(this.lastVolume, 1)); // clamp logic
            }
            this.updateVolumeVisuals(newVolume);
            this.callbacks.onVolumeChange(newVolume);
        });

        this.volumeControl.addEventListener('input', (e) => {
            e.stopPropagation();
            const newVolume = parseFloat(this.volumeControl.value) / 100;
            this.updateVolumeVisuals(newVolume);
            this.callbacks.onVolumeChange(newVolume);
        });

        // --- Fullscreen ---
        this.fullscreenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFullscreen();
        });
        this.videoElement.addEventListener('dblclick', () => this.toggleFullscreen());

        // --- Captions / Tracks ---
        this.captionIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTrackSelector();
        });

        // --- Hotkeys & Interactivity (Attached to video wrapper) ---
        this.videoElement.addEventListener("keydown", (e) => this.handleKeydown(e));

        this.controls.addEventListener('mouseenter', () => this.showCursor());
        this.controls.addEventListener('mouseleave', () => this.hideCursorDelay());
        this.videoElement.addEventListener('mousemove', () => {
            this.showCursor();
            this.hideCursorDelay();
        });

        // Set initial state
        this.hideCursorDelay();
    }

    // ==========================================
    // PARENT -> CONTROLS API (Pushed State)
    // ==========================================

    public setDuration(duration: number) {
        const timeObj = formatSeconds(duration, false);
        this.numberDuration.textContent = `/${timeObj.time}`;
        this.hasHours = timeObj.hours;
    }

    public updateCurrentTime(time: number, duration: number) {
        this.updateTimeVisuals(time, duration);
    }

    public setBufferProgress(percent: number) {
        this.transmutatedBar.style.setProperty(`--buffer-progress`, `${percent}%`);
    }

    public syncPlaybackState(isPlaying: boolean) {
        this.isPlaying = isPlaying;
        this.playIcon.textContent = this.isPlaying ? 'pause' : 'play_arrow';
    }

    public syncVolumeState(volume: number) {
        if (volume > 0) this.lastVolume = volume;
        this.updateVolumeVisuals(volume);
    }

    public UpdateVideoTracks(videos: VideoMediaStream[]) {
        this.videoSelect.innerHTML = '';
        this.videoStreams = videos;
        for (const video of videos) {
            this.videoSelect.appendChild(<option
                selected={ video.isUsed }
                value={ video.index.toString() }
                text={ video.metadata["title"] ?? video.metadata["TITLE"] ?? video.metadata["language"] ?? video.metadata["LANGUAGE"] ?? `Stream: ${video.index}` }
            />);
        }

        const visible = videos.length > 0 ? 'unset' : 'none';
        this.videoSelect.style.display = visible;
        this.videoLabel.style.display = visible;
    }

    public UpdateAudioTracks(audios: AudioMediaStream[]) {
        this.audioSelect.innerHTML = '';
        this.audioStreams = audios;
        for (const audio of audios) {
            this.audioSelect.appendChild(<option
                selected={ audio.isUsed }
                value={ audio.index.toString() }
                text={ audio.metadata["title"] ?? audio.metadata["TITLE"] ?? audio.metadata["language"] ?? audio.metadata["LANGUAGE"] ?? `Stream: ${audio.index}` }
            />);
        }

        const visible = audios.length > 0 ? 'unset' : 'none';
        this.audioSelect.style.display = visible;
        this.audiolLabel.style.display = visible;
    }

    public UpdateSubtitleTracks(subtitles: SubtitleMediaStream[]) {
        this.subtitleSelect.innerHTML = '';
        this.subtitleStreams = subtitles;
        for (const subtitle of subtitles) {
            this.subtitleSelect.appendChild(<option
                selected={ subtitle.isUsed }
                value={ subtitle.index.toString() }
                text={ subtitle.metadata["title"] ?? subtitle.metadata["TITLE"] ?? subtitle.metadata["language"] ?? subtitle.metadata["LANGUAGE"] ?? `Stream: ${subtitle.index}` }
            />);
        }

        const visible = subtitles.length > 0 ? 'unset' : 'none';
        this.subtitleSelect.style.display = visible;
        this.subtitleLabel.style.display = visible;
    }

    public UpdateChapters(chapters: ChapterInfo[]) {
        this.chapterDataList.innerHTML = '';
        this.chapters = chapters;
        for (const chapter of chapters) {
            const time = chapter.start;
            this.chapterDataList?.appendChild(
                <option value={ time.toString() }
                    title={ chapter.data["title"] ?? chapter.index }
                    onclick={ () => this.callbacks.onSeekTo(time) }
                    style={ { left: `calc(${time} / var(--video-duration) * 100% - 1px)` } }
                />);
        }
    }

    // ==========================================
    // INTERNAL UI LOGIC
    // ==========================================

    private updateTimeVisuals(time: number, duration?: number) {
        const mediaDuration = duration ?? this.callbacks.getMediaDuration();
        const progress = ((time / mediaDuration) * 100).toPrecision(4);

        if (this.lastProgress !== progress) {
            this.progressBarRange.value = progress === "NaN" ? '0' : time.toString();
            this.lastProgress = progress;
            this.bufferBar.style.setProperty('--video-progress', `${progress}%`);
        }

        if (this.lastTime !== time) {
            this.numberProgress.textContent = formatSeconds(time, this.hasHours).time;
            this.lastTime = time;
        }
    }

    private updateVolumeVisuals(volume: number) {
        this.volumeControl.value = (volume * 100).toString();
        this.bufferVolumeBar.style.setProperty('--video-progress', `${volume * 100}%`);

        if (volume >= 0.5) this.volumeIcon.textContent = 'volume_up';
        else if (volume > 0.25) this.volumeIcon.textContent = 'volume_down';
        else if (volume > 0) this.volumeIcon.textContent = 'volume_mute';
        else this.volumeIcon.textContent = 'no_sound';
    }

    private handleKeydown(event: KeyboardEvent) {
        event.stopPropagation();
        const currentTime = parseFloat(this.progressBarRange.value || "0"); // Or get from callback

        switch (event.key) {
            case "ArrowLeft":
                this.callbacks.onSeekTo(currentTime - 5);
                break;
            case "ArrowRight":
                this.callbacks.onSeekTo(currentTime + 5);
                break;
            case " ":
                this.playButton.click();
                break;
            case "e":
                if (!this.isPlaying) {
                    this.callbacks.onStepFrame();
                }
                break;
        }
    }

    private toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            const setupVideo = () => {
                this.videoElement.style.maxWidth = 'unset';
                this.videoElement.style.maxHeight = 'unset';
                this.videoElement.style.width = '100%';
                this.videoElement.style.height = '100%';
                this.videoElement.style.top = '0';
            };
            const exitFullscreenSetup = () => {
                this.videoElement.style.maxWidth = '';
                this.videoElement.style.maxHeight = '';
                this.videoElement.style.width = '';
                this.videoElement.style.height = '';
                this.videoElement.style.top = '';
            };

            const parent = this.videoElement.parentElement!;
            // Type assertion for webkit fallbacks
            const videoElemAny = this.videoElement as any;

            if (parent && parent.requestFullscreen) {
                parent.requestFullscreen().then(() => {
                    setupVideo();
                    setTimeout(() => parent.addEventListener('fullscreenchange', exitFullscreenSetup, { once: true }), 100);
                });
            } else if (this.videoElement.requestFullscreen) {
                this.videoElement.requestFullscreen().then(() => {
                    setupVideo();
                    setTimeout(() => this.videoElement.addEventListener('fullscreenchange', exitFullscreenSetup, { once: true }), 100);
                });
            } else if (videoElemAny.webkitEnterFullscreen && videoElemAny.webkitSupportsFullscreen) {
                videoElemAny.webkitEnterFullscreen();
                setupVideo();
                this.videoElement.addEventListener('fullscreenchange', exitFullscreenSetup, { once: true });
            }
        }
    }

    private toggleTrackSelector() {
        if (this.trackSelector.dataset.isHidden == '1') {
            this.trackSelector.style.height = this.trackSelector.scrollHeight + "px";
            this.trackSelector.classList.add('open');
            this.controls.classList.add('tracklist-open');
            this.trackSelector.dataset.isHidden = '0';
        } else {
            this.trackSelector.classList.remove('open');
            this.controls.classList.remove('tracklist-open');
            this.trackSelector.style.height = "0px";
            this.trackSelector.dataset.isHidden = '1';
        }
    }

    private showCursor() {
        this.videoElement.style.cursor = 'auto';
        this.controls.classList.remove("inactive");
        if (this.cursorTimeoutId) clearTimeout(this.cursorTimeoutId);
    }

    private hideCursorDelay() {
        if (this.cursorTimeoutId) clearTimeout(this.cursorTimeoutId);
        this.cursorTimeoutId = window.setTimeout(() => {
            this.videoElement.style.cursor = 'none';
            this.controls.classList.add("inactive");
        }, 3000);
    }

    // Expose DOM elements that the parent might still need to inject track options into
    public get controlsContainer() { return this.controls; }
}

function formatSeconds(seconds: number, hoursEnabled: boolean) {
    seconds = Math.max(seconds, 0);
    const hours = Math.floor(seconds / 3600); // Get the number of hours
    const minutes = Math.floor((seconds % 3600) / 60); // Get the number of minutes
    const remainingSeconds = Math.floor(seconds % 60); // Get the number of seconds
    //const milliseconds = Math.floor((seconds % 1) * 1000); // Get the milliseconds

    // Format the time without leading zeroes for hours or minutes
    let formattedTime = '';

    if (hours > 0 || hoursEnabled) {
        formattedTime += `${hours.toString().padStart(2, '0')}:`; // Add hours if greater than 0
    }
    formattedTime += `${minutes.toString().padStart(2, '0')}:`; // Add minutes if greater than 0 or hours exist


    formattedTime += `${remainingSeconds.toString().padStart(2, '0')}`; //.${milliseconds.toString().padStart(3, '0')}`; // Always add seconds and milliseconds

    return { time: formattedTime, hours: (hours > 0 || hoursEnabled) };
}

function makeDraggable(element: HTMLElement, container?: HTMLElement) { // Added containerRect
    let offsetX = 0, offsetY = 0, isDragging = false;
    let minX = -Infinity, minY = -Infinity, maxX = Infinity, maxY = Infinity;

    container ??= document.body;

    let containerRect = container.getBoundingClientRect();
    const updateBoundingBox = () => {
        containerRect = container.getBoundingClientRect();

        minX = containerRect.left;
        minY = containerRect.top;
        maxX = containerRect.right;
        maxY = containerRect.bottom;

        let x = parseFloat(element.style.left);
        let y = parseFloat(element.style.top);
        // Clamp the values
        x = Math.max(minX, Math.min(maxX - element.offsetWidth, x));
        y = Math.max(minY, Math.min(maxY - element.offsetHeight, y));

        element.style.left = x + 'px';
        element.style.top = y + 'px';
    };
    window.addEventListener('resize', () => {
        updateBoundingBox();
    });
    window.addEventListener('fullscreenchange', () => {
        updateBoundingBox();
    });

    minX = containerRect.left;
    minY = containerRect.top;
    maxX = containerRect.right;
    maxY = containerRect.bottom;


    const onMouseDown = (e: MouseEvent) => {
        if (e.target !== element) return;
        isDragging = true;
        offsetX = e.clientX - element.getBoundingClientRect().left;
        offsetY = e.clientY - element.getBoundingClientRect().top;
        element.style.cursor = 'grabbing'; // Change cursor style
        if (e.preventDefault) e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        let x = e.clientX - offsetX;
        let y = e.clientY - offsetY;

        // Clamp the values
        x = Math.max(minX, Math.min(maxX - element.offsetWidth, x));
        y = Math.max(minY, Math.min(maxY - element.offsetHeight, y));

        element.style.left = x + 'px';
        element.style.top = y + 'px';
    };

    const onMouseUp = () => {
        isDragging = false;
        element.style.cursor = 'grab';  // Restore cursor style
    };

    const onTouchStart = (e: TouchEvent) => {
        if (e.target !== element) return;
        isDragging = true;
        const touch = e.touches[0];
        offsetX = touch.clientX - element.getBoundingClientRect().left;
        offsetY = touch.clientY - element.getBoundingClientRect().top;
        element.style.cursor = 'grabbing';
        if (e.preventDefault) e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        let x = touch.clientX - offsetX;
        let y = touch.clientY - offsetY;

        // Clamp the values
        x = Math.max(minX, Math.min(maxX - element.offsetWidth, x));
        y = Math.max(minY, Math.min(maxY - element.offsetHeight, y));

        element.style.left = x + 'px';
        element.style.top = y + 'px';
    };

    const onTouchEnd = () => {
        isDragging = false;
        element.style.cursor = 'grab';
    };


    element.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    element.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);


    // Cleanup function (important for preventing memory leaks if you dynamically create/destroy these elements)
    // @ts-ignore
    element.destroyDraggable = () => {
        element.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        element.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
    };
}
