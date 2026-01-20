package com.chainlesschain.android.feature.p2p.di

import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.dao.OfflineQueueDao
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.feature.p2p.repository.P2PMessageRepository
import com.chainlesschain.android.feature.p2p.queue.OfflineMessageQueue
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
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
}
