package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * M6 错题本 (主文档 §3.6 error_book, 按 (学段, 学科, 知识点) 三维索引).
 *
 * 错题是"学习资产"，落主库 (家长可读)，**不属**陪伴 tab 的 TEE 私密域。
 * grade / subject 存 :app GradeLevel / Subject 枚举 name。id TEXT PK (调用方 UUID)。
 */
@Entity(
    tableName = "mistake_book",
    indices = [
        Index(value = ["grade", "subject"], name = "idx_mistake_book_grade_subject"),
        Index(value = ["knowledge_node"], name = "idx_mistake_book_node"),
    ],
)
data class MistakeEntryEntity(
    @PrimaryKey
    @ColumnInfo(name = "id")
    val id: String,

    @ColumnInfo(name = "grade")
    val grade: String,

    @ColumnInfo(name = "subject")
    val subject: String,

    /** 知识点标签 (RAG 检索主维度)。 */
    @ColumnInfo(name = "knowledge_node")
    val knowledgeNode: String,

    @ColumnInfo(name = "question")
    val question: String,

    @ColumnInfo(name = "wrong_answer")
    val wrongAnswer: String,

    @ColumnInfo(name = "correct_answer")
    val correctAnswer: String,

    @ColumnInfo(name = "note")
    val note: String,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    /** 间隔重复: 复习次数 (MistakeRetriever 排序用)。 */
    @ColumnInfo(name = "review_count")
    val reviewCount: Int,

    @ColumnInfo(name = "last_reviewed_at")
    val lastReviewedAt: Long?,
)
