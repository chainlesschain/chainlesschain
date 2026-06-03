package com.chainlesschain.android.core.e2ee.group

import kotlinx.serialization.Serializable
import java.security.SecureRandom

/**
 * 群组加密基础
 *
 * 提供简化的群组端到端加密接口
 * 注意：完整的群组加密应使用 MLS (Message Layer Security) 协议
 * 这里提供的是简化版实现，适用于小规模群组
 */

/**
 * 群组密钥
 */
@Serializable
data class GroupKey(
    /** 群组ID */
    val groupId: String,

    /** 密钥版本 */
    val version: Int,

    /** 对称加密密钥（AES-256） */
    val key: ByteArray,

    /** 创建时间 */
    val createdAt: Long,

    /** 创建者 */
    val creator: String
) {
    companion object {
        /**
         * 生成新的群组密钥
         */
        fun generate(groupId: String, creator: String): GroupKey {
            val key = ByteArray(32) // AES-256
            SecureRandom().nextBytes(key)

            return GroupKey(
                groupId = groupId,
                version = 1,
                key = key,
                createdAt = System.currentTimeMillis(),
                creator = creator
            )
        }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false

        other as GroupKey

        if (groupId != other.groupId) return false
        if (version != other.version) return false
        if (!key.contentEquals(other.key)) return false
        if (createdAt != other.createdAt) return false
        if (creator != other.creator) return false

        return true
    }

    override fun hashCode(): Int {
        var result = groupId.hashCode()
        result = 31 * result + version
        result = 31 * result + key.contentHashCode()
        result = 31 * result + createdAt.hashCode()
        result = 31 * result + creator.hashCode()
        return result
    }
}

/**
 * 群组成员
 */
@Serializable
data class GroupMember(
    /** 成员ID（DID） */
    val memberId: String,

    /** 成员公钥 */
    val publicKey: ByteArray,

    /** 加入时间 */
    val joinedAt: Long,

    /** 角色 */
    val role: MemberRole,

    /** 是否活跃 */
    var isActive: Boolean = true
)

/**
 * 成员角色
 */
enum class MemberRole {
    /** 创建者 */
    CREATOR,

    /** 管理员 */
    ADMIN,

    /** 普通成员 */
    MEMBER
}

/**
 * 群组消息
 */
@Serializable
data class GroupMessage(
    /** 消息ID */
    val messageId: String,

    /** 群组ID */
    val groupId: String,

    /** 发送者ID */
    val senderId: String,

    /** 加密内容 */
    val encryptedContent: ByteArray,

    /** 密钥版本 */
    val keyVersion: Int,

    /** 时间戳 */
    val timestamp: Long,

    /** 消息类型 */
    val type: GroupMessageType
)

/**
 * 群组消息类型
 */
enum class GroupMessageType {
    /** 普通文本 */
    TEXT,

    /** 系统消息 */
    SYSTEM,

    /** 密钥更新 */
    KEY_UPDATE,

    /** 成员变更 */
    MEMBER_CHANGE
}

/**
 * 群组信息
 */
@Serializable
data class GroupInfo(
    /** 群组ID */
    val groupId: String,

    /** 群组名称 */
    val groupName: String,

    /** 创建者ID */
    val creatorId: String,

    /** 创建时间 */
    val createdAt: Long,

    /** 成员列表 */
    val members: List<GroupMember>,

    /** 当前密钥版本 */
    var currentKeyVersion: Int = 1,

    /** 群组描述 */
    val description: String? = null
) {
    /**
     * 获取活跃成员数
     */
    val activeMemberCount: Int
        get() = members.count { it.isActive }

    /**
     * 检查是否为成员
     */
    fun isMember(memberId: String): Boolean {
        return members.any { it.memberId == memberId && it.isActive }
    }

    /**
     * 检查是否为管理员
     */
    fun isAdmin(memberId: String): Boolean {
        val member = members.find { it.memberId == memberId && it.isActive }
        return member?.role == MemberRole.ADMIN || member?.role == MemberRole.CREATOR
    }
}

/**
 * 密钥分发包
 *
 * 用于安全地分发群组密钥给新成员
 */
@Serializable
data class KeyDistributionPackage(
    /** 群组ID */
    val groupId: String,

    /** 目标成员ID */
    val targetMemberId: String,

    /** 加密的群组密钥（使用成员的公钥加密） */
    val encryptedGroupKey: ByteArray,

    /** 密钥版本 */
    val keyVersion: Int,

    /** 时间戳 */
    val timestamp: Long
)

/**
 * 群组加密接口
 *
 * 定义群组加密的基本操作
 */
interface IGroupEncryption {
    /**
     * 创建群组
     */
    suspend fun createGroup(
        groupId: String,
        groupName: String,
        creatorId: String,
        initialMembers: List<GroupMember>
    ): GroupInfo

    /**
     * 添加成员
     */
    suspend fun addMember(
        groupId: String,
        newMember: GroupMember
    ): KeyDistributionPackage

    /**
     * 移除成员（会触发密钥轮转）
     */
    suspend fun removeMember(
        groupId: String,
        memberId: String
    ): GroupKey

    /**
     * 加密群组消息
     */
    suspend fun encryptGroupMessage(
        groupId: String,
        plaintext: ByteArray
    ): GroupMessage

    /**
     * 解密群组消息
     */
    suspend fun decryptGroupMessage(
        groupMessage: GroupMessage
    ): ByteArray

    /**
     * 轮转群组密钥
     */
    suspend fun rotateGroupKey(
        groupId: String
    ): GroupKey

    /**
     * 获取群组信息
     */
    suspend fun getGroupInfo(
        groupId: String
    ): GroupInfo?
}

/**
 * 群组加密策略
 */
data class GroupEncryptionPolicy(
    /** 最大群组人数 */
    val maxGroupSize: Int = 256,

    /** 成员变更后是否自动轮转密钥 */
    val autoRotateOnMemberChange: Boolean = true,

    /** 密钥轮转间隔（毫秒），0表示不自动轮转 */
    val keyRotationInterval: Long = 0L,

    /** 消息过期时间（毫秒），0表示不过期 */
    val messageExpirationTime: Long = 0L
) {
    companion object {
        /**
         * 默认策略
         */
        val DEFAULT = GroupEncryptionPolicy()

        /**
         * 高安全性策略
         */
        val HIGH_SECURITY = GroupEncryptionPolicy(
            maxGroupSize = 50,
            autoRotateOnMemberChange = true,
            keyRotationInterval = 24 * 60 * 60 * 1000L, // 24小时
            messageExpirationTime = 7 * 24 * 60 * 60 * 1000L // 7天
        )
    }
}
