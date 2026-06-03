// Android v1.1 issue #19 W4 JNI binding to whisper.cpp。
//
// W4a: getWhisperVersion() smoke test 证 link 通 (commit 378b09a1a)。
// W4b: initContext / transcribe / freeContext 真接口。
//
// 调用顺序：
//   ctx = initContext("/abs/path/to/ggml-base.bin")   // 一次 / 长期持有
//   text = transcribe(ctx, pcmFloat16k, 16000, "zh")  // 多次 reuse ctx
//   freeContext(ctx)                                  // app 退出 / 切模型
//
// **重要**：transcribe 在 Dispatchers.Default 协程中调用；Kotlin 端必须 catch
// CancellationException 后调 freeContext 释放 native ctx —— 否则 long pointer
// leak 是常见 JNI 内存压力问题（base 模型 ~500MB / ctx）。
//
// W4c: WhisperModelDownloader 写模型文件到 context.filesDir/whisper-models/。
// W4d: WhisperAsrEngine.transcribe 接 WAV→16kHz PCM converter + native 路径。

#include <jni.h>
#include <string>
#include <vector>
#include "whisper.h"
#include <android/log.h>

#define LOG_TAG "WhisperJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// JNI package escape: Kotlin `feature.ai` → `feature_1ai`（下划线 escape 为 _1）
// 详 https://docs.oracle.com/javase/8/docs/technotes/guides/jni/spec/design.html

extern "C" JNIEXPORT jstring JNICALL
Java_com_chainlesschain_android_feature_1ai_data_voice_WhisperNative_getWhisperVersion(
    JNIEnv *env, jobject /* thiz */) {
    const char *info = whisper_print_system_info();
    LOGI("whisper system info: %s", info);
    std::string out = "whisper.cpp linked OK. system_info: ";
    out += info;
    return env->NewStringUTF(out.c_str());
}

/**
 * W4b: 初始化 whisper context 加载 ggml 模型。
 *
 * @param model_path 绝对路径 e.g. /data/data/<pkg>/files/whisper-models/ggml-base.bin
 * @return ctx pointer cast to jlong (0 表加载失败)
 *
 * 失败原因常见：文件不存在 / ggml format invalid / 内存不够（base 模型加载
 * 期峰值 ~500MB）。返 0 Kotlin 端必须判断并抛 WhisperNotInstalledException。
 */
extern "C" JNIEXPORT jlong JNICALL
Java_com_chainlesschain_android_feature_1ai_data_voice_WhisperNative_initContext(
    JNIEnv *env, jobject /* thiz */, jstring model_path) {
    if (model_path == nullptr) {
        LOGE("initContext: null model_path");
        return 0;
    }

    const char *path = env->GetStringUTFChars(model_path, nullptr);
    if (path == nullptr) {
        LOGE("initContext: GetStringUTFChars returned null");
        return 0;
    }

    LOGI("initContext: loading model from %s", path);

    struct whisper_context_params cparams = whisper_context_default_params();
    // W4b default：CPU 推理。W4d+ 可探索 use_gpu=true (whisper.cpp v1.5+ 支持
    // OpenCL 在部分 Android GPU，目前 vendor 时已删 OpenCL backend 故 false)
    cparams.use_gpu = false;

    struct whisper_context *ctx = whisper_init_from_file_with_params(path, cparams);

    env->ReleaseStringUTFChars(model_path, path);

    if (ctx == nullptr) {
        LOGE("initContext: whisper_init_from_file_with_params returned null");
        return 0;
    }

    LOGI("initContext: success, ctx=%p", static_cast<void *>(ctx));
    return reinterpret_cast<jlong>(ctx);
}

/**
 * W4b: 推理 PCM 音频返文字。
 *
 * @param ctx_ptr   initContext 返回的 long pointer (0 视作 noop 返空串)
 * @param pcm_audio 16kHz mono float[] (range -1.0 ~ 1.0)
 * @param sample_rate 当前 whisper 实质只支持 16000，留参便于未来 resample 加在
 *                    native 侧；外部调用方应保证已 16k
 * @param language  ISO 639-1 code "zh" / "en" / "auto" 等
 * @return UTF-8 转录文本（所有 segment 拼接，无 timestamp）
 *
 * 同步阻塞；调用方必须在 Dispatchers.Default / Dispatchers.IO 协程中调。base
 * 模型 5s 录音 Pixel 6 实测 ~1.5s 首字。
 */
