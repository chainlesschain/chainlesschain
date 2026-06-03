# 远程控制模块 - Android 端

基于 P2P 网络的远程命令客户端，支持 Android 设备远程控制 PC。

## 目录结构

```
remote/
├── data/
│   └── CommandProtocol.kt        # 命令协议数据模型
├── p2p/
│   └── P2PClient.kt              # P2P 客户端
├── client/
│   └── RemoteCommandClient.kt    # 命令客户端封装
├── commands/
│   ├── AICommands.kt             # AI 命令 API
│   └── SystemCommands.kt         # 系统命令 API
└── README.md                     # 本文件
```

## 快速开始

### 1. 添加依赖（build.gradle.kts）

```kotlin
dependencies {
    // Kotlin Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // WebRTC (待集成)
    // implementation("io.getstream:stream-webrtc-android:1.1.0")

    // Hilt DI
    implementation("com.google.dagger:hilt-android:2.50")
    kapt("com.google.dagger:hilt-compiler:2.50")

    // Timber 日志
    implementation("com.jakewharton.timber:timber:5.0.1")
}
```

### 2. 连接到 PC

```kotlin
@HiltViewModel
class RemoteControlViewModel @Inject constructor(
    private val p2pClient: P2PClient,
    private val aiCommands: AICommands,
    private val systemCommands: SystemCommands
) : ViewModel() {

    val connectionState = p2pClient.connectionState.asStateFlow()

    fun connectToPC(pcPeerId: String, pcDID: String) {
        viewModelScope.launch {
            val result = p2pClient.connect(pcPeerId, pcDID)

            if (result.isSuccess) {
                Log.d(TAG, "连接成功")
            } else {
                Log.e(TAG, "连接失败: ${result.exceptionOrNull()}")
            }
        }
    }

    fun disconnect() {
        p2pClient.disconnect()
    }
}
```

### 3. 发送 AI 对话命令

```kotlin
suspend fun sendChatMessage(message: String) {
    val result = aiCommands.chat(
        message = message,
        model = "gpt-4"
    )

    result.onSuccess { response ->
        Log.d(TAG, "AI 回复: ${response.reply}")
        // 更新 UI
        _messages.value = _messages.value + Message(
            role = "assistant",
            content = response.reply
        )
    }

    result.onFailure { error ->
        Log.e(TAG, "对话失败: ${error.message}")
    }
}
```

### 4. 获取 PC 系统状态

```kotlin
suspend fun getSystemStatus() {
    val result = systemCommands.getStatus()

    result.onSuccess { status ->
        Log.d(TAG, "CPU 使用率: ${status.cpu.usage}%")
        Log.d(TAG, "内存使用率: ${status.memory.usagePercent}%")

        // 更新 UI
        _systemStatus.value = status
    }

    result.onFailure { error ->
        Log.e(TAG, "获取状态失败: ${error.message}")
    }
}
```

### 5. PC 截图

```kotlin
suspend fun takeScreenshot() {
    val result = systemCommands.screenshot(
        display = 0,
        format = "png",
        quality = 80
    )

    result.onSuccess { response ->
        // 解码 Base64 图片
        val imageBytes = Base64.decode(response.data, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)

        // 显示图片
        _screenshot.value = bitmap
    }
}
```

### 6. 监听 PC 事件

```kotlin
init {
    viewModelScope.launch {
        p2pClient.events.collect { event ->
            Log.d(TAG, "收到事件: ${event.method}")

            when (event.method) {
                "pc.status.changed" -> {
                    val status = event.params["status"] as? String
                    Log.d(TAG, "PC 状态变更: $status")
                }

                "pc.notification" -> {
                    val message = event.params["message"] as? String
                    // 显示通知
                }
            }
        }
    }
}
```

## Jetpack Compose UI 示例

### 远程控制主界面

