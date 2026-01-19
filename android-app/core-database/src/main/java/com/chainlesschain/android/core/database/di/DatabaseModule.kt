package com.chainlesschain.android.core.database.di

import android.content.Context
import androidx.room.Room
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.dao.ConversationDao
import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
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

    /**
     * 提供数据库实例（使用SQLCipher加密）
     */
    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context,
        keyManager: KeyManager
    ): ChainlessChainDatabase {
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
            // TODO: 添加数据库迁移策略
            // .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
            .fallbackToDestructiveMigration() // 开发阶段使用，生产环境需要移除
            .build()
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
}
