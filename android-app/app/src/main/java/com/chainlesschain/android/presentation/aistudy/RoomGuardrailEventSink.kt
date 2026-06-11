package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.dao.GuardrailEventDao
import com.chainlesschain.android.feature.familyguard.data.entity.GuardrailEventEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * M6 第 2 层护栏命中事件真持久实现 (主文档 §3.6): family_guard.db `guardrail_event`
 * 表 (SQLCipher 加密, :feature-family-guard [GuardrailEventDao])。
 *
 * **隐私契约延续: 只落 类别 + tab + 时间，绝不落聊天原文** —— 学情报告的
 * 「需要关注」跨重启不再丢。Write-through 缓存保持 [GuardrailEventSink] 同步接口
 * 零消费方改动 (同 [RoomMistakeBook] 模式): 启动异步回灌, record 先进内存再异步
 * 落库; 未知 category/tab 枚举行 (未来版本) 丢弃不崩。
 */
@Singleton
class RoomGuardrailEventSink @Inject constructor(
    private val dao: GuardrailEventDao,
) : GuardrailEventSink {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _findings = MutableStateFlow<List<GuardrailFinding>>(emptyList())
    override val findings: StateFlow<List<GuardrailFinding>> = _findings.asStateFlow()

    private val loadJob: Job = scope.launch {
        val persisted = dao.getAll().mapNotNull { it.toDomain() }
        _findings.update { early -> persisted + early }
    }

    override fun record(finding: GuardrailFinding) {
        _findings.update { it + finding }
        scope.launch { dao.insert(finding.toEntity()) }
    }

    /** 测试用: 等启动回灌完成。 */
    internal suspend fun awaitLoaded() = loadJob.join()

    /** 测试用: 等所有已发起的落库写完成。 */
    internal suspend fun awaitIdle() {
        scope.coroutineContext[Job]?.children?.forEach { it.join() }
    }

    private fun GuardrailFinding.toEntity() = GuardrailEventEntity(
        category = category.name,
        tab = tab.name,
        timestamp = timestamp,
    )

    private fun GuardrailEventEntity.toDomain(): GuardrailFinding? {
        val risk = RiskCategory.entries.firstOrNull { it.name == category } ?: return null
        val studyTab = AiStudyTab.entries.firstOrNull { it.name == tab } ?: return null
        return GuardrailFinding(category = risk, tab = studyTab, timestamp = timestamp)
    }
}
