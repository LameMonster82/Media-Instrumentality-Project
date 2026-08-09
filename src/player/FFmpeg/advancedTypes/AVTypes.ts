// Its fineeeee
/* eslint-disable @typescript-eslint/naming-convention */

export type ExtendedVideoFormats = "BGRA" | "BGRX" | "I420" | "I422" | "I444" | "NV12" | "RGBA" | "RGBX"
    | "I420P10" | "I422P10" | "I444P10" | "I420AP10" | "I422AP10" | "I444AP10"
    | "I420P12" | "I422P12" | "I444P12" | "I420AP12" | "I422AP12" | "I444AP12"
    | "I420A" | "I422A" | "I444A";

export type ExtendedColorPrimatives = "bt709" | "bt470bg" | "smpte170m" | "bt2020" | "smpte432";
export type ExtendedTransferCharacteristics = "bt709" | "smpte170m" | "iec61966-2-1" | "linear" | "pq" | "hlg";
export type ExtendedMatrixCoefficients = "rgb" | "bt709" | "bt470bg" | "smpte170m" | "bt2020-ncl";

// === PRIMARIES ===

export function ColorPrimativeToAVColorPrimative(value: ExtendedColorPrimatives): AVColorPrimaries {
    switch (value) {
        case "bt709": return AVColorPrimaries.AVCOL_PRI_BT709;
        case "bt470bg": return AVColorPrimaries.AVCOL_PRI_BT470BG;
        case "smpte170m": return AVColorPrimaries.AVCOL_PRI_SMPTE170M;
        case "bt2020": return AVColorPrimaries.AVCOL_PRI_BT2020;
        case "smpte432": return AVColorPrimaries.AVCOL_PRI_SMPTE432;
        default: return AVColorPrimaries.AVCOL_PRI_UNSPECIFIED;
    }
}

export function AVColorPrimarieToColorPrimative(value: AVColorPrimaries): ExtendedColorPrimatives | null {
    switch (value) {
        case AVColorPrimaries.AVCOL_PRI_BT709: return "bt709";
        case AVColorPrimaries.AVCOL_PRI_BT470BG: return "bt470bg";
        case AVColorPrimaries.AVCOL_PRI_SMPTE170M: return "smpte170m";
        case AVColorPrimaries.AVCOL_PRI_BT2020: return "bt2020";
        case AVColorPrimaries.AVCOL_PRI_SMPTE432: return "smpte432";
        default: return null;
    }
}

// === TRANSFER CHARACTERISTICS ===

export function TransferCharToAVColorTransferChar(value: ExtendedTransferCharacteristics): AVColorTransferCharacteristic {
    switch (value) {
        case "bt709": return AVColorTransferCharacteristic.AVCOL_TRC_BT709;
        case "smpte170m": return AVColorTransferCharacteristic.AVCOL_TRC_SMPTE170M;
        case "iec61966-2-1": return AVColorTransferCharacteristic.AVCOL_TRC_IEC61966_2_1;
        case "linear": return AVColorTransferCharacteristic.AVCOL_TRC_LINEAR;
        case "pq": return AVColorTransferCharacteristic.AVCOL_TRC_SMPTE2084;
        case "hlg": return AVColorTransferCharacteristic.AVCOL_TRC_ARIB_STD_B67;
        default: return AVColorTransferCharacteristic.AVCOL_TRC_UNSPECIFIED;
    }
}

export function AVColorTransferToTransferChar(value: AVColorTransferCharacteristic): ExtendedTransferCharacteristics | null {
    switch (value) {
        case AVColorTransferCharacteristic.AVCOL_TRC_BT709: return "bt709";
        case AVColorTransferCharacteristic.AVCOL_TRC_SMPTE170M: return "smpte170m";
        case AVColorTransferCharacteristic.AVCOL_TRC_IEC61966_2_1: return "iec61966-2-1";
        case AVColorTransferCharacteristic.AVCOL_TRC_LINEAR: return "linear";
        case AVColorTransferCharacteristic.AVCOL_TRC_SMPTE2084: return "pq";
        case AVColorTransferCharacteristic.AVCOL_TRC_ARIB_STD_B67: return "hlg";
        default: return null;
    }
}

// === MATRIX COEFFICIENTS ===

export function ColorMatrixCoeffToAVColorSpace(value: ExtendedMatrixCoefficients): AVColorSpace {
    switch (value) {
        case "rgb": return AVColorSpace.AVCOL_SPC_RGB;
        case "bt709": return AVColorSpace.AVCOL_SPC_BT709;
        case "bt470bg": return AVColorSpace.AVCOL_SPC_BT470BG;
        case "smpte170m": return AVColorSpace.AVCOL_SPC_SMPTE170M;
        case "bt2020-ncl": return AVColorSpace.AVCOL_SPC_BT2020_NCL;
        default: return AVColorSpace.AVCOL_SPC_UNSPECIFIED;
    }
}

export function AVColorSpaceToColorMatrixCoeff(value: AVColorSpace): ExtendedMatrixCoefficients | null {
    switch (value) {
        case AVColorSpace.AVCOL_SPC_RGB: return "rgb";
        case AVColorSpace.AVCOL_SPC_BT709: return "bt709";
        case AVColorSpace.AVCOL_SPC_BT470BG: return "bt470bg";
        case AVColorSpace.AVCOL_SPC_SMPTE170M: return "smpte170m";
        case AVColorSpace.AVCOL_SPC_BT2020_NCL: return "bt2020-ncl";
        default: return null;
    }
}

// === COLOR RANGE ===

export function ColorRangeToAVColorRange(isFullRange?: boolean): AVColorRange {
    switch (isFullRange) {
        case true: return AVColorRange.AVCOL_RANGE_JPEG;
        case false: return AVColorRange.AVCOL_RANGE_MPEG;
        default: return AVColorRange.AVCOL_RANGE_UNSPECIFIED;
    }
}

export function AVColorRangeToColorRange(range: AVColorRange): boolean | null {
    switch (range) {
        case AVColorRange.AVCOL_RANGE_JPEG: return true;
        case AVColorRange.AVCOL_RANGE_MPEG: return false;
        default: return null;
    }
}


export enum AVColorPrimaries {
    AVCOL_PRI_RESERVED0 = 0,
    AVCOL_PRI_BT709 = 1,  ///< also ITU-R BT1361 / IEC 61966-2-4 / SMPTE RP 177 Annex B
    AVCOL_PRI_UNSPECIFIED = 2,
    AVCOL_PRI_RESERVED = 3,
    AVCOL_PRI_BT470M = 4,  ///< also FCC Title 47 Code of Federal Regulations 73.682 (a)(20)

    AVCOL_PRI_BT470BG = 5,  ///< also ITU-R BT601-6 625 / ITU-R BT1358 625 / ITU-R BT1700 625 PAL & SECAM
    AVCOL_PRI_SMPTE170M = 6,  ///< also ITU-R BT601-6 525 / ITU-R BT1358 525 / ITU-R BT1700 NTSC
    AVCOL_PRI_SMPTE240M = 7,  ///< identical to above, also called "SMPTE C" even though it uses D65
    AVCOL_PRI_FILM = 8,  ///< colour filters using Illuminant C
    AVCOL_PRI_BT2020 = 9,  ///< ITU-R BT2020
    AVCOL_PRI_SMPTE428 = 10, ///< SMPTE ST 428-1 (CIE 1931 XYZ)
    AVCOL_PRI_SMPTEST428_1 = AVCOL_PRI_SMPTE428,
    AVCOL_PRI_SMPTE431 = 11, ///< SMPTE ST 431-2 (2011) / DCI P3
    AVCOL_PRI_SMPTE432 = 12, ///< SMPTE ST 432-1 (2010) / P3 D65 / Display P3
    AVCOL_PRI_EBU3213 = 22, ///< EBU Tech. 3213-E (nothing there) / one of JEDEC P22 group phosphors
    AVCOL_PRI_JEDEC_P22 = AVCOL_PRI_EBU3213,
    AVCOL_PRI_NB                ///< Not part of ABI
};

/**
 * Color Transfer Characteristic.
 * These values match the ones defined by ISO/IEC 23091-2_2019 subclause 8.2.
 */
