package com.chainlesschain.android.di

import com.chainlesschain.android.pdh.llm.KotlinLlamaCppEngine
import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * §2.1 A3.3 — provides [LlmInferenceEngine] for the local LLM server.
 *
 * Wires [KotlinLlamaCppEngine] as the default. The engine itself is
 * structured to fail-fast gracefully when the native libllama.so isn't
 * present (CI / Win compile), so swapping NoOp → real engine is safe
 * cross-platform:
 *
 *  - Win / CI (no .so) → engine.health() reports "native lib unavailable"
 *    + engine.chat() throws LlmInferenceException with clear text → cc
 *    surfaces in UI as actionable error
 *  - Real device (kotlinllamacpp v0.2 dep + .so packaged) → native ctx
 *    loaded lazily on first chat() → 推文 §"端侧 LLM" 真接通
 *
 * Tests can override via [KotlinLlamaCppEngine.nativeLoadedOverride] or
 * by replacing this binding with a test module that returns NoOp / mock.
 *
 * NoOpLlmInferenceEngine is retained (in [com.chainlesschain.android.pdh.llm])
 * for unit-test convenience but no longer wired by default.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class LlmModule {

    @Binds
    @Singleton
    abstract fun bindLlmInferenceEngine(impl: KotlinLlamaCppEngine): LlmInferenceEngine
}
