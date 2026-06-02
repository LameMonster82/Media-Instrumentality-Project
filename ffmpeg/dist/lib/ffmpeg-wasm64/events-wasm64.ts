export enum EventType {
  EVENT_NONE = 0,
  EVENT_VIDEO_CONFIG = 1,
  EVENT_AUDIO_CONFIG = 2,
  EVENT_SUBTITLE_CONFIG = 3,
  EVENT_VIDEO_FRAME = 4,
  EVENT_AUDIO_FRAME = 5,
  EVENT_RAW_PACKET = 6,
  EVENT_SUBTITLE_BITMAP = 7,
  EVENT_SUBTITLE_ASS = 8,
  EVENT_SUBTITLE_EMPTY = 9,
  EVENT_FILE_INFO = 10,
  EVENT_CHAPTER_INFO = 11,
  EVENT_ATTACHMENT = 12,
  EVENT_DEMUXERS = 13,
  EVENT_IO_READ = 14,
  EVENT_IO_SEEK = 15,
  EVENT_QUERY_STREAM = 16,
  EVENT_THUMBNAIL = 17,
}

export enum ActionResult {
  RESULT_OK = 0,
  RESULT_NEED_MORE = 1,
  RESULT_EOF = 2,
  RESULT_RAW_PACKET = 10,
  RESULT_ERR_GENERIC = -1,
  RESULT_ERR_SKIP = -3,
}

/** Total struct size: 8 bytes, alignment: 4 */
export interface IOReadEvent {
  /** offset: 0, size: 4 */
  buffer: number;
  /** offset: 4, size: 4 */
  buf_size: number;
}

export const IOReadEventOffsets = {
  buffer: 0,
  buf_size: 4,
} as const;

export const IOReadEventSize = 8;

/** Total struct size: 16 bytes, alignment: 8 */
export interface IOSeekEvent {
  /** offset: 0, size: 8 */
  offset: bigint;
  /** offset: 8, size: 4 */
  whence: number;
}

export const IOSeekEventOffsets = {
  offset: 0,
  whence: 8,
} as const;

export const IOSeekEventSize = 16;

/** Total struct size: 4 bytes, alignment: 4 */
export interface QueryStreamEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
}

export const QueryStreamEventOffsets = {
  stream_index: 0,
} as const;

export const QueryStreamEventSize = 4;

/** Total struct size: 304 bytes, alignment: 8 */
export interface VideoConfigEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 4, size: 256 */
  codec: Uint8Array;
  /** offset: 260, size: 4 */
  coded_width: number;
  /** offset: 264, size: 4 */
  coded_height: number;
  /** offset: 268, size: 4 */
  description: number;
  /** offset: 272, size: 4 */
  description_size: number;
  /** offset: 280, size: 8 */
  duration: number;
  /** offset: 288, size: 4 */
  color_range: number;
  /** offset: 292, size: 4 */
  color_space: number;
  /** offset: 296, size: 4 */
  color_primaries: number;
  /** offset: 300, size: 4 */
  color_transfer: number;
}

export const VideoConfigEventOffsets = {
  stream_index: 0,
  codec: 4,
  coded_width: 260,
  coded_height: 264,
  description: 268,
  description_size: 272,
  duration: 280,
  color_range: 288,
  color_space: 292,
  color_primaries: 296,
  color_transfer: 300,
} as const;

export const VideoConfigEventSize = 304;

/** Total struct size: 288 bytes, alignment: 8 */
export interface AudioConfigEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 4, size: 256 */
  codec: Uint8Array;
  /** offset: 260, size: 4 */
  sample_rate: number;
  /** offset: 264, size: 4 */
  num_channels: number;
  /** offset: 268, size: 4 */
  description: number;
  /** offset: 272, size: 4 */
  description_size: number;
  /** offset: 280, size: 8 */
  duration: number;
}

export const AudioConfigEventOffsets = {
  stream_index: 0,
  codec: 4,
  sample_rate: 260,
  num_channels: 264,
  description: 268,
  description_size: 272,
  duration: 280,
} as const;

export const AudioConfigEventSize = 288;

/** Total struct size: 16 bytes, alignment: 4 */
export interface SubtitleConfigEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 4, size: 4 */
  duration: number;
  /** offset: 8, size: 4 */
  header_ptr: number;
  /** offset: 12, size: 4 */
  header_size: number;
}

