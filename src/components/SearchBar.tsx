import styles from "./SearchBar.module.css";

export default function searchBar(onSearch: (searchString: string) => void) {
    return (
        <header class={ styles.SearchHeader }>
            <input
                oninput={ e => {
                    const target = (e.target! as HTMLInputElement);
                    target.size = Math.max(target.value.length, 1);
                    onSearch(target.value);
                }}
                type="text"
                placeholder="Search..."
                ariaLabel="Search"
                class={ styles.SearchBar }>
            </input>
        </header>
    );
}
