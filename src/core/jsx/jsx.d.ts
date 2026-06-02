// https://stackoverflow.com/a/78627418
// Btw actually used to be a module idk
import type { Box as _Box } from "./Box";

declare global {
    namespace JSX {
        type Element = HTMLElement;
        type JSXNode = string | Element | JSXNode[];

        type CSSStyleDeclarationButMaybe = {
            [K in keyof CSSStyleDeclaration]?: CSSStyleDeclaration[K];
        };

        type HTMLAttributes<T extends HTMLElement> = {
            // Map every property of the element to be optional and writable
            [K in keyof Omit<T, 'children' | 'style'>]?: T[K];
        } & {
            ref?: (el: T) => T | { element?: T; };
            class?: string; // alias for className
            for?: string;   // alias for htmlFor
            //Define custom styles here
            style?: CSSStyleDeclarationButMaybe;

            children?: JSXNode;

            [attr: `data-${string}`]: string | number | boolean | null | undefined;
            [attr: `aria-${string}`]: string | number | boolean | null | undefined;
        };

        type ElementProps<T extends HTMLElementTagNameMap> = {
            [K in keyof T]: T[K] extends HTMLElement
            ? HTMLAttributes<T[K]>
            : never; // If it's not an HTMLElement, ignore it
        };


        interface IntrinsicElements extends ElementProps<HTMLElementTagNameMap> {

        }
    }
}
