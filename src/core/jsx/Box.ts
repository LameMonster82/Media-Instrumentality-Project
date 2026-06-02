export type Box<T extends HTMLElement = HTMLElement> = {
    element: T | null;
};

// A small helper to initialize the box
export function createBox<T extends HTMLElement = HTMLElement>(): Box<T> {
    return { element: null };
}