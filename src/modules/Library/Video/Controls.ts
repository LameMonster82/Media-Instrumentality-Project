export function CreateControls() {
    // Create controls container
    const controls = document.createElement('div');
    controls.classList.add('controls');

    // Play/Pause button (using Material Icon)
    const playButton = document.createElement('button');
    playButton.classList.add('video-conrol-btn');
    const playIcon = document.createElement('i');
    playIcon.classList.add('material-symbols-rounded');
    playIcon.textContent = 'play_arrow'; // Material Icon for Play
    playButton.appendChild(playIcon);
    controls.appendChild(playButton);

    // Progress Bar
    const progressBarHold = document.createElement('div');
    progressBarHold.classList.add('progress-bar');
    controls.appendChild(progressBarHold);

    const transmutatedBar = document.createElement('span');
    transmutatedBar.classList.add('buffer-range');
    //transmutatedBar.style.background = 'rgb(36,36,36)';
    progressBarHold.appendChild(transmutatedBar);

    const chapterDataList = document.createElement('datalist');
    chapterDataList.id = "chaptersForVideo";
    chapterDataList.style.display = "block";
    progressBarHold.appendChild(chapterDataList);

    const progressBarRange = document.createElement('input');
    progressBarRange.type = 'range';
    progressBarRange.classList.add('progress-range');
    progressBarRange.value = '0';
    progressBarRange.step = 'any';
    progressBarRange.min = '0';
    progressBarRange.max = '100';
    progressBarHold.appendChild(progressBarRange);
    progressBarRange.setAttribute("list", "chaptersForVideo");

    const progressHoverRange = document.createElement('div');
    progressHoverRange.classList.add('progress-hover-tooltip');
    progressBarHold.appendChild(progressHoverRange);
    progressHoverRange.style.bottom = `calc(8px / 2 + 3vh / 2 + 10px)`;

    const bufferBar = document.createElement('span');
    bufferBar.classList.add('buffer-range', 'active-range');
    progressBarHold.appendChild(bufferBar);

    // Progress numbers
    const numberProgress = document.createElement('span');
    numberProgress.classList.add('progressNumber', 'highlighted');
    numberProgress.textContent = '0:00';
    controls.appendChild(numberProgress);

    const numberDuration = document.createElement('span');
    numberDuration.classList.add('progressNumber');
    numberDuration.textContent = '/0:00';
    controls.appendChild(numberDuration);

    // Volume Button
    const volumeContainer = document.createElement('div');
    volumeContainer.classList.add('video-conrol-btn');
    const volumeIcon = document.createElement('i');
    volumeIcon.classList.add('material-symbols-rounded');
    volumeIcon.textContent = 'volume_up'; // Material Icon for Volume
    volumeContainer.appendChild(volumeIcon);
    controls.appendChild(volumeContainer);

    const volumeBarContainer = document.createElement('span');
    volumeBarContainer.classList.add('volume-control', 'volume-control-range-container');
    volumeContainer.appendChild(volumeBarContainer);

    const transmutatedVolumeBar = document.createElement('span');
    transmutatedVolumeBar.classList.add('buffer-range');
    transmutatedVolumeBar.style.background = 'rgb(36,36,36)';
    volumeBarContainer.appendChild(transmutatedVolumeBar);

    const bufferVolumeBar = document.createElement('span');
    bufferVolumeBar.classList.add('buffer-range', 'active-range');
    volumeBarContainer.appendChild(bufferVolumeBar);

    // Volume Control (Slider)
    const volumeControl = document.createElement('input');
    volumeControl.type = 'range';
    volumeControl.classList.add('volume-control');
    volumeControl.value = '100';
    volumeControl.max = '100';
    volumeControl.step = '1';
    volumeBarContainer.appendChild(volumeControl);

    // Captions Button
    const captionBtn = document.createElement('div');
    captionBtn.classList.add('video-conrol-btn');
    const captionIcon = document.createElement('i');
    captionIcon.classList.add('material-symbols-rounded');
    captionIcon.textContent = 'subtitles'; // Material Icon for Captions
    captionBtn.appendChild(captionIcon);
    controls.appendChild(captionBtn);

    const trackSelector = document.createElement('div');
    trackSelector.classList.add('track-selector');
    trackSelector.dataset.isHidden = '1';
    captionBtn.appendChild(trackSelector);

    const videoLabel = document.createElement('label');
    videoLabel.htmlFor = "VideoLabelForTrackSelector";
    videoLabel.textContent = "Video";
    trackSelector.appendChild(videoLabel);

    const videoSelect = document.createElement('select');
    videoSelect.id = 'VideoLabelForTrackSelector';
    trackSelector.appendChild(videoSelect);

    const audioLabel = document.createElement('label');
    audioLabel.htmlFor = "AudioLabelForTrackSelector";
    audioLabel.textContent = "Audio";
    trackSelector.appendChild(audioLabel);

    const audioSelect = document.createElement('select');
    audioSelect.id = 'AudioLabelForTrackSelector';
    trackSelector.appendChild(audioSelect);

    const subtitleLabel = document.createElement('label');
    subtitleLabel.htmlFor = "SubtitleLabelForTrackSelector";
    subtitleLabel.textContent = "Subtitles";
    trackSelector.appendChild(subtitleLabel);

    const subtitleSelect = document.createElement('select');
    subtitleSelect.id = 'SubtitleLabelForTrackSelector';
    trackSelector.appendChild(subtitleSelect);

    // Fullscreen Button
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.classList.add('video-conrol-btn');
    progressBarRange.classList.add('progress-range');
    progressBarRange.value = '0';
    const fullscreenIcon = document.createElement('i');
    fullscreenIcon.classList.add('material-symbols-rounded');
    fullscreenIcon.textContent = 'fullscreen'; // Material Icon for Fullscreen
    fullscreenBtn.appendChild(fullscreenIcon);
    controls.appendChild(fullscreenBtn);

    return {
        chapterDataList,
        progressBarRange,
        progressBarHold,
        progressHoverRange,
        videoSelect,
        videoLabel,
        audioSelect,
        subtitleSelect,
        controls,
        playButton,
        playIcon,
        bufferBar,
        numberProgress,
        numberDuration,
        bufferVolumeBar,
        volumeIcon,
        volumeControl,
        fullscreenBtn,
        captionIcon,
        trackSelector,
        transmutatedBar
    };
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
