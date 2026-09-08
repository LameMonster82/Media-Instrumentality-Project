import { VideoPlayer2 } from "./player/VideoPlayer";

const container = document.getElementById("containerAgain")!;
const dropZone = document.getElementById("dropZone")!;
const title = document.getElementById("media-title")!;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

function loadVideo(url: string | File) {
    const videoPlayer = new VideoPlayer2(url);
    container.appendChild(videoPlayer.getVideo());
    dropZone.remove();
}

function loadFile(file: File) {
    title.textContent = file.name;
    loadVideo(file);
}

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) loadFile(file);
});

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");

    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
});