extern "C" JNIEXPORT jstring JNICALL
Java_com_chainlesschain_android_feature_1ai_data_voice_WhisperNative_transcribe(
    JNIEnv *env, jobject /* thiz */, jlong ctx_ptr, jfloatArray pcm_audio,
    jint sample_rate, jstring language) {

    if (ctx_ptr == 0) {
        LOGW("transcribe: null ctx_ptr → return empty");
        return env->NewStringUTF("");
    }
    auto *ctx = reinterpret_cast<whisper_context *>(ctx_ptr);

    // 注：sample_rate 仅 logging；whisper 内部硬编 16k，外部已保证
    if (sample_rate != WHISPER_SAMPLE_RATE) {
        LOGW("transcribe: sample_rate=%d != WHISPER_SAMPLE_RATE=%d (caller must resample)",
             sample_rate, WHISPER_SAMPLE_RATE);
    }

    jfloat *pcm = env->GetFloatArrayElements(pcm_audio, nullptr);
    if (pcm == nullptr) {
        LOGE("transcribe: GetFloatArrayElements returned null");
        return env->NewStringUTF("");
    }
    jsize n_samples = env->GetArrayLength(pcm_audio);

    struct whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);

    const char *lang_str = nullptr;
    if (language != nullptr) {
        lang_str = env->GetStringUTFChars(language, nullptr);
        wparams.language = lang_str;
    }
    wparams.translate = false;
    wparams.print_realtime = false;
    wparams.print_progress = false;
    wparams.print_special = false;
    wparams.print_timestamps = false;
    // Android 4-8 核常见，n_threads=4 兼顾性能 / 发热
    wparams.n_threads = 4;
    // single_segment 简化输出 — W4b 阶段不需要 segment 时间戳
    wparams.single_segment = false;
    wparams.no_context = true;
    wparams.suppress_blank = true;

    LOGI("transcribe: running whisper_full (n_samples=%d, lang=%s, threads=%d)",
         n_samples, wparams.language ? wparams.language : "(null)", wparams.n_threads);

    int rc = whisper_full(ctx, wparams, pcm, n_samples);

    env->ReleaseFloatArrayElements(pcm_audio, pcm, JNI_ABORT);
    if (lang_str != nullptr) env->ReleaseStringUTFChars(language, lang_str);

    if (rc != 0) {
        LOGE("transcribe: whisper_full failed rc=%d", rc);
        return env->NewStringUTF("");
    }

    // 拼所有 segments
    int n_segments = whisper_full_n_segments(ctx);
    std::string result;
    for (int i = 0; i < n_segments; ++i) {
        const char *seg = whisper_full_get_segment_text(ctx, i);
        if (seg != nullptr) result += seg;
    }

    LOGI("transcribe: success, n_segments=%d, text_len=%zu", n_segments, result.size());
    return env->NewStringUTF(result.c_str());
}

/**
 * W4b: 释放 whisper context。
 *
 * 调用 free 后 ctx_ptr 不可再用。Kotlin 端持有 ctx 的对象 finalize / close
 * 调用本函数。Android v1.1 W4b 路线：WhisperAsrEngine 单 ctx 长期持有（lazy
 * init on first transcribe），app 退出 / 切模型时 free。
 */
extern "C" JNIEXPORT void JNICALL
Java_com_chainlesschain_android_feature_1ai_data_voice_WhisperNative_freeContext(
    JNIEnv * /* env */, jobject /* thiz */, jlong ctx_ptr) {
    if (ctx_ptr == 0) {
        LOGW("freeContext: null ctx_ptr → noop");
        return;
    }
    auto *ctx = reinterpret_cast<whisper_context *>(ctx_ptr);
    LOGI("freeContext: ctx=%p", static_cast<void *>(ctx));
    whisper_free(ctx);
}
