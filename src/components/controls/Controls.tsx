import styles from './videoControls.module.css';
import type { ControlChapter, ControlStream } from './types';
import loadingLoop from '@Resources/LoadingIndicator.png';

export interface MediaControlCallbacks {
    onPlayPause: (intent?: boolean) => Promise<boolean>;
    onSeekTo: (time: number) => void;
    onStepFrame: () => void;
    onVolumeChange: (volume: number) => void;
    getMediaDuration: () => number;
    getCurrentTime: () => number,
    getVolume: () => number,
    onVideoTrackSelect: (index: number) => void,
    onAudioTrackSelect: (index: number) => void,
    onSubtitleTrackSelect: (index: number) => void,
}

export default class MediaControls {
    // DOM Elements (Assume these are initialized via constructor/query selectors)
    private controls: HTMLElement;
    private chapterDataList: HTMLDivElement = null!;
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
    private loadingIcon: HTMLImageElement = null!;
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
    private isTryingToPlay: boolean = false;
    private hasHours: boolean = false;
    private lastVolume: number = 1;
    private lastProgress: number = -1;
    private lastTime: number = -1;
    private cursorTimeoutId: number = 0;
    private loadingState: boolean = true;

    private videoElement: HTMLVideoElement;
    private callbacks: MediaControlCallbacks;

    private videoStreams: ControlStream[] = [];
    private audioStreams: ControlStream[] = [];
    private subtitleStreams: ControlStream[] = [];

    private chapters: ControlChapter[] = [];

    constructor(
        videoElement: HTMLVideoElement, // Passed so controls handle fullscreen/cursor
        callbacks: MediaControlCallbacks
    ) {
        const videoSelector = Math.random().toString(16).slice(2, 8);
        const audioSelector = Math.random().toString(16).slice(2, 8);
        const subtitleSelector = Math.random().toString(16).slice(2, 8);

        this.videoElement = videoElement;
        this.callbacks = callbacks;
        this.controls = <div class={ styles.controls }>
            {/* Play button */ }
            <button class={ `${styles.videoControlBtn} material-symbols-rounded` } ref={ r => this.playButton = r }>
                play_arrow
            </button>

            <img class={ `${styles.videoControlBtn} ${styles.iconLoading}` } ref={ r => this.loadingIcon = r } src={ loadingLoop }></img>

            {/* Progress bar */ }
            <div class={ styles.progressBar } ref={ r => this.progressBarHold = r }>
                <span class={ styles.backgroundSlider } ref={ r => this.transmutatedBar = r } />
                <span class={ `${styles.backgroundSlider} ${styles.activeRange}` } ref={ r => this.bufferBar = r } />
                <div class={ styles.chapterBox } ref={ r => this.chapterDataList = r } />
                <input
                    type="range"
                    class={ styles.progressRange }
                    step="any"
                    min="0"
                    max="100"
                    ref={ r => this.progressBarRange = r }
                    style={ { display: "none" } }
                />
                <div
                    class={ styles.progressHoverTooltip }
                    ref={ r => this.progressHoverRange = r }
                    style={ { bottom: "calc(8px / 2 + 3vh / 2 + 10px)" } }
                />
                { /*<span class={ `${styles.backgroundSlider} ${styles.activeRange}` } ref={ r => this.bufferBar = r } /> */ }
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
                    <span class={ styles.backgroundSlider } style={ { background: "rgb(36,36,36)" } } />
                    <span class={ `${styles.backgroundSlider} ${styles.activeRange}` } ref={ r => this.bufferVolumeBar = r } />
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
                    <label for={ videoSelector } ref={ r => this.videoLabel = r }>Video</label>
                    <select id={ videoSelector } ref={ r => this.videoSelect = r } onchange={ () => this.callbacks.onVideoTrackSelect(parseFloat(this.videoSelect.selectedOptions[0].value)) } />

                    <label for={ audioSelector } ref={ r => this.audiolLabel = r }>Audio</label>
                    <select id={ audioSelector } ref={ r => this.audioSelect = r } onchange={ () => this.callbacks.onAudioTrackSelect(parseFloat(this.audioSelect.selectedOptions[0].value)) } />

                    <label for={ subtitleSelector } ref={ r => this.subtitleLabel = r }>Subtitles</label>
                    <select id={ subtitleSelector } ref={ r => this.subtitleSelect = r } onchange={ () => this.callbacks.onSubtitleTrackSelect(parseFloat(this.subtitleSelect.selectedOptions[0].value)) } />
                </div>
            </div>

            {/* Fullscreen */ }
            <button class={ styles.videoControlBtn } ref={ r => this.fullscreenBtn = r }>
                <i class="material-symbols-rounded">fullscreen</i>
            </button>
        </div>;

        this.setLoadingState(true);


        this.progressBarRange.value = "0";
        this.volumeControl.value = "0";

        this.initListeners();
        //makeDraggable(this.controls);

        this.updateVideoTracks([]);
        this.updateAudioTracks([]);
        this.updateSubtitleTracks([]);

        this.updateCurrentTime(this.callbacks.getCurrentTime());
        this.setVolume(this.callbacks.getVolume());
    }

