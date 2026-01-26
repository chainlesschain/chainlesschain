package com.chainlesschain.android.feature.filebrowser.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.chainlesschain.android.feature.filebrowser.ml.TextRecognizer

/**
 * OCR Result Dialog
 *
 * Displays text recognition results with:
 * - Full extracted text
 * - Block/line/element structure
 * - Copy to clipboard
 * - Edit mode
 * - Structured data extraction (emails, phones, URLs)
 * - Confidence scores
 *
 * @param result Text recognition result
 * @param fileName Source file name for context
 * @param onDismiss Callback when dialog is dismissed
 * @param onSave Callback when edited text is saved
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OCRResultDialog(
    result: TextRecognizer.RecognitionResult,
    fileName: String,
    onDismiss: () -> Unit,
    onSave: ((String) -> Unit)? = null
) {
    val context = LocalContext.current
    var isEditMode by remember { mutableStateOf(false) }
    var editedText by remember { mutableStateOf(result.text) }
    var selectedTab by remember { mutableIntStateOf(0) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .fillMaxHeight(0.85f),
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Top bar
                TopAppBar(
                    title = {
                        Column {
                            Text(
                                text = "文字识别结果",
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = fileName,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Default.Close, contentDescription = "关闭")
                        }
                    },
                    actions = {
                        // Edit button
                        if (!isEditMode) {
                            IconButton(onClick = { isEditMode = true }) {
                                Icon(Icons.Default.Edit, contentDescription = "编辑")
                            }
                        }

                        // Copy button
                        IconButton(
                            onClick = {
                                copyToClipboard(
                                    context,
                                    if (isEditMode) editedText else result.text
                                )
                            }
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = "复制")
                        }

                        // Share button
                        IconButton(onClick = {
                            // Share OCR text using Android Share Sheet
                            try {
                                val textToShare = if (isEditMode) editedText else result.text
                                val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(android.content.Intent.EXTRA_TEXT, textToShare)
                                    putExtra(android.content.Intent.EXTRA_SUBJECT, "OCR识别结果: $fileName")
                                }
                                context.startActivity(android.content.Intent.createChooser(intent, "分享文字"))
                            } catch (e: Exception) {
                                android.util.Log.e("OCRResultDialog", "Error sharing text", e)
                            }
                        }) {
                            Icon(Icons.Default.Share, contentDescription = "分享")
                        }
                    }
                )

                // Tabs
                TabRow(selectedTabIndex = selectedTab) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text("文本") }
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = { Text("结构") }
                    )
                    Tab(
                        selected = selectedTab == 2,
                        onClick = { selectedTab = 2 },
                        text = { Text("数据") }
                    )
                }

                // Content
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                ) {
                    when (selectedTab) {
                        0 -> TextTab(
                            result = result,
                            isEditMode = isEditMode,
                            editedText = editedText,
                            onTextChange = { editedText = it }
                        )
                        1 -> StructureTab(result = result)
                        2 -> DataTab(result = result)
                    }
                }

                // Bottom actions (edit mode)
                if (isEditMode) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(onClick = {
                            editedText = result.text
                            isEditMode = false
                        }) {
                            Text("取消")
                        }

                        Spacer(modifier = Modifier.width(8.dp))

                        FilledTonalButton(
                            onClick = {
                                onSave?.invoke(editedText)
                                isEditMode = false
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Default.Check,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("保存")
                        }
                    }
                }
            }
        }
    }
}

/**
 * Text Tab - Display/Edit full text
 */
