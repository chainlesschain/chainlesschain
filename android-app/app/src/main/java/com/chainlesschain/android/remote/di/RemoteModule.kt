package com.chainlesschain.android.remote.di

import android.content.Context
import com.chainlesschain.android.remote.crypto.AndroidDIDKeyStore
import com.chainlesschain.android.remote.crypto.DIDKeyStore
import com.chainlesschain.android.remote.data.CommandHistoryDao
import com.chainlesschain.android.remote.data.CommandHistoryDatabase
import com.chainlesschain.android.remote.data.FileTransferDao
import dagger.Binds
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
abstract class RemoteModule {

    @Binds
    @Singleton
    abstract fun bindDIDKeyStore(
        impl: AndroidDIDKeyStore
    ): DIDKeyStore

    companion object {

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
}