export enum AVColorTransferCharacteristic {
    AVCOL_TRC_RESERVED0 = 0,
    AVCOL_TRC_BT709 = 1,  ///< also ITU-R BT1361
    AVCOL_TRC_UNSPECIFIED = 2,
    AVCOL_TRC_RESERVED = 3,
    AVCOL_TRC_GAMMA22 = 4,  ///< also ITU-R BT470M / ITU-R BT1700 625 PAL & SECAM
    AVCOL_TRC_GAMMA28 = 5,  ///< also ITU-R BT470BG
    AVCOL_TRC_SMPTE170M = 6,  ///< also ITU-R BT601-6 525 or 625 / ITU-R BT1358 525 or 625 / ITU-R BT1700 NTSC
    AVCOL_TRC_SMPTE240M = 7,
    AVCOL_TRC_LINEAR = 8,  ///< "Linear transfer characteristics"
    AVCOL_TRC_LOG = 9,  ///< "Logarithmic transfer characteristic (100:1 range)"
    AVCOL_TRC_LOG_SQRT = 10, ///< "Logarithmic transfer characteristic (100 * Sqrt(10) : 1 range)"
    AVCOL_TRC_IEC61966_2_4 = 11, ///< IEC 61966-2-4
    AVCOL_TRC_BT1361_ECG = 12, ///< ITU-R BT1361 Extended Colour Gamut
    AVCOL_TRC_IEC61966_2_1 = 13, ///< IEC 61966-2-1 (sRGB or sYCC)
    AVCOL_TRC_BT2020_10 = 14, ///< ITU-R BT2020 for 10-bit system
    AVCOL_TRC_BT2020_12 = 15, ///< ITU-R BT2020 for 12-bit system
    AVCOL_TRC_SMPTE2084 = 16, ///< SMPTE ST 2084 for 10-, 12-, 14- and 16-bit systems
    AVCOL_TRC_SMPTEST2084 = AVCOL_TRC_SMPTE2084,
    AVCOL_TRC_SMPTE428 = 17, ///< SMPTE ST 428-1
    AVCOL_TRC_SMPTEST428_1 = AVCOL_TRC_SMPTE428,
    AVCOL_TRC_ARIB_STD_B67 = 18, ///< ARIB STD-B67, known as "Hybrid log-gamma"
    AVCOL_TRC_NB                 ///< Not part of ABI
};

/**
 * YUV colorspace type.
 * These values match the ones defined by ISO/IEC 23091-2_2019 subclause 8.3.
 */
export enum AVColorSpace {
    AVCOL_SPC_RGB = 0,  ///< order of coefficients is actually GBR, also IEC 61966-2-1 (sRGB), YZX and ST 428-1
    AVCOL_SPC_BT709 = 1,  ///< also ITU-R BT1361 / IEC 61966-2-4 xvYCC709 / derived in SMPTE RP 177 Annex B
    AVCOL_SPC_UNSPECIFIED = 2,
    AVCOL_SPC_RESERVED = 3,  ///< reserved for future use by ITU-T and ISO/IEC just like 15-255 are
    AVCOL_SPC_FCC = 4,  ///< FCC Title 47 Code of Federal Regulations 73.682 (a)(20)
    AVCOL_SPC_BT470BG = 5,  ///< also ITU-R BT601-6 625 / ITU-R BT1358 625 / ITU-R BT1700 625 PAL & SECAM / IEC 61966-2-4 xvYCC601
    AVCOL_SPC_SMPTE170M = 6,  ///< also ITU-R BT601-6 525 / ITU-R BT1358 525 / ITU-R BT1700 NTSC / functionally identical to above
    AVCOL_SPC_SMPTE240M = 7,  ///< derived from 170M primaries and D65 white point, 170M is derived from BT470 System M's primaries
    AVCOL_SPC_YCGCO = 8,  ///< used by Dirac / VC-2 and H.264 FRext, see ITU-T SG16
    AVCOL_SPC_YCOCG = AVCOL_SPC_YCGCO,
    AVCOL_SPC_BT2020_NCL = 9,  ///< ITU-R BT2020 non-constant luminance system
    AVCOL_SPC_BT2020_CL = 10, ///< ITU-R BT2020 constant luminance system
    AVCOL_SPC_SMPTE2085 = 11, ///< SMPTE 2085, Y'D'zD'x
    AVCOL_SPC_CHROMA_DERIVED_NCL = 12, ///< Chromaticity-derived non-constant luminance system
    AVCOL_SPC_CHROMA_DERIVED_CL = 13, ///< Chromaticity-derived constant luminance system
    AVCOL_SPC_ICTCP = 14, ///< ITU-R BT.2100-0, ICtCp
    AVCOL_SPC_IPT_C2 = 15, ///< SMPTE ST 2128, IPT-C2
    AVCOL_SPC_YCGCO_RE = 16, ///< YCgCo-R, even addition of bits
    AVCOL_SPC_YCGCO_RO = 17, ///< YCgCo-R, odd addition of bits
    AVCOL_SPC_NB                ///< Not part of ABI
};

/**
 * Location of chroma samples.
 *
 * Illustration showing the location of the first (top left) chroma sample of the
 * image, the left shows only luma, the right
 * shows the location of the chroma sample, the 2 could be imagined to overlay
 * each other but are drawn separately due to limitations of ASCII
 *
 *                1st 2nd       1st 2nd horizontal luma sample positions
 *                 v   v         v   v
 *                 ______        ______
 *1st luma line > |X   X ...    |3 4 X ...     X are luma samples,
 *                |             |1 2           1-6 are possible chroma positions
 *2nd luma line > |X   X ...    |5 6 X ...     0 is undefined/unknown position
 */
export enum AVChromaLocation {
    AVCHROMA_LOC_UNSPECIFIED = 0,
    AVCHROMA_LOC_LEFT = 1, ///< MPEG-2/4 4:2:0, H.264 default for 4:2:0
    AVCHROMA_LOC_CENTER = 2, ///< MPEG-1 4:2:0, JPEG 4:2:0, H.263 4:2:0
    AVCHROMA_LOC_TOPLEFT = 3, ///< ITU-R 601, SMPTE 274M 296M S314M(DV 4:1:1), mpeg2 4:2:2
    AVCHROMA_LOC_TOP = 4,
    AVCHROMA_LOC_BOTTOMLEFT = 5,
    AVCHROMA_LOC_BOTTOM = 6,
    AVCHROMA_LOC_NB               ///< Not part of ABI
};

/**
 * Visual content value range.
 *
 * These values are based on definitions that can be found in multiple
 * specifications, such as ITU-T BT.709 (3.4 - Quantization of RGB, luminance
 * and colour-difference signals), ITU-T BT.2020 (Table 5 - Digital
 * Representation) as well as ITU-T BT.2100 (Table 9 - Digital 10- and 12-bit
 * integer representation). At the time of writing, the BT.2100 one is
 * recommended, as it also defines the full range representation.
 *
 * Common definitions:
 *   - For RGB and luma planes such as Y in YCbCr and I in ICtCp,
 *     'E' is the original value in range of 0.0 to 1.0.
 *   - For chroma planes such as Cb,Cr and Ct,Cp, 'E' is the original
 *     value in range of -0.5 to 0.5.
 *   - 'n' is the output bit depth.
 *   - For additional definitions such as rounding and clipping to valid n
 *     bit unsigned integer range, please refer to BT.2100 (Table 9).
 */
export enum AVColorRange {
    AVCOL_RANGE_UNSPECIFIED = 0,

    /**
     * Narrow or limited range content.
     *
     * - For luma planes:
     *
     *       (219 * E + 16) * 2^(n-8)
     *
     *   F.ex. the range of 16-235 for 8 bits
     *
     * - For chroma planes:
     *
     *       (224 * E + 128) * 2^(n-8)
     *
     *   F.ex. the range of 16-240 for 8 bits
     */
    AVCOL_RANGE_MPEG = 1,

    /**
     * Full range content.
     *
     * - For RGB and luma planes:
     *
     *       (2^n - 1) * E
     *
     *   F.ex. the range of 0-255 for 8 bits
     *
     * - For chroma planes:
     *
     *       (2^n - 1) * E + 2^(n - 1)
     *
     *   F.ex. the range of 1-255 for 8 bits
     */
    AVCOL_RANGE_JPEG = 2,
    AVCOL_RANGE_NB               ///< Not part of ABI
};


export function VideoFormatToAVPixelFormat(fmt: ExtendedVideoFormats): AVPixelFormat {
    switch (fmt) {
        case "BGRA": return AVPixelFormat.AV_PIX_FMT_BGRA;
        case "BGRX": return AVPixelFormat.AV_PIX_FMT_BGR0;
        case "RGBA": return AVPixelFormat.AV_PIX_FMT_RGBA;
        case "RGBX": return AVPixelFormat.AV_PIX_FMT_RGB0;

        case "I420": return AVPixelFormat.AV_PIX_FMT_YUV420P;
        case "I422": return AVPixelFormat.AV_PIX_FMT_YUV422P;
        case "I444": return AVPixelFormat.AV_PIX_FMT_YUV444P;

        case "NV12": return AVPixelFormat.AV_PIX_FMT_NV12;
        case "I420A": return AVPixelFormat.AV_PIX_FMT_YUVA420P;
        case "I422A": return AVPixelFormat.AV_PIX_FMT_YUVA422P;
        case "I444A": return AVPixelFormat.AV_PIX_FMT_YUVA444P;

        case "I420P10": return AVPixelFormat.AV_PIX_FMT_YUV420P10LE;
        case "I422P10": return AVPixelFormat.AV_PIX_FMT_YUV422P10LE;
        case "I444P10": return AVPixelFormat.AV_PIX_FMT_YUV444P10LE;

        case "I420AP10": return AVPixelFormat.AV_PIX_FMT_YUVA420P10LE;
        case "I422AP10": return AVPixelFormat.AV_PIX_FMT_YUVA422P10LE;
        case "I444AP10": return AVPixelFormat.AV_PIX_FMT_YUVA444P10LE;

        case "I420P12": return AVPixelFormat.AV_PIX_FMT_YUV420P12LE;
        case "I422P12": return AVPixelFormat.AV_PIX_FMT_YUV422P12LE;
        case "I444P12": return AVPixelFormat.AV_PIX_FMT_YUV444P12LE;

        case "I422AP12": return AVPixelFormat.AV_PIX_FMT_YUVA422P12LE;
        case "I444AP12": return AVPixelFormat.AV_PIX_FMT_YUVA444P12LE;

        default:
            return AVPixelFormat.AV_PIX_FMT_NONE;
    }
}

