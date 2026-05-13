package com.chainlesschain.android.presentation.screens

import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Preview
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import com.chainlesschain.android.core.ui.components.MarkdownText
import com.chainlesschain.android.feature.filebrowser.data.repository.ExternalFileRepository
import com.chainlesschain.android.feature.project.ui.components.EnhancedCodeEditor
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject

/**
 * 只读代码查看器。
 *
 * NavGraph 用 `code_viewer/{fileId}` 路由进入；fileId 是 ExternalFileEntity.id。
 * 通过 ExternalFileRepository 解出 URI + 元数据，再走 ContentResolver 读 5MB 以内
 * 的文本。binary / 超大 / 读取失败时显示错误态而不是空 editor。
 *
 * 入口是 GlobalFileBrowserScreen.onOpenInEditor — 它在 file 是 text/code 且
 * 调用方提供了 callback 时被触发；这里负责 viewer 这一端的承载。
 */
@HiltViewModel
class CodeViewerViewModel @Inject constructor(
    private val externalFileRepository: ExternalFileRepository,
    @ApplicationContext private val context: Context,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val fileId: String = savedStateHandle.get<String>(ARG_FILE_ID) ?: ""

    private val _state = MutableStateFlow(CodeViewerState())
    val state: StateFlow<CodeViewerState> = _state.asStateFlow()

    init {
        load()
    }

    private fun load() {
        viewModelScope.launch {
            if (fileId.isBlank()) {
                _state.update {
                    it.copy(loading = false, error = "fileId is empty")
                }
                return@launch
            }

            val file = runCatching { externalFileRepository.getById(fileId) }
                .onFailure { Timber.e(it, "[CodeViewer] getById failed: $fileId") }
                .getOrNull()
            if (file == null) {
                _state.update {
                    it.copy(loading = false, error = "File not found: $fileId")
                }
                return@launch
            }

            if (file.size > MAX_VIEW_SIZE_BYTES) {
                _state.update {
                    it.copy(
                        loading = false,
                        displayName = file.displayName,
                        error = "File too large to view (${file.getReadableSize()}). " +
                            "Max ${MAX_VIEW_SIZE_BYTES / 1024 / 1024}MB.",
                    )
                }
                return@launch
            }

            val readResult = readUriAsText(file.uri)
            _state.update {
                it.copy(
                    loading = false,
                    displayName = file.displayName,
                    language = inferLanguage(file.extension),
                    content = readResult.getOrNull().orEmpty(),
                    error = readResult.exceptionOrNull()?.let { e ->
                        "Failed to read content: ${e.message ?: e.javaClass.simpleName}"
                    },
                )
            }
        }
    }

    private suspend fun readUriAsText(uriStr: String): Result<String> =
        withContext(Dispatchers.IO) {
            runCatching {
                val uri = Uri.parse(uriStr)
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    stream.bufferedReader(Charsets.UTF_8).readText()
                } ?: error("openInputStream returned null for $uriStr")
            }
        }

    companion object {
        const val ARG_FILE_ID = "fileId"

        // 5MB. EnhancedCodeEditor uses Column-per-line; bigger files freeze the UI thread.
        private const val MAX_VIEW_SIZE_BYTES = 5L * 1024 * 1024
    }
}

data class CodeViewerState(
    val loading: Boolean = true,
    val error: String? = null,
    val displayName: String = "",
    val content: String = "",
    val language: String? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodeViewerScreen(
    onNavigateBack: () -> Unit,
    viewModel: CodeViewerViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = state.displayName.ifBlank { "代码查看器" },
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        state.language?.let { lang ->
                            Text(
                                text = lang,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                        )
                    }
                },
            )
        },
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
        ) {
            when {
                state.loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }

                state.error != null -> {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(
                            imageVector = Icons.Default.ErrorOutline,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(48.dp),
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = "无法查看",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = state.error!!,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }

                else -> {
                    // #21 P3 fix: .md/.markdown 文件走 Preview + Edit (源码) 双 tab
                    // 默认 Preview，用户反馈"看 md 格式文件比较不美观"
                    val isMarkdown = state.displayName.endsWith(".md", ignoreCase = true) ||
                        state.displayName.endsWith(".markdown", ignoreCase = true)
                    if (isMarkdown) {
                        var selectedTab by remember { mutableIntStateOf(0) }  // 0 = Preview, 1 = Source
                        Column(modifier = Modifier.fillMaxSize()) {
                            TabRow(selectedTabIndex = selectedTab) {
                                Tab(
                                    selected = selectedTab == 0,
                                    onClick = { selectedTab = 0 },
                                    text = { Text("预览") },
                                    icon = { Icon(Icons.Default.Preview, null) },
                                )
                                Tab(
                                    selected = selectedTab == 1,
                                    onClick = { selectedTab = 1 },
                                    text = { Text("源码") },
                                    icon = { Icon(Icons.Default.Code, null) },
                                )
                            }
                            if (selectedTab == 0) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .verticalScroll(rememberScrollState())
                                        .padding(16.dp),
                                ) {
                                    MarkdownText(
                                        markdown = state.content,
                                        textColor = MaterialTheme.colorScheme.onSurface,
                                        linkColor = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                            } else {
                                EnhancedCodeEditor(
                                    content = state.content,
                                    onContentChange = { /* readOnly */ },
                                    language = "markdown",
                                    modifier = Modifier.fillMaxSize(),
                                    readOnly = true,
                                )
                            }
                        }
                    } else {
                        EnhancedCodeEditor(
                            content = state.content,
                            onContentChange = { /* readOnly = true，不写回 */ },
                            language = state.language,
                            modifier = Modifier.fillMaxSize(),
                            readOnly = true,
                        )
                    }
                }
            }
        }
    }
}

private fun inferLanguage(extension: String?): String? {
    val ext = extension?.lowercase() ?: return null
    return when (ext) {
        "kt", "kts" -> "kotlin"
        "java" -> "java"
        "py" -> "python"
        "js", "jsx" -> "javascript"
        "ts", "tsx" -> "typescript"
        "c", "h" -> "c"
        "cpp", "hpp" -> "cpp"
        "go" -> "go"
        "rs" -> "rust"
        "rb" -> "ruby"
        "php" -> "php"
        "html" -> "html"
        "css", "scss", "sass" -> "css"
        "json" -> "json"
        "xml" -> "xml"
        "yml", "yaml" -> "yaml"
        "sql" -> "sql"
        "sh", "bash" -> "shell"
        "gradle" -> "groovy"
        "md" -> "markdown"
        "swift" -> "swift"
        else -> null
    }
}
