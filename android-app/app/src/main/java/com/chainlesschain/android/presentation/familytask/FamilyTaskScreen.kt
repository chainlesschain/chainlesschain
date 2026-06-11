package com.chainlesschain.android.presentation.familytask

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTask
import com.chainlesschain.android.feature.familyguard.domain.task.FamilyTaskStatus
import com.chainlesschain.android.presentation.aistudy.Subject

/**
 * M5 任务/作业屏。家庭 tab「任务」卡导航至此。
 *
 * 家长建作业 → 孩子「开始学习」进 AI 陪学引导模式 → 提交 → AI 批改 → 完成。
 * 任务真持久在 family_guard.db (FamilyTaskRepository); 「开始学习」把任务推给 aistudy
 * StudyTaskContext, 学习 tab 即显「任务进行中」引导横幅。
 */
@Composable
fun FamilyTaskScreen(
    onBack: () -> Unit,
    onOpenAiStudy: () -> Unit,
    viewModel: FamilyTaskViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var submittingTask by remember { mutableStateOf<FamilyTask?>(null) }
    var showImportDialog by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    // snackbar 反馈: 完成任务自动入账积分 / 群导入结果。
    LaunchedEffect(state.message) {
        state.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.consumeMessage()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onBack) { Text("← 返回") }
                Text(
                    text = "任务 / 作业",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { showImportDialog = true }) { Text("群导入") }
                TextButton(onClick = { viewModel.showCreateForm(!state.showCreateForm) }) {
                    Text(if (state.showCreateForm) "收起" else "+ 新建作业")
                }
            }
            HorizontalDivider()

            if (state.showCreateForm) {
                CreateTaskForm(
                    onCreate = { title, subject, desc -> viewModel.createTask(title, subject, desc) },
                    onCancel = { viewModel.showCreateForm(false) },
                )
                HorizontalDivider()
            }

            if (state.tasks.isEmpty()) {
                Text(
                    text = "还没有任务。点右上「+ 新建作业」给孩子布置一道作业试试。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 12.dp),
            ) {
                items(items = state.tasks, key = { it.id }) { task ->
                    TaskCard(
                        task = task,
                        isGrading = state.gradingTaskId == task.id,
                        onEnterStudy = {
                            viewModel.enterStudy(task)
                            onOpenAiStudy()
                        },
                        onSubmit = { submittingTask = task },
                        onAiGrade = { viewModel.aiGrade(task) },
                        onComplete = { viewModel.complete(task) },
                        onBounceBack = { viewModel.bounceBack(task) },
                        onCancel = { viewModel.cancel(task) },
                        onConfirmSuggested = { viewModel.confirmSuggested(task) },
                    )
                }
            }
        }
    }

    submittingTask?.let { task ->
        SubmitDialog(
            task = task,
            onConfirm = { text ->
                viewModel.submit(task, text)
                submittingTask = null
            },
            onDismiss = { submittingTask = null },
        )
    }

    if (showImportDialog) {
        GroupImportDialog(
            onImport = { text ->
                viewModel.importFromGroupText(text)
                showImportDialog = false
            },
            onDismiss = { showImportDialog = false },
        )
    }
}

/** M5 群作业导入: 家长粘贴班级群通知 → 解析为 SUGGESTED 候选, 逐条确认。 */
@Composable
private fun GroupImportDialog(
    onImport: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("从群消息导入作业") },
        text = {
            Column {
                Text(
                    text = "把班级群里的作业通知粘贴进来，识别出的候选需逐条确认后才布置。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text("群消息原文") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 4,
                )
            }
        },
        confirmButton = {
            Button(onClick = { onImport(text) }, enabled = text.isNotBlank()) { Text("解析导入") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun SubmitDialog(
    task: FamilyTask,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var answer by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("提交：${task.title}") },
        text = {
            OutlinedTextField(
                value = answer,
                onValueChange = { answer = it },
                label = { Text("写下你的解题过程 / 答案") },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            Button(onClick = { onConfirm(answer) }, enabled = answer.isNotBlank()) { Text("提交") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun CreateTaskForm(
    onCreate: (title: String, subjectCode: String?, description: String) -> Unit,
    onCancel: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf(Subject.MATH) }
    var subjectMenu by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            label = { Text("作业标题，如「数学第3页 1-10 题」") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("学科：", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = { subjectMenu = true }) { Text(subject.label) }
            DropdownMenu(expanded = subjectMenu, onDismissRequest = { subjectMenu = false }) {
                Subject.entries.forEach { s ->
                    DropdownMenuItem(
                        text = { Text(s.label) },
                        onClick = { subject = s; subjectMenu = false },
                    )
                }
            }
        }
        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            label = { Text("说明（可选）") },
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onCreate(title, subject.code, description) }) { Text("布置") }
            OutlinedButton(onClick = onCancel) { Text("取消") }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskCard(
    task: FamilyTask,
    isGrading: Boolean,
    onEnterStudy: () -> Unit,
    onSubmit: () -> Unit,
    onAiGrade: () -> Unit,
    onComplete: () -> Unit,
    onBounceBack: () -> Unit,
    onCancel: () -> Unit,
    onConfirmSuggested: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = task.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                AssistChip(onClick = {}, label = { Text(statusLabel(task.status)) })
            }
            task.subject?.let {
                Text(
                    text = "学科：${subjectLabel(it)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (task.description.isNotBlank()) {
                Text(task.description, style = MaterialTheme.typography.bodySmall)
            }
            task.submission?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = "✍️ 作答：$it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            task.aiGrade?.let {
                Text(
                    text = "🤖 $it",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when (task.status) {
                    FamilyTaskStatus.ASSIGNED -> {
                        Button(onClick = onEnterStudy) { Text("开始学习") }
                        OutlinedButton(onClick = onCancel) { Text("取消") }
                    }
                    FamilyTaskStatus.IN_PROGRESS -> {
                        Button(onClick = onEnterStudy) { Text("去 AI 陪学") }
                        OutlinedButton(onClick = onSubmit) { Text("提交") }
                        OutlinedButton(onClick = onCancel) { Text("取消") }
                    }
                    FamilyTaskStatus.SUBMITTED -> {
                        Button(onClick = onAiGrade, enabled = !isGrading) {
                            if (isGrading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp,
                                )
                                Spacer(Modifier.width(6.dp))
                                Text("批改中…")
                            } else {
                                Text("AI 批改")
                            }
                        }
                    }
                    FamilyTaskStatus.GRADED -> {
                        Button(onClick = onComplete) { Text("完成") }
                        OutlinedButton(onClick = onBounceBack) { Text("打回重做") }
                    }
                    // 群导入候选: 家长确认才正式布置, 误抽可忽略 (CANCELLED)。
                    FamilyTaskStatus.SUGGESTED -> {
                        Button(onClick = onConfirmSuggested) { Text("确认布置") }
                        OutlinedButton(onClick = onCancel) { Text("忽略") }
                    }
                    else -> Unit
                }
            }
        }
    }
}

private fun statusLabel(status: FamilyTaskStatus): String = when (status) {
    FamilyTaskStatus.SUGGESTED -> "待确认"
    FamilyTaskStatus.ASSIGNED -> "待开始"
    FamilyTaskStatus.IN_PROGRESS -> "进行中"
    FamilyTaskStatus.SUBMITTED -> "已提交"
    FamilyTaskStatus.GRADED -> "已批改"
    FamilyTaskStatus.DONE -> "已完成"
    FamilyTaskStatus.CANCELLED -> "已取消"
}

private fun subjectLabel(code: String): String =
    Subject.entries.firstOrNull { it.code == code }?.label ?: code