export function AVPixelFormatToVideoFormat(fmt: AVPixelFormat): ExtendedVideoFormats {
    switch (fmt) {
        case AVPixelFormat.AV_PIX_FMT_BGRA: return "BGRA";
        case AVPixelFormat.AV_PIX_FMT_BGR0: return "BGRX";
        case AVPixelFormat.AV_PIX_FMT_RGBA: return "RGBA";
        case AVPixelFormat.AV_PIX_FMT_RGB0: return "RGBX";

        case AVPixelFormat.AV_PIX_FMT_YUV420P: return "I420";
        case AVPixelFormat.AV_PIX_FMT_YUV422P: return "I422";
        case AVPixelFormat.AV_PIX_FMT_YUV444P: return "I444";

        case AVPixelFormat.AV_PIX_FMT_NV12: return "NV12";
        case AVPixelFormat.AV_PIX_FMT_YUVA420P: return "I420A";
        case AVPixelFormat.AV_PIX_FMT_YUVA422P: return "I422A";
        case AVPixelFormat.AV_PIX_FMT_YUVA444P: return "I444A";

        case AVPixelFormat.AV_PIX_FMT_YUV420P10LE: return "I420P10";
        case AVPixelFormat.AV_PIX_FMT_YUV422P10LE: return "I422P10";
        case AVPixelFormat.AV_PIX_FMT_YUV444P10LE: return "I444P10";

        case AVPixelFormat.AV_PIX_FMT_YUVA420P10LE: return "I420AP10";
        case AVPixelFormat.AV_PIX_FMT_YUVA422P10LE: return "I422AP10";
        case AVPixelFormat.AV_PIX_FMT_YUVA444P10LE: return "I444AP10";

        case AVPixelFormat.AV_PIX_FMT_YUV420P12LE: return "I420P12";
        case AVPixelFormat.AV_PIX_FMT_YUV422P12LE: return "I422P12";
        case AVPixelFormat.AV_PIX_FMT_YUV444P12LE: return "I444P12";

        case AVPixelFormat.AV_PIX_FMT_YUVA422P12LE: return "I422AP12";
        case AVPixelFormat.AV_PIX_FMT_YUVA444P12LE: return "I444AP12";

        default:
            throw new Error(`Unsupported AVPixelFormat: ${fmt}`);
    }
}

export function AVSampleFormatToAudioFormat(fmt: AVSampleFormat): AudioSampleFormat {
    switch (fmt) {
        case AVSampleFormat.AV_SAMPLE_FMT_U8: return 'u8';
        case AVSampleFormat.AV_SAMPLE_FMT_S16: return 's16';
        case AVSampleFormat.AV_SAMPLE_FMT_S32: return 's32';
        case AVSampleFormat.AV_SAMPLE_FMT_FLT: return 'f32';

        case AVSampleFormat.AV_SAMPLE_FMT_S16P: return 's16-planar';
        case AVSampleFormat.AV_SAMPLE_FMT_S32P: return 's32-planar';
        case AVSampleFormat.AV_SAMPLE_FMT_FLTP: return 'f32-planar';

        default:
            throw new Error(`Unsupported AVSampleFormat: ${fmt}`);
    }
}

export enum AVSampleFormat {
    AV_SAMPLE_FMT_NONE = -1,
    AV_SAMPLE_FMT_U8,          ///< unsigned 8 bits
    AV_SAMPLE_FMT_S16,         ///< signed 16 bits
    AV_SAMPLE_FMT_S32,         ///< signed 32 bits
    AV_SAMPLE_FMT_FLT,         ///< float
    AV_SAMPLE_FMT_DBL,         ///< double

    AV_SAMPLE_FMT_U8P,         ///< unsigned 8 bits, planar
    AV_SAMPLE_FMT_S16P,        ///< signed 16 bits, planar
    AV_SAMPLE_FMT_S32P,        ///< signed 32 bits, planar
    AV_SAMPLE_FMT_FLTP,        ///< float, planar
    AV_SAMPLE_FMT_DBLP,        ///< double, planar
    AV_SAMPLE_FMT_S64,         ///< signed 64 bits
    AV_SAMPLE_FMT_S64P,        ///< signed 64 bits, planar

    AV_SAMPLE_FMT_NB           ///< Number of sample formats. DO NOT USE if linking dynamically
};


// fuck it. All formats from <libavutil/pixfmt.h>
// TODO: We can probably make an auto import with @ffmpeg/gen_struct.ts
export enum AVPixelFormat {
    AV_PIX_FMT_NONE = -1,
    AV_PIX_FMT_YUV420P,   ///< planar YUV 4:2:0, 12bpp, (1 Cr & Cb sample per 2x2 Y samples)
    AV_PIX_FMT_YUYV422,   ///< packed YUV 4:2:2, 16bpp, Y0 Cb Y1 Cr
    AV_PIX_FMT_RGB24,     ///< packed RGB 8:8:8, 24bpp, RGBRGB...
    AV_PIX_FMT_BGR24,     ///< packed RGB 8:8:8, 24bpp, BGRBGR...
    AV_PIX_FMT_YUV422P,   ///< planar YUV 4:2:2, 16bpp, (1 Cr & Cb sample per 2x1 Y samples)
    AV_PIX_FMT_YUV444P,   ///< planar YUV 4:4:4, 24bpp, (1 Cr & Cb sample per 1x1 Y samples)
    AV_PIX_FMT_YUV410P,   ///< planar YUV 4:1:0,  9bpp, (1 Cr & Cb sample per 4x4 Y samples)
    AV_PIX_FMT_YUV411P,   ///< planar YUV 4:1:1, 12bpp, (1 Cr & Cb sample per 4x1 Y samples)
    AV_PIX_FMT_GRAY8,     ///<        Y        ,  8bpp
    AV_PIX_FMT_MONOWHITE, ///<        Y        ,  1bpp, 0 is white, 1 is black, in each byte pixels are ordered from the msb to the lsb
    AV_PIX_FMT_MONOBLACK, ///<        Y        ,  1bpp, 0 is black, 1 is white, in each byte pixels are ordered from the msb to the lsb
    AV_PIX_FMT_PAL8,      ///< 8 bits with AV_PIX_FMT_RGB32 palette
    AV_PIX_FMT_YUVJ420P,  ///< planar YUV 4:2:0, 12bpp, full scale (JPEG), deprecated in favor of AV_PIX_FMT_YUV420P and setting color_range
    AV_PIX_FMT_YUVJ422P,  ///< planar YUV 4:2:2, 16bpp, full scale (JPEG), deprecated in favor of AV_PIX_FMT_YUV422P and setting color_range
    AV_PIX_FMT_YUVJ444P,  ///< planar YUV 4:4:4, 24bpp, full scale (JPEG), deprecated in favor of AV_PIX_FMT_YUV444P and setting color_range
    AV_PIX_FMT_UYVY422,   ///< packed YUV 4:2:2, 16bpp, Cb Y0 Cr Y1
    AV_PIX_FMT_UYYVYY411, ///< packed YUV 4:1:1, 12bpp, Cb Y0 Y1 Cr Y2 Y3
    AV_PIX_FMT_BGR8,      ///< packed RGB 3:3:2,  8bpp, (msb)2B 3G 3R(lsb)
    AV_PIX_FMT_BGR4,      ///< packed RGB 1:2:1 bitstream,  4bpp, (msb)1B 2G 1R(lsb), a byte contains two pixels, the first pixel in the byte is the one composed by the 4 msb bits
    AV_PIX_FMT_BGR4_BYTE, ///< packed RGB 1:2:1,  8bpp, (msb)1B 2G 1R(lsb)
    AV_PIX_FMT_RGB8,      ///< packed RGB 3:3:2,  8bpp, (msb)3R 3G 2B(lsb)
    AV_PIX_FMT_RGB4,      ///< packed RGB 1:2:1 bitstream,  4bpp, (msb)1R 2G 1B(lsb), a byte contains two pixels, the first pixel in the byte is the one composed by the 4 msb bits
    AV_PIX_FMT_RGB4_BYTE, ///< packed RGB 1:2:1,  8bpp, (msb)1R 2G 1B(lsb)
    AV_PIX_FMT_NV12,      ///< planar YUV 4:2:0, 12bpp, 1 plane for Y and 1 plane for the UV components, which are interleaved (first byte U and the following byte V)
    AV_PIX_FMT_NV21,      ///< as above, but U and V bytes are swapped

