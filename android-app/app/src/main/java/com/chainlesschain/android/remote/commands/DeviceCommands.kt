package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 设备管理命令 API
 *
 * 提供类型安全的设备管理相关命令
 */
@Singleton
class DeviceCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 注册设备
     *
     * @param deviceName 设备名称
     * @param deviceType 设备类型：android, ios, desktop
     * @param metadata 附加元数据
     */
    suspend fun register(
        deviceName: String,
        deviceType: String = "android",
        metadata: Map<String, String>? = null
    ): Result<DeviceRegisterResponse> {
        val params = mutableMapOf<String, Any>(
            "deviceName" to deviceName,
            "deviceType" to deviceType
        )
        metadata?.let { params["metadata"] = it }

        return client.invoke("device.register", params)
    }

    /**
     * 获取已连接设备列表
     */
    suspend fun getConnected(): Result<ConnectedDevicesResponse> {
        return client.invoke("device.getConnected", emptyMap())
    }

    /**
     * 获取所有已注册设备列表
     *
     * @param includeOffline 是否包含离线设备
     */
    suspend fun getAll(
        includeOffline: Boolean = true
    ): Result<AllDevicesResponse> {
        val params = mapOf("includeOffline" to includeOffline)
        return client.invoke("device.getAll", params)
    }

    /**
     * 获取设备详情
     *
     * @param deviceDid 设备 DID
     */
    suspend fun getDevice(deviceDid: String): Result<DeviceDetailResponse> {
        val params = mapOf("deviceDid" to deviceDid)
        return client.invoke("device.getDevice", params)
    }

    /**
     * 更新设备信息
     *
     * @param deviceDid 设备 DID
     * @param deviceName 新设备名称
     * @param metadata 新元数据
     */
    suspend fun updateDevice(
        deviceDid: String,
        deviceName: String? = null,
        metadata: Map<String, String>? = null
    ): Result<UpdateDeviceResponse> {
        val params = mutableMapOf<String, Any>("deviceDid" to deviceDid)
        deviceName?.let { params["deviceName"] = it }
        metadata?.let { params["metadata"] = it }

        return client.invoke("device.updateDevice", params)
    }

    /**
     * 断开设备连接
     *
     * @param deviceDid 设备 DID
     */
    suspend fun disconnect(deviceDid: String): Result<DisconnectResponse> {
        val params = mapOf("deviceDid" to deviceDid)
        return client.invoke("device.disconnect", params)
    }

    /**
     * 撤销设备授权
     *
     * @param deviceDid 设备 DID
     * @param reason 撤销原因
     */
    suspend fun revoke(
        deviceDid: String,
        reason: String? = null
    ): Result<RevokeResponse> {
        val params = mutableMapOf<String, Any>("deviceDid" to deviceDid)
        reason?.let { params["reason"] = it }

        return client.invoke("device.revoke", params)
    }

    /**
     * 设置设备权限级别
     *
     * @param deviceDid 设备 DID
     * @param level 权限级别：1=Public, 2=Normal, 3=Admin, 4=Root
     * @param expiresIn 过期时间（毫秒），null 表示永不过期
     */
    suspend fun setPermission(
        deviceDid: String,
        level: Int,
        expiresIn: Long? = null
    ): Result<SetPermissionResponse> {
        val params = mutableMapOf<String, Any>(
            "deviceDid" to deviceDid,
            "level" to level
        )
        expiresIn?.let { params["expiresIn"] = it }

        return client.invoke("device.setPermission", params)
    }

    /**
     * 获取设备权限
     *
     * @param deviceDid 设备 DID
     */
    suspend fun getPermission(deviceDid: String): Result<GetPermissionResponse> {
        val params = mapOf("deviceDid" to deviceDid)
        return client.invoke("device.getPermission", params)
    }

    /**
     * 配对设备（扫码配对）
     *
     * @param pairingCode 配对码
     */
    suspend fun pair(pairingCode: String): Result<PairResponse> {
        val params = mapOf("pairingCode" to pairingCode)
        return client.invoke("device.pair", params)
    }

    /**
     * 生成配对码
     *
     * @param expiresIn 过期时间（秒）
     */
    suspend fun generatePairingCode(
        expiresIn: Int = 300
    ): Result<PairingCodeResponse> {
        val params = mapOf("expiresIn" to expiresIn)
        return client.invoke("device.generatePairingCode", params)
    }

    /**
     * 获取设备统计
     */
    suspend fun getStats(): Result<DeviceStatsResponse> {
        return client.invoke("device.getStats", emptyMap())
    }
}

// 响应数据类

@Serializable
data class DeviceRegisterResponse(
    val success: Boolean,
    val deviceDid: String,
    val permissionLevel: Int,
    val message: String
)

@Serializable
data class ConnectedDevicesResponse(
    val success: Boolean,
    val devices: List<ConnectedDevice>,
    val total: Int
)

@Serializable
data class ConnectedDevice(
    val did: String,
    val peerId: String,
    val name: String,
    val type: String,
    val permissionLevel: Int,
    val connectedAt: Long,
    val lastActivity: Long? = null
)

@Serializable
data class AllDevicesResponse(
    val success: Boolean,
    val devices: List<DeviceInfo>,
    val total: Int
)

@Serializable
data class DeviceInfo(
    val did: String,
    val name: String,
    val type: String,
    val permissionLevel: Int,
    val online: Boolean,
    val lastSeen: Long? = null,
    val registeredAt: Long,
    val metadata: Map<String, String>? = null
)

@Serializable
data class DeviceDetailResponse(
    val success: Boolean,
    val device: DeviceDetail
)

@Serializable
data class DeviceDetail(
    val did: String,
    val name: String,
    val type: String,
    val permissionLevel: Int,
    val online: Boolean,
    val peerId: String? = null,
    val lastSeen: Long? = null,
    val registeredAt: Long,
    val metadata: Map<String, String>? = null,
    val stats: DeviceActivityStats? = null
)

@Serializable
data class DeviceActivityStats(
    val totalCommands: Int,
    val lastCommand: String? = null,
    val lastCommandTime: Long? = null
)

@Serializable
data class UpdateDeviceResponse(
    val success: Boolean,
    val deviceDid: String,
    val message: String
)

@Serializable
data class DisconnectResponse(
    val success: Boolean,
    val deviceDid: String,
    val message: String
)

@Serializable
data class RevokeResponse(
    val success: Boolean,
    val deviceDid: String,
    val message: String
)

@Serializable
data class SetPermissionResponse(
    val success: Boolean,
    val deviceDid: String,
    val level: Int,
    val expiresAt: Long? = null,
    val message: String
)

@Serializable
data class GetPermissionResponse(
    val success: Boolean,
    val deviceDid: String,
    val level: Int,
    val levelName: String,
    val expiresAt: Long? = null
)

@Serializable
data class PairResponse(
    val success: Boolean,
    val deviceDid: String,
    val deviceName: String,
    val message: String
)

@Serializable
data class PairingCodeResponse(
    val success: Boolean,
    val pairingCode: String,
    val expiresAt: Long,
    val qrCodeData: String? = null
)

@Serializable
data class DeviceStatsResponse(
    val success: Boolean,
    val stats: DeviceStats
)

@Serializable
data class DeviceStats(
    val totalDevices: Int,
    val onlineDevices: Int,
    val offlineDevices: Int,
    val byType: Map<String, Int>,
    val byPermissionLevel: Map<String, Int>
)
