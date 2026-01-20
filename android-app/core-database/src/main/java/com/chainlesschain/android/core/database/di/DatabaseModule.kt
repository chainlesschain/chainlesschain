package com.chainlesschain.android.core.database.di

import android.content.Context
import android.util.Log
import androidx.room.Room
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.migration.DatabaseMigrations
import com.chainlesschain.android.core.security.KeyManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SupportFactory
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

        // SQLCipher工厂
        val factory = SupportFactory(SQLiteDatabase.getBytes(passphrase.toCharArray()))

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
}
