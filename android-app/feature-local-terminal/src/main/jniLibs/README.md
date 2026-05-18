# Pre-built native libs (Linux CI artifacts)

Files in this directory are **pre-built binaries** pulled from CI's
`local-terminal-bundle.yml` workflow artifact. They bridge the
Windows-host build gap — toybox cannot be cross-compiled on Windows
(needs HOSTCC + a Unix-y kconfig pipeline), so we ship pre-built
binaries here and let AGP merge them into the final APK alongside
the locally-CMake-built mksh + libpty_jni.

## Provenance

| File | Source |
|---|---|
| `<abi>/libtoybox.so` | GitHub Actions `local-terminal-bundle.yml` artifact `local-terminal-native-bundle` |

Other native libs (`libmksh.so`, `libpty_jni.so`, `libc++_shared.so`)
are built locally by the feature module's CMake — they do NOT live
under `jniLibs/`.

## Refresh procedure

When `third_party/toybox/` or `third_party/mksh/` vendor source is
bumped, the CI workflow re-builds and uploads a new artifact. To
sync:

```bash
# 1. Identify the latest successful run
gh run list --workflow=local-terminal-bundle.yml --status=success --limit=1

# 2. Download artifact
mkdir -p /tmp/ci-bundle && gh run download <RUN_ID> \
  --name local-terminal-native-bundle -D /tmp/ci-bundle

# 3. Sync libtoybox.so per ABI
for abi in arm64-v8a armeabi-v7a x86_64; do
  cp /tmp/ci-bundle/intermediates/cxx/*/*/obj/$abi/libtoybox.so \
     android-app/feature-local-terminal/src/main/jniLibs/$abi/
done

# 4. Commit + push
git add android-app/feature-local-terminal/src/main/jniLibs/
git commit -m "chore(local-terminal): refresh toybox jniLibs from CI run <RUN_ID>"
```

## Why not auto-download in Gradle

Considered + deferred — the auto-download adds a build-time network
dependency and complicates offline / air-gapped builds. The manual
"refresh after vendor bump" approach is rare-event work (~once per
toybox release) and the docs above make it a 4-step copy-paste.

## ELF inspection

```bash
file android-app/feature-local-terminal/src/main/jniLibs/arm64-v8a/libtoybox.so
# Expected: ELF 64-bit LSB pie executable, ARM aarch64, ... for Android 28
```
