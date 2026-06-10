#include "demuxers.h"
#include "emscripten.h"
#include "libavformat/avformat.h"
#include <stdint.h>

EMSCRIPTEN_KEEPALIVE
int get_supported_demuxers(SmallerDemux* buffer, int max_count) {
  void *opaque = NULL;
  const AVInputFormat *fmt = NULL;
  int counter = 0;

  while ((fmt = av_demuxer_iterate(&opaque)) && counter < max_count) {
    buffer[counter].extensions = fmt->extensions;
    buffer[counter].long_name = fmt->long_name;
    buffer[counter].mime_type = fmt->mime_type;
    buffer[counter].name = fmt->name;
    counter++;
  }

  return counter;
}
