/**
 * AI内容审核系统集成指南
 *
 * 本文件展示如何将ContentModerator集成到PublishPostScreen中实现发布前审核
 *
 * ============================================================================
 * 集成步骤概述
 * ============================================================================
 *
 * 1. 在ViewModel中注入ModerationQueueRepository
 * 2. 在发布前调用moderateAndQueue()
 * 3. 根据审核结果决定是否发布
 * 4. 对于违规内容，显示违规提示对话框
 * 5. 用户可以选择修改内容或提交申诉
 */

package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.ContentType
import com.chainlesschain.android.core.model.Result
import com.chainlesschain.android.feature.p2p.moderation.ViolationCategory
import com.chainlesschain.android.feature.p2p.repository.moderation.ModerationDecision
import com.chainlesschain.android.feature.p2p.repository.moderation.ModerationQueueRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ============================================================================
// 步骤 1: 修改PostViewModel添加审核支持
// ============================================================================

/**
 * 示例：带审核功能的PostViewModel
 */
@HiltViewModel
class PostViewModelWithModeration @Inject constructor(
    private val moderationQueueRepository: ModerationQueueRepository
    // ... 其他依赖
) : ViewModel() {

    private val _moderationState = MutableStateFlow<ModerationState>(ModerationState.None)
    val moderationState: StateFlow<ModerationState> = _moderationState.asStateFlow()

    /**
     * 发布前审核并发布帖子
     */
    fun publishPostWithModeration(
        content: String,
        images: List<String> = emptyList(),
        tags: List<String> = emptyList(),
        myDid: String,
        myName: String
    ) {
        viewModelScope.launch {
            // 1. 显示审核中状态
            _moderationState.update { ModerationState.Moderating }

            // 2. AI审核
            val result = moderationQueueRepository.moderateAndQueue(
                contentType = ContentType.POST,
                contentId = java.util.UUID.randomUUID().toString(), // 临时ID
                content = content,
                authorDid = myDid,
                authorName = myName
            )

            // 3. 处理审核结果
            when (result) {
                is Result.Success -> {
                    when (val decision = result.data) {
                        is ModerationDecision.Approved -> {
                            // 审核通过，正常发布
                            _moderationState.update { ModerationState.Approved }
                            // 调用原有的发布逻辑
                            actuallyPublishPost(content, images, tags)
                        }
                        is ModerationDecision.RequiresReview -> {
                            // 需要人工审核，显示违规提示
                            _moderationState.update {
                                ModerationState.Violation(
                                    queueId = decision.queueId,
                                    violationCategories = decision.result.violationCategories,
                                    reason = decision.result.reason,
                                    suggestion = decision.result.suggestion
                                )
                            }
                        }
                    }
                }
                is Result.Error -> {
                    // 审核服务失败，可以选择：
                    // 选项A: 降级处理，允许发布但记录日志
                    // 选项B: 阻止发布，显示错误
                    _moderationState.update {
                        ModerationState.Error("审核服务暂时不可用")
                    }
                    // 这里选择选项A：降级发布
                    actuallyPublishPost(content, images, tags)
                }
            }
        }
    }

    /**
     * 实际发布帖子（原有逻辑）
     */
    private fun actuallyPublishPost(
        content: String,
        images: List<String>,
        tags: List<String>
    ) {
        // 原有的发布逻辑...
    }

    /**
     * 重置审核状态
     */
    fun resetModerationState() {
        _moderationState.update { ModerationState.None }
    }
}

/**
 * 审核状态密封类
 */
sealed class ModerationState {
    /** 无审核 */
    object None : ModerationState()

    /** 审核中 */
    object Moderating : ModerationState()

    /** 审核通过 */
    object Approved : ModerationState()

    /** 违规 */
    data class Violation(
        val queueId: Long,
        val violationCategories: List<ViolationCategory>,
        val reason: String,
        val suggestion: String
    ) : ModerationState()

    /** 错误 */
    data class Error(val message: String) : ModerationState()
}

// ============================================================================
// 步骤 2: 修改PublishPostScreen添加审核UI
// ============================================================================

/**
 * 示例：带审核提示的发布界面（代码片段）
 */
