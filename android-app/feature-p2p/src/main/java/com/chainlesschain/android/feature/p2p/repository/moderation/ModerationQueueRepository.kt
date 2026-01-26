package com.chainlesschain.android.feature.p2p.repository.moderation

import com.chainlesschain.android.core.database.dao.ModerationQueueDao
import com.chainlesschain.android.core.database.entity.*
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.p2p.moderation.ContentModerator
import com.chainlesschain.android.feature.p2p.moderation.ModerationResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 审核队列Repository
 *
 * 提供审核队列的业务逻辑封装
 */
@Singleton
class ModerationQueueRepository @Inject constructor(
    private val moderationQueueDao: ModerationQueueDao,
    private val contentModerator: ContentModerator
) {

    // ==================== 添加到审核队列 ====================

    /**
     * 审核内容并根据结果决定是否添加到队列
     *
     * @param contentType 内容类型
     * @param contentId 内容ID
     * @param content 待审核的内容
     * @param authorDid 作者DID
     * @param authorName 作者昵称
     * @return 审核结果，如果违规则返回添加到队列的ID
     */
    suspend fun moderateAndQueue(
        contentType: ContentType,
        contentId: String,
        content: String,
        authorDid: String,
        authorName: String?
    ): Result<ModerationDecision> = withContext(Dispatchers.IO) {
        try {
            // 1. AI审核
            when (val moderationResult = contentModerator.moderateContent(content)) {
                is Result.Success -> {
                    val result = moderationResult.data

                    // 2. 根据审核结果决定处理方式
                    val decision = if (result.isViolation) {
                        // 违规：添加到审核队列
                        val queueId = addToQueue(
                            contentType = contentType,
                            contentId = contentId,
                            content = content,
                            authorDid = authorDid,
                            authorName = authorName,
                            aiResult = result
                        )
                        ModerationDecision.RequiresReview(queueId, result)
                    } else {
                        // 不违规：允许发布
                        ModerationDecision.Approved(result)
                    }

                    Result.Success(decision)
                }
                is Result.Error -> {
                    Result.Error(moderationResult.exception)
                }
                is Result.Loading -> {
                    Result.Error(Exception("Unexpected Loading state"))
                }
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 将内容添加到审核队列
     */
    private suspend fun addToQueue(
        contentType: ContentType,
        contentId: String,
        content: String,
        authorDid: String,
        authorName: String?,
        aiResult: ModerationResult
    ): Long {
        val entity = ModerationQueueEntity(
            contentType = contentType,
            contentId = contentId,
            contentText = content,
            authorDid = authorDid,
            authorName = authorName,
            status = ModerationStatus.PENDING,
            aiResultJson = serializeModerationResult(aiResult),
            humanDecision = null,
            humanNote = null,
            reviewerDid = null,
            appealStatus = AppealStatus.NONE,
            appealText = null,
            appealAt = null,
            appealResult = null,
            createdAt = System.currentTimeMillis(),
            reviewedAt = null
        )

        return moderationQueueDao.insert(entity)
    }

    // ==================== 查询审核队列 ====================

    /**
     * 获取所有待审核项目
     */
    fun getPendingItems(): Flow<Result<List<ModerationQueueItem>>> {
        return moderationQueueDao.getPendingFlow().map { entities ->
            try {
                Result.Success(entities.map { it.toQueueItem() })
            } catch (e: Exception) {
                Result.Error(e)
            }
        }
    }

    /**
     * 获取申诉中的项目
     */
    fun getAppealingItems(): Flow<Result<List<ModerationQueueItem>>> {
        return moderationQueueDao.getAppealingFlow().map { entities ->
            try {
                Result.Success(entities.map { it.toQueueItem() })
            } catch (e: Exception) {
                Result.Error(e)
            }
        }
    }

    /**
     * 按状态获取项目
     */
    fun getItemsByStatus(status: ModerationStatus): Flow<Result<List<ModerationQueueItem>>> {
        return moderationQueueDao.getByStatusFlow(status).map { entities ->
            try {
                Result.Success(entities.map { it.toQueueItem() })
            } catch (e: Exception) {
                Result.Error(e)
            }
        }
    }

    /**
     * 按作者获取项目
     */
    fun getItemsByAuthor(authorDid: String): Flow<Result<List<ModerationQueueItem>>> {
        return moderationQueueDao.getByAuthorFlow(authorDid).map { entities ->
            try {
                Result.Success(entities.map { it.toQueueItem() })
            } catch (e: Exception) {
                Result.Error(e)
            }
        }
    }

    /**
     * 获取高优先级项目（超过24小时未处理）
     */
    fun getHighPriorityItems(): Flow<Result<List<ModerationQueueItem>>> {
        val oneDayAgo = System.currentTimeMillis() - (24 * 60 * 60 * 1000)
        return moderationQueueDao.getHighPriorityFlow(oneDayAgo).map { entities ->
            try {
                Result.Success(entities.map { it.toQueueItem() })
            } catch (e: Exception) {
                Result.Error(e)
            }
        }
    }

    /**
     * 搜索审核项目
     */
    fun searchItems(query: String): Flow<Result<List<ModerationQueueItem>>> {
        return moderationQueueDao.searchFlow(query).map { entities ->
            try {
                Result.Success(entities.map { it.toQueueItem() })
            } catch (e: Exception) {
                Result.Error(e)
            }
        }
    }

    /**
     * 按ID获取项目
     */
    suspend fun getItemById(id: Long): Result<ModerationQueueItem?> = withContext(Dispatchers.IO) {
        try {
            val entity = moderationQueueDao.getById(id)
            Result.Success(entity?.toQueueItem())
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ==================== 人工审核操作 ====================

    /**
     * 批准内容
     */
    suspend fun approveContent(
        id: Long,
        reviewerDid: String,
        note: String? = null
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val updated = moderationQueueDao.updateStatus(
                id = id,
                status = ModerationStatus.APPROVED,
                decision = HumanDecision.APPROVE,
                note = note,
                reviewerDid = reviewerDid,
                reviewedAt = System.currentTimeMillis()
            )

            if (updated > 0) {
                Result.Success(Unit)
            } else {
                Result.Error(Exception("审核项目不存在"))
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 拒绝内容
     */
    suspend fun rejectContent(
        id: Long,
        reviewerDid: String,
        note: String? = null
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val updated = moderationQueueDao.updateStatus(
                id = id,
                status = ModerationStatus.REJECTED,
                decision = HumanDecision.REJECT,
                note = note,
                reviewerDid = reviewerDid,
                reviewedAt = System.currentTimeMillis()
            )

            if (updated > 0) {
                Result.Success(Unit)
            } else {
                Result.Error(Exception("审核项目不存在"))
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 删除内容
     */
    suspend fun deleteContent(
        id: Long,
        reviewerDid: String,
        note: String? = null
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val updated = moderationQueueDao.updateStatus(
                id = id,
                status = ModerationStatus.DELETED,
                decision = HumanDecision.DELETE,
                note = note,
                reviewerDid = reviewerDid,
                reviewedAt = System.currentTimeMillis()
            )

            if (updated > 0) {
                Result.Success(Unit)
            } else {
                Result.Error(Exception("审核项目不存在"))
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ==================== 申诉功能 ====================

    /**
     * 提交申诉
     */
    suspend fun submitAppeal(
        id: Long,
        appealText: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val updated = moderationQueueDao.updateAppeal(
                id = id,
                appealStatus = AppealStatus.PENDING,
                appealText = appealText,
                appealAt = System.currentTimeMillis(),
                moderationStatus = ModerationStatus.APPEALING
            )

            if (updated > 0) {
                Result.Success(Unit)
            } else {
                Result.Error(Exception("审核项目不存在"))
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 批准申诉
     */
    suspend fun approveAppeal(
        id: Long,
        appealResult: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val updated = moderationQueueDao.processAppeal(
                id = id,
                appealStatus = AppealStatus.APPROVED,
                appealResult = appealResult,
                moderationStatus = ModerationStatus.APPROVED,
                reviewedAt = System.currentTimeMillis()
            )

            if (updated > 0) {
                Result.Success(Unit)
            } else {
                Result.Error(Exception("审核项目不存在"))
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 拒绝申诉
     */
    suspend fun rejectAppeal(
        id: Long,
        appealResult: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val updated = moderationQueueDao.processAppeal(
                id = id,
                appealStatus = AppealStatus.REJECTED,
                appealResult = appealResult,
                moderationStatus = ModerationStatus.REJECTED,
                reviewedAt = System.currentTimeMillis()
            )

            if (updated > 0) {
                Result.Success(Unit)
            } else {
                Result.Error(Exception("审核项目不存在"))
            }
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ==================== 统计功能 ====================

    /**
     * 获取待审核数量
     */
    fun getPendingCount(): Flow<Result<Int>> {
        return moderationQueueDao.getPendingCountFlow().map { count ->
            Result.Success(count)
        }
    }

    /**
     * 获取申诉数量
     */
    fun getAppealingCount(): Flow<Result<Int>> {
        return moderationQueueDao.getAppealingCountFlow().map { count ->
            Result.Success(count)
        }
    }

    /**
     * 获取作者违规次数
     */
    fun getAuthorViolationCount(authorDid: String): Flow<Result<Int>> {
        return moderationQueueDao.getViolationCountByAuthorFlow(authorDid).map { count ->
            Result.Success(count)
        }
    }

    /**
     * 获取按日期统计
     */
    fun getStatsByDate(daysBack: Int = 30): Flow<Result<List<ModerationStatsByDate>>> {
        val startTimestamp = System.currentTimeMillis() - (daysBack * 24 * 60 * 60 * 1000L)
        return moderationQueueDao.getStatsByDateFlow(startTimestamp).map { stats ->
            Result.Success(stats)
        }
    }

    /**
     * 获取高频违规作者
     */
    fun getTopViolators(limit: Int = 10): Flow<Result<List<AuthorViolationStats>>> {
        return moderationQueueDao.getTopViolatorsFlow(limit).map { stats ->
            Result.Success(stats)
        }
    }

    // ==================== 清理功能 ====================

    /**
     * 清理已处理的旧记录（超过指定天数）
     */
    suspend fun cleanupProcessedItems(daysToKeep: Int = 30): Result<Int> = withContext(Dispatchers.IO) {
        try {
            val beforeTimestamp = System.currentTimeMillis() - (daysToKeep * 24 * 60 * 60 * 1000L)
            val deleted = moderationQueueDao.deleteProcessedBefore(beforeTimestamp)
            Result.Success(deleted)
        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    // ==================== 辅助方法 ====================

    /**
     * 将Entity转换为业务模型
     */
    private fun ModerationQueueEntity.toQueueItem(): ModerationQueueItem {
        val aiResult = deserializeModerationResult(aiResultJson)
        return ModerationQueueItem(
            id = id.toString(),
            contentType = ContentType.valueOf(contentType.name),
            contentId = contentId,
            content = contentText,
            authorDid = authorDid,
            authorName = authorName,
            status = status,
            violationType = aiResult.violationType,
            reason = aiResult.reason,
            createdAt = createdAt,
            reviewedAt = reviewedAt,
            severity = aiResult.severity ?: ModerationSeverity.MEDIUM,
            suggestion = aiResult.suggestion,
            aiAnalysis = aiResultJson
        )
    }

    /**
     * 序列化ModerationResult为JSON
     */
    private fun serializeModerationResult(result: ModerationResult): String {
        val json = JSONObject()
        json.put("isViolation", result.isViolation)
        json.put("violationType", result.violationType?.name)
        json.put("violationCategories", org.json.JSONArray(result.violationCategories))
        json.put("severity", result.severity?.name)
        json.put("confidence", result.confidence)
        json.put("reason", result.reason)
        json.put("suggestion", result.suggestion)
        return json.toString()
    }

    /**
     * 反序列化JSON为ModerationResult
     */
    private fun deserializeModerationResult(json: String): ModerationResult {
        return try {
            val obj = JSONObject(json)
            ModerationResult(
                isViolation = obj.optBoolean("isViolation", false),
                violationType = obj.optString("violationType")?.let {
                    try {
                        com.chainlesschain.android.feature.p2p.moderation.ViolationType.valueOf(it)
                    } catch (e: Exception) {
                        null
                    }
                },
                violationCategories = obj.optJSONArray("violationCategories")?.let { array ->
                    (0 until array.length()).map { i -> array.getString(i) }
                } ?: emptyList(),
                severity = obj.optString("severity")?.let {
                    try {
                        ModerationSeverity.fromString(it)
                    } catch (e: Exception) {
                        null
                    }
                },
                confidence = obj.optDouble("confidence", 0.0),
                reason = obj.optString("reason"),
                suggestion = obj.optString("suggestion")
            )
        } catch (e: Exception) {
            // Return default safe result
            ModerationResult(
                isViolation = false,
                violationType = null,
                confidence = 0.0,
                reason = "JSON解析失败: ${e.message}",
                violationCategories = emptyList(),
                severity = null,
                suggestion = null
            )
        }
    }
}

/**
 * 审核决策（用于moderateAndQueue的返回值）
 */
sealed class ModerationDecision {
    /** 审核通过，允许发布 */
    data class Approved(val result: ModerationResult) : ModerationDecision()

    /** 需要人工复审 */
    data class RequiresReview(val queueId: Long, val result: ModerationResult) : ModerationDecision()
}

/**
 * 审核队列项目（业务模型）
 */
data class ModerationQueueItem(
    val id: String,
    val contentType: ContentType,
    val contentId: String,
    val content: String,  // Changed from contentText
    val authorDid: String,
    val authorName: String?,
    val status: ModerationStatus,
    val violationType: com.chainlesschain.android.feature.p2p.moderation.ViolationType?,
    val reason: String?,
    val createdAt: Long,
    val reviewedAt: Long?,
    val severity: ModerationSeverity = ModerationSeverity.MEDIUM,
    val suggestion: String? = null,
    val aiAnalysis: String? = null
) {
    /** 获取等待时长（小时） */
    fun getWaitingHours(): Long {
        return (System.currentTimeMillis() - createdAt) / (60 * 60 * 1000)
    }

    /** 是否高优先级（超过24小时） */
    fun isHighPriority(): Boolean {
        return getWaitingHours() >= 24
    }

    companion object {
        /**
         * 创建安全的默认实例
         */
        fun createSafeDefault(): ModerationQueueItem {
            return ModerationQueueItem(
                id = "",
                contentType = ContentType.POST,
                contentId = "",
                content = "",
                authorDid = "",
                authorName = null,
                status = ModerationStatus.PENDING,
                violationType = null,
                reason = null,
                createdAt = System.currentTimeMillis(),
                reviewedAt = null,
                severity = ModerationSeverity.MEDIUM,
                suggestion = null,
                aiAnalysis = null
            )
        }
    }
}
/**
 * 审核严重程度
 */
enum class ModerationSeverity {
    LOW,       // 低
    MEDIUM,    // 中
    HIGH,      // 高
    CRITICAL;  // 严重

    companion object {
        fun fromString(value: String): ModerationSeverity {
            return values().find { it.name.equals(value, ignoreCase = true) } ?: MEDIUM
        }
    }

    val displayName: String
        get() = when (this) {
            LOW -> "低"
            MEDIUM -> "中"
            HIGH -> "高"
            CRITICAL -> "严重"
        }
}

/**
 * 审核统计（按日期）
 */
data class ModerationStatsByDate(
    val date: String,
    val totalCount: Int,
    val approvedCount: Int,
    val rejectedCount: Int,
    val pendingCount: Int
)

/**
 * 作者违规统计
 */
data class AuthorViolationStats(
    val authorDid: String,
    val authorName: String?,
    val violationCount: Int,
    val lastViolationTime: Long
)
