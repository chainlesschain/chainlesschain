package com.chainlesschain.android.feature.ai.cowork.skills.di

import android.content.Context
import com.chainlesschain.android.feature.ai.cowork.skills.SkillInvoker
import com.chainlesschain.android.feature.ai.cowork.skills.bridge.P2PSkillBridge
import com.chainlesschain.android.feature.ai.cowork.skills.executor.SkillCommandParser
import com.chainlesschain.android.feature.ai.cowork.skills.executor.SkillExecutor
import com.chainlesschain.android.feature.ai.cowork.skills.gating.SkillGating
import com.chainlesschain.android.feature.ai.cowork.skills.handler.*
import com.chainlesschain.android.feature.ai.cowork.skills.loader.SkillLoader
import com.chainlesschain.android.feature.ai.cowork.skills.loader.SkillMdParser
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt DI module for the Skills System.
 */
@Module
@InstallIn(SingletonComponent::class)
object SkillModule {

    @Provides
    @Singleton
    fun provideSkillMdParser(): SkillMdParser {
        return SkillMdParser()
    }

    @Provides
    @Singleton
    fun provideSkillRegistry(): SkillRegistry {
        return SkillRegistry()
    }

    @Provides
    @Singleton
    fun provideSkillGating(
        @ApplicationContext context: Context
    ): SkillGating {
        return SkillGating(context)
    }

    @Provides
    @Singleton
    fun provideSkillLoader(
        @ApplicationContext context: Context,
        parser: SkillMdParser,
        registry: SkillRegistry
    ): SkillLoader {
        val loader = SkillLoader(context, parser, registry)
        // Load all skills on startup
        loader.loadAll()
        return loader
    }

    @Provides
    @Singleton
    fun provideSkillHandlers(): Map<String, SkillHandler> {
        val handlers = listOf(
            CodeReviewHandler(),
            ExplainCodeHandler(),
            SummarizeHandler(),
            TranslateHandler(),
            RefactorHandler(),
            UnitTestHandler(),
            DebugHandler(),
            QuickNoteHandler(),
            EmailDraftHandler(),
            MeetingNotesHandler(),
            DailyPlannerHandler(),
            TextImproverHandler()
        )
        return handlers.associateBy { it.skillName }
    }

    @Provides
    @Singleton
    fun provideP2PSkillBridge(
        p2pClient: P2PClient
    ): P2PSkillBridge {
        return P2PSkillBridge(p2pClient)
    }

    @Provides
    @Singleton
    fun provideSkillExecutor(
        registry: SkillRegistry,
        gating: SkillGating,
        handlers: Map<String, SkillHandler>,
        llmAdapter: LLMAdapter,
        p2pBridge: P2PSkillBridge,
        @Suppress("UNUSED_PARAMETER") loader: SkillLoader  // ensures skills are loaded first
    ): SkillExecutor {
        return SkillExecutor(registry, gating, handlers, llmAdapter, p2pBridge)
    }

    @Provides
    @Singleton
    fun provideSkillCommandParser(
        registry: SkillRegistry,
        @Suppress("UNUSED_PARAMETER") loader: SkillLoader  // ensures skills are loaded first
    ): SkillCommandParser {
        return SkillCommandParser(registry)
    }

    @Provides
    @Singleton
    fun provideSkillInvoker(
        executor: SkillExecutor,
        registry: SkillRegistry
    ): SkillInvoker {
        return SkillInvoker(executor, registry)
    }
}
