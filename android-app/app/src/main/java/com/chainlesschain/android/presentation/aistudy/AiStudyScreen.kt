package com.chainlesschain.android.presentation.aistudy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.ai.presentation.ChatInput
import com.chainlesschain.android.feature.ai.presentation.MessageBubble
import com.chainlesschain.android.feature.ai.presentation.StreamingMessageBubble
import com.chainlesschain.android.feature.ai.presentation.TypingIndicator

/**
 * AI 陪学 屏 (M6 MVP)。家庭 tab 的「AI陪学」卡导航至此。
 *
 * 双轨 TabRow (学习 / 陪伴)，各自独立内存态历史；复用 feature-ai 的
 * MessageBubble / StreamingMessageBubble / TypingIndicator / ChatInput。
 */
@Composable
fun AiStudyScreen(
    onBack: () -> Unit,
    viewModel: AiStudyViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var showProfileDialog by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf("") }

    val messages = state.messagesFor(state.selectedTab)
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size, state.streamingText) {
        val target = messages.size + 1
        if (target > 0) listState.animateScrollToItem(maxOf(0, target - 1))
    }

    // safeDrawing = 状态栏(顶) + 导航栏(底) + 输入法, 正确取并集避免被系统按钮遮挡。
    Column(modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        // 顶栏: 返回 + 标题 + (学习 tab) 学段/学科设置
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onBack) { Text("← 返回") }
            Text(
                text = "AI 陪学",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (state.selectedTab == AiStudyTab.LEARNING) {
                TextButton(onClick = { showProfileDialog = true }) {
                    Text("${state.profile.grade.code} · ${state.profile.subject.label}")
                }
            }
        }

        TabRow(selectedTabIndex = if (state.selectedTab == AiStudyTab.LEARNING) 0 else 1) {
            Tab(
                selected = state.selectedTab == AiStudyTab.LEARNING,
                onClick = { viewModel.selectTab(AiStudyTab.LEARNING) },
                text = { Text("📚 学习") },
            )
            Tab(
                selected = state.selectedTab == AiStudyTab.COMPANION,
                onClick = { viewModel.selectTab(AiStudyTab.COMPANION) },
                text = { Text("💛 陪伴") },
            )
        }

        if (state.selectedTab == AiStudyTab.COMPANION) {
            Text(
                text = "这是你的私密空间（本机加密保存，连家长也看不到）",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }

        // M5 任务联动：进行中任务时，学习 tab 提示已进入引导模式 (不直接给答案)。
        if (state.selectedTab == AiStudyTab.LEARNING) {
            state.activeTask?.let { task ->
                Text(
                    text = "📒 任务进行中：${task.title}（引导模式，老师只给思路不给答案）",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                )
            }
        }

        state.error?.let { err ->
            Text(
                text = err,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }

        HorizontalDivider()

        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(items = messages, key = { it.id }) { msg -> MessageBubble(message = msg) }
            if (state.isSending) {
                item(key = "streaming") {
                    if (state.streamingText.isBlank()) TypingIndicator()
                    else StreamingMessageBubble(content = state.streamingText)
                }
            }
            item(key = "tail-spacer") { Spacer(Modifier.height(8.dp)) }
        }

        ChatInput(
            value = input,
            onValueChange = { input = it },
            onSend = {
                val text = input
                input = ""
                viewModel.send(text)
            },
            enabled = !state.isSending,
        )
    }

    if (showProfileDialog) {
        StudyProfileDialog(
            current = state.profile,
            onConfirm = {
                viewModel.updateProfile(it)
                showProfileDialog = false
            },
            onDismiss = { showProfileDialog = false },
        )
    }
}

@Composable
private fun StudyProfileDialog(
    current: StudyProfile,
    onConfirm: (StudyProfile) -> Unit,
    onDismiss: () -> Unit,
) {
    var grade by remember { mutableStateOf(current.grade) }
    var subject by remember { mutableStateOf(current.subject) }
    var nickname by remember { mutableStateOf(current.nickname) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("学习设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                EnumDropdown(
                    label = "学段",
                    display = "${grade.code} · ${grade.label}",
                    options = GradeLevel.entries,
                    optionLabel = { "${it.code} · ${it.label}" },
                    onSelect = { grade = it },
                )
                EnumDropdown(
                    label = "学科",
                    display = subject.label,
                    options = Subject.entries,
                    optionLabel = { it.label },
                    onSelect = { subject = it },
                )
                OutlinedTextField(
                    value = nickname,
                    onValueChange = { nickname = it },
                    label = { Text("孩子昵称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                onConfirm(
                    StudyProfile(
                        grade = grade,
                        subject = subject,
                        nickname = nickname.ifBlank { "同学" },
                    ),
                )
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun <T> EnumDropdown(
    label: String,
    display: String,
    options: List<T>,
    optionLabel: (T) -> String,
    onSelect: (T) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium)
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text(display, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(4.dp))
            Text("▾")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
            }
        }
    }
}
