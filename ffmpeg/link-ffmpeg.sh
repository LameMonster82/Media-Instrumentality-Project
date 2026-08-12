set -e

TARGET="${1}"   # "wasm32" or "wasm64"

if [ "$TARGET" = "wasm64" ]; then
    MEM64="-m64 -sMEMORY64 -sMAXIMUM_MEMORY=16gb"
    SUFFIX="wasm64"
else
    MEM64=""
    SUFFIX="wasm32"
fi

ARGS=(
    $RELEASE_CFLAGS -msimd128 -pthread
    -I"$INSTALL_DIR/include"
    -Iinclude
    -L"$INSTALL_DIR/lib"
    $MEM64
    -sMALLOC=mimalloc
    -sFILESYSTEM=1
    -sPTHREAD_POOL_SIZE=4
    -sMODULARIZE=1
    -sEXPORT_NAME='FFmpegModule'
    -sEXPORT_ES6=1
    -sENVIRONMENT=worker
    -sEXPORTED_FUNCTIONS='["_malloc","_free","getValue","setValue","_init_ffmpeg","_get_supported_demuxers","_open_file","_set_stream_support", "_cleanup_video_frame", "_cleanup_audio_frame", "_seek_to","_poke_for_data","_cleanup_info" ,"_cleanup_packet", "_av_dict_iterate"]'
    -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","wasmMemory", "getValue", "setValue", "UTF8ToString", "HEAPU8", "HEAPU32", "HEAPU64"]'
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=32MB
    -sSTACK_SIZE=8MB
    -sDEFAULT_PTHREAD_STACK_SIZE=8MB
    -sINCOMING_MODULE_JS_API=locateFile,mainScriptUrlOrBlob,onRuntimeInitialized,printWithColors
    src/main.c src/demuxers.c src/sw_stuff.c src/codec_config.c src/io.c
    -lavcodec -lavformat -lavutil -lswscale -lswresample -lavfilter -lz -ldav1d
)

# Real build
emcc "${ARGS[@]}" -o /output/ffmpeg-${SUFFIX}.mjs

# Layout dump only — -fsyntax-only skips codegen/link, just ru
emcc "${ARGS[@]}" -Xclang -fdump-record-layouts -fsyntax-only > /output/layout.txt