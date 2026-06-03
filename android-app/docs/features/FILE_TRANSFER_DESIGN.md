# 文件传输模块设计文档

## 概述

本文档详细设计 P2P 文件传输功能，支持点对点加密文件传输、断点续传、多文件传输和进度管理。

**版本：** v1.0
**状态：** 设计阶段
**优先级：** 高
**预计工时：** 2-3 周

---

## 1. 功能需求

### 1.1 核心功能

- ✅ P2P 文件传输（点对点）
- ✅ 文件分块传输（支持大文件）
- ✅ 断点续传（网络中断后恢复）
- ✅ 多文件队列传输
- ✅ 传输进度显示（速度、剩余时间）
- ✅ 文件类型图标
- ✅ 文件预览（图片、文档）
- ✅ E2EE 加密传输

### 1.2 用户场景

**场景 1：发送单个文件**
1. 用户在聊天界面点击"发送文件"
2. 选择文件（相册、文档、其他）
3. 系统显示文件信息（名称、大小、类型）
4. 用户确认发送
5. 文件开始传输，显示进度
6. 传输完成，显示成功消息

**场景 2：接收文件**
1. 收到文件传输请求
2. 显示文件信息和发送者
3. 用户选择接受或拒绝
4. 接受后开始下载，显示进度
5. 下载完成，可预览或打开

**场景 3：断点续传**
1. 传输过程中网络中断
2. 系统自动保存传输状态
3. 网络恢复后，显示"继续传输"按钮
4. 用户点击继续，从中断处恢复

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────┐
│           Presentation Layer            │
│  FileTransferScreen, FileListScreen     │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│           Domain Layer                  │
│  FileTransferUseCase, FileManager       │
└───────────────┬─────────────────────────┘
                │
┌───────────────▼─────────────────────────┐
│           Data Layer                    │
│  FileTransferRepository, P2PService     │
└─────────────────────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 FileTransferManager

**职责：**
- 管理文件传输队列
- 协调发送和接收
- 处理传输状态
- 管理传输进度

```kotlin
class FileTransferManager(
    private val p2pService: P2PService,
    private val fileRepository: FileTransferRepository,
    private val encryptionManager: EncryptionManager,
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO
) {
    private val activeTransfers = ConcurrentHashMap<String, TransferSession>()

    /**
     * 发送文件
     */
    suspend fun sendFile(
        file: File,
        recipientId: String,
        onProgress: (Float) -> Unit = {}
    ): Result<String>

    /**
     * 接收文件
     */
    suspend fun receiveFile(
        transferId: String,
        onProgress: (Float) -> Unit = {}
    ): Result<File>

    /**
     * 暂停传输
     */
    suspend fun pauseTransfer(transferId: String): Result<Unit>

    /**
     * 恢复传输
     */
    suspend fun resumeTransfer(transferId: String): Result<Unit>

    /**
     * 取消传输
     */
    suspend fun cancelTransfer(transferId: String): Result<Unit>
}
```

#### 2.2.2 FileChunker

**职责：**
- 文件分块
- 块校验
- 块组装

```kotlin
class FileChunker(
    private val chunkSize: Int = 64 * 1024  // 64KB per chunk
) {
    /**
     * 将文件分块
     */
    fun chunkFile(file: File): List<FileChunk> {
        val chunks = mutableListOf<FileChunk>()
        file.inputStream().use { input ->
            var chunkIndex = 0
            val buffer = ByteArray(chunkSize)

            var bytesRead: Int
            while (input.read(buffer).also { bytesRead = it } != -1) {
                chunks.add(
                    FileChunk(
                        index = chunkIndex++,
                        data = buffer.copyOf(bytesRead),
                        checksum = calculateChecksum(buffer, bytesRead)
                    )
                )
            }
        }
        return chunks
    }

    /**
     * 组装文件块
     */
    fun assembleChunks(
        chunks: List<FileChunk>,
        outputFile: File
    ): Result<Unit>

    /**
     * 验证块完整性
     */
    fun verifyChunk(chunk: FileChunk): Boolean
}

data class FileChunk(
    val index: Int,
    val data: ByteArray,
    val checksum: String
)
```

