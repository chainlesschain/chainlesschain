package com.chainlesschain.android.core.p2p.di

import android.content.Context
import com.chainlesschain.android.core.p2p.connection.AutoReconnectManager
import com.chainlesschain.android.core.p2p.connection.HeartbeatManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.connection.SignalingClient
import com.chainlesschain.android.core.p2p.discovery.DeviceDiscovery
import com.chainlesschain.android.core.p2p.discovery.NSDDiscovery
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * P2P网络核心模块的依赖注入配置
 *
 * 提供P2P网络通信所需的核心组件：
 * - 设备发现 (NSD)
 * - 信令通道
 * - 心跳管理
 * - 自动重连
 * - 连接管理
 */
@Module
@InstallIn(SingletonComponent::class)
object P2PNetworkModule {

    /**
     * 提供设备发现服务
     */
    @Provides
    @Singleton
    fun provideDeviceDiscovery(
        @ApplicationContext context: Context
    ): DeviceDiscovery {
        return NSDDiscovery(context)
    }

    /**
     * 提供信令客户端
     */
    @Provides
    @Singleton
    fun provideSignalingClient(): SignalingClient {
        return SignalingClient()
    }

    /**
     * 提供心跳管理器
     */
    @Provides
    @Singleton
    fun provideHeartbeatManager(): HeartbeatManager {
        return HeartbeatManager()
    }

    /**
     * 提供自动重连管理器
     */
    @Provides
    @Singleton
    fun provideAutoReconnectManager(
        heartbeatManager: HeartbeatManager
    ): AutoReconnectManager {
        return AutoReconnectManager(heartbeatManager)
    }

    /**
     * 提供P2P连接管理器
     */
    @Provides
    @Singleton
    fun provideP2PConnectionManager(
        @ApplicationContext context: Context,
        deviceDiscovery: DeviceDiscovery,
        signalingClient: SignalingClient,
        heartbeatManager: HeartbeatManager,
        autoReconnectManager: AutoReconnectManager
    ): P2PConnectionManager {
        return P2PConnectionManager(
            context = context,
            deviceDiscovery = deviceDiscovery,
            signalingClient = signalingClient,
            heartbeatManager = heartbeatManager,
            autoReconnectManager = autoReconnectManager
        )
    }
}