    AV_PIX_FMT_ARGB,      ///< packed ARGB 8:8:8:8, 32bpp, ARGBARGB...
    AV_PIX_FMT_RGBA,      ///< packed RGBA 8:8:8:8, 32bpp, RGBARGBA...
    AV_PIX_FMT_ABGR,      ///< packed ABGR 8:8:8:8, 32bpp, ABGRABGR...
    AV_PIX_FMT_BGRA,      ///< packed BGRA 8:8:8:8, 32bpp, BGRABGRA...

    AV_PIX_FMT_GRAY16BE,  ///<        Y        , 16bpp, big-endian
    AV_PIX_FMT_GRAY16LE,  ///<        Y        , 16bpp, little-endian
    AV_PIX_FMT_YUV440P,   ///< planar YUV 4:4:0 (1 Cr & Cb sample per 1x2 Y samples)
    AV_PIX_FMT_YUVJ440P,  ///< planar YUV 4:4:0 full scale (JPEG), deprecated in favor of AV_PIX_FMT_YUV440P and setting color_range
    AV_PIX_FMT_YUVA420P,  ///< planar YUV 4:2:0, 20bpp, (1 Cr & Cb sample per 2x2 Y & A samples)
    AV_PIX_FMT_RGB48BE,   ///< packed RGB 16:16:16, 48bpp, 16R, 16G, 16B, the 2-byte value for each R/G/B component is stored as big-endian
    AV_PIX_FMT_RGB48LE,   ///< packed RGB 16:16:16, 48bpp, 16R, 16G, 16B, the 2-byte value for each R/G/B component is stored as little-endian

    AV_PIX_FMT_RGB565BE,  ///< packed RGB 5:6:5, 16bpp, (msb)   5R 6G 5B(lsb), big-endian
    AV_PIX_FMT_RGB565LE,  ///< packed RGB 5:6:5, 16bpp, (msb)   5R 6G 5B(lsb), little-endian
    AV_PIX_FMT_RGB555BE,  ///< packed RGB 5:5:5, 16bpp, (msb)1X 5R 5G 5B(lsb), big-endian   , X=unused/undefined
    AV_PIX_FMT_RGB555LE,  ///< packed RGB 5:5:5, 16bpp, (msb)1X 5R 5G 5B(lsb), little-endian, X=unused/undefined

    AV_PIX_FMT_BGR565BE,  ///< packed BGR 5:6:5, 16bpp, (msb)   5B 6G 5R(lsb), big-endian
    AV_PIX_FMT_BGR565LE,  ///< packed BGR 5:6:5, 16bpp, (msb)   5B 6G 5R(lsb), little-endian
    AV_PIX_FMT_BGR555BE,  ///< packed BGR 5:5:5, 16bpp, (msb)1X 5B 5G 5R(lsb), big-endian   , X=unused/undefined
    AV_PIX_FMT_BGR555LE,  ///< packed BGR 5:5:5, 16bpp, (msb)1X 5B 5G 5R(lsb), little-endian, X=unused/undefined

    /**
     *  Hardware acceleration through VA-API, data[3] contains a
     *  VASurfaceID.
     */
    AV_PIX_FMT_VAAPI,

    AV_PIX_FMT_YUV420P16LE,  ///< planar YUV 4:2:0, 24bpp, (1 Cr & Cb sample per 2x2 Y samples), little-endian
    AV_PIX_FMT_YUV420P16BE,  ///< planar YUV 4:2:0, 24bpp, (1 Cr & Cb sample per 2x2 Y samples), big-endian
    AV_PIX_FMT_YUV422P16LE,  ///< planar YUV 4:2:2, 32bpp, (1 Cr & Cb sample per 2x1 Y samples), little-endian
    AV_PIX_FMT_YUV422P16BE,  ///< planar YUV 4:2:2, 32bpp, (1 Cr & Cb sample per 2x1 Y samples), big-endian
    AV_PIX_FMT_YUV444P16LE,  ///< planar YUV 4:4:4, 48bpp, (1 Cr & Cb sample per 1x1 Y samples), little-endian
    AV_PIX_FMT_YUV444P16BE,  ///< planar YUV 4:4:4, 48bpp, (1 Cr & Cb sample per 1x1 Y samples), big-endian
    AV_PIX_FMT_DXVA2_VLD,    ///< HW decoding through DXVA2, Picture.data[3] contains a LPDIRECT3DSURFACE9 pointer

    AV_PIX_FMT_RGB444LE,  ///< packed RGB 4:4:4, 16bpp, (msb)4X 4R 4G 4B(lsb), little-endian, X=unused/undefined
    AV_PIX_FMT_RGB444BE,  ///< packed RGB 4:4:4, 16bpp, (msb)4X 4R 4G 4B(lsb), big-endian,    X=unused/undefined
    AV_PIX_FMT_BGR444LE,  ///< packed BGR 4:4:4, 16bpp, (msb)4X 4B 4G 4R(lsb), little-endian, X=unused/undefined
    AV_PIX_FMT_BGR444BE,  ///< packed BGR 4:4:4, 16bpp, (msb)4X 4B 4G 4R(lsb), big-endian,    X=unused/undefined
    AV_PIX_FMT_YA8,       ///< 8 bits gray, 8 bits alpha

    AV_PIX_FMT_Y400A = AV_PIX_FMT_YA8, ///< alias for AV_PIX_FMT_YA8
    AV_PIX_FMT_GRAY8A = AV_PIX_FMT_YA8, ///< alias for AV_PIX_FMT_YA8

    AV_PIX_FMT_BGR48BE,   ///< packed RGB 16:16:16, 48bpp, 16B, 16G, 16R, the 2-byte value for each R/G/B component is stored as big-endian
    AV_PIX_FMT_BGR48LE,   ///< packed RGB 16:16:16, 48bpp, 16B, 16G, 16R, the 2-byte value for each R/G/B component is stored as little-endian

