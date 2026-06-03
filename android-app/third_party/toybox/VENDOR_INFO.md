# toybox — Multi-call BSD-licensed Unix coreutils

## Upstream

- **Source**: https://github.com/landley/toybox
- **Canonical**: https://landley.net/toybox/
- **Tarball**: https://github.com/landley/toybox/archive/refs/tags/0.8.11.tar.gz
- **Pinned tag**: `0.8.11` (2023-10)
- **License**: 0BSD-equivalent (see `LICENSE` — permissive, "with or without fee", no attribution requirement)
- **Vendored**: 2026-05-18, ChainlessChain `feature-local-terminal` Phase 0.3

## Vendoring method

Curl tarball + extract + prune. Same Windows-schannel-safe path as mksh.

```bash
curl -fsSL -o /tmp/toybox.tar.gz \
  https://github.com/landley/toybox/archive/refs/tags/0.8.11.tar.gz
tar -xzf /tmp/toybox.tar.gz -C /tmp/
cp -r /tmp/toybox-0.8.11/. android-app/third_party/toybox/
cd android-app/third_party/toybox
# Prune what we don't need for cross-compile
rm -rf tests/ .github/ .gitignore
```

Pruned: `tests/` (~3MB shell test harness — toybox upstream covers; we don't re-run),
`.github/` (CI for the toybox project itself).

## Why toybox

- **License clean**: 0BSD vs busybox GPLv2 (which would force the whole ChainlessChain
  Android APK to GPL — incompatible with MIT repo license).
- **Android-aware**: `kconfig/android_miniconfig` is an officially maintained Android-targeted
  command set (no `mount`/`ifconfig`/`route` etc that need root).
- **~250 commands**: covers all of `ls`/`cat`/`grep`/`find`/`cp`/`mv`/`rm`/`mkdir`/`ps`/`df`/`du`/
  `awk`/`sed`/`tr`/`tar`/`gzip` etc. that a baseline shell user expects.

## Cross-compile note — host build tool requirements

Unlike mksh's self-contained `Build.sh`, toybox uses **GNU Make + kconfig + scripts/make.sh**
which needs a working **HOSTCC** on the build machine (to compile the kconfig parser
`kconfig/conf`, the `install.c` helper, etc.). The HOSTCC produces Windows .exe / Linux ELF /
macOS Mach-O depending on the dev box.

| Host OS | HOSTCC available? | toybox cross-build status |
|---|---|---|
| Linux (Ubuntu/CI) | ✅ gcc/clang preinstalled | ✅ Works |
| macOS dev box | ✅ Xcode CommandLineTools | ✅ Works |
| Windows + MinGW/MSYS2 | ⚠️ Needs manual `pacman -S gcc make` | ✅ Works once installed |
| Windows bare (no MinGW) | ❌ NDK clang.exe lacks `stdio.h` (no Windows SDK) | ❌ Skipped at CMake configure |

**Practical implication**: CI on `ubuntu-latest` (GitHub Actions) compiles toybox for all 3
ABIs. Windows-only developers without MinGW will see the toybox build skipped with a clear
message; they should rely on CI to validate toybox-related changes, or install MinGW via
[MSYS2](https://www.msys2.org/) (`pacman -S mingw-w64-x86_64-gcc make`).

## Build integration

The CMakeLists.txt (`feature-local-terminal/src/main/cpp/`) detects host OS and either:
- Linux/macOS: invokes `make android_defconfig && make CROSS_COMPILE= CC=<ndk-clang> HOSTCC=<host-cc>` per ABI, renames produced `toybox` binary to `libtoybox.so` for W^X.
- Windows without MinGW: prints a warning and **skips** the toybox build (pty_jni + libmksh.so still build; the local terminal will lack basic commands at runtime until CI rebuilds).

This matches the design doc §5 Trap 1 — output binary must be `lib*.so` named, placed in
`lib/<abi>/` for Android 10+ W^X execution.

## Replacing this version

```bash
NEW_TAG=0.8.12   # example
curl -fsSL -o /tmp/toybox.tar.gz \
  "https://github.com/landley/toybox/archive/refs/tags/${NEW_TAG}.tar.gz"
rm -rf android-app/third_party/toybox/*
tar -xzf /tmp/toybox.tar.gz -C /tmp/
cp -r /tmp/toybox-${NEW_TAG}/. android-app/third_party/toybox/
cd android-app/third_party/toybox
rm -rf tests/ .github/ .gitignore
# Update Pinned tag in this file
```

## License summary

```
Copyright (C) 2006, 2019 by Rob Landley <rob@landley.net>
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.
```

Full text in `LICENSE`. Equivalent to 0BSD / SPDX "0BSD". MIT-compatible (one-way: 0BSD
software can be embedded in MIT projects without restriction).
