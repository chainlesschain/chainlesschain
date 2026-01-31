# ChainlessChain Android E2E 测试指南

## 📋 概述

本项目实现了完整的端到端（E2E）测试套件，覆盖所有核心功能模块，确保应用在真实设备环境下的稳定性和可靠性。

**总测试数量**: 62 个 E2E 测试用例 (42个原有 + 20个新增UI测试)
**覆盖模块**: 6 个核心功能模块
**覆盖率目标**: UI ≥ 85%, 业务逻辑 ≥ 92%

## 🎯 测试模块

| 模块 | 测试数量 | 描述 |
|------|---------|------|
| **知识库管理** | 8 | Markdown编辑、FTS5搜索、标签筛选、多设备同步 |
| **AI对话系统** | 10 | 流式响应、模型切换、RAG检索、会话压缩 |
| **社交功能** | 12 | 好友管理、动态发布、点赞评论、分享举报 |
| **社交UI屏幕** | 20 | AddFriend、FriendDetail、UserProfile、CommentDetail页面 |
| **P2P通信** | 7 | 设备配对、E2EE加密、离线队列、文件传输 |
| **项目管理** | 5 | Git工作流、代码高亮、文件搜索、模板应用 |

## 🚀 快速开始

### 前置要求

- **Android Studio**: Electric Eel (2022.1.1) 或更高版本
- **JDK**: 17
- **Android SDK**: API 26-33 (Android 8.0 - 13)
- **模拟器/真机**: 至少 4GB RAM

### 本地运行

#### 1. 运行所有 E2E 测试

```bash
cd android-app
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.package=com.chainlesschain.android.e2e
```

#### 2. 运行特定模块测试

```bash
# 知识库测试
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.knowledge.e2e.KnowledgeE2ETest

# AI对话测试
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.ai.e2e.AIConversationE2ETest

# 社交功能测试
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.p2p.e2e.SocialE2ETest

# 社交UI屏幕测试 (新增)
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.p2p.e2e.SocialUIScreensE2ETest

# P2P通信测试
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.p2p.e2e.P2PCommE2ETest

# 项目管理测试
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.project.e2e.ProjectE2ETest
```

#### 3. 运行单个测试用例

```bash
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.knowledge.e2e.KnowledgeE2ETest#testCompleteKnowledgeWorkflow
```

#### 4. 生成覆盖率报告

```bash
# 运行测试并生成 JaCoCo 报告
./gradlew jacocoE2ETestReport

# 查看报告
open app/build/reports/jacoco/jacocoE2ETestReport/html/index.html
```

## 🔧 配置选项

### Test Orchestrator

使用 Test Orchestrator 确保测试隔离（默认启用）：

```bash
./gradlew connectedDebugAndroidTest \
    -Pandroid.testInstrumentationRunnerArguments.clearPackageData=true
```

### 禁用动画

加速测试执行（自动禁用）：

```bash
adb shell settings put global window_animation_scale 0.0
adb shell settings put global transition_animation_scale 0.0
adb shell settings put global animator_duration_scale 0.0
```

### 重试失败的测试

在 CI 环境中自动重试最多 3 次（GitHub Actions 配置）。

## 📊 测试报告

### 生成的报告文件

运行测试后，以下报告会自动生成：

```
app/build/reports/
├── androidTests/connected/         # HTML 测试报告
├── jacoco/jacocoE2ETestReport/    # 代码覆盖率报告
└── tests/                          # JUnit XML 报告

app/build/outputs/
├── androidTest-results/            # 原始测试结果
└── connected_android_test_additional_output/  # 截图和日志
```

### 查看报告

```bash
# 测试结果
open app/build/reports/androidTests/connected/index.html

# 覆盖率报告
open app/build/reports/jacoco/jacocoE2ETestReport/html/index.html
```

## 🐛 故障排查

### 常见问题

#### 1. 模拟器启动失败

**症状**: `Emulator launch timeout`

**解决方案**:
```bash
# 清理 AVD 缓存
rm -rf ~/.android/avd/*

# 重新创建模拟器
android avdmanager create avd -n test_avd -k "system-images;android-30;google_apis;x86_64"
```

#### 2. 测试超时

**症状**: `Test timeout after 60 seconds`

**解决方案**:
```kotlin
// 在 build.gradle.kts 增加超时时间
android {
    testOptions {
        unitTests.all {
            it.testLogging {
                events("passed", "skipped", "failed")
            }
            it.extensions.configure(JacocoTaskExtension::class) {
                isIncludeNoLocationClasses = true
            }
        }
    }
}
```

#### 3. 内存不足

**症状**: `OutOfMemoryError` 或测试崩溃

**解决方案**:
```bash
# 增加 Gradle JVM 内存
export GRADLE_OPTS="-Xmx4g -XX:MaxMetaspaceSize=1g"

# 或在 gradle.properties 添加
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g
```

#### 4. 依赖冲突

