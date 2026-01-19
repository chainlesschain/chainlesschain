package com.chainlesschain.android.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import com.chainlesschain.android.core.database.util.Converters

/**
 * ChainlessChain主数据库
 *
 * 使用Room + SQLCipher提供AES-256加密
 *
 * 版本控制：每次schema变更时递增version，并提供Migration
 */
@Database(
    entities = [
        KnowledgeItemEntity::class,
        ConversationEntity::class,
        MessageEntity::class,
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class ChainlessChainDatabase : RoomDatabase() {

    // 知识库相关DAO
    abstract fun knowledgeItemDao(): KnowledgeItemDao

    // 对话相关DAO
    abstract fun conversationDao(): ConversationDao

    companion object {
        const val DATABASE_NAME = "chainlesschain.db"
    }
}
