# Android端完整集成和E2E测试计划

**制定日期**: 2026-01-25
**目标**: 将所有Android功能完整集成并建立端到端测试体系
**预计总工时**: 40-60小时（分5个阶段）

---

## 📊 当前状态评估

### ✅ 已完成
- 基础架构（Hilt DI, Navigation, Compose UI）
- 核心模块（Database, Security, Network）
- 功能模块组件（ViewModel, Repository）
- UI组件库（Dialog, Screen, Components）
- **刚修复**: 创建项目功能 ✅

### ❌ 待完成
- UI与ViewModel集成（估计50%完成）
- 真实数据替换模拟数据
- 端到端测试框架
- 自动化功能测试
- CI/CD集成

---

## 🎯 五阶段实施计划

### **阶段1: 功能审查与修复（8-12小时）**

#### 1.1 全面功能审查（2小时）

**任务**: 手动测试每个按钮和功能

**测试清单**:
```
[ ] PIN码设置
[ ] 登录功能
[ ] 首页显示
[ ] 项目创建 ✅ (已修复)
[ ] 项目列表查看
[ ] 项目详情查看
[ ] 文件浏览器
[ ] AI会话创建
[ ] AI聊天功能
[ ] LLM配置页面
[ ] LLM测试页面
[ ] P2P功能
[ ] 个人资料
[ ] 设置页面
```

**执行方式**:
```bash
# 创建测试记录脚本
cd android-app
./scripts/manual-test-all-features.sh > test-results.txt 2>&1
```

#### 1.2 AI会话功能修复（2-3小时）

**检查文件**:
- `feature-ai/presentation/ConversationListScreen.kt`
- `feature-ai/presentation/ChatScreen.kt`
- `feature-ai/presentation/NewConversationScreen.kt`

**修复步骤**:
1. 检查对话框集成
2. 连接ConversationViewModel
3. 处理LLM API调用
4. 测试消息发送/接收

**预期问题**:
- 按钮无响应（类似创建项目问题）
- LLM配置未加载
- 消息未保存到数据库

#### 1.3 LLM配置功能修复（2-3小时）

**检查文件**:
- `feature-ai/presentation/settings/LLMSettingsScreen.kt`
- `feature-ai/presentation/LLMTestChatScreen.kt`

**修复步骤**:
1. 连接LLMConfigViewModel
2. 实现配置保存功能
3. 实现LLM测试功能
4. 验证API密钥验证

#### 1.4 P2P功能修复（1-2小时）

**检查文件**:
- `feature-p2p/navigation/P2PGraph.kt`
- `feature-p2p/presentation/*.kt`

**修复步骤**:
1. 检查所有P2P相关Screen
2. 连接P2PViewModel
3. 测试设备发现和连接

#### 1.5 文件浏览器修复（1-2小时）

**检查文件**:
- `feature-file-browser/ui/GlobalFileBrowserScreen.kt`

**修复步骤**:
1. 验证文件列表加载
2. 测试文件导入功能
3. 验证权限处理

---

### **阶段2: 数据集成（10-15小时）**

#### 2.1 替换模拟数据（5-7小时）

**待修改文件清单**:
```kotlin
// 1. ProjectScreen.kt ⏳ 部分完成
// TODO: 完全替换模拟数据为真实数据

// 2. HomeScreen.kt
val recentProjects = remember { listOf(/* 模拟数据 */) }
// 改为:
val recentProjects by viewModel.recentProjects.collectAsState()

// 3. ConversationListScreen.kt
// 检查是否使用模拟会话数据

// 4. 其他Screen...
```

**执行计划**:
```bash
# 搜索所有模拟数据
cd android-app
grep -r "remember.*listOf" app/src/main --include="*.kt" > mock-data-locations.txt

# 逐个替换为ViewModel集成
```

#### 2.2 ViewModel完整集成（5-8小时）

**集成模式（标准化）**:
```kotlin
@Composable
fun SomeScreen(
    viewModel: SomeViewModel = hiltViewModel(),
    authViewModel: AuthViewModel = hiltViewModel()
) {
    // 1. 收集状态
    val uiState by viewModel.uiState.collectAsState()
    val authState by authViewModel.uiState.collectAsState()

    // 2. 初始化
    LaunchedEffect(authState.currentUser) {
        authState.currentUser?.let { user ->
            viewModel.setCurrentUser(user.id)
        }
    }

    // 3. 事件处理
    LaunchedEffect(Unit) {
        viewModel.uiEvents.collectLatest { event ->
            when (event) {
                is UiEvent.ShowMessage -> { /* Snackbar */ }
                is UiEvent.ShowError -> { /* Error handling */ }
                // ...
            }
        }
    }

    // 4. UI with real data
    when (val state = uiState) {
        is State.Loading -> LoadingIndicator()
        is State.Success -> Content(state.data)
        is State.Error -> ErrorView(state.error)
    }
}
```

