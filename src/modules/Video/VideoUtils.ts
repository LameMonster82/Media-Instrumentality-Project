export function clamp(i: number, min: number, max: number): number {
    return Math.min(Math.max(i, min), max);
}

export function generateSilentWave(durationSeconds: number, sampleRate: number, bitsPerSample: number, channels: number) {
    const numSamples = durationSeconds * sampleRate;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize); 

    function writeString(buffer: Uint8Array, offset: number, string: string) {
        for (let i = 0; i < string.length; i++) buffer[offset + i] = string.charCodeAt(i);
    }
    function writeUint32(buffer: Uint8Array, offset: number, value: number) {
        buffer[offset] = value; buffer[offset + 1] = value >> 8;
        buffer[offset + 2] = value >> 16; buffer[offset + 3] = value >> 24;
    }
    function writeUint16(buffer: Uint8Array, offset: number, value: number) {
        buffer[offset] = value; buffer[offset + 1] = value >> 8;
    }

    const header = new Uint8Array(buffer);
    writeString(header, 0, 'RIFF');
    writeUint32(header, 4, 36 + dataSize);
    writeString(header, 8, 'WAVE');
    writeString(header, 12, 'fmt ');
    writeUint32(header, 16, 16);
    writeUint16(header, 20, 1);
    writeUint16(header, 22, channels);
    writeUint32(header, 24, sampleRate);
    writeUint32(header, 28, sampleRate * blockAlign);
    writeUint16(header, 32, blockAlign);
    writeUint16(header, 34, bitsPerSample);
    writeString(header, 36, 'data');
    writeUint32(header, 40, dataSize);

    const data = new Uint8Array(buffer, 44);
    for (let i = 0; i < dataSize; i++) data[i] = 0;

    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    
    return 'data:audio/wav;base64,' + btoa(binary);
}

export function parseFontFilename(filename: string) {
    const name = filename.replace(/\.[^.]+$/, '');
    const lastHyphenIndex = name.lastIndexOf('-');
    const rawFamily = lastHyphenIndex !== -1 ? name.substring(0, lastHyphenIndex) : name;
    const rawStyle = lastHyphenIndex !== -1 ? name.substring(lastHyphenIndex + 1) : 'Regular';

    const family = rawFamily
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([a-zA-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/[_\-]+/g, ' ')
        .trim();

    const styleLower = rawStyle.toLowerCase();
    const weightMap = [
        { keyword: 'thin', weight: '100' }, { keyword: 'extralight', weight: '200' },
        { keyword: 'ultralight', weight: '200' }, { keyword: 'light', weight: '300' },
        { keyword: 'regular', weight: '400' }, { keyword: 'normal', weight: '400' },
        { keyword: 'medium', weight: '500' }, { keyword: 'semibold', weight: '600' },
        { keyword: 'demibold', weight: '600' }, { keyword: 'bold', weight: '700' },
        { keyword: 'extrabold', weight: '800' }, { keyword: 'ultrabold', weight: '800' },
        { keyword: 'black', weight: '900' }, { keyword: 'heavy', weight: '900' },
    ];

    let weight = '400';
    for (const entry of weightMap) {
        if (styleLower.includes(entry.keyword)) {
            weight = entry.weight;
            break;
        }
    }

    let fontStyle = 'normal';
    if (styleLower.includes('italic')) fontStyle = 'italic';
    else if (styleLower.includes('oblique')) fontStyle = 'oblique';

    return { family, weight, style: fontStyle };
}

export function Wait(resolveArray: ((value: any) => void)[]) {
    const stack = new Error().stack;
    return new Promise<void>(res => {
        // @ts-ignore
        res.stack = stack;
        resolveArray.push(res);
    });
}

export function Resolve(resolveArray: ((value: any) => void)[], data?: any) {
    resolveArray.forEach(resolve => resolve(data));
    resolveArray.length = 0;
}

export const WaitATick = () => new Promise<void>(res => setTimeout(res, 0));