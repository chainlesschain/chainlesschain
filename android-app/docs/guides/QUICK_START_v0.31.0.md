# 🚀 v0.31.0 快速开始指南

> **开始日期**: 2026-01-27 (明天)
> **第一个里程碑**: Week 1 - 二维码扫描功能

---

## 📦 准备工作

### 1. 创建开发分支

```bash
cd E:\code\chainlesschain\android-app

# 创建v0.31.0开发分支
git checkout -b feature/v0.31.0

# 推送到远程
git push -u origin feature/v0.31.0
```

### 2. 添加依赖

打开 `app/build.gradle.kts`，在 `dependencies` 块中添加：

```kotlin
dependencies {
    // 现有依赖...

    // ===== v0.31.0 新增依赖 =====

    // 二维码生成
    implementation("com.google.zxing:core:3.5.2")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    // CameraX（二维码扫描）
    implementation("androidx.camera:camera-core:1.3.1")
    implementation("androidx.camera:camera-camera2:1.3.1")
    implementation("androidx.camera:camera-lifecycle:1.3.1")
    implementation("androidx.camera:camera-view:1.3.1")

    // ML Kit条形码扫描
    implementation("com.google.mlkit:barcode-scanning:17.2.0")

    // 权限管理
    implementation("com.google.accompanist:accompanist-permissions:0.32.0")

    // Markdown渲染（富文本编辑器）
    implementation("io.noties.markwon:core:4.6.2")
    implementation("io.noties.markwon:editor:4.6.2")
    implementation("io.noties.markwon:syntax-highlight:4.6.2")
    implementation("io.noties.markwon:image-coil:4.6.2")
}
```

### 3. 同步依赖

```bash
./gradlew sync
```

---

## 🎯 第一个任务: 二维码生成 (Day 1, 上午)

### Step 1: 创建QRCodeGenerator工具类

创建文件: `core-ui/src/main/java/com/chainlesschain/android/core/ui/components/QRCodeGenerator.kt`

```kotlin
package com.chainlesschain.android.core.ui.components

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.net.URLEncoder

object QRCodeGenerator {
    /**
     * 生成二维码图片
     * @param content 二维码内容
     * @param size 二维码尺寸（像素）
     * @param fgColor 前景色
     * @param bgColor 背景色
     * @param logo 中心Logo（可选）
     * @return Bitmap
     */
    fun generateQRCode(
        content: String,
        size: Int = 512,
        fgColor: Int = Color.BLACK,
        bgColor: Int = Color.WHITE,
        logo: Bitmap? = null
    ): Bitmap {
        val hints = hashMapOf<EncodeHintType, Any>()
        hints[EncodeHintType.CHARACTER_SET] = "UTF-8"
        hints[EncodeHintType.ERROR_CORRECTION] = ErrorCorrectionLevel.H // 高纠错级别
        hints[EncodeHintType.MARGIN] = 1 // 边距

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

        // 添加中心Logo（可选）
        logo?.let {
            val logoSize = size / 5
            val scaledLogo = Bitmap.createScaledBitmap(it, logoSize, logoSize, false)
            val canvas = Canvas(bitmap)

            // 白色背景（避免Logo和二维码冲突）
            val paint = android.graphics.Paint().apply {
                color = bgColor
                style = android.graphics.Paint.Style.FILL
            }
            val logoBackgroundSize = logoSize + 20
            canvas.drawRect(
                (size - logoBackgroundSize) / 2f,
                (size - logoBackgroundSize) / 2f,
                (size + logoBackgroundSize) / 2f,
                (size + logoBackgroundSize) / 2f,
                paint
            )

            // 绘制Logo
            canvas.drawBitmap(
                scaledLogo,
                (size - logoSize) / 2f,
                (size - logoSize) / 2f,
                null
            )
        }

        return bitmap
    }

    /**
     * 生成DID二维码（包含签名验证）
     * @param did 用户DID
     * @param signature 签名
     * @return 二维码URL格式
     */
    fun generateDIDQRCode(did: String, signature: String): String {
        return buildString {
            append("chainlesschain://add-friend?")
            append("did=").append(URLEncoder.encode(did, "UTF-8"))
            append("&sig=").append(URLEncoder.encode(signature, "UTF-8"))
            append("&ts=").append(System.currentTimeMillis())
        }
    }

    /**
     * 生成动态分享二维码
     * @param postId 动态ID
     * @return 二维码URL格式
     */
    fun generatePostShareQRCode(postId: String): String {
        return buildString {
            append("chainlesschain://post?")
            append("id=").append(URLEncoder.encode(postId, "UTF-8"))
        }
    }
}
```

### Step 2: 创建测试文件

创建文件: `core-ui/src/androidTest/java/com/chainlesschain/android/core/ui/components/QRCodeGeneratorTest.kt`

