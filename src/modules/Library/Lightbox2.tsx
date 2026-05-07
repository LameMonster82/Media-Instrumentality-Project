import styles from "@/css/Lightbox.module.css";
import videoStyles from "@/css/VideoControls.module.css";
import { Asset } from "./Asset";
import { ExtractExif } from "./Exif/ExtractExifData";
import { LoadingIndicatorURL } from "../LoadingLoop";
import { AssetType, FormatBytes, type ExifTree } from "../SomeTypes";
import { VideoPlayer } from "@/modules/Video/VideoPlayer";

export class Lightbox2 {
    private dialog: HTMLDialogElement | undefined;
    private sideMenu: HTMLElement | undefined;
    private currentlyOpenImages: { srcImage: HTMLImageElement; image: HTMLElement; zoom: ZoomStuff; }[] = [];
    private videoPlayer: VideoPlayer | undefined;

    openDialog(srcImage: HTMLImageElement) {
        if (!this.dialog) return;

        const imageStyle = window.getComputedStyle(srcImage);
        const thing = srcImage.getBoundingClientRect();
        const filePath = srcImage.getAttribute("data-src");
        const asset = filePath ? (Asset.loadedAssets[filePath] ?? undefined) : undefined;

        document.body.style.overflow = "hidden";

        const image =
            <img
                style={ {
                    borderRadius: imageStyle.getPropertyValue("border-radius")
                } }
                class={ styles.LightboxPreview }
                src={ asset?.GetUrl() ?? srcImage.src }>
            </img> as HTMLImageElement;

        setRect(image, thing);
        const openImage = () => {

            this.dialog!.appendChild(image);
            this.dialog!.showModal();

            srcImage.style.opacity = "0";

            requestAnimationFrame(() => {
                image.style.left = "";
                image.style.top = "";
                image.style.width = "";
                image.style.height = "";
            });

            if (asset) {
                if (asset.GetType() !== AssetType.IMAGE) {
                    this.playMedia(asset, image);
                }
                this.appendExifData(asset);

            }

            //ExtractExif(asset.GetUrl()).then(e => console.log(e));
        };

        //this.image.classList.add(styles.open);
        this.currentlyOpenImages.push({ srcImage, image, zoom: new ZoomStuff(this.dialog, image) });
        image.decode().then(s => {
            openImage();
        }, e => {
            console.warn(`Could not decode image ${asset?.handle.path ?? srcImage.title}: ${e}`);
            image.src = srcImage.src;
            openImage();
        });
    }

    appendExifData(asset: Asset) {
        if (!this.sideMenu) return;

        const time = new Date(asset.handle.lastModified);

        this.sideMenu.replaceChildren();

        this.sideMenu.appendChild(
            <div class={ styles.titleBar }>
                <span onclick={ e => this.toggleMenu() } class={ styles.side_button } style={ { marginLeft: "1rem" } }>arrow_back</span>
                <h1>{ asset.handle.name }</h1>
                <span onclick={ e => this.closeDialog() } class={ styles.side_button }>close</span>
            </div>
        );
        this.sideMenu.appendChild(<h2 title={ asset.handle.size + " Bytes" }>{ FormatBytes(asset.handle.size) }</h2>);
        this.sideMenu.appendChild(<h2>{ asset.handle.path }</h2>);

        const loading = <img style={ { width: "50%", marginTop: "5rem" } } src={ LoadingIndicatorURL }></img>;
        this.sideMenu.appendChild(loading);

        ExtractExif(asset).then(e => {
            loading.remove();

            const tags = renderExifDetails(e.tree);

            const exif =
                <details class={ styles.AssetDetails }>
                    <summary>EXIF</summary>
                    { ...tags }
                </details>;
            this.sideMenu?.appendChild(exif);
        });
    }

