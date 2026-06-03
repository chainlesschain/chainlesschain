package com.chainlesschain.android.core.database.dao

import androidx.room.*
import com.chainlesschain.android.core.database.entity.TaskEntity
import kotlinx.coroutines.flow.Flow

/**
 * 任务数据访问对象
 *
 * 提供任务的 CRUD 操作、查询、统计功能
 */
@Dao
interface TaskDao {

    // ===== 查询操作（返回 Flow 实时数据） =====

    /**
     * 获取用户的所有任务（按创建时间降序）
     */
    @Query("SELECT * FROM tasks WHERE userId = :userId ORDER BY createdAt DESC")
    fun getTasksByUser(userId: String): Flow<List<TaskEntity>>

    /**
     * 按状态获取任务
     */
    @Query("SELECT * FROM tasks WHERE userId = :userId AND status = :status ORDER BY createdAt DESC")
    fun getTasksByStatus(userId: String, status: String): Flow<List<TaskEntity>>

    /**
     * 按优先级获取任务
     */
    @Query("SELECT * FROM tasks WHERE userId = :userId AND priority = :priority ORDER BY createdAt DESC")
    fun getTasksByPriority(userId: String, priority: String): Flow<List<TaskEntity>>

    /**
     * 获取项目关联的任务
     */
    @Query("SELECT * FROM tasks WHERE projectId = :projectId ORDER BY createdAt DESC")
    fun getTasksByProject(projectId: String): Flow<List<TaskEntity>>

    /**
     * 获取逾期任务
     */
    @Query("""
        SELECT * FROM tasks
        WHERE userId = :userId
            AND dueDate IS NOT NULL
            AND dueDate < :now
            AND status != 'completed'
            AND status != 'cancelled'
        ORDER BY dueDate ASC
    """)
    fun getOverdueTasks(userId: String, now: Long = System.currentTimeMillis()): Flow<List<TaskEntity>>

    /**
     * 获取今日到期的任务
     */
    @Query("""
        SELECT * FROM tasks
        WHERE userId = :userId
            AND dueDate IS NOT NULL
            AND dueDate >= :todayStart
            AND dueDate < :todayEnd
            AND status != 'completed'
            AND status != 'cancelled'
        ORDER BY dueDate ASC
    """)
    fun getTodayTasks(userId: String, todayStart: Long, todayEnd: Long): Flow<List<TaskEntity>>

    /**
     * 获取本周到期的任务
     */
    @Query("""
        SELECT * FROM tasks
        WHERE userId = :userId
            AND dueDate IS NOT NULL
            AND dueDate >= :weekStart
            AND dueDate < :weekEnd
            AND status != 'completed'
            AND status != 'cancelled'
        ORDER BY dueDate ASC
    """)
    fun getWeekTasks(userId: String, weekStart: Long, weekEnd: Long): Flow<List<TaskEntity>>

    /**
     * 搜索任务（标题或描述）
     */
    @Query("""
        SELECT * FROM tasks
        WHERE userId = :userId
            AND (title LIKE '%' || :query || '%' OR description LIKE '%' || :query || '%')
        ORDER BY createdAt DESC
    """)
    fun searchTasks(userId: String, query: String): Flow<List<TaskEntity>>

    /**
     * 按标签搜索任务
     */
    @Query("""
        SELECT * FROM tasks
        WHERE userId = :userId
            AND labels LIKE '%' || :label || '%'
        ORDER BY createdAt DESC
    """)
    fun getTasksByLabel(userId: String, label: String): Flow<List<TaskEntity>>

    // ===== 单条查询（挂起函数） =====

    /**
     * 获取单个任务
     */
    @Query("SELECT * FROM tasks WHERE id = :taskId")
    suspend fun getTaskById(taskId: String): TaskEntity?

    /**
     * 观察单个任务
     */
    @Query("SELECT * FROM tasks WHERE id = :taskId")
    fun observeTask(taskId: String): Flow<TaskEntity?>

    // ===== 写操作 =====

    /**
     * 插入任务
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTask(task: TaskEntity): Long

    /**
     * 批量插入任务
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTasks(tasks: List<TaskEntity>)

    /**
     * 更新任务
     */
    @Update
    suspend fun updateTask(task: TaskEntity): Int

