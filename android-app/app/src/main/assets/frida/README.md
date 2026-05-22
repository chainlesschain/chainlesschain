# Android `assets/frida/` — WeChat Phase 12.10 bundle dir

Files this directory should contain for the WeChat in-app collector to function on a real device:

| File | Status | Source | Size |
|------|--------|--------|------|
| `wechat-key-hook.js` | ✅ shipped (v0.1) | byte-mirror of `packages/personal-data-hub/lib/adapters/wechat/frida-agent/wechat-key-hook.js` | ~9 KB |
| `frida-inject-arm64` | ❌ pending v0.2 | frida-core 16.x release `frida-inject-android-arm64` | ~7-10 MB |
| `frida-inject-arm` | ❌ pending v0.2 | frida-core 16.x release `frida-inject-android-arm` | ~7-10 MB |

## Why the binaries are missing

The two `frida-inject` binaries are intentionally excluded from v0.1 because:
1. They cannot be verified to actually work on a Win dev box (no rooted Android device, no Magisk-su)
2. They bloat the APK +14-20 MB
3. They get this app flagged on Play Store as "embeds executable code that modifies other apps' behavior"

v0.2 ships them gated behind a build variant (or sideload-only flavor) once a real-device E2E pass on Xiaomi/Magisk + WeChat 8.0.50+ proves the injection actually attaches.

## When you add the binaries

```bash
# from a Mac/Linux box with frida-tools installed
mkdir -p android-app/app/src/main/assets/frida
curl -L https://github.com/frida/frida/releases/download/16.x.x/frida-inject-16.x.x-android-arm64.xz | xz -d > android-app/app/src/main/assets/frida/frida-inject-arm64
curl -L https://github.com/frida/frida/releases/download/16.x.x/frida-inject-16.x.x-android-arm.xz   | xz -d > android-app/app/src/main/assets/frida/frida-inject-arm

# wire android-app/app/build.gradle.kts:
#   android.defaultConfig.packaging.jniLibs.useLegacyPackaging = true
# (otherwise W^X strips the +x bit — see memory android_native_lib_extract_w_x.md)
```

## See also

- [`docs/design/Android_WeChat_InApp_Frida_Collector.md`](../../../../../docs/design/Android_WeChat_InApp_Frida_Collector.md) — full design + 7 traps
- [`packages/personal-data-hub/lib/adapters/wechat/frida-agent/wechat-key-hook.js`](../../../../../packages/personal-data-hub/lib/adapters/wechat/frida-agent/wechat-key-hook.js) — canonical desktop copy
- Memory `wechat_frida_hook_audit_traps.md` — 3 audit traps when editing the hook
- Memory `android_native_lib_extract_w_x.md` — W^X + extractNativeLibs gotcha