#### 2.2.3 TransferSession

**职责：**
- 管理单个传输会话
- 跟踪传输状态
- 处理断点续传

```kotlin
data class TransferSession(
    val id: String,
    val fileInfo: FileInfo,
    val direction: TransferDirection,
    val state: TransferState,
    val progress: TransferProgress,
    val chunks: List<ChunkStatus>
) {
    enum class TransferDirection {
        UPLOAD, DOWNLOAD
    }

    enum class TransferState {
        PENDING,      // 等待中
        CONNECTING,   // 连接中
        TRANSFERRING, // 传输中
        PAUSED,       // 已暂停
        COMPLETED,    // 已完成
        FAILED,       // 失败
        CANCELLED     // 已取消
    }
}

data class TransferProgress(
    val totalBytes: Long,
    val transferredBytes: Long,
    val speed: Long,  // bytes per second
    val remainingTime: Long,  // seconds
    val percentage: Float
)

data class ChunkStatus(
    val index: Int,
    val isTransferred: Boolean,
    val checksum: String?
)
```

---

## 3. 数据库设计

### 3.1 文件传输表

```kotlin
@Entity(tableName = "file_transfers")
data class FileTransferEntity(
    @PrimaryKey
    val id: String,
    val fileName: String,
    val fileSize: Long,
    val filePath: String,
    val mimeType: String,
    val direction: String,  // UPLOAD/DOWNLOAD
    val state: String,
    val peerId: String,
    val totalChunks: Int,
    val transferredChunks: Int,
    val transferredBytes: Long,
    val speed: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val resumeData: String?  // JSON: 已传输的块列表
)

@Dao
interface FileTransferDao {
    @Query("SELECT * FROM file_transfers WHERE id = :id")
    fun getById(id: String): Flow<FileTransferEntity?>

    @Query("SELECT * FROM file_transfers WHERE state = :state")
    fun getByState(state: String): Flow<List<FileTransferEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entity: FileTransferEntity)

    @Update
    suspend fun update(entity: FileTransferEntity)

    @Delete
    suspend fun delete(entity: FileTransferEntity)
}
```

---

## 4. 传输协议

### 4.1 消息格式

```kotlin
sealed class FileTransferMessage {
    /**
     * 文件传输请求
     */
    data class TransferRequest(
        val transferId: String,
        val fileInfo: FileInfo,
        val totalChunks: Int
    ) : FileTransferMessage()

    /**
     * 传输响应（接受/拒绝）
     */
    data class TransferResponse(
        val transferId: String,
        val accepted: Boolean,
        val reason: String? = null
    ) : FileTransferMessage()

    /**
     * 块数据
     */
    data class ChunkData(
        val transferId: String,
        val chunkIndex: Int,
        val data: ByteArray,
        val checksum: String
    ) : FileTransferMessage()

    /**
     * 块确认
     */
    data class ChunkAck(
        val transferId: String,
        val chunkIndex: Int,
        val success: Boolean
    ) : FileTransferMessage()

    /**
     * 传输完成
     */
    data class TransferComplete(
        val transferId: String,
        val success: Boolean,
        val fileChecksum: String
    ) : FileTransferMessage()

    /**
     * 暂停传输
     */
    data class TransferPause(
        val transferId: String
    ) : FileTransferMessage()

    /**
     * 恢复传输
     */
    data class TransferResume(
        val transferId: String,
        val lastChunkIndex: Int
    ) : FileTransferMessage()
}

data class FileInfo(
    val name: String,
    val size: Long,
    val mimeType: String,
    val checksum: String
)
```

### 4.2 传输流程

