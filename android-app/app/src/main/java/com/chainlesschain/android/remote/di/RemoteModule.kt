package com.chainlesschain.android.remote.di

import android.content.Context
import com.chainlesschain.android.core.p2p.RemoteSkillProvider
import com.chainlesschain.android.core.p2p.sync.SyncOutbound
import com.chainlesschain.android.remote.crypto.AndroidDIDKeyStore
import com.chainlesschain.android.remote.crypto.DIDKeyStore
import com.chainlesschain.android.remote.crypto.NonceManager
import com.chainlesschain.android.remote.data.CommandHistoryDao
import com.chainlesschain.android.remote.data.CommandHistoryDatabase
import com.chainlesschain.android.remote.data.FileTransferDao
import com.chainlesschain.android.remote.p2p.CommandRouter
import com.chainlesschain.android.remote.p2p.DeviceActivityManager
import com.chainlesschain.android.remote.p2p.DIDManager
import com.chainlesschain.android.remote.p2p.DIDManagerImpl
import com.chainlesschain.android.remote.p2p.P2PClient
import com.chainlesschain.android.remote.p2p.P2PClientSyncOutbound
import com.chainlesschain.android.remote.p2p.SyncCommandRouter
import com.chainlesschain.android.remote.webrtc.SignalClient
import com.chainlesschain.android.remote.webrtc.WebRTCClient
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

    @Binds
    @Singleton
    abstract fun bindRemoteSkillProvider(impl: P2PClient): RemoteSkillProvider

    /**
     * Phase 3d M3 step D.5: P2PClient 入向 COMMAND_REQUEST 走 CommandRouter，
     * v1 唯一实现是 SyncCommandRouter（sync.* 命名空间）。后续加其他命名空间
     * 把 binding 换成 multi-binding 即可。
     */
    @Binds
    @Singleton
    abstract fun bindCommandRouter(impl: SyncCommandRouter): CommandRouter

    /**
     * Phase 3d M3 step D.5: SyncManager 出向调用走 SyncOutbound 接口，
     * 实现 P2PClientSyncOutbound 用 P2PClient.sendCommand 发 sync.* 到 PC 桌面。
     * 用 @Binds 让 Hilt 注入到 core-p2p:SyncManager 的 dagger.Lazy<SyncOutbound>。
     */
    @Binds
    @Singleton
    abstract fun bindSyncOutbound(impl: P2PClientSyncOutbound): SyncOutbound

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

        @Provides
        @Singleton
        fun provideNonceManager(
            @ApplicationContext context: Context
        ): NonceManager = NonceManager(context).apply {
            initialize()
        }

        @Provides
        @Singleton
        fun provideDeviceActivityManager(
            @ApplicationContext context: Context,
            webRTCClient: WebRTCClient
        ): DeviceActivityManager = DeviceActivityManager(context, webRTCClient).apply {
            initialize()
        }
    }
}
