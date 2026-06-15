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
    cmake meson ninja-build nasm \
    && rm -rf /var/lib/apt/lists/*

# For d.ts
RUN npm install -g typescript@5.5 tsx

# -----------
# Wasm32 Libs
# -----------

# ---- Stage: Build zlib for wasm32 --------------------------------
FROM base AS zlib-wasm32
ENV ZLIB_VERSION=1.3.2
ADD https://github.com/madler/zlib/archive/refs/tags/v${ZLIB_VERSION}.tar.gz /tmp/zlib.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/zlib.tar.gz -C /src --strip-components=1 && rm /tmp/zlib.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --static
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libogg for wasm32 ------------------------------------------------
FROM base AS libogg-wasm32
ENV OGG_VERSION=1.3.6
ADD https://github.com/xiph/ogg/releases/download/v${OGG_VERSION}/libogg-${OGG_VERSION}.tar.gz /tmp/ogg.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/ogg.tar.gz -C /src --strip-components=1 && rm /tmp/ogg.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --disable-shared --enable-static --host=wasm32-unknown-emscripten
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libvorbis (needs ogg) ---------------------------------
FROM base AS libvorbis-wasm32
COPY --from=libogg-wasm32 $INSTALL_DIR $INSTALL_DIR
ENV VORBIS_VERSION=1.3.7
ADD https://github.com/xiph/vorbis/releases/download/v${VORBIS_VERSION}/libvorbis-${VORBIS_VERSION}.tar.gz /tmp/vorbis.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/vorbis.tar.gz -C /src --strip-components=1 && rm /tmp/vorbis.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --disable-shared --enable-static --host=wasm32-linux-gnu \
    --with-ogg=$INSTALL_DIR
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libopus (needs ogg) -----------------------------------
FROM base AS libopus-wasm32
COPY --from=libogg-wasm32 $INSTALL_DIR $INSTALL_DIR
ENV OPUS_VERSION=1.5.2
ADD https://github.com/xiph/opus/releases/download/v${OPUS_VERSION}/opus-${OPUS_VERSION}.tar.gz /tmp/opus.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/opus.tar.gz -C /src --strip-components=1 && rm /tmp/opus.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --disable-shared --enable-static --disable-rtcd --host=wasm32-unknown-emscripten \
    --with-ogg=$INSTALL_DIR
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libvpx (VP8/VP9) --------------------------------------
FROM base AS libvpx-wasm32
ENV VPX_VERSION=1.16.0
ADD https://github.com/webmproject/libvpx/archive/refs/tags/v${VPX_VERSION}.tar.gz /tmp/vpx.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/vpx.tar.gz -C /src --strip-components=1 && rm /tmp/vpx.tar.gz
WORKDIR /src
# Emscripten doesn't support x86 asm; use generic target
RUN emconfigure ./configure --prefix=$INSTALL_DIR --target=generic-gnu \
    --disable-multithread --disable-examples --disable-tools --disable-docs --disable-unit-tests --disable-vp8-encoder --disable-vp9-encoder
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libdav1d (AV1, meson build) ---------------------------
FROM base AS libdav1d-wasm32
ENV DAV1D_VERSION=1.5.3
ADD https://code.videolan.org/videolan/dav1d/-/archive/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.gz /tmp/dav1d.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/dav1d.tar.gz -C /src --strip-components=1 && rm /tmp/dav1d.tar.gz
WORKDIR /src
# meson cross file for Emscripten
RUN cat > /tmp/emscripten-cross.meson <<'MESON_EOF'
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
ranlib = 'emranlib'
pkgconfig = 'pkg-config'

[built-in options]
c_args = ['-pthread']
cpp_args = ['-pthread']
c_link_args = ['-pthread']
cpp_link_args = ['-pthread']

[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
MESON_EOF
RUN meson setup build --prefix=$INSTALL_DIR --cross-file /tmp/emscripten-cross.meson \
    -Ddefault_library=static -Denable_tools=false -Denable_tests=false
RUN meson compile -C build && meson install -C build

# ---- Stage: libxml2 (for DASH/IMF demuxers) -----------------------
FROM base AS libxml2-wasm32
ENV XML2_VERSION=2.12.6
ADD https://github.com/GNOME/libxml2/archive/refs/tags/v${XML2_VERSION}.tar.gz /tmp/xml2.tar.gz

COPY --from=zlib-wasm32 $INSTALL_DIR $INSTALL_DIR
ENV PKG_CONFIG_PATH=$INSTALL_DIR/lib/pkgconfig

RUN mkdir -p /src && tar -xzf /tmp/xml2.tar.gz -C /src --strip-components=1 && rm /tmp/xml2.tar.gz
WORKDIR /src
# cmake build
RUN emcmake cmake -S . -B build \
    -DBUILD_SHARED_LIBS=OFF \
    -DLIBXML2_WITH_PYTHON=OFF \
    -DLIBXML2_WITH_TESTS=OFF \
    -DLIBXML2_WITH_LZMA=OFF \
    -DLIBXML2_WITH_ZLIB=ON \
    -DZLIB_LIBRARY=$INSTALL_DIR/lib/libz.a \
    -DZLIB_INCLUDE_DIR=$INSTALL_DIR/include \
    -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR

RUN cmake --build build -j$(nproc) && cmake --install build

# -----------
# Wasm64 Libs
# -----------

# ---- Stage: Build zlib for wasm64 --------------------------------
FROM base AS zlib-wasm64
ENV ZLIB_VERSION=1.3.2
ENV CFLAGS="-g3 -sMEMORY64=1 -m64"
ENV LDFLAGS="-g3 -sMEMORY64=1 -m64"
ADD https://github.com/madler/zlib/archive/refs/tags/v${ZLIB_VERSION}.tar.gz /tmp/zlib.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/zlib.tar.gz -C /src --strip-components=1 && rm /tmp/zlib.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --static --64
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libogg for wasm64 ------------------------------------------------
FROM base AS libogg-wasm64
ENV OGG_VERSION=1.3.6
ENV CFLAGS="-g3 -sMEMORY64=1 -m64"
ENV LDFLAGS="-g3 -sMEMORY64=1 -m64"
ADD https://github.com/xiph/ogg/releases/download/v${OGG_VERSION}/libogg-${OGG_VERSION}.tar.gz /tmp/ogg.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/ogg.tar.gz -C /src --strip-components=1 && rm /tmp/ogg.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --disable-shared --enable-static --host=wasm64-unknown-emscripten
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libvorbis (needs ogg) ---------------------------------
FROM base AS libvorbis-wasm64
COPY --from=libogg-wasm64 $INSTALL_DIR $INSTALL_DIR
ENV VORBIS_VERSION=1.3.7
ENV CFLAGS="-g3 -sMEMORY64=1 -m64"
ENV LDFLAGS="-g3 -sMEMORY64=1 -m64"
ADD https://github.com/xiph/vorbis/releases/download/v${VORBIS_VERSION}/libvorbis-${VORBIS_VERSION}.tar.gz /tmp/vorbis.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/vorbis.tar.gz -C /src --strip-components=1 && rm /tmp/vorbis.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --disable-shared --enable-static --host=wasm32-linux-gnu \
    --with-ogg=$INSTALL_DIR
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libopus (needs ogg) -----------------------------------
FROM base AS libopus-wasm64
COPY --from=libogg-wasm64 $INSTALL_DIR $INSTALL_DIR
ENV OPUS_VERSION=1.5.2
ENV CFLAGS="-g3 -sMEMORY64=1 -m64"
ENV LDFLAGS="-g3 -sMEMORY64=1 -m64"
ADD https://github.com/xiph/opus/releases/download/v${OPUS_VERSION}/opus-${OPUS_VERSION}.tar.gz /tmp/opus.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/opus.tar.gz -C /src --strip-components=1 && rm /tmp/opus.tar.gz
WORKDIR /src
RUN emconfigure ./configure --prefix=$INSTALL_DIR --disable-shared --enable-static --disable-rtcd --host=wasm64-unknown-emscripten \
    --with-ogg=$INSTALL_DIR
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libvpx (VP8/VP9) --------------------------------------
FROM base AS libvpx-wasm64
ENV VPX_VERSION=1.16.0
ENV CFLAGS="-g3 -sMEMORY64=1 -m64"
ENV LDFLAGS="-g3 -sMEMORY64=1 -m64"
ADD https://github.com/webmproject/libvpx/archive/refs/tags/v${VPX_VERSION}.tar.gz /tmp/vpx.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/vpx.tar.gz -C /src --strip-components=1 && rm /tmp/vpx.tar.gz
WORKDIR /src
# Emscripten doesn't support x86 asm; use generic target
RUN emconfigure ./configure --prefix=$INSTALL_DIR --target=generic-gnu \
    --disable-multithread --disable-examples --disable-tools --disable-docs --disable-unit-tests --disable-vp8-encoder --disable-vp9-encoder
RUN emmake make -j$(nproc) && emmake make install

# ---- Stage: libdav1d (AV1, meson build) ---------------------------
FROM base AS libdav1d-wasm64
ENV DAV1D_VERSION=1.5.3
ENV CFLAGS="-g3 -sMEMORY64=1 -m64"
ENV LDFLAGS="-g3 -sMEMORY64=1 -m64"
ADD https://code.videolan.org/videolan/dav1d/-/archive/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.gz /tmp/dav1d.tar.gz
RUN mkdir -p /src && tar -xzf /tmp/dav1d.tar.gz -C /src --strip-components=1 && rm /tmp/dav1d.tar.gz
WORKDIR /src
# meson cross file for Emscripten
RUN cat > /tmp/emscripten-cross.meson <<'MESON_EOF'
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
ranlib = 'emranlib'
pkgconfig = 'pkg-config'

[built-in options]
c_args = ['-pthread']
cpp_args = ['-pthread']
c_link_args = ['-pthread']
cpp_link_args = ['-pthread']

[host_machine]
system = 'emscripten'
cpu_family = 'wasm64'
cpu = 'wasm64'
endian = 'little'
MESON_EOF
RUN meson setup build --prefix=$INSTALL_DIR --cross-file /tmp/emscripten-cross.meson \
    -Ddefault_library=static -Denable_tools=false -Denable_tests=false
RUN meson compile -C build && meson install -C build

# ---- Stage: libxml2 (for DASH/IMF demuxers) -----------------------
FROM base AS libxml2-wasm64
ENV XML2_VERSION=2.12.6
ENV CFLAGS="-g3 -sMEMORY64=1 -m64"
ENV LDFLAGS="-g3 -sMEMORY64=1 -m64"
ADD https://github.com/GNOME/libxml2/archive/refs/tags/v${XML2_VERSION}.tar.gz /tmp/xml2.tar.gz

COPY --from=zlib-wasm64 $INSTALL_DIR $INSTALL_DIR
ENV PKG_CONFIG_PATH=$INSTALL_DIR/lib/pkgconfig

RUN mkdir -p /src && tar -xzf /tmp/xml2.tar.gz -C /src --strip-components=1 && rm /tmp/xml2.tar.gz
WORKDIR /src
# cmake build
RUN emcmake cmake -S . -B build \
    -DBUILD_SHARED_LIBS=OFF \
    -DLIBXML2_WITH_PYTHON=OFF \
    -DLIBXML2_WITH_TESTS=OFF \
    -DLIBXML2_WITH_LZMA=OFF \
    -DLIBXML2_WITH_ZLIB=ON \
    -DZLIB_LIBRARY=$INSTALL_DIR/lib/libz.a \
    -DZLIB_INCLUDE_DIR=$INSTALL_DIR/include \
    -DCMAKE_INSTALL_PREFIX=$INSTALL_DIR

RUN cmake --build build -j$(nproc) && cmake --install build

# ---- Stage 3: Build FFmpeg for Wasm32 ------------------------------
FROM base AS build-wasm32
ENV FFMPEG_VERSION=8.1
ADD https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz /tmp/ffmpeg.tar.xz
RUN mkdir -p /src && tar -xf /tmp/ffmpeg.tar.xz -C /src --strip-components=1 && rm /tmp/ffmpeg.tar.xz

# After the existing COPY --from=zlib-wasm32 ..., add:
COPY --from=libogg-wasm32      $INSTALL_DIR $INSTALL_DIR
COPY --from=libvorbis-wasm32   $INSTALL_DIR $INSTALL_DIR
COPY --from=libopus-wasm32     $INSTALL_DIR $INSTALL_DIR
COPY --from=libvpx-wasm32      $INSTALL_DIR $INSTALL_DIR
COPY --from=libdav1d-wasm32    $INSTALL_DIR $INSTALL_DIR
COPY --from=libxml2-wasm32     $INSTALL_DIR $INSTALL_DIR
COPY --from=zlib-wasm32        $INSTALL_DIR $INSTALL_DIR

ENV PKG_CONFIG_PATH=$INSTALL_DIR/lib/pkgconfig

# Pthreads + SIMD + optimisations
ENV CFLAGS="-I$INSTALL_DIR/include -g3 -msimd128 -pthread"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib -g3 -pthread"
COPY configure-ffmpeg.sh /src/

WORKDIR /src
RUN bash /src/configure-ffmpeg.sh wasm32
RUN emmake make -j$(nproc) && emmake make install
COPY link-ffmpeg.sh /src/

WORKDIR /src
COPY src/ ./src/
COPY include/ ./include/
RUN mkdir -p /output
RUN bash /src/link-ffmpeg.sh wasm32

# ---- Stage 4: Build FFmpeg for Wasm64 ------------------------------
FROM base AS build-wasm64
ENV FFMPEG_VERSION=8.1
ADD https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz /tmp/ffmpeg.tar.xz
RUN mkdir -p /src && tar -xf /tmp/ffmpeg.tar.xz -C /src --strip-components=1 && rm /tmp/ffmpeg.tar.xz

COPY --from=libogg-wasm64      $INSTALL_DIR $INSTALL_DIR
COPY --from=libvorbis-wasm64   $INSTALL_DIR $INSTALL_DIR
COPY --from=libopus-wasm64     $INSTALL_DIR $INSTALL_DIR
COPY --from=libvpx-wasm64      $INSTALL_DIR $INSTALL_DIR
COPY --from=libdav1d-wasm64    $INSTALL_DIR $INSTALL_DIR
COPY --from=libxml2-wasm64     $INSTALL_DIR $INSTALL_DIR
COPY --from=zlib-wasm64        $INSTALL_DIR $INSTALL_DIR

ENV PKG_CONFIG_PATH=$INSTALL_DIR/lib/pkgconfig

ENV CFLAGS="-I$INSTALL_DIR/include -g3 -msimd128 -pthread -sMEMORY64=1"
ENV CXXFLAGS="$CFLAGS"
ENV LDFLAGS="-L$INSTALL_DIR/lib -g3 -pthread -sMEMORY64=1"
COPY configure-ffmpeg.sh /src/

WORKDIR /src
RUN bash /src/configure-ffmpeg.sh wasm64
RUN emmake make -j$(nproc) && emmake make install
COPY link-ffmpeg.sh /src/

WORKDIR /src
COPY src/ ./src/
COPY include/ ./include/
RUN mkdir -p /output
RUN bash /src/link-ffmpeg.sh wasm64

# ---- Build Structs -----------------------------------------------
FROM base AS structs-wasm32
COPY                          struct-codegen.ts  /tmp/struct-codegen.ts
COPY --from=build-wasm32      /output/layout.txt /tmp/layout.txt
RUN mkdir -p /output
RUN node --experimental-strip-types /tmp/struct-codegen.ts /tmp/layout.txt /output/structs.ts

# ---- Build Structs -----------------------------------------------
FROM base AS structs-wasm64
COPY                          struct-codegen.ts  /tmp/struct-codegen.ts
COPY --from=build-wasm64      /output/layout.txt /tmp/layout.txt
RUN mkdir -p /output
RUN node --experimental-strip-types /tmp/struct-codegen.ts /tmp/layout.txt /output/structs.ts

# ---- Stage 5: Export artifacts ------------------------------------
FROM scratch AS export
COPY --from=build-wasm32 /output/ffmpeg-wasm32.wasm /lib/ffmpeg-wasm32/ffmpeg-wasm32.wasm
COPY --from=build-wasm32 /output/ffmpeg-wasm32.mjs /lib/ffmpeg-wasm32/ffmpeg.mjs
COPY --from=build-wasm32 /output/ffmpeg-wasm32.d.ts /lib/ffmpeg-wasm32/ffmpeg.d.ts
COPY --from=build-wasm64 /output/ffmpeg-wasm64.wasm /lib/ffmpeg-wasm64/ffmpeg-wasm64.wasm
COPY --from=build-wasm64 /output/ffmpeg-wasm64.mjs /lib/ffmpeg-wasm64/ffmpeg.mjs
COPY --from=build-wasm64 /output/ffmpeg-wasm64.d.ts /lib/ffmpeg-wasm64/ffmpeg.d.ts

COPY --from=build-wasm32 /src/ffbuild/config.log /config-wasm32.log
COPY --from=build-wasm64 /src/ffbuild/config.log /config-wasm64.log

COPY --from=structs-wasm32 /output/structs.ts /lib/ffmpeg-wasm32/structs-wasm32.ts
COPY --from=structs-wasm64 /output/structs.ts /lib/ffmpeg-wasm64/structs-wasm64.ts