**应用到所有Screen**:
- [ ] ProjectScreen ✅ (部分完成)
- [ ] HomeScreen
- [ ] ConversationListScreen
- [ ] ChatScreen
- [ ] LLMSettingsScreen
- [ ] ProfileScreen
- [ ] 其他10+个Screen

---

### **阶段3: E2E测试框架搭建（8-12小时）**

#### 3.1 选择测试框架（1小时）

**方案对比**:

| 框架 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **Espresso** | 成熟，文档多 | 不支持Compose | ❌ 不推荐 |
| **Compose Testing** | 原生支持Compose | 新框架，示例少 | ✅ **推荐** |
| **Maestro** | 简单，跨平台 | 需要额外安装 | ⚠️ 备选 |

**最终选择**: **Jetpack Compose Testing** + **JUnit4**

#### 3.2 配置测试环境（2小时）

**修改文件**:

1. **`app/build.gradle.kts`**:
```kotlin
dependencies {
    // Compose Testing
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    // Hilt Testing
    androidTestImplementation("com.google.dagger:hilt-android-testing:2.50")
    kspAndroidTest("com.google.dagger:hilt-compiler:2.50")

    // Coroutines Testing
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")

    // Truth Assertions
    androidTestImplementation("com.google.truth:truth:1.1.5")
}
```

2. **创建测试基类**:
```kotlin
// app/src/androidTest/java/com/chainlesschain/android/BaseE2ETest.kt
@HiltAndroidTest
abstract class BaseE2ETest {
    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        // 设置测试用户
        setupTestUser()
    }

    protected fun setupTestUser() {
        // 创建测试用户和PIN码
    }
}
```

#### 3.3 编写核心测试用例（5-9小时）

**测试文件结构**:
```
app/src/androidTest/java/com/chainlesschain/android/
├── e2e/
│   ├── auth/
│   │   ├── SetupPinE2ETest.kt          (1h)
│   │   └── LoginE2ETest.kt             (1h)
│   ├── project/
│   │   ├── CreateProjectE2ETest.kt     (2h)
│   │   ├── ViewProjectE2ETest.kt       (1h)
│   │   └── ProjectFileE2ETest.kt       (1h)
│   ├── ai/
│   │   ├── CreateConversationE2ETest.kt (2h)
│   │   ├── ChatE2ETest.kt              (2h)
│   │   └── LLMConfigE2ETest.kt         (1h)
│   └── integration/
│       └── FullUserJourneyE2ETest.kt   (2h)
└── helpers/
    ├── ComposeTestHelpers.kt
    └── TestDataFactory.kt
```

**示例测试 - 创建项目**:
```kotlin
// app/src/androidTest/java/com/chainlesschain/android/e2e/project/CreateProjectE2ETest.kt
@HiltAndroidTest
class CreateProjectE2ETest : BaseE2ETest() {

    @Test
    fun whenClickAddButton_shouldShowTemplateDialog() {
        composeTestRule.apply {
            // 1. 导航到项目页面
            onNodeWithText("项目").performClick()

            // 2. 点击添加按钮
            onNodeWithContentDescription("新建项目").performClick()

            // 3. 验证对话框显示
            onNodeWithText("选择项目模板").assertIsDisplayed()
        }
    }

    @Test
    fun whenCreateProjectFromTemplate_shouldShowSuccessMessage() {
        composeTestRule.apply {
            // 1. 导航并打开对话框
            onNodeWithText("项目").performClick()
            onNodeWithContentDescription("新建项目").performClick()

            // 2. 选择模板
            onNodeWithText("Android应用").performClick()

            // 3. 确认创建
            onNodeWithText("使用此模板").performClick()

            // 4. 验证成功消息
            onNodeWithText("项目创建成功").assertIsDisplayed()

            // 5. 验证项目出现在列表中
            waitUntil(timeoutMillis = 5000) {
                onAllNodesWithText("Android应用")
                    .fetchSemanticsNodes().isNotEmpty()
            }
        }
    }

    @Test
    fun whenCreateProjectFails_shouldShowErrorMessage() {
        // 测试错误处理
    }
}
```

