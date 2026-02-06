package com.chainlesschain.android.feature.project.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.project.model.TaskPriority
import com.chainlesschain.android.feature.project.model.TaskUiEvent
import com.chainlesschain.android.feature.project.viewmodel.TaskViewModel
import kotlinx.coroutines.flow.collectLatest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 创建任务页面
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun TaskCreateScreen(
    viewModel: TaskViewModel = hiltViewModel(),
    userId: String,
    projectId: String? = null,
    onNavigateBack: () -> Unit,
    onTaskCreated: (String) -> Unit
) {
    val title by viewModel.newTaskTitle.collectAsState()
    val description by viewModel.newTaskDescription.collectAsState()
    val priority by viewModel.newTaskPriority.collectAsState()
    val dueDate by viewModel.newTaskDueDate.collectAsState()
    val labels by viewModel.newTaskLabels.collectAsState()
    val steps by viewModel.newTaskSteps.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()

    var showDatePicker by remember { mutableStateOf(false) }
    var newLabelInput by remember { mutableStateOf("") }
    var newStepInput by remember { mutableStateOf("") }

    val snackbarHostState = remember { SnackbarHostState() }

    // 设置用户 ID
    LaunchedEffect(userId) {
        viewModel.setCurrentUser(userId)
    }

    // 处理 UI 事件
    LaunchedEffect(Unit) {
        viewModel.uiEvents.collectLatest { event ->
            when (event) {
                is TaskUiEvent.ShowMessage -> {
                    snackbarHostState.showSnackbar(event.message)
                }
                is TaskUiEvent.ShowError -> {
                    snackbarHostState.showSnackbar(event.error)
                }
                is TaskUiEvent.TaskCreated -> {
                    onTaskCreated(event.task.id)
                }
                is TaskUiEvent.NavigateBack -> {
                    onNavigateBack()
                }
                else -> {}
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("创建任务") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            viewModel.createTask(projectId = projectId)
                        },
                        enabled = title.isNotBlank() && !isLoading
                    ) {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = "保存",
                            tint = if (title.isNotBlank() && !isLoading) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outline
                            }
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 标题输入
            item {
                OutlinedTextField(
                    value = title,
                    onValueChange = { viewModel.updateNewTaskTitle(it) },
                    label = { Text("任务标题 *") },
                    placeholder = { Text("输入任务标题...") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    isError = title.isBlank()
                )
            }

            // 描述输入
            item {
                OutlinedTextField(
                    value = description,
                    onValueChange = { viewModel.updateNewTaskDescription(it) },
                    label = { Text("任务描述") },
                    placeholder = { Text("输入任务描述（可选）...") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 6
                )
            }

            // 优先级选择
            item {
                PrioritySelector(
                    selectedPriority = priority,
                    onPrioritySelected = { viewModel.updateNewTaskPriority(it) }
                )
            }

            // 截止日期选择
            item {
                DateSelector(
                    selectedDate = dueDate,
                    onDateClick = { showDatePicker = true },
                    onClearDate = { viewModel.updateNewTaskDueDate(null) }
                )
            }

            // 标签管理
            item {
                LabelsSection(
                    labels = labels,
                    newLabelInput = newLabelInput,
                    onNewLabelInputChange = { newLabelInput = it },
                    onAddLabel = {
                        if (newLabelInput.isNotBlank()) {
                            viewModel.addNewTaskLabel(newLabelInput.trim())
                            newLabelInput = ""
                        }
                    },
                    onRemoveLabel = { viewModel.removeNewTaskLabel(it) }
                )
            }

            // 子步骤管理
            item {
                Text(
                    text = "子步骤",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // 子步骤列表
            itemsIndexed(steps) { index, step ->
                StepItem(
                    step = step,
                    onStepChange = { viewModel.updateNewTaskStep(index, it) },
                    onRemove = { viewModel.removeNewTaskStep(index) }
                )
            }

            // 添加子步骤输入
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = newStepInput,
                        onValueChange = { newStepInput = it },
                        placeholder = { Text("添加子步骤...") },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(
                            onDone = {
                                if (newStepInput.isNotBlank()) {
                                    viewModel.addNewTaskStep(newStepInput.trim())
                                    newStepInput = ""
                                }
                            }
                        )
                    )
                    IconButton(
                        onClick = {
                            if (newStepInput.isNotBlank()) {
                                viewModel.addNewTaskStep(newStepInput.trim())
                                newStepInput = ""
                            }
                        },
                        enabled = newStepInput.isNotBlank()
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = "添加",
                            tint = if (newStepInput.isNotBlank()) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outline
                            }
                        )
                    }
                }
            }

            // 创建按钮
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Button(
                    onClick = { viewModel.createTask(projectId = projectId) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = title.isNotBlank() && !isLoading
                ) {
                    Text("创建任务")
                }
            }
        }
    }

    // 日期选择器对话框
    if (showDatePicker) {
        val datePickerState = rememberDatePickerState(
            initialSelectedDateMillis = dueDate ?: System.currentTimeMillis()
        )

        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        datePickerState.selectedDateMillis?.let { millis ->
                            viewModel.updateNewTaskDueDate(millis)
                        }
                        showDatePicker = false
                    }
                ) {
                    Text("确定")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) {
                    Text("取消")
                }
            }
        ) {
            DatePicker(state = datePickerState)
        }
    }
}

