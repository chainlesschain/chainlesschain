package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * AI对话会话实体
 */
@Entity(
    tableName = "conversations",
    indices = [
        Index(value = ["createdAt"]),
        Index(value = ["updatedAt"])
    ]
)
data class ConversationEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** 会话标题 */
    val title: String,

    /** 模型名称：gpt-4, deepseek-chat, ollama/qwen2等 */
    val model: String,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 最后更新时间 */
    val updatedAt: Long = System.currentTimeMillis(),

    /** 消息数量 */
    val messageCount: Int = 0,

    /** 是否置顶 */
    val isPinned: Boolean = false
)

/**
 * AI对话消息实体
 */
@Entity(
    tableName = "messages",
    indices = [
        Index(value = ["conversationId"]),
        Index(value = ["createdAt"])
    ]
)
data class MessageEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** 所属会话ID */
    val conversationId: String,

    /** 角色：user, assistant, system */
    val role: String,

    /** 消息内容 */
    val content: String,

    /** 创建时间 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 令牌数量（可选） */
    val tokenCount: Int? = null
)
