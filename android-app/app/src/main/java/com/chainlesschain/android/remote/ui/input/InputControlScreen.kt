package com.chainlesschain.android.remote.ui.input

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.p2p.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InputControlScreen(
    viewModel: InputControlViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val cursorPosition by viewModel.cursorPosition.collectAsState()
    val keyboardLayout by viewModel.keyboardLayout.collectAsState()

    val isConnected = connectionState == ConnectionState.CONNECTED

    var textToType by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Input Control") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 模式选择标签
            TabRow(
                selectedTabIndex = uiState.inputMode.ordinal
            ) {
                Tab(
                    selected = uiState.inputMode == InputMode.KEYBOARD,
                    onClick = { viewModel.setInputMode(InputMode.KEYBOARD) },
                    text = { Text("Keyboard") },
                    icon = { Icon(Icons.Default.Keyboard, contentDescription = null) }
                )
                Tab(
                    selected = uiState.inputMode == InputMode.MOUSE,
                    onClick = { viewModel.setInputMode(InputMode.MOUSE) },
                    text = { Text("Mouse") },
                    icon = { Icon(Icons.Default.Mouse, contentDescription = null) }
                )
                Tab(
                    selected = uiState.inputMode == InputMode.TOUCHPAD,
                    onClick = { viewModel.setInputMode(InputMode.TOUCHPAD) },
                    text = { Text("Touchpad") },
                    icon = { Icon(Icons.Default.TouchApp, contentDescription = null) }
                )
                Tab(
                    selected = uiState.inputMode == InputMode.TEXT,
                    onClick = { viewModel.setInputMode(InputMode.TEXT) },
                    text = { Text("Text") },
                    icon = { Icon(Icons.Default.TextFields, contentDescription = null) }
                )
            }

            // 错误提示
            uiState.error?.let { error ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(error, color = MaterialTheme.colorScheme.onErrorContainer)
                        IconButton(onClick = { viewModel.clearError() }) {
                            Icon(Icons.Default.Close, contentDescription = "Dismiss")
                        }
                    }
                }
            }

            // 最后操作
            uiState.lastAction?.let { action ->
                Text(
                    text = "Last: $action",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // 根据模式显示不同内容
            when (uiState.inputMode) {
                InputMode.KEYBOARD -> KeyboardPanel(viewModel, isConnected)
                InputMode.MOUSE -> MousePanel(viewModel, isConnected, cursorPosition)
                InputMode.TOUCHPAD -> TouchpadPanel(viewModel, isConnected)
                InputMode.TEXT -> TextInputPanel(
                    viewModel = viewModel,
                    enabled = isConnected,
                    text = textToType,
                    onTextChange = { textToType = it }
                )
            }

            // 加载指示器
            if (uiState.isExecuting) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun KeyboardPanel(viewModel: InputControlViewModel, enabled: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 快捷操作
        Text("Quick Actions", fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            QuickActionButton(Modifier.weight(1f), "Copy", enabled) { viewModel.copy() }
            QuickActionButton(Modifier.weight(1f), "Paste", enabled) { viewModel.paste() }
            QuickActionButton(Modifier.weight(1f), "Cut", enabled) { viewModel.cut() }
            QuickActionButton(Modifier.weight(1f), "Undo", enabled) { viewModel.undo() }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            QuickActionButton(Modifier.weight(1f), "Select All", enabled) { viewModel.selectAll() }
            QuickActionButton(Modifier.weight(1f), "Save", enabled) { viewModel.save() }
        }

        HorizontalDivider()

        // 功能键
        Text("Function Keys", fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            (1..6).forEach { i ->
                KeyButton(Modifier.weight(1f), "F$i", enabled) { viewModel.sendKey("f$i") }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            (7..12).forEach { i ->
                KeyButton(Modifier.weight(1f), "F$i", enabled) { viewModel.sendKey("f$i") }
            }
        }

        HorizontalDivider()

        // 常用键
        Text("Common Keys", fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            KeyButton(Modifier.weight(1f), "Esc", enabled) { viewModel.pressEscape() }
            KeyButton(Modifier.weight(1f), "Tab", enabled) { viewModel.pressTab() }
            KeyButton(Modifier.weight(1f), "Enter", enabled) { viewModel.pressEnter() }
            KeyButton(Modifier.weight(1f), "Space", enabled) { viewModel.pressSpace() }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            KeyButton(Modifier.weight(1f), "Backspace", enabled) { viewModel.pressBackspace() }
            KeyButton(Modifier.weight(1f), "Delete", enabled) { viewModel.pressDelete() }
            KeyButton(Modifier.weight(1f), "Home", enabled) { viewModel.pressHome() }
            KeyButton(Modifier.weight(1f), "End", enabled) { viewModel.pressEnd() }
        }

        HorizontalDivider()

        // 方向键
        Text("Arrow Keys", fontWeight = FontWeight.Bold)
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            KeyButton(Modifier.width(80.dp), "↑", enabled) { viewModel.sendKey("up") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                KeyButton(Modifier.width(80.dp), "←", enabled) { viewModel.sendKey("left") }
                KeyButton(Modifier.width(80.dp), "↓", enabled) { viewModel.sendKey("down") }
                KeyButton(Modifier.width(80.dp), "→", enabled) { viewModel.sendKey("right") }
            }
        }

        HorizontalDivider()

        // Windows 组合键
        Text("Windows Shortcuts", fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            QuickActionButton(Modifier.weight(1f), "Win+D", enabled) {
                viewModel.sendKeyCombo("d", listOf("win"))
            }
            QuickActionButton(Modifier.weight(1f), "Win+E", enabled) {
                viewModel.sendKeyCombo("e", listOf("win"))
            }
            QuickActionButton(Modifier.weight(1f), "Win+L", enabled) {
                viewModel.sendKeyCombo("l", listOf("win"))
            }
            QuickActionButton(Modifier.weight(1f), "Alt+Tab", enabled) {
                viewModel.sendKeyCombo("tab", listOf("alt"))
            }
        }
    }
}

@Composable
private fun MousePanel(
    viewModel: InputControlViewModel,
    enabled: Boolean,
    cursorPosition: Pair<Int, Int>
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 鼠标位置
        Text(
            text = "Cursor: (${cursorPosition.first}, ${cursorPosition.second})",
            style = MaterialTheme.typography.bodyMedium
        )

        // 鼠标按钮
        Text("Mouse Buttons", fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = { viewModel.leftClick() },
                enabled = enabled,
                modifier = Modifier.weight(1f)
            ) {
                Text("Left Click")
            }
            Button(
                onClick = { viewModel.rightClick() },
                enabled = enabled,
                modifier = Modifier.weight(1f)
            ) {
                Text("Right Click")
            }
            Button(
                onClick = { viewModel.doubleClick() },
                enabled = enabled,
                modifier = Modifier.weight(1f)
            ) {
                Text("Double Click")
            }
        }

        HorizontalDivider()

        // 滚动
        Text("Scroll", fontWeight = FontWeight.Bold)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = { viewModel.scrollUp() },
                enabled = enabled,
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.KeyboardArrowUp, contentDescription = null)
                Spacer(modifier = Modifier.width(4.dp))
                Text("Scroll Up")
            }
            Button(
                onClick = { viewModel.scrollDown() },
                enabled = enabled,
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.KeyboardArrowDown, contentDescription = null)
                Spacer(modifier = Modifier.width(4.dp))
                Text("Scroll Down")
            }
        }

        HorizontalDivider()

        // 移动控制
        Text("Move Cursor", fontWeight = FontWeight.Bold)
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            IconButton(
                onClick = { viewModel.moveMouseRelative(0, -20) },
                enabled = enabled
            ) {
                Icon(Icons.Default.KeyboardArrowUp, contentDescription = "Up", Modifier.size(48.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                IconButton(
                    onClick = { viewModel.moveMouseRelative(-20, 0) },
                    enabled = enabled
                ) {
                    Icon(Icons.Default.KeyboardArrowLeft, contentDescription = "Left", Modifier.size(48.dp))
                }
                IconButton(
                    onClick = { viewModel.moveMouseRelative(20, 0) },
                    enabled = enabled
                ) {
                    Icon(Icons.Default.KeyboardArrowRight, contentDescription = "Right", Modifier.size(48.dp))
                }
            }
            IconButton(
                onClick = { viewModel.moveMouseRelative(0, 20) },
                enabled = enabled
            ) {
                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Down", Modifier.size(48.dp))
            }
        }

        Button(
            onClick = { viewModel.loadCursorPosition() },
            modifier = Modifier.align(Alignment.CenterHorizontally)
        ) {
            Text("Refresh Position")
        }
    }
}

