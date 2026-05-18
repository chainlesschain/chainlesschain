cmake_minimum_required(VERSION 3.22.1)
project("local_terminal")

# Phase 0.1 — feature-local-terminal NDK skeleton.
# Builds a minimal placeholder JNI shared library to validate the build chain
# (NDK toolchain present, cpp/CMakeLists wired through Gradle externalNativeBuild,
# 3 ABIs produce libpty_jni.so). Real pty_jni.cpp content lands in Phase 1.1.
#
# Vendored native source trees (mksh, toybox, termux-exec) land in 0.2 / 0.3 / 0.4
# under android-app/third_party/. CMakeLists patches per VENDOR_INFO.md.

# -----------------------------------------------------------------------------
# pty_jni placeholder (Phase 0.1)
# -----------------------------------------------------------------------------
add_library(pty_jni SHARED
    pty_jni_placeholder.cpp
)

find_library(LOG_LIB log)

target_link_libraries(pty_jni
    PRIVATE
    ${LOG_LIB}
)

target_compile_features(pty_jni PRIVATE cxx_std_17)

# -----------------------------------------------------------------------------
# Phase 0.2 — mksh executable (output: libmksh.so, W^X requires lib*.so name)
# -----------------------------------------------------------------------------
# Uncomment after vendoring third_party/mksh in Phase 0.2.
#
# set(MKSH_SRC ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/mksh)
# file(GLOB MKSH_SRCS ${MKSH_SRC}/*.c)
# add_executable(mksh ${MKSH_SRCS})
# set_target_properties(mksh PROPERTIES
#     OUTPUT_NAME "libmksh.so"
#     LINK_FLAGS "-Wl,-soname,libmksh.so"
# )
# target_include_directories(mksh PRIVATE ${MKSH_SRC})

# -----------------------------------------------------------------------------
# Phase 0.3 — toybox multi-call binary (output: libtoybox.so)
# -----------------------------------------------------------------------------
# Uncomment after vendoring third_party/toybox in Phase 0.3.

# -----------------------------------------------------------------------------
# Phase 0.4 — termux-exec LD_PRELOAD shim (output: libtermux-exec.so)
# -----------------------------------------------------------------------------
# Uncomment after vendoring third_party/termux-exec in Phase 0.4.
