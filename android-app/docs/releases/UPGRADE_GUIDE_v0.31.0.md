# ChainlessChain Android v0.31.0 升级指南

本文档提供从v0.30.0升级到v0.31.0的完整指南，包括数据库迁移、API变更、配置调整等内容。

---

## 📋 升级前检查清单

在开始升级前，请确认以下事项：

- [ ] **备份数据**: 导出重要动态、好友列表、聊天记录
- [ ] **检查版本**: 当前版本必须是v0.30.0或更高
- [ ] **查看依赖**: 确认项目使用的第三方库没有冲突
- [ ] **阅读Release Notes**: 了解新功能和不兼容变更
- [ ] **测试环境验证**: 在测试环境先升级验证

---

## 🚀 快速升级步骤

### 方式一：直接升级（推荐用户）

1. **下载新版本APK**

   ```bash
   wget https://github.com/chainlesschain/chainlesschain/releases/download/v0.31.0/chainlesschain-v0.31.0.apk
   ```

2. **安装APK**
   - 首次安装会自动执行数据库迁移
   - 迁移过程约需10-30秒（取决于数据量）
   - **⚠️ 迁移期间请勿关闭应用**

3. **验证升级**
   - 打开应用，检查版本号：设置 → 关于 → 版本v0.31.0
   - 测试新功能：二维码名片、动态编辑、Markdown编辑器

### 方式二：Gradle构建升级（开发者）

1. **更新版本号**

   编辑 `app/build.gradle.kts`:

   ```kotlin
   android {
       defaultConfig {
           versionCode = 31
           versionName = "0.31.0"
       }
   }
   ```

2. **同步依赖**

   ```bash
   cd android-app
   ./gradlew clean
   ./gradlew build
   ```

3. **运行应用**
   ```bash
   ./gradlew installDebug
   ```

---

## 🗄️ 数据库迁移详情

### 迁移版本: v15 → v16

**自动执行**: 应用启动时会检测数据库版本，自动执行迁移。

**迁移SQL语句**:

```sql
-- 1. 创建动态编辑历史表
CREATE TABLE IF NOT EXISTS post_edit_history (
    id TEXT PRIMARY KEY NOT NULL,
    post_id TEXT NOT NULL,
    content TEXT NOT NULL,
    edited_at INTEGER NOT NULL,
    editor_did TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 2. 创建索引（优化查询性能）
CREATE INDEX IF NOT EXISTS idx_post_edit_history_post_id
    ON post_edit_history(post_id);
CREATE INDEX IF NOT EXISTS idx_post_edit_history_edited_at
    ON post_edit_history(post_id, edited_at DESC);

-- 3. 为posts表添加编辑相关字段
ALTER TABLE posts ADD COLUMN edited_at INTEGER DEFAULT NULL;
ALTER TABLE posts ADD COLUMN edit_count INTEGER DEFAULT 0;
```

**预计迁移时间**:
| 动态数量 | 迁移时间 |
|---------|---------|
| < 1000 | 5秒 |
| 1000-5000 | 15秒 |
| 5000-10000 | 30秒 |
| > 10000 | 60秒+ |

**回滚方案**:
如果升级后遇到问题，可以回退到v0.30.0：

```sql
-- 删除新表
DROP TABLE IF EXISTS post_edit_history;

-- 移除新字段（SQLite不支持DROP COLUMN，需要重建表）
-- 方法：卸载应用，重新安装v0.30.0，数据将丢失
```

⚠️ **注意**: SQLite不支持删除列，回滚会导致数据丢失，建议升级前备份。

---

## 🔧 API变更

### 不兼容变更（Breaking Changes）

#### 1. PostRepository API变更

**旧版本 (v0.30.0)**:

```kotlin
interface PostRepository {
    suspend fun updatePost(postId: String, newContent: String): Result<Unit>
}
```

**新版本 (v0.31.0)**:

```kotlin
interface PostRepository {
    // 方法重命名，增加editedAt参数
    suspend fun updatePostContent(
        postId: String,
        newContent: String,
        editedAt: Long
    ): Result<Unit>

    // 新增：获取编辑历史
    fun getPostEditHistory(postId: String): Flow<List<PostEditHistoryEntity>>
}
```