    /**
     * The following 12 formats have the disadvantage of needing 1 format for each bit depth.
     * Notice that each 9/10 bits sample is stored in 16 bits with extra padding.
     * If you want to support multiple bit depths, then using AV_PIX_FMT_YUV420P16* with the bpp stored separately is better.
     */
    AV_PIX_FMT_YUV420P9BE, ///< planar YUV 4:2:0, 13.5bpp, (1 Cr & Cb sample per 2x2 Y samples), big-endian
    AV_PIX_FMT_YUV420P9LE, ///< planar YUV 4:2:0, 13.5bpp, (1 Cr & Cb sample per 2x2 Y samples), little-endian
    AV_PIX_FMT_YUV420P10BE,///< planar YUV 4:2:0, 15bpp, (1 Cr & Cb sample per 2x2 Y samples), big-endian
    AV_PIX_FMT_YUV420P10LE,///< planar YUV 4:2:0, 15bpp, (1 Cr & Cb sample per 2x2 Y samples), little-endian
    AV_PIX_FMT_YUV422P10BE,///< planar YUV 4:2:2, 20bpp, (1 Cr & Cb sample per 2x1 Y samples), big-endian
    AV_PIX_FMT_YUV422P10LE,///< planar YUV 4:2:2, 20bpp, (1 Cr & Cb sample per 2x1 Y samples), little-endian
    AV_PIX_FMT_YUV444P9BE, ///< planar YUV 4:4:4, 27bpp, (1 Cr & Cb sample per 1x1 Y samples), big-endian
    AV_PIX_FMT_YUV444P9LE, ///< planar YUV 4:4:4, 27bpp, (1 Cr & Cb sample per 1x1 Y samples), little-endian
    AV_PIX_FMT_YUV444P10BE,///< planar YUV 4:4:4, 30bpp, (1 Cr & Cb sample per 1x1 Y samples), big-endian
    AV_PIX_FMT_YUV444P10LE,///< planar YUV 4:4:4, 30bpp, (1 Cr & Cb sample per 1x1 Y samples), little-endian
    AV_PIX_FMT_YUV422P9BE, ///< planar YUV 4:2:2, 18bpp, (1 Cr & Cb sample per 2x1 Y samples), big-endian
    AV_PIX_FMT_YUV422P9LE, ///< planar YUV 4:2:2, 18bpp, (1 Cr & Cb sample per 2x1 Y samples), little-endian
    AV_PIX_FMT_GBRP,      ///< planar GBR 4:4:4 24bpp
    AV_PIX_FMT_GBR24P = AV_PIX_FMT_GBRP, // alias for #AV_PIX_FMT_GBRP
    AV_PIX_FMT_GBRP9BE,   ///< planar GBR 4:4:4 27bpp, big-endian
    AV_PIX_FMT_GBRP9LE,   ///< planar GBR 4:4:4 27bpp, little-endian
    AV_PIX_FMT_GBRP10BE,  ///< planar GBR 4:4:4 30bpp, big-endian
    AV_PIX_FMT_GBRP10LE,  ///< planar GBR 4:4:4 30bpp, little-endian
    AV_PIX_FMT_GBRP16BE,  ///< planar GBR 4:4:4 48bpp, big-endian
    AV_PIX_FMT_GBRP16LE,  ///< planar GBR 4:4:4 48bpp, little-endian
    AV_PIX_FMT_YUVA422P,  ///< planar YUV 4:2:2 24bpp, (1 Cr & Cb sample per 2x1 Y & A samples)
    AV_PIX_FMT_YUVA444P,  ///< planar YUV 4:4:4 32bpp, (1 Cr & Cb sample per 1x1 Y & A samples)
    AV_PIX_FMT_YUVA420P9BE,  ///< planar YUV 4:2:0 22.5bpp, (1 Cr & Cb sample per 2x2 Y & A samples), big-endian
    AV_PIX_FMT_YUVA420P9LE,  ///< planar YUV 4:2:0 22.5bpp, (1 Cr & Cb sample per 2x2 Y & A samples), little-endian
    AV_PIX_FMT_YUVA422P9BE,  ///< planar YUV 4:2:2 27bpp, (1 Cr & Cb sample per 2x1 Y & A samples), big-endian
    AV_PIX_FMT_YUVA422P9LE,  ///< planar YUV 4:2:2 27bpp, (1 Cr & Cb sample per 2x1 Y & A samples), little-endian
    AV_PIX_FMT_YUVA444P9BE,  ///< planar YUV 4:4:4 36bpp, (1 Cr & Cb sample per 1x1 Y & A samples), big-endian
    AV_PIX_FMT_YUVA444P9LE,  ///< planar YUV 4:4:4 36bpp, (1 Cr & Cb sample per 1x1 Y & A samples), little-endian
    AV_PIX_FMT_YUVA420P10BE, ///< planar YUV 4:2:0 25bpp, (1 Cr & Cb sample per 2x2 Y & A samples, big-endian)
    AV_PIX_FMT_YUVA420P10LE, ///< planar YUV 4:2:0 25bpp, (1 Cr & Cb sample per 2x2 Y & A samples, little-endian)
    AV_PIX_FMT_YUVA422P10BE, ///< planar YUV 4:2:2 30bpp, (1 Cr & Cb sample per 2x1 Y & A samples, big-endian)
    AV_PIX_FMT_YUVA422P10LE, ///< planar YUV 4:2:2 30bpp, (1 Cr & Cb sample per 2x1 Y & A samples, little-endian)
    AV_PIX_FMT_YUVA444P10BE, ///< planar YUV 4:4:4 40bpp, (1 Cr & Cb sample per 1x1 Y & A samples, big-endian)
    AV_PIX_FMT_YUVA444P10LE, ///< planar YUV 4:4:4 40bpp, (1 Cr & Cb sample per 1x1 Y & A samples, little-endian)
    AV_PIX_FMT_YUVA420P16BE, ///< planar YUV 4:2:0 40bpp, (1 Cr & Cb sample per 2x2 Y & A samples, big-endian)
    AV_PIX_FMT_YUVA420P16LE, ///< planar YUV 4:2:0 40bpp, (1 Cr & Cb sample per 2x2 Y & A samples, little-endian)
    AV_PIX_FMT_YUVA422P16BE, ///< planar YUV 4:2:2 48bpp, (1 Cr & Cb sample per 2x1 Y & A samples, big-endian)
    AV_PIX_FMT_YUVA422P16LE, ///< planar YUV 4:2:2 48bpp, (1 Cr & Cb sample per 2x1 Y & A samples, little-endian)
    AV_PIX_FMT_YUVA444P16BE, ///< planar YUV 4:4:4 64bpp, (1 Cr & Cb sample per 1x1 Y & A samples, big-endian)
    AV_PIX_FMT_YUVA444P16LE, ///< planar YUV 4:4:4 64bpp, (1 Cr & Cb sample per 1x1 Y & A samples, little-endian)

    AV_PIX_FMT_VDPAU,     ///< HW acceleration through VDPAU, Picture.data[3] contains a VdpVideoSurface

    AV_PIX_FMT_XYZ12LE,      ///< packed XYZ 4:4:4, 36 bpp, (msb) 12X, 12Y, 12Z (lsb), the 2-byte value for each X/Y/Z is stored as little-endian, the 4 lower bits are set to 0
    AV_PIX_FMT_XYZ12BE,      ///< packed XYZ 4:4:4, 36 bpp, (msb) 12X, 12Y, 12Z (lsb), the 2-byte value for each X/Y/Z is stored as big-endian, the 4 lower bits are set to 0
    AV_PIX_FMT_NV16,         ///< interleaved chroma YUV 4:2:2, 16bpp, (1 Cr & Cb sample per 2x1 Y samples)
    AV_PIX_FMT_NV20LE,       ///< interleaved chroma YUV 4:2:2, 20bpp, (1 Cr & Cb sample per 2x1 Y samples), little-endian
    AV_PIX_FMT_NV20BE,       ///< interleaved chroma YUV 4:2:2, 20bpp, (1 Cr & Cb sample per 2x1 Y samples), big-endian

    AV_PIX_FMT_RGBA64BE,     ///< packed RGBA 16:16:16:16, 64bpp, 16R, 16G, 16B, 16A, the 2-byte value for each R/G/B/A component is stored as big-endian
    AV_PIX_FMT_RGBA64LE,     ///< packed RGBA 16:16:16:16, 64bpp, 16R, 16G, 16B, 16A, the 2-byte value for each R/G/B/A component is stored as little-endian
    AV_PIX_FMT_BGRA64BE,     ///< packed RGBA 16:16:16:16, 64bpp, 16B, 16G, 16R, 16A, the 2-byte value for each R/G/B/A component is stored as big-endian
    AV_PIX_FMT_BGRA64LE,     ///< packed RGBA 16:16:16:16, 64bpp, 16B, 16G, 16R, 16A, the 2-byte value for each R/G/B/A component is stored as little-endian

    AV_PIX_FMT_YVYU422,   ///< packed YUV 4:2:2, 16bpp, Y0 Cr Y1 Cb

    AV_PIX_FMT_YA16BE,       ///< 16 bits gray, 16 bits alpha (big-endian)
    AV_PIX_FMT_YA16LE,       ///< 16 bits gray, 16 bits alpha (little-endian)

    AV_PIX_FMT_GBRAP,        ///< planar GBRA 4:4:4:4 32bpp
    AV_PIX_FMT_GBRAP16BE,    ///< planar GBRA 4:4:4:4 64bpp, big-endian
    AV_PIX_FMT_GBRAP16LE,    ///< planar GBRA 4:4:4:4 64bpp, little-endian
    /**
     * HW acceleration through QSV, data[3] contains a pointer to the
     * mfxFrameSurface1 structure.
     *
     * Before FFmpeg 5.0:
     * mfxFrameSurface1.Data.MemId contains a pointer when importing
     * the following frames as QSV frames:
     *
     * VAAPI:
     * mfxFrameSurface1.Data.MemId contains a pointer to VASurfaceID
     *
     * DXVA2:
     * mfxFrameSurface1.Data.MemId contains a pointer to IDirect3DSurface9
     *
     * FFmpeg 5.0 and above:
     * mfxFrameSurface1.Data.MemId contains a pointer to the mfxHDLPair
     * structure when importing the following frames as QSV frames:
     *
     * VAAPI:
     * mfxHDLPair.first contains a VASurfaceID pointer.
     * mfxHDLPair.second is always MFX_INFINITE.
     *
     * DXVA2:
     * mfxHDLPair.first contains IDirect3DSurface9 pointer.
     * mfxHDLPair.second is always MFX_INFINITE.
     *
     * D3D11:
     * mfxHDLPair.first contains a ID3D11Texture2D pointer.
     * mfxHDLPair.second contains the texture array index of the frame if the
     * ID3D11Texture2D is an array texture, or always MFX_INFINITE if it is a
     * normal texture.
     */
    AV_PIX_FMT_QSV,
    /**
     * HW acceleration though MMAL, data[3] contains a pointer to the
     * MMAL_BUFFER_HEADER_T structure.
     */
    AV_PIX_FMT_MMAL,

    AV_PIX_FMT_D3D11VA_VLD,  ///< HW decoding through Direct3D11 via old API, Picture.data[3] contains a ID3D11VideoDecoderOutputView pointer

    /**
     * HW acceleration through CUDA. data[i] contain CUdeviceptr pointers
     * exactly as for system memory frames.
     */
    AV_PIX_FMT_CUDA,