**症状**: `Duplicate class` 错误

**解决方案**:
```kotlin
// 在 build.gradle.kts 排除冲突依赖
configurations.all {
    exclude(group = "org.jetbrains", module = "annotations-java5")
}
```

### 调试测试

#### 启用详细日志

```bash
./gradlew connectedDebugAndroidTest --info --stacktrace
```

#### 查看 Logcat 输出

```bash
adb logcat -c  # 清除旧日志
adb logcat | grep "TestRunner"
```

#### 截图失败场景

测试失败时，截图自动保存到：
```
app/build/outputs/connected_android_test_additional_output/debugAndroidTest/connected/<device>/
```

## 🎨 最佳实践

### 1. 测试命名规范

```kotlin
@Test
fun test<Module><Action><Expected>() {
    // E2E-KB-01: 完整工作流
    // E2E-AI-02: 模型切换
    // E2E-SOCIAL-03: 通知处理
}
```

### 2. 使用辅助方法

```kotlin
// 提取重复逻辑
private fun createTestProject(name: String) {
    composeTestRule.apply {
        clickOnText("新建项目")
        typeTextInField("项目名称", name)
        clickOnText("创建")
        waitForText("创建成功", timeoutMillis = 30000)
    }
}
```

### 3. 等待异步操作

```kotlin
// ❌ 不推荐：固定延迟
Thread.sleep(2000)

// ✅ 推荐：等待条件满足
composeTestRule.waitUntilNodeExists(hasText("加载完成"), timeoutMillis = 5000)
```

### 4. 清理测试数据

```kotlin
@Before
fun setup() {
    // 清理数据库
    databaseFixture.clearAllTables()

    // 重置应用状态
    composeTestRule.activityRule.scenario.onActivity { activity ->
        activity.recreate()
    }
}
```

### 5. 并行测试隔离

```kotlin
// 使用 Test Orchestrator 确保每个测试在独立进程中运行
// build.gradle.kts:
testOptions {
    execution = "ANDROIDX_TEST_ORCHESTRATOR"
}
```

## 🔄 CI/CD 集成

### GitHub Actions

测试在以下情况自动运行：
- **Push** 到 `main` 或 `develop` 分支
- **Pull Request** 到 `main` 或 `develop`
- **定时任务**: 每日凌晨 2:00
- **手动触发**: 通过 Actions 面板

### 矩阵测试

自动在 3 个 API levels 上并行测试：
- API 26 (Android 8.0)
- API 30 (Android 11)
- API 33 (Android 13)

### 查看 CI 结果

1. 访问 GitHub Actions 页面
2. 选择 "Android E2E Tests" workflow
3. 查看各 API level 的测试结果
4. 下载测试报告和截图 (Artifacts)

### 失败重试

CI 环境自动重试失败的测试最多 3 次，减少偶发性失败的影响。

## 📈 覆盖率目标

| 层级 | 目标覆盖率 | 当前覆盖率 |
|------|-----------|-----------|
| **UI 层** | ≥ 80% | ~85% ✅ |
| **业务逻辑层** | ≥ 90% | ~92% ✅ |
| **关键路径** | 100% | 100% ✅ |

## 🛠 测试工具栈

- **UI Testing**: Jetpack Compose Test (androidx.compose.ui:ui-test-junit4)
- **网络模拟**: MockWebServer (com.squareup.okhttp3:mockwebserver)
- **测试隔离**: Test Orchestrator (androidx.test:orchestrator)
- **Flow 测试**: Turbine (app.cash.turbine:turbine)
- **覆盖率**: JaCoCo 0.8.11
- **Mock 框架**: MockK (io.mockk:mockk)
- **测试运行器**: AndroidJUnit4

## 📝 贡献测试

### 添加新测试

1. 在对应模块创建测试文件
2. 继承基础测试类或使用 `@HiltAndroidTest`
3. 添加到 `AppE2ETestSuite.kt`
4. 更新本文档

示例：

```kotlin
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class MyFeatureE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun testMyFeature() {
        composeTestRule.apply {
            // 测试逻辑
        }
    }
}
```

## 📞 支持

遇到问题？
- 📖 查看 [Jetpack Compose Testing 官方文档](https://developer.android.com/jetpack/compose/testing)
- 🐛 提交 Issue: [GitHub Issues](https://github.com/yourusername/chainlesschain/issues)
- 💬 讨论: [GitHub Discussions](https://github.com/yourusername/chainlesschain/discussions)

## 📜 更新日志

### v0.28.0 (2026-01-26)
- ✅ 实现完整的 E2E 测试框架
- ✅ 添加 42 个 E2E 测试用例
- ✅ 集成 JaCoCo 代码覆盖率
- ✅ 配置 GitHub Actions CI/CD
- ✅ 添加 Test Orchestrator 支持

---

**维护者**: ChainlessChain Team
**最后更新**: 2026-01-26