**迁移代码**:

```kotlin
// ❌ 旧代码
postRepository.updatePost(postId, "新内容")

// ✅ 新代码
postRepository.updatePostContent(
    postId,
    "新内容",
    editedAt = System.currentTimeMillis()
)
```

#### 2. PostEntity字段变更

**新增字段**:

```kotlin
data class PostEntity(
    // ... 原有字段 ...

    // 新增：编辑时间戳
    val editedAt: Long? = null,

    // 新增：编辑次数
    val editCount: Int = 0
)
```

**影响**: 如果你的代码直接构造`PostEntity`，需要更新构造调用。

---

### 新增API

#### 1. QRCodeManager（二维码管理）

```kotlin
class QRCodeManager {
    /**
     * 生成个人二维码
     * @param did 用户DID
     * @param size 二维码尺寸（默认512px）
     * @return 二维码Bitmap
     */
    fun generatePersonalQRCode(did: String, size: Int = 512): Bitmap

    /**
     * 保存二维码到相册
     * @param bitmap 二维码图片
     * @param displayName 文件名（默认：chainlesschain_qrcode_[timestamp].png）
     */
    suspend fun saveQRCodeToGallery(
        bitmap: Bitmap,
        displayName: String? = null
    ): Result<Uri>
}
```

**使用示例**:

```kotlin
val qrCodeManager = QRCodeManager(context)

// 生成二维码
val qrBitmap = qrCodeManager.generatePersonalQRCode(
    did = "did:chainlesschain:user:12345"
)

// 保存到相册
viewModelScope.launch {
    qrCodeManager.saveQRCodeToGallery(qrBitmap).onSuccess { uri ->
        showToast("二维码已保存：$uri")
    }
}
```

#### 2. QRCodeScanner（二维码扫描）

```kotlin
class QRCodeScanner(private val lifecycleOwner: LifecycleOwner) {
    /**
     * 扫描二维码（返回Flow持续监听）
     * @return Flow<Result<String>> 扫描到的DID
     */
    fun scanQRCode(): Flow<Result<String>>

    /**
     * 停止扫描
     */
    fun stopScanning()
}
```

**使用示例**:

```kotlin
val scanner = QRCodeScanner(lifecycleOwner = this)

scanner.scanQRCode().collectLatest { result ->
    result.onSuccess { did ->
        println("扫描到DID: $did")
        navigateToAddFriend(did)
    }.onError { error ->
        showToast("扫描失败：${error.message}")
    }
}
```

#### 3. PostEditPolicy（编辑权限策略）

```kotlin
class PostEditPolicy {
    /**
     * 检查编辑权限
     * @return EditPermission 权限结果
     */
    fun checkEditPermission(
        createdAt: Long,
        hasLikes: Boolean = false,
        hasComments: Boolean = false,
        hasShares: Boolean = false
    ): EditPermission

    /**
     * 获取编辑警告信息
     */
    fun getEditWarnings(
        likeCount: Int,
        commentCount: Int,
        shareCount: Int
    ): List<EditWarning>
}

data class EditPermission(
    val canEdit: Boolean,
    val reason: String?,
    val remainingTime: Long?
)

sealed class EditWarning {
    data class HasLikes(val count: Int) : EditWarning()
    data class HasComments(val count: Int) : EditWarning()
    data class HasShares(val count: Int) : EditWarning()
}
```

**使用示例**:

```kotlin
val policy = PostEditPolicy()

val permission = policy.checkEditPermission(
    createdAt = post.createdAt,
    hasLikes = post.likeCount > 0,
    hasComments = post.commentCount > 0,
    hasShares = post.shareCount > 0
)

if (permission.canEdit) {
    // 允许编辑
    navigateToEditScreen(post.id)
} else {
    // 显示拒绝原因
    showToast(permission.reason ?: "无法编辑")
}
```

#### 4. RichTextEditor（Markdown编辑器）

