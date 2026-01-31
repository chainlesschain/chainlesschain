package com.chainlesschain.android.core.p2p.sync

import android.util.Log
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 冲突解决器
 *
 * 处理多设备同步时的数据冲突
 * 支持多种解决策略：
 * - Last-Write-Wins (默认)
 * - First-Write-Wins
 * - Manual (手动解决)
 * - Custom (自定义策略)
 */
@Singleton
class ConflictResolver @Inject constructor() {

    companion object {
        private const val TAG = "ConflictResolver"
    }

    /**
     * 解决冲突
     *
     * @param conflict 冲突信息
     * @return 解决结果
     */
    fun resolve(conflict: SyncConflict): ConflictResolution {
        Log.d(TAG, "Resolving conflict: ${conflict.resourceId} (${conflict.strategy})")

        return when (conflict.strategy) {
            ConflictStrategy.LAST_WRITE_WINS -> resolveLastWriteWins(conflict)
            ConflictStrategy.FIRST_WRITE_WINS -> resolveFirstWriteWins(conflict)
            ConflictStrategy.MANUAL -> resolveManual(conflict)
            ConflictStrategy.CUSTOM -> resolveCustom(conflict)
        }
    }

    /**
     * Last-Write-Wins策略
     *
     * 选择时间戳最新的版本
     */
    private fun resolveLastWriteWins(conflict: SyncConflict): ConflictResolution {
        val winner = if (conflict.localItem.timestamp > conflict.remoteItem.timestamp) {
            conflict.localItem
        } else {
            conflict.remoteItem
        }

        Log.d(TAG, "Last-Write-Wins: ${winner.resourceId} (${winner.timestamp})")

        return ConflictResolution(
            strategy = ConflictStrategy.LAST_WRITE_WINS,
            resolvedItem = winner,
            localItem = conflict.localItem,
            remoteItem = conflict.remoteItem,
            description = "Selected version with timestamp ${winner.timestamp}"
        )
    }

    /**
     * First-Write-Wins策略
     *
     * 选择时间戳最早的版本（保留原始版本）
     */
    private fun resolveFirstWriteWins(conflict: SyncConflict): ConflictResolution {
        val winner = if (conflict.localItem.timestamp < conflict.remoteItem.timestamp) {
            conflict.localItem
        } else {
            conflict.remoteItem
        }

        Log.d(TAG, "First-Write-Wins: ${winner.resourceId} (${winner.timestamp})")

        return ConflictResolution(
            strategy = ConflictStrategy.FIRST_WRITE_WINS,
            resolvedItem = winner,
            localItem = conflict.localItem,
            remoteItem = conflict.remoteItem,
            description = "Preserved original version with timestamp ${winner.timestamp}"
        )
    }

    /**
     * 手动解决策略
     *
     * 需要用户介入选择版本
     */
    private fun resolveManual(conflict: SyncConflict): ConflictResolution {
        Log.d(TAG, "Manual resolution required: ${conflict.resourceId}")

        // 默认保留本地版本，等待用户决策
        return ConflictResolution(
            strategy = ConflictStrategy.MANUAL,
            resolvedItem = conflict.localItem,
            localItem = conflict.localItem,
            remoteItem = conflict.remoteItem,
            description = "Manual resolution required - keeping local version temporarily",
            requiresUserIntervention = true
        )
    }

    /**
     * 自定义解决策略
     *
     * 根据资源类型使用不同的解决逻辑
     */
    private fun resolveCustom(conflict: SyncConflict): ConflictResolution {
        Log.d(TAG, "Custom resolution: ${conflict.resourceId} (${conflict.localItem.resourceType})")

        return when (conflict.localItem.resourceType) {
            ResourceType.KNOWLEDGE_ITEM -> resolveKnowledgeItemConflict(conflict)
            ResourceType.CONVERSATION -> resolveConversationConflict(conflict)
            ResourceType.MESSAGE -> resolveMessageConflict(conflict)
            ResourceType.CONTACT -> resolveContactConflict(conflict)
            ResourceType.SETTING -> resolveSettingConflict(conflict)
            else -> resolveLastWriteWins(conflict) // 处理其他类型（FRIEND, POST等）
        }
    }

    /**
     * 知识库条目冲突解决
     *
     * 策略：合并内容，保留最新的元数据
     */
    private fun resolveKnowledgeItemConflict(conflict: SyncConflict): ConflictResolution {
        // 简化版：使用Last-Write-Wins
        // TODO: 实现智能合并逻辑（合并标签、关联等）
        return resolveLastWriteWins(conflict).copy(
            description = "Knowledge item resolved using Last-Write-Wins"
        )
    }

    /**
     * 对话冲突解决
     *
     * 策略：合并消息列表
     */
    private fun resolveConversationConflict(conflict: SyncConflict): ConflictResolution {
        // 简化版：使用Last-Write-Wins
        // TODO: 实现消息合并逻辑
        return resolveLastWriteWins(conflict).copy(
            description = "Conversation resolved using Last-Write-Wins"
        )
    }

