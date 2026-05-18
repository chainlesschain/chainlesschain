package com.chainlesschain.android.core.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Fts4

/**
 * 知识库全文搜索虚拟表
 *
 * 使用FTS4提供高性能全文搜索
 * 通过触发器与knowledge_items表同步
 */
@Fts4(contentEntity = KnowledgeItemEntity::class)
@Entity(tableName = "knowledge_items_fts")
data class KnowledgeItemFts(
    /** 标题（用于搜索） */
    @ColumnInfo(name = "title")
    val title: String,

    /** 内容（用于搜索） */
    @ColumnInfo(name = "content")
    val content: String,

    /** 标签（用于搜索） */
    @ColumnInfo(name = "tags")
    val tags: String?
)
