package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.R
import timber.log.Timber

/**
 * 帮助与反馈页面
 * 常见问题、使用教程、问题反馈、联系方式
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpFeedbackScreen(
    onNavigateBack: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var feedbackText by remember { mutableStateOf("") }
    var showFeedbackDialog by remember { mutableStateOf(false) }
    var showSubmittedDialog by remember { mutableStateOf(false) }

    val faqItems = listOf(
        FAQItem(
            question = stringResource(R.string.help_faq_q1),
            answer = stringResource(R.string.help_faq_a1)
        ),
        FAQItem(
            question = stringResource(R.string.help_faq_q2),
            answer = stringResource(R.string.help_faq_a2)
        ),
        FAQItem(
            question = stringResource(R.string.help_faq_q3),
            answer = stringResource(R.string.help_faq_a3)
        ),
        FAQItem(
            question = stringResource(R.string.help_faq_q4),
            answer = stringResource(R.string.help_faq_a4)
        ),
        FAQItem(
            question = stringResource(R.string.help_faq_q5),
            answer = stringResource(R.string.help_faq_a5)
        )
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.help_title), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 快捷操作
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    HelpActionCard(
                        icon = Icons.Default.BugReport,
                        title = stringResource(R.string.help_report_issue),
                        modifier = Modifier.weight(1f),
                        onClick = { showFeedbackDialog = true }
                    )
                    HelpActionCard(
                        icon = Icons.Default.Lightbulb,
                        title = stringResource(R.string.help_feature_request),
                        modifier = Modifier.weight(1f),
                        onClick = { showFeedbackDialog = true }
                    )
                    HelpActionCard(
                        icon = Icons.Default.Email,
                        title = stringResource(R.string.help_contact_us),
                        modifier = Modifier.weight(1f),
                        onClick = {
                            val intent = android.content.Intent(android.content.Intent.ACTION_SENDTO).apply {
                                data = android.net.Uri.parse("mailto:support@chainlesschain.com")
                                putExtra(android.content.Intent.EXTRA_SUBJECT, context.getString(R.string.help_feedback_email_subject))
                            }
                            try { context.startActivity(intent) } catch (e: Exception) { Timber.w(e, "Failed to launch email intent") }
                        }
                    )
                }
            }

            // 常见问题
            item {
                Text(
                    text = stringResource(R.string.help_faq_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            items(faqItems) { faq ->
                FAQCard(faq = faq)
            }

            // 使用教程
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.help_tutorials),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.PlayCircle,
                    title = stringResource(R.string.help_quick_start),
                    description = stringResource(R.string.help_quick_start_desc)
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.SmartToy,
                    title = stringResource(R.string.help_ai_advanced),
                    description = stringResource(R.string.help_ai_advanced_desc)
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.Devices,
                    title = stringResource(R.string.help_device_connection),
                    description = stringResource(R.string.help_device_connection_desc)
                )
            }

            item {
                TutorialCard(
                    icon = Icons.Default.Security,
                    title = stringResource(R.string.help_security_guide),
                    description = stringResource(R.string.help_security_guide_desc)
                )
            }
        }
    }

    // 反馈对话框
    if (showFeedbackDialog) {
        AlertDialog(
            onDismissRequest = { showFeedbackDialog = false },
            title = { Text(stringResource(R.string.help_submit_feedback)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        stringResource(R.string.help_feedback_prompt),
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedTextField(
                        value = feedbackText,
                        onValueChange = { feedbackText = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 120.dp),
                        placeholder = { Text(stringResource(R.string.help_feedback_hint)) },
                        maxLines = 6
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showFeedbackDialog = false
                        if (feedbackText.isNotBlank()) {
                            showSubmittedDialog = true
                            feedbackText = ""
                        }
                    },
                    enabled = feedbackText.isNotBlank()
                ) {
                    Text(stringResource(R.string.common_send))
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showFeedbackDialog = false
                    feedbackText = ""
                }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }

    // 提交成功提示
    if (showSubmittedDialog) {
        AlertDialog(
            onDismissRequest = { showSubmittedDialog = false },
            icon = { Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary) },
            title = { Text(stringResource(R.string.help_submit_success)) },
            text = { Text(stringResource(R.string.help_submit_thanks)) },
            confirmButton = {
                TextButton(onClick = { showSubmittedDialog = false }) {
                    Text(stringResource(R.string.common_confirm))
                }
            }
        )
    }
}

/**
 * 快捷操作卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpActionCard(
    icon: ImageVector,
    title: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier,
        onClick = onClick,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(24.dp)
            )
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }
    }
}

/**
 * FAQ可展开卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FAQCard(faq: FAQItem) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = { expanded = !expanded },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        imageVector = Icons.Default.QuestionAnswer,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = faq.question,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Medium
                    )
                }
                Icon(
                    imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (expanded) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = faq.answer,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * 教程卡片
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TutorialCard(
    icon: ImageVector,
    title: String,
    description: String
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = {
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://docs.chainlesschain.com"))
            try { context.startActivity(intent) } catch (e: Exception) { Timber.w(e, "Failed to launch browser intent") }
        },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        ),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(20.dp)
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Icon(
                imageVector = Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/**
 * FAQ数据类
 */
data class FAQItem(
    val question: String,
    val answer: String
)
