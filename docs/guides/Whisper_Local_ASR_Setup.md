# Whisper 本地 ASR 集成指南

> **状态**: 🟡 v1.1 stub 架构落地，真集成 v1.2 (2026-Q4)
> **关联**: [Android v1.1 issue #19 W4](https://github.com/chainlesschain/chainlesschain/issues/19) / [P2P 三层定位 §9.1 中文识别](../design/Android_重新定位_设计文档.md)
> **作用域**: 帮 v1.2 实施者把 [`WhisperAsrEngine.transcribe()`](../../android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/data/voice/WhisperAsrEngine.kt) 从 stub 真做完。

---

## 1. v1.1 已落 (架构 ready)

| | |
|---|---|
| `feature-ai/data/voice/AsrEnginePreferences.kt` | SharedPreferences 持久化 user 选 (engine + whisperModel) |
| `feature-ai/data/voice/WhisperAsrEngine.kt` | stub 实 AsrEngine 接口；transcribe 抛 [WhisperNotInstalledException] 含安装指引 |
| `feature-ai/data/voice/AsrEngineRouter.kt` | 实 AsrEngine 接口；按 preferences 路由 Volcengine / Whisper |
| `feature-ai/di/AIModule.kt` | provideAsrEngine 改返 router；现有 VoiceModeManager 透明 multi-engine |
| `app/.../presentation/screens/asr/AsrEngineSettingsScreen.kt + ViewModel` | Compose Settings: 引擎 RadioGroup + Whisper 模型 RadioGroup + 安装指示 |
| `WhisperModel` enum | tiny (39MB) / base (142MB) / small (466MB) 三档 metadata |

**v1.2 实施者要做的**：把 [`WhisperAsrEngine.transcribe()`](../../android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/data/voice/WhisperAsrEngine.kt) 从抛异常改为真调 whisper.cpp JNI。其他文件不改。

---

## 2. whisper.cpp 集成路线（v1.2）

### 2.1 系统约束

| | |
|---|---|
| **目标 OS** | Android 8.0+ (API 26) — 同 ChainlessChain minSdk |
| **ABI** | `arm64-v8a` 主；`armeabi-v7a` 次（兼容老设备）；`x86_64` 调试 emulator |
| **NDK** | r25+ |
| **CMake** | 3.22+ |
| **设备 RAM** | base 模型推理峰值 ~500MB；tiny ~150MB；small ~1.2GB |
| **存储** | 模型文件落 `context.filesDir/whisper-models/`（用户清缓存不删） |

### 2.2 4-step 实施

#### Step 1：whisper.cpp 引入（推荐 git submodule）

```bash
cd android-app
git submodule add https://github.com/ggerganov/whisper.cpp third_party/whisper.cpp
git submodule update --init --recursive

# 锁定一个稳定 tag（不锁会 v1.2 build 漂）
cd third_party/whisper.cpp
git checkout v1.5.4  # 或更新 stable
cd ../..
git add third_party/whisper.cpp
```

#### Step 2：CMakeLists.txt + ABI 配置

新建 `android-app/feature-ai/src/main/cpp/CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.22.1)
project("whisper_jni")

# whisper.cpp 源
set(WHISPER_SRC ${CMAKE_SOURCE_DIR}/../../../../third_party/whisper.cpp)

# Android-specific build flags
set(WHISPER_NO_AVX ON CACHE BOOL "")
set(WHISPER_NO_AVX2 ON CACHE BOOL "")
set(WHISPER_NO_FMA ON CACHE BOOL "")
set(WHISPER_NO_F16C ON CACHE BOOL "")
# arm64 特定
if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(WHISPER_NO_NEON OFF CACHE BOOL "")
    add_definitions(-DWHISPER_USE_OPENBLAS_OFF)
endif()

# 编 whisper static lib
add_subdirectory(${WHISPER_SRC} whisper_build)

# JNI binding
add_library(whisper_jni SHARED
    whisper_jni.cpp
)

target_include_directories(whisper_jni PRIVATE
    ${WHISPER_SRC}
)

target_link_libraries(whisper_jni
    whisper
    log
)
```

更新 `feature-ai/build.gradle.kts`:

```kotlin
android {
    // ... existing ...

    defaultConfig {
        externalNativeBuild {
            cmake {
                cppFlags += "-std=c++17"
                arguments += "-DANDROID_STL=c++_shared"
            }
            ndk {
                abiFilters += listOf("arm64-v8a", "armeabi-v7a")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }
}
```

#### Step 3：JNI Kotlin binding

新建 `android-app/feature-ai/src/main/cpp/whisper_jni.cpp`:

```cpp
#include <jni.h>
#include <string>
#include "whisper.h"
#include <android/log.h>

#define LOG_TAG "WhisperJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

extern "C" JNIEXPORT jlong JNICALL
Java_com_chainlesschain_android_feature_ai_data_voice_WhisperNative_initContext(
    JNIEnv *env, jobject thiz, jstring model_path) {
    const char *path = env->GetStringUTFChars(model_path, nullptr);
    struct whisper_context_params cparams = whisper_context_default_params();
    struct whisper_context *ctx = whisper_init_from_file_with_params(path, cparams);
    env->ReleaseStringUTFChars(model_path, path);
    return reinterpret_cast<jlong>(ctx);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_chainlesschain_android_feature_ai_data_voice_WhisperNative_transcribe(
    JNIEnv *env, jobject thiz, jlong ctx_ptr, jfloatArray pcm_audio,
    jint sample_rate, jstring language) {
    auto *ctx = reinterpret_cast<whisper_context *>(ctx_ptr);

    jfloat *pcm = env->GetFloatArrayElements(pcm_audio, nullptr);
    jsize n_samples = env->GetArrayLength(pcm_audio);

    struct whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    const char *lang = env->GetStringUTFChars(language, nullptr);
    wparams.language = lang;
    wparams.translate = false;
    wparams.print_realtime = false;
    wparams.print_progress = false;
    wparams.n_threads = 4;  // 适合 Android 4 核小核

    int rc = whisper_full(ctx, wparams, pcm, n_samples);

    env->ReleaseFloatArrayElements(pcm_audio, pcm, JNI_ABORT);
    env->ReleaseStringUTFChars(language, lang);

    if (rc != 0) return env->NewStringUTF("");

    // 拼所有 segments
    int n_segments = whisper_full_n_segments(ctx);
    std::string result;
    for (int i = 0; i < n_segments; ++i) {
        result += whisper_full_get_segment_text(ctx, i);
    }
    return env->NewStringUTF(result.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_chainlesschain_android_feature_ai_data_voice_WhisperNative_freeContext(
    JNIEnv *env, jobject thiz, jlong ctx_ptr) {
    auto *ctx = reinterpret_cast<whisper_context *>(ctx_ptr);
    whisper_free(ctx);
}
```

新建 Kotlin 端 `feature-ai/data/voice/WhisperNative.kt`:

```kotlin
internal class WhisperNative {
    companion object {
        init { System.loadLibrary("whisper_jni") }
    }
    external fun initContext(modelPath: String): Long
    external fun transcribe(ctxPtr: Long, pcmAudio: FloatArray, sampleRate: Int, language: String): String
    external fun freeContext(ctxPtr: Long)
}
```

更新 `WhisperAsrEngine.transcribe()` 调用 native：

```kotlin
override suspend fun transcribe(audioFile: File): String = withContext(Dispatchers.Default) {
    val modelFile = File(context.filesDir, "whisper-models/${preferences.whisperModel.value.ggmlFilename}")
    if (!modelFile.exists()) throw WhisperNotInstalledException(preferences.whisperModel.value)

    val pcm = wavTo16kFloatArray(audioFile)  // helper：WAV → 16kHz mono float[]
    val ctx = native.initContext(modelFile.absolutePath)
    try {
        return@withContext native.transcribe(ctx, pcm, 16000, "zh")
    } finally {
        native.freeContext(ctx)
    }
}
```

#### Step 4：模型下载管理

新建 `feature-ai/data/voice/WhisperModelDownloader.kt`：

```kotlin
@Singleton
class WhisperModelDownloader @Inject constructor(
    @ApplicationContext private val context: Context,
    private val httpClient: OkHttpClient,
) {
    suspend fun downloadModel(model: WhisperModel, onProgress: (Float) -> Unit): File {
        val targetDir = File(context.filesDir, "whisper-models").apply { mkdirs() }
        val targetFile = File(targetDir, model.ggmlFilename)
        if (targetFile.exists() && targetFile.length() == model.sizeMB * 1024L * 1024L) {
            return targetFile
        }
        val url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.ggmlFilename}"
        // ... OkHttp download with progress, atomic rename .tmp → final
    }
}
```

新建 Settings UI 「下载模型」按钮调 downloader.downloadModel + 进度条。

---

## 3. 性能基准目标

| 模型 | 5s 录音 → 文字延迟 (Pixel 6 / Snapdragon 8 Gen 1) | 内存峰值 | 中文准确率 (内部测试集) |
|---|---|---|---|
| Tiny | ~700ms | ~150MB | 60% |
| **Base** | ~1.5s | ~500MB | 78% |
| Small | ~4s | ~1.2GB | 85% |
| Volcengine SeedASR (云) | ~500ms | <50MB | 95% |

**v1.2 验收**：
- Whisper Base 中文 5s 录音首字 < 2s（Pixel 6 / Snapdragon 8 Gen 1）
- Whisper Base 内存峰值 < 600MB
- App 包体增量 < 5MB（whisper.cpp 二进制 + ABI splits）

---

## 4. 实施风险

### 4.1 包体爆炸

whisper.cpp 静态库 ~3MB / ABI；4 ABI = 12MB。用 [App Bundle ABI splits](https://developer.android.com/guide/app-bundle/configure) 分发，单设备只下载本机 ABI 那份 ~3MB。

### 4.2 模型存储

ggml-base.bin 142MB 不能 ship 进 APK（Google Play 上限 200MB）。必须**首次启动 / 用户主动**下载。

### 4.3 内存压力

base 模型推理峰值 ~500MB。低端设备 (RAM < 3GB) 容易 OOM。WhisperModel.Small 在 RAM<4GB 直接 disable。Settings UI 加内存检测 + warning。

### 4.4 NDK 跨版本兼容

whisper.cpp 用 SIMD intrinsics (NEON / SSE)。Android NDK r25+ 比较稳；老 NDK 可能编不过。CI 锁 NDK 版本。

### 4.5 LLDD（Long-Lived DataChannel Disposal）

JNI Long pointer 跨 Kotlin 协程取消时需正确 free。建议 `use { ... }` 模式包 `initContext` 自动 close。

---

## 5. v1.2+ 增强

- 流式识别（whisper.cpp 支持流式 API）— VoiceMode 边录边显示文字
- VAD (Voice Activity Detection) 自动断句
- 实时翻译（WHISPER_LANG_ZH 转英文 同时输出）
- 多 language detection（auto-detect 中英混合）
- INT8 quantization 模型（Base INT8 ~70MB / 内存 ~250MB / 速度提 30%）

---

## 变更记录

- 2026-05-12 v1.0 (issue #19 W4 doc)：初稿，4-step 实施路线 + 性能基准 + 风险