    AV_PIX_FMT_0RGB,        ///< packed RGB 8:8:8, 32bpp, XRGBXRGB...   X=unused/undefined
    AV_PIX_FMT_RGB0,        ///< packed RGB 8:8:8, 32bpp, RGBXRGBX...   X=unused/undefined
    AV_PIX_FMT_0BGR,        ///< packed BGR 8:8:8, 32bpp, XBGRXBGR...   X=unused/undefined
    AV_PIX_FMT_BGR0,        ///< packed BGR 8:8:8, 32bpp, BGRXBGRX...   X=unused/undefined

    AV_PIX_FMT_YUV420P12BE, ///< planar YUV 4:2:0,18bpp, (1 Cr & Cb sample per 2x2 Y samples), big-endian
    AV_PIX_FMT_YUV420P12LE, ///< planar YUV 4:2:0,18bpp, (1 Cr & Cb sample per 2x2 Y samples), little-endian
    AV_PIX_FMT_YUV420P14BE, ///< planar YUV 4:2:0,21bpp, (1 Cr & Cb sample per 2x2 Y samples), big-endian
    AV_PIX_FMT_YUV420P14LE, ///< planar YUV 4:2:0,21bpp, (1 Cr & Cb sample per 2x2 Y samples), little-endian
    AV_PIX_FMT_YUV422P12BE, ///< planar YUV 4:2:2,24bpp, (1 Cr & Cb sample per 2x1 Y samples), big-endian
    AV_PIX_FMT_YUV422P12LE, ///< planar YUV 4:2:2,24bpp, (1 Cr & Cb sample per 2x1 Y samples), little-endian
    AV_PIX_FMT_YUV422P14BE, ///< planar YUV 4:2:2,28bpp, (1 Cr & Cb sample per 2x1 Y samples), big-endian
    AV_PIX_FMT_YUV422P14LE, ///< planar YUV 4:2:2,28bpp, (1 Cr & Cb sample per 2x1 Y samples), little-endian
    AV_PIX_FMT_YUV444P12BE, ///< planar YUV 4:4:4,36bpp, (1 Cr & Cb sample per 1x1 Y samples), big-endian
    AV_PIX_FMT_YUV444P12LE, ///< planar YUV 4:4:4,36bpp, (1 Cr & Cb sample per 1x1 Y samples), little-endian
    AV_PIX_FMT_YUV444P14BE, ///< planar YUV 4:4:4,42bpp, (1 Cr & Cb sample per 1x1 Y samples), big-endian
    AV_PIX_FMT_YUV444P14LE, ///< planar YUV 4:4:4,42bpp, (1 Cr & Cb sample per 1x1 Y samples), little-endian
    AV_PIX_FMT_GBRP12BE,    ///< planar GBR 4:4:4 36bpp, big-endian
    AV_PIX_FMT_GBRP12LE,    ///< planar GBR 4:4:4 36bpp, little-endian
    AV_PIX_FMT_GBRP14BE,    ///< planar GBR 4:4:4 42bpp, big-endian
    AV_PIX_FMT_GBRP14LE,    ///< planar GBR 4:4:4 42bpp, little-endian
    AV_PIX_FMT_YUVJ411P,    ///< planar YUV 4:1:1, 12bpp, (1 Cr & Cb sample per 4x1 Y samples) full scale (JPEG), deprecated in favor of AV_PIX_FMT_YUV411P and setting color_range

    AV_PIX_FMT_BAYER_BGGR8,    ///< bayer, BGBG..(odd line), GRGR..(even line), 8-bit samples
    AV_PIX_FMT_BAYER_RGGB8,    ///< bayer, RGRG..(odd line), GBGB..(even line), 8-bit samples
    AV_PIX_FMT_BAYER_GBRG8,    ///< bayer, GBGB..(odd line), RGRG..(even line), 8-bit samples
    AV_PIX_FMT_BAYER_GRBG8,    ///< bayer, GRGR..(odd line), BGBG..(even line), 8-bit samples
    AV_PIX_FMT_BAYER_BGGR16LE, ///< bayer, BGBG..(odd line), GRGR..(even line), 16-bit samples, little-endian
    AV_PIX_FMT_BAYER_BGGR16BE, ///< bayer, BGBG..(odd line), GRGR..(even line), 16-bit samples, big-endian
    AV_PIX_FMT_BAYER_RGGB16LE, ///< bayer, RGRG..(odd line), GBGB..(even line), 16-bit samples, little-endian
    AV_PIX_FMT_BAYER_RGGB16BE, ///< bayer, RGRG..(odd line), GBGB..(even line), 16-bit samples, big-endian
    AV_PIX_FMT_BAYER_GBRG16LE, ///< bayer, GBGB..(odd line), RGRG..(even line), 16-bit samples, little-endian
    AV_PIX_FMT_BAYER_GBRG16BE, ///< bayer, GBGB..(odd line), RGRG..(even line), 16-bit samples, big-endian
    AV_PIX_FMT_BAYER_GRBG16LE, ///< bayer, GRGR..(odd line), BGBG..(even line), 16-bit samples, little-endian
    AV_PIX_FMT_BAYER_GRBG16BE, ///< bayer, GRGR..(odd line), BGBG..(even line), 16-bit samples, big-endian

    AV_PIX_FMT_YUV440P10LE, ///< planar YUV 4:4:0,20bpp, (1 Cr & Cb sample per 1x2 Y samples), little-endian
    AV_PIX_FMT_YUV440P10BE, ///< planar YUV 4:4:0,20bpp, (1 Cr & Cb sample per 1x2 Y samples), big-endian
    AV_PIX_FMT_YUV440P12LE, ///< planar YUV 4:4:0,24bpp, (1 Cr & Cb sample per 1x2 Y samples), little-endian
    AV_PIX_FMT_YUV440P12BE, ///< planar YUV 4:4:0,24bpp, (1 Cr & Cb sample per 1x2 Y samples), big-endian
    AV_PIX_FMT_AYUV64LE,    ///< packed AYUV 4:4:4,64bpp (1 Cr & Cb sample per 1x1 Y & A samples), little-endian
    AV_PIX_FMT_AYUV64BE,    ///< packed AYUV 4:4:4,64bpp (1 Cr & Cb sample per 1x1 Y & A samples), big-endian

    AV_PIX_FMT_VIDEOTOOLBOX, ///< hardware decoding through Videotoolbox

    AV_PIX_FMT_P010LE, ///< like NV12, with 10bpp per component, data in the high bits, zeros in the low bits, little-endian
    AV_PIX_FMT_P010BE, ///< like NV12, with 10bpp per component, data in the high bits, zeros in the low bits, big-endian

    AV_PIX_FMT_GBRAP12BE,  ///< planar GBR 4:4:4:4 48bpp, big-endian
    AV_PIX_FMT_GBRAP12LE,  ///< planar GBR 4:4:4:4 48bpp, little-endian

    AV_PIX_FMT_GBRAP10BE,  ///< planar GBR 4:4:4:4 40bpp, big-endian
    AV_PIX_FMT_GBRAP10LE,  ///< planar GBR 4:4:4:4 40bpp, little-endian

    AV_PIX_FMT_MEDIACODEC, ///< hardware decoding through MediaCodec

    AV_PIX_FMT_GRAY12BE,   ///<        Y        , 12bpp, big-endian
    AV_PIX_FMT_GRAY12LE,   ///<        Y        , 12bpp, little-endian
    AV_PIX_FMT_GRAY10BE,   ///<        Y        , 10bpp, big-endian
    AV_PIX_FMT_GRAY10LE,   ///<        Y        , 10bpp, little-endian

    AV_PIX_FMT_P016LE, ///< like NV12, with 16bpp per component, little-endian
    AV_PIX_FMT_P016BE, ///< like NV12, with 16bpp per component, big-endian

    /**
     * Hardware surfaces for Direct3D11.
     *
     * This is preferred over the legacy AV_PIX_FMT_D3D11VA_VLD. The new D3D11
     * hwaccel API and filtering support AV_PIX_FMT_D3D11 only.
     *
     * data[0] contains a ID3D11Texture2D pointer, and data[1] contains the
     * texture array index of the frame as intptr_t if the ID3D11Texture2D is
     * an array texture (or always 0 if it's a normal texture).
     */
    V_PIX_FMT_D3D11,

    AV_PIX_FMT_GRAY9BE,   ///<        Y        , 9bpp, big-endian
    AV_PIX_FMT_GRAY9LE,   ///<        Y        , 9bpp, little-endian

    AV_PIX_FMT_GBRPF32BE,  ///< IEEE-754 single precision planar GBR 4:4:4,     96bpp, big-endian
    AV_PIX_FMT_GBRPF32LE,  ///< IEEE-754 single precision planar GBR 4:4:4,     96bpp, little-endian
    AV_PIX_FMT_GBRAPF32BE, ///< IEEE-754 single precision planar GBRA 4:4:4:4, 128bpp, big-endian
    AV_PIX_FMT_GBRAPF32LE, ///< IEEE-754 single precision planar GBRA 4:4:4:4, 128bpp, little-endian

