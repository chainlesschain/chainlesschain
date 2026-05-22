package com.chainlesschain.android.di

import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.NoOpLlmInferenceEngine
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * A3 — provides [LlmInferenceEngine] for the local LLM server.
 *
 * Default: [NoOpLlmInferenceEngine] — refuses inference with "engine not
 * wired" message. Real backend (kotlinllamacpp JNI / mediapipe-llm / etc)
 * is swapped here once package resolution is confirmed on a Mac/Linux dev
 * box (see TODO in app/build.gradle.kts §A3 deps).
 *
 * Note: not using @Binds because NoOpLlmInferenceEngine is an `object`
 * (singleton by definition); @Provides returns the object instance directly.
 * When the real engine arrives it'll likely become a class with @Inject
 * constructor; at that point switch to @Binds + abstract Module.
 */
@Module
@InstallIn(SingletonComponent::class)
object LlmModule {

    @Provides
    @Singleton
    fun provideLlmInferenceEngine(): LlmInferenceEngine = NoOpLlmInferenceEngine
}
