import { h } from "../../../JSXRuntime/jsx-runtime.js";

export function CreateControls() {
    let chapterDataList: HTMLDataListElement;
    let progressBarRange: HTMLInputElement;
    let progressBarHold: HTMLDivElement;
    let progressHoverRange: HTMLDivElement;
    let videoSelect: HTMLSelectElement;
    let videoLabel: HTMLLabelElement;
    let audioSelect: HTMLSelectElement;
    let subtitleSelect: HTMLSelectElement;
    let controls: HTMLDivElement;
    let playButton: HTMLButtonElement;
    let playIcon: HTMLElement;
    let bufferBar: HTMLSpanElement;
    let numberProgress: HTMLSpanElement;
    let numberDuration: HTMLSpanElement;
    let bufferVolumeBar: HTMLSpanElement;
    let volumeIcon: HTMLElement;
    let volumeControl: HTMLInputElement;
    let fullscreenBtn: HTMLButtonElement;
    let captionIcon: HTMLElement;
    let trackSelector: HTMLDivElement;
    let transmutatedBar: HTMLSpanElement;

    return (
        <div className="controls" ref={ r => controls = r }>
        {/* Play button */ }
        <button className="video-conrol-btn" ref={ r => playButton = r }>
            <i className="material-symbols-rounded" ref={ r => playIcon = r }>
                play_arrow
            </i>
        </button>

        {/* Progress bar */ }
        <div className="progress-bar" ref={ r => progressBarHold = r }>
            <span className="buffer-range" ref={ r => transmutatedBar = r } />
            <datalist id="chaptersForVideo" style={ { display: "block" } } ref={ r => chapterDataList = r } />
            <input
                type="range"
                className="progress-range"
                defaultValue="0"
                step="any"
                min="0"
                max="100"
                list={ chapterDataList! }
                ref={ r => progressBarRange = r }
            />
            <div
                className="progress-hover-tooltip"
                ref={ r => progressHoverRange = r }
                style={ { bottom: "calc(8px / 2 + 3vh / 2 + 10px)" } }
            />
            <span className="buffer-range active-range" ref={ r => bufferBar = r } />
        </div>

        {/* Time indicators */ }
        <span className="progressNumber highlighted" ref={ r => numberProgress = r }>
            0:00
        </span>
        <span className="progressNumber" ref={ r => numberDuration = r }>
            /0:00
        </span>

        {/* Volume */ }
        <div className="video-conrol-btn">
            <i className="material-symbols-rounded" ref={ r => volumeIcon = r }>
                volume_up
            </i>
            <span className="volume-control volume-control-range-container">
                <span className="buffer-range" style={ { background: "rgb(36,36,36)" } } />
                <span className="buffer-range active-range" ref={ r => bufferVolumeBar = r } />
                <input
                    type="range"
                    className="volume-control"
                    defaultValue="100"
                    max="100"
                    step="1"
                    ref={ r => volumeControl = r }
                />
            </span>
        </div>

        {/* Captions */ }
        <div className="video-conrol-btn">
            <i className="material-symbols-rounded" ref={ r => captionIcon = r }>
                subtitles
            </i>
            <div className="track-selector" data-is-hidden="1" ref={ r => trackSelector = r }>
                <label htmlFor="VideoLabelForTrackSelector" ref={ r => videoLabel = r }>
                    Video
                </label>
                <select id="VideoLabelForTrackSelector" ref={ r => videoSelect = r } />

                <label htmlFor="AudioLabelForTrackSelector">Audio</label>
                <select id="AudioLabelForTrackSelector" ref={ r => audioSelect = r } />

                <label htmlFor="SubtitleLabelForTrackSelector">Subtitles</label>
                <select id="SubtitleLabelForTrackSelector" ref={ r => subtitleSelect = r } />
            </div>
        </div>

        {/* Fullscreen */ }
        <button className="video-conrol-btn" ref={ r => fullscreenBtn = r }>
            <i className="material-symbols-rounded">fullscreen</i>
        </button>
    </div>
    );
}

export function makeDraggable(element: HTMLElement, container?: HTMLElement) { // Added containerRect
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