    /**
     * DRM-managed buffers exposed through PRIME buffer sharing.
     *
     * data[0] points to an AVDRMFrameDescriptor.
     */
    AV_PIX_FMT_DRM_PRIME,
    /**
     * Hardware surfaces for OpenCL.
     *
     * data[i] contain 2D image objects (typed in C as cl_mem, used
     * in OpenCL as image2d_t) for each plane of the surface.
     */
    AV_PIX_FMT_OPENCL,

    AV_PIX_FMT_GRAY14BE,   ///<        Y        , 14bpp, big-endian
    AV_PIX_FMT_GRAY14LE,   ///<        Y        , 14bpp, little-endian

    AV_PIX_FMT_GRAYF32BE,  ///< IEEE-754 single precision Y, 32bpp, big-endian
    AV_PIX_FMT_GRAYF32LE,  ///< IEEE-754 single precision Y, 32bpp, little-endian

    AV_PIX_FMT_YUVA422P12BE, ///< planar YUV 4:2:2,24bpp, (1 Cr & Cb sample per 2x1 Y samples), 12b alpha, big-endian
    AV_PIX_FMT_YUVA422P12LE, ///< planar YUV 4:2:2,24bpp, (1 Cr & Cb sample per 2x1 Y samples), 12b alpha, little-endian
    AV_PIX_FMT_YUVA444P12BE, ///< planar YUV 4:4:4,36bpp, (1 Cr & Cb sample per 1x1 Y samples), 12b alpha, big-endian
    AV_PIX_FMT_YUVA444P12LE, ///< planar YUV 4:4:4,36bpp, (1 Cr & Cb sample per 1x1 Y samples), 12b alpha, little-endian

    AV_PIX_FMT_NV24,      ///< planar YUV 4:4:4, 24bpp, 1 plane for Y and 1 plane for the UV components, which are interleaved (first byte U and the following byte V)
    AV_PIX_FMT_NV42,      ///< as above, but U and V bytes are swapped

    /**
     * Vulkan hardware images.
     *
     * data[0] points to an AVVkFrame
     */
    V_PIX_FMT_VULKAN,

    AV_PIX_FMT_Y210BE,    ///< packed YUV 4:2:2 like YUYV422, 20bpp, data in the high bits, big-endian
    AV_PIX_FMT_Y210LE,    ///< packed YUV 4:2:2 like YUYV422, 20bpp, data in the high bits, little-endian

    AV_PIX_FMT_X2RGB10LE, ///< packed RGB 10:10:10, 30bpp, (msb)2X 10R 10G 10B(lsb), little-endian, X=unused/undefined
    AV_PIX_FMT_X2RGB10BE, ///< packed RGB 10:10:10, 30bpp, (msb)2X 10R 10G 10B(lsb), big-endian, X=unused/undefined
    AV_PIX_FMT_X2BGR10LE, ///< packed BGR 10:10:10, 30bpp, (msb)2X 10B 10G 10R(lsb), little-endian, X=unused/undefined
    AV_PIX_FMT_X2BGR10BE, ///< packed BGR 10:10:10, 30bpp, (msb)2X 10B 10G 10R(lsb), big-endian, X=unused/undefined

    AV_PIX_FMT_P210BE,      ///< interleaved chroma YUV 4:2:2, 20bpp, data in the high bits, big-endian
    AV_PIX_FMT_P210LE,      ///< interleaved chroma YUV 4:2:2, 20bpp, data in the high bits, little-endian

    AV_PIX_FMT_P410BE,      ///< interleaved chroma YUV 4:4:4, 30bpp, data in the high bits, big-endian
    AV_PIX_FMT_P410LE,      ///< interleaved chroma YUV 4:4:4, 30bpp, data in the high bits, little-endian

    AV_PIX_FMT_P216BE,      ///< interleaved chroma YUV 4:2:2, 32bpp, big-endian
    AV_PIX_FMT_P216LE,      ///< interleaved chroma YUV 4:2:2, 32bpp, little-endian

    AV_PIX_FMT_P416BE,      ///< interleaved chroma YUV 4:4:4, 48bpp, big-endian
    AV_PIX_FMT_P416LE,      ///< interleaved chroma YUV 4:4:4, 48bpp, little-endian

    AV_PIX_FMT_VUYA,        ///< packed VUYA 4:4:4:4, 32bpp (1 Cr & Cb sample per 1x1 Y & A samples), VUYAVUYA...

    AV_PIX_FMT_RGBAF16BE,   ///< IEEE-754 half precision packed RGBA 16:16:16:16, 64bpp, RGBARGBA..., big-endian
    AV_PIX_FMT_RGBAF16LE,   ///< IEEE-754 half precision packed RGBA 16:16:16:16, 64bpp, RGBARGBA..., little-endian

    AV_PIX_FMT_VUYX,        ///< packed VUYX 4:4:4:4, 32bpp, Variant of VUYA where alpha channel is left undefined

    AV_PIX_FMT_P012LE,      ///< like NV12, with 12bpp per component, data in the high bits, zeros in the low bits, little-endian
    AV_PIX_FMT_P012BE,      ///< like NV12, with 12bpp per component, data in the high bits, zeros in the low bits, big-endian

    AV_PIX_FMT_Y212BE,      ///< packed YUV 4:2:2 like YUYV422, 24bpp, data in the high bits, zeros in the low bits, big-endian
    AV_PIX_FMT_Y212LE,      ///< packed YUV 4:2:2 like YUYV422, 24bpp, data in the high bits, zeros in the low bits, little-endian

    AV_PIX_FMT_XV30BE,      ///< packed XVYU 4:4:4, 32bpp, (msb)2X 10V 10Y 10U(lsb), big-endian, variant of Y410 where alpha channel is left undefined
    AV_PIX_FMT_XV30LE,      ///< packed XVYU 4:4:4, 32bpp, (msb)2X 10V 10Y 10U(lsb), little-endian, variant of Y410 where alpha channel is left undefined

    AV_PIX_FMT_XV36BE,      ///< packed XVYU 4:4:4, 48bpp, data in the high bits, zeros in the low bits, big-endian, variant of Y412 where alpha channel is left undefined
    AV_PIX_FMT_XV36LE,      ///< packed XVYU 4:4:4, 48bpp, data in the high bits, zeros in the low bits, little-endian, variant of Y412 where alpha channel is left undefined

    AV_PIX_FMT_RGBF32BE,    ///< IEEE-754 single precision packed RGB 32:32:32, 96bpp, RGBRGB..., big-endian
    AV_PIX_FMT_RGBF32LE,    ///< IEEE-754 single precision packed RGB 32:32:32, 96bpp, RGBRGB..., little-endian

    AV_PIX_FMT_RGBAF32BE,   ///< IEEE-754 single precision packed RGBA 32:32:32:32, 128bpp, RGBARGBA..., big-endian
    AV_PIX_FMT_RGBAF32LE,   ///< IEEE-754 single precision packed RGBA 32:32:32:32, 128bpp, RGBARGBA..., little-endian

    AV_PIX_FMT_P212BE,      ///< interleaved chroma YUV 4:2:2, 24bpp, data in the high bits, big-endian
    AV_PIX_FMT_P212LE,      ///< interleaved chroma YUV 4:2:2, 24bpp, data in the high bits, little-endian

    AV_PIX_FMT_P412BE,      ///< interleaved chroma YUV 4:4:4, 36bpp, data in the high bits, big-endian
    AV_PIX_FMT_P412LE,      ///< interleaved chroma YUV 4:4:4, 36bpp, data in the high bits, little-endian

    AV_PIX_FMT_GBRAP14BE,  ///< planar GBR 4:4:4:4 56bpp, big-endian
    AV_PIX_FMT_GBRAP14LE,  ///< planar GBR 4:4:4:4 56bpp, little-endian

    /**
     * Hardware surfaces for Direct3D 12.
     *
     * data[0] points to an AVD3D12VAFrame
     */
    AV_PIX_FMT_D3D12,

    AV_PIX_FMT_AYUV,        ///< packed AYUV 4:4:4:4, 32bpp (1 Cr & Cb sample per 1x1 Y & A samples), AYUVAYUV...

    AV_PIX_FMT_UYVA,        ///< packed UYVA 4:4:4:4, 32bpp (1 Cr & Cb sample per 1x1 Y & A samples), UYVAUYVA...

    AV_PIX_FMT_VYU444,      ///< packed VYU 4:4:4, 24bpp (1 Cr & Cb sample per 1x1 Y), VYUVYU...

    AV_PIX_FMT_V30XBE,      ///< packed VYUX 4:4:4 like XV30, 32bpp, (msb)10V 10Y 10U 2X(lsb), big-endian
    AV_PIX_FMT_V30XLE,      ///< packed VYUX 4:4:4 like XV30, 32bpp, (msb)10V 10Y 10U 2X(lsb), little-endian

    AV_PIX_FMT_RGBF16BE,    ///< IEEE-754 half precision packed RGB 16:16:16, 48bpp, RGBRGB..., big-endian
    AV_PIX_FMT_RGBF16LE,    ///< IEEE-754 half precision packed RGB 16:16:16, 48bpp, RGBRGB..., little-endian

