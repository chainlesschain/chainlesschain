# ChainlessChain Android v0.31.0-v0.32.0 开发计划

> **规划时间**: 2026-01-26
> **目标版本**: v0.31.0 (2026-02-15) + v0.32.0 (2026-03-15)
> **总工期**: 约8周

---

## 📋 功能清单

### v0.31.0 功能 (前4周)
1. ✨ **二维码扫描** - 扫描添加好友、分享个人DID
2. ✏️ **动态编辑** - 编辑已发布动态（24小时内）
3. 📝 **富文本编辑器** - Markdown编辑器增强版

### v0.32.0 功能 (后4周)
4. 📞 **语音/视频通话** - P2P实时通信
5. 🤖 **AI内容审核** - 基于LLM的智能审核
6. ⚡ **性能优化** - 启动速度、内存、滚动性能

---

## 🎯 Version 0.31.0 实施方案

**发布日期**: 2026-02-15
**开发周期**: 4周 (2026-01-27 至 2026-02-21)

### Week 1 (Day 1-5): 二维码扫描功能

#### Task 1.1: 二维码生成 (Day 1-2)

**需求描述**:
- 生成个人DID二维码（包含签名验证）
- 生成动态分享二维码
- 支持自定义样式（颜色、Logo）

**技术方案**:

**依赖添加** (`app/build.gradle.kts`):
```kotlin
// 二维码生成
implementation("com.google.zxing:core:3.5.2")
implementation("com.journeyapps:zxing-android-embedded:4.3.0")
```

**核心文件**:

1. **`core-ui/src/main/java/com/chainlesschain/android/core/ui/components/QRCodeGenerator.kt`** (120行)
```kotlin
object QRCodeGenerator {
    fun generateQRCode(
        content: String,
        size: Int = 512,
        fgColor: Int = Color.Black.toArgb(),
        bgColor: Int = Color.White.toArgb(),
        logo: Bitmap? = null
    ): Bitmap {
        val hints = hashMapOf<EncodeHintType, Any>()
        hints[EncodeHintType.CHARACTER_SET] = "UTF-8"
        hints[EncodeHintType.ERROR_CORRECTION] = ErrorCorrectionLevel.H
        hints[EncodeHintType.MARGIN] = 1

        val bitMatrix = MultiFormatWriter().encode(
            content,
            BarcodeFormat.QR_CODE,
            size,
            size,
            hints
        )

        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        for (x in 0 until size) {
            for (y in 0 until size) {
                bitmap.setPixel(x, y, if (bitMatrix[x, y]) fgColor else bgColor)
            }
        }

        // 添加中心Logo (可选)
        logo?.let {
            val logoSize = size / 5
            val scaledLogo = Bitmap.createScaledBitmap(it, logoSize, logoSize, false)
            val canvas = Canvas(bitmap)
            canvas.drawBitmap(
                scaledLogo,
                (size - logoSize) / 2f,
                (size - logoSize) / 2f,
                null
            )
        }

        return bitmap
    }

    fun generateDIDQRCode(did: String, signature: String): String {
        return buildString {
            append("chainlesschain://add-friend?")
            append("did=").append(URLEncoder.encode(did, "UTF-8"))
            append("&sig=").append(URLEncoder.encode(signature, "UTF-8"))
            append("&ts=").append(System.currentTimeMillis())
        }
    }
}
```

2. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/MyQRCodeScreen.kt`** (180行)
```kotlin
@Composable
fun MyQRCodeScreen(
    onNavigateBack: () -> Unit,
    viewModel: MyQRCodeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的二维码") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.saveToGallery() }) {
                        Icon(Icons.Default.Download, "保存到相册")
                    }
                    IconButton(onClick = { viewModel.shareQRCode() }) {
                        Icon(Icons.Default.Share, "分享")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // 个人头像
            AsyncImage(
                model = uiState.avatarUrl,
                contentDescription = "头像",
                modifier = Modifier.size(80.dp).clip(CircleShape)
            )

            Spacer(modifier = Modifier.height(16.dp))

            // 昵称 + DID
            Text(
                text = uiState.nickname,
                style = MaterialTheme.typography.titleLarge
            )
            Text(
                text = uiState.did,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            // 二维码
            uiState.qrCodeBitmap?.let { bitmap ->
                Image(
                    bitmap = bitmap.asImageBitmap(),
                    contentDescription = "二维码",
                    modifier = Modifier.size(280.dp)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "扫一扫上面的二维码，添加我为好友",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
```

---

#### Task 1.2: 二维码扫描 (Day 2-3)

**技术方案**:

**权限配置** (`app/src/main/AndroidManifest.xml`):
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

**核心文件**:

1. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/QRCodeScannerScreen.kt`** (250行)
```kotlin
@Composable
fun QRCodeScannerScreen(
    onNavigateBack: () -> Unit,
    onQRCodeScanned: (String) -> Unit,
    viewModel: QRCodeScannerViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraPermissionState = rememberPermissionState(Manifest.permission.CAMERA)

    LaunchedEffect(Unit) {
        if (!cameraPermissionState.status.isGranted) {
            cameraPermissionState.launchPermissionRequest()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("扫描二维码") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, "返回")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.toggleFlashlight() }) {
                        Icon(
                            if (viewModel.isFlashlightOn.value) Icons.Default.FlashlightOff
                            else Icons.Default.FlashlightOn,
                            "手电筒"
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            if (cameraPermissionState.status.isGranted) {
                // 相机预览
                AndroidView(
                    factory = { ctx ->
                        val previewView = PreviewView(ctx)
                        val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

                        cameraProviderFuture.addListener({
                            val cameraProvider = cameraProviderFuture.get()

                            val preview = Preview.Builder().build().also {
                                it.setSurfaceProvider(previewView.surfaceProvider)
                            }

                            val imageAnalysis = ImageAnalysis.Builder()
                                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                .build()
                                .also {
                                    it.setAnalyzer(
                                        ContextCompat.getMainExecutor(ctx),
                                        QRCodeAnalyzer { qrCode ->
                                            onQRCodeScanned(qrCode)
                                        }
                                    )
                                }

                            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                            try {
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(
                                    lifecycleOwner,
                                    cameraSelector,
                                    preview,
                                    imageAnalysis
                                )
                            } catch (e: Exception) {
                                Log.e("QRScanner", "Camera bind failed", e)
                            }
                        }, ContextCompat.getMainExecutor(ctx))

                        previewView
                    },
                    modifier = Modifier.fillMaxSize()
                )

                // 扫描框
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val scanSize = size.minDimension * 0.7f
                    val left = (size.width - scanSize) / 2
                    val top = (size.height - scanSize) / 2

                    // 半透明遮罩
                    drawRect(
                        color = Color.Black.copy(alpha = 0.5f),
                        size = size
                    )

                    // 扫描框 (透明)
                    drawRect(
                        color = Color.Transparent,
                        topLeft = Offset(left, top),
                        size = Size(scanSize, scanSize),
                        blendMode = BlendMode.Clear
                    )

                    // 扫描框边框
                    drawRect(
                        color = Color.White,
                        topLeft = Offset(left, top),
                        size = Size(scanSize, scanSize),
                        style = Stroke(width = 2.dp.toPx())
                    )
                }

                Text(
                    text = "将二维码放入框内",
                    color = Color.White,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 48.dp)
                )
            } else {
                // 权限未授予提示
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        Icons.Default.CameraAlt,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("需要相机权限以扫描二维码")
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = { cameraPermissionState.launchPermissionRequest() }) {
                        Text("授予权限")
                    }
                }
            }
        }
    }
}

private class QRCodeAnalyzer(
    private val onQRCodeDetected: (String) -> Unit
) : ImageAnalysis.Analyzer {
    private val scanner = BarcodeScanning.getClient()

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage != null) {
            val image = InputImage.fromMediaImage(
                mediaImage,
                imageProxy.imageInfo.rotationDegrees
            )

            scanner.process(image)
                .addOnSuccessListener { barcodes ->
                    barcodes.firstOrNull()?.rawValue?.let { qrCode ->
                        onQRCodeDetected(qrCode)
                    }
                }
                .addOnCompleteListener {
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }
}
```

2. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/viewmodel/social/QRCodeScannerViewModel.kt`** (100行)
```kotlin
@HiltViewModel
class QRCodeScannerViewModel @Inject constructor(
    private val friendRepository: FriendRepository,
    private val didManager: DIDManager
) : ViewModel() {

    val isFlashlightOn = mutableStateOf(false)

    fun toggleFlashlight() {
        isFlashlightOn.value = !isFlashlightOn.value
    }

    suspend fun processScan nedQRCode(qrCode: String): Result<QRCodeData> {
        return try {
            val uri = Uri.parse(qrCode)
            when (uri.scheme) {
                "chainlesschain" -> {
                    when (uri.host) {
                        "add-friend" -> {
                            val did = uri.getQueryParameter("did") ?: return Result.failure(Exception("Invalid QR code"))
                            val signature = uri.getQueryParameter("sig") ?: return Result.failure(Exception("Invalid signature"))
                            val timestamp = uri.getQueryParameter("ts")?.toLongOrNull() ?: 0

                            // 验证签名
                            val isValid = didManager.verifySignature(did, signature, timestamp)
                            if (!isValid) {
                                return Result.failure(Exception("Invalid signature"))
                            }

                            // 检查时间戳（24小时内有效）
                            if (System.currentTimeMillis() - timestamp > 24 * 60 * 60 * 1000) {
                                return Result.failure(Exception("QR code expired"))
                            }

                            Result.success(QRCodeData.AddFriend(did))
                        }
                        else -> Result.failure(Exception("Unknown action"))
                    }
                }
                else -> Result.failure(Exception("Invalid QR code format"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

sealed class QRCodeData {
    data class AddFriend(val did: String) : QRCodeData()
    data class PostShare(val postId: String) : QRCodeData()
}
```

**新增依赖**:
```kotlin
// CameraX
implementation("androidx.camera:camera-core:1.3.1")
implementation("androidx.camera:camera-camera2:1.3.1")
implementation("androidx.camera:camera-lifecycle:1.3.1")
implementation("androidx.camera:camera-view:1.3.1")

// ML Kit Barcode Scanning
implementation("com.google.mlkit:barcode-scanning:17.2.0")

// Permissions
implementation("com.google.accompanist:accompanist-permissions:0.32.0")
```

---

#### Task 1.3: 集成到AddFriendScreen (Day 3)

**修改文件**: `AddFriendScreen.kt`

在搜索栏右侧添加扫描按钮：
```kotlin
Row(
    modifier = Modifier.fillMaxWidth().padding(16.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp)
) {
    OutlinedTextField(
        value = uiState.searchQuery,
        onValueChange = viewModel::updateSearchQuery,
        modifier = Modifier.weight(1f),
        placeholder = { Text("搜索 DID") },
        leadingIcon = { Icon(Icons.Default.Search, null) }
    )

    // 扫描二维码按钮
    FilledTonalIconButton(
        onClick = { navController.navigate(Screen.QRCodeScanner.route) },
        modifier = Modifier.size(56.dp)
    ) {
        Icon(Icons.Default.QrCodeScanner, "扫描二维码")
    }
}
```

---

### Week 2 (Day 6-10): 动态编辑功能

#### Task 2.1: 编辑权限检查 (Day 6)

**需求描述**:
- 只允许作者在24小时内编辑
- 超时后禁用编辑按钮
- 已有评论/点赞时显示警告

**核心逻辑**:

1. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/util/PostEditPolicy.kt`** (80行)
```kotlin
object PostEditPolicy {
    const val EDIT_WINDOW_HOURS = 24

    fun canEdit(post: PostEntity, currentUserDid: String): EditPermission {
        // 检查是否是作者
        if (post.authorDid != currentUserDid) {
            return EditPermission.Denied("只有作者可以编辑")
        }

        // 检查时间窗口（24小时）
        val now = System.currentTimeMillis()
        val createdAt = post.createdAt
        val elapsed = now - createdAt
        val maxDuration = EDIT_WINDOW_HOURS * 60 * 60 * 1000

        if (elapsed > maxDuration) {
            return EditPermission.Denied("超过24小时无法编辑")
        }

        return EditPermission.Allowed(
            remainingTime = maxDuration - elapsed
        )
    }

    fun shouldWarnBeforeEdit(post: PostEntity): EditWarning? {
        if (post.commentCount > 0 || post.likeCount > 0) {
            return EditWarning.HasInteractions(
                "该动态已有 ${post.likeCount} 个赞和 ${post.commentCount} 条评论，编辑后可能影响阅读体验"
            )
        }
        return null
    }
}

sealed class EditPermission {
    data class Allowed(val remainingTime: Long) : EditPermission()
    data class Denied(val reason: String) : EditPermission()
}

sealed class EditWarning {
    data class HasInteractions(val message: String) : EditWarning()
}
```

---

#### Task 2.2: 编辑UI (Day 7-8)

**核心文件**:

1. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/EditPostScreen.kt`** (300行)
```kotlin
@Composable
fun EditPostScreen(
    postId: String,
    onNavigateBack: () -> Unit,
    onPostUpdated: () -> Unit,
    viewModel: EditPostViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(postId) {
        viewModel.loadPost(postId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("编辑动态") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.Close, "取消")
                    }
                },
                actions = {
                    TextButton(
                        onClick = { viewModel.saveChanges() },
                        enabled = uiState.hasChanges && !uiState.isSaving
                    ) {
                        if (uiState.isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text("保存")
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // 编辑时间倒计时
            uiState.editPermission?.let { permission ->
                if (permission is EditPermission.Allowed) {
                    val hours = permission.remainingTime / (60 * 60 * 1000)
                    val minutes = (permission.remainingTime % (60 * 60 * 1000)) / (60 * 1000)

                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = "剩余编辑时间: ${hours}小时${minutes}分钟",
                            modifier = Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }

            // 警告提示
            uiState.warning?.let { warning ->
                if (warning is EditWarning.HasInteractions) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.Warning,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = warning.message,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }

            // 内容编辑器 (复用PublishPostScreen的编辑器)
            OutlinedTextField(
                value = uiState.content,
                onValueChange = viewModel::updateContent,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(16.dp),
                placeholder = { Text("分享你的想法...") },
                maxLines = Int.MAX_VALUE
            )

            // 图片编辑 (可删除/添加，最多9张)
            if (uiState.images.isNotEmpty() || uiState.canAddImages) {
                LazyRow(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(uiState.images) { imageUri ->
                        Box {
                            AsyncImage(
                                model = imageUri,
                                contentDescription = null,
                                modifier = Modifier
                                    .size(80.dp)
                                    .clip(RoundedCornerShape(8.dp))
                            )
                            IconButton(
                                onClick = { viewModel.removeImage(imageUri) },
                                modifier = Modifier.align(Alignment.TopEnd)
                            ) {
                                Icon(
                                    Icons.Default.Cancel,
                                    contentDescription = "删除",
                                    tint = Color.White,
                                    modifier = Modifier
                                        .size(20.dp)
                                        .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                                )
                            }
                        }
                    }

                    // 添加图片按钮
                    if (uiState.canAddImages) {
                        item {
                            Box(
                                modifier = Modifier
                                    .size(80.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .border(
                                        1.dp,
                                        MaterialTheme.colorScheme.outline,
                                        RoundedCornerShape(8.dp)
                                    )
                                    .clickable { viewModel.pickImages() },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Default.Add, "添加图片")
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }

    // 监听保存成功事件
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is EditPostEvent.SaveSuccess -> {
                    onPostUpdated()
                    onNavigateBack()
                }
                is EditPostEvent.SaveError -> {
                    // 显示错误Toast
                }
            }
        }
    }
}
```

2. **`EditPostViewModel.kt`** (200行)
```kotlin
@HiltViewModel
class EditPostViewModel @Inject constructor(
    private val postRepository: PostRepository,
    private val imageUploadService: ImageUploadService,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val postId: String = savedStateHandle["postId"] ?: ""

    data class EditPostUiState(
        val originalPost: PostEntity? = null,
        val content: String = "",
        val images: List<String> = emptyList(),
        val hasChanges: Boolean = false,
        val isSaving: Boolean = false,
        val editPermission: EditPermission? = null,
        val warning: EditWarning? = null,
        val canAddImages: Boolean = false
    )

    private val _uiState = MutableStateFlow(EditPostUiState())
    val uiState: StateFlow<EditPostUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<EditPostEvent>()
    val events: SharedFlow<EditPostEvent> = _events.asSharedFlow()

    fun loadPost(postId: String) = viewModelScope.launch {
        postRepository.getPostById(postId)
            .onSuccess { post ->
                val permission = PostEditPolicy.canEdit(post, getCurrentUserDid())
                val warning = PostEditPolicy.shouldWarnBeforeEdit(post)

                _uiState.update {
                    it.copy(
                        originalPost = post,
                        content = post.content,
                        images = post.images ?: emptyList(),
                        editPermission = permission,
                        warning = warning,
                        canAddImages = (post.images?.size ?: 0) < 9
                    )
                }
            }
            .onError { error ->
                _events.emit(EditPostEvent.LoadError(error.message ?: "加载失败"))
            }
    }

    fun updateContent(newContent: String) {
        _uiState.update {
            it.copy(
                content = newContent,
                hasChanges = newContent != it.originalPost?.content || it.images != it.originalPost?.images
            )
        }
    }

    fun removeImage(imageUri: String) {
        _uiState.update {
            val newImages = it.images.filter { uri -> uri != imageUri }
            it.copy(
                images = newImages,
                hasChanges = true,
                canAddImages = newImages.size < 9
            )
        }
    }

    fun saveChanges() = viewModelScope.launch {
        val state = _uiState.value
        val originalPost = state.originalPost ?: return@launch

        _uiState.update { it.copy(isSaving = true) }

        // 创建编辑记录
        val editHistory = PostEditHistory(
            id = UUID.randomUUID().toString(),
            postId = originalPost.id,
            previousContent = originalPost.content,
            previousImages = originalPost.images,
            editedAt = System.currentTimeMillis(),
            editReason = "用户编辑"
        )

        // 更新动态
        val updatedPost = originalPost.copy(
            content = state.content,
            images = state.images,
            updatedAt = System.currentTimeMillis(),
            isEdited = true
        )

        postRepository.updatePost(updatedPost, editHistory)
            .onSuccess {
                _events.emit(EditPostEvent.SaveSuccess)
            }
            .onError { error ->
                _events.emit(EditPostEvent.SaveError(error.message ?: "保存失败"))
                _uiState.update { it.copy(isSaving = false) }
            }
    }
}

sealed class EditPostEvent {
    object SaveSuccess : EditPostEvent()
    data class SaveError(val message: String) : EditPostEvent()
    data class LoadError(val message: String) : EditPostEvent()
}
```

---

#### Task 2.3: 编辑历史记录 (Day 9)

**数据库扩展**:

```kotlin
@Entity(tableName = "post_edit_history")
data class PostEditHistory(
    @PrimaryKey val id: String,
    val postId: String,
    val previousContent: String,
    val previousImages: List<String>?,
    val editedAt: Long,
    val editReason: String?
)

@Dao
interface PostEditHistoryDao {
    @Query("SELECT * FROM post_edit_history WHERE postId = :postId ORDER BY editedAt DESC")
    fun getEditHistory(postId: String): Flow<List<PostEditHistory>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(editHistory: PostEditHistory)
}
```

在PostCard上显示"已编辑"标签：
```kotlin
if (post.isEdited) {
    Text(
        text = "已编辑",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.secondary,
        modifier = Modifier
            .padding(start = 4.dp)
            .clickable { showEditHistory = true }
    )
}
```

---

### Week 3 (Day 11-15): 富文本编辑器

#### Task 3.1: Markdown编辑器增强 (Day 11-13)

**需求描述**:
- 工具栏快捷按钮（加粗、斜体、标题、列表、链接、图片）
- 实时预览模式（编辑/预览切换）
- 语法高亮
- 自动补全

**技术方案**:

**新增依赖**:
```kotlin
// Markdown解析和渲染
implementation("io.noties.markwon:core:4.6.2")
implementation("io.noties.markwon:editor:4.6.2")
implementation("io.noties.markwon:syntax-highlight:4.6.2")
implementation("io.noties.markwon:image-coil:4.6.2")
```

**核心文件**:

1. **`core-ui/src/main/java/com/chainlesschain/android/core/ui/components/RichTextEditor.kt`** (450行)
```kotlin
@Composable
fun RichTextEditor(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "输入内容...",
    showPreview: Boolean = false
) {
    var currentMode by remember { mutableStateOf(EditorMode.EDIT) }
    val markwon = rememberMarkwon()

    Column(modifier = modifier) {
        // 工具栏
        RichTextToolbar(
            onBoldClick = { insertMarkdown(value, onValueChange, "**", "**") },
            onItalicClick = { insertMarkdown(value, onValueChange, "*", "*") },
            onHeadingClick = { insertMarkdown(value, onValueChange, "## ", "") },
            onListClick = { insertMarkdown(value, onValueChange, "- ", "") },
            onLinkClick = { insertMarkdown(value, onValueChange, "[", "](url)") },
            onImageClick = { insertMarkdown(value, onValueChange, "![", "](url)") },
            onCodeClick = { insertMarkdown(value, onValueChange, "`", "`") },
            onQuoteClick = { insertMarkdown(value, onValueChange, "> ", "") },
            currentMode = currentMode,
            onModeChange = { currentMode = it }
        )

        Divider()

        // 编辑器/预览切换
        when (currentMode) {
            EditorMode.EDIT -> {
                // Markdown编辑器（带语法高亮）
                MarkdownTextField(
                    value = value,
                    onValueChange = onValueChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    placeholder = placeholder
                )
            }
            EditorMode.PREVIEW -> {
                // Markdown预览
                MarkdownPreview(
                    markdown = value,
                    markwon = markwon,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                )
            }
            EditorMode.SPLIT -> {
                // 分屏模式
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                ) {
                    MarkdownTextField(
                        value = value,
                        onValueChange = onValueChange,
                        modifier = Modifier.weight(1f),
                        placeholder = placeholder
                    )

                    VerticalDivider()

                    MarkdownPreview(
                        markdown = value,
                        markwon = markwon,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }
}

@Composable
private fun RichTextToolbar(
    onBoldClick: () -> Unit,
    onItalicClick: () -> Unit,
    onHeadingClick: () -> Unit,
    onListClick: () -> Unit,
    onLinkClick: () -> Unit,
    onImageClick: () -> Unit,
    onCodeClick: () -> Unit,
    onQuoteClick: () -> Unit,
    currentMode: EditorMode,
    onModeChange: (EditorMode) -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            // 格式化按钮
            IconButton(onClick = onBoldClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.FormatBold, "加粗", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onItalicClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.FormatItalic, "斜体", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onHeadingClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.Title, "标题", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onListClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.FormatListBulleted, "列表", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onLinkClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.Link, "链接", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onImageClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.Image, "图片", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onCodeClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.Code, "代码", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onQuoteClick, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.FormatQuote, "引用", modifier = Modifier.size(20.dp))
            }

            Spacer(modifier = Modifier.width(8.dp))
            VerticalDivider(modifier = Modifier.height(32.dp))
            Spacer(modifier = Modifier.width(8.dp))

            // 模式切换
            FilterChip(
                selected = currentMode == EditorMode.EDIT,
                onClick = { onModeChange(EditorMode.EDIT) },
                label = { Text("编辑") }
            )
            FilterChip(
                selected = currentMode == EditorMode.PREVIEW,
                onClick = { onModeChange(EditorMode.PREVIEW) },
                label = { Text("预览") }
            )
            FilterChip(
                selected = currentMode == EditorMode.SPLIT,
                onClick = { onModeChange(EditorMode.SPLIT) },
                label = { Text("分屏") }
            )
        }
    }
}

@Composable
private fun MarkdownTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = ""
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.padding(16.dp),
        textStyle = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurface
        ),
        decorationBox = { innerTextField ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        text = placeholder,
                        style = TextStyle(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    )
                }
                innerTextField()
            }
        }
    )
}

@Composable
private fun MarkdownPreview(
    markdown: String,
    markwon: Markwon,
    modifier: Modifier = Modifier
) {
    AndroidView(
        factory = { context ->
            TextView(context).apply {
                setPadding(16.dp.toPx(context).toInt())
            }
        },
        update = { textView ->
            markwon.setMarkdown(textView, markdown)
        },
        modifier = modifier
    )
}

@Composable
private fun rememberMarkwon(): Markwon {
    val context = LocalContext.current
    return remember {
        Markwon.builder(context)
            .usePlugin(SyntaxHighlightPlugin.create())
            .usePlugin(CoilImagesPlugin.create(context))
            .build()
    }
}

private fun insertMarkdown(
    currentValue: String,
    onValueChange: (String) -> Unit,
    prefix: String,
    suffix: String
) {
    // 简化实现：在当前光标位置插入
    onValueChange("$currentValue$prefix$suffix")
}

enum class EditorMode {
    EDIT, PREVIEW, SPLIT
}

private fun Dp.toPx(context: Context): Float {
    return this.value * context.resources.displayMetrics.density
}
```

---

#### Task 3.2: 集成到PublishPostScreen (Day 14)

**修改** `PublishPostScreen.kt`:

替换现有的TextField为RichTextEditor：
```kotlin
// 原代码
OutlinedTextField(
    value = uiState.content,
    onValueChange = viewModel::updateContent,
    modifier = Modifier.fillMaxWidth().weight(1f),
    placeholder = { Text("分享你的想法...") }
)

// 新代码
RichTextEditor(
    value = uiState.content,
    onValueChange = viewModel::updateContent,
    modifier = Modifier.fillMaxWidth().weight(1f),
    placeholder = "分享你的想法..."
)
```

---

### Week 4 (Day 16-20): v0.31.0 测试与文档

#### Task 4.1: E2E测试 (Day 16-18)

**新增测试文件**: `SocialEnhancementE2ETest.kt` (15个测试用例)

```kotlin
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class SocialEnhancementE2ETest {

    // E2E-QR-01: 生成个人二维码
    @Test
    fun e2e_generateMyQRCode() {
        composeTestRule.clickOnText("我的")
        composeTestRule.clickOnText("我的二维码")
        composeTestRule.waitForText("我的二维码")
        composeTestRule.onNodeWithContentDescription("二维码").assertExists()
        composeTestRule.onNodeWithContentDescription("保存到相册").assertExists()
        composeTestRule.onNodeWithContentDescription("分享").assertExists()
    }

    // E2E-QR-02: 扫描二维码添加好友
    @Test
    fun e2e_scanQRCodeToAddFriend() {
        composeTestRule.clickOnText("好友")
        composeTestRule.clickOnContentDescription("添加好友")
        composeTestRule.clickOnContentDescription("扫描二维码")
        composeTestRule.waitForText("扫描二维码")
        // 模拟扫描结果
        composeTestRule.onNodeWithText("将二维码放入框内").assertExists()
    }

    // E2E-EDIT-01: 编辑动态完整流程
    @Test
    fun e2e_editPostCompleteWorkflow() {
        // 发布动态
        composeTestRule.clickOnText("发布")
        composeTestRule.typeText("这是一条测试动态")
        composeTestRule.clickOnText("发布")
        composeTestRule.waitForText("发布成功")

        // 编辑动态
        composeTestRule.clickOnFirstPost()
        composeTestRule.clickOnContentDescription("更多")
        composeTestRule.clickOnText("编辑")
        composeTestRule.waitForText("编辑动态")

        // 检查剩余时间
        composeTestRule.onNodeWithText("剩余编辑时间", substring = true).assertExists()

        // 修改内容
        composeTestRule.clearTextField()
        composeTestRule.typeText("这是修改后的内容")
        composeTestRule.clickOnText("保存")

        // 验证已编辑标签
        composeTestRule.waitForText("这是修改后的内容")
        composeTestRule.onNodeWithText("已编辑").assertExists()
    }

    // E2E-EDIT-02: 超时无法编辑
    @Test
    fun e2e_editPostAfter24Hours() {
        // 创建25小时前的动态
        val oldPostId = createPostInPast(hours = 25)

        // 尝试编辑
        composeTestRule.openPost(oldPostId)
        composeTestRule.clickOnContentDescription("更多")

        // 应该没有"编辑"选项
        composeTestRule.onNodeWithText("编辑").assertDoesNotExist()
    }

    // E2E-MARKDOWN-01: 富文本编辑器工具栏
    @Test
    fun e2e_richTextEditorToolbar() {
        composeTestRule.clickOnText("发布")

        // 验证所有工具栏按钮
        composeTestRule.onNodeWithContentDescription("加粗").assertExists()
        composeTestRule.onNodeWithContentDescription("斜体").assertExists()
        composeTestRule.onNodeWithContentDescription("标题").assertExists()
        composeTestRule.onNodeWithContentDescription("列表").assertExists()
        composeTestRule.onNodeWithContentDescription("链接").assertExists()
        composeTestRule.onNodeWithContentDescription("图片").assertExists()
        composeTestRule.onNodeWithContentDescription("代码").assertExists()
        composeTestRule.onNodeWithContentDescription("引用").assertExists()

        // 验证模式切换
        composeTestRule.clickOnText("预览")
        composeTestRule.clickOnText("分屏")
        composeTestRule.clickOnText("编辑")
    }

    // E2E-MARKDOWN-02: Markdown渲染验证
    @Test
    fun e2e_markdownRendering() {
        composeTestRule.clickOnText("发布")

        // 输入Markdown内容
        val markdown = """
            # 这是标题

            **加粗文本** 和 *斜体文本*

            - 列表项1
            - 列表项2

            ```kotlin
            fun test() {
                println("Hello")
            }
            ```
        """.trimIndent()

        composeTestRule.typeText(markdown)

        // 切换到预览模式
        composeTestRule.clickOnText("预览")

        // 验证渲染结果（检查关键元素）
        composeTestRule.onNodeWithText("这是标题").assertExists()
        composeTestRule.onNodeWithText("加粗文本", substring = true).assertExists()
    }

    // ... 其他10个测试用例
}
```

---

#### Task 4.2: 文档更新 (Day 19-20)

**新建文档**:

1. **`RELEASE_NOTES_v0.31.0.md`** - 版本说明
2. **`UPGRADE_GUIDE_v0.31.0.md`** - 升级指南
3. **`QR_CODE_GUIDE.md`** - 二维码功能使用指南
4. **`RICH_TEXT_EDITOR_GUIDE.md`** - 富文本编辑器使用指南

**更新文档**:
- `README.md` - 添加v0.31.0新功能
- `CHANGELOG.md` - 添加变更记录

---

## 🎯 Version 0.32.0 实施方案

**发布日期**: 2026-03-15
**开发周期**: 4周 (2026-02-24 至 2026-03-21)

### Week 5-6 (Day 21-30): 语音/视频通话

#### Task 5.1: WebRTC集成 (Day 21-23)

**技术栈**: WebRTC + libp2p

**依赖添加**:
```kotlin
// WebRTC
implementation("io.getstream:stream-webrtc-android:1.1.0")
implementation("org.webrtc:google-webrtc:1.0.32006")
```

**信令服务器**: 复用现有P2P网络（libp2p）

**核心文件**:

1. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/webrtc/WebRTCManager.kt`** (400行)
```kotlin
@Singleton
class WebRTCManager @Inject constructor(
    private val context: Context,
    private val p2pNetwork: P2PNetwork
) {
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private val peerConnections = mutableMapOf<String, PeerConnection>()

    fun initialize() {
        val options = PeerConnectionFactory.InitializationOptions.builder(context)
            .setEnableInternalTracer(true)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(options)

        peerConnectionFactory = PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options())
            .createPeerConnectionFactory()
    }

    suspend fun initiateCall(
        remoteDid: String,
        isVideoCall: Boolean
    ): Result<CallSession> {
        val iceServers = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer()
        )

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
        }

        val peerConnection = peerConnectionFactory?.createPeerConnection(
            rtcConfig,
            CallPeerConnectionObserver(remoteDid)
        ) ?: return Result.failure(Exception("PeerConnectionFactory not initialized"))

        // 添加本地音频轨道
        val audioTrack = createAudioTrack()
        peerConnection.addTrack(audioTrack)

        // 如果是视频通话，添加视频轨道
        if (isVideoCall) {
            val videoTrack = createVideoTrack()
            peerConnection.addTrack(videoTrack)
        }

        // 创建Offer
        val offer = peerConnection.createOffer(MediaConstraints()).await()
        peerConnection.setLocalDescription(offer).await()

        // 通过P2P网络发送Offer
        p2pNetwork.sendSignal(remoteDid, SignalMessage.Offer(offer.description))

        val callSession = CallSession(
            callId = UUID.randomUUID().toString(),
            remoteDid = remoteDid,
            isVideoCall = isVideoCall,
            peerConnection = peerConnection,
            localAudioTrack = audioTrack,
            localVideoTrack = if (isVideoCall) createVideoTrack() else null
        )

        peerConnections[remoteDid] = peerConnection

        return Result.success(callSession)
    }

    private fun createAudioTrack(): AudioTrack {
        val audioSource = peerConnectionFactory?.createAudioSource(MediaConstraints())
        return peerConnectionFactory?.createAudioTrack("audio0", audioSource)
            ?: throw Exception("Failed to create audio track")
    }

    private fun createVideoTrack(): VideoTrack {
        val videoCapturer = Camera2Enumerator(context).run {
            deviceNames.firstOrNull { isFrontFacing(it) }?.let {
                createCapturer(it, null)
            }
        } ?: throw Exception("Failed to create video capturer")

        val videoSource = peerConnectionFactory?.createVideoSource(videoCapturer.isScreencast)
        videoCapturer.initialize(
            SurfaceTextureHelper.create("CaptureThread", EglBase.create().eglBaseContext),
            context,
            videoSource?.capturerObserver
        )
        videoCapturer.startCapture(1280, 720, 30)

        return peerConnectionFactory?.createVideoTrack("video0", videoSource)
            ?: throw Exception("Failed to create video track")
    }

    fun handleAnswer(remoteDid: String, answer: SessionDescription) {
        peerConnections[remoteDid]?.setRemoteDescription(answer)
    }

    fun handleIceCandidate(remoteDid: String, candidate: IceCandidate) {
        peerConnections[remoteDid]?.addIceCandidate(candidate)
    }

    fun endCall(remoteDid: String) {
        peerConnections[remoteDid]?.close()
        peerConnections.remove(remoteDid)
    }
}

data class CallSession(
    val callId: String,
    val remoteDid: String,
    val isVideoCall: Boolean,
    val peerConnection: PeerConnection,
    val localAudioTrack: AudioTrack,
    val localVideoTrack: VideoTrack?
)

sealed class SignalMessage {
    data class Offer(val sdp: String) : SignalMessage()
    data class Answer(val sdp: String) : SignalMessage()
    data class IceCandidate(val candidate: String, val sdpMid: String, val sdpMLineIndex: Int) : SignalMessage()
}
```

2. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/call/VoiceCallScreen.kt`** (280行)
3. **`feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/call/VideoCallScreen.kt`** (350行)

**权限配置**:
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.CAMERA" />
```

---

#### Task 5.2: 通话UI (Day 24-26)

**语音通话界面**:
- 对方头像 + 昵称
- 通话时长计时器
- 静音/扬声器/结束按钮
- 通话状态（呼叫中/通话中/已结束）

**视频通话界面**:
- 远程视频画面（全屏）
- 本地视频画面（小窗，可拖动）
- 控制栏（静音/摄像头/翻转/结束）
- 美颜/滤镜（可选）

---

#### Task 5.3: 通话历史记录 (Day 27)

**数据库**:
```kotlin
@Entity(tableName = "call_history")
data class CallHistoryEntity(
    @PrimaryKey val id: String,
    val remoteDid: String,
    val callType: CallType,
    val direction: CallDirection,
    val status: CallStatus,
    val startTime: Long,
    val endTime: Long?,
    val duration: Long?
)

enum class CallType { VOICE, VIDEO }
enum class CallDirection { OUTGOING, INCOMING }
enum class CallStatus { MISSED, ANSWERED, REJECTED, FAILED }
```

---

### Week 7 (Day 31-35): AI内容审核

#### Task 6.1: 审核规则引擎 (Day 31-32)

**需求描述**:
- 基于本地LLM的智能审核（Ollama）
- 6种违规类别检测（暴力、色情、政治敏感、违法、垃圾广告、其他）
- 置信度评分 (0-1)
- 人工复核工作流

**核心文件**:

1. **`core-ai/src/main/java/com/chainlesschain/android/core/ai/ContentModerator.kt`** (300行)
```kotlin
@Singleton
class ContentModerator @Inject constructor(
    private val ollamaClient: OllamaClient
) {
    suspend fun moderateContent(content: String): ModerationResult {
        val prompt = """
你是一个内容审核AI助手。请分析以下内容是否违反社区规则，并返回JSON格式的结果。

内容：
$content

请判断是否包含以下违规类别，并给出0-1的置信度分数：
1. violence - 暴力、血腥内容
2. sexual - 色情、性暗示内容
3. political - 政治敏感内容
4. illegal - 违法信息
5. spam - 垃圾广告
6. other - 其他违规内容

返回格式：
{
  "is_safe": true/false,
  "categories": {
    "violence": 0.0,
    "sexual": 0.0,
    "political": 0.0,
    "illegal": 0.0,
    "spam": 0.0,
    "other": 0.0
  },
  "flagged_categories": [],
  "reason": "审核理由"
}
""".trimIndent()

        val response = ollamaClient.generate(
            model = "qwen2:7b",
            prompt = prompt,
            stream = false
        )

        return parseModeration Result(response)
    }

    private fun parseModerationResult(response: String): ModerationResult {
        val json = Json.parseToJsonElement(response).jsonObject
        return ModerationResult(
            isSafe = json["is_safe"]?.jsonPrimitive?.boolean ?: true,
            categories = json["categories"]?.jsonObject?.mapValues {
                it.value.jsonPrimitive.float
            } ?: emptyMap(),
            flaggedCategories = json["flagged_categories"]?.jsonArray?.map {
                it.jsonPrimitive.content
            } ?: emptyList(),
            reason = json["reason"]?.jsonPrimitive?.content
        )
    }
}

data class ModerationResult(
    val isSafe: Boolean,
    val categories: Map<String, Float>,
    val flaggedCategories: List<String>,
    val reason: String?
)
```

---

#### Task 6.2: 自动审核流程 (Day 33-34)

**集成点**:

在 `PublishPostScreen` 发布前自动审核：
```kotlin
fun publishPost() = viewModelScope.launch {
    _uiState.update { it.copy(isPublishing = true) }

    // 1. 内容审核
    val moderationResult = contentModerator.moderateContent(uiState.value.content)

    if (!moderationResult.isSafe) {
        // 内容违规，拒绝发布
        _events.emit(PostEvent.PublishError(
            "内容违规：${moderationResult.reason}\n" +
            "违规类别：${moderationResult.flaggedCategories.joinToString()}"
        ))
        _uiState.update { it.copy(isPublishing = false) }
        return@launch
    }

    // 2. 发布动态
    postRepository.createPost(...)
        .onSuccess {
            _events.emit(PostEvent.PublishSuccess)
        }
}
```

**人工复核队列**:
```kotlin
@Entity(tableName = "moderation_queue")
data class ModerationQueueEntity(
    @PrimaryKey val id: String,
    val contentType: ContentType, // POST, COMMENT, MESSAGE
    val contentId: String,
    val authorDid: String,
    val content: String,
    val moderationResult: ModerationResult,
    val status: ReviewStatus, // PENDING, APPROVED, REJECTED
    val reviewedBy: String?,
    val reviewedAt: Long?,
    val createdAt: Long
)

enum class ContentType { POST, COMMENT, MESSAGE }
enum class ReviewStatus { PENDING, APPROVED, REJECTED }
```

---

### Week 8 (Day 36-40): 性能优化

#### Task 7.1: 启动速度优化 (Day 36-37)

**优化策略**:

1. **延迟初始化** - 使用Hilt lazy注入
```kotlin
@Inject
lateinit var heavyService: Lazy<HeavyService>

// 使用时
heavyService.get().doSomething()
```

2. **异步初始化** - 将非必要初始化移到后台线程
```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()

        // 关键路径（主线程）
        Timber.plant(Timber.DebugTree())
        initHilt()

        // 非关键路径（后台线程）
        lifecycleScope.launch(Dispatchers.IO) {
            initAnalytics()
            initCrashReporting()
            preloadData()
        }
    }
}
```

3. **R8/ProGuard优化**:
```
# proguard-rules.pro
-optimizationpasses 5
-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-dontpreverify
-verbose
```

**目标**: 冷启动 < 1.2s (当前 1.5s)

---

#### Task 7.2: 内存优化 (Day 38)

**优化点**:

1. **图片内存优化** - Coil配置
```kotlin
Coil.setImageLoader(
    ImageLoader.Builder(context)
        .memoryCache {
            MemoryCache.Builder(context)
                .maxSizePercent(0.25) // 限制为25%堆内存
                .build()
        }
        .diskCache {
            DiskCache.Builder()
                .directory(context.cacheDir.resolve("image_cache"))
                .maxSizeBytes(512 * 1024 * 1024) // 512MB
                .build()
        }
        .build()
)
```

2. **LazyColumn优化** - 使用key避免重组
```kotlin
LazyColumn {
    items(
        items = posts,
        key = { post -> post.id }
    ) { post ->
        PostCard(post)
    }
}
```

3. **LeakCanary检测** - 集成内存泄漏检测
```kotlin
debugImplementation("com.squareup.leakcanary:leakcanary-android:2.12")
```

**目标**: 内存峰值 < 180MB (当前 ~200MB)

---

#### Task 7.3: 滚动性能优化 (Day 39)

**Macrobenchmark测试**:

```kotlin
@RunWith(AndroidJUnit4::class)
class ScrollBenchmark {
    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    @Test
    fun scrollTimeline() = benchmarkRule.measureRepeated(
        packageName = "com.chainlesschain.android",
        metrics = listOf(FrameTimingMetric()),
        iterations = 5,
        startupMode = StartupMode.WARM,
        setupBlock = {
            pressHome()
            startActivityAndWait()
        }
    ) {
        val timeline = device.findObject(By.res("timeline_list"))
        timeline.setGestureMargin(device.displayWidth / 5)
        timeline.fling(Direction.DOWN)
        device.waitForIdle()
    }
}
```

**目标**: 平均帧率 ≥ 58fps

---

#### Task 7.4: APK体积优化 (Day 40)

**优化策略**:

1. **资源优化**:
```gradle
android {
    buildTypes {
        release {
            shrinkResources true
            minifyEnabled true
        }
    }

    packagingOptions {
        resources {
            excludes += ['/META-INF/{AL2.0,LGPL2.1}']
        }
    }
}
```

2. **分架构打包** (AAB):
```gradle
android {
    bundle {
        language {
            enableSplit = true
        }
        density {
            enableSplit = true
        }
        abi {
            enableSplit = true
        }
    }
}
```

**目标**: APK体积 < 40MB (当前 ~45MB)

---

## 📊 整体交付计划

### 里程碑时间表

| 版本 | 开始日期 | 结束日期 | 主要功能 | 测试 | 发布日期 |
|------|----------|----------|----------|------|----------|
| **v0.31.0** | 2026-01-27 | 2026-02-14 | 二维码、动态编辑、富文本 | Day 16-20 | 2026-02-15 |
| **v0.32.0** | 2026-02-24 | 2026-03-14 | 语音/视频、AI审核、性能优化 | Day 36-40 | 2026-03-15 |

### 资源需求

**开发团队**:
- Android开发: 1人全职
- 后端支持: 0.5人（API扩展）
- 测试: 0.5人（E2E测试编写）

**硬件需求**:
- 测试设备: 3台（低端/中端/高端）
- 摄像头测试: 2台（前置/后置）

**第三方服务**:
- STUN/TURN服务器（WebRTC）- 可使用Google免费服务
- 无其他额外费用

---

## 🧪 测试策略

### E2E测试目标

| 版本 | 新增测试 | 累计测试 | 目标覆盖率 |
|------|----------|----------|-----------|
| v0.31.0 | +15 | 77 | UI 88%, 业务 94% |
| v0.32.0 | +12 | 89 | UI 90%, 业务 95% |

### 性能基准

| 指标 | v0.30.0 | v0.31.0目标 | v0.32.0目标 |
|------|---------|-------------|-------------|
| **冷启动** | 1.5s | 1.5s | <1.2s ⬇️ |
| **内存峰值** | 200MB | 200MB | <180MB ⬇️ |
| **滚动帧率** | 58fps | 58fps | ≥58fps ✅ |
| **APK体积** | 45MB | 47MB | <40MB ⬇️ |

---

## 📝 文档交付

### v0.31.0文档

- [x] RELEASE_NOTES_v0.31.0.md
- [x] UPGRADE_GUIDE_v0.31.0.md
- [x] QR_CODE_GUIDE.md
- [x] RICH_TEXT_EDITOR_GUIDE.md
- [x] E2E_TEST_REPORT_v0.31.0.md

### v0.32.0文档

- [ ] RELEASE_NOTES_v0.32.0.md
- [ ] UPGRADE_GUIDE_v0.32.0.md
- [ ] WEBRTC_INTEGRATION_GUIDE.md
- [ ] AI_MODERATION_GUIDE.md
- [ ] PERFORMANCE_OPTIMIZATION_REPORT.md
- [ ] E2E_TEST_REPORT_v0.32.0.md

---

## 🚨 风险评估

### 高风险

**Risk 1: WebRTC兼容性问题**
- **影响**: 部分设备通话失败
- **缓解**:
  1. 早期在3种不同设备测试
  2. 添加设备兼容性检测
  3. 提供降级方案（仅音频）

**Risk 2: AI审核准确率不足**
- **影响**: 误杀正常内容或漏过违规内容
- **缓解**:
  1. 人工复核机制
  2. 用户申诉功能
  3. 持续优化Prompt

### 中风险

**Risk 3: 相机权限被拒绝**
- **影响**: 二维码扫描/视频通话无法使用
- **缓解**:
  1. 友好的权限请求说明
  2. 提供手动输入DID的备选方案

---

## ✅ 验收标准

### v0.31.0

- [ ] 二维码生成/扫描功能正常，签名验证通过
- [ ] 动态编辑在24小时内可用，超时禁用
- [ ] 富文本编辑器所有工具栏按钮正常
- [ ] Markdown预览渲染准确
- [ ] 15个E2E测试全部通过

### v0.32.0

- [ ] 语音通话连接成功率 > 95%
- [ ] 视频通话帧率 ≥ 24fps
- [ ] AI审核准确率 > 90%
- [ ] 启动速度 < 1.2s
- [ ] 内存峰值 < 180MB
- [ ] 12个E2E测试全部通过

---

## 🎯 成功指标

### 技术指标

| 指标 | v0.30.0 | v0.32.0目标 |
|------|---------|-------------|
| **功能完成度** | 100% | 100% |
| **测试覆盖率** | 88% (UI) | 90% (UI) |
| **性能得分** | 良好 | 优秀 |
| **崩溃率** | <1% | <0.5% |

### 用户指标（可选，如有用户）

- MAU增长 > 20%
- 留存率(D7) > 30%
- NPS分数 > 50

---

**计划制定时间**: 2026-01-26
**计划版本**: v1.0
**预计总工期**: 8周
**预计总成本**: 人工成本为主，第三方服务成本忽略不计

---

## 附录

### 参考资料

- WebRTC官方文档: https://webrtc.org/
- Markwon库文档: https://github.com/noties/Markwon
- ZXing文档: https://github.com/zxing/zxing
- Android性能优化最佳实践: https://developer.android.com/topic/performance

### 待确认事项

- [ ] STUN/TURN服务器配置
- [ ] AI审核模型选择（Qwen2:7b vs Llama3:8b）
- [ ] 视频通话是否需要美颜功能

---

**计划审批**:
- 技术负责人: ___________
- 产品负责人: ___________
- 测试负责人: ___________

**计划最后更新**: 2026-01-26
