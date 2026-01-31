package com.chainlesschain.android.feature.p2p.di

import android.content.Context
import com.chainlesschain.android.core.database.dao.FileTransferDao
import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.dao.OfflineQueueDao
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.filetransfer.CheckpointManager
import com.chainlesschain.android.core.p2p.filetransfer.FileChunker
import com.chainlesschain.android.core.p2p.filetransfer.FileTransferManager
import com.chainlesschain.android.core.p2p.filetransfer.FileTransferTransport
import com.chainlesschain.android.core.p2p.filetransfer.TransferProgressTracker
import com.chainlesschain.android.feature.p2p.repository.FileTransferRepository
import com.chainlesschain.android.feature.p2p.repository.P2PMessageRepository
import com.chainlesschain.android.feature.p2p.repository.social.FriendRepository
import com.chainlesschain.android.feature.p2p.repository.social.PostRepository
import com.chainlesschain.android.feature.p2p.repository.social.NotificationRepository
import com.chainlesschain.android.feature.p2p.repository.social.SocialSyncAdapter
import com.chainlesschain.android.feature.p2p.queue.OfflineMessageQueue
import com.chainlesschain.android.core.p2p.sync.SyncManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * P2P功能模块的依赖注入配置
 */
@Module
@InstallIn(SingletonComponent::class)
object P2PModule {

    /**
     * 提供P2P消息仓库
     */
    @Provides
    @Singleton
    fun provideP2PMessageRepository(
        p2pMessageDao: P2PMessageDao,
        sessionManager: PersistentSessionManager,
        connectionManager: P2PConnectionManager
    ): P2PMessageRepository {
        return P2PMessageRepository(
            p2pMessageDao = p2pMessageDao,
            sessionManager = sessionManager,
            connectionManager = connectionManager
        )
    }

    /**
     * 提供离线消息队列
     */
    @Provides
    @Singleton
    fun provideOfflineMessageQueue(
        offlineQueueDao: OfflineQueueDao
    ): OfflineMessageQueue {
        return OfflineMessageQueue(offlineQueueDao)
    }

    // ===== File Transfer Dependencies =====

    /**
     * 提供文件分块处理器
     */
    @Provides
    @Singleton
    fun provideFileChunker(
        @ApplicationContext context: Context
    ): FileChunker {
        return FileChunker(context)
    }

    /**
     * 提供传输进度跟踪器
     */
    @Provides
    @Singleton
    fun provideTransferProgressTracker(): TransferProgressTracker {
        return TransferProgressTracker()
    }

    /**
     * 提供文件传输传输层
     */
    @Provides
    @Singleton
    fun provideFileTransferTransport(
        connectionManager: P2PConnectionManager
    ): FileTransferTransport {
        return FileTransferTransport(connectionManager)
    }

    /**
     * 提供文件传输管理器
     */
    @Provides
    @Singleton
    fun provideFileTransferManager(
        @ApplicationContext context: Context,
        fileChunker: FileChunker,
        transport: FileTransferTransport,
        progressTracker: TransferProgressTracker,
        checkpointManager: CheckpointManager
    ): FileTransferManager {
        return FileTransferManager(context, fileChunker, transport, progressTracker, checkpointManager)
    }

    /**
     * 提供文件传输仓库
     */
    @Provides
    @Singleton
    fun provideFileTransferRepository(
        @ApplicationContext context: Context,
        fileTransferDao: FileTransferDao,
        fileTransferManager: FileTransferManager,
        progressTracker: TransferProgressTracker,
        fileChunker: FileChunker,
        sessionManager: PersistentSessionManager
    ): FileTransferRepository {
        return FileTransferRepository(
            context = context,
            fileTransferDao = fileTransferDao,
            fileTransferManager = fileTransferManager,
            progressTracker = progressTracker,
            fileChunker = fileChunker,
            sessionManager = sessionManager
        )
    }

    // ===== Social Dependencies =====
    // SocialSyncAdapter, FriendRepository, PostRepository, NotificationRepository
    // are provided automatically via @Inject constructor
}
