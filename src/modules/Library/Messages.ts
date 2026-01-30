export function DisplayNeedsInput() {
    DeleteNeedsInput();
    const label = document.createElement('label');
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.webkitdirectory = true;
    fileInput.multiple = true;
    fileInput.style.display = "none";
    label.textContent = "Click here to load your Library!";
    label.classList.add("text-message");
    label.id = "message-needs-interraction";
    label.style.pointerEvents = "none";
    fileInput.style.pointerEvents = "none";
    //label.appendChild(fileInput);
    return {label, fileInput};
}

export function DisplayNoMedia() {
    DeleteNoMedia();
    const noImg = document.createElement("span");
    noImg.innerHTML = "No Media found here :/";
    noImg.classList.add("text-message");
    noImg.id = "message-no-media";
    return noImg;
}

export function DeleteNeedsInput() {
    document.getElementById("message-needs-interraction")?.remove();
}

export function DeleteNoMedia() {
    document.getElementById("text-message")?.remove();
}