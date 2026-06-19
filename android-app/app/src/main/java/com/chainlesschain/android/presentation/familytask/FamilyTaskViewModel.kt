package com.chainlesschain.android.presentation.familytask

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyTaskRepository
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskSource
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskType
import com.chainlesschain.android.feature.familyguard.domain.task.AiCallLogEntry
import com.chainlesschain.android.presentation.aistudy.GradeLevel
import com.chainlesschain.android.presentation.aistudy.Completion
import com.chainlesschain.android.presentation.aistudy.EarnContext
import com.chainlesschain.android.presentation.aistudy.EarnRules
import com.chainlesschain.android.presentation.aistudy.FamilyDataLifecycle
import com.chainlesschain.android.presentation.aistudy.MistakeBook
import com.chainlesschain.android.presentation.aistudy.MistakeEntry
import com.chainlesschain.android.presentation.aistudy.PointsEngine
import com.chainlesschain.android.presentation.aistudy.PointsLedger
import com.chainlesschain.android.presentation.aistudy.StudyTask
import com.chainlesschain.android.presentation.aistudy.StudyTaskContext
import com.chainlesschain.android.presentation.aistudy.StudyTaskStatus
import com.chainlesschain.android.presentation.aistudy.StudyTaskType
import com.chainlesschain.android.presentation.aistudy.Subject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class FamilyTaskUiState(
    val tasks: List<FamilyTask> = emptyList(),
    val showCreateForm: Boolean = false,
    /** 正在 AI 批改的任务 id (该卡显加载中)。 */
    val gradingTaskId: String? = null,
    /** snackbar 反馈 (积分入账 / 群导入结果)；UI 弹后清。 */
    val message: String? = null,
)

/**
 * M5 任务 UI 的 ViewModel。把 [FamilyTaskRepository] (真持久层, :feature-family-guard)
 * 接到界面, 并在"开始学习"时把任务推给 aistudy 的 [StudyTaskContext] —— 学习 tab 即
 * 进入引导模式 (主文档 §3.5/§3.6)。
 *
 * v0.1 演示: 无配对流程, 用本机固定 child/group/assigner DID。真 family_group 绑定后
 * 由配对流程 (FAMILY-13) 提供。
 */