```kotlin
@Composable
fun RichTextEditor(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "输入Markdown文本...",
    initialMode: EditorMode = EditorMode.EDIT
)

enum class EditorMode {
    EDIT,      // 编辑模式
    PREVIEW,   // 预览模式
    SPLIT      // 分屏模式
}
```

**使用示例**:

```kotlin
@Composable
fun MyScreen() {
    var content by remember { mutableStateOf("") }

    RichTextEditor(
        value = content,
        onValueChange = { content = it },
        modifier = Modifier
            .fillMaxWidth()
            .height(400.dp),
        placeholder = "输入你的想法...",
        initialMode = EditorMode.SPLIT
    )
}
```

---

## 📦 依赖更新

### 新增依赖

在 `app/build.gradle.kts` 或 `feature-p2p/build.gradle.kts` 中添加：

```kotlin
dependencies {
    // Markwon Markdown库
    val markwonVersion = "4.6.2"
    implementation("io.noties.markwon:core:$markwonVersion")
    implementation("io.noties.markwon:editor:$markwonVersion")
    implementation("io.noties.markwon:syntax-highlight:$markwonVersion")
    implementation("io.noties.markwon:image-coil:$markwonVersion")
    implementation("io.noties.markwon:ext-strikethrough:$markwonVersion")
    implementation("io.noties.markwon:ext-tables:$markwonVersion")
    implementation("io.noties.markwon:linkify:$markwonVersion")

    // Prism4j 语法高亮
    implementation("io.noties:prism4j:2.0.0")
    kapt("io.noties:prism4j-bundler:2.0.0")

    // ZXing（如果之前没有）
    implementation("com.google.zxing:core:3.5.3")
}
```

### kapt插件（必需）

在模块的 `build.gradle.kts` 头部添加：

```kotlin
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")  // 新增
}
```

---

## ⚙️ 配置变更

### 新增配置项

在 `core-ui/src/main/res/values/config.xml` 中可选配置：

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- 二维码尺寸（像素） -->
    <integer name="qr_code_size">512</integer>

    <!-- 二维码纠错级别 (L=7%, M=15%, Q=25%, H=30%) -->
    <string name="qr_code_error_correction">H</string>

    <!-- 动态编辑窗口（小时） -->
    <integer name="post_edit_window_hours">24</integer>

    <!-- 是否启用Markdown预览 -->
    <bool name="enable_markdown_preview">true</bool>

    <!-- Markdown编辑器默认高度（dp） -->
    <integer name="markdown_editor_default_height">300</integer>
</resources>
```

### 权限变更

**AndroidManifest.xml** 中新增权限（如果使用二维码扫描）：

```xml
<!-- 相机权限（扫描二维码） -->
<uses-permission android:name="android.permission.CAMERA" />

<!-- 存储权限（保存二维码到相册） -->
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />

<!-- Android 13+ 图片权限 -->
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
```

---

## 🧪 测试升级

### 单元测试

如果你有自定义的单元测试，确保更新：

```kotlin
// 旧测试
@Test
fun testUpdatePost() = runTest {
    postRepository.updatePost("post_123", "新内容")
    // ...
}

// 新测试
@Test
fun testUpdatePostContent() = runTest {
    postRepository.updatePostContent(
        "post_123",
        "新内容",
        editedAt = System.currentTimeMillis()
    )
    // ...
}
```

### 集成测试

运行完整的测试套件验证升级：

```bash
# 运行所有测试
./gradlew test

# 运行E2E测试
./gradlew connectedAndroidTest

