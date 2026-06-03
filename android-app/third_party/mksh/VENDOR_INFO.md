# mksh — MirOS Korn Shell

## Upstream

- **Source**: https://github.com/mirabilos/mksh-cvs2git (read-only CVS-to-git mirror of MirOS upstream)
- **Canonical home**: https://www.mirbsd.org/mksh.htm (TLS uses outdated cipher suite, Windows schannel fails — must use GitHub mirror)
- **Tarball**: https://api.github.com/repos/mirabilos/mksh-cvs2git/tarball/refs/tags/mksh-R59c
- **Pinned tag**: `mksh-R59c` (commit `8b6f1b53521283f667b0b7644899feaddaf08d71`)
- **License**: MirOS BSD (permissive, MIT-compatible — see top of `Build.sh`)
- **Vendored**: 2026-05-18, ChainlessChain `feature-local-terminal` Phase 0.2

## Vendoring method

Curl-tarball + extract (per `android_native_vendor_strategy.md` memory — `git submodule add` fails on
Windows schannel mid-clone with SEC_E_ALGORITHM_MISMATCH against mirbsd.org).

```bash
curl -fsSL -o /tmp/mksh-R59c.tar.gz \
  https://api.github.com/repos/mirabilos/mksh-cvs2git/tarball/refs/tags/mksh-R59c
mkdir -p android-app/third_party/mksh
tar -xzf /tmp/mksh-R59c.tar.gz -C /tmp/
mv /tmp/mirabilos-mksh-cvs2git-*/* android-app/third_party/mksh/
```

## Cross-compile validation

`Build.sh` is mksh's autoconf-equivalent shell script. It runs ~120 conftest probes against the
target compiler (compile-only; does not execute target binaries → cross-compile-safe by design).

Verified on Windows 10 + NDK 25.2.9519653 clang for `aarch64-linux-android26` target:

```bash
CC=/c/Android/Sdk/ndk/25.2.9519653/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android26-clang.cmd \
TARGET_OS=Linux \
TARGET_OSREV=5.10.0 \
  sh Build.sh -r -Q
```

Output: `mksh` binary, 342896 bytes, verified via `file`:

```
mksh: ELF 64-bit LSB pie executable, ARM aarch64, version 1 (SYSV),
      dynamically linked, interpreter /system/bin/linker64,
      for Android 26, built by NDK r25c (9519653), not stripped
```

## Build integration

CMakeLists.txt (`feature-local-terminal/src/main/cpp/`) wires Build.sh as a per-ABI custom command
inside the Gradle externalNativeBuild. Each ABI gets its own staging directory, Build.sh is invoked
with the matching NDK clang wrapper, and the output `mksh` binary is renamed to `libmksh.so` and
placed into `${CMAKE_LIBRARY_OUTPUT_DIRECTORY}` so Gradle's `mergeNativeLibs` picks it up.

The `lib*.so` rename is mandatory: APK install-time native-lib extraction whitelists
`lib/<abi>/lib*.so` for execution under Android 10+ W^X enforcement (Trap 1 in design doc).

## Build.sh requirements

- POSIX `sh` (git bash on Windows works; bash/dash on Linux works)
- `awk`, `sed`, `cat`, `rm`, `mkdir`, `mv`, basic coreutils
- Target compiler accessible via `$CC` env var
- ~30 seconds wall-clock per ABI on a modern dev box (mostly conftest probing)

## Patches applied to upstream

None. Vendored unchanged. Cross-compile config is purely via env vars + Build.sh's existing
`TARGET_OS=Linux` mode.

## Files not used on Android

- `jehanne.c` — Jehanne OS port shim, not used on Linux/Android (Build.sh skips automatically)
- `os2.c` — OS/2 port shim, ditto
- `mksh.ico` — Windows icon resource, irrelevant to Android binary
- `check.pl`, `check.t`, `test.sh`, `FAQ2HTML.sh` — test/doc tooling, not compiled in

## Provenance / verification

```bash
sha256sum mksh-R59c.tar.gz
# Expected: (recorded at vendoring time, replace after first vendor)
```

## Replacing this version

```bash
NEW_TAG=mksh-R60   # for example
curl -fsSL -o /tmp/mksh.tar.gz \
  "https://api.github.com/repos/mirabilos/mksh-cvs2git/tarball/refs/tags/${NEW_TAG}"
rm -rf android-app/third_party/mksh/*
tar -xzf /tmp/mksh.tar.gz -C /tmp/
mv /tmp/mirabilos-mksh-cvs2git-*/* android-app/third_party/mksh/
# Update Pinned tag in this file
# Re-run :feature-local-terminal:assembleDebug to verify
```
