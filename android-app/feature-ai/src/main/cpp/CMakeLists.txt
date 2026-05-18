cmake_minimum_required(VERSION 3.22.1)
project("whisper_jni")

# Android v1.1 issue #19 W4a — whisper.cpp native build infrastructure.
# Layered build：先编 whisper.cpp 静态库（third_party/whisper.cpp 子项目），再编
# 本模块的 whisper_jni SHARED 库链 whisper + log。W4a 只有最小 stub function
# 验证链接路径绿；W4b 真 JNI 接口（transcribe / initContext / freeContext）。

# whisper.cpp 源码路径相对 cpp/ 目录。WHISPER_STANDALONE 检查（whisper 自身
# CMakeLists.txt line 10）通过 CMAKE_SOURCE_DIR != CMAKE_CURRENT_SOURCE_DIR 识别
# 自己是子项目，跳过 bindings/javascript configure_file 等 standalone-only 路径。
set(WHISPER_SRC ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/whisper.cpp)

# Android-specific build flags — 关闭 x86 SIMD（whisper.cpp 默认开启）
set(WHISPER_NO_AVX ON CACHE BOOL "" FORCE)
set(WHISPER_NO_AVX2 ON CACHE BOOL "" FORCE)
set(WHISPER_NO_FMA ON CACHE BOOL "" FORCE)
set(WHISPER_NO_F16C ON CACHE BOOL "" FORCE)
# 关掉 example / test，只编核心 lib
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
# 静态链接，避免运行期再 dlopen
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

# arm64-v8a / armeabi-v7a：whisper.cpp v1.5.4 通过 cmake `CMAKE_SYSTEM_PROCESSOR`
# 自动检测 ARM 启 NEON intrinsics (third_party/whisper.cpp/CMakeLists.txt 检测
# 块在 if/elseif arm/aarch64)。不需要显式 GGML_USE_NEON——v1.5.4 没该选项，
# NEON 由 .cpp 文件 `#if defined(__ARM_NEON)` 编译期决定。

# 编 whisper static lib（含 ggml）
add_subdirectory(${WHISPER_SRC} whisper_build EXCLUDE_FROM_ALL)

# JNI binding — W4a 阶段最小 stub，W4b 扩 initContext/transcribe/freeContext
add_library(whisper_jni SHARED
    whisper_jni.cpp
)

target_include_directories(whisper_jni PRIVATE
    ${WHISPER_SRC}
)

# Android log 库 + whisper 静态库
find_library(LOG_LIB log)

target_link_libraries(whisper_jni
    PRIVATE
    whisper
    ${LOG_LIB}
)

# 强制 c++17（与 whisper.cpp 一致）
target_compile_features(whisper_jni PRIVATE cxx_std_17)
