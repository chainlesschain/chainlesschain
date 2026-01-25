package com.chainlesschain.android.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.dao.OfflineQueueDao
import com.chainlesschain.android.core.database.dao.FileTransferDao
import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.dao.ProjectChatMessageDao
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.core.database.entity.ConversationEntity
import com.chainlesschain.android.core.database.entity.MessageEntity
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.core.database.entity.OfflineQueueEntity
import com.chainlesschain.android.core.database.entity.FileTransferEntity
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import com.chainlesschain.android.core.database.entity.ProjectActivityEntity
import com.chainlesschain.android.core.database.entity.ProjectChatMessageEntity
import com.chainlesschain.android.core.database.entity.KnowledgeItemFts
import com.chainlesschain.android.core.database.fts.ProjectFileFts
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
        KnowledgeItemFts::class,
        ConversationEntity::class,
        MessageEntity::class,
        P2PMessageEntity::class,
        OfflineQueueEntity::class,
        FileTransferEntity::class,
        ProjectEntity::class,
        ProjectFileEntity::class,
        ProjectFileFts::class,
        ProjectActivityEntity::class,
        ProjectChatMessageEntity::class,
    ],
    version = 10,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class ChainlessChainDatabase : RoomDatabase() {

    // 知识库相关DAO
    abstract fun knowledgeItemDao(): KnowledgeItemDao

    // 对话相关DAO
    abstract fun conversationDao(): ConversationDao

    // P2P消息相关DAO
    abstract fun p2pMessageDao(): P2PMessageDao

    // 离线消息队列DAO
    abstract fun offlineQueueDao(): OfflineQueueDao

    // 文件传输DAO
    abstract fun fileTransferDao(): FileTransferDao

    // 项目管理DAO
    abstract fun projectDao(): ProjectDao

    // 项目AI聊天消息DAO
    abstract fun projectChatMessageDao(): ProjectChatMessageDao

    companion object {
        const val DATABASE_NAME = "chainlesschain.db"
    }
}
