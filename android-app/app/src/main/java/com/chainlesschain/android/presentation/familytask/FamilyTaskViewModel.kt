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
import com.chainlesschain.android.presentation.aistudy.MistakeBook
import com.chainlesschain.android.presentation.aistudy.MistakeEntry
import com.chainlesschain.android.presentation.aistudy.StudyTask
import com.chainlesschain.android.presentation.aistudy.StudyTaskContext
import com.chainlesschain.android.presentation.aistudy.StudyTaskStatus
import com.chainlesschain.android.presentation.aistudy.StudyTaskType
import com.chainlesschain.android.presentation.aistudy.Subject
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class FamilyTaskUiState(
    val tasks: List<FamilyTask> = emptyList(),
    val showCreateForm: Boolean = false,
    /** 正在 AI 批改的任务 id (该卡显加载中)。 */
    val gradingTaskId: String? = null,
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
) : ViewModel() {

    private val _uiState = MutableStateFlow(FamilyTaskUiState())
    val uiState: StateFlow<FamilyTaskUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repo.observeForChild(DEMO_CHILD_DID).collect { tasks ->
                _uiState.update { it.copy(tasks = tasks) }
            }
        }
    }

    fun showCreateForm(show: Boolean) = _uiState.update { it.copy(showCreateForm = show) }

    fun createTask(title: String, subjectCode: String?, description: String) {
        val name = title.trim()
        if (name.isBlank()) return
        val now = System.currentTimeMillis()
        val task = FamilyTask(
            id = UUID.randomUUID().toString(),
            familyGroupId = DEMO_GROUP_ID,
            assignerDid = DEMO_PARENT_DID,
            childDid = DEMO_CHILD_DID,
            source = FamilyTaskSource.PARENT,
            type = FamilyTaskType.HOMEWORK,
            title = name,
            description = description.trim(),
            subject = subjectCode,
            rewardPoints = DEFAULT_REWARD,
            status = FamilyTaskStatus.ASSIGNED,
            createdAtMs = now,
            updatedAtMs = now,
        )
        viewModelScope.launch {
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
        if (repo.transition(task.id, FamilyTaskStatus.DONE)) clearActiveIf(task.id)
    }

    fun bounceBack(task: FamilyTask) = viewModelScope.launch {
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
        const val DEMO_CHILD_DID = "did:chain:local-child"
        const val DEMO_GROUP_ID = "local-family"
        const val DEMO_PARENT_DID = "did:chain:local-parent"
        const val DEFAULT_REWARD = 20
    }
}
