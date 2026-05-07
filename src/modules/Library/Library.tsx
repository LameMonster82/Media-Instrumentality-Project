import styles from "@/css/Library.module.css";
import LoadingIndicator, { LoadingIndicatorBase64, LoadingIndicatorURL } from "../LoadingLoop";
import { Asset } from "./Asset";
import { AssetType, PromiseRes, type AssetFile, type Dictionary } from "../SomeTypes";


export class Library2 {
    private mainWindow: HTMLElement = (<main class={ styles.mainWindow }></main>);
    private intersector: IntersectionObserver | undefined;

    public onClick: (thumbnail: HTMLElement) => void = () => { };

    async LoadLibrary() {
        this.mainWindow.replaceChildren();
        this.mainWindow.classList.add(styles.flexWindow!);
        let loadIndicator = LoadingIndicator();
        this.mainWindow.appendChild(loadIndicator);
        //let assets = await this.GetAssetsFromServer();
        let assets: AssetFile[] = [];
        this.mainWindow.removeChild(loadIndicator);
        let errCode: string | undefined;
        while (typeof assets == 'string' || assets.length == 0) {
            // Choose between Web or Local
            const result = await this.ChooseBetweenServerOrLocal(errCode);
            if (typeof result == "boolean") {
                this.mainWindow.appendChild(loadIndicator);
                const resultFromServer = await this.GetAssetsFromServer();
                this.mainWindow.removeChild(loadIndicator);
                if (typeof resultFromServer == "string") {
                    errCode = resultFromServer;
                } else {
                    assets = resultFromServer;
                    break;
                }
            } else {
                assets = result;
                break;
            }
        }
        this.mainWindow.classList.remove(styles.flexWindow!);
        console.log(assets);
        Asset.LoadImagesToCache(assets);
        return assets;
    }

    DisplayByDate() {
        this.mainWindow.replaceChildren();
        const filtered = Asset.FilterAssets(img => true);
        const media = this.SortByDate(filtered);
        const allDates = Object.keys(media);

        for (const key of allDates) {
            const imagesDate = media[key];
            if (!imagesDate) continue;

            const chunk =
                <div>
                    <span class={ styles.MediaDateSeparator }>
                        { key }
                    </span>
                    <div class={ styles.MediaGroup }>
                        { imagesDate.map(a => this.CreateMedia(a)) }
                    </div>
                </div>;
            this.mainWindow.appendChild(chunk);
        }

        return allDates.length;
    }

    DisplaySearch(searchString: string) {
        this.mainWindow.replaceChildren();
        const filtered = Asset.FilterAssets(img => img.path.includes(searchString));
        filtered.sort((a, b) => b.GetModifiedDate() - a.GetModifiedDate());

        const chunk = (
            <div class={ styles.MediaGroup }>
                { filtered.map(a => this.CreateMedia(a)) }
            </div>
        );
        this.mainWindow.appendChild(chunk);

        return filtered.length;
    }



    toHTML() {
        return this.mainWindow;
    }

    private CreateMedia(asset: Asset) {
        this.intersector ??= new IntersectionObserver((entries, observer) => {
            for (const entry of entries) {
                const target = entry.target as HTMLElement;
                if (entry.isIntersecting) {
                    const file = Asset.loadedAssets[target.getAttribute("data-src")!];
                    if (file) {
                        const type = file.GetType();
                        switch (type) {
                            case AssetType.TEXT:
                                this.DisplayTextThumbnail(target as HTMLDivElement, file);
                                break;
                            default:
                                this.DisplayImageThumbnail(target as HTMLImageElement, file);
                                break;
                        }
                    }
                    observer.unobserve(target);
                }
            }
        });

        switch (asset.GetType()) {
            case AssetType.TEXT:
                return this.CreateTextMedia(asset);
            default:
                return this.CreateBitmapMedia(asset);
        }
    }

    private CreateTextMedia(asset: Asset) {
        let textObject: HTMLTextAreaElement;
        const media = (
            <div class={ styles.MediaContainer }>
                <textarea
                    placeholder="There would be text here if the file had any text"
                    readOnly={ true }
                    wrap="soft"
                    autocomplete="off"
                    autocorrect={ false }
                    autocapitalize="off"
                    spellcheck={ false }
                    onclick={ () => this.onClick(textObject) }
                    title={ asset.path }
                    data-src={ asset.path }
                    ref={ e => textObject = e }
                    class={ styles.TextElement }>
                </textarea>
            </div>);

        this.intersector?.observe(textObject!);
        //asset.GetThumbnailUrl().then(r => {
        //    mediaObject.src = r;
        //});

        return media;
    }