    async playMedia(asset: Asset, lightboxImage: HTMLImageElement) {
        const videoPlayer = new VideoPlayer();
        this.videoPlayer = videoPlayer;
        const videoElement = videoPlayer.videoElement;

        let thumbnail = asset.thumbnailUrl && asset.thumbnailUrl.length > 0 ? asset.thumbnailUrl : lightboxImage.src;

        //const videoPlayer = new WebGLPlayer(canvasElement);
        videoElement.classList.add("focused", "zoomin", "zoominVideo", styles.LightboxPreview);
        videoElement.style.position = "fixed";
        videoElement.style.top = "";
        videoElement.style.left = "";
        videoElement.style.width = "";
        videoElement.style.height = "";

        const controls = videoPlayer.mediaControl;
        controls.classList.add(styles.LightboxPreview, videoStyles.PositionInLightbox);

        const videoBox =
            <div class={ `viewAsset ${styles.LightboxPreview}` } id="smallVideoBox">
                { videoElement }
                { controls }
            </div>;

        this.dialog!.appendChild(videoBox);

        //this.currentFullscreeenImage?.onClosing.push(async () => {
        //    videoPlayer.Destroy();
        //    videoElement.remove();
        //    controls.remove();
        //});




        await videoPlayer.GetFileReady(asset.GetUrl(), asset.handle.name, asset.thumbnailUrl ?? undefined, (element) => {
            element.classList.add("viewAsset", "focused", "zoomin", "zoominVideo");
            element.style.width = videoElement.videoWidth + "px";
            element.style.height = videoElement.videoWidth + "px";
            this.dialog!.insertBefore(element, controls);
            lightboxImage.style.display = "none";
        }, 327680);
    }

    closeDialog() {
        this.onClose();
        this.dialog?.close();
    }

    private onClose() {
        if (!this.sideMenu?.hidden) {
            this.toggleMenu();
        }

        this.videoPlayer?.Destroy();
        this.videoPlayer = undefined;
        document.getElementById("smallVideoBox")?.remove();

        document.body.style.overflow = "";
        //this.image?.classList.remove(styles.open);
        const varStyle = window.getComputedStyle(this.dialog!);
        const endTime = performance.now() + parseFloat(varStyle.getPropertyValue('--lightbox-transition-time')) * 1000;
        for (const { srcImage, image, zoom } of this.currentlyOpenImages) {
            const loop = (time: DOMHighResTimeStamp) => {
                const stuff = srcImage.getBoundingClientRect();
                setRect(image, stuff);

                if (time < endTime) {
                    requestAnimationFrame(loop);
                } else {
                    srcImage.style.opacity = "";
                    image.remove();
                }
            };

            zoom.Destroy();

            const rect = image.getBoundingClientRect();
            setRect(image, rect);
            //document.body.appendChild(image);
            requestAnimationFrame((time) => loop(time));
        };

        this.currentlyOpenImages.length = 0;
    }

    toggleMenu() {
        if (!this.sideMenu) return;
        const isHidden = this.sideMenu.hidden;

        if (isHidden) {
            for (const image of this.currentlyOpenImages) {
                image.image.classList.add(styles.SidebarOpenImage);
            }
            this.sideMenu.hidden = false;
        } else {
            for (const image of this.currentlyOpenImages) {
                image.image.classList.remove(styles.SidebarOpenImage);
            }
            this.sideMenu.hidden = true;
        }
    }

    toHTML() {
        return (
            <dialog
                class={ styles.Lightbox }
                onclose={ () => this.closeDialog() }
                ref={ e => this.dialog = e }>

                <span onclick={ e => this.toggleMenu() } class={ styles.side_button }>menu</span>
                <span onclick={ e => this.closeDialog() } class={ styles.side_button }>close</span>
                <aside
                    class={ styles.Sidebar }
                    hidden
                    ref={ e => this.sideMenu = e }>

                </aside>
            </dialog>
        );
    }
}

class ZoomStuff {
    private readonly zoomFactor = 1.2;
    private readonly minScale = 1;
    private readonly maxScale = 6;

    private scale = 1;
    private translateX = 0;
    private translateY = 0;

    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;

    private dialog: HTMLElement;
    private image: HTMLElement;

    constructor(dialog: HTMLElement, image: HTMLElement) {
        this.dialog = dialog;
        this.image = image;
        image.style.transformOrigin = "0 0";
        image.style.willChange = "transform";
        dialog.style.cursor = "grab";
        image.addEventListener("wheel", this.onWheel.bind(this), { passive: false });
        dialog.addEventListener("mousedown", this.onMouseDown.bind(this));
        dialog.addEventListener("mousemove", this.onMouseMove.bind(this));
        dialog.addEventListener("mouseup", this.onMouseUp.bind(this));

        this.updateTransform();
    }