@Composable
private fun TextTab(
    result: TextRecognizer.RecognitionResult,
    isEditMode: Boolean,
    editedText: String,
    onTextChange: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Stats row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            StatItem(
                label = "字符数",
                value = result.text.length.toString()
            )
            StatItem(
                label = "文本块",
                value = result.blocks.size.toString()
            )
            StatItem(
                label = "置信度",
                value = "${(result.confidence * 100).toInt()}%"
            )
            result.language?.let { lang ->
                StatItem(
                    label = "语言",
                    value = lang.uppercase()
                )
            }
        }

        HorizontalDivider()

        // Text content
        if (isEditMode) {
            OutlinedTextField(
                value = editedText,
                onValueChange = onTextChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    fontFamily = FontFamily.Monospace
                ),
                placeholder = { Text("编辑识别的文本...") }
            )
        } else {
            if (result.isEmpty()) {
                EmptyTextContent()
            } else {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    shape = MaterialTheme.shapes.medium,
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
                ) {
                    LazyColumn(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        item {
                            Text(
                                text = result.text,
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    fontFamily = FontFamily.Monospace
                                )
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Structure Tab - Display text blocks and lines
 */
@Composable
private fun StructureTab(result: TextRecognizer.RecognitionResult) {
    if (result.isEmpty()) {
        EmptyTextContent()
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(result.blocks, key = { it.text.hashCode() }) { block ->
            TextBlockCard(block = block)
        }
    }
}

/**
 * Data Tab - Display extracted structured data
 */
@Composable
private fun DataTab(result: TextRecognizer.RecognitionResult) {
    val context = LocalContext.current
    val structuredData = remember(result) {
        TextRecognizer().extractStructuredData(result.text)
    }

    if (structuredData.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                )
                Text(
                    text = "未检测到结构化数据",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "如: 邮箱、电话、网址、日期等",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                )
            }
        }
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        structuredData.forEach { (type, values) ->
            item {
                DataTypeCard(
                    type = type,
                    values = values,
                    onCopy = { value ->
                        copyToClipboard(context, value)
                    }
                )
            }
        }
    }
}

/**
 * Text Block Card - Display a single text block
 */
@Composable
private fun TextBlockCard(block: TextRecognizer.TextBlock) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Block text
            Text(
                text = block.text,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )

            // Metadata
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "置信度: ${(block.confidence * 100).toInt()}%",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                block.recognizedLanguage?.let { lang ->
                    Text(
                        text = "语言: ${lang.uppercase()}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.weight(1f))

                TextButton(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "收起" else "展开")
                    Icon(
                        imageVector = if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                        contentDescription = null
                    )
                }
            }

            // Lines (when expanded)
            if (expanded) {
                HorizontalDivider()

                block.lines.forEach { line ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(4.dp),
                        color = MaterialTheme.colorScheme.surface
                    ) {
                        Column(modifier = Modifier.padding(8.dp)) {
                            Text(
                                text = line.text,
                                style = MaterialTheme.typography.bodySmall
                            )
                            Text(
                                text = "置信度: ${(line.confidence * 100).toInt()}%",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Data Type Card - Display extracted data of a specific type
 */
@Composable
private fun DataTypeCard(
    type: String,
    values: List<String>,
    onCopy: (String) -> Unit
) {
    val icon = when (type) {
        "email" -> Icons.Default.Email
        "phone" -> Icons.Default.Phone
        "url" -> Icons.Default.Link
        "date" -> Icons.Default.DateRange
        else -> Icons.Default.Info
    }

    val label = when (type) {
        "email" -> "邮箱"
        "phone" -> "电话"
        "url" -> "网址"
        "date" -> "日期"
        else -> type
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Header
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Text(
                    text = label,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Badge {
                    Text(values.size.toString())
                }
            }

            // Values
            values.forEach { value ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(4.dp),
                    color = MaterialTheme.colorScheme.surface
                ) {
                    Row(
                        modifier = Modifier.padding(8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = value,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontFamily = FontFamily.Monospace
                            ),
                            modifier = Modifier.weight(1f)
                        )

                        IconButton(
                            onClick = { onCopy(value) },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = "复制",
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Stat Item - Display a labeled statistic
 */
@Composable
private fun StatItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * Empty Text Content - Display when no text was recognized
 */
@Composable
private fun EmptyTextContent() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = Icons.Default.TextFields,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
            )
            Text(
                text = "未识别到文字",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "图片中可能没有可识别的文字",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )
        }
    }
}

/**
 * Copy text to clipboard
 */
private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText("OCR Text", text)
    clipboard.setPrimaryClip(clip)

    // Show toast notification
    android.widget.Toast.makeText(
        context,
        "已复制到剪贴板",
        android.widget.Toast.LENGTH_SHORT
    ).show()
}
