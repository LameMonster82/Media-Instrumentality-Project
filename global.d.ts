// https://stackoverflow.com/a/78627418
import type { Box } from "@/JSXRuntime/Box";
declare global {
	module "*.svg" {
		/**
		 * A path to the SVG file
		 */
		const path: `${string}.svg`;
		export = path;
	}

	module "*.wasm" {
		/**
		 * A path to the WASM file
		 */
		const path: `${string}.wasm`;
		export = path;
	}

	module "*.module.css" {
		/**
		 * A record of class names to their corresponding CSS module classes
		 */
		const classes: { readonly [key: string]: string; };
		export = classes;
	}


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
			ref?: (el: T) => any | { element?: T; };
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
