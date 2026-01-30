import { LoadingIndicator, LoadingIndicatorPNG } from "../LoadingLoop.js";
import { Asset } from "./Asset.js";
import { Lightbox } from "./Lightbox.js";
import { AssetType, generateUUID, ReplaceWithIcon } from "./SomeTypes.js";

interface Dictionary<T> {
    [key: string]: T;
}

export class LibraryBuilder {
    public gallery: HTMLDivElement;
    private lightbox: Lightbox;
    private ChunksAndAssets: Dictionary<{ chunk: HTMLSpanElement; assets: Asset[]; date: string; }> = {};

    private galleryWidth = 0;

    constructor(container: HTMLElement) {
        this.gallery = document.createElement("div");
        this.gallery.classList.add("gallery");

        container.appendChild(this.gallery);

        this.lightbox = new Lightbox(container);

        //this.resizeObserver.observe(this.gallery);
    }

    private ResetGallery() {
        this.gallery!.innerHTML = '';
        this.ChunksAndAssets = {};
    }

    public SortByDate(content: Asset[]) {
        content.sort((a, b) => b.GetModifiedDate() - a.GetModifiedDate());
        let groupedData: Dictionary<Asset[]> = {};

        // Group by year, month, and day
        content.forEach((file) => {
            let date = new Date(file.GetModifiedDate());
            let key = date.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "2-digit",
            });

            if (!groupedData[key]) {
                groupedData[key] = [];
            }
            groupedData[key].push(file);
        });

        return groupedData;
    }

    public DisplayByDate(images: Dictionary<Asset[]>) {
        this.ResetGallery();

        const allDates = Object.keys(images);

        if (allDates.length === 0) {
            return 0;
        }

        for (const key of allDates) {
            const imagesDate = images[key];
            if (!imagesDate) continue;

            const dateContainer = document.createElement("div");
            const spanText = document.createElement("span");
            spanText.innerHTML = key;
            dateContainer.appendChild(spanText);
            dateContainer.classList.add("date_separator");
            this.gallery.appendChild(dateContainer);

            this.CreateAChunk(imagesDate, key);
        }

        return allDates.length;
    }

    public DisplayNormal(images: Asset[]) {
        this.ResetGallery();
        if (images.length === 0) {
            return 0;
        }

        this.CreateAChunk(images, "0");

        return images.length;
    }

    private spawnImages(chunk: Asset[]): HTMLDivElement[] {
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                const img = entry.target;
                if (entry.isIntersecting) {
                    const event = new Event("loadThumnail");
                    img.dispatchEvent(event);
                } else {
                    const event = new Event("unloadThumnail");
                    img.dispatchEvent(event);
                }
            });
        }, {
            root: null,
            threshold: 0
        });
        const galleryItems: HTMLDivElement[] = [];

        for (const photo of chunk) {
            const galleryItem = document.createElement("div");
            galleryItem.classList.add("gallery-item");
            galleryItem.style.width = Asset.imageSize + "px";
            galleryItem.style.height = Asset.imageSize + "px";
            galleryItem.title = photo.path;
            //photo.dataLoadPromise.then(fufiled => galleryItem.style.backgroundColor = photo.assetData.bg_color);
            galleryItems.push(galleryItem);

            // Create an image with a data-src for lazy loading
            const img = new Image(Asset.imageSize, Asset.imageSize);
            let viewElement: HTMLElement = img;

            img.dataset.src = photo.path; // Use data-src to store the actual image URL
            //img.alt = photo.metadata.path;
            img.fetchPriority = "low";
            img.decoding = "async";
            img.loading = "lazy";

            galleryItem.appendChild(img);


            const newImage = LoadingIndicatorPNG();

            galleryItem.appendChild(newImage);
            //galleryItem.insertBefore(loadingSvg, img);

            const errorState = () => {
                if (img.classList.contains('loaded')) return;
                img.classList.add("loaded");
                newImage.remove();
                img.style.display = "none";

                viewElement = ReplaceWithIcon(galleryItem, photo.GetType());
            };

            img.style.visibility = "hidden";


            img.onload = () => {
                img.classList.add("loaded");
                newImage.remove();
                img.style.visibility = "";

                const type = photo.GetType();
                if (type === AssetType.AUDIO || type === AssetType.VIDEO) {
                    const iconHolder = document.createElement('div');
                    iconHolder.classList.add("fileTypeIndicator");
                    ReplaceWithIcon(iconHolder, type);
                    galleryItem.appendChild(iconHolder);
                }
            };

            img.addEventListener("loadThumnail", async () => {
                //debugger
                if (!img.classList.contains('loaded')) {
                    const url = await photo.GetThumbnailUrl();
                    if (!url) {
                        errorState();
                    } else {
                        img.src = url;
                    }
                }

            });

            img.addEventListener("unloadThumnail", () => {
                //debugger
                //photo.UnloadUrl();
                //img.src = "";
            });

            img.onerror = errorState;

            galleryItem.addEventListener("click", async () => {
                this.lightbox.openOnClick(viewElement, photo, galleryItem);
            });
            //img.src = photo.GetUrl();

            observer.observe(img);
        }

        return galleryItems;
    }

    private CreateAChunk(imagesData: Asset[], date: string) {
        const chunkHolder = document.createElement("span");
        chunkHolder.classList.add("gallery-chunk");
        this.gallery!.appendChild(chunkHolder);

        // --- Resizing Logic ---
        async function resizeBox(box: HTMLDivElement) {
            const index = mediaElemenents.indexOf(box);
            if (index === -1) {
                console.error("uhrhurh");
                return;
            }

            //const newHeight = defaultSize * heightMultiplier;
            const asset = imagesData[index];
            const width = await asset.ThumbnailWidth();
            // Apply new dimensions
            box.style.width = `${width}px`;
            const imageElement = box.querySelector('img');
            if (imageElement) {
                imageElement.style.width = `${width}px`;
                imageElement.decoding = "sync";
            }

            box.classList.add('resized'); // Add class for visual feedback (e.g., color change)
            box.dataset.resized = 'true'; // Mark as resized
        }

        // --- Intersection Observer ---
        let observer: IntersectionObserver;
        function setupIntersectionObserver() {
            const options = {
                root: null, // Use the viewport as the root
                rootMargin: '0px',
                threshold: 0.1 // Trigger when 10% of the element is visible
            };

            observer = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    const target = entry.target as HTMLDivElement;
                    if (entry.isIntersecting && !target.dataset.resized) {
                        // Resize the box when it becomes visible and hasn't been resized yet
                        resizeBox(target);
                        // Optional: Unobserve after resizing to prevent re-triggering if needed
                        // observer.unobserve(entry.target);
                    }
                });
            }, options);

            // Observe all boxes
            mediaElemenents.forEach(box => observer.observe(box));
        }


        // --- Initial Load Animation & Scroll Adjustment ---
        function handleInitialLoad() {
            // 1. Identify boxes initially in the viewport
            const viewportHeight = window.innerHeight;
            const initiallyVisibleBoxes: HTMLDivElement[] = [];
            let anchorBox: HTMLDivElement | null = null; // Box closest to the vertical center
            let minDistanceToCenter = Infinity;

            mediaElemenents.forEach(box => {
                const rect = box.getBoundingClientRect();
                // Check if the box is at least partially within the initial viewport
                if (rect.top < viewportHeight && rect.bottom > 0) {
                    initiallyVisibleBoxes.push(box);

                    // Find the box closest to the viewport center
                    const boxCenterY = rect.top + rect.height / 2;
                    const viewportCenterY = viewportHeight / 2;
                    const distance = Math.abs(boxCenterY - viewportCenterY);

                    if (distance < minDistanceToCenter) {
                        minDistanceToCenter = distance;
                        anchorBox = box;
                    }
                }
            });

            if (!anchorBox && initiallyVisibleBoxes.length > 0) {
                // Fallback if center calculation fails, just pick the first visible
                anchorBox = initiallyVisibleBoxes[0];
            }

            if (!anchorBox) {
                console.warn("No boxes initially visible or anchor could not be determined.");
                // If no boxes are visible initially, just set up the observer
                setupIntersectionObserver();
                return;
            }

            // 2. Record the anchor box's initial position
            const initialAnchorRect = anchorBox.getBoundingClientRect();
            const initialAnchorTop = initialAnchorRect.top;

            // 3. Resize the initially visible boxes (specifically targeting middle ones conceptually)
            // We resize all initially visible ones for simplicity here,
            // but prioritize observing them first.
            initiallyVisibleBoxes.forEach(box => {
                // Resize immediately only if it's considered "middle" (close to anchor)
                // Or simply resize all initially visible ones for a more dynamic start
                // Let's resize all initially visible ones for this example:
                if (!box.dataset.resized) {
                    resizeBox(box);
                }
            });

            // 4. Adjust scroll after resizing (wait for layout reflow)
            requestAnimationFrame(() => {
                // 5. Get the anchor box's new position
                const newAnchorRect = anchorBox!.getBoundingClientRect();
                const newAnchorTop = newAnchorRect.top;

                // 6. Calculate the vertical displacement
                const deltaY = newAnchorTop - initialAnchorTop;

                // 7. Adjust scroll position to compensate
                if (Math.abs(deltaY) > 1) { // Only adjust if there's a noticeable shift
                    window.scrollBy(0, deltaY);
                    console.log(`Scroll adjusted by ${deltaY.toFixed(2)}px to keep anchor stable.`);
                }

                // 8. Now set up the observer for boxes scrolled into view later
                setupIntersectionObserver();
            });
        }

        const mediaElemenents = this.spawnImages(imagesData);
        for (const el of mediaElemenents)
            chunkHolder.appendChild(el);

        handleInitialLoad();

        chunkHolder.dataset.chunkId = generateUUID();
        this.ChunksAndAssets[chunkHolder.dataset.chunkId] = {
            chunk: chunkHolder,
            assets: imagesData,
            date,
        };

        this.chunkObserver.observe(chunkHolder);
    }

    private chunkObserver = new IntersectionObserver(
        async (entries) => {
            for (const entry of entries) {
                const chunkHolder = entry.target as HTMLSpanElement;
                //const chunk = this.ChunksAndAssets[chunkHolder.dataset.chunkId!]!;
                if (!entry.isIntersecting) {
                    if (chunkHolder.classList.contains("active")) {
                        //chunkHolder.innerHTML = "";
                        chunkHolder.classList.remove("active");
                    }
                    continue;
                }
                chunkHolder.classList.add("active");
            }
        }, {
        root: null,
        threshold: 0,
    },
    );

    // private resizeObserver = new ResizeObserver((entries) => {
    //     requestAnimationFrame(() => {
    //         const entry = entries[0]!;
    //         console.log("Resized:", entry.contentRect.width, entry.contentRect.height);
    //         if (entry.contentRect.width === this.galleryWidth) return;

    //         const chunkKeys = Object.keys(this.ChunksAndAssets);
    //         for (let i = 0; i < chunkKeys.length; i++) {
    //             const chunk = this.ChunksAndAssets[chunkKeys[i]!]!;

    //             const maxWidth = entry.contentRect.width;
    //             let currWidth: number = 0;
    //             let currHeight: number = Asset.imageSize;
    //             //let foundMaxWidth = 0;

    //             let currImageCount = 0;
    //             const unusedChunkAssets: Asset[] = [];
    //             while (true) {
    //                 if (currImageCount >= chunk.assets.length) {
    //                     const neextKey = chunkKeys[i + 1];
    //                     if (neextKey && this.ChunksAndAssets[neextKey]!.date === chunk.date) {
    //                         const nextAsset = this.ChunksAndAssets[neextKey]!.assets.shift();
    //                         if (nextAsset) chunk.assets.push(nextAsset);
    //                         else break;
    //                     } else break;
    //                 }
    //                 const photo = chunk.assets[currImageCount];

    //                 const usedWidth = photo!.ThumbnailWidth();

    //                 if (currWidth + usedWidth + 10.001 >= maxWidth) {
    //                     // gap
    //                     //foundMaxWidth = Math.max(foundMaxWidth, currWidth);
    //                     if (currImageCount >= Asset.imagesPerChunk) {
    //                         for (let j = 0; j < chunk.assets.length - currImageCount; j++) {
    //                             unusedChunkAssets.push(chunk.assets.pop()!);
    //                         }
    //                         unusedChunkAssets.reverse();
    //                         break;
    //                     }
    //                     currHeight += Asset.imageSize + 10;
    //                     currWidth = 0;
    //                 }

    //                 currWidth += usedWidth + 10.001;
    //                 currImageCount += 1;
    //             }
    //             //chunk.chunk.style.width = maxWidth + "px";
    //             chunk.chunk.style.height = currHeight + "px";

    //             if (chunkKeys[i + 1]) {
    //                 this.ChunksAndAssets[chunkKeys[i + 1]!]!.assets.push(...unusedChunkAssets);
    //             } else {
    //                 this.CreateAChunk(unusedChunkAssets, chunk.chunk, maxWidth, chunk.date);
    //             }
    //         }
    //         this.galleryWidth = entry.contentRect.width;
    //     });
    // });
}
function DisplayNoImages() {
    throw new Error("Function not implemented.");
}

function DeleteNoImagee() {
    throw new Error("Function not implemented.");
}