```
发送方                                    接收方
  │                                        │
  │─────── TransferRequest ──────────────>│
  │                                        │
  │<────── TransferResponse ──────────────│
  │         (accepted=true)                │
  │                                        │
  │─────── ChunkData(0) ──────────────────>│
  │<────── ChunkAck(0, success) ──────────│
  │                                        │
  │─────── ChunkData(1) ──────────────────>│
  │<────── ChunkAck(1, success) ──────────│
  │                                        │
  │          ... (更多块) ...              │
  │                                        │
  │─────── TransferComplete ──────────────>│
  │<────── ChunkAck (final) ───────────────│
  │                                        │
```

---

## 5. UI 设计

### 5.1 文件传输列表

```kotlin
@Composable
fun FileTransferListScreen(
    viewModel: FileTransferViewModel = hiltViewModel()
) {
    val transfers by viewModel.transfers.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("文件传输") })
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            items(
                items = transfers,
                key = { it.id }
            ) { transfer ->
                FileTransferItem(
                    transfer = transfer,
                    onPause = { viewModel.pauseTransfer(transfer.id) },
                    onResume = { viewModel.resumeTransfer(transfer.id) },
                    onCancel = { viewModel.cancelTransfer(transfer.id) }
                )
            }
        }
    }
}
```

### 5.2 传输项组件

```kotlin
@Composable
fun FileTransferItem(
    transfer: TransferSession,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onCancel: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            // 文件信息
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                FileTypeIcon(
                    mimeType = transfer.fileInfo.mimeType,
                    modifier = Modifier.size(48.dp)
                )

                Spacer(modifier = Modifier.width(12.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = transfer.fileInfo.name,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = formatFileSize(transfer.fileInfo.size),
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                // 状态图标
                TransferStateIcon(state = transfer.state)
            }

            Spacer(modifier = Modifier.height(12.dp))

            // 进度条
            LinearProgressIndicator(
                progress = transfer.progress.percentage / 100f,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(8.dp))

            // 传输信息
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "${transfer.progress.percentage.toInt()}%",
                    style = MaterialTheme.typography.bodySmall
                )
                Text(
                    text = "${formatSpeed(transfer.progress.speed)} • " +
                          "${formatTime(transfer.progress.remainingTime)}",
                    style = MaterialTheme.typography.bodySmall
                )
            }

            // 操作按钮
            if (transfer.state == TransferState.TRANSFERRING ||
                transfer.state == TransferState.PAUSED) {

                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    // 暂停/恢复按钮
                    if (transfer.state == TransferState.TRANSFERRING) {
                        TextButton(onClick = onPause) {
                            Text("暂停")
                        }
                    } else {
                        TextButton(onClick = onResume) {
                            Text("继续")
                        }
                    }

                    // 取消按钮
                    TextButton(onClick = onCancel) {
                        Text("取消")
                    }
                }
            }
        }
    }
}
```

### 5.3 文件选择器

```kotlin
@Composable
fun FilePickerDialog(
    onFileSelected: (Uri) -> Unit,
    onDismiss: () -> Unit
) {
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { onFileSelected(it) }
        onDismiss()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("选择文件") },
        text = {
            Column {
                FileTypeOption(
                    icon = Icons.Default.Image,
                    text = "图片",
                    onClick = { launcher.launch("image/*") }
                )
                FileTypeOption(
                    icon = Icons.Default.VideoLibrary,
                    text = "视频",
                    onClick = { launcher.launch("video/*") }
                )
                FileTypeOption(
                    icon = Icons.Default.Description,
                    text = "文档",
                    onClick = { launcher.launch("application/*") }
                )
                FileTypeOption(
                    icon = Icons.Default.InsertDriveFile,
                    text = "其他",
                    onClick = { launcher.launch("*/*") }
                )
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
```

---

## 6. 性能优化

### 6.1 分块大小优化

```kotlin
object ChunkSizeOptimizer {
    /**
     * 根据文件大小和网络状况动态调整块大小
     */
    fun calculateOptimalChunkSize(
        fileSize: Long,
        networkSpeed: Long  // bytes per second
    ): Int {
        return when {
            fileSize < 1.MB -> 32.KB
            fileSize < 10.MB -> 64.KB
            fileSize < 100.MB -> 128.KB
            fileSize < 1.GB -> 256.KB
            else -> 512.KB
        }.toInt()
    }

    private val Int.KB: Long get() = this * 1024L
    private val Int.MB: Long get() = this * 1024L * 1024L
    private val Int.GB: Long get() = this * 1024L * 1024L * 1024L
}
```

