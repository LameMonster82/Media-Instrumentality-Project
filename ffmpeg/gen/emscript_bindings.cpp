#include <emscripten/bind.h>
#include <libavutil/dict.h>

#ifdef __cplusplus
extern "C" {
#endif
#include "context.h"
#include "demuxers.h"
#ifdef __cplusplus
}
#endif

using namespace emscripten;

EMSCRIPTEN_BINDINGS(demuxer_types) {

    // ---------- Enums ----------
    enum_<MediaType>("MediaType")
        .value("RESULT_VIDEO", RESULT_VIDEO)
        .value("RESULT_AUDIO", RESULT_AUDIO)
        .value("RESULT_SUBTITLE", RESULT_SUBTITLE)
        .value("RESULT_PACKET", RESULT_PACKET);

    // Status constants
    constant("RESULT_OK", RESULT_OK);
    constant("RESULT_NEED_MORE", RESULT_NEED_MORE);
    constant("RESULT_EOF", RESULT_EOF);
    constant("RESULT_RAW_PACKET", RESULT_RAW_PACKET);
    constant("RESULT_ERR_GENERIC", RESULT_ERR_GENERIC);
    constant("RESULT_ERR_SKIP", RESULT_ERR_SKIP);
    constant("RESULT_UNREACHABLE", RESULT_UNREACHABLE);

    constant("STREAM_HW_SUPPORT", STREAM_HW_SUPPORT);
    constant("STREAM_SW_SUPPORT", STREAM_SW_SUPPORT);
    constant("STREAM_UNUSED", STREAM_UNUSED);
    constant("STREAM_NO_SUPPORT", STREAM_NO_SUPPORT);

    // ---------- Structs ----------
    // ChapterInfo
    value_object<ChapterInfo>("ChapterInfo")
        .field("id", &ChapterInfo::id)
        .field("start", &ChapterInfo::start)
        .field("end", &ChapterInfo::end)
        .field("metadata",&ChapterInfo::metadata);   // raw pointer to AVDictionary

    // StreamInfo
    value_object<StreamInfo>("StreamInfo")
        .field("type", &StreamInfo::type)
        .field("duration", &StreamInfo::duration)
        .field("video_config", &StreamInfo::video_config)
        .field("audio_config", &StreamInfo::audio_config)
        .field("subtitle_config", &StreamInfo::subtitle_config)
        .field("metadata", &StreamInfo::metadata);

    // FileInfo
    value_object<FileInfo>("FileInfo")
        .field("duration", &FileInfo::duration)
        .field("start_time", &FileInfo::start_time)
        .field("bitrate", &FileInfo::bitrate)
        .field("nb_stream_groups", &FileInfo::nb_stream_groups)
        .field("nb_chapters", &FileInfo::nb_chapters)
        .field("nb_streams", &FileInfo::nb_streams)
        .field("metadata", &FileInfo::metadata)
        .field("chapters", &FileInfo::chapters)   // points to array of ChapterInfo
        .field("streams", &FileInfo::streams);    // points to array of StreamInfo

    // VideoFrame (without AVFrame)
    value_object<VideoFrame>("VideoFrame")
        .field("width", &VideoFrame::width)
        .field("height", &VideoFrame::height)
        .field("crop_top", &VideoFrame::crop_top)
        .field("crop_bottom", &VideoFrame::crop_bottom)
        .field("crop_left", &VideoFrame::crop_left)
        .field("crop_right", &VideoFrame::crop_right)
        .field("format", &VideoFrame::format)
        .field("key_frame", &VideoFrame::key_frame)
        .field("pict_type", &VideoFrame::pict_type)
        .field("pts", &VideoFrame::pts)
        .field("ts_js", &VideoFrame::ts_js)
        .field("time_base_num", &VideoFrame::time_base_num)
        .field("time_base_den", &VideoFrame::time_base_den)
        .field("duration", &VideoFrame::duration)
        .field("dur_js", &VideoFrame::dur_js)
        .field("src_data", &VideoFrame::src_data)           // array of 8 pointers
        .field("src_linesize", &VideoFrame::src_linesize)   // array of 8 ints
        .field("color_range", &VideoFrame::color_range)
        .field("color_space", &VideoFrame::color_space)
        .field("color_primaries", &VideoFrame::color_primaries)
        .field("color_transfer", &VideoFrame::color_transfer)
        .field("stream_index", &VideoFrame::stream_index);
    // .field("frame", ...) intentionally omitted (AVFrame*)

    // AudioFrame (without AVFrame)
    value_object<AudioFrame>("AudioFrame")
        .field("channels", &AudioFrame::channels)
        .field("samples", &AudioFrame::samples)
        .field("sample_rate", &AudioFrame::sample_rate)
        .field("data", &AudioFrame::data)   // pointer to uint8_t
        .field("bytes_per_sample", &AudioFrame::bytes_per_sample)
        .field("ts_js", &AudioFrame::ts_js)
        .field("stream_index", &AudioFrame::stream_index);
    // .field("frame", ...) omitted

    // ReturnType (without AVPacket)
    value_object<ReturnType>("ReturnType")
        .field("status", &ReturnType::status)
        .field("type", &ReturnType::type)
        .field("video_frame", &ReturnType::video_frame)
        .field("audio_frame", &ReturnType::audio_frame)
        .field("packet", &ReturnType::packet);

    // VideoDecoderConfig
    value_object<VideoDecoderConfig>("VideoDecoderConfig")
        .field("codec", &VideoDecoderConfig::codec)                      // char[256] → pointer
        .field("coded_width", &VideoDecoderConfig::coded_width)
        .field("coded_height", &VideoDecoderConfig::coded_height)
        .field("description", &VideoDecoderConfig::description)          // uint8_t*
        .field("description_size", &VideoDecoderConfig::description_size)
        .field("color_range", &VideoDecoderConfig::color_range)
        .field("color_primaries", &VideoDecoderConfig::color_primaries)
        .field("color_trc", &VideoDecoderConfig::color_trc)
        .field("color_space", &VideoDecoderConfig::color_space)
        .field("chroma_location", &VideoDecoderConfig::chroma_location);

    // AudioDecoderConfig
    value_object<AudioDecoderConfig>("AudioDecoderConfig")
        .field("codec", &AudioDecoderConfig::codec)
        .field("sample_rate", &AudioDecoderConfig::sample_rate)
        .field("num_channels", &AudioDecoderConfig::num_channels)
        .field("description", &AudioDecoderConfig::description)
        .field("description_size", &AudioDecoderConfig::description_size);

    // ASSSubtitleConfig
    value_object<ASSSubtitleConfig>("ASSSubtitleConfig")
        .field("subtitle_header_size", &ASSSubtitleConfig::subtitle_header_size)
        .field("subtitle_header", &ASSSubtitleConfig::subtitle_header);

    // SmallerDemux
    value_object<SmallerDemux>("SmallerDemux")
        .field("extensions", &SmallerDemux::extensions)   // const char*
        .field("long_name", &SmallerDemux::long_name)
        .field("mime_type", &SmallerDemux::mime_type)
        .field("name", &SmallerDemux::name);
}