    /**
     * 更新任务状态
     */
    @Query("""
        UPDATE tasks
        SET status = :status,
            updatedAt = :updatedAt,
            completedAt = :completedAt
        WHERE id = :taskId
    """)
    suspend fun updateTaskStatus(
        taskId: String,
        status: String,
        updatedAt: Long = System.currentTimeMillis(),
        completedAt: Long? = null
    ): Int

    /**
     * 更新任务优先级
     */
    @Query("UPDATE tasks SET priority = :priority, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun updateTaskPriority(
        taskId: String,
        priority: String,
        updatedAt: Long = System.currentTimeMillis()
    ): Int

    /**
     * 更新任务截止时间
     */
    @Query("UPDATE tasks SET dueDate = :dueDate, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun updateTaskDueDate(
        taskId: String,
        dueDate: Long?,
        updatedAt: Long = System.currentTimeMillis()
    ): Int

    /**
     * 更新任务子步骤
     */
    @Query("UPDATE tasks SET steps = :steps, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun updateTaskSteps(
        taskId: String,
        steps: String?,
        updatedAt: Long = System.currentTimeMillis()
    ): Int

    /**
     * 更新实际工时
     */
    @Query("UPDATE tasks SET actualHours = :actualHours, updatedAt = :updatedAt WHERE id = :taskId")
    suspend fun updateActualHours(
        taskId: String,
        actualHours: Float?,
        updatedAt: Long = System.currentTimeMillis()
    ): Int

    /**
     * 删除任务
     */
    @Query("DELETE FROM tasks WHERE id = :taskId")
    suspend fun deleteTask(taskId: String): Int

    /**
     * 删除用户的所有任务
     */
    @Query("DELETE FROM tasks WHERE userId = :userId")
    suspend fun deleteAllUserTasks(userId: String): Int

    /**
     * 删除项目的所有任务
     */
    @Query("DELETE FROM tasks WHERE projectId = :projectId")
    suspend fun deleteProjectTasks(projectId: String): Int

    // ===== 统计查询 =====

    /**
     * 获取用户任务总数
     */
    @Query("SELECT COUNT(*) FROM tasks WHERE userId = :userId")
    suspend fun getTaskCount(userId: String): Int

    /**
     * 按状态获取任务数量
     */
    @Query("SELECT COUNT(*) FROM tasks WHERE userId = :userId AND status = :status")
    suspend fun getTaskCountByStatus(userId: String, status: String): Int

    /**
     * 获取逾期任务数量
     */
    @Query("""
        SELECT COUNT(*) FROM tasks
        WHERE userId = :userId
            AND dueDate IS NOT NULL
            AND dueDate < :now
            AND status != 'completed'
            AND status != 'cancelled'
    """)
    suspend fun getOverdueTaskCount(userId: String, now: Long = System.currentTimeMillis()): Int

    /**
     * 获取本周完成的任务数量
     */
    @Query("""
        SELECT COUNT(*) FROM tasks
        WHERE userId = :userId
            AND status = 'completed'
            AND completedAt IS NOT NULL
            AND completedAt >= :weekStart
            AND completedAt < :weekEnd
    """)
    suspend fun getCompletedThisWeek(userId: String, weekStart: Long, weekEnd: Long): Int

    /**
     * 按优先级统计任务数量
     */
    @Query("""
        SELECT priority, COUNT(*) as count
        FROM tasks
        WHERE userId = :userId AND status != 'completed' AND status != 'cancelled'
        GROUP BY priority
    """)
    suspend fun getTaskCountByPriority(userId: String): List<PriorityCount>

    /**
     * 按状态统计任务数量
     */
    @Query("""
        SELECT status, COUNT(*) as count
        FROM tasks
        WHERE userId = :userId
        GROUP BY status
    """)
    suspend fun getTaskCountByStatusGroup(userId: String): List<StatusCount>

    // ===== 辅助数据类 =====

    data class PriorityCount(
        val priority: String,
        val count: Int
    )

    data class StatusCount(
        val status: String,
        val count: Int
    )
}