@Composable
private fun TouchpadPanel(viewModel: InputControlViewModel, enabled: Boolean) {
    var lastX by remember { mutableStateOf(0f) }
    var lastY by remember { mutableStateOf(0f) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Touchpad", fontWeight = FontWeight.Bold)
        Text(
            text = "Drag to move cursor, tap to click",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        // 触摸板区域
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .background(
                    MaterialTheme.colorScheme.surfaceVariant,
                    MaterialTheme.shapes.medium
                )
                .pointerInput(enabled) {
                    if (enabled) {
                        detectTapGestures(
                            onTap = { viewModel.leftClick() },
                            onDoubleTap = { viewModel.doubleClick() },
                            onLongPress = { viewModel.rightClick() }
                        )
                    }
                }
                .pointerInput(enabled) {
                    if (enabled) {
                        detectDragGestures(
                            onDragStart = { offset ->
                                lastX = offset.x
                                lastY = offset.y
                            },
                            onDrag = { change, _ ->
                                val deltaX = (change.position.x - lastX).toInt()
                                val deltaY = (change.position.y - lastY).toInt()
                                if (kotlin.math.abs(deltaX) > 2 || kotlin.math.abs(deltaY) > 2) {
                                    viewModel.moveMouseRelative(deltaX, deltaY)
                                    lastX = change.position.x
                                    lastY = change.position.y
                                }
                            }
                        )
                    }
                },
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Touch Area",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // 底部按钮
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = { viewModel.leftClick() },
                enabled = enabled,
                modifier = Modifier.weight(1f)
            ) {
                Text("Left")
            }
            Button(
                onClick = { viewModel.rightClick() },
                enabled = enabled,
                modifier = Modifier.weight(1f)
            ) {
                Text("Right")
            }
        }
    }
}

@Composable
private fun TextInputPanel(
    viewModel: InputControlViewModel,
    enabled: Boolean,
    text: String,
    onTextChange: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Text Input", fontWeight = FontWeight.Bold)
        Text(
            text = "Type text and send to PC",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        OutlinedTextField(
            value = text,
            onValueChange = onTextChange,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            placeholder = { Text("Enter text to send...") },
            enabled = enabled
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Button(
                onClick = {
                    if (text.isNotEmpty()) {
                        viewModel.typeText(text)
                        onTextChange("")
                    }
                },
                enabled = enabled && text.isNotEmpty(),
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.Send, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Send Text")
            }
            OutlinedButton(
                onClick = { onTextChange("") },
                enabled = text.isNotEmpty(),
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.Clear, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Clear")
            }
        }

        Button(
            onClick = { viewModel.pressEnter() },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Send Enter")
        }
    }
}

@Composable
private fun QuickActionButton(
    modifier: Modifier = Modifier,
    text: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    FilledTonalButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
    ) {
        Text(text, maxLines = 1)
    }
}

@Composable
private fun KeyButton(
    modifier: Modifier = Modifier,
    text: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)
    ) {
        Text(text, maxLines = 1)
    }
}