**测试覆盖目标**:
- [ ] 认证流程（PIN设置、登录、登出）
- [ ] 项目管理（创建、查看、编辑、删除）
- [ ] 文件操作（浏览、导入、预览）
- [ ] AI会话（创建、聊天、保存）
- [ ] LLM配置（添加、测试、切换）
- [ ] 完整用户旅程（从注册到使用全部功能）

---

### **阶段4: CI/CD集成（4-6小时）**

#### 4.1 GitHub Actions配置（2-3小时）

**创建工作流文件**:

```yaml
# .github/workflows/android-ci.yml
name: Android CI

on:
  push:
    branches: [ main, develop ]
    paths:
      - 'android-app/**'
  pull_request:
    branches: [ main, develop ]
    paths:
      - 'android-app/**'

jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK 17
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'adopt'

      - name: Grant execute permission for gradlew
        run: chmod +x android-app/gradlew

      - name: Run unit tests
        run: cd android-app && ./gradlew test

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: android-app/app/build/reports/tests/

  instrumented-test:
    name: Run E2E Tests
    runs-on: macos-latest  # 需要macOS才能运行Android模拟器

    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK 17
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'adopt'

      - name: Grant execute permission for gradlew
        run: chmod +x android-app/gradlew

      - name: Run instrumented tests
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 30
          target: google_apis
          arch: x86_64
          script: cd android-app && ./gradlew connectedDebugAndroidTest

      - name: Upload E2E test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: e2e-test-results
          path: android-app/app/build/reports/androidTests/

  build:
    name: Build APK
    runs-on: ubuntu-latest
    needs: [test]

    steps:
      - uses: actions/checkout@v3

      - name: Set up JDK 17
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'adopt'

      - name: Build Debug APK
        run: cd android-app && ./gradlew assembleDebug

      - name: Upload APK
        uses: actions/upload-artifact@v3
        with:
          name: app-debug
          path: android-app/app/build/outputs/apk/debug/app-debug.apk
```

#### 4.2 本地Pre-commit Hook（1-2小时）

**创建Hook脚本**:
```bash
# android-app/.git/hooks/pre-commit
#!/bin/bash

echo "Running Android pre-commit checks..."

cd android-app

# 1. Lint check
./gradlew lintDebug
if [ $? -ne 0 ]; then
    echo "❌ Lint check failed"
    exit 1
fi

# 2. Unit tests
./gradlew test
if [ $? -ne 0 ]; then
    echo "❌ Unit tests failed"
    exit 1
fi

# 3. Detekt (code quality)
./gradlew detekt
if [ $? -ne 0 ]; then
    echo "⚠️  Detekt warnings found"
    # 不阻止提交，仅警告
fi

echo "✅ All pre-commit checks passed"
```

#### 4.3 测试覆盖率报告（1小时）

**配置Jacoco**:
```kotlin
// app/build.gradle.kts
android {
    buildTypes {
        debug {
            enableAndroidTestCoverage = true
            enableUnitTestCoverage = true
        }
    }
}

// 添加Jacoco任务
tasks.register("jacocoTestReport", JacocoReport::class) {
    dependsOn("testDebugUnitTest", "connectedDebugAndroidTest")

    reports {
        xml.required.set(true)
        html.required.set(true)
    }

    val debugTree = fileTree("${buildDir}/intermediates/javac/debug")
    sourceDirectories.setFrom(files("src/main/java", "src/main/kotlin"))
    classDirectories.setFrom(debugTree)
    executionData.setFrom(fileTree(buildDir).include(
        "jacoco/testDebugUnitTest.exec",
        "outputs/code_coverage/debugAndroidTest/connected/**/*.ec"
    ))
}
```

---

### **阶段5: 文档和流程优化（4-6小时）**

#### 5.1 测试文档编写（2小时）

**创建文档**:

1. **`android-app/docs/TESTING_GUIDE.md`**
```markdown
# Android应用测试指南

## 快速开始

### 运行所有测试
```bash
cd android-app
./gradlew test                    # 单元测试
./gradlew connectedDebugAndroidTest # E2E测试（需要连接设备）
```

### 运行特定测试
```bash
./gradlew :app:testDebugUnitTest --tests "*.CreateProjectE2ETest"
```

## 编写新测试

[详细指南...]
```

2. **`android-app/docs/CONTRIBUTING.md`**
```markdown
# 贡献指南

## 提交PR前检查清单

- [ ] 所有单元测试通过
- [ ] 添加了E2E测试（如果是新功能）
- [ ] 代码通过Lint检查
- [ ] 手动测试了修改的功能
- [ ] 更新了相关文档
```

