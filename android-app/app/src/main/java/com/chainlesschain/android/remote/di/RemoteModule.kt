package com.chainlesschain.android.remote.di

import android.content.Context
import com.chainlesschain.android.remote.crypto.AndroidDIDKeyStore
import com.chainlesschain.android.remote.crypto.DIDKeyStore
import com.chainlesschain.android.remote.data.CommandHistoryDao
import com.chainlesschain.android.remote.data.CommandHistoryDatabase
import com.chainlesschain.android.remote.data.FileTransferDao
import com.chainlesschain.android.remote.p2p.DIDManager
import com.chainlesschain.android.remote.p2p.DIDManagerImpl
import com.chainlesschain.android.remote.webrtc.SignalClient
import com.chainlesschain.android.remote.webrtc.WebSocketSignalClient
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RemoteModule {

    @Binds
    @Singleton
    abstract fun bindDIDKeyStore(impl: AndroidDIDKeyStore): DIDKeyStore

    @Binds
    @Singleton
    abstract fun bindSignalClient(impl: WebSocketSignalClient): SignalClient

    @Binds
    @Singleton
    abstract fun bindDIDManager(impl: DIDManagerImpl): DIDManager

    companion object {
        @Provides
        @Singleton
        fun provideCommandHistoryDatabase(
            @ApplicationContext context: Context
        ): CommandHistoryDatabase = CommandHistoryDatabase.getDatabase(context)

        @Provides
        @Singleton
        fun provideCommandHistoryDao(
            database: CommandHistoryDatabase
        ): CommandHistoryDao = database.commandHistoryDao()

        @Provides
        @Singleton
        fun provideFileTransferDao(
            database: CommandHistoryDatabase
        ): FileTransferDao = database.fileTransferDao()
    }
}
