package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 安全操作命令 API
 *
 * 提供类型安全的安全相关命令
 */
@Singleton
class SecurityCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 锁定工作站
     */
    suspend fun lockWorkstation(): Result<LockResponse> {
        return client.invoke("security.lockWorkstation", emptyMap())
    }

    /**
     * 获取安全状态摘要
     */
    suspend fun getStatus(): Result<SecurityStatusResponse> {
        return client.invoke("security.getStatus", emptyMap())
    }

    /**
     * 获取活动用户
     */
    suspend fun getActiveUsers(): Result<ActiveUsersResponse> {
        return client.invoke("security.getActiveUsers", emptyMap())
    }

    /**
     * 获取登录历史
     *
     * @param limit 返回数量限制
     */
    suspend fun getLoginHistory(limit: Int = 50): Result<LoginHistoryResponse> {
        val params = mapOf("limit" to limit)
        return client.invoke("security.getLoginHistory", params)
    }

    /**
     * 获取防火墙状态
     */
    suspend fun getFirewallStatus(): Result<FirewallStatusResponse> {
        return client.invoke("security.getFirewallStatus", emptyMap())
    }

    /**
     * 获取杀毒软件状态
     */
    suspend fun getAntivirusStatus(): Result<AntivirusStatusResponse> {
        return client.invoke("security.getAntivirusStatus", emptyMap())
    }

    /**
     * 获取加密状态
     */
    suspend fun getEncryptionStatus(): Result<EncryptionStatusResponse> {
        return client.invoke("security.getEncryptionStatus", emptyMap())
    }

    /**
     * 获取系统更新状态
     */
    suspend fun getUpdates(): Result<UpdatesStatusResponse> {
        return client.invoke("security.getUpdates", emptyMap())
    }
}

// 响应数据类

@Serializable
data class LockResponse(
    val success: Boolean,
    val message: String
)

@Serializable
data class SecurityStatusResponse(
    val success: Boolean,
    val security: SecuritySummary
)

@Serializable
data class SecuritySummary(
    val firewallEnabled: Boolean? = null,
    val antivirusInstalled: Boolean? = null,
    val encryptionEnabled: Boolean? = null,
    val pendingUpdates: Int? = null,
    val platform: String
)

@Serializable
data class ActiveUsersResponse(
    val success: Boolean,
    val users: List<ActiveUser>,
    val count: Int,
    val currentUser: String
)

@Serializable
data class ActiveUser(
    val username: String,
    val domain: String? = null,
    val terminal: String? = null,
    val loginTime: String? = null,
    val logonType: String? = null
)

@Serializable
data class LoginHistoryResponse(
    val success: Boolean,
    val history: List<LoginRecord>,
    val count: Int
)

@Serializable
data class LoginRecord(
    val username: String? = null,
    val terminal: String? = null,
    val time: String? = null,
    val type: String? = null,
    val details: String? = null
)

@Serializable
data class FirewallStatusResponse(
    val success: Boolean,
    val enabled: Boolean? = null,
    val type: String? = null,
    val profiles: List<FirewallProfile>? = null,
    val error: String? = null,
    val defaultInbound: String? = null,
    val defaultOutbound: String? = null,
    val ruleCount: Int? = null,
    val profile: String? = null,
    val rules: Int? = null
)

@Serializable
data class FirewallProfile(
    val name: String,
    val enabled: Boolean
)

@Serializable
data class AntivirusStatusResponse(
    val success: Boolean,
    val installed: Boolean? = null,
    val products: List<AntivirusProduct>? = null,
    val error: String? = null
)

@Serializable
data class AntivirusProduct(
    val name: String,
    val state: Int? = null,
    val builtin: Boolean? = null
)

@Serializable
data class EncryptionStatusResponse(
    val success: Boolean,
    val enabled: Boolean? = null,
    val type: String? = null,
    val percentage: Int? = null,
    val error: String? = null,
    val driveName: String? = null,
    val encrypted: Boolean? = null,
    val locked: Boolean? = null,
    val algorithm: String? = null,
    val method: String? = null,
    val status: String? = null
)

@Serializable
data class UpdatesStatusResponse(
    val success: Boolean,
    val pendingCount: Int? = null,
    val updates: List<PendingUpdate>? = null,
    val error: String? = null
)

@Serializable
data class PendingUpdate(
    val title: String,
    val kb: String? = null
)