/**
 * 优先级选择器
 */
@Composable
fun PrioritySelector(
    selectedPriority: TaskPriority,
    onPrioritySelected: (TaskPriority) -> Unit
) {
    Column {
        Text(
            text = "优先级",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            TaskPriority.entries.forEach { priority ->
                val isSelected = priority == selectedPriority
                val priorityColor = Color(priority.color)
                val icon = when (priority) {
                    TaskPriority.LOW -> Icons.Default.ArrowDownward
                    TaskPriority.MEDIUM -> Icons.Default.DragHandle
                    TaskPriority.HIGH -> Icons.Default.ArrowUpward
                    TaskPriority.URGENT -> Icons.Default.PriorityHigh
                }

                Surface(
                    onClick = { onPrioritySelected(priority) },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(8.dp),
                    color = if (isSelected) {
                        priorityColor.copy(alpha = 0.15f)
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                    border = if (isSelected) {
                        androidx.compose.foundation.BorderStroke(2.dp, priorityColor)
                    } else null
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = priorityColor,
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = priority.displayName,
                            style = MaterialTheme.typography.labelMedium,
                            color = if (isSelected) priorityColor else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

/**
 * 日期选择器
 */
@Composable
fun DateSelector(
    selectedDate: Long?,
    onDateClick: () -> Unit,
    onClearDate: () -> Unit
) {
    Column {
        Text(
            text = "截止日期",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))

        Surface(
            onClick = onDateClick,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surfaceVariant
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.CalendarToday,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    if (selectedDate != null) {
                        val dateFormat = SimpleDateFormat("yyyy年MM月dd日", Locale.getDefault())
                        Text(
                            text = dateFormat.format(Date(selectedDate)),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    } else {
                        Text(
                            text = "选择截止日期（可选）",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                if (selectedDate != null) {
                    IconButton(onClick = onClearDate) {
                        Icon(
                            Icons.Default.Clear,
                            contentDescription = "清除",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

/**
 * 标签管理区域
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LabelsSection(
    labels: List<String>,
    newLabelInput: String,
    onNewLabelInputChange: (String) -> Unit,
    onAddLabel: () -> Unit,
    onRemoveLabel: (String) -> Unit
) {
    Column {
        Text(
            text = "标签",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(8.dp))

        // 标签输入
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = newLabelInput,
                onValueChange = onNewLabelInputChange,
                placeholder = { Text("添加标签...") },
                modifier = Modifier.weight(1f),
                singleLine = true,
                leadingIcon = {
                    Icon(
                        Icons.Default.Label,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline
                    )
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { onAddLabel() })
            )
            IconButton(
                onClick = onAddLabel,
                enabled = newLabelInput.isNotBlank()
            ) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = "添加",
                    tint = if (newLabelInput.isNotBlank()) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.outline
                    }
                )
            }
        }

        // 标签列表
        if (labels.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                labels.forEach { label ->
                    FilterChip(
                        selected = true,
                        onClick = { onRemoveLabel(label) },
                        label = { Text(label) },
                        trailingIcon = {
                            Icon(
                                Icons.Default.Clear,
                                contentDescription = "删除",
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    )
                }
            }
        }
    }
}

/**
 * 子步骤项
 */
@Composable
fun StepItem(
    step: String,
    onStepChange: (String) -> Unit,
    onRemove: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary)
            )

            OutlinedTextField(
                value = step,
                onValueChange = onStepChange,
                modifier = Modifier.weight(1f),
                singleLine = true,
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    unfocusedBorderColor = Color.Transparent,
                    focusedBorderColor = MaterialTheme.colorScheme.primary
                )
            )

            IconButton(onClick = onRemove) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "删除",
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}
