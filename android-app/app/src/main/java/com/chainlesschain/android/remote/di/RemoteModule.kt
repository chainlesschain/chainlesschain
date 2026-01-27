package com.chainlesschain.android.remote.di

import android.content.Context
import com.chainlesschain.android.remote.data.CommandHistoryDao
import com.chainlesschain.android.remote.data.CommandHistoryDatabase
import com.chainlesschain.android.remote.data.FileTransferDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * 远程控制模块 - Hilt DI
 */
@Module
@InstallIn(SingletonComponent::class)
object RemoteModule {

    @Provides
    @Singleton
    fun provideCommandHistoryDatabase(
        @ApplicationContext context: Context
    ): CommandHistoryDatabase {
        return CommandHistoryDatabase.getDatabase(context)
    }

    @Provides
    @Singleton
    fun provideCommandHistoryDao(
        database: CommandHistoryDatabase
    ): CommandHistoryDao {
        return database.commandHistoryDao()
    }

    @Provides
    @Singleton
    fun provideFileTransferDao(
        database: CommandHistoryDatabase
    ): FileTransferDao {
        return database.fileTransferDao()
    }
}
