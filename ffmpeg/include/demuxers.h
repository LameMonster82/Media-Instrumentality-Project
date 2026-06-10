#ifndef DEMUXERS_H
#define DEMUXERS_H

#include <stdint.h>

typedef struct SmallerDemux {
    const char* extensions;
    const char* long_name;
    const char* mime_type;
    const char* name;
} SmallerDemux;

int get_supported_demuxers(SmallerDemux* buffer, int max_count);

#endif