@Composable
fun PublishPostScreenWithModeration(
    myDid: String,
    myName: String,
    onNavigateBack: () -> Unit,
    viewModel: PostViewModelWithModeration // = hiltViewModel()
) {
    val moderationState by viewModel.moderationState.collectAsState()

    // 原有的状态变量...
    var content by remember { mutableStateOf("") }
    // ...

    // 处理发布（修改后的版本）
    val handlePublish = {
        if (content.isNotBlank()) {
            // 调用带审核的发布方法
            viewModel.publishPostWithModeration(
                content = content.trim(),
                images = emptyList(), // uploadedImageUrls
                tags = emptyList(), // tagList
                myDid = myDid,
                myName = myName
            )
        }
    }

    // 违规提示对话框
    if (moderationState is ModerationState.Violation) {
        val violation = moderationState as ModerationState.Violation
        ViolationDialog(
            violation = violation,
            onDismiss = {
                viewModel.resetModerationState()
            },
            onEdit = {
                // 返回编辑内容
                viewModel.resetModerationState()
            },
            onAppeal = {
                // TODO: 导航到申诉页面
                viewModel.resetModerationState()
                onNavigateBack()
            }
        )
    }

    // 审核中加载对话框
    if (moderationState is ModerationState.Moderating) {
        AlertDialog(
            onDismissRequest = { },
            confirmButton = { },
            title = { Text("AI审核中") },
            text = {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(16.dp))
                    Text("正在检测内容是否符合社区规范...")
                }
            }
        )
    }

    // 原有的Scaffold代码...
}

// ============================================================================
// 步骤 3: 违规提示对话框组件
// ============================================================================

/**
 * 违规提示对话框
 */
@Composable
fun ViolationDialog(
    violation: ModerationState.Violation,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onAppeal: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error
            )
        },
        title = {
            Text("内容违规提示")
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    "您的内容包含违反社区规范的部分：",
                    style = MaterialTheme.typography.bodyMedium
                )

                // 违规类型标签
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    violation.violationCategories.forEach { category ->
                        AssistChip(
                            onClick = { },
                            label = { Text(category.displayName) },
                            colors = AssistChipDefaults.assistChipColors(
                                containerColor = MaterialTheme.colorScheme.errorContainer,
                                labelColor = MaterialTheme.colorScheme.error
                            )
                        )
                    }
                }

                // 违规原因
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            "原因：",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            violation.reason,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }

                // 建议
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            "建议：",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                        Text(
                            violation.suggestion,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }

                Divider()

                Text(
                    "您可以修改内容后重新发布，或者提交申诉以请求人工审核。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onEdit) {
                Text("修改内容")
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAppeal) {
                    Text("提交申诉")
                }
                TextButton(onClick = onDismiss) {
                    Text("取消")
                }
            }
        }
    )
}

// ============================================================================
// 步骤 4: 申诉功能示例
// ============================================================================

/**
 * 申诉对话框
 */
@Composable
fun AppealDialog(
    queueId: Long,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit
) {
    var appealText by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("提交申诉") },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    "如果您认为AI审核结果有误，请说明理由：",
                    style = MaterialTheme.typography.bodyMedium
                )

                OutlinedTextField(
                    value = appealText,
                    onValueChange = { appealText = it },
                    label = { Text("申诉理由") },
                    placeholder = { Text("例如：这是新闻报道，不是宣扬暴力...") },
                    minLines = 3,
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth()
                )

                Text(
                    "提交后，您的内容将由人工审核员复审。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (appealText.isNotBlank()) {
                        onSubmit(appealText)
                    }
                },
                enabled = appealText.isNotBlank()
            ) {
                Text("提交申诉")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

// ============================================================================
// 集成清单
// ============================================================================

/**
 * 集成检查清单：
 *
 * [ ] 1. 在feature-p2p的build.gradle.kts中添加moderation模块依赖
 * [ ] 2. 在PostViewModel中注入ModerationQueueRepository
 * [ ] 3. 创建publishPostWithModeration()方法
 * [ ] 4. 添加ModerationState密封类来表示审核状态
 * [ ] 5. 在PublishPostScreen中监听moderationState
 * [ ] 6. 实现ViolationDialog显示违规提示
 * [ ] 7. 实现AppealDialog处理申诉
 * [ ] 8. 处理审核服务失败的降级逻辑
 * [ ] 9. 添加单元测试验证审核逻辑
 * [ ] 10. 添加E2E测试验证完整流程
 */

// ============================================================================
// 配置选项
// ============================================================================

/**
 * 审核配置
 */
object ModerationConfig {
    /** 是否启用发布前审核 */
    const val ENABLE_PRE_PUBLISH_MODERATION = true

    /** 审核服务失败时的策略 */
    enum class FailureStrategy {
        /** 阻止发布 */
        BLOCK,
        /** 允许发布但记录 */
        ALLOW_WITH_LOG
    }

    var failureStrategy = FailureStrategy.ALLOW_WITH_LOG

    /** 是否允许用户跳过审核（仅调试用） */
    const val ALLOW_SKIP_MODERATION = false
}

// ============================================================================
// 性能优化建议
// ============================================================================

/**
 * 性能优化：
 *
 * 1. **异步审核**：审核不阻塞UI，使用协程在后台执行
 * 2. **缓存结果**：相同内容的审核结果可以缓存（注意时效性）
 * 3. **批量审核**：如果有多张图片描述，可以批量审核减少API调用
 * 4. **降级策略**：LLM服务不可用时，允许发布但标记为待复审
 * 5. **预审核**：用户输入时实时提示可能的违规（防抖+节流）
 */