```kotlin
@Composable
fun RemoteControlScreen(
    viewModel: RemoteControlViewModel = hiltViewModel()
) {
    val connectionState by viewModel.connectionState.collectAsState()
    val systemStatus by viewModel.systemStatus.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("远程控制") },
                actions = {
                    // 连接状态指示器
                    ConnectionStatusIcon(connectionState)
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
        ) {
            // 连接控制
            ConnectionControl(
                connectionState = connectionState,
                onConnect = { viewModel.connectToPC(it) },
                onDisconnect = { viewModel.disconnect() }
            )

            Divider()

            // 系统状态
            if (connectionState == ConnectionState.CONNECTED) {
                SystemStatusCard(systemStatus)

                Divider()

                // 命令快捷操作
                CommandShortcuts(
                    onScreenshot = { viewModel.takeScreenshot() },
                    onNotify = { viewModel.sendNotification() },
                    onChat = { viewModel.openChatDialog() }
                )
            }
        }
    }
}

@Composable
fun SystemStatusCard(status: SystemStatus?) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = "系统状态",
                style = MaterialTheme.typography.titleMedium
            )

            Spacer(modifier = Modifier.height(8.dp))

            if (status != null) {
                StatusRow("CPU 使用率", "${status.cpu.usage}%")
                StatusRow("内存使用率", "${status.memory.usagePercent}%")
                StatusRow("运行时间", formatUptime(status.system.uptime))
            } else {
                CircularProgressIndicator()
            }
        }
    }
}

@Composable
fun StatusRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label)
        Text(text = value, fontWeight = FontWeight.Bold)
    }
}
```

### AI 对话界面

```kotlin
@Composable
fun AIChatScreen(
    viewModel: RemoteControlViewModel = hiltViewModel()
) {
    val messages by viewModel.messages.collectAsState()
    var inputText by remember { mutableStateOf("") }

    Column(modifier = Modifier.fillMaxSize()) {
        // 消息列表
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            reverseLayout = true
        ) {
            items(messages.reversed()) { message ->
                MessageBubble(message)
            }
        }

        // 输入框
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextField(
                value = inputText,
                onValueChange = { inputText = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("输入消息...") }
            )

            Spacer(modifier = Modifier.width(8.dp))

            IconButton(
                onClick = {
                    if (inputText.isNotBlank()) {
                        viewModel.sendChatMessage(inputText)
                        inputText = ""
                    }
                }
            ) {
                Icon(Icons.Default.Send, "发送")
            }
        }
    }
}
```

## 完整示例：语音命令

```kotlin
@Composable
fun VoiceCommandButton(
    viewModel: RemoteControlViewModel = hiltViewModel()
) {
    var isRecording by remember { mutableStateOf(false) }

    FloatingActionButton(
        onClick = {
            if (isRecording) {
                viewModel.stopVoiceRecording()
            } else {
                viewModel.startVoiceRecording()
            }
            isRecording = !isRecording
        }
    ) {
        Icon(
            imageVector = if (isRecording) Icons.Default.Stop else Icons.Default.Mic,
            contentDescription = "语音命令"
        )
    }
}

// ViewModel
fun startVoiceRecording() {
    viewModelScope.launch {
        // 使用 Android SpeechRecognizer
        val recognizer = SpeechRecognizer.createSpeechRecognizer(context)

        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(
                    SpeechRecognizer.RESULTS_RECOGNITION
                )
                val text = matches?.firstOrNull() ?: return

                // 发送语音命令
                viewModelScope.launch {
                    sendChatMessage(text)
                }
            }

            override fun onError(error: Int) {
                Log.e(TAG, "语音识别错误: $error")
            }

            // ... 其他回调
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
        }

        recognizer.startListening(intent)
    }
}
```

## 高级用法

### 离线消息队列（TODO）

当网络断开时，命令会自动加入队列，重新连接后批量发送。

```kotlin
class OfflineMessageQueue @Inject constructor(
    private val database: AppDatabase
) {
    suspend fun enqueue(command: CommandRequest) {
        database.offlineCommandDao().insert(command)
    }

    suspend fun dequeueAll(): List<CommandRequest> {
        return database.offlineCommandDao().getAll()
    }

    suspend fun clear() {
        database.offlineCommandDao().deleteAll()
    }
}
```

### 自定义命令

```kotlin
// 扩展 RemoteCommandClient
class CustomCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    suspend fun myCustomCommand(param: String): Result<CustomResponse> {
        return client.invoke("custom.myCommand", mapOf("param" to param))
    }
}
```

## 注意事项

1. **权限**: 确保 Android 应用有网络权限
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
   ```

2. **后台运行**: 如需后台保持连接，使用 Foreground Service

3. **电量优化**: 合理设置心跳间隔，避免电量消耗过大

4. **安全**: 所有命令都经过 DID 签名验证，确保安全

## 下一步

- [ ] 集成 WebRTC 完整实现
- [ ] 实现离线消息队列
- [ ] 添加语音命令支持
- [ ] 实现 Canvas 镜像（PC 屏幕共享）
- [ ] 添加更多命令处理器（文件、知识库等）

## 相关文档

- [PC 端远程控制模块](../../../../../desktop-app-vue/src/main/remote/README.md)
- [命令协议规范](../../../../docs/features/COMMAND_PROTOCOL.md)
- [权限系统](../../../../docs/features/PERMISSION_SYSTEM.md)