#### 5.2 发布检查清单（1-2小时）

**创建检查清单**:
```markdown
# android-app/RELEASE_CHECKLIST.md

## 发布前必检项

### 自动化测试
- [ ] 所有单元测试通过 (`./gradlew test`)
- [ ] 所有E2E测试通过 (`./gradlew connectedDebugAndroidTest`)
- [ ] 代码覆盖率 > 70%

### 手动测试
- [ ] 首次安装体验（PIN设置）
- [ ] 登录/登出流程
- [ ] 创建项目（至少3种不同模板）
- [ ] AI会话（发送10条消息）
- [ ] LLM配置切换
- [ ] 文件导入（图片、文档）
- [ ] P2P连接测试
- [ ] 应用前后台切换
- [ ] 应用卸载重装（数据持久化）

### 性能测试
- [ ] 启动时间 < 3秒
- [ ] 列表滑动流畅（60fps）
- [ ] 内存占用 < 200MB
- [ ] APK大小 < 100MB

### 设备兼容性
- [ ] Android 8.0 (API 26)
- [ ] Android 11 (API 30)
- [ ] Android 14 (API 34)
- [ ] 不同屏幕尺寸（Phone, Tablet）

### 错误处理
- [ ] 网络断开
- [ ] 数据库错误
- [ ] API调用失败
- [ ] 权限拒绝
```

#### 5.3 开发流程文档（1-2小时）

**创建工作流文档**:
```markdown
# android-app/docs/DEVELOPMENT_WORKFLOW.md

## 标准开发流程

### 1. 新功能开发

```bash
# 1. 创建功能分支
git checkout -b feature/new-feature

# 2. 开发 + 单元测试
# 编写代码...
./gradlew test

# 3. 集成测试
# 编写E2E测试...
./gradlew connectedDebugAndroidTest

# 4. 提交
git add .
git commit -m "feat(feature): add new feature"

# 5. 推送并创建PR
git push origin feature/new-feature
```

### 2. Bug修复流程

[...]
```

---

## 📅 实施时间表

### 第1周（阶段1 + 阶段2部分）
- **Day 1-2**: 功能审查，修复AI会话和LLM配置
- **Day 3-4**: 修复P2P和文件浏览器
- **Day 5**: 开始数据集成（替换模拟数据）

### 第2周（阶段2完成 + 阶段3）
- **Day 1-2**: 完成所有Screen的ViewModel集成
- **Day 3**: 配置E2E测试框架
- **Day 4-5**: 编写核心测试用例

### 第3周（阶段4 + 阶段5）
- **Day 1-2**: CI/CD集成和自动化
- **Day 3**: 文档编写
- **Day 4-5**: 全面测试和Bug修复

---

## 🎯 成功标准

### 必须达成
- ✅ **100%核心功能可用**（创建项目、AI会话、LLM配置）
- ✅ **0个已知P0/P1 Bug**
- ✅ **测试覆盖率 > 70%**
- ✅ **所有E2E测试通过**

### 理想目标
- ⭐ 测试覆盖率 > 85%
- ⭐ CI/CD自动发布APK
- ⭐ 性能指标达标
- ⭐ 完整的开发文档

---

## 📝 追踪进度

### 使用工具
- GitHub Projects（看板管理）
- Issue标签系统（bug/feature/enhancement）
- Milestone（每个阶段一个里程碑）

### 进度报告格式
```markdown
## 周进度报告 - Week N

### 完成
- [x] 任务1
- [x] 任务2

### 进行中
- [ ] 任务3 (60%)

### 阻塞/问题
- 问题描述

### 下周计划
- 计划任务...
```

---

## 🚀 立即开始

### 下一步行动

1. **立即测试创建项目功能**
   ```bash
   # 在手机上：
   # 1. 打开应用
   # 2. 进入"项目"tab
   # 3. 点击右上角"+"
   # 4. 选择模板并创建
   # 5. 验证成功
   ```

2. **开始阶段1功能审查**
   ```bash
   cd android-app
   # 创建测试记录文件
   touch MANUAL_TEST_RESULTS.md
   # 逐个测试所有功能并记录
   ```

3. **创建GitHub Issues**
   - 为每个发现的问题创建Issue
   - 标记优先级（P0/P1/P2）
   - 分配到相应Milestone

---

**制定人**: Claude Code
**审核**: [待填写]
**批准**: [待填写]
