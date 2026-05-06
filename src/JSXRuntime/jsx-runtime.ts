import type { Box } from "./Box";

export function jsx<K extends keyof HTMLElementTagNameMap>(
    tag: K | Function,
    props: JSX.HTMLAttributes<HTMLElementTagNameMap[K]>
): HTMLElementTagNameMap[K] | (HTMLElement | string | number | boolean | null | undefined)[] {
    const { children, ...attributes } = props;

    if (typeof tag === "function") {
        return tag({ ...props, children });
    }
    const el = document.createElement(tag) as HTMLElementTagNameMap[K];

    // props handling (same as before)
    for (const [key, value] of Object.entries(attributes || {})) {
        if (key === "ref") {
            if (typeof value === "object") {
                (value as Box).element = el;
            } else if (typeof value === "function") {
                (value as (e: HTMLElementTagNameMap[K]) => void)(el)
            }   
        } else if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.substring(2).toLowerCase(), value as any);
        } else if (key == 'style') {
            for (const [cssKey, cssVal] of Object.entries(value as CSSStyleDeclaration || {})) {
                if (cssKey.startsWith("--") && !el.style[cssKey as any]) {
                    el.style.setProperty(cssKey, cssVal);
                } else {
                    // @ts-ignore
                    el.style[cssKey] = cssVal;
                }
            }
        } else {
            el.setAttribute(key, String(value));
        }
    }

    // children handling
    const childrenArray = Array.isArray(children) ? children : [children];
    for (const child of childrenArray) {
        if (child == null || child == undefined) continue;
        el.appendChild(
            child instanceof Node ? child : document.createTextNode(String(child))
        );
    }

    return el;
}

export const Fragment = (props: { children?: any; }) => props.children;
export const jsxs = jsx; // Required for static children in the new transform
export const jsxDEV = jsx;
