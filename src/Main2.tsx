import { h } from "./JSXRuntime/jsx-runtime";
import SearchBar from "./modules/SearchBar";
import mainStyles from "./css/main.module.css";
import Sidebar from "./modules/Sidebar";
import LoadingIndicator from "./modules/LoadingLoop";
import { Library2 } from "./modules/Library/Library";
import { Asset } from "./modules/Library/Asset";
import { Lightbox2 } from "./modules/Library/Lightbox2";


let isLoaded: boolean = false;
const library = new Library2();
const sidebar = new Sidebar();
const lightbox = new Lightbox2();
const loadingIndicator = LoadingIndicator();
const header = SearchBar((txt: string) => {
    if (!isLoaded) return;
    if (txt.length > 0) {
        library.DisplaySearch(txt);
    } else {
        library.DisplayByDate();
    }
});

library.onClick = ((t) => lightbox.openDialog(t));

sidebar.add({ title: "Library", path: "library/all", icon: "image" });
sidebar.add({ title: "People", path: "library/people", icon: "family_restroom" });
sidebar.add({ title: "Something else idk long long long", path: "library/ye" });
sidebar.add({ title: "Link 4", path: "library/link4" });

sidebar.onClick = (path: string, html) => {
    sidebarHtml.querySelectorAll(".active").forEach(h => h.classList.remove("active"));
    html?.classList.add("active");

    console.log(path);
};

const sidebarHtml = sidebar.toHTML("Gay Library");
loadingIndicator.style.width = "10rem";

const main =
    <div class={ mainStyles.MainGrid }>
        { sidebarHtml }
        { header }
        { library.toHTML() }
    </div>;

document.body.appendChild(main);
document.body.appendChild(lightbox.toHTML());

const libraryAssets = await library.LoadLibrary();
for (const asset of libraryAssets) {
    sidebar.add({
        title: asset.name,
        path: "assets/" + asset.path,
        icon: "imagesmode",
    });
}
library.DisplayByDate();
isLoaded = true


