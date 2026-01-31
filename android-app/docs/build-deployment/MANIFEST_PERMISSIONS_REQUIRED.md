# AndroidManifest.xml 权限配置

## 🔐 文件浏览器功能所需权限

在实施UI界面之前，请确保在 `app/src/main/AndroidManifest.xml` 中添加以下权限：

### Android 13+ (API 33+) 权限

```xml
<!-- 读取图片 -->
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />

<!-- 读取视频 -->
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />

<!-- 读取音频 -->
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
```

### Android 10-12 (API 29-32) 权限

```xml
<!-- 读取外部存储 -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />
```

### Android 9及以下 (API 28-) 权限

```xml
<!-- 读取外部存储 -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />

<!-- 写入外部存储 -->
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28" />
```

---

## ✅ 完整权限配置示例

在 `app/src/main/AndroidManifest.xml` 的 `<manifest>` 标签中添加：

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <!-- ========== 文件浏览器权限 ========== -->

    <!-- Android 13+ 粒度媒体权限 -->
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />

    <!-- Android 10-12 读取外部存储 -->
    <uses-permission
        android:name="android.permission.READ_EXTERNAL_STORAGE"
        android:maxSdkVersion="32" />

    <!-- Android 9及以下 写入外部存储 -->
    <uses-permission
        android:name="android.permission.WRITE_EXTERNAL_STORAGE"
        android:maxSdkVersion="28" />

    <!-- ========== 其他现有权限 ========== -->
    <!-- ... 您的其他权限 ... -->

    <application>
        <!-- ... 应用配置 ... -->
    </application>
</manifest>
```

---

## 📝 权限说明

### maxSdkVersion 属性
- `android:maxSdkVersion="32"` - 只在Android 12及以下版本请求此权限
- `android:maxSdkVersion="28"` - 只在Android 9及以下版本请求此权限

### 为什么需要这些权限？

1. **READ_MEDIA_IMAGES** (Android 13+)
   - 访问用户的图片文件
   - 扫描和索引图片

2. **READ_MEDIA_VIDEO** (Android 13+)
   - 访问用户的视频文件
   - 扫描和索引视频

3. **READ_MEDIA_AUDIO** (Android 13+)
   - 访问用户的音频文件
   - 扫描和索引音频

4. **READ_EXTERNAL_STORAGE** (Android 10-12)
   - 访问外部存储上的所有文件
   - 扫描文档、图片、视频等

5. **WRITE_EXTERNAL_STORAGE** (Android 9及以下)
   - 写入外部存储
   - 复制文件到项目目录

---

## 🔍 运行时权限检查

PermissionManager会自动处理不同Android版本的权限检查：

```kotlin
@Inject
lateinit var permissionManager: PermissionManager

// 自动检查正确的权限
if (!permissionManager.checkStoragePermissions()) {
    val permissions = permissionManager.getRequiredPermissions()
    // Android 13+: 返回 READ_MEDIA_* 权限
    // Android 11-12: 返回 READ_EXTERNAL_STORAGE
    // Android 10-: 返回 READ_EXTERNAL_STORAGE + WRITE_EXTERNAL_STORAGE
}
```

---

## ⚠️ 重要提示

### 1. 权限请求时机
- **首次扫描前**：必须请求权限
- **应用启动时**：可选，推荐延迟到用户打开文件浏览器时

### 2. 权限被拒绝处理
- 提供清晰的说明，解释为什么需要权限
- 引导用户到设置页面手动授权
- 使用PermissionManager提供的权限说明文本

### 3. Android 11+ Scoped Storage
- 即使有权限，也只能访问MediaStore中的文件
- 无法直接访问其他应用的私有目录
- 这是Android系统的安全限制

### 4. 测试覆盖
确保在以下版本上测试权限请求：
- ✅ Android 8.0 (API 26) - 传统存储
- ✅ Android 10 (API 29) - Scoped Storage引入
- ✅ Android 11 (API 30) - 强制Scoped Storage
- ✅ Android 13 (API 33) - 粒度媒体权限
- ✅ Android 14 (API 34) - 最新版本

---

## 📱 用户权限请求流程

### 推荐的用户体验：

1. **首次打开文件浏览器**
   ```
   显示说明对话框：
   "为了浏览您手机上的文件，我们需要访问您的图片、视频和音频文件..."

   [允许] [拒绝]
   ```

2. **用户点击"允许"**
   ```
   系统权限对话框:
   - Android 13+: 选择"允许访问所有照片和视频"或"选择照片和视频"
   - Android 12-: "允许访问照片、媒体和文件"
   ```

3. **权限被拒绝**
   ```
   显示引导：
   "需要存储权限才能浏览文件。请在设置中允许访问。"

   [前往设置] [取消]
   ```

4. **永久拒绝（勾选"不再询问"）**
   ```
   显示说明：
   "存储权限已被永久拒绝。请手动开启：
   设置 > 应用 > ChainlessChain > 权限 > 文件和媒体"

   [打开设置] [取消]
   ```

---

## 🛠️ 实施检查清单

在实施UI之前，请确认：

- [ ] AndroidManifest.xml中已添加所有必需权限
- [ ] 权限使用了正确的maxSdkVersion属性
- [ ] PermissionManager已正确注入到ViewModel
- [ ] UI包含权限请求流程
- [ ] 处理了权限被拒绝的情况
- [ ] 处理了永久拒绝的情况
- [ ] 在不同Android版本上测试权限请求

---

## 📚 相关代码

### PermissionManager 位置
```
android-app/app/src/main/java/com/chainlesschain/android/presentation/permissions/PermissionManager.kt
```

### 使用示例
```kotlin
// 在GlobalFileBrowserScreen.kt中
val permissionLauncher = rememberLauncherForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions()
) { permissions ->
    if (permissions.all { it.value }) {
        viewModel.startScan()
    } else {
        showPermissionDeniedDialog = true
    }
}

LaunchedEffect(Unit) {
    if (!permissionManager.checkStoragePermissions()) {
        permissionLauncher.launch(permissionManager.getRequiredPermissions())
    }
}
```

---

**记住**: 在开始实施UI之前，先配置好这些权限！

**下一步**: Phase 5 - 实现UI界面
