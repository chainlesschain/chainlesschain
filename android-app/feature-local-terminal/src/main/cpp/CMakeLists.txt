cmake_minimum_required(VERSION 3.22.1)
project("local_terminal")

# Phase 0.1 — feature-local-terminal NDK skeleton.
# Phase 0.2 — mksh executable (output: libmksh.so).
#
# Builds:
#   1. pty_jni (SHARED .so) — placeholder JNI bridge (real impl in Phase 1.1)
#   2. mksh (EXECUTABLE renamed to libmksh.so) — MirOS Korn Shell cross-compiled
#      via upstream Build.sh per-ABI under NDK clang
#
# W^X policy (Android 10+ targetSdk 29+): native binaries are only executable
# when packaged in lib/<abi>/lib*.so. We rename the mksh ELF to libmksh.so so
# APK extraction places it in /data/app/<pkg>/lib/<abi>/ where exec is whitelisted.

# -----------------------------------------------------------------------------
# pty_jni — JNI bridge for the local terminal PTY.
# Phase 0.1: placeholder nativeVersion only (LocalTerminalNative class).
# Phase 1.1: real PTY surface (openPty / spawn / read / write / killpg /
#            waitpid / close / setWinsize) on LocalPtyNative class.
# Both .cpp files coexist; symbols are namespaced by Kotlin class via JNI
# function naming convention (Java_<pkg>_<class>_<method>).
# -----------------------------------------------------------------------------
add_library(pty_jni SHARED
    pty_jni_placeholder.cpp
    pty_jni.cpp
)

find_library(LOG_LIB log)

target_link_libraries(pty_jni
    PRIVATE
    ${LOG_LIB}
)

target_compile_features(pty_jni PRIVATE cxx_std_17)

# -----------------------------------------------------------------------------
# Phase 0.2 — mksh via upstream Build.sh (per-ABI cross-compile)
# -----------------------------------------------------------------------------
# mksh ships its own autoconf-equivalent Build.sh shell script that runs ~120
# compile-only conftest probes against the target compiler. Build.sh is
# cross-compile-safe by design (no target-binary execution required for any
# feature test), so we delegate the entire build to upstream rather than
# hand-porting feature detection into CMake.
#
# Per-ABI staging: each ABI gets its own copy of the source tree because
# Build.sh writes artifacts (.o, .gen, mksh) to its cwd.

set(MKSH_VENDOR_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/mksh)
set(MKSH_BUILD_DIR ${CMAKE_CURRENT_BINARY_DIR}/mksh-build-${ANDROID_ABI})
set(MKSH_OUTPUT_BIN ${MKSH_BUILD_DIR}/mksh)
set(MKSH_OUTPUT_SO ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/libmksh.so)

# Build.sh requires a POSIX shell — explicitly bash (NOT /bin/sh) on every
# host. On Ubuntu CI runners /bin/sh is dash, which subtly diverges from
# bash for several constructs Build.sh uses (`[[ ]]`-tolerant pieces, etc).
# Windows Git Bash, macOS, and Linux all ship bash; use it consistently.
#
# IMPORTANT: when cross-compiling to Android, WIN32 reflects the TARGET
# (always Android = not WIN32). Use CMAKE_HOST_WIN32 for the build machine.
if(CMAKE_HOST_WIN32)
    set(MKSH_SH_CMD bash)
else()
    set(MKSH_SH_CMD /bin/bash)
endif()

# Map ANDROID_ABI → clang wrapper basename. NDK ships per-API clang wrappers
# named like `aarch64-linux-android26-clang` (Linux) or `.cmd` (Windows). The
# minSdk=26 baseline for this module dictates the API suffix.
if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(MKSH_TRIPLE "aarch64-linux-android26")
elseif(ANDROID_ABI STREQUAL "armeabi-v7a")
    set(MKSH_TRIPLE "armv7a-linux-androideabi26")
elseif(ANDROID_ABI STREQUAL "x86_64")
    set(MKSH_TRIPLE "x86_64-linux-android26")
elseif(ANDROID_ABI STREQUAL "x86")
    set(MKSH_TRIPLE "i686-linux-android26")
else()
    message(FATAL_ERROR "Unsupported ABI for mksh build: ${ANDROID_ABI}")
endif()

if(CMAKE_HOST_WIN32)
    set(MKSH_CC_PATH "${ANDROID_NDK}/toolchains/llvm/prebuilt/windows-x86_64/bin/${MKSH_TRIPLE}-clang.cmd")
elseif(CMAKE_HOST_APPLE)
    set(MKSH_CC_PATH "${ANDROID_NDK}/toolchains/llvm/prebuilt/darwin-x86_64/bin/${MKSH_TRIPLE}-clang")
