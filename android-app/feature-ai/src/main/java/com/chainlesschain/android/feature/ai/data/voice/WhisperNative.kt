package com.chainlesschain.android.feature.ai.data.voice

/**
 * Android v1.1 issue #19 W4a — Kotlin binding to whisper.cpp native lib。
 *
 * W4a 只暴露 [getWhisperVersion] 验证 .so load + JNI 调用 round-trip 通。W4b
 * 扩 [initContext] / [transcribe] / [freeContext]。
 *
 * 不能让 [WhisperAsrEngine] 直接 `System.loadLibrary` —— 部分场景（Robolectric
 * 单测 / 集成测试 host JVM）没有 libwhisper_jni.so，会 UnsatisfiedLinkError
 * 立刻 crash。封装在本类的 `companion init`，仅当代码真访问 [WhisperNative]
 * 才触发 load；测试用 fake / mock 注入器替换。
 *
 * **Naming gotcha**：JNI 函数名要包 escape `feature_ai` 的下划线 —— Java/Kotlin
 * package `feature_ai` 在 JNI 翻译为 `feature_1ai`（数字 1 表示 escape）。
 * 详 https://docs.oracle.com/javase/8/docs/technotes/guides/jni/spec/design.html
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
}