```kotlin
package com.chainlesschain.android.core.ui.components

import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class QRCodeGeneratorTest {

    @Test
    fun generateQRCode_withBasicContent_returnsValidBitmap() {
        // Given
        val content = "Hello, World!"

        // When
        val bitmap = QRCodeGenerator.generateQRCode(content, size = 256)

        // Then
        assertNotNull(bitmap)
        assertEquals(256, bitmap.width)
        assertEquals(256, bitmap.height)
    }

    @Test
    fun generateQRCode_withCustomColors_returnsColoredBitmap() {
        // Given
        val content = "Test"
        val fgColor = Color.BLUE
        val bgColor = Color.YELLOW

        // When
        val bitmap = QRCodeGenerator.generateQRCode(content, fgColor = fgColor, bgColor = bgColor)

        // Then
        assertNotNull(bitmap)
        // 验证颜色（采样中心点）
        val centerPixel = bitmap.getPixel(bitmap.width / 2, bitmap.height / 2)
        assertTrue(centerPixel == fgColor || centerPixel == bgColor)
    }

    @Test
    fun generateDIDQRCode_withValidDID_returnsCorrectFormat() {
        // Given
        val did = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
        val signature = "0x1234567890abcdef"

        // When
        val qrCode = QRCodeGenerator.generateDIDQRCode(did, signature)

        // Then
        assertTrue(qrCode.startsWith("chainlesschain://add-friend?"))
        assertTrue(qrCode.contains("did="))
        assertTrue(qrCode.contains("sig="))
        assertTrue(qrCode.contains("ts="))
    }

    @Test
    fun generatePostShareQRCode_withPostId_returnsCorrectFormat() {
        // Given
        val postId = "post_123456"

        // When
        val qrCode = QRCodeGenerator.generatePostShareQRCode(postId)

        // Then
        assertEquals("chainlesschain://post?id=post_123456", qrCode)
    }
}
```

### Step 3: 运行测试

```bash
# 连接Android设备或启动模拟器
adb devices

# 运行测试
./gradlew :core-ui:connectedDebugAndroidTest --tests="QRCodeGeneratorTest"
```

### 预期结果

```
QRCodeGeneratorTest > generateQRCode_withBasicContent_returnsValidBitmap - PASSED
QRCodeGeneratorTest > generateQRCode_withCustomColors_returnsColoredBitmap - PASSED
QRCodeGeneratorTest > generateDIDQRCode_withValidDID_returnsCorrectFormat - PASSED
QRCodeGeneratorTest > generatePostShareQRCode_withPostId_returnsCorrectFormat - PASSED

4 tests passed
```

---

## 🎯 第一个任务: 二维码生成 (Day 1, 下午)

### Step 4: 创建MyQRCodeScreen UI

创建文件: `feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/ui/social/MyQRCodeScreen.kt`

```kotlin
package com.chainlesschain.android.feature.p2p.ui.social

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage

@Composable
fun MyQRCodeScreen(
    onNavigateBack: () -> Unit,
    viewModel: MyQRCodeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.generateQRCode()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("我的二维码") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.saveToGallery() },
                        enabled = uiState.qrCodeBitmap != null
                    ) {
                        Icon(Icons.Default.Download, contentDescription = "保存到相册")
                    }
                    IconButton(
                        onClick = { viewModel.shareQRCode() },
                        enabled = uiState.qrCodeBitmap != null
                    ) {
                        Icon(Icons.Default.Share, contentDescription = "分享")
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentAlignment = Alignment.Center
        ) {
            if (uiState.isLoading) {
                CircularProgressIndicator()
            } else {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(24.dp)
                ) {
                    // 个人头像
                    AsyncImage(
                        model = uiState.avatarUrl,
                        contentDescription = "头像",
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape),
                        contentScale = ContentScale.Crop
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // 昵称
                    Text(
                        text = uiState.nickname,
                        style = MaterialTheme.typography.titleLarge
                    )

                    // DID
                    Text(
                        text = uiState.did,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    // 二维码
                    uiState.qrCodeBitmap?.let { bitmap ->
                        Card(
                            modifier = Modifier.size(280.dp),
                            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
                        ) {
                            Image(
                                bitmap = bitmap.asImageBitmap(),
                                contentDescription = "二维码",
                                modifier = Modifier.fillMaxSize()
                            )
                        }
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
    }

    // 监听事件（Toast等）
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is MyQRCodeEvent.SaveSuccess -> {
                    // 显示Toast（由MainActivity处理）
                }
                is MyQRCodeEvent.SaveError -> {
                    // 显示错误Toast
                }
            }
        }
    }
}
```

### Step 5: 创建ViewModel

创建文件: `feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/viewmodel/social/MyQRCodeViewModel.kt`

