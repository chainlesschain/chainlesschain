# Vendored whisper.cpp source

**Upstream**: https://github.com/ggerganov/whisper.cpp
**Pinned version**: `v1.5.4`
**Tarball**: https://github.com/ggerganov/whisper.cpp/archive/refs/tags/v1.5.4.tar.gz
**Vendored on**: 2026-05-12 (Android v1.1 W4a，issue #19)
**License**: MIT (see `LICENSE`)

## Pruning rationale

Vendored from upstream tarball (not git submodule — schannel HTTPS clone repeatedly
failed mid-stream on dev box). Source size reduced from 15MB → 1.5MB by removing:

| Removed | Size | Reason |
|---|---|---|
| `examples/` | 4.6MB | Apple/macOS demo apps, not built for Android |
| `models/` | 5.1MB | Model conversion scripts (Python), not runtime |
| `bindings/` | 2MB | Go/Ruby/JS/iOS/Java bindings, irrelevant for Android JNI |
| `tests/` | (auto-skipped via `WHISPER_BUILD_TESTS=OFF`) | — |
| `samples/` | 346KB | Audio test fixtures, not needed for build |
| `coreml/` | mostly inert (gated by `WHISPER_COREML` flag), removed | macOS/iOS only |
| `grammars/` | 244KB | Grammar examples, not used |
| `openvino/`, `extra/`, `spm-headers/` | ~30KB | dev tooling, unused |
| `ggml-cuda.cu` / `ggml-cuda.h` / `ggml-metal.*` / `ggml-opencl.*` / `ggml-mpi.*` | ~700KB | platform-specific GPU/SIMD backends, Android uses CPU + NEON only |
| `Package.swift`, `Makefile` | tiny | non-CMake build entry points |

Kept core CPU inference path:
- `whisper.{h,cpp}` — main API
- `ggml.{h,c}`, `ggml-alloc.{h,c}`, `ggml-backend.{h,c}`, `ggml-quants.{h,c}` — core tensor engine
- `ggml-impl.h`, `ggml-backend-impl.h` — internal headers
- `CMakeLists.txt` (patched, see below)
- `cmake/` — Find* helper modules

## Patches applied to upstream

| File | Patch | Reason |
|---|---|---|
| `CMakeLists.txt` line 564 | Commented out `add_subdirectory(bindings)` | bindings/ pruned |
| `CMakeLists.txt` lines 570-573 | Commented out `WHISPER_BUILD_TESTS` block | tests/ pruned (defensive — also gated by option set to OFF) |

Examples gating (`WHISPER_BUILD_EXAMPLES`) already off via our top-level CMakeLists,
no patch needed.

## Updating to a newer version

```bash
cd android-app/third_party
rm -rf whisper.cpp
curl -fsSL -o /tmp/whisper.cpp-vNEW.tar.gz \
  https://github.com/ggerganov/whisper.cpp/archive/refs/tags/vNEW.tar.gz
tar -xzf /tmp/whisper.cpp-vNEW.tar.gz
mv whisper.cpp-NEW whisper.cpp
cd whisper.cpp
rm -rf examples models bindings tests samples coreml grammars openvino extra \
       spm-headers Package.swift Makefile \
       ggml-cuda.* ggml-metal.* ggml-opencl.* ggml-mpi.*
# Re-apply patches to CMakeLists.txt (bindings + tests subdirs)
# Update this VENDOR_INFO.md
```

## Why not git submodule?

Tried twice on dev box (2026-05-12). Both attempts died mid-clone with schannel
errors: `RPC failed; curl 56 schannel: server closed abruptly (missing close_notify)`.
Common on Windows + flaky network. Tarball curl is single connection, no
incremental pack receive, more robust on lossy links.

If team standardizes on Linux/macOS dev boxes or schannel issues resolve,
W4 follow-up could revert to submodule.
