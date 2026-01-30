import { Asset } from "./modules/Library/Asset.js";
import { LibraryBuilder } from "./modules/Library/BuildLibrary.js";
import { DisplayNeedsInput } from "./modules/Library/Messages.js";
import { AssetType, type AssetFile } from "./modules/Library/SomeTypes.js";
import { LoadingIndicatorMiddle } from "./modules/LoadingLoop.js";
import SearchBar from "./modules/SearchBar.js";
import { Sidebar } from "./modules/Sidebar.js";


const search = SearchBar((txt: string) => {
    if (inProgress) return;
    const text = txt.toLowerCase();
    if (text.length > 0) {
        const filtered = Asset.FilterAssets(img => img.GetType() !== AssetType.UNKNOWN && img.path.toLowerCase().includes(text));
        document.title = `Found ${filtered.length} items`;
        filtered.sort((a, b) => b.GetModifiedDate() - a.GetModifiedDate());
        library.DisplayNormal(filtered);
    } else {
        DefaultLibrary();
    };
});
document.body.appendChild(search);


const container = document.getElementById("MainViewContainer") as HTMLDivElement;

const sidebar = new Sidebar();
document.body.insertBefore(sidebar.element, container);

const library = new LibraryBuilder(container);
const message = DisplayNeedsInput();



let inProgress = false;
const loadLibrary = async (files: AssetFile[]) => {
    if (inProgress) return;
    inProgress = true;
    let started = false;
    message.label.textContent = `Listing files...`;
    files.sort((a, b) => b.lastModified - a.lastModified);
    const loading = LoadingIndicatorMiddle();
    loading.style.top = "20vh";
    for await (const count of Asset.LoadImagesToCache(files)) {
        if (!started) {
            library.gallery.insertBefore(loading, message.label);
            started = true;
        }
        message.label.textContent = `Loaded ${count} files`;
    }

    if (Asset.GetCount() === 0) {
        inProgress = false;
        message.label.textContent = `Nothing loaded :/`;
        loading.remove();
        return;
    }
    message.label.textContent = `Waiting to probe data`;
    loading.remove();

    inProgress = false;
    DefaultLibrary();
};



async function DefaultLibrary() {
    document.title = `Library ${Asset.GetCount()} items total`;
    const filtered = Asset.FilterAssets(img => img.GetType() !== AssetType.UNKNOWN);
    library.DisplayByDate(library.SortByDate(filtered));
}


const loading = LoadingIndicatorMiddle();
loading.style.top = "20vh";
library.gallery.appendChild(loading);

const fileListResponse = await fetch("/api/fileList");
if (!fileListResponse.ok) {
    loading.remove();
    library.gallery.appendChild(message.label);

    message.fileInput.addEventListener("change", (e) => {
        // @ts-ignore
        const fileList: FileList = e.target!.files;
        const files: AssetFile[] = [];
        for (let i = 0; i < fileList.length; i++) {
            const element = fileList.item(i);
            if (element)
                files.push(Asset.FileToAssetFile(element));
        }
        loadLibrary(files);
    });
    const triggerInput = (event: Event) => {
        event.stopPropagation();
        if (inProgress) return;
        console.log("trigger");
        message.fileInput.click();
    };

    container.addEventListener("click", triggerInput, { once: true });
} else {
    const fileListJson: { files: AssetFile[]; } = await fileListResponse.json();
    loading.remove();
    library.gallery.appendChild(message.label);
    loadLibrary(fileListJson.files);
}

