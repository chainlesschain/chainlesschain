package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import kotlinx.coroutines.flow.Flow

/**
 * M5 任务/作业仓储 (主文档 §3.5)。
 *
 * 家长布置 → 孩子做 ([IN_PROGRESS] 走 AI 引导模式) → 提交 → AI/家长批改 → 完成。
 * status 流转受 [FamilyTaskStatus.canTransitionTo] 状态机约束。
 */
interface FamilyTaskRepository {

    /** 新建/整体覆盖一条任务 (本地变更 → 触发上行同步)。 */
    suspend fun upsert(task: FamilyTask)

    /**
     * 收端同步写入：落对端推来的任务，**不回弹上行** (FAMILY-67 applier 专用，避免 echo)。
     * 与 [upsert] 的唯一区别是不触发 [com.chainlesschain.android.feature.familyguard.domain.sync.FamilyTaskOutbox]。
     */
    suspend fun upsertFromSync(task: FamilyTask)

    /** 收端同步删除：删对端推来的删除，**不回弹上行** (FAMILY-67 applier 专用)。 */
    suspend fun deleteFromSync(id: String): Boolean

    suspend fun getById(id: String): FamilyTask?

    /** UI: 观察某孩子全部任务 (按创建时间倒序)。 */
    fun observeForChild(childDid: String): Flow<List<FamilyTask>>

    /** UI: 观察某孩子某状态任务 (如进行中、待批改)。 */
    fun observeForChild(childDid: String, status: FamilyTaskStatus): Flow<List<FamilyTask>>

    /** 某孩子当前进行中的任务 (aistudy 引导模式数据源)。 */
    suspend fun activeTasksForChild(childDid: String): List<FamilyTask>

    /**
     * 状态流转。非法流转 (违反 [FamilyTaskStatus.canTransitionTo]) 返回 false 不落库。
     * @return true = 成功落库; false = 任务不存在 / 非法流转。
     */
    suspend fun transition(id: String, to: FamilyTaskStatus): Boolean

    /** 孩子提交作业 → status 进 SUBMITTED。 */
    suspend fun recordSubmission(id: String, submission: String): Boolean

    /** AI 批改结果。 */
    suspend fun recordAiGrade(id: String, aiGrade: String): Boolean

    /** 家长复核评语。 */
    suspend fun recordParentReview(id: String, review: String): Boolean

    /** 追加一条任务内 AI 调用 (防作弊 log, 主文档 §3.5)。 */
    suspend fun appendAiCall(id: String, entry: AiCallLogEntry): Boolean

    suspend fun delete(id: String): Boolean

    /** 数据生命周期清理: 删早于 cutoff 的已完成/取消任务 (主文档 §4.6)。 */
    suspend fun deleteTerminalOlderThan(cutoffMs: Long): Int
}
