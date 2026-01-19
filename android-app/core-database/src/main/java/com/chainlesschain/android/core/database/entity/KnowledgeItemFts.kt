package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Fts5

/**
 * 知识库全文搜索虚拟表
 *
 * 使用FTS5提供高性能全文搜索
 * 自动与knowledge_items表同步
 */
@Fts5(
    contentEntity = KnowledgeItemEntity::class,
    tokenizer = "unicode61"
)
@Entity(tableName = "knowledge_items_fts")
data class KnowledgeItemFts(
    /** 标题（用于搜索） */
    val title: String,

    /** 内容（用于搜索） */
    val content: String,

    /** 标签（用于搜索） */
    val tags: String?
)