```kotlin
package com.chainlesschain.android.feature.p2p.viewmodel.social

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.ui.components.QRCodeGenerator
import com.chainlesschain.android.feature.p2p.repository.did.DIDManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.io.OutputStream
import javax.inject.Inject

@HiltViewModel
class MyQRCodeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val didManager: DIDManager
) : ViewModel() {

    data class MyQRCodeUiState(
        val did: String = "",
        val nickname: String = "",
        val avatarUrl: String? = null,
        val qrCodeBitmap: Bitmap? = null,
        val isLoading: Boolean = false
    )

    private val _uiState = MutableStateFlow(MyQRCodeUiState())
    val uiState: StateFlow<MyQRCodeUiState> = _uiState.asStateFlow()

    private val _events = MutableSharedFlow<MyQRCodeEvent>()
    val events: SharedFlow<MyQRCodeEvent> = _events.asSharedFlow()

    fun generateQRCode() = viewModelScope.launch {
        _uiState.update { it.copy(isLoading = true) }

        try {
            // 获取当前用户信息
            val myDid = didManager.getMyDID()
            val userInfo = didManager.getUserInfo(myDid)

            // 生成签名（用私钥签名当前时间戳）
            val timestamp = System.currentTimeMillis()
            val signature = didManager.signMessage(timestamp.toString())

            // 生成二维码内容
            val qrContent = QRCodeGenerator.generateDIDQRCode(myDid, signature)

            // 生成二维码图片
            val qrBitmap = QRCodeGenerator.generateQRCode(
                content = qrContent,
                size = 512
                // 可选：添加App Logo
                // logo = BitmapFactory.decodeResource(context.resources, R.drawable.app_logo)
            )

            _uiState.update {
                it.copy(
                    did = myDid,
                    nickname = userInfo.nickname,
                    avatarUrl = userInfo.avatarUrl,
                    qrCodeBitmap = qrBitmap,
                    isLoading = false
                )
            }
        } catch (e: Exception) {
            _uiState.update { it.copy(isLoading = false) }
            _events.emit(MyQRCodeEvent.GenerateError(e.message ?: "生成二维码失败"))
        }
    }

    fun saveToGallery() = viewModelScope.launch {
        val bitmap = _uiState.value.qrCodeBitmap ?: return@launch

        try {
            val fileName = "ChainlessChain_QR_${System.currentTimeMillis()}.png"

            val contentValues = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/ChainlessChain")
            }

            val resolver = context.contentResolver
            val imageUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)

            imageUri?.let { uri ->
                val outputStream: OutputStream? = resolver.openOutputStream(uri)
                outputStream?.use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
                _events.emit(MyQRCodeEvent.SaveSuccess(uri.toString()))
            } ?: run {
                _events.emit(MyQRCodeEvent.SaveError("无法保存图片"))
            }
        } catch (e: Exception) {
            _events.emit(MyQRCodeEvent.SaveError(e.message ?: "保存失败"))
        }
    }

    fun shareQRCode() = viewModelScope.launch {
        // TODO: 实现分享功能（将在后续实现）
        _events.emit(MyQRCodeEvent.ShareTriggered)
    }
}

sealed class MyQRCodeEvent {
    data class GenerateError(val message: String) : MyQRCodeEvent()
    data class SaveSuccess(val uri: String) : MyQRCodeEvent()
    data class SaveError(val message: String) : MyQRCodeEvent()
    object ShareTriggered : MyQRCodeEvent()
}
```

### Step 6: 更新导航

打开 `app/src/main/java/com/chainlesschain/android/navigation/NavGraph.kt`，添加路由：

```kotlin
// 在Screen sealed class中添加
object MyQRCode : Screen("my_qrcode", "我的二维码")

// 在NavHost中添加
composable(route = Screen.MyQRCode.route) {
    MyQRCodeScreen(
        onNavigateBack = { navController.popBackStack() }
    )
}
```

### Step 7: 添加入口（在个人中心页面）

打开对应的个人中心页面，添加"我的二维码"入口：

```kotlin
// 示例：在ProfileScreen中添加
ListItem(
    headlineContent = { Text("我的二维码") },
    leadingContent = {
        Icon(Icons.Default.QrCode, contentDescription = null)
    },
    modifier = Modifier.clickable {
        onNavigateToMyQRCode()
    }
)
```

---

## ✅ Day 1 完成标准

- [x] QRCodeGenerator.kt 创建完成，测试通过
- [x] MyQRCodeScreen.kt 创建完成
- [x] MyQRCodeViewModel.kt 创建完成
- [x] 导航路由配置完成
- [x] UI入口添加完成
- [x] 可以在App中打开"我的二维码"页面，看到二维码显示

---

## 📝 提交代码

```bash
git add .
git commit -m "feat(qrcode): implement QR code generation feature

- Add QRCodeGenerator utility class with ZXing
- Create MyQRCodeScreen UI
- Add MyQRCodeViewModel for state management
- Add navigation route for QR code screen
- Add entry point in profile screen
- Add unit tests for QR code generation

Related to: v0.31.0 Week 1 Day 1"

git push origin feature/v0.31.0
```

---

## 🎯 明天的任务 (Day 2)

### 上午: 完成二维码扫描功能
- 添加相机权限
- 创建QRCodeScannerScreen
- 集成CameraX和ML Kit

### 下午: 集成到AddFriendScreen
- 添加扫描按钮
- 实现扫描后跳转逻辑

---

## 📞 需要帮助？

- **技术问题**: 查看 `DEVELOPMENT_PLAN_v0.31.0-v0.32.0.md`
- **任务进度**: 查看 `TASK_BOARD_v0.31.0-v0.32.0.md`
- **代码规范**: 查看 `.chainlesschain/rules.md`

---

**祝开发顺利！🎉**
