# Android `assets/frida/` — WeChat Phase 12.10 bundle dir

Files this directory contains for the WeChat in-app collector to function on a real device:

| File | Status | Source | Size |
|------|--------|--------|------|
| `wechat-key-hook.js` | ✅ shipped v0.1 | byte-mirror of `packages/personal-data-hub/lib/adapters/wechat/frida-agent/wechat-key-hook.js` | ~11 KB |
| `frida-inject-arm64` | ✅ shipped v0.2 | [frida 16.5.9 release](https://github.com/frida/frida/releases/tag/16.5.9) — `frida-inject-16.5.9-android-arm64.xz` (xz -d) | 54 MB |
| `frida-inject-arm` | ✅ shipped v0.2 | [frida 16.5.9 release](https://github.com/frida/frida/releases/tag/16.5.9) — `frida-inject-16.5.9-android-arm.xz` (xz -d) | 26 MB |

**APK impact**: +80MB raw, ~30MB compressed in APK (xz→none re-compression by aapt2 helps but not much). v0.2 ships this to sideload / OEM stores only — Play Store rejection assumed.

## Verification (after build)

```bash
# Confirm binaries are valid ELF for Android ARM
file android-app/app/src/main/assets/frida/frida-inject-arm64
# expected: ELF 64-bit LSB shared object, ARM aarch64, ... for Android 21 ...

file android-app/app/src/main/assets/frida/frida-inject-arm
# expected: ELF 32-bit LSB shared object, ARM, EABI5 ... for Android 19 ...

# Sanity check size — frida 16.5.9 native binaries are ~54MB/26MB
ls -lh android-app/app/src/main/assets/frida/
```

## Upgrade path (when frida releases 16.6.x or 17.x)

The agent JS is version-agnostic, but the binaries are tied to frida release. To bump:

## When you add the binaries

Two paths, depending on what you have:

### Path 1: download from frida releases (works on Win/Mac/Linux)

```bash
# Win/Mac/Linux — curl + xz extract; pick latest 16.x.x release.
# All artifacts: https://github.com/frida/frida/releases
mkdir -p android-app/app/src/main/assets/frida
curl -L "https://github.com/frida/frida/releases/download/16.5.9/frida-inject-16.5.9-android-arm64.xz" \
  | xz -d > android-app/app/src/main/assets/frida/frida-inject-arm64
curl -L "https://github.com/frida/frida/releases/download/16.5.9/frida-inject-16.5.9-android-arm.xz" \
  | xz -d > android-app/app/src/main/assets/frida/frida-inject-arm
chmod 755 android-app/app/src/main/assets/frida/frida-inject-arm64  # for local test
```

### Path 2: reuse from `C:\code\sjqz\tools\frida-server`

The user's sjqz fork already ships a real-device-validated frida binary at
`C:\code\sjqz\tools\frida-server` (~ELF ARM aarch64, NDK r25b). **Note**:
that's `frida-server` (long-running daemon), not `frida-inject` (one-shot
CLI we use). Two options:

- **A.** Copy as `frida-server` + rewrite [`WeChatFridaInjector.kt`]
  spawn command to keep it running + use Python frida client semantics
  (matches sjqz `capture_key_v6.py`). More work, but proven.
- **B.** Download matching `frida-inject` from the same 16.x release that
  sjqz frida-server was built against (`strings tools/frida-server | grep
  -i '^frida'` to identify version), then this scaffold works as-is.

v0.1 design assumes **Option B**.

## Build wiring (one-time, after binaries land)

In `android-app/app/build.gradle.kts`:

```kotlin
android {
    packaging {
        jniLibs.useLegacyPackaging = true  // W^X — otherwise exec fails
                                            // see memory `android_native_lib_extract_w_x.md`
    }
}
```

The runtime path itself is already correct: `WeChatFridaInjector` copies
the asset to `/data/local/tmp/cc-frida-inject` (not app filesDir) via `su -c
cp` + chmod 0755, which sidesteps the W^X restriction even without the
useLegacyPackaging flag (the flag matters only if we ever exec from
inside the APK; we always go via /data/local/tmp).

## Reference hook implementation

`wechat-key-hook.js` is a byte-mirror of the desktop side. The agent
covers the same 5 symbols sjqz `capture_key_v6.py` hooks:
`sqlite3_key` / `sqlite3_key_v2` / WCDB::Database::setCipherKey (mangled
C++) / `wcdb_setkey` / `WCDBKeyDerive`. Dual-emits via `send()` AND
`console.log(JSON.stringify(...))` so frida-inject CLI's stdout always
carries the key event (some frida-inject versions don't forward send()
to stdout — relying on console.log is safer for one-shot CLI use).

## See also

- [`docs/design/Android_WeChat_InApp_Frida_Collector.md`](../../../../../docs/design/Android_WeChat_InApp_Frida_Collector.md) — full design + 7 traps
- [`packages/personal-data-hub/lib/adapters/wechat/frida-agent/wechat-key-hook.js`](../../../../../packages/personal-data-hub/lib/adapters/wechat/frida-agent/wechat-key-hook.js) — canonical desktop copy
- Memory `wechat_frida_hook_audit_traps.md` — 3 audit traps when editing the hook
- Memory `android_native_lib_extract_w_x.md` — W^X + extractNativeLibs gotcha