export const SubtitleConfigEventOffsets = {
  stream_index: 0,
  duration: 4,
  header_ptr: 8,
  header_size: 12,
} as const;

export const SubtitleConfigEventSize = 16;

/** Total struct size: 32 bytes, alignment: 8 */
export interface RawPacketEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 4, size: 4 */
  flags: number;
  /** offset: 8, size: 8 */
  ts_js: number;
  /** offset: 16, size: 8 */
  dur_js: number;
  /** offset: 24, size: 4 */
  data: number;
  /** offset: 28, size: 4 */
  data_size: number;
}

export const RawPacketEventOffsets = {
  stream_index: 0,
  flags: 4,
  ts_js: 8,
  dur_js: 16,
  data: 24,
  data_size: 28,
} as const;

export const RawPacketEventSize = 32;

/** Total struct size: 168 bytes, alignment: 8 */
export interface VideoFrameEvent {
  /** offset: 0, size: 4 */
  width: number;
  /** offset: 4, size: 4 */
  height: number;
  /** offset: 8, size: 4 */
  crop_top: number;
  /** offset: 12, size: 4 */
  crop_bottom: number;
  /** offset: 16, size: 4 */
  crop_left: number;
  /** offset: 20, size: 4 */
  crop_right: number;
  /** offset: 24, size: 4 */
  format: number;
  /** offset: 28, size: 4 */
  key_frame: number;
  /** offset: 32, size: 4 */
  pict_type: number;
  /** offset: 40, size: 8 */
  pts: bigint;
  /** offset: 48, size: 8 */
  ts_js: number;
  /** offset: 56, size: 4 */
  time_base_num: number;
  /** offset: 60, size: 4 */
  time_base_den: number;
  /** offset: 64, size: 8 */
  duration: bigint;
  /** offset: 72, size: 8 */
  dur_js: number;
  /** offset: 80, size: 32 */
  src_data: Array<number>;
  /** offset: 112, size: 32 */
  src_linesize: Array<number>;
  /** offset: 144, size: 4 */
  color_range: number;
  /** offset: 148, size: 4 */
  color_space: number;
  /** offset: 152, size: 4 */
  color_primaries: number;
  /** offset: 156, size: 4 */
  color_transfer: number;
  /** offset: 160, size: 4 */
  stream_index: number;
}

export const VideoFrameEventOffsets = {
  width: 0,
  height: 4,
  crop_top: 8,
  crop_bottom: 12,
  crop_left: 16,
  crop_right: 20,
  format: 24,
  key_frame: 28,
  pict_type: 32,
  pts: 40,
  ts_js: 48,
  time_base_num: 56,
  time_base_den: 60,
  duration: 64,
  dur_js: 72,
  src_data: 80,
  src_linesize: 112,
  color_range: 144,
  color_space: 148,
  color_primaries: 152,
  color_transfer: 156,
  stream_index: 160,
} as const;

export const VideoFrameEventSize = 168;

/** Total struct size: 40 bytes, alignment: 8 */
export interface AudioFrameEvent {
  /** offset: 0, size: 4 */
  channels: number;
  /** offset: 4, size: 4 */
  samples: number;
  /** offset: 8, size: 4 */
  sample_rate: number;
  /** offset: 12, size: 4 */
  data: number;
  /** offset: 16, size: 4 */
  bytes_per_sample: number;
  /** offset: 24, size: 8 */
  ts_js: number;
  /** offset: 32, size: 4 */
  stream_index: number;
}

export const AudioFrameEventOffsets = {
  channels: 0,
  samples: 4,
  sample_rate: 8,
  data: 12,
  bytes_per_sample: 16,
  ts_js: 24,
  stream_index: 32,
} as const;

export const AudioFrameEventSize = 40;

/** Total struct size: 56 bytes, alignment: 8 */
export interface SubtitleBitmapEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 4, size: 4 */
  data: number;
  /** offset: 8, size: 4 */
  data_size: number;
  /** offset: 12, size: 4 */
  x: number;
  /** offset: 16, size: 4 */
  y: number;
  /** offset: 20, size: 4 */
  width: number;
  /** offset: 24, size: 4 */
  height: number;
  /** offset: 32, size: 8 */
  ts_js: bigint;
  /** offset: 40, size: 8 */
  dur_js: bigint;
  /** offset: 48, size: 4 */
  coded_width: number;
  /** offset: 52, size: 4 */
  coded_height: number;
}