    private CreateBitmapMedia(asset: Asset) {
        let mediaObject: HTMLImageElement;
        const media = (
            <div class={ styles.MediaContainer }>
                <img
                    onclick={ () => this.onClick(mediaObject) }
                    title={ asset.path }
                    data-src={ asset.path }
                    ref={ e => mediaObject = e }
                    src={ LoadingIndicatorURL }
                    loading="lazy"
                    decoding="async"
                    alt=""
                    fetchPriority="low"
                    class={ styles.MediaImageElement }>
                </img>
            </div>);

        this.intersector?.observe(mediaObject!);
        //asset.GetThumbnailUrl().then(r => {
        //    mediaObject.src = r;
        //});

        return media;
    }

    private SortByDate(content: Asset[]) {
        content.sort((a, b) => b.GetModifiedDate() - a.GetModifiedDate());
        let groupedData: Dictionary<Asset[]> = {};

        for (const file of content) {
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
        }

        return groupedData;
    }

    private async ChooseBetweenServerOrLocal(serverErrorCode?: string) {
        let files: AssetFile[] = [];
        const { promise: seerverPromise, resolve } = PromiseRes<"local" | "server">();
        const { promise: localPromise, resolve: resolve2 } = PromiseRes<"local" | "server">();
        const loadServer = (<button class={ styles.ServerButton } onclick={ () => resolve("server") }>From Server</button>);
        const loadLocal = (<button class={ styles.LocalButton } onclick={ async () => {
            // Has to be done on click event
            files = await this.GetAssetsFromLocal();
            resolve2("local");
        } }>From Local</button>);

        const showInfo = (
            <div class={ styles.ChooseServerOrWeb }>
                Choose what to load
                <div>
                    { loadServer }
                    { loadLocal }
                </div>
                <span class={ styles.error } style={ { display: serverErrorCode ? "unset" : "none" } }>
                    { serverErrorCode ? `Could not load from server: ${serverErrorCode} ` : "" }
                </span>
            </div>
        );
        this.mainWindow.appendChild(showInfo);

        const choice = await Promise.any([seerverPromise, localPromise]);
        showInfo.remove();
        if (choice == "local") {
            return files;
        } else {
            return false;
        }
    }

    private async GetAssetsFromServer() {
        const { resolve, promise } = PromiseRes<string | AssetFile[]>();
        fetch("/api/fileList").then(async f => {
            if (!f.ok) return resolve(f.statusText.length > 0 ? f.statusText : f.status.toString());
            const fileListJson: { files: AssetFile[]; } = await f.json();
            resolve(fileListJson.files);
        }, (e) => {
            const error = e.toString() as string;
            resolve(error.length > 0 ? error : "Unknown?");
        });

        return promise;
    }

    private GetAssetsFromLocal() {
        let input = document.createElement('input');
        input.type = "file";
        input.webkitdirectory = true;
        input.multiple = true;

        const { resolve, promise } = PromiseRes<AssetFile[]>();

        input.onchange = (e) => {
            const fileList = input.files;
            const files: AssetFile[] = [];
            if (fileList) {
                for (let i = 0; i < fileList.length; i++) {
                    const element = fileList.item(i);
                    if (element)
                        files.push(Asset.FileToAssetFile(element));
                }
            }

            resolve(files);
            input.remove();
        };
        input.click();
        return promise;
    }

    private async DisplayImageThumbnail(image: HTMLImageElement, assetFile: Asset) {
        console.log("Load image", assetFile.path);
        image.setAttribute("data-loading", "true");

        if (assetFile.handle.size < 1024 * 1024 * 10) {
            image.addEventListener("error", async () => {
                image.setAttribute("data-loading", "try thumbnail");
                image.src = LoadingIndicatorURL;
                image.src = await assetFile.GetThumbnailUrl();
                image.setAttribute("data-loading", "done 1");
            }, { once: true });
            image.setAttribute("data-loading", "try native");
            image.src = assetFile.GetUrl();
        } else {
            image.setAttribute("data-loading", "to big. try thumbnail");
            image.src = await assetFile.GetThumbnailUrl();
            image.setAttribute("data-loading", "done 2");
        }
    };

    private async DisplayTextThumbnail(textEl: HTMLDivElement, assetFile: Asset) {
        console.log("Load text", assetFile.path);
        textEl.setAttribute("data-loading", "try native");

        const response = await fetch(assetFile.GetUrl(), {
            headers: {
                'Range': `bytes=0-${2048 - 1}`
            }
        });

        const text = await response.text();
        textEl.textContent = text;
        textEl.setAttribute("data-loading", "done 2");
    };
}
