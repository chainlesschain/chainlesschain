# 🔥 Firebase Crashlytics 集成指南

## 概述

从 v0.32.0 开始，ChainlessChain Android 应用集成了 Firebase Crashlytics，提供生产级错误监控和崩溃报告。

## 配置步骤

### 1. Firebase 项目设置

#### 1.1 创建 Firebase 项目

1. 访问 [Firebase Console](https://console.firebase.google.com/)
2. 点击 "添加项目"
3. 输入项目名称：`ChainlessChain`
4. 启用 Google Analytics（可选但推荐）
5. 选择或创建 Analytics 账户

#### 1.2 添加 Android 应用

1. 在 Firebase 项目中点击 "添加应用" → "Android"
2. 输入应用包名：`com.chainlesschain.android`
3. 应用昵称：`ChainlessChain Android`
4. 调试签名证书 SHA-1（可选）：
   ```bash
   keytool -list -v -keystore keystore/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

#### 1.3 下载配置文件

1. 下载 `google-services.json`
2. 将文件放置到：`android-app/app/google-services.json`
3. **重要**: 文件已在 `.gitignore` 中排除，不会提交到版本控制

### 2. 项目级配置

#### 2.1 添加 Firebase 插件（已完成 ✅）

`android-app/build.gradle.kts`（项目根目录）:

```kotlin
buildscript {
    dependencies {
        classpath("com.google.gms:google-services:4.4.0")
        classpath("com.google.firebase:firebase-crashlytics-gradle:2.9.9")
    }
}
```

#### 2.2 应用级配置（已完成 ✅）

`android-app/app/build.gradle.kts`:

```kotlin
plugins {
    id("com.google.gms.google-services") // Firebase
    id("com.google.firebase.crashlytics") // Crashlytics
}

dependencies {
    // Firebase BoM（统一版本管理）
    implementation(platform("com.google.firebase:firebase-bom:32.7.0"))

    // Crashlytics 和 Analytics
    implementation("com.google.firebase:firebase-crashlytics-ktx")
    implementation("com.google.firebase:firebase-analytics-ktx")
}
```

### 3. 代码集成

#### 3.1 初始化 Crashlytics

在 `ChainlessChainApplication.kt` 中：

```kotlin
import com.google.firebase.crashlytics.FirebaseCrashlytics

class ChainlessChainApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // 初始化 Crashlytics
        initializeCrashlytics()
    }

    private fun initializeCrashlytics() {
        val crashlytics = FirebaseCrashlytics.getInstance()

        // Debug 环境禁用自动收集（节省配额）
        if (BuildConfig.DEBUG) {
            crashlytics.setCrashlyticsCollectionEnabled(false)
            Timber.d("Crashlytics: Disabled for debug builds")
        } else {
            crashlytics.setCrashlyticsCollectionEnabled(true)
            Timber.i("Crashlytics: Enabled for release builds")
        }

        // 设置用户标识符（匿名化）
        val deviceId = getSharedPreferences("prefs", Context.MODE_PRIVATE)
            .getString("device_id", "unknown") ?: "unknown"
        crashlytics.setUserId(deviceId)

        // 设置自定义键值
        crashlytics.setCustomKey("app_version", BuildConfig.VERSION_NAME)
        crashlytics.setCustomKey("build_type", if (BuildConfig.DEBUG) "debug" else "release")
    }
}
```

#### 3.2 记录非致命异常

```kotlin
import com.google.firebase.crashlytics.ktx.crashlytics
import com.google.firebase.ktx.Firebase

// 记录捕获的异常
try {
    riskyOperation()
} catch (e: Exception) {
    Firebase.crashlytics.recordException(e)
    Timber.e(e, "Operation failed")
}
```

#### 3.3 添加自定义日志

```kotlin
Firebase.crashlytics.log("User performed action: $actionName")
Firebase.crashlytics.setCustomKey("last_screen", screenName)
Firebase.crashlytics.setCustomKey("user_type", "premium")
```

#### 3.4 强制崩溃测试

```kotlin
// 仅用于测试 Crashlytics
if (BuildConfig.DEBUG) {
    Firebase.crashlytics.sendUnsentReports()
    throw RuntimeException("Test crash for Crashlytics")
}
```

### 4. ProGuard 配置（已完成 ✅）

`android-app/app/proguard-rules.pro` 已包含 Firebase 规则：

```proguard
# Firebase Crashlytics
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception
-keep class com.google.firebase.crashlytics.** { *; }

# Firebase 核心
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
```

### 5. 测试 Crashlytics

#### 5.1 本地测试

```bash
# 1. 构建 Debug APK
cd android-app
./gradlew assembleDebug

# 2. 安装到设备
adb install app/build/outputs/apk/debug/app-debug.apk

# 3. 触发测试崩溃（在应用中添加按钮）
Firebase.crashlytics.sendUnsentReports()
throw RuntimeException("Test crash")

# 4. 查看日志确认上传
adb logcat | grep Crashlytics
```

#### 5.2 Firebase Console 验证

1. 访问 [Firebase Console](https://console.firebase.google.com/)
2. 选择项目 → Crashlytics
3. 等待 5-10 分钟查看报告
4. 首次崩溃可能需要重启应用才会上传

### 6. 高级配置

#### 6.1 自定义崩溃报告

```kotlin
class CustomCrashReporter @Inject constructor() {

