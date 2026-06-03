package com.chainlesschain.android.di

import android.content.Context
import androidx.room.Room
import com.chainlesschain.android.remote.offline.OfflineCommandDao
import com.chainlesschain.android.remote.offline.OfflineCommandDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * v1.1 issue #19 OfflineQueue：把 [OfflineCommandQueue] 用的 Room DB + Dao 接进 Hilt。
 *
 * 设计取舍：v1.0 已有的 [OfflineCommandQueue] 用独立 Room DB（`offline_commands.db`），
 * 与主 [com.chainlesschain.android.core.database.ChainlessChainDatabase] 解耦。后者
 * 也有更详细的 [com.chainlesschain.android.core.database.entity.OfflineQueueEntity]
 * （priority/status enum + expiresAt 等），v1.2 可考虑统一两套；v1.1 接通即可。
 */
@Module
@InstallIn(SingletonComponent::class)
object OfflineQueueModule {

    @Provides
    @Singleton
    fun provideOfflineCommandDatabase(
        @ApplicationContext context: Context,
    ): OfflineCommandDatabase = Room.databaseBuilder(
        context,
        OfflineCommandDatabase::class.java,
        "offline_commands.db",
    )
        .fallbackToDestructiveMigration()  // v1.0 单版本无 migration；schema 变化时 wipe 即可（队列内容是临时的）
        .build()

    @Provides
    fun provideOfflineCommandDao(db: OfflineCommandDatabase): OfflineCommandDao =
        db.offlineCommandDao()
}
