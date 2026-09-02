import { AttachmentType, AVMediaType, type StreamInfo } from "./FFmpeg/structReader";


export function extractFonts(streams: StreamInfo[]): Uint8Array<ArrayBuffer>[] {
    const attachments = streams.filter(s => s.type === AVMediaType.AVMEDIA_TYPE_ATTACHMENT);

    const fonts: Uint8Array<ArrayBuffer>[] = [];
    for (const attachment of attachments) {
        if (attachment.attachment_config?.type === AttachmentType.FONT) {
            fonts.push(attachment.attachment_config.data);
        }
    }

    return fonts;
}

export function extractCoverArt(streams: StreamInfo[]): Blob | null {
    const attachments = streams.filter(s => s.type === AVMediaType.AVMEDIA_TYPE_ATTACHMENT);

    let cover: Blob | null = null;
    for (const attachment of attachments) {
        if (attachment.attachment_config?.type === AttachmentType.COVER) {
            cover = new Blob([attachment.attachment_config.data], { type: attachment.metadata["mimetype"] });
        }
    }

    return cover;
}