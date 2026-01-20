package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay

/**
 * AI项目创建进度阶段
 */
enum class CreationStage {
    /**
     * 连接AI服务
     */
    CONNECTING,

    /**
     * 分析需求
     */
    ANALYZING,

    /**
     * 生成项目结构
     */
    GENERATING_STRUCTURE,

    /**
     * 生成文件
     */
    GENERATING_FILES,

    /**
     * 保存项目
     */
    SAVING,

    /**
     * 完成
     */
    COMPLETED,

    /**
     * 失败
     */
    FAILED;

    fun getDisplayName(): String = when (this) {
        CONNECTING -> "连接AI服务"
        ANALYZING -> "分析需求"
        GENERATING_STRUCTURE -> "生成项目结构"
        GENERATING_FILES -> "生成文件内容"
        SAVING -> "保存项目"
        COMPLETED -> "创建完成"
        FAILED -> "创建失败"
    }

    fun getIcon(): ImageVector = when (this) {
        CONNECTING -> Icons.Default.Cloud
        ANALYZING -> Icons.Default.AutoAwesome
        GENERATING_STRUCTURE -> Icons.Default.Folder
        GENERATING_FILES -> Icons.Default.Description
        SAVING -> Icons.Default.Save
        COMPLETED -> Icons.Default.CheckCircle
        FAILED -> Icons.Default.Error
    }

    fun getProgress(): Float = when (this) {
        CONNECTING -> 0.1f
        ANALYZING -> 0.25f
        GENERATING_STRUCTURE -> 0.45f
        GENERATING_FILES -> 0.7f
        SAVING -> 0.9f
        COMPLETED -> 1f
        FAILED -> 0f
    }
}

/**
 * AI项目创建进度对话框
 */
@Composable
fun CreationProgressDialog(
    isVisible: Boolean,
    currentStage: CreationStage,
    currentFileName: String? = null,
    errorMessage: String? = null,
    onCancel: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (!isVisible) return

    val progress by animateFloatAsState(
        targetValue = currentStage.getProgress(),
        label = "progress"
    )

    Dialog(
        onDismissRequest = {
            if (currentStage == CreationStage.COMPLETED || currentStage == CreationStage.FAILED) {
                onDismiss()
            }
        },
        properties = DialogProperties(
            dismissOnBackPress = currentStage == CreationStage.COMPLETED || currentStage == CreationStage.FAILED,
            dismissOnClickOutside = false
        )
    ) {
        Surface(
            modifier = modifier,
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // 图标
                AnimatedContent(
                    targetState = currentStage,
                    transitionSpec = {
                        (fadeIn() + scaleIn()) togetherWith (fadeOut() + scaleOut())
                    },
                    label = "stageIcon"
                ) { stage ->
                    Box(
                        modifier = Modifier
                            .size(72.dp)
                            .clip(CircleShape)
                            .background(
                                when (stage) {
                                    CreationStage.COMPLETED -> Color(0xFF4CAF50).copy(alpha = 0.2f)
                                    CreationStage.FAILED -> MaterialTheme.colorScheme.errorContainer
                                    else -> MaterialTheme.colorScheme.primaryContainer
                                }
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        if (stage == CreationStage.COMPLETED || stage == CreationStage.FAILED) {
                            Icon(
                                imageVector = stage.getIcon(),
                                contentDescription = null,
                                modifier = Modifier.size(36.dp),
                                tint = when (stage) {
                                    CreationStage.COMPLETED -> Color(0xFF4CAF50)
                                    CreationStage.FAILED -> MaterialTheme.colorScheme.error
                                    else -> MaterialTheme.colorScheme.primary
                                }
                            )
                        } else {
                            CircularProgressIndicator(
                                modifier = Modifier.size(48.dp),
                                strokeWidth = 3.dp
                            )
                        }
                    }
                }

                // 标题
                Text(
                    text = if (currentStage == CreationStage.FAILED) "创建失败" else "正在创建项目",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = if (currentStage == CreationStage.FAILED) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    }
                )

                // 当前阶段
                AnimatedContent(
                    targetState = currentStage.getDisplayName(),
                    label = "stageName"
                ) { stageName ->
                    Text(
                        text = stageName,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f)
                    )
                }

                // 当前文件名（如果在生成文件阶段）
                AnimatedVisibility(visible = currentFileName != null) {
                    currentFileName?.let { fileName ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Description,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                            )
                            Text(
                                text = fileName,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                        }
                    }
                }

                // 进度条（非完成/失败状态）
                AnimatedVisibility(
                    visible = currentStage != CreationStage.COMPLETED && currentStage != CreationStage.FAILED
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        LinearProgressIndicator(
                            progress = { progress },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(8.dp)
                                .clip(RoundedCornerShape(4.dp)),
                            strokeCap = StrokeCap.Round
                        )

                        Text(
                            text = "${(progress * 100).toInt()}%",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                        )
                    }
                }

                // 错误信息
                AnimatedVisibility(visible = errorMessage != null) {
                    errorMessage?.let { error ->
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f)
                        ) {
                            Text(
                                text = error,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                modifier = Modifier.padding(12.dp),
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }

                // 阶段步骤指示器
                AnimatedVisibility(
                    visible = currentStage != CreationStage.COMPLETED && currentStage != CreationStage.FAILED
                ) {
                    CreationStageIndicator(currentStage = currentStage)
                }

                Spacer(modifier = Modifier.height(8.dp))

                // 按钮
                when (currentStage) {
                    CreationStage.COMPLETED -> {
                        TextButton(
                            onClick = onDismiss
                        ) {
                            Text("完成")
                        }
                    }

                    CreationStage.FAILED -> {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            TextButton(onClick = onDismiss) {
                                Text("关闭")
                            }
                        }
                    }

                    else -> {
                        TextButton(
                            onClick = onCancel
                        ) {
                            Text("取消")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CreationStageIndicator(
    currentStage: CreationStage
) {
    val stages = listOf(
        CreationStage.CONNECTING,
        CreationStage.ANALYZING,
        CreationStage.GENERATING_STRUCTURE,
        CreationStage.GENERATING_FILES,
        CreationStage.SAVING
    )

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
    ) {
        stages.forEachIndexed { index, stage ->
            val isCompleted = stage.ordinal < currentStage.ordinal
            val isCurrent = stage == currentStage

            StageIndicatorItem(
                stage = stage,
                isCompleted = isCompleted,
                isCurrent = isCurrent
            )

            if (index < stages.size - 1) {
                Box(
                    modifier = Modifier
                        .width(16.dp)
                        .height(2.dp)
                        .background(
                            if (isCompleted) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
                            }
                        )
                )
            }
        }
    }
}

@Composable
private fun StageIndicatorItem(
    stage: CreationStage,
    isCompleted: Boolean,
    isCurrent: Boolean
) {
    val backgroundColor = when {
        isCompleted -> MaterialTheme.colorScheme.primary
        isCurrent -> MaterialTheme.colorScheme.primaryContainer
        else -> MaterialTheme.colorScheme.surfaceVariant
    }

    val iconColor = when {
        isCompleted -> MaterialTheme.colorScheme.onPrimary
        isCurrent -> MaterialTheme.colorScheme.primary
        else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
    }

    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(CircleShape)
            .background(backgroundColor),
        contentAlignment = Alignment.Center
    ) {
        if (isCompleted) {
            Icon(
                imageVector = Icons.Default.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = iconColor
            )
        } else {
            Icon(
                imageVector = stage.getIcon(),
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = iconColor
            )
        }
    }
}