    /**
     * 消息冲突解决
     *
     * 策略：消息ID唯一，应该不会冲突；如果冲突则保留两者
     */
    private fun resolveMessageConflict(conflict: SyncConflict): ConflictResolution {
        // 消息应该不会冲突（UUID唯一）
        // 如果确实冲突，保留本地版本
        return ConflictResolution(
            strategy = ConflictStrategy.CUSTOM,
            resolvedItem = conflict.localItem,
            localItem = conflict.localItem,
            remoteItem = conflict.remoteItem,
            description = "Message conflict - keeping local version (unexpected conflict)"
        )
    }

    /**
     * 联系人冲突解决
     *
     * 策略：合并联系人信息，保留最新的字段
     */
    private fun resolveContactConflict(conflict: SyncConflict): ConflictResolution {
        // 简化版：使用Last-Write-Wins
        // TODO: 实现字段级合并（不同字段可能来自不同版本）
        return resolveLastWriteWins(conflict).copy(
            description = "Contact resolved using Last-Write-Wins"
        )
    }

    /**
     * 设置冲突解决
     *
     * 策略：保留本地设置（设置应该是设备相关的）
     */
    private fun resolveSettingConflict(conflict: SyncConflict): ConflictResolution {
        return ConflictResolution(
            strategy = ConflictStrategy.CUSTOM,
            resolvedItem = conflict.localItem,
            localItem = conflict.localItem,
            remoteItem = conflict.remoteItem,
            description = "Settings are device-specific - keeping local version"
        )
    }

    /**
     * 检测两个SyncItem是否冲突
     *
     * @param local 本地项
     * @param remote 远程项
     * @return 冲突信息，如果没有冲突则返回null
     */
    fun detectConflict(
        local: SyncItem?,
        remote: SyncItem,
        strategy: ConflictStrategy = ConflictStrategy.LAST_WRITE_WINS
    ): SyncConflict? {
        // 如果本地没有该资源，不算冲突
        if (local == null) {
            return null
        }

        // 如果版本号相同，不算冲突
        if (local.version == remote.version && local.timestamp == remote.timestamp) {
            return null
        }

        // 如果数据内容相同，不算冲突
        if (local.data == remote.data) {
            return null
        }

        // 如果操作类型是DELETE，优先执行删除
        if (remote.operation == SyncOperation.DELETE) {
            return null // 不算冲突，直接删除
        }

        // 存在冲突
        Log.d(TAG, "Conflict detected: ${local.resourceId} (local:${local.timestamp} vs remote:${remote.timestamp})")

        return SyncConflict(
            resourceId = local.resourceId,
            localItem = local,
            remoteItem = remote,
            strategy = strategy
        )
    }

    /**
     * 根据资源类型选择默认策略
     */
    fun getDefaultStrategy(resourceType: ResourceType): ConflictStrategy {
        return when (resourceType) {
            ResourceType.KNOWLEDGE_ITEM -> ConflictStrategy.LAST_WRITE_WINS
            ResourceType.CONVERSATION -> ConflictStrategy.CUSTOM
            ResourceType.MESSAGE -> ConflictStrategy.LAST_WRITE_WINS
            ResourceType.CONTACT -> ConflictStrategy.CUSTOM
            ResourceType.SETTING -> ConflictStrategy.CUSTOM
            else -> ConflictStrategy.LAST_WRITE_WINS // 其他类型使用默认策略
        }
    }
}

/**
 * 同步冲突
 */
data class SyncConflict(
    /** 资源ID */
    val resourceId: String,

    /** 本地项 */
    val localItem: SyncItem,

    /** 远程项 */
    val remoteItem: SyncItem,

    /** 解决策略 */
    val strategy: ConflictStrategy = ConflictStrategy.LAST_WRITE_WINS,

    /** 冲突检测时间 */
    val detectedAt: Long = System.currentTimeMillis()
)

/**
 * 冲突解决结果
 */
data class ConflictResolution(
    /** 使用的策略 */
    val strategy: ConflictStrategy,

    /** 解决后的项 */
    val resolvedItem: SyncItem,

    /** 本地项（参考） */
    val localItem: SyncItem,

    /** 远程项（参考） */
    val remoteItem: SyncItem,

    /** 解决描述 */
    val description: String,

    /** 是否需要用户介入 */
    val requiresUserIntervention: Boolean = false,

    /** 解决时间 */
    val resolvedAt: Long = System.currentTimeMillis()
)

/**
 * 冲突解决策略
 */
enum class ConflictStrategy {
    /** Last-Write-Wins（最后写入获胜） */
    LAST_WRITE_WINS,

    /** First-Write-Wins（首次写入获胜） */
    FIRST_WRITE_WINS,

    /** 手动解决 */
    MANUAL,

    /** 自定义策略（根据资源类型） */
    CUSTOM
}