### 6.2 并发传输控制

```kotlin
class TransferRateLimiter(
    private val maxConcurrentTransfers: Int = 3
) {
    private val semaphore = Semaphore(maxConcurrentTransfers)

    suspend fun <T> withLimit(block: suspend () -> T): T {
        semaphore.acquire()
        try {
            return block()
        } finally {
            semaphore.release()
        }
    }
}
```

### 6.3 内存优化

```kotlin
class StreamingFileReader(
    private val file: File,
    private val bufferSize: Int = 8192
) {
    /**
     * 流式读取，避免一次性加载整个文件到内存
     */
    fun readChunks(onChunk: (ByteArray) -> Unit) {
        file.inputStream().buffered(bufferSize).use { input ->
            val buffer = ByteArray(bufferSize)
            var bytesRead: Int

            while (input.read(buffer).also { bytesRead = it } != -1) {
                onChunk(buffer.copyOf(bytesRead))
            }
        }
    }
}
```

---

## 7. 测试策略

### 7.1 单元测试

```kotlin
class FileChunkerTest {
    @Test
    fun `test file chunking`() = runTest {
        val file = createTestFile(size = 1.MB)
        val chunker = FileChunker(chunkSize = 64.KB)

        val chunks = chunker.chunkFile(file)

        assertEquals(16, chunks.size)  // 1MB / 64KB = 16
        assertTrue(chunks.all { it.data.size <= 64.KB })
    }

    @Test
    fun `test chunk assembly`() = runTest {
        val originalFile = createTestFile(size = 1.MB)
        val chunker = FileChunker(chunkSize = 64.KB)

        val chunks = chunker.chunkFile(originalFile)
        val outputFile = File.createTempFile("test", ".dat")

        chunker.assembleChunks(chunks, outputFile)

        assertEquals(
            originalFile.readBytes().toList(),
            outputFile.readBytes().toList()
        )
    }
}
```

### 7.2 集成测试

```kotlin
class FileTransferIntegrationTest {
    @Test
    fun `test end-to-end file transfer`() = runTest {
        val sender = createTestP2PNode()
        val receiver = createTestP2PNode()

        val testFile = createTestFile(size = 10.MB)
        val transferManager = FileTransferManager(...)

        // 发送文件
        val transferId = transferManager.sendFile(
            file = testFile,
            recipientId = receiver.id
        ).getOrThrow()

        // 接收文件
        val receivedFile = transferManager.receiveFile(
            transferId = transferId
        ).getOrThrow()

        // 验证文件完整性
        assertEquals(
            testFile.readBytes().toList(),
            receivedFile.readBytes().toList()
        )
    }
}
```

---

## 8. 实施计划

### Phase 1: 基础实现（1周）
- [ ] FileChunker 实现
- [ ] TransferSession 数据模型
- [ ] FileTransferDao 数据库层
- [ ] 基础 UI（列表和详情）

### Phase 2: 传输逻辑（1周）
- [ ] FileTransferManager 实现
- [ ] P2P 传输协议
- [ ] 进度跟踪和回调
- [ ] 错误处理

### Phase 3: 高级功能（0.5周）
- [ ] 断点续传
- [ ] 多文件队列
- [ ] 传输速度优化
- [ ] 内存优化

### Phase 4: UI 完善（0.5周）
- [ ] 文件类型图标
- [ ] 传输动画
- [ ] 文件预览
- [ ] 操作确认对话框

---

## 9. 待解决问题

1. **大文件传输**：如何处理超过 1GB 的文件？
2. **网络切换**：WiFi 和移动数据切换时如何处理？
3. **电池优化**：长时间传输时的电量消耗？
4. **存储空间**：接收文件前如何检查存储空间？

---

**作者：** Android 团队
**更新日期：** 2026-01-23
