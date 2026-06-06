package com.chainlesschain.android.presentation.aistudy

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 一条错题 (主文档 §3.6：错题本按 (学段, 学科, 知识点) 三维索引)。
 *
 * 错题是"学习资产"，落主 vault (家长可读)，**不属**陪伴 tab 的 TEE 私密域。
 */
data class MistakeEntry(
    val id: String,
    val grade: GradeLevel,
    val subject: Subject,
    /** 知识点标签，如 "分数加减" / "一元一次方程"。RAG 检索的主维度。 */
    val knowledgeNode: String,
    val question: String,
    val wrongAnswer: String,
    val correctAnswer: String,
    val note: String,
    val createdAt: Long,
    val reviewCount: Int = 0,
    val lastReviewedAt: Long? = null,
)

/**
 * 错题本存储 (data layer)。
 *
 * v0.1 内存态 + 接口化 —— 真正的 SQLCipher/主 vault 持久化是 follow-up (设备相关)，
 * 但数据层 + 检索逻辑是纯逻辑、可单测，先做透这一层。
 */
interface MistakeBook {
    val entries: StateFlow<List<MistakeEntry>>
    fun add(entry: MistakeEntry): String
    fun markReviewed(id: String, at: Long)
    fun remove(id: String)
    fun snapshot(): List<MistakeEntry>
}

@Singleton
class InMemoryMistakeBook @Inject constructor() : MistakeBook {
    private val _entries = MutableStateFlow<List<MistakeEntry>>(emptyList())
    override val entries: StateFlow<List<MistakeEntry>> = _entries.asStateFlow()

    override fun add(entry: MistakeEntry): String {
        val withId = if (entry.id.isBlank()) entry.copy(id = UUID.randomUUID().toString()) else entry
        _entries.update { it + withId }
        return withId.id
    }

    override fun markReviewed(id: String, at: Long) {
        _entries.update { list ->
            list.map { if (it.id == id) it.copy(reviewCount = it.reviewCount + 1, lastReviewedAt = at) else it }
        }
    }

    override fun remove(id: String) {
        _entries.update { list -> list.filterNot { it.id == id } }
    }

    override fun snapshot(): List<MistakeEntry> = _entries.value
}
