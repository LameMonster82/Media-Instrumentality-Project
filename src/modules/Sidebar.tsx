import styles from "../css/Sidebar.module.css";

type NavLink = {
    title: string,
    /* Material Symbol rounded */
    icon?: string,
    /* User-defined path */
    path: string,
    /* URL Link */
    link?: string,
    html?: HTMLLIElement,
    htmlChild?: HTMLUListElement,
    hidden?: boolean,
    children?: NavLink[];
};

export default class Sidebar {
    private root: NavLink = {
        title: "Root",
        path: "",
        hidden: true
    };
    private rootNav: HTMLElement | undefined;

    constructor() {
        this.add({ title: "Library Root", path: "library", hidden: true, children: [] });
        this.add({ title: "Assets Root", path: "assets", hidden: true, children: [] });
    }

    public onClick: ((path: string, html?: HTMLElement) => void) = () => { };

    add(node: NavLink) {
        const parts = node.path.split("/").filter(Boolean);
        let current = this.root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;

            if (!current.children) {
                current.children = [];
            }

            // If this is the last part → insert the node
            if (i === parts.length - 1) {
                // Check if already exists
                const existing = current.children.find(c => {
                    const stuff = c.path.split("/").filter(Boolean);
                    return stuff[stuff.length - 1] === part;
                });
                if (existing) {
                    // Replace existing with new node
                    Object.assign(existing, node);
                } else {
                    current.children.push(node);
                    current.htmlChild?.appendChild(this.createLink(node));
                }
            } else {
                // Intermediate folder
                let child = current.children.find(c => {
                    const stuff = c.path.split("/").filter(Boolean);
                    return stuff[stuff.length - 1] === part;
                });

                if (!child) {
                    child = {
                        title: part,
                        path: parts.slice(0, i + 1).join("/"),
                        icon: "folder",
                        children: [],
                    };
                    const childHtml = this.createLink(child);
                    current.children.push(child);
                    if (current.hidden) {
                        this.rootNav?.appendChild((
                            <ul>
                                { childHtml }
                            </ul>));
                    } else {
                        current.htmlChild?.appendChild(childHtml);
                    }
                }

                current = child;
            }
        }
    }

    remove(path: string): boolean {
        const parts = path.split("/").filter(Boolean);

        function helper(current: NavLink, depth: number): boolean {
            if (!current.children || current.children.length == 0) return false;

            const part = parts[depth];
            const idx = current.children.findIndex(c => {
                const stuff = c.path.split("/").filter(Boolean);
                return stuff[stuff.length - 1] === part;
            });

            if (idx === -1) return false;

            if (depth === parts.length - 1) {
                // Found the target → remove it
                current.children[idx]?.html?.remove();
                current.children.splice(idx, 1);
                return true;
            } else {
                // Go deeper
                return helper(current.children[idx]!, depth + 1);
            }
        }

        return helper(this.root, 0);
    }

    toHTML(title: string) {
        return (
            <aside class={ styles.Sidebar }>
                <h1>{ title }</h1>
                <div class={styles.ScrollableDiv}>
                    <nav ref={ e => this.rootNav = e }>
                        { this.LinkToHTMLChildren(this.root)[0] }
                    </nav>
                </div>
            </aside>
        );
    }

    private LinkToHTMLChildren(linkOrig: NavLink, firstHidden = true): HTMLElement[] {
        return [(
            <ul>
                { (linkOrig.children ?? []).map((link, index, array) => {
                    if (link.hidden) {
                        return this.LinkToHTMLChildren(link);
                    }

                    return [this.createLink(link)];
                }).flat() }
            </ul>)];
    }

    private GoToLink(e: Event, link: NavLink) {
        e.preventDefault(); // stop full page load

        // Update the URL in the address bar
        if (link.link)
            history.pushState({}, "", link.link);
        else if (link.htmlChild) {
            link.htmlChild.hidden = !link.htmlChild.hidden;
        }


        // Load the new "context"
        this.onClick(link.path, link.html);
    }

    private createLink(link: NavLink): HTMLElement {
        let children: HTMLElement[] | undefined;
        let iconVar = { "--before-content": link.icon ? `"${link.icon}"` : "unset" };
        if (link.children && link.children.length > 0) {
            children = link.children.map(child => this.createLink(child));
        }

        return (
            <li ref={ e => link.html = e }
                style={ iconVar }>
                <a href={ link.link ?? "" }
                    onclick={ e => this.GoToLink(e, link) }>{ link.title }</a>
                <ul ref={ e => link.htmlChild = e }>{ children }</ul>
            </li>
        );
    }
}
