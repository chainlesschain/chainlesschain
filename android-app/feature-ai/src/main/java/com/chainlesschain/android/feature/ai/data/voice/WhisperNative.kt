package com.chainlesschain.android.feature.ai.data.voice

/**
 * Android v1.1 issue #19 W4 — Kotlin binding to whisper.cpp native lib。
 *
 * **使用模式（推荐）**：
 * ```
 * val native = WhisperNative()
 * val ctx = native.initContext("/abs/path/to/ggml-base.bin")
 * if (ctx == 0L) throw WhisperNotInstalledException(WhisperModel.Base)
 * try {
 *     val text = native.transcribe(ctx, pcm16kFloat, 16000, "zh")
 * } finally {
 *     native.freeContext(ctx)
 * }
 * ```
 *
 * **JNI 包名 escape**：Kotlin/Java 包名带下划线 `feature_ai` → JNI 符号
 * `feature_1ai` (`_1` escape `_`)。详
 * https://docs.oracle.com/javase/8/docs/technotes/guides/jni/spec/design.html
 *
 * **测试隔离**：不能让 [WhisperAsrEngine] 直接 `System.loadLibrary` —— 部分场景
 * (Robolectric / host JVM) 没 .so，会 UnsatisfiedLinkError 立刻 crash。封装在
 * 本类的 `companion init`，只当代码真访问 [WhisperNative] 才触发 load；测试用
 * fake `AsrEngine` (不引用本类) 绕开。
 *
 * W4a: getWhisperVersion 仅 build infra 验证 (commit 378b09a1a)。
 * W4b: initContext / transcribe / freeContext 真接口 (本 commit)。
 * W4c+: WhisperModelDownloader 提供 path；W4d 接通 WhisperAsrEngine.transcribe。
 */
internal class WhisperNative {
    companion object {
        @Volatile private var libraryLoaded = false

        @JvmStatic
        fun ensureLoaded() {
            if (!libraryLoaded) {
                synchronized(this) {
                    if (!libraryLoaded) {
                        System.loadLibrary("whisper_jni")
                        libraryLoaded = true
                    }
                }
            }
        }
    }

    init { ensureLoaded() }

    /**
     * 返 whisper.cpp system info 字符串（CPU 特性 / build flags）。W4a 验证
     * native link 通 + JNI round-trip 健康。
     */
    external fun getWhisperVersion(): String

    /**
     * 加载 ggml 模型返 native context pointer cast 为 Long。
     *
     * @param modelPath ggml 模型文件绝对路径
     * @return native ctx pointer (Long); **0 表加载失败**（文件不存在 / ggml
     *         format 不识别 / 内存不够），调用方必须判断 != 0L 再用
     *
     * Base 模型加载期峰值内存 ~500MB。调用方应在 Dispatchers.IO / Default 协程
     * 中执行避免阻塞主线程。
     */
    external fun initContext(modelPath: String): Long

    /**
     * 推理 PCM 音频返文字。
     *
     * @param ctxPtr    [initContext] 返回的 long pointer (0 视作 noop 返空串)
     * @param pcmAudio  16kHz mono FloatArray (range -1.0f ~ 1.0f)
     * @param sampleRate 当前 whisper 实质只支持 16000；外部应预 resample
     * @param language  ISO 639-1: "zh" / "en" / "auto"
     * @return UTF-8 转录文本（所有 segments 拼接，无 timestamp）；失败 / null
     *         ctx 返空串
     *
     * 同步阻塞；必须在 Dispatchers.Default / IO 协程中调。Base 模型 5s 录音
     * Pixel 6 实测 ~1.5s 首字。
     */
    external fun transcribe(
        ctxPtr: Long,
        pcmAudio: FloatArray,
        sampleRate: Int,
        language: String,
    ): String

    /**
     * 释放 native ctx。调用后 [ctxPtr] 失效。**必须**在 app 退出 / 切模型时
     * 调用，否则 native context (500MB / base) 泄露。
     *
     * 习惯模式：`use { ... }` 风格不可（external fun 非 Closeable），用
     * `try/finally` 包 [transcribe]。
     */
    external fun freeContext(ctxPtr: Long)
}
