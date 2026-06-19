package com.chainlesschain.android.presentation.aistudy

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * AI 陪学 MVP 的 DI 绑定。两个 impl 都走 @Inject constructor，@Binds 即可。
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class AiStudyModule {

    @Binds
    @Singleton
    abstract fun bindStudyProfileStore(impl: DefaultStudyProfileStore): StudyProfileStore

    @Binds
    @Singleton
    abstract fun bindAiStudyLlm(impl: DefaultAiStudyLlm): AiStudyLlm

    // M6 错题本: family_guard.db mistake_book 真持久 (InMemory 留测试)。
    @Binds
    @Singleton
    abstract fun bindMistakeBook(impl: RoomMistakeBook): MistakeBook

    @Binds
    @Singleton
    abstract fun bindGuardrailClassifier(impl: KeywordGuardrailClassifier): GuardrailClassifier

    // M6 护栏事件: family_guard.db guardrail_event 真持久 (只类别+时间, InMemory 留测试)。
    @Binds
    @Singleton
    abstract fun bindGuardrailEventSink(impl: RoomGuardrailEventSink): GuardrailEventSink

    // M5 防作弊 log 写穿 family_task.ai_call_log (重启不丢; InMemory 留测试)。
    @Binds
    @Singleton
    abstract fun bindStudyTaskContext(
        impl: com.chainlesschain.android.presentation.familytask.PersistingStudyTaskContext,
    ): StudyTaskContext

    // M9 奖励/积分账本: family_guard.db points_event 真持久 (InMemory 留测试/演示)。
    // @RawPointsLedger = 底层真持久, 供收端 applier 注入避免上行 echo。
    @Binds
    @Singleton
    @RawPointsLedger
    abstract fun bindRawPointsLedger(impl: RoomPointsLedger): PointsLedger

    // 默认 (无限定符) = 同步装饰器: 本机 append 自动上行同步给对端 (FAMILY-67)。ViewModel 注入此。
    @Binds
    @Singleton
    abstract fun bindPointsLedger(impl: SyncingPointsLedger): PointsLedger

    @Binds
    @Singleton
    abstract fun bindPointsLedgerOutbox(impl: SyncManagerPointsLedgerOutbox): PointsLedgerOutbox

    @Binds
    @Singleton
    abstract fun bindHomeworkGrader(
        impl: com.chainlesschain.android.presentation.familytask.LlmHomeworkGrader,
    ): com.chainlesschain.android.presentation.familytask.HomeworkGrader

    @Binds
    @Singleton
    abstract fun bindVaultStorage(impl: FileVaultStorage): VaultStorage

    @Binds
    @Singleton
    abstract fun bindCompanionVault(impl: EncryptedCompanionVault): CompanionVault

    // FAMILY-67 Phase 2: 学情报告/任务 共用的"当前孩子 DID"单一真相源。
    @Binds
    @Singleton
    abstract fun bindFamilyStudyContext(
        impl: com.chainlesschain.android.presentation.familytask.DefaultFamilyStudyContext,
    ): com.chainlesschain.android.presentation.familytask.FamilyStudyContext
}
