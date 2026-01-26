package com.chainlesschain.android.core.database.di

import android.content.Context
import android.util.Log
import androidx.room.Room
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.dao.FileTransferDao
import com.chainlesschain.android.core.database.dao.TransferCheckpointDao
import com.chainlesschain.android.core.database.dao.TransferQueueDao
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.dao.OfflineQueueDao
import com.chainlesschain.android.core.database.dao.ExternalFileDao
import com.chainlesschain.android.core.database.dao.FileImportHistoryDao
import com.chainlesschain.android.core.database.dao.social.FriendDao
import com.chainlesschain.android.core.database.dao.social.PostDao
import com.chainlesschain.android.core.database.dao.social.PostInteractionDao
import com.chainlesschain.android.core.database.dao.social.NotificationDao
import com.chainlesschain.android.core.database.dao.social.PostEditHistoryDao
import com.chainlesschain.android.core.database.dao.ModerationQueueDao
import com.chainlesschain.android.core.database.migration.DatabaseMigrations
import com.chainlesschain.android.core.security.KeyManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import javax.inject.Singleton

/**
 * 数据库依赖注入模块
 */
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    private const val TAG = "DatabaseModule"

    /**
     * 提供数据库实例（使用SQLCipher加密）
     *
     * 数据库配置：
     * - SQLCipher AES-256 加密
     * - 自动迁移支持
     * - WAL 模式启用
     * - Schema 导出启用
     */
    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context,
        keyManager: KeyManager
    ): ChainlessChainDatabase {
        Log.i(TAG, "Initializing ChainlessChain database")

        // 从Keystore获取数据库加密密钥
        val passphrase = keyManager.getDatabaseKey()

        // 加载 SQLCipher 库
        System.loadLibrary("sqlcipher")

        // SQLCipher工厂
        val factory = SupportOpenHelperFactory(passphrase.toByteArray())

        return Room.databaseBuilder(
            context,
            ChainlessChainDatabase::class.java,
            ChainlessChainDatabase.DATABASE_NAME
        )
            .openHelperFactory(factory)
            // 添加所有迁移
            .addMigrations(*DatabaseMigrations.getAllMigrations())
            // 添加迁移回调
            .addCallback(DatabaseMigrations.MigrationCallback())
            // 仅在开发环境允许破坏性迁移作为最后手段
            // 生产环境应该移除此行并确保所有迁移都已实现
            .fallbackToDestructiveMigrationOnDowngrade()
            .build()
            .also {
                Log.i(TAG, "ChainlessChain database initialized successfully")
            }
    }

    /**
     * 提供知识库DAO
     */
    @Provides
    @Singleton
    fun provideKnowledgeItemDao(database: ChainlessChainDatabase): KnowledgeItemDao {
        return database.knowledgeItemDao()
    }

    /**
     * 提供对话DAO
     */
    @Provides
    @Singleton
    fun provideConversationDao(database: ChainlessChainDatabase): ConversationDao {
        return database.conversationDao()
    }

    /**
     * 提供P2P消息DAO
     */
    @Provides
    @Singleton
    fun provideP2PMessageDao(database: ChainlessChainDatabase): P2PMessageDao {
        return database.p2pMessageDao()
    }

    /**
     * 提供离线消息队列DAO
     */
    @Provides
    @Singleton
    fun provideOfflineQueueDao(database: ChainlessChainDatabase): OfflineQueueDao {
        return database.offlineQueueDao()
    }

    /**
     * 提供文件传输DAO
     */
    @Provides
    @Singleton
    fun provideFileTransferDao(database: ChainlessChainDatabase): FileTransferDao {
        return database.fileTransferDao()
    }

    /**
     * 提供传输断点DAO
     */
    @Provides
    @Singleton
    fun provideTransferCheckpointDao(database: ChainlessChainDatabase): TransferCheckpointDao {
        return database.transferCheckpointDao()
    }

    /**
     * 提供传输队列DAO
     */
    @Provides
    @Singleton
    fun provideTransferQueueDao(database: ChainlessChainDatabase): TransferQueueDao {
        return database.transferQueueDao()
    }

    /**
     * 提供外部文件DAO
     */
    @Provides
    @Singleton
    fun provideExternalFileDao(database: ChainlessChainDatabase): ExternalFileDao {
        return database.externalFileDao()
    }

    /**
     * 提供文件导入历史DAO
     */
    @Provides
    @Singleton
    fun provideFileImportHistoryDao(database: ChainlessChainDatabase): FileImportHistoryDao {
        return database.fileImportHistoryDao()
    }

    /**
     * 提供好友DAO
     */
    @Provides
    @Singleton
    fun provideFriendDao(database: ChainlessChainDatabase) = database.friendDao()

    /**
     * 提供动态DAO
     */
    @Provides
    @Singleton
    fun providePostDao(database: ChainlessChainDatabase) = database.postDao()

    /**
     * 提供动态互动DAO
     */
    @Provides
    @Singleton
    fun providePostInteractionDao(database: ChainlessChainDatabase) = database.postInteractionDao()

    /**
     * 提供通知DAO
     */
    @Provides
    @Singleton
    fun provideNotificationDao(database: ChainlessChainDatabase) = database.notificationDao()

    /**
     * 提供动态编辑历史DAO
     */
    @Provides
    @Singleton
    fun providePostEditHistoryDao(database: ChainlessChainDatabase) = database.postEditHistoryDao()

    /**
     * 提供内容审核队列DAO
     */
    @Provides
    @Singleton
    fun provideModerationQueueDao(database: ChainlessChainDatabase) = database.moderationQueueDao()
}
