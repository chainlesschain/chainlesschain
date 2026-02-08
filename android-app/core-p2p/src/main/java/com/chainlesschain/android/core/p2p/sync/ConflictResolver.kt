package com.chainlesschain.android.core.p2p.sync

import android.util.Log
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
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

    private val json = Json { ignoreUnknownKeys = true }

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
     * 策略：合并内容 -- 使用最新版本的主体字段（title, content）
     * 同时合并双方的标签和关联引用，保留各自的唯一值。
     */
    private fun resolveKnowledgeItemConflict(conflict: SyncConflict): ConflictResolution {
        return try {
            val localObj = json.parseToJsonElement(conflict.localItem.data).jsonObject
            val remoteObj = json.parseToJsonElement(conflict.remoteItem.data).jsonObject

            // 选择时间戳较新的一方作为基础（title, content 使用 LWW）
            val base = if (conflict.localItem.timestamp >= conflict.remoteItem.timestamp) localObj else remoteObj
            val other = if (base === localObj) remoteObj else localObj

            val mergedFields = mutableMapOf<String, JsonElement>()
            for ((key, value) in base) {
                mergedFields[key] = value
            }
            // 补充 other 中有但 base 中没有的字段
            for ((key, value) in other) {
                if (key !in mergedFields) {
                    mergedFields[key] = value
                }
            }

            // 合并数组类型的字段：取两方的并集
            val arrayFieldsToMerge = listOf("tags", "references", "links", "categories", "relatedIds")
            for (fieldName in arrayFieldsToMerge) {
                val baseArray = base[fieldName]
                val otherArray = other[fieldName]

                if (baseArray != null || otherArray != null) {
                    val baseElements = (baseArray as? JsonArray)?.toSet() ?: emptySet()
                    val otherElements = (otherArray as? JsonArray)?.toSet() ?: emptySet()
                    val merged = (baseElements + otherElements).toList()
                    mergedFields[fieldName] = JsonArray(merged)
                }
            }

            // Boolean 字段使用 OR 语义：任一设备标记即保留
            val orBooleanFields = listOf("isFavorite", "isPinned", "isBookmarked")
            for (fieldName in orBooleanFields) {
                val localVal = localObj[fieldName]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
                val remoteVal = remoteObj[fieldName]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
                if (localVal || remoteVal) {
                    mergedFields[fieldName] = JsonPrimitive(true)
                }
            }

            val mergedData = JsonObject(mergedFields).toString()
            val winner = if (conflict.localItem.timestamp >= conflict.remoteItem.timestamp) {
                conflict.localItem
            } else {
                conflict.remoteItem
            }
            val mergedItem = winner.copy(
                data = mergedData,
                version = maxOf(conflict.localItem.version, conflict.remoteItem.version) + 1
            )

            ConflictResolution(
                strategy = ConflictStrategy.CUSTOM,
                resolvedItem = mergedItem,
                localItem = conflict.localItem,
                remoteItem = conflict.remoteItem,
                description = "Knowledge item merged: LWW for title/content, union for tags/references, OR for isFavorite/isPinned"
            )
        } catch (e: Exception) {
            Log.w(TAG, "Knowledge item merge failed, falling back to Last-Write-Wins", e)
            resolveLastWriteWins(conflict).copy(
                description = "Knowledge item resolved using Last-Write-Wins (merge failed: ${e.message})"
            )
        }
    }

    /**
     * 对话冲突解决
     *
     * 策略：合并消息列表（messages字段去重合并），
     * 元数据取最新版本。对话是追加型数据结构，
     * 双方的消息列表应该合并保留。
     */
    private fun resolveConversationConflict(conflict: SyncConflict): ConflictResolution {
        return try {
            val localObj = json.parseToJsonElement(conflict.localItem.data).jsonObject
            val remoteObj = json.parseToJsonElement(conflict.remoteItem.data).jsonObject

            // 使用较新的版本作为基础（title 等元数据使用 LWW）
            val base = if (conflict.localItem.timestamp >= conflict.remoteItem.timestamp) localObj else remoteObj
            val other = if (base === localObj) remoteObj else localObj

            val mergedFields = mutableMapOf<String, JsonElement>()
            for ((key, value) in base) {
                mergedFields[key] = value
            }

            // isPinned: OR 语义
            val localPinned = localObj["isPinned"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
            val remotePinned = remoteObj["isPinned"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
            if (localPinned || remotePinned) {
                mergedFields["isPinned"] = JsonPrimitive(true)
            }

            // 合并messages字段：按消息ID去重
            val baseMessages = (base["messages"] as? JsonArray) ?: JsonArray(emptyList())
            val otherMessages = (other["messages"] as? JsonArray) ?: JsonArray(emptyList())

            // 使用消息中的 "id" 字段去重
            val seenIds = mutableSetOf<String>()
            val mergedMessages = mutableListOf<JsonElement>()

            for (msg in baseMessages + otherMessages) {
                val id = (msg as? JsonObject)?.get("id")?.jsonPrimitive?.content ?: msg.toString()
                if (seenIds.add(id)) {
                    mergedMessages.add(msg)
                }
            }
            mergedFields["messages"] = JsonArray(mergedMessages)

            val mergedData = JsonObject(mergedFields).toString()
            val winner = if (conflict.localItem.timestamp >= conflict.remoteItem.timestamp) {
                conflict.localItem
            } else {
                conflict.remoteItem
            }
            val mergedItem = winner.copy(
                data = mergedData,
                version = maxOf(conflict.localItem.version, conflict.remoteItem.version) + 1
            )

            ConflictResolution(
                strategy = ConflictStrategy.CUSTOM,
                resolvedItem = mergedItem,
                localItem = conflict.localItem,
                remoteItem = conflict.remoteItem,
                description = "Conversation merged: ${mergedMessages.size} messages deduplicated, isPinned OR-merged"
            )
        } catch (e: Exception) {
            Log.w(TAG, "Conversation merge failed, falling back to Last-Write-Wins", e)
            resolveLastWriteWins(conflict).copy(
                description = "Conversation resolved using Last-Write-Wins (merge failed: ${e.message})"
            )
        }
    }

    /**
     * 消息冲突解决
     *
     * 策略：消息是追加型（append-only）数据，不应产生真正的冲突。
     * 如果同一消息ID出现了不同内容（极少见），保留双方版本 --
     * 取远程版本作为resolved（因为本地版本已存在），同时标记不需要用户干预。
     * 调用方应确保两条版本都被保留。
     */
    private fun resolveMessageConflict(conflict: SyncConflict): ConflictResolution {
        // 消息是追加型数据，保留远程版本（本地版本已在localState中）
        // 两条消息都应被保留，不会互相覆盖
        Log.d(TAG, "Message conflict (append-only, keeping both): ${conflict.resourceId}")

        return ConflictResolution(
            strategy = ConflictStrategy.CUSTOM,
            resolvedItem = conflict.remoteItem,
            localItem = conflict.localItem,
            remoteItem = conflict.remoteItem,
            description = "Message conflict - keeping both versions (append-only data, local already exists)"
        )
    }

    /**
     * 联系人冲突解决
     *
     * 策略：字段级合并 -- 对每个字段选择最新的非空值。
     * 联系人信息的不同字段可能被不同设备各自更新。
     */
    private fun resolveContactConflict(conflict: SyncConflict): ConflictResolution {
        return try {
            val localObj = json.parseToJsonElement(conflict.localItem.data).jsonObject
            val remoteObj = json.parseToJsonElement(conflict.remoteItem.data).jsonObject

            val mergedFields = mutableMapOf<String, JsonElement>()

            // 收集所有字段名
            val allKeys = localObj.keys + remoteObj.keys

            // 数组字段集合合并
            val arrayFieldsToMerge = setOf("tags", "groups")
            // 文本字段取较长版本
            val preferLongerFields = setOf("notes", "bio")

            for (key in allKeys) {
                val localValue = localObj[key]
                val remoteValue = remoteObj[key]

                mergedFields[key] = when {
                    key in arrayFieldsToMerge -> {
                        // 集合合并：tags union
                        val localElements = (localValue as? JsonArray)?.toSet() ?: emptySet()
                        val remoteElements = (remoteValue as? JsonArray)?.toSet() ?: emptySet()
                        JsonArray((localElements + remoteElements).toList())
                    }
                    key in preferLongerFields -> {
                        // 取较长的版本，保留更多信息
                        val localStr = localValue?.jsonPrimitive?.content ?: ""
                        val remoteStr = remoteValue?.jsonPrimitive?.content ?: ""
                        if (localStr.length >= remoteStr.length) {
                            localValue ?: JsonPrimitive("")
                        } else {
                            remoteValue ?: JsonPrimitive("")
                        }
                    }
                    // 两方都有值：LWW（取较新的）
                    localValue != null && remoteValue != null -> {
                        if (conflict.localItem.timestamp >= conflict.remoteItem.timestamp) localValue else remoteValue
                    }
                    // 仅一方有值：取非空的
                    localValue != null -> localValue
                    remoteValue != null -> remoteValue
                    else -> JsonPrimitive("")
                }
            }

            val mergedData = JsonObject(mergedFields).toString()
            val mergedItem = conflict.localItem.copy(
                data = mergedData,
                version = maxOf(conflict.localItem.version, conflict.remoteItem.version) + 1,
                timestamp = maxOf(conflict.localItem.timestamp, conflict.remoteItem.timestamp)
            )

            ConflictResolution(
                strategy = ConflictStrategy.CUSTOM,
                resolvedItem = mergedItem,
                localItem = conflict.localItem,
                remoteItem = conflict.remoteItem,
                description = "Contact merged: LWW for nickname/avatar, union for tags, prefer-longer for notes"
            )
        } catch (e: Exception) {
            Log.w(TAG, "Contact merge failed, falling back to Last-Write-Wins", e)
            resolveLastWriteWins(conflict).copy(
                description = "Contact resolved using Last-Write-Wins (merge failed: ${e.message})"
            )
        }
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
            ResourceType.KNOWLEDGE_ITEM -> ConflictStrategy.CUSTOM
            ResourceType.CONVERSATION -> ConflictStrategy.CUSTOM
            ResourceType.MESSAGE -> ConflictStrategy.CUSTOM
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