export const SubtitleBitmapEventOffsets = {
  stream_index: 0,
  data: 4,
  data_size: 8,
  x: 12,
  y: 16,
  width: 20,
  height: 24,
  ts_js: 32,
  dur_js: 40,
  coded_width: 48,
  coded_height: 52,
} as const;

export const SubtitleBitmapEventSize = 56;

/** Total struct size: 24 bytes, alignment: 8 */
export interface SubtitleAssEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 4, size: 4 */
  dialog: number;
  /** offset: 8, size: 8 */
  start_time: bigint;
  /** offset: 16, size: 8 */
  end_time: bigint;
}

export const SubtitleAssEventOffsets = {
  stream_index: 0,
  dialog: 4,
  start_time: 8,
  end_time: 16,
} as const;

export const SubtitleAssEventSize = 24;

/** Total struct size: 16 bytes, alignment: 8 */
export interface SubtitleEmptyEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 8, size: 8 */
  ts_js: bigint;
}

export const SubtitleEmptyEventOffsets = {
  stream_index: 0,
  ts_js: 8,
} as const;

export const SubtitleEmptyEventSize = 16;

/** Total struct size: 16 bytes, alignment: 4 */
export interface MetadataEvent {
  /** offset: 0, size: 4 */
  stream_index: number;
  /** offset: 4, size: 4 */
  keys: number;
  /** offset: 8, size: 4 */
  values: number;
  /** offset: 12, size: 4 */
  count: number;
}

export const MetadataEventOffsets = {
  stream_index: 0,
  keys: 4,
  values: 8,
  count: 12,
} as const;

export const MetadataEventSize = 16;

/** Total struct size: 40 bytes, alignment: 8 */
export interface ChapterInfoEvent {
  /** offset: 0, size: 4 */
  chapter_index: number;
  /** offset: 8, size: 8 */
  start_js: bigint;
  /** offset: 16, size: 8 */
  end_js: bigint;
  /** offset: 24, size: 4 */
  keys: number;
  /** offset: 28, size: 4 */
  values: number;
  /** offset: 32, size: 4 */
  count: number;
}

export const ChapterInfoEventOffsets = {
  chapter_index: 0,
  start_js: 8,
  end_js: 16,
  keys: 24,
  values: 28,
  count: 32,
} as const;

export const ChapterInfoEventSize = 40;

/** Total struct size: 20 bytes, alignment: 4 */
export interface AttachmentEvent {
  /** offset: 0, size: 4 */
  keys: number;
  /** offset: 4, size: 4 */
  values: number;
  /** offset: 8, size: 4 */
  count: number;
  /** offset: 12, size: 4 */
  data: number;
  /** offset: 16, size: 4 */
  data_size: number;
}

export const AttachmentEventOffsets = {
  keys: 0,
  values: 4,
  count: 8,
  data: 12,
  data_size: 16,
} as const;

export const AttachmentEventSize = 20;

/** Total struct size: 20 bytes, alignment: 4 */
export interface DemuxersEvent {
  /** offset: 0, size: 4 */
  extensions: number;
  /** offset: 4, size: 4 */
  long_names: number;
  /** offset: 8, size: 4 */
  mime_types: number;
  /** offset: 12, size: 4 */
  names: number;
  /** offset: 16, size: 4 */
  count: number;
}

export const DemuxersEventOffsets = {
  extensions: 0,
  long_names: 4,
  mime_types: 8,
  names: 12,
  count: 16,
} as const;

export const DemuxersEventSize = 20;

/** Total struct size: 24 bytes, alignment: 4 */
export interface ThumbnailEvent {
  /** offset: 0, size: 4 */
  is_raw: number;
  /** offset: 4, size: 4 */
  data: number;
  /** offset: 8, size: 4 */
  data_size: number;
  /** offset: 12, size: 4 */
  width: number;
  /** offset: 16, size: 4 */
  height: number;
  /** offset: 20, size: 4 */
  format: number;
}

export const ThumbnailEventOffsets = {
  is_raw: 0,
  data: 4,
  data_size: 8,
  width: 12,
  height: 16,
  format: 20,
} as const;

export const ThumbnailEventSize = 24;