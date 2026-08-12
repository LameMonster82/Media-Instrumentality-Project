#!/bin/bash
set -e

TARGET_CPU="${1:-wasm32}"

EM_PKG_CONFIG_PATH="$INSTALL_DIR/lib/pkgconfig" emconfigure ./configure \
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
    --enable-libdav1d \
    --enable-gpl \
    --enable-version3 \
    --disable-sdl2 \
    --enable-pthreads \
    --enable-static \
    --disable-shared \
    --extra-cflags="$CFLAGS" \
    --extra-cxxflags="$CXXFLAGS" \
    --extra-ldflags="$LDFLAGS" \
|| { echo "===== ffbuild/config.log: dav1d section ====="; grep -n -B2 -A60 "check.*dav1d\|test_pkg_config libdav1d\|dav1d_version" ffbuild/config.log | tail -n 150; exit 1; }
