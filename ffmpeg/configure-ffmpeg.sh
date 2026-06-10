#!/bin/bash
set -e

TARGET_CPU="${1:-wasm32}"

emconfigure ./configure \
    --cc="emcc" \
    --cxx="em++" \
    --ar="emar" \
    --ranlib="emranlib" \
    --prefix="$INSTALL_DIR" \
    --target-os=none \
    --arch="$TARGET_CPU" \
    --cpu="$TARGET_CPU" \
    --enable-cross-compile \
    --disable-stripping \
    --disable-doc \
    --disable-ffplay \
    --disable-ffprobe \
    --disable-programs \
    --disable-runtime-cpudetect \
    --disable-everything \
    --disable-network \
    --enable-decoder=* \
    --enable-demuxer=* \
    --disable-hwaccels \
    --disable-devices \
    --enable-zlib \
    --enable-gpl \
    --enable-version3 \
    --disable-sdl2 \
    --enable-pthreads \
    --enable-static \
    --disable-shared \
    --extra-cflags="$CFLAGS" \
    --extra-cxxflags="$CXXFLAGS" \
    --extra-ldflags="$LDFLAGS"