    public Destroy() {
        this.image.style.transformOrigin = ``;
        this.image.style.willChange = "";
        this.image.style.transform = ``;
        this.dialog.style.cursor = "";
        this.image.style.transition = "";
        this.image.removeEventListener("wheel", this.onWheel.bind(this));
        this.dialog.removeEventListener("mousedown", this.onMouseDown.bind(this));
        this.dialog.removeEventListener("mousemove", this.onMouseMove.bind(this));
        this.dialog.removeEventListener("mouseup", this.onMouseUp.bind(this));
    }


    private onWheel(e: WheelEvent) {
        e.preventDefault(); // prevent page scroll while zooming

        const rect = this.image.getBoundingClientRect();
        const dx = e.clientX - rect.left; // pointer offset within element (current)
        const dy = e.clientY - rect.top;

        const prev = this.scale;
        if (e.deltaY < 0) {
            this.scale = Math.min(this.scale * this.zoomFactor, this.maxScale);
        } else {
            this.scale = Math.max(this.scale / this.zoomFactor, this.minScale);
        }

        const ratio = this.scale / prev; // s1 / s0

        // adjust translate so the point under cursor stays fixed
        this.translateX += (1 - ratio) * dx;
        this.translateY += (1 - ratio) * dy;

        this.updateTransform();
    }

    private updateTransform() {
        this.image.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
    }

    private onMouseDown(e: MouseEvent) {
        if (e.buttons !== 1 || e.target !== this.image) return; // no pan if not zoomed
        this.image.style.pointerEvents = "none";
        this.image.style.transition = "unset";
        this.dialog.style.cursor = "grabbing";
        this.isDragging = true;
        this.dragStartX = e.clientX - this.translateX;
        this.dragStartY = e.clientY - this.translateY;
        e.preventDefault();
    }

    private onMouseMove(e: MouseEvent) {
        if (!this.isDragging) return;
        if (e.buttons !== 1 || (e.target !== this.image && e.target !== this.dialog)) {
            return this.onMouseUp(e);
        }
        this.translateX = e.clientX - this.dragStartX;
        this.translateY = e.clientY - this.dragStartY;
        this.updateTransform();
    }

    private onMouseUp(e: MouseEvent) {
        this.isDragging = false;
        this.dialog.style.cursor = "grab";
        this.image.style.pointerEvents = "";
        this.image.style.transition = "";
    }
}

function setRect(target: HTMLElement, rect: DOMRect) {
    target.style.left = rect.x + "px";
    target.style.top = rect.y + "px";
    target.style.width = rect.width + "px";
    target.style.height = rect.height + "px";
}

function getMimeType(base64: any) {
    if (typeof base64 !== "string") return undefined;
    if (base64.startsWith('base64:/9j/')) return 'image/jpeg';
    if (base64.startsWith('base64:iVBORw0KGgo')) return 'image/png';
    if (base64.startsWith('base64:R0lGOD')) return 'image/gif';
    if (base64.startsWith('base64:UklGR')) return 'image/webp';
    return undefined; // fallback
}

function renderExifDetails(tree: ExifTree): HTMLElement[] {
    let detailList = [];

    for (const [key, group] of Object.entries(tree)) {
        const rowContainer = <div class={ styles.detailClass }></div>;
        const details =
            <details>
                <summary>{ group.name }</summary>
                { rowContainer }
            </details>;

        for (const tag of group.tags) {
            const isImage = getMimeType(tag.value);

            let theThing: HTMLElement | string;
            if (isImage) {
                const fixed = (tag.value as string).replace("base64:", 'base64,');
                theThing = <img src={`data:${isImage};${fixed}`}></img>
            } else {
                theThing = tag.value.toString();
            }

            const row =
                <div>
                    <span>{ tag.name }</span>
                    <span>{ theThing }</span>
                </div>;
            rowContainer.appendChild(row);
        }

        detailList.push(details);
    }

    return detailList;
}