@HiltViewModel
class FamilyTaskViewModel @Inject constructor(
    private val repo: FamilyTaskRepository,
    private val studyTaskContext: StudyTaskContext,
    private val grader: HomeworkGrader,
    private val mistakeBook: MistakeBook,
    private val pointsLedger: PointsLedger,
    private val dataLifecycle: FamilyDataLifecycle,
    private val studyContext: FamilyStudyContext,
) : ViewModel() {

    private val _uiState = MutableStateFlow(FamilyTaskUiState())
    val uiState: StateFlow<FamilyTaskUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repo.observeForChild(studyContext.childDid()).collect { tasks ->
                _uiState.update { it.copy(tasks = tasks) }
            }
        }
        // §4.6 数据生命周期: 家庭任务屏是高频入口, 顺路触发 (24h 节流, best-effort)。
        viewModelScope.launch { dataLifecycle.runIfDue(System.currentTimeMillis()) }
    }

    fun showCreateForm(show: Boolean) = _uiState.update { it.copy(showCreateForm = show) }

    /** [dueInDays]: null=无截止, 0=今天, 1=明天, 2=后天 (与群导入解析同口径)。 */
    fun createTask(title: String, subjectCode: String?, description: String, dueInDays: Int? = null) {
        val name = title.trim()
        if (name.isBlank()) return
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            val task = FamilyTask(
                id = UUID.randomUUID().toString(),
                familyGroupId = DEMO_GROUP_ID,
                assignerDid = DEMO_PARENT_DID,
                childDid = studyContext.childDid(),
                source = FamilyTaskSource.PARENT,
                type = FamilyTaskType.HOMEWORK,
                title = name,
                description = description.trim(),
                subject = subjectCode,
                dueAtMs = dueInDays?.let { now + it * DAY_MS },
                rewardPoints = DEFAULT_REWARD,
                status = FamilyTaskStatus.ASSIGNED,
                createdAtMs = now,
                updatedAtMs = now,
            )
            repo.upsert(task)
            _uiState.update { it.copy(showCreateForm = false) }
        }
    }

    /** 开始/进入学习: 立即把任务置为 aistudy 进行中 (引导模式) + 持久化 IN_PROGRESS。 */
    fun enterStudy(task: FamilyTask) {
        // 同步推给 aistudy seam, 保证导航到 AI 陪学时学习 tab 已是引导模式。
        studyTaskContext.setActiveTask(task.toActiveStudyTask())
        viewModelScope.launch {
            if (task.status == FamilyTaskStatus.ASSIGNED) {
                repo.transition(task.id, FamilyTaskStatus.IN_PROGRESS)
            }
        }
    }

    /** 孩子提交作答 (真实文本) → SUBMITTED。 */
    fun submit(task: FamilyTask, submission: String) = viewModelScope.launch {
        val text = submission.trim()
        if (text.isBlank()) return@launch
        repo.recordSubmission(task.id, text)
    }

    /**
     * 真 AI 批改：把题目 + 孩子作答喂给模型, 解析分数/评语/错题, 落库 + 进 GRADED,
     * 并把识别出的错题写进错题本 (主文档 §3.5 error_book ← source_task_id; 接学习 RAG)。
     */
    fun aiGrade(task: FamilyTask) {
        if (_uiState.value.gradingTaskId != null) return // 防重复点
        _uiState.update { it.copy(gradingTaskId = task.id) }
        viewModelScope.launch {
            try {
                // 防作弊审计：记一次批改 AI 调用 (只元数据)。
                repo.appendAiCall(task.id, AiCallLogEntry(System.currentTimeMillis(), "grade"))

                val result = grader.grade(
                    GradingRequest(
                        title = task.title,
                        description = task.description,
                        subjectCode = task.subject,
                        gradeLevelCode = task.gradeLevel,
                        submission = task.submission ?: "",
                    ),
                )
                repo.recordAiGrade(task.id, formatGrade(result))
                repo.transition(task.id, FamilyTaskStatus.GRADED)
                addMistakesToBook(task, result.mistakes)
            } finally {
                _uiState.update { it.copy(gradingTaskId = null) }
            }
        }
    }

    private fun formatGrade(result: GradingResult): String =
        if (result.score < 0) result.feedback else "${result.score} 分 — ${result.feedback}"

    private fun addMistakesToBook(task: FamilyTask, mistakes: List<String>) {
        if (mistakes.isEmpty()) return
        val grade = task.gradeLevel?.let { runCatching { GradeLevel.valueOf(it) }.getOrNull() }
            ?: GradeLevel.P4
        val subject = task.subject?.let { code -> Subject.entries.firstOrNull { it.code == code } }
            ?: Subject.MATH
        val now = System.currentTimeMillis()
        mistakes.forEach { node ->
            mistakeBook.add(
                MistakeEntry(
                    id = "",
                    grade = grade,
                    subject = subject,
                    knowledgeNode = node,
                    question = task.title,
                    wrongAnswer = task.submission?.take(80) ?: "",
                    correctAnswer = "见 AI 评语",
                    note = "来自作业「${task.title}」批改",
                    createdAt = now,
                ),
            )
        }
    }

    fun complete(task: FamilyTask) = viewModelScope.launch {
        if (!repo.transition(task.id, FamilyTaskStatus.DONE)) return@launch
        clearActiveIf(task.id)
        awardCompletionPoints(task.id)
    }

    /**
     * M5→M9 联动: DONE 后按批改分数 (作业分档) 或任务面值自动入账积分 (主文档 §3.9)。
     * 重读持久层取最新 aiGrade/ai_call_log (UI 传入的 task 可能是旧快照)。
     */
    private suspend fun awardCompletionPoints(taskId: String) {
        val now = System.currentTimeMillis()
        val task = repo.getById(taskId) ?: return
        val decision = TaskCompletionEarn.earnOnDone(
            task = task,
            contextCalls = studyTaskContext.callLogFor(taskId),
            ledger = pointsLedger,
            eventId = UUID.randomUUID().toString(),
            now = now,
        ) ?: return
        val streakNote = awardStreakBonus(now)
        _uiState.update {
            it.copy(
                message = when {
                    decision.rejected -> decision.notes.firstOrNull()
                    decision.notes.isEmpty() -> "+${decision.approvedAmount} 积分$streakNote"
                    else -> "+${decision.approvedAmount} 积分（${decision.notes.joinToString("；")}）$streakNote"
                },
            )
        }
    }

    /**
     * §3.9 streak bonus: 连续 7 天准时完成 → +50 (引擎 dormant 接通)。
     * taskId = "streak-<日起点>" 按日去重 (账本 hasEarnedForTask), 重复完成不重复发。
     * 返回 snackbar 后缀; 未触发为空串。
     */
    private suspend fun awardStreakBonus(now: Long): String {
        val childDid = studyContext.childDid()
        val tasks = repo.observeForChild(childDid).first()
        val days = StreakCalculator.consecutiveOnTimeDays(tasks, now)
        if (PointsEngine.streakBonus(days, EarnRules()) <= 0) return ""

        val dayStart = now - (now % DAY_MS)
        val streakTaskId = "streak-$dayStart"
        val decision = PointsEngine.decideEarn(
            childDid = childDid,
            completion = Completion.Streak(taskId = streakTaskId, consecutiveOnTimeDays = days),
            reason = "连续 $days 天准时完成任务",
            context = EarnContext(
                taskAlreadyEarned = pointsLedger.hasEarnedForTask(childDid, streakTaskId),
                earnedToday = pointsLedger.earnedBetween(childDid, dayStart, dayStart + DAY_MS),
            ),
            eventId = UUID.randomUUID().toString(),
            now = now,
        )
        decision.event?.let { pointsLedger.append(it) }
        return if (decision.rejected) "" else "，连续 $days 天准时 +${decision.approvedAmount}🔥"
    }

    fun consumeMessage() = _uiState.update { it.copy(message = null) }

    /**
     * M5 群作业导入 (主文档 §3.5): 家长粘贴班级群通知 → 解析候选 → 全部落
     * SUGGESTED 待确认 (误抽可忽略)。返回 Job 便于测试 join。
     */
    fun importFromGroupText(
        text: String,
        source: FamilyTaskSource = FamilyTaskSource.SCHOOL_WECHAT_GROUP,
    ) = viewModelScope.launch {
        val now = System.currentTimeMillis()
        val candidates = GroupHomeworkParser.parse(text, now)
        if (candidates.isEmpty()) {
            _uiState.update { it.copy(message = "没识别出作业，可手动「+ 新建作业」") }
            return@launch
        }
        val childDid = studyContext.childDid()
        candidates.forEach { c ->
            repo.upsert(
                FamilyTask(
                    id = UUID.randomUUID().toString(),
                    familyGroupId = DEMO_GROUP_ID,
                    assignerDid = DEMO_PARENT_DID,
                    childDid = childDid,
                    source = source,
                    type = FamilyTaskType.HOMEWORK,
                    title = c.title,
                    subject = c.subjectCode,
                    dueAtMs = c.dueAtMs,
                    rewardPoints = DEFAULT_REWARD,
                    status = FamilyTaskStatus.SUGGESTED,
                    createdAtMs = now,
                    updatedAtMs = now,
                ),
            )
        }
        _uiState.update { it.copy(message = "识别出 ${candidates.size} 条候选作业，请逐条确认") }
    }

    /** 家长确认群导入候选 → 正式布置 (SUGGESTED→ASSIGNED)。 */
    fun confirmSuggested(task: FamilyTask) = viewModelScope.launch {
        repo.transition(task.id, FamilyTaskStatus.ASSIGNED)
    }

    /** 家长打回重做, 可附评语 (写 parent_review, §3.5 此前从未有 UI 入口)。 */
    fun bounceBack(task: FamilyTask, review: String? = null) = viewModelScope.launch {
        review?.trim()?.takeIf { it.isNotBlank() }?.let { repo.recordParentReview(task.id, it) }
        repo.transition(task.id, FamilyTaskStatus.IN_PROGRESS)
    }

    fun cancel(task: FamilyTask) = viewModelScope.launch {
        if (repo.transition(task.id, FamilyTaskStatus.CANCELLED)) clearActiveIf(task.id)
    }

    private fun clearActiveIf(id: String) {
        if (studyTaskContext.activeTask.value?.id == id) studyTaskContext.setActiveTask(null)
    }

    private fun FamilyTask.toActiveStudyTask() = StudyTask(
        id = id,
        title = title,
        description = description,
        type = runCatching { StudyTaskType.valueOf(type.name) }.getOrDefault(StudyTaskType.HOMEWORK),
        subject = null,
        status = StudyTaskStatus.IN_PROGRESS,
    )

    private companion object {
        // child DID 现经 studyContext.childDid() 解析 (孩子端真实 DID / 回落演示常量)。
        // group/assigner 仍演示常量待真配对解析 (follow-up)。
        const val DEMO_GROUP_ID = "local-family"
        const val DEMO_PARENT_DID = "did:chain:local-parent"
        const val DEFAULT_REWARD = 20
        const val DAY_MS = 86_400_000L
    }
}