    private initListeners() {
        // --- Playback & Seeking ---
        this.playButton.addEventListener('click', async () => {
            if (this.isTryingToPlay) return;
            this.isTryingToPlay = true;
            await this.callbacks.onPlayPause();
            this.isTryingToPlay = false;
        });

        this.progressBarRange.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.callbacks.onPlayPause(false);
        });

        this.progressBarRange.addEventListener('input', (e) => {
            e.stopPropagation();
            this.updateCurrentTime(this.progressBarRange.valueAsNumber);
            this.callbacks.onSeekTo(this.progressBarRange.valueAsNumber);
        });

        this.progressBarRange.addEventListener('mouseup', (e) => {
            e.stopPropagation();
            //this.callbacks.onSeekTo(this.progressBarRange.valueAsNumber);
        });

        // --- Progress Bar Hover ---
        this.progressBarRange.addEventListener('mousemove', (e) => {
            this.progressHoverRange.classList.add(styles.active);
            const rect = this.progressBarRange.getBoundingClientRect();
            const rect2 = this.progressHoverRange.getBoundingClientRect();

            const clickPosition = (e.clientX - rect.left) / rect.width;
            const duration = this.callbacks.getMediaDuration();
            const potentialValue = clickPosition * duration;

            let title: string = "";
            const chapter = this.chapters.find(c => c.start <= potentialValue && c.end >= potentialValue);

            if (chapter && chapter.title) {
                title = `${chapter.title}\n`;
            }

            this.progressHoverRange.textContent = `${title}${formatSeconds(potentialValue, this.hasHours).time}`;
            this.progressHoverRange.style.left = `${e.offsetX - rect2.width / 2}px`;
        });

        this.progressBarRange.addEventListener('mouseleave', () => {
            this.progressHoverRange.classList.remove(styles.active);
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
        document.addEventListener("keydown", (e) => {
            if (e.target !== this.videoElement) return;
            if (this.loadingState) return;
            this.handleKeydown(e);
        });

        this.controls.addEventListener('mouseenter', () => this.showCursor());
        this.controls.addEventListener('mouseleave', () => this.hideCursorDelay());
        this.videoElement.addEventListener('mousemove', () => {
            this.showCursor();
            this.hideCursorDelay();
        });

        // Set initial state
        this.hideCursorDelay();
    }

    public setLoadingState(loading: boolean) {
        this.loadingState = loading;

        this.loadingIcon.style.display = loading ? '' : "none";
        this.playButton.style.display = loading ? "none" : '';

        this.progressBarRange.disabled = loading;

        this.videoSelect.disabled = loading;
        this.audioSelect.disabled = loading;
        this.subtitleSelect.disabled = loading;
    }

    public setDuration(duration: number) {
        let timeObj = { time: "--:--", hours: false };
        if (duration >= 0) {
            timeObj = formatSeconds(duration, false);
            this.progressBarRange.style.display = '';
        }
        this.numberDuration.textContent = `/${timeObj.time}`;
        this.hasHours = timeObj.hours;
        this.progressBarRange.max = duration.toString();
        this.controls.style.setProperty("--video-duration", duration.toString());
    }

    public setBufferProgress(percent: number) {
        this.transmutatedBar.style.setProperty(`--buffer-progress`, `${percent}%`);
    }

    public setPlayback(isPlaying: boolean) {
        this.playButton.innerHTML = isPlaying ? 'pause' : 'play_arrow';
    }

    public setVolume(volume: number) {
        if (volume > 0) this.lastVolume = volume;
        this.updateVolumeVisuals(volume);
    }

    public updateVideoTracks(videos: ControlStream[]) {
        this.videoSelect.innerHTML = '';
        this.videoStreams = videos;
        for (const video of videos) {
            const option = <option
                value={ video.index.toString() }>
                { optionText(video) }
            </option> as HTMLOptionElement;
            option.selected = video.isUsed;
            this.videoSelect.appendChild(option);
        }

        const visible = videos.length > 0 ? 'unset' : 'none';
        this.videoSelect.style.display = visible;
        this.videoLabel.style.display = visible;

        this.setTrackSelectorVisibility();
    }

    public updateAudioTracks(audios: ControlStream[]) {
        this.audioSelect.innerHTML = '';
        this.audioStreams = audios;
        for (const audio of audios) {
            const option = <option
                value={ audio.index.toString() }>
                { optionText(audio) }
            </option> as HTMLOptionElement;
            option.selected = audio.isUsed;
            this.audioSelect.appendChild(option);
        }

        const visible = audios.length > 0 ? 'unset' : 'none';
        this.audioSelect.style.display = visible;
        this.audiolLabel.style.display = visible;

        this.setTrackSelectorVisibility();
    }

    public updateSubtitleTracks(subtitles: ControlStream[]) {
        this.subtitleSelect.innerHTML = '';
        this.subtitleStreams = subtitles;
        for (const subtitle of subtitles) {
            const option = <option
                value={ subtitle.index.toString() }>
                { optionText(subtitle) }
            </option> as HTMLOptionElement;
            option.selected = subtitle.isUsed;
            this.subtitleSelect.appendChild(option);
        }

        const visible = subtitles.length > 0 ? 'unset' : 'none';
        this.subtitleSelect.style.display = visible;
        this.subtitleLabel.style.display = visible;

        this.setTrackSelectorVisibility();
    }

    public updateChapters(chapters: ControlChapter[]) {
        this.chapterDataList.innerHTML = '';
        this.chapters = chapters;
        for (const chapter of chapters) {
            const time = chapter.start;
            this.chapterDataList?.appendChild(
                <div title={ chapter.title ?? chapter.id.toString() }
                    onclick={ () => this.callbacks.onSeekTo(time) }
                    class={ styles.chapter }
                    style={ { left: `calc(${time} / var(--video-duration) * 100% - 1px)` } }
                />);
        }
    }

    public updateCurrentTime(time: number) {
        const mediaDuration = this.callbacks.getMediaDuration();
        let progressTime = (time / mediaDuration) * 100;
        if (!Number.isFinite(progressTime)) {
            progressTime = 0;
        }

        if (this.lastProgress !== progressTime) {
            this.progressBarRange.value = progressTime === 0 ? '--:--' : time.toString();
            this.lastProgress = progressTime;

            const progress = progressTime.toPrecision(4);
            this.bufferBar.style.setProperty('--video-progress', `${progress}%`);
        }

        if (this.lastTime !== time) {
            this.numberProgress.textContent = formatSeconds(time, this.hasHours).time;
            this.lastTime = time;
        }
    }

    private setTrackSelectorVisibility() {
        if (this.videoStreams.length <= 0 &&
            this.audioStreams.length <= 0 &&
            this.subtitleStreams.length <= 0) {

            this.captionIcon.style.display = "none";
        } else {
            this.captionIcon.style.display = "";
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
                this.callbacks.onStepFrame();
                break;
        }
    }

    private toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            const setupVideo = () => {
                this.controlsContainer.classList.add(styles.fullscreen);
                this.videoElement.parentElement?.classList.add(styles.fullscreenVideo);
            };
            const exitFullscreenSetup = () => {
                this.controlsContainer.classList.remove(styles.fullscreen);
                this.videoElement.parentElement?.classList.remove(styles.fullscreenVideo);
            };

            const parent = this.controlsContainer.parentElement!;

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
            } else if (this.videoElement.webkitEnterFullscreen && this.videoElement.webkitSupportsFullscreen) {
                this.videoElement.webkitEnterFullscreen();
                setupVideo();
                this.videoElement.addEventListener('fullscreenchange', exitFullscreenSetup, { once: true });
            }
        }
    }

    private toggleTrackSelector() {
        if (this.trackSelector.dataset.isHidden === '1') {
            this.trackSelector.style.height = `${this.trackSelector.scrollHeight}px`;
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
        this.controls.classList.remove(styles.inactive);
        if (this.cursorTimeoutId) clearTimeout(this.cursorTimeoutId);
    }

    private hideCursorDelay() {
        if (this.cursorTimeoutId) clearTimeout(this.cursorTimeoutId);
        this.cursorTimeoutId = window.setTimeout(() => {
            this.videoElement.style.cursor = 'none';
            this.controls.classList.add(styles.inactive);
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

function optionText(stream: ControlStream) {
    return stream.metadata["title"] ?? stream.metadata["TITLE"] ?? stream.metadata["language"] ?? stream.metadata["LANGUAGE"] ?? `Untitled: ${stream.index}`;
}
