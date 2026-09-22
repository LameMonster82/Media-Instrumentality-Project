export interface Dictionary<T> {
    [key: string]: T;
}

export interface WorkerPostMessage {
    readonly kind: string;
    readonly transferable?: Transferable[];
}

export interface WorkerShutdown extends WorkerPostMessage {
    readonly kind: "shutdown";
}

export type DevToolsColor =
    "primary" | "primary-light" | "primary-dark" |
    "secondary" | "secondary-light" | "secondary-dark" |
    "tertiary" | "tertiary-light" | "tertiary-dark" |
    "error";

export interface ExtensionTrackEntryPayload {
    dataType?: "track-entry"; // Defaults to "track-entry"
    color?: DevToolsColor;    // Defaults to "primary"
    track: string;            // Required: Name of the custom track
    trackGroup?: string;      // Optional: Group for organizing tracks
    properties?: [string, string][]; // Key-value pairs for detailed view
    tooltipText?: string;     // Short description for tooltip
}

export interface ExtensionMarkerPayload {
    dataType: "marker";       // Required: Identifies as a marker
    color?: DevToolsColor;    // Defaults to "primary"
    properties?: [string, string][]; // Key-value pairs for detailed view
    tooltipText?: string;     // Short description for tooltip
}

declare global {
    interface Console {
        timeStamp(label: string, start?: string | number, end?: string | number, trackName?: string, trackGroup?: string, color?: DevToolsColor): void;
    }
}