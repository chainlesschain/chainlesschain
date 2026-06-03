package com.chainlesschain.android.di

import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.MediaPipeLlmEngine
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * §2.1 A3.3 v0.2 — provides [LlmInferenceEngine] for the local LLM server.
 *
 * Wires [MediaPipeLlmEngine] as the default (active 2026-05-23).
 *
 * History: v0.1 wired KotlinLlamaCppEngine but per `pdh_llm_native_dep_audit.md`
 * none of the candidate llama.cpp Android Kotlin/JNA bindings have published
 * Maven/JitPack artifacts. MediaPipe tasks-genai is Google-maven-published with
 * prebuilt arm64-v8a .so — pivot completes the 推文 §"无网也能用" promise
 * without requiring Mac/Linux NDK builds.
 *
 * Cross-platform fail-fast behavior:
 *  - JVM unit test (no MediaPipe .so on test classpath) → engine.health()
 *    reports "MediaPipe tasks-genai 未加载" + engine.chat() throws
 *    LlmInferenceException → cc surfaces actionable error in UI
 *  - Real device (Android APK includes the AAR) → LlmInference loaded lazily
 *    on first chat() → 推文 §"端侧 LLM" 真接通
 *
 * Tests override via [MediaPipeLlmEngine.nativeLoadedOverride] or by replacing
 * this binding with a test module that returns NoOp / mock.
 *
 * KotlinLlamaCppEngine + NoOpLlmInferenceEngine remain in package as alternate
 * impl options; switch via this binding when wiring a different backend.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class LlmModule {

    @Binds
    @Singleton
    abstract fun bindLlmInferenceEngine(impl: MediaPipeLlmEngine): LlmInferenceEngine
}
