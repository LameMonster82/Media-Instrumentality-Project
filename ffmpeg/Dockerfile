# syntax=docker/dockerfile:1
# -------------------------------------------------------------------
#  Build FFmpeg 8.1 for the browser with the latest Emscripten
#  Includes: all decoders, all demuxers, no encoders, NON‑FREE codecs,
#            pthreads for multi‑threaded software decoding
#  Outputs: Wasm32 + Wasm64 modules with SIMD and full optimisations.
# -------------------------------------------------------------------

# ---- Stage 0: Base Emscripten environment (latest) -----------------
FROM emscripten/emsdk:latest AS base
ARG EXTRA_CFLAGS
ENV INSTALL_DIR=/opt

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config autoconf automake libtool ragel nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# For d.ts
RUN npm install -g typescript@5.5 tsx

# ---- Stage 1: Build zlib for wasm32 --------------------------------
FROM base AS zlib-wasm32
ENV ZLIB_VERSION=1.2.11
ADD https://github.com/ffmpegwasm/zlib/archive/refs/tags/v${ZLIB_VERSION}.tar.gz /tmp/zlib.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/zlib.tar.gz -C /src --strip-components=1 && rm /tmp/zlib.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --static
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage 2: Build zlib for wasm64 --------------------------------
FROM base AS zlib-wasm64
ENV CFLAGS="-O3 -flto -sMEMORY64=1"
ENV LDFLAGS="-O3 -flto -sMEMORY64=1"
ENV ZLIB_VERSION=1.2.11
ADD https://github.com/ffmpegwasm/zlib/archive/refs/tags/v${ZLIB_VERSION}.tar.gz /tmp/zlib.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/zlib.tar.gz -C /src --strip-components=1 && rm /tmp/zlib.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --static
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage 3: Build FFmpeg for Wasm32 ------------------------------
FROM base AS build-wasm32
ENV FFMPEG_VERSION=8.1
ADD https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz /tmp/ffmpeg.tar.xz
RUN mkdir -p /src && tar -xf /tmp/ffmpeg.tar.xz -C /src --strip-components=1 && rm /tmp/ffmpeg.tar.xz

COPY --from=zlib-wasm32 $INSTALL_DIR $INSTALL_DIR
ENV PKG_CONFIG_PATH=$INSTALL_DIR/lib/pkgconfig

# Pthreads + SIMD + optimisations
ENV CFLAGS="-I$INSTALL_DIR/include -O3 -flto -msimd128 -pthread"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib -O3 -flto -pthread"

WORKDIR /src
COPY <<-"EOF" /src/configure-ffmpeg.sh
    #!/bin/bash
    set -e
    TARGET_CPU="${1:-wasm32}"
    emconfigure ./configure \
        --cc="emcc" \
        --cxx="em++" \
        --ar="emar" \
        --ranlib="emranlib" \
        --prefix=$INSTALL_DIR \
        --target-os=none \
        --arch=${TARGET_CPU} \
        --cpu=${TARGET_CPU} \
        --enable-cross-compile \
        --disable-stripping \
        --disable-doc \
        --disable-ffplay \
        --disable-ffprobe \
        --disable-programs \
        --disable-asm \
        --disable-x86asm \
        --disable-inline-asm \
        --disable-everything \
        --enable-decoder=* \
        --enable-demuxer=* \
        --enable-zlib \
        --enable-nonfree \
        --enable-pthreads \
        --enable-static \
        --disable-shared \
        --extra-cflags="$CFLAGS" \
        --extra-cxxflags="$CXXFLAGS" \
        --extra-ldflags="$LDFLAGS"
EOF
RUN bash /src/configure-ffmpeg.sh wasm32
RUN emmake make -j$(nproc) && emmake make install

WORKDIR /src
COPY src/ ./src/
COPY include/ ./include/
RUN mkdir -p /output
RUN emcc \
    -O3 -flto -msimd128 -pthread \
    -I$INSTALL_DIR/include \
    -Iinclude \
    -L$INSTALL_DIR/lib \
    -sMALLOC=mimalloc \
    -sFILESYSTEM=1 \
    -sUSE_PTHREADS=1 \
    -sPTHREAD_POOL_SIZE=4 \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="'FFmpegModule'" \
    -sEXPORT_ES6=1 \
    -sENVIRONMENT=web,worker \
    -sEXPORTED_FUNCTIONS='["_malloc","_free","setValue","_init_ffmpeg","_get_supported_demuxers","_get_exif","_open_file","_get_data","_seek_to","_cleanup","_extract_thumbnail"]' \
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","wasmMemory", "setValue", "UTF8ToString", "HEAPU8", "HEAPU32"]' \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=32MB \
    src/main.c src/demux.c src/decode.c src/convert.c \
    src/codec_config.c src/subtitle.c src/notify.c src/thumbnail.c \
    -lavcodec -lavformat -lavutil -lswscale -lswresample -lavfilter -lz \
    -o /output/ffmpeg-wasm32.mjs \
    --emit-tsd /output/ffmpeg-wasm32.d.ts

# ---- Generate preprocessed headers ----
COPY gen_struct.ts ./gen_struct.ts
RUN emcc -sMEMORY64=0 -E -P include/events.h -o /tmp/events-wasm32.h
RUN tsx gen_struct.ts --pointer-size 4 /tmp/events-wasm32.h -o /output/events-wasm32.ts