elseif(CMAKE_HOST_UNIX)
    set(MKSH_CC_PATH "${ANDROID_NDK}/toolchains/llvm/prebuilt/linux-x86_64/bin/${MKSH_TRIPLE}-clang")
else()
    message(FATAL_ERROR "Unsupported host OS for mksh build (CMAKE_HOST_SYSTEM_NAME=${CMAKE_HOST_SYSTEM_NAME})")
endif()

if(NOT EXISTS "${MKSH_CC_PATH}")
    message(FATAL_ERROR "NDK clang wrapper not found at: ${MKSH_CC_PATH}")
endif()

# Stage the vendor source into a per-ABI build dir (Build.sh mutates cwd).
file(MAKE_DIRECTORY ${MKSH_BUILD_DIR})

# COPY at configure time so the build dir is ready when Build.sh runs.
# Use file(COPY) instead of glob+add_custom_command so re-configuring doesn't
# leak stale generated files into source.
file(GLOB MKSH_VENDOR_FILES
    LIST_DIRECTORIES false
    ${MKSH_VENDOR_DIR}/*.c
    ${MKSH_VENDOR_DIR}/*.h
    ${MKSH_VENDOR_DIR}/*.opt
    ${MKSH_VENDOR_DIR}/Build.sh
)
file(COPY ${MKSH_VENDOR_FILES} DESTINATION ${MKSH_BUILD_DIR})

# Invoke Build.sh and rename mksh → libmksh.so. The COMMAND list runs Build.sh
# with CC pointing at the right NDK clang wrapper. TARGET_OS=Linux is mksh's
# expected value for Android (Build.sh internally treats Android as Linux).
add_custom_command(
    OUTPUT ${MKSH_OUTPUT_SO}
    WORKING_DIRECTORY ${MKSH_BUILD_DIR}
    COMMAND ${CMAKE_COMMAND} -E env
            "CC=${MKSH_CC_PATH}"
            "TARGET_OS=Linux"
            "TARGET_OSREV=5.10.0"
            ${MKSH_SH_CMD} Build.sh -r -Q
    COMMAND ${CMAKE_COMMAND} -E copy ${MKSH_OUTPUT_BIN} ${MKSH_OUTPUT_SO}
    DEPENDS ${MKSH_VENDOR_FILES}
    COMMENT "Building mksh for ${ANDROID_ABI} via upstream Build.sh"
    VERBATIM
)

add_custom_target(mksh_binary ALL DEPENDS ${MKSH_OUTPUT_SO})

# Force Android Gradle Plugin to actually invoke mksh_binary. AGP's CMake
# integration only runs `ninja <target>` for each add_library target it
# discovers — `add_custom_target(... ALL)` would otherwise be skipped because
# AGP never runs the bare `ninja` (which would honor ALL targets). Adding
# mksh_binary as a dependency of pty_jni piggybacks on the library build that
# AGP does invoke.
add_dependencies(pty_jni mksh_binary)

# -----------------------------------------------------------------------------
# Phase 0.3 — toybox multi-call binary (output: libtoybox.so)
# -----------------------------------------------------------------------------
# toybox needs GNU Make + a working HOSTCC (to compile kconfig parser and
# install.c). NDK ships GNU Make at prebuilt/<host>/bin/make, but no HOSTCC.
# On Linux/macOS dev boxes the system gcc/clang serves as HOSTCC. On Windows
# without MinGW/MSYS2 there's no HOSTCC available (bare NDK clang.exe can't
# find Windows stdio.h), so we skip the toybox build with a clear message and
# rely on CI's ubuntu-latest runner to build it. See VENDOR_INFO.md.

set(TOYBOX_VENDOR_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../../third_party/toybox)
set(TOYBOX_BUILD_DIR ${CMAKE_CURRENT_BINARY_DIR}/toybox-build-${ANDROID_ABI})
set(TOYBOX_OUTPUT_BIN ${TOYBOX_BUILD_DIR}/toybox)
set(TOYBOX_OUTPUT_SO ${CMAKE_LIBRARY_OUTPUT_DIRECTORY}/libtoybox.so)

# Locate GNU Make (NDK prebuilt → system → fail)
if(CMAKE_HOST_WIN32)
    set(TOYBOX_MAKE_PATH "${ANDROID_NDK}/prebuilt/windows-x86_64/bin/make.exe")
elseif(CMAKE_HOST_APPLE)
    set(TOYBOX_MAKE_PATH "${ANDROID_NDK}/prebuilt/darwin-x86_64/bin/make")
else()
    set(TOYBOX_MAKE_PATH "${ANDROID_NDK}/prebuilt/linux-x86_64/bin/make")
endif()

# Locate HOSTCC. On Windows without MinGW, NDK clang.exe alone can't find
# Windows stdio.h, so toybox can't be built. Detect and skip cleanly.
#
# Trap: ChainlessChain CLI ships a `cc` shim binary (npm `chainlesschain` package
# installs `cc.cmd` on Windows). find_program(... NAMES cc) would match it. Be
# explicit about the C compiler binary names on each host:
#   - Windows: only `gcc` (MinGW/MSYS2 convention; bare `cc` is ambiguous)
#   - Linux: `gcc` or `clang` (avoid `cc` symlink ambiguity)
#   - macOS: `clang` from xcode-select, fallback `gcc`
set(TOYBOX_SKIP_REASON "")
if(CMAKE_HOST_WIN32)
    find_program(TOYBOX_HOSTCC NAMES gcc HINTS ENV PATH)
    if(NOT TOYBOX_HOSTCC)
        set(TOYBOX_SKIP_REASON "Windows host without MinGW/MSYS2 (no HOSTCC). Install via 'pacman -S mingw-w64-x86_64-gcc make' or rely on CI.")
    endif()
elseif(CMAKE_HOST_APPLE)
    find_program(TOYBOX_HOSTCC NAMES clang gcc HINTS ENV PATH)
    if(NOT TOYBOX_HOSTCC)
        set(TOYBOX_SKIP_REASON "macOS host without xcode-select clang.")
    endif()
else()
    find_program(TOYBOX_HOSTCC NAMES gcc clang HINTS ENV PATH)
    if(NOT TOYBOX_HOSTCC)
        set(TOYBOX_SKIP_REASON "Linux host without gcc/clang. Install build-essential.")
    endif()
endif()

if(NOT EXISTS "${TOYBOX_MAKE_PATH}")
    set(TOYBOX_SKIP_REASON "${TOYBOX_SKIP_REASON} (and GNU Make not found at ${TOYBOX_MAKE_PATH})")
endif()

if(TOYBOX_SKIP_REASON)
    message(WARNING "Skipping toybox build for ${ANDROID_ABI}: ${TOYBOX_SKIP_REASON}")
    message(WARNING "    libtoybox.so will NOT be produced. The local terminal will lack basic Unix commands at runtime until CI rebuilds.")
else()
    # Stage the vendor source into a per-ABI build dir (toybox writes to cwd).
    file(MAKE_DIRECTORY ${TOYBOX_BUILD_DIR})

    # Recursive copy — toybox source tree has subdirs (toys/, kconfig/, scripts/, lib/, generated/)
    file(GLOB_RECURSE TOYBOX_VENDOR_FILES
        LIST_DIRECTORIES false
        RELATIVE ${TOYBOX_VENDOR_DIR}
        ${TOYBOX_VENDOR_DIR}/*
    )

    # CMake's file(COPY) handles directory structure; do this at configure-time
    # so build dir is ready for the make invocation.
    file(COPY ${TOYBOX_VENDOR_DIR}/ DESTINATION ${TOYBOX_BUILD_DIR})

    # toybox android_defconfig + make all
    add_custom_command(
        OUTPUT ${TOYBOX_OUTPUT_SO}
        WORKING_DIRECTORY ${TOYBOX_BUILD_DIR}
        COMMAND ${CMAKE_COMMAND} -E env
                "CC=${MKSH_CC_PATH}"    # Same NDK clang as mksh
                "HOSTCC=${TOYBOX_HOSTCC}"
                "CROSS_COMPILE="
                ${TOYBOX_MAKE_PATH} android_defconfig
        COMMAND ${CMAKE_COMMAND} -E env
                "CC=${MKSH_CC_PATH}"
                "HOSTCC=${TOYBOX_HOSTCC}"
                "CROSS_COMPILE="
                ${TOYBOX_MAKE_PATH} -j4
        COMMAND ${CMAKE_COMMAND} -E copy ${TOYBOX_OUTPUT_BIN} ${TOYBOX_OUTPUT_SO}
        DEPENDS ${TOYBOX_VENDOR_DIR}/Makefile ${TOYBOX_VENDOR_DIR}/Config.in
        COMMENT "Building toybox for ${ANDROID_ABI} via upstream Make"
        VERBATIM
    )

    add_custom_target(toybox_binary ALL DEPENDS ${TOYBOX_OUTPUT_SO})
    add_dependencies(pty_jni toybox_binary)
endif()

# -----------------------------------------------------------------------------
# Phase 0.4 — termux-exec LD_PRELOAD shim (output: libtermux-exec.so)
# -----------------------------------------------------------------------------
# Uncomment after vendoring third_party/termux-exec in Phase 0.4.
