package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.feature.familyguard.data.dao.MistakeBookDao
import com.chainlesschain.android.feature.familyguard.data.entity.MistakeEntryEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * M6 错题本真持久实现 (主文档 §3.6): family_guard.db `mistake_book` 表
 * (SQLCipher 加密, :feature-family-guard [MistakeBookDao])。
 *
 * **Write-through 缓存**保持 [MistakeBook] 同步接口不变 (消费方 AiStudyViewModel /
 * FamilyTaskViewModel / MistakeRetriever 零改动): 启动异步回灌内存 StateFlow,
 * 变更先进内存再异步落库。启动回灌完成前的短窗口 entries 为空 — 与陪伴金库
 * init 恢复同取向, RAG 检索容空。未知 grade/subject 枚举行 (未来版本) 丢弃不崩。
 */
@Singleton
class RoomMistakeBook @Inject constructor(
    private val dao: MistakeBookDao,
) : MistakeBook {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _entries = MutableStateFlow<List<MistakeEntry>>(emptyList())
    override val entries: StateFlow<List<MistakeEntry>> = _entries.asStateFlow()

    private val loadJob: Job = scope.launch {
        val persisted = dao.getAll().mapNotNull { it.toDomain() }
        // 回灌放前面: 极早期 add() 已进内存的条目保序拼在持久史之后并去重。
        _entries.update { early -> persisted + early.filter { e -> persisted.none { it.id == e.id } } }
    }

    override fun add(entry: MistakeEntry): String {
        val withId = if (entry.id.isBlank()) entry.copy(id = UUID.randomUUID().toString()) else entry
        _entries.update { it + withId }
        scope.launch { dao.upsert(withId.toEntity()) }
        return withId.id
    }

    override fun markReviewed(id: String, at: Long) {
        _entries.update { list ->
            list.map { if (it.id == id) it.copy(reviewCount = it.reviewCount + 1, lastReviewedAt = at) else it }
        }
        scope.launch { dao.markReviewed(id, at) }
    }

    override fun remove(id: String) {
        _entries.update { list -> list.filterNot { it.id == id } }
        scope.launch { dao.delete(id) }
    }

    override fun snapshot(): List<MistakeEntry> = _entries.value

    /** 测试用: 等启动回灌完成。 */
    internal suspend fun awaitLoaded() = loadJob.join()

    /** 测试用: 等所有已发起的落库写完成 (含回灌)。 */
    internal suspend fun awaitIdle() {
        scope.coroutineContext[Job]?.children?.forEach { it.join() }
    }

    private fun MistakeEntry.toEntity() = MistakeEntryEntity(
        id = id,
        grade = grade.name,
        subject = subject.name,
        knowledgeNode = knowledgeNode,
        question = question,
        wrongAnswer = wrongAnswer,
        correctAnswer = correctAnswer,
        note = note,
        createdAt = createdAt,
        reviewCount = reviewCount,
        lastReviewedAt = lastReviewedAt,
    )

    private fun MistakeEntryEntity.toDomain(): MistakeEntry? {
        val gradeLevel = GradeLevel.entries.firstOrNull { it.name == grade } ?: return null
        val subj = Subject.entries.firstOrNull { it.name == subject } ?: return null
        return MistakeEntry(
            id = id,
            grade = gradeLevel,
            subject = subj,
            knowledgeNode = knowledgeNode,
            question = question,
            wrongAnswer = wrongAnswer,
            correctAnswer = correctAnswer,
            note = note,
            createdAt = createdAt,
            reviewCount = reviewCount,
            lastReviewedAt = lastReviewedAt,
        )
    }
}
