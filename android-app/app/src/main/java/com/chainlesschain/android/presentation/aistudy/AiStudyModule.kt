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

    @Binds
    @Singleton
    abstract fun bindMistakeBook(impl: InMemoryMistakeBook): MistakeBook

    @Binds
    @Singleton
    abstract fun bindGuardrailClassifier(impl: KeywordGuardrailClassifier): GuardrailClassifier

    @Binds
    @Singleton
    abstract fun bindGuardrailEventSink(impl: InMemoryGuardrailEventSink): GuardrailEventSink

    @Binds
    @Singleton
    abstract fun bindStudyTaskContext(impl: InMemoryStudyTaskContext): StudyTaskContext

    // M9 奖励/积分账本 seam (内存态; SQLCipher 持久化 follow-up)。
    @Binds
    @Singleton
    abstract fun bindPointsLedger(impl: InMemoryPointsLedger): PointsLedger

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
}
