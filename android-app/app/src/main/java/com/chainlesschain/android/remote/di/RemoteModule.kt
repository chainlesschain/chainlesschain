package com.chainlesschain.android.remote.di

import android.content.Context
import com.chainlesschain.android.remote.config.SignalingConfig
import com.chainlesschain.android.remote.crypto.AndroidDIDKeyStore
import com.chainlesschain.android.remote.crypto.DIDKeyStore
import com.chainlesschain.android.remote.data.CommandHistoryDao
import com.chainlesschain.android.remote.data.CommandHistoryDatabase
import com.chainlesschain.android.remote.data.FileTransferDao
import com.chainlesschain.android.remote.webrtc.SignalClient
import com.chainlesschain.android.remote.webrtc.WebSocketSignalClient
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
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

    @Binds
    @Singleton
    abstract fun bindSignalClient(
        impl: WebSocketSignalClient
    ): SignalClient

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

        /**
         * 提供 OkHttpClient 用于 WebSocket 连接
         */
        @Provides
        @Singleton
        fun provideOkHttpClient(): OkHttpClient {
            return OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .pingInterval(20, TimeUnit.SECONDS) // WebSocket 心跳
                .retryOnConnectionFailure(true)
                .build()
        }
    }
}