# ---- Stage 4: Build FFmpeg for Wasm64 ------------------------------
FROM base AS build-wasm64
ENV FFMPEG_VERSION=8.1
ADD https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz /tmp/ffmpeg.tar.xz
RUN mkdir -p /src && tar -xf /tmp/ffmpeg.tar.xz -C /src --strip-components=1 && rm /tmp/ffmpeg.tar.xz

COPY --from=zlib-wasm64 $INSTALL_DIR $INSTALL_DIR
ENV PKG_CONFIG_PATH=$INSTALL_DIR/lib/pkgconfig

ENV CFLAGS="-I$INSTALL_DIR/include -O3 -flto -msimd128 -pthread -sMEMORY64=1"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib -O3 -flto -pthread -sMEMORY64=1"

WORKDIR /src
COPY <<-"EOF" /src/configure-ffmpeg.sh
    #!/bin/bash
    set -e
    TARGET_CPU="${1:-wasm64}"
    emconfigure ./configure \
        --cc="emcc" \
        --cxx="em++" \
        --ar="emar" \
        --ranlib="emranlib" \
        --prefix=$INSTALL_DIR \
        --target-os=none \
        --arch=${TARGET_CPU} \
        --cpu=${TARGET_CPU} \
        --enable-cross-compile \
        --disable-stripping \
        --disable-doc \
        --disable-ffplay \
        --disable-ffprobe \
        --disable-programs \
        --disable-asm \
        --disable-x86asm \
        --disable-inline-asm \
        --disable-everything \
        --enable-decoder=* \
        --enable-demuxer=* \
        --enable-zlib \
        --enable-nonfree \
        --enable-pthreads \
        --enable-static \
        --disable-shared \
        --extra-cflags="$CFLAGS" \
        --extra-cxxflags="$CXXFLAGS" \
        --extra-ldflags="$LDFLAGS"
EOF
RUN bash /src/configure-ffmpeg.sh wasm64
RUN emmake make -j$(nproc) && emmake make install

WORKDIR /src
COPY src/ ./src/
COPY include/ ./include/
RUN mkdir -p /output
RUN emcc \
    -O3 -flto -msimd128 -pthread \
    -I$INSTALL_DIR/include \
    -Iinclude \
    -L$INSTALL_DIR/lib \
    -sMEMORY64=1 \
    -sMALLOC=mimalloc \
    -sFILESYSTEM=1 \
    -sUSE_PTHREADS=1 \
    -sPTHREAD_POOL_SIZE=4 \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="'FFmpegModule'" \
    -sEXPORT_ES6=1 \
    -sENVIRONMENT=web,worker \
    -sEXPORTED_FUNCTIONS='["_malloc","_free","setValue","_init_ffmpeg","_get_supported_demuxers","_get_exif","_open_file","_get_data","_seek_to","_cleanup","_extract_thumbnail"]' \
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","wasmMemory", "setValue", "UTF8ToString", "HEAPU8", "HEAPU32"]' \
    -sALLOW_MEMORY_GROWTH=1 \
    -sINITIAL_MEMORY=32MB \
    src/main.c src/demux.c src/decode.c src/convert.c \
    src/codec_config.c src/subtitle.c src/notify.c src/thumbnail.c \
    -lavcodec -lavformat -lavutil -lswscale -lswresample -lavfilter -lz \
    -o /output/ffmpeg-wasm64.mjs \
    --emit-tsd /output/ffmpeg-wasm64.d.ts

# ---- Generate preprocessed headers ----
COPY gen_struct.ts ./gen_struct.ts
RUN emcc -sMEMORY64=1 -E -P include/events.h -o /tmp/events-wasm64.h
RUN tsx gen_struct.ts --pointer-size 8 /tmp/events-wasm64.h -o /output/events-wasm64.ts

# ---- Stage 5: Export artifacts ------------------------------------
FROM scratch AS export
COPY --from=build-wasm32 /output/ffmpeg-wasm32.wasm /lib/ffmpeg-wasm32/ffmpeg-wasm32.wasm
COPY --from=build-wasm32 /output/ffmpeg-wasm32.mjs /lib/ffmpeg-wasm32/ffmpeg.mjs
COPY --from=build-wasm32 /output/ffmpeg-wasm32.d.ts /lib/ffmpeg-wasm32/ffmpeg.d.ts
COPY --from=build-wasm64 /output/ffmpeg-wasm64.wasm /lib/ffmpeg-wasm64/ffmpeg-wasm64.wasm
COPY --from=build-wasm64 /output/ffmpeg-wasm64.mjs /lib/ffmpeg-wasm64/ffmpeg.mjs
COPY --from=build-wasm64 /output/ffmpeg-wasm64.d.ts /lib/ffmpeg-wasm64/ffmpeg.d.ts

# COPY --from=build-wasm64 /output/ /lib/ffmpeg-wasm64/testOut

COPY --from=build-wasm32 /output/events-wasm32.ts /lib/ffmpeg-wasm32/events-wasm32.ts
COPY --from=build-wasm64 /output/events-wasm64.ts /lib/ffmpeg-wasm64/events-wasm64.ts

COPY --from=build-wasm32 /src/ffbuild/config.log /config-wasm32.log
COPY --from=build-wasm64 /src/ffbuild/config.log /config-wasm64.log