    AV_PIX_FMT_RGBA128BE,   ///< packed RGBA 32:32:32:32, 128bpp, RGBARGBA..., big-endian
    AV_PIX_FMT_RGBA128LE,   ///< packed RGBA 32:32:32:32, 128bpp, RGBARGBA..., little-endian

    AV_PIX_FMT_RGB96BE,     ///< packed RGBA 32:32:32, 96bpp, RGBRGB..., big-endian
    AV_PIX_FMT_RGB96LE,     ///< packed RGBA 32:32:32, 96bpp, RGBRGB..., little-endian

    AV_PIX_FMT_Y216BE,      ///< packed YUV 4:2:2 like YUYV422, 32bpp, big-endian
    AV_PIX_FMT_Y216LE,      ///< packed YUV 4:2:2 like YUYV422, 32bpp, little-endian

    AV_PIX_FMT_XV48BE,      ///< packed XVYU 4:4:4, 64bpp, big-endian, variant of Y416 where alpha channel is left undefined
    AV_PIX_FMT_XV48LE,      ///< packed XVYU 4:4:4, 64bpp, little-endian, variant of Y416 where alpha channel is left undefined

    AV_PIX_FMT_GBRPF16BE,  ///< IEEE-754 half precision planer GBR 4:4:4, 48bpp, big-endian
    AV_PIX_FMT_GBRPF16LE,  ///< IEEE-754 half precision planer GBR 4:4:4, 48bpp, little-endian
    AV_PIX_FMT_GBRAPF16BE, ///< IEEE-754 half precision planar GBRA 4:4:4:4, 64bpp, big-endian
    AV_PIX_FMT_GBRAPF16LE, ///< IEEE-754 half precision planar GBRA 4:4:4:4, 64bpp, little-endian

    AV_PIX_FMT_GRAYF16BE,  ///< IEEE-754 half precision Y, 16bpp, big-endian
    AV_PIX_FMT_GRAYF16LE,  ///< IEEE-754 half precision Y, 16bpp, little-endian

    /**
     * HW acceleration through AMF. data[0] contain AMFSurface pointer
     */
    AV_PIX_FMT_AMF_SURFACE,

    AV_PIX_FMT_GRAY32BE,    ///<         Y        , 32bpp, big-endian
    AV_PIX_FMT_GRAY32LE,    ///<         Y        , 32bpp, little-endian

    AV_PIX_FMT_YAF32BE,  ///< IEEE-754 single precision packed YA, 32 bits gray, 32 bits alpha, 64bpp, big-endian
    AV_PIX_FMT_YAF32LE,  ///< IEEE-754 single precision packed YA, 32 bits gray, 32 bits alpha, 64bpp, little-endian

    AV_PIX_FMT_YAF16BE,  ///< IEEE-754 half precision packed YA, 16 bits gray, 16 bits alpha, 32bpp, big-endian
    AV_PIX_FMT_YAF16LE,  ///< IEEE-754 half precision packed YA, 16 bits gray, 16 bits alpha, 32bpp, little-endian

    AV_PIX_FMT_GBRAP32BE,   ///< planar GBRA 4:4:4:4 128bpp, big-endian
    AV_PIX_FMT_GBRAP32LE,   ///< planar GBRA 4:4:4:4 128bpp, little-endian

    AV_PIX_FMT_NB         ///< number of pixel formats, DO NOT USE THIS if you want to link with shared libav* because the number of formats might differ between versions
};


export enum AVPictureType {
    AV_PICTURE_TYPE_NONE = 0, ///< Undefined
    AV_PICTURE_TYPE_I,     ///< Intra
    AV_PICTURE_TYPE_P,     ///< Predicted
    AV_PICTURE_TYPE_B,     ///< Bi-dir predicted
    AV_PICTURE_TYPE_S,     ///< S(GMC)-VOP MPEG-4
    AV_PICTURE_TYPE_SI,    ///< Switching Intra
    AV_PICTURE_TYPE_SP,    ///< Switching Predicted
    AV_PICTURE_TYPE_BI,    ///< BI type
};


export enum AVLogLevel {
    /**
     * Print no output.
     */
    AV_LOG_QUIET = -8,

    /**
     * Something went really wrong and we will crash now.
     */
    AV_LOG_PANIC = 0,

    /**
     * Something went wrong and recovery is not possible.
     * For example, no header was found for a format which depends
     * on headers or an illegal combination of parameters is used.
     */
    AV_LOG_FATAL = 8,

    /**
     * Something went wrong and cannot losslessly be recovered.
     * However, not all future data is affected.
     */
    AV_LOG_ERROR = 16,

    /**
     * Something somehow does not look correct. This may or may not
     * lead to problems. An example would be the use of '-vstrict -2'.
     */
    AV_LOG_WARNING = 24,

    /**
     * Standard information.
     */
    AV_LOG_INFO = 32,

    /**
     * Detailed information.
     */
    AV_LOG_VERBOSE = 40,

    /**
     * Stuff which is only useful for libav* developers.
     */
    AV_LOG_DEBUG = 48,

    /**
     * Extremely verbose debugging, useful for libav* development.
     */
    AV_LOG_TRACE = 56,
}

export enum Dispositions {
    /**
     * The stream should be chosen by default among other streams of the same type,
     * unless the user has explicitly specified otherwise.
     */
    AV_DISPOSITION_DEFAULT = 1 << 0,
    /**
     * The stream is not in original language.
     *
     * @note AV_DISPOSITION_ORIGINAL is the inverse of this disposition. At most
     *       one of them should be set in properly tagged streams.
     * @note This disposition may apply to any stream type, not just audio.
     */
    AV_DISPOSITION_DUB = 1 << 1,
    /**
     * The stream is in original language.
     *
     * @see the notes for AV_DISPOSITION_DUB
     */
    AV_DISPOSITION_ORIGINAL = 1 << 2,
    /**
     * The stream is a commentary track.
     */
    AV_DISPOSITION_COMMENT = 1 << 3,
    /**
     * The stream contains song lyrics.
     */
    AV_DISPOSITION_LYRICS = 1 << 4,
    /**
     * The stream contains karaoke audio.
     */
    AV_DISPOSITION_KARAOKE = 1 << 5,

    /**
     * Track should be used during playback by default.
     * Useful for subtitle track that should be displayed
     * even when user did not explicitly ask for subtitles.
     */
    AV_DISPOSITION_FORCED = 1 << 6,
    /**
     * The stream is intended for hearing impaired audiences.
     */
    AV_DISPOSITION_HEARING_IMPAIRED = 1 << 7,
    /**
     * The stream is intended for visually impaired audiences.
     */
    AV_DISPOSITION_VISUAL_IMPAIRED = 1 << 8,
    /**
     * The audio stream contains music and sound effects without voice.
     */
    AV_DISPOSITION_CLEAN_EFFECTS = 1 << 9,
    /**
     * The stream is stored in the file as an attached picture/"cover art" (e.g.
     * APIC frame in ID3v2). The first (usually only) packet associated with it
     * will be returned among the first few packets read from the file unless
     * seeking takes place. It can also be accessed at any time in
     * AVStream.attached_pic.
     */
    AV_DISPOSITION_ATTACHED_PIC = 1 << 10,
    /**
     * The stream is sparse, and contains thumbnail images, often corresponding
     * to chapter markers. Only ever used with AV_DISPOSITION_ATTACHED_PIC.
     */
    AV_DISPOSITION_TIMED_THUMBNAILS = 1 << 11,

    /**
     * The stream is intended to be mixed with a spatial audio track. For example,
     * it could be used for narration or stereo music, and may remain unchanged by
     * listener head rotation.
     */
    AV_DISPOSITION_NON_DIEGETIC = 1 << 12,

    /**
     * The subtitle stream contains captions, providing a transcription and possibly
     * a translation of audio. Typically intended for hearing-impaired audiences.
     */
    AV_DISPOSITION_CAPTIONS = 1 << 16,
    /**
     * The subtitle stream contains a textual description of the video content.
     * Typically intended for visually-impaired audiences or for the cases where the
     * video cannot be seen.
     */
    AV_DISPOSITION_DESCRIPTIONS = 1 << 17,
    /**
     * The subtitle stream contains time-aligned metadata that is not intended to be
     * directly presented to the user.
     */
    AV_DISPOSITION_METADATA = 1 << 18,
    /**
     * The stream is intended to be mixed with another stream before presentation.
     * Used for example to signal the stream contains an image part of a HEIF grid,
     * or for mix_type=0 in mpegts.
     */
    AV_DISPOSITION_DEPENDENT = 1 << 19,
    /**
     * The video stream contains still images.
     */
    AV_DISPOSITION_STILL_IMAGE = 1 << 20,
    /**
     * The video stream contains multiple layers, e.g. stereoscopic views (cf. H.264
     * Annex G/H, or HEVC Annex F).
     */
    AV_DISPOSITION_MULTILAYER = 1 << 21,
}