    fun reportError(
        throwable: Throwable,
        context: String,
        additionalData: Map<String, String> = emptyMap()
    ) {
        val crashlytics = Firebase.crashlytics

        // 设置上下文
        crashlytics.log("Error context: $context")

        // 添加自定义数据
        additionalData.forEach { (key, value) ->
            crashlytics.setCustomKey(key, value)
        }

        // 记录异常
        crashlytics.recordException(throwable)
    }
}
```

#### 6.2 按环境配置

`build.gradle.kts`:

```kotlin
buildTypes {
    debug {
        // Debug 禁用上传
        manifestPlaceholders["crashlytics_enabled"] = "false"
    }
    release {
        // Release 启用上传
        manifestPlaceholders["crashlytics_enabled"] = "true"
    }
}
```

`AndroidManifest.xml`:

```xml
<meta-data
    android:name="firebase_crashlytics_collection_enabled"
    android:value="${crashlytics_enabled}" />
```

#### 6.3 用户隐私保护

```kotlin
// 允许用户选择退出崩溃报告
fun setUserCrashlyticsPreference(enabled: Boolean) {
    Firebase.crashlytics.setCrashlyticsCollectionEnabled(enabled)

    // 保存用户偏好
    sharedPreferences.edit()
        .putBoolean("crashlytics_enabled", enabled)
        .apply()
}
```

### 7. CI/CD 集成

#### GitHub Actions

```yaml
name: Android Release Build

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Decode google-services.json
        run: |
          echo "${{ secrets.GOOGLE_SERVICES_JSON }}" | base64 -d > android-app/app/google-services.json

      - name: Build Release APK
        run: |
          cd android-app
          ./gradlew assembleRelease

      - name: Upload Crashlytics Symbols
        run: |
          ./gradlew uploadCrashlyticsSymbolFileRelease
```

**GitHub Secrets**:

- `GOOGLE_SERVICES_JSON`: Base64 编码的 google-services.json

### 8. 常见问题

#### Q: Crashlytics 报告未显示？

**原因**:

1. `google-services.json` 文件未配置
2. Firebase 插件未应用
3. Debug 版本默认禁用
4. 网络连接问题

**解决**:

```bash
# 检查 Crashlytics 状态
adb logcat -s FirebaseCrashlytics

# 强制上传未发送报告
Firebase.crashlytics.sendUnsentReports()
```

#### Q: 符号文件丢失，堆栈不可读？

**原因**: ProGuard 混淆后符号表未上传

**解决**:

```bash
# 上传符号表
./gradlew uploadCrashlyticsSymbolFileRelease
```

#### Q: 如何测试非致命异常？

```kotlin
// 记录测试异常
Firebase.crashlytics.recordException(Exception("Test exception"))
Firebase.crashlytics.sendUnsentReports()
```

#### Q: 用户隐私问题？

- 默认不收集 PII（个人身份信息）
- 用户 ID 使用匿名化设备标识符
- 提供用户退出选项
- 符合 GDPR/CCPA 要求

### 9. 最佳实践

#### 9.1 错误分类

```kotlin
enum class ErrorSeverity {
    LOW,     // 不影响功能，可恢复
    MEDIUM,  // 影响部分功能
    HIGH,    // 严重影响用户体验
    CRITICAL // 应用崩溃
}

fun reportError(throwable: Throwable, severity: ErrorSeverity) {
    Firebase.crashlytics.apply {
        setCustomKey("severity", severity.name)
        recordException(throwable)
    }
}
```

#### 9.2 上下文面包屑

```kotlin
class NavigationTracker {
    fun onScreenView(screenName: String) {
        Firebase.crashlytics.log("Screen: $screenName")
        Firebase.crashlytics.setCustomKey("last_screen", screenName)
    }
}
```

#### 9.3 性能监控

```kotlin
// 结合 Firebase Performance
import com.google.firebase.perf.FirebasePerformance

val trace = FirebasePerformance.getInstance()
    .newTrace("knowledge_search")
try {
    trace.start()
    performSearch(query)
    trace.stop()
} catch (e: Exception) {
    Firebase.crashlytics.recordException(e)
    trace.stop()
}
```

### 10. 监控指标

#### 关键指标

| 指标             | 目标     | 说明               |
| ---------------- | -------- | ------------------ |
| 崩溃率           | < 1%     | 崩溃用户 / 总用户  |
| 无崩溃用户率     | > 99%    | 从未崩溃的用户比例 |
| 平均首次响应时间 | < 24小时 | 修复关键崩溃       |
| 符号化率         | 100%     | 堆栈可读性         |

#### Dashboard 监控

```kotlin
// 自定义事件跟踪
Firebase.analytics.logEvent("feature_used") {
    param("feature_name", "knowledge_search")
    param("result", "success")
}
```

### 11. 成本估算

| 用量           | 免费配额      | 超额费用          |
| -------------- | ------------- | ----------------- |
| 崩溃报告       | 无限制        | $0                |
| 符号表存储     | 1GB/项目      | $0.026/GB/月      |
| Analytics 事件 | 500 事件/项目 | 升级到 Blaze 计划 |

**建议**: Spark 免费计划足够小型应用使用。

### 12. 参考文档

- [Firebase Crashlytics 官方文档](https://firebase.google.com/docs/crashlytics)
- [Android 集成指南](https://firebase.google.com/docs/crashlytics/get-started?platform=android)
- [ProGuard 配置](https://firebase.google.com/docs/crashlytics/get-deobfuscated-reports)

## 更新日志

| 版本 | 日期       | 变更                                    |
| ---- | ---------- | --------------------------------------- |
| v1.0 | 2026-02-05 | 初始版本：Firebase Crashlytics 集成完成 |