# 运行特定模块测试
./gradlew :feature-p2p:testDebugUnitTest
```

---

## 🔍 常见问题

### Q1: 升级后"编辑"按钮消失了？

**A**: 检查动态是否超过24小时。v0.31.0新增了24小时编辑窗口限制，超时后会自动隐藏编辑按钮。

**解决方案**: 如果需要修改超时动态，只能删除重新发布。

---

### Q2: 数据库迁移失败怎么办？

**A**: 迁移失败通常是因为数据冲突或磁盘空间不足。

**解决方案**:

1. 确认磁盘有至少500MB可用空间
2. 卸载应用，清除数据，重新安装
3. 如果有备份，尝试恢复备份

**查看日志**:

```bash
adb logcat | grep "DatabaseMigration"
```

---

### Q3: Markdown编辑器不显示语法高亮？

**A**: 可能是Prism4j注解处理器未正确配置。

**解决方案**:

1. 确认已添加kapt插件
2. 清理并重新构建：
   ```bash
   ./gradlew clean
   ./gradlew kaptDebugKotlin
   ./gradlew build
   ```

---

### Q4: 二维码扫描相机黑屏？

**A**: 相机权限未授予。

**解决方案**:

1. 检查AndroidManifest.xml中是否声明CAMERA权限
2. 在应用设置中手动授予相机权限
3. 重启应用

---

### Q5: 升级后应用崩溃？

**A**: 可能是依赖冲突或缓存问题。

**解决方案**:

```bash
# 1. 清理Gradle缓存
./gradlew cleanBuildCache

# 2. 删除.gradle目录
rm -rf .gradle

# 3. 重新同步依赖
./gradlew --refresh-dependencies

# 4. 重新构建
./gradlew clean build
```

---

## 📊 性能优化建议

### 1. 二维码缓存

如果频繁生成二维码，建议使用缓存：

```kotlin
class CachedQRCodeManager(private val qrCodeManager: QRCodeManager) {
    private val cache = LruCache<String, Bitmap>(10)

    fun getQRCode(did: String): Bitmap {
        return cache.get(did) ?: run {
            val bitmap = qrCodeManager.generatePersonalQRCode(did)
            cache.put(did, bitmap)
            bitmap
        }
    }
}
```

### 2. Markdown渲染优化

对于长文档，使用分页加载：

```kotlin
@Composable
fun LazyMarkdownPreview(markdown: String) {
    val chunks = markdown.chunked(1000) // 每1000字符一块

    LazyColumn {
        items(chunks) { chunk ->
            MarkdownPreview(markdown = chunk)
        }
    }
}
```

### 3. 数据库查询优化

使用编辑历史时，限制查询数量：

```kotlin
// ❌ 不推荐：加载全部历史
postRepository.getPostEditHistory(postId)

// ✅ 推荐：只加载最近10条
postRepository.getPostEditHistory(postId)
    .map { it.take(10) }
```

---

## 🚨 已知问题

### 1. Markdown表格在窄屏上显示不全

**影响**: 宽表格在手机竖屏时需要横向滚动
**计划修复**: v0.31.1
**临时解决**: 使用更少列或横屏查看

### 2. 二维码在某些Android 6设备上生成慢

**影响**: Android 6.0设备生成二维码耗时>200ms
**计划修复**: v0.31.1
**临时解决**: 使用后台线程生成

---

## 📞 获取帮助

如果升级过程中遇到问题：

1. **查看文档**: [完整文档](https://docs.chainlesschain.com)
2. **搜索Issue**: [GitHub Issues](https://github.com/chainlesschain/chainlesschain/issues)
3. **提交Bug**: [新建Issue](https://github.com/chainlesschain/chainlesschain/issues/new)
4. **社区讨论**: [Discord社区](https://discord.gg/chainlesschain)
5. **联系邮箱**: support@chainlesschain.com

---

## 📝 升级后验证清单

升级完成后，请验证以下功能：

- [ ] 应用正常启动，无崩溃
- [ ] 版本号显示为v0.31.0
- [ ] 原有动态正常显示
- [ ] 可以发布新动态
- [ ] 二维码生成和显示正常
- [ ] 扫描二维码功能正常
- [ ] 编辑24小时内的动态成功
- [ ] 编辑历史记录正常显示
- [ ] Markdown编辑器工具栏可用
- [ ] Markdown格式正确渲染
- [ ] 编辑/预览/分屏模式切换正常

---

**升级成功！享受v0.31.0的新功能吧！🎉**

有任何问题欢迎反馈到GitHub Issues或Discord社区。

---

_最后更新: 2026-01-26_
