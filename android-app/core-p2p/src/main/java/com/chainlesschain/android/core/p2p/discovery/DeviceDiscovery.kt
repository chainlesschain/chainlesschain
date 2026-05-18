package com.chainlesschain.android.core.p2p.discovery

import com.chainlesschain.android.core.p2p.model.P2PDevice
import kotlinx.coroutines.flow.Flow

/**
 * 设备发现接口
 *
 * 定义设备发现的统一接口
 */
interface DeviceDiscovery {

    /**
     * 开始发现设备
     */
    fun startDiscovery()

    /**
     * 停止发现设备
     */
    fun stopDiscovery()

    /**
     * 注册本地服务（让其他设备能发现本设备）
     */
    fun registerService(deviceInfo: P2PDevice)

    /**
     * 注销本地服务
     */
    fun unregisterService()

    /**
     * 观察发现的设备
     */
    fun observeDiscoveredDevices(): Flow<List<P2PDevice>>

    /**
     * 观察发现事件
     */
    fun observeDiscoveryEvents(): Flow<DiscoveryEvent>

    /**
     * 是否正在发现
     */
    fun isDiscovering(): Boolean
}

/**
 * 发现事件
 */
sealed class DiscoveryEvent {
    /** 开始发现 */
    data object DiscoveryStarted : DiscoveryEvent()

    /** 停止发现 */
    data object DiscoveryStopped : DiscoveryEvent()

    /** 发现新设备 */
    data class DeviceFound(val device: P2PDevice) : DiscoveryEvent()

    /** 设备丢失 */
    data class DeviceLost(val deviceId: String) : DiscoveryEvent()

    /** 发现失败 */
    data class DiscoveryFailed(val error: String) : DiscoveryEvent()

    /** 服务已注册 */
    data class ServiceRegistered(val serviceName: String) : DiscoveryEvent()

    /** 服务注册失败 */
    data class ServiceRegistrationFailed(val error: String) : DiscoveryEvent()
}
