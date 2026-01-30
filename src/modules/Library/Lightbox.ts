import { Asset } from "./Asset.js";
import { AssetType } from "./SomeTypes.js";
import { VideoPlayerFFmpeg } from "./Video/FFmpegVideo.js";

export class Lightbox {
    private currentFullscreeenImage: {
        asset: Asset;
        image: HTMLElement;
        lightboxImage: HTMLElement;
        parent: HTMLDivElement;
        onClosing: (() => Promise<void>)[];
    } | null = null;

    private lightbox: HTMLDivElement;
    private closeBtn: HTMLSpanElement;

    constructor(containeer: HTMLElement) {
        this.lightbox = document.createElement("div");
        this.lightbox.classList.add("lightbox");

        this.closeBtn = document.createElement("span");
        this.closeBtn.classList.add("close-btn");
        this.closeBtn.innerHTML = "&times;";

        this.lightbox.appendChild(this.closeBtn);

        containeer.appendChild(this.lightbox);

        this.closeBtn.addEventListener("click", () => this.closeLightbox());
    }

    public openOnClick(img: HTMLElement, photo: Asset, parentDiv: HTMLDivElement) {
        if (this.currentFullscreeenImage) return;

        document.title = photo.path;

        const rect = img.getBoundingClientRect();

        // Save the current position of the image
        const currentTop = rect.top + 18 / 2;
        const currentLeft = rect.left + 18 / 2;
        const currentWidth = rect.width;
        const currentHeight = rect.height;

        const lightboxImage = img.cloneNode(true) as HTMLElement;
        lightboxImage.classList.add("viewAsset");
        img.style.display = "none";

        this.lightbox.appendChild(lightboxImage);
        this.currentFullscreeenImage = {
            asset: photo,
            image: img,
            lightboxImage: lightboxImage,
            parent: parentDiv,
            onClosing: []
        };

        // Apply absolute positioning to the image
        lightboxImage.style.display = "";
        lightboxImage.style.position = "fixed";
        lightboxImage.style.top = `${currentTop}px`;
        lightboxImage.style.left = `${currentLeft}px`;
        lightboxImage.style.width = `${currentWidth}px`;
        lightboxImage.style.height = `${currentHeight}px`;

        lightboxImage.classList.add("focused");
        this.lightbox.classList.add("active");

        setTimeout(() => {
            lightboxImage.style.top = "";
            lightboxImage.style.left = "";
            lightboxImage.style.width = "";
            lightboxImage.style.height = "";
            lightboxImage.classList.add("zoomin");

            this.lightbox.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
        }, 100);

        if (photo.GetType() === AssetType.VIDEO || photo.GetType() === AssetType.AUDIO) {
            const loadVideo = async () => {
                const videoPlayer = new VideoPlayerFFmpeg();
                const videoElement = videoPlayer.video;
                if (photo.thumbnailUrl && photo.thumbnailUrl.length > 0) {
                    videoElement.poster = photo.thumbnailUrl;
                    lightboxImage.style.display = "none";
                }
                    
                //const videoPlayer = new WebGLPlayer(canvasElement);

                videoElement.classList.add("viewAsset", "focused", "zoomin", "zoominVideo");
                videoElement.style.position = "fixed";
                videoElement.style.top = "";
                videoElement.style.left = "";
                videoElement.style.width = "";
                videoElement.style.height = "";

                this.lightbox.appendChild(videoElement);

                const controls = videoPlayer.CreatePlayerControls();
                this.lightbox.appendChild(controls);

                this.currentFullscreeenImage?.onClosing.push(async () => {
                    videoPlayer.Destroy();
                    videoElement.remove();
                    controls.remove();
                });


                await videoPlayer.GetFileReady(photo.GetUrl(), photo.handle.name, photo.thumbnailUrl ?? undefined, (element) => {
                    element.classList.add("viewAsset", "focused", "zoomin", "zoominVideo");
                    element.style.width = videoElement.videoWidth + "px";
                    element.style.height = videoElement.videoWidth + "px";
                    this.lightbox.insertBefore(element, controls);
                }, 327680);
                
            };

            lightboxImage.addEventListener("transitionend", loadVideo, { once: true });
        } else if (photo.GetType() === AssetType.IMAGE) {
            if (!(lightboxImage instanceof HTMLImageElement)) return;
            lightboxImage.decoding = "sync";

            lightboxImage.addEventListener("transitionend", () => {
                lightboxImage.src = photo.GetUrl();
            }, { once: true });

            this.currentFullscreeenImage.onClosing.push(async () => {
                const thumb = await photo.GetThumbnailUrl();
                if (thumb)
                    lightboxImage.src = thumb;
            })

        }
    }

    public async closeLightbox() {
        if (!this.currentFullscreeenImage) return;
        for (const close of this.currentFullscreeenImage?.onClosing) {
            await close();
        }

        const lightboxImage = this.currentFullscreeenImage.lightboxImage;
        const image = this.currentFullscreeenImage.image;

        this.lightbox.style.backgroundColor = "rgba(0, 0, 0, 0)";
        const goBackTotheHolder = async () => {
            console.log("Transition completed!");
            this.lightbox.classList.remove("active");
            lightboxImage.remove();

            image.style.display = "";

            this.currentFullscreeenImage = null;
        };

        const thingamajin = () => {
            const rect = this.currentFullscreeenImage!.parent.getBoundingClientRect();

            // Save the current position of the image
            const currentTop = rect.top;
            const currentLeft = rect.left;


            lightboxImage.style.top = `${currentTop}px`;
            lightboxImage.style.left = `${currentLeft}px`;

            if (!this.currentFullscreeenImage!.parent.parentElement) {
                lightboxImage.style.width = `0px`;
                lightboxImage.style.height = `0px`;
            }

            if (Math.abs(parseFloat(getComputedStyle(lightboxImage).top) - currentTop) < 1) {
                goBackTotheHolder();
                return;
            }
            requestAnimationFrame(thingamajin);
        };

        lightboxImage.style.display = "";

        const rect = this.currentFullscreeenImage!.parent.getBoundingClientRect();

        const currentWidth = rect.width;
        const currentHeight = rect.height;

        //img.style.display = "";

        lightboxImage.style.width = `${currentWidth}px`;
        lightboxImage.style.height = `${currentHeight}px`;
        lightboxImage.style.fontSize = getComputedStyle(image).fontSize;


        //fetch(`/api/Video/cancel_and_cleanup`);
        

        requestAnimationFrame(thingamajin);
    }
}