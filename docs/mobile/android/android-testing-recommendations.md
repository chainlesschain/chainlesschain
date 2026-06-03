# Android 测试完善建议

## 测试覆盖现状

### ✅ 已完成的测试（6个文件，~65个用例）

1. **Unit Tests (3个)**
   - `DIDSignerTest.kt` - DID签名和验证（18个用例）✅
   - `OfflineCommandQueueTest.kt` - 离线命令队列（25个用例）✅
   - `P2PClientTest.kt` - P2P客户端（22个用例）✅

2. **E2E Tests**
   - `AppE2ETestSuite.kt` - 端到端测试套件（42个用例）✅
   - 覆盖知识库、AI对话、社交、P2P通信、项目管理

---

## 优先级测试补充计划

### 🔴 Phase 1: WebRTC层（建议使用集成测试）

**问题：** WebRTC 依赖 Native 库，纯单元测试难度较高

**建议方案：**

1. **集成测试** - 使用真实 WebRTC 库在设备上测试
2. **接口测试** - 测试 `SignalClient` 接口实现（WebSocket通信）
3. **简化单元测试** - 测试 WebRTC 之外的业务逻辑

**创建文件：**

```kotlin
// 集成测试（推荐）
android-app/app/src/androidTest/java/com/chainlesschain/android/remote/webrtc/
├── WebRTCClientIntegrationTest.kt   // 真实设备集成测试
└── SignalClientTest.kt              // WebSocket信令测试

// 单元测试（可选）
android-app/app/src/test/java/com/chainlesschain/android/remote/webrtc/
└── SignalingDiscoveryServiceTest.kt // mDNS发现测试（Mock网络）
```

---

### 🟠 Phase 2: Commands层（高优先级）

**测试用例：** ~38个

```kotlin
android-app/app/src/test/java/com/chainlesschain/android/remote/commands/
├── AICommandsTest.kt            // 10个用例
│   ├── buildAIChatRequest() 测试
│   ├── buildRAGSearchRequest() 测试
│   ├── buildAgentControlRequest() 测试
│   └── 参数验证测试
│
├── DesktopCommandsTest.kt       // 12个用例
│   ├── buildGetScreenshotRequest() 测试
│   ├── buildGetSystemInfoRequest() 测试
│   ├── buildExecuteCommandRequest() 测试
│   ├── buildBrowserControlRequest() 测试（新增）
│   └── 参数验证和序列化测试
│
├── FileCommandsTest.kt          // 10个用例
│   ├── buildUploadFileRequest() 测试
│   ├── buildDownloadFileRequest() 测试
│   ├── buildListFilesRequest() 测试
│   ├── 分块传输参数测试
│   └── 文件路径验证测试
│
└── SystemCommandsTest.kt        // 6个用例
    ├── buildGetStatusRequest() 测试
    ├── buildNotifyRequest() 测试
    ├── buildHeartbeatRequest() 测试
    └── 参数验证测试
```

**估计时间：** 2-3天

---

### 🟡 Phase 3: Repository层（中优先级）

**测试用例：** ~26个

```kotlin
android-app/app/src/test/java/com/chainlesschain/android/remote/data/
├── CommandHistoryRepositoryTest.kt      // 8个用例
│   ├── insertCommand() 测试
│   ├── getRecentCommands() 分页测试
│   ├── searchCommands() 搜索测试
│   ├── deleteOldCommands() 清理测试
│   └── Flow数据流测试
│
├── FileTransferRepositoryTest.kt        // 10个用例
│   ├── saveTransfer() 保存测试
│   ├── updateProgress() 进度更新测试
│   ├── getActiveTransfers() 查询测试
│   ├── cancelTransfer() 取消测试
│   ├── resumeTransfer() 断点续传测试
│   └── 并发操作测试
│
└── RegisteredDeviceRepositoryTest.kt    // 8个用例
    ├── addDevice() 添加测试
    ├── getDevices() 查询测试
    ├── updateDeviceStatus() 更新测试
    ├── removeDevice() 删除测试
    ├── isRegistered() 检查测试
    └── Flow数据流测试
```

**估计时间：** 2天

---

### 🟢 Phase 4: ViewModel层（低优先级，UI逻辑）

**测试用例：** ~110个

```kotlin
android-app/app/src/test/java/com/chainlesschain/android/remote/ui/
├── RemoteControlViewModelTest.kt        // 15个用例
├── RemoteAIChatViewModelTest.kt         // 12个用例
├── RemoteRAGSearchViewModelTest.kt      // 10个用例
├── RemoteAgentControlViewModelTest.kt   // 10个用例
├── RemoteDesktopViewModelTest.kt        // 12个用例
├── FileTransferViewModelTest.kt         // 12个用例
├── CommandHistoryViewModelTest.kt       // 8个用例
├── RemoteScreenshotViewModelTest.kt     // 8个用例
├── SystemMonitorViewModelTest.kt        // 10个用例
├── DeviceListViewModelTest.kt           // 8个用例
└── DeviceScanViewModelTest.kt           // 5个用例
```

**ViewModel测试模板：**

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class SomeViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private lateinit var viewModel: SomeViewModel
    private lateinit var mockRepository: SomeRepository

    @Before
    fun setup() {
        mockRepository = mockk(relaxed = true)
        viewModel = SomeViewModel(mockRepository)
    }

    @Test
    fun `test UI state updates`() = runTest {
        // Given
        val testData = ...
        coEvery { mockRepository.getData() } returns testData

        // When
        viewModel.loadData()

        // Then
        assertEquals(testData, viewModel.uiState.value.data)
    }
}
```

**估计时间：** 1-2周

---

## 测试工具和依赖

### 已有依赖（build.gradle.kts）

```kotlin
dependencies {
    // 核心测试库
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.8")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")

    // Android测试
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")

    // E2E测试
    androidTestImplementation("io.mockk:mockk-android:1.13.8")
}
```

### 推荐添加（用于ViewModel测试）

```kotlin
testImplementation("app.cash.turbine:turbine:1.0.0")           // Flow测试
testImplementation("androidx.arch.core:core-testing:2.2.0")    // LiveData/ViewModel测试
```

---

## 快速开始示例

### 示例1: AICommandsTest.kt

```kotlin
package com.chainlesschain.android.remote.commands

import io.mockk.*
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

class AICommandsTest {

    private lateinit var aiCommands: AICommands

    @Before
    fun setup() {
        aiCommands = AICommands()
    }

    @Test
    fun `buildAIChatRequest should create valid JSON-RPC request`() {
        // Given
        val message = "Hello, AI!"
        val model = "qwen2:7b"

        // When
        val request = aiCommands.buildAIChatRequest(message, model)

        // Then
        assertEquals("ai.chat", request.method)
        assertEquals(message, request.params["message"])
        assertEquals(model, request.params["model"])
        assertNotNull(request.auth)
    }

    @Test
    fun `buildRAGSearchRequest should include query and topK`() {
        // Given
        val query = "Search query"
        val topK = 5

        // When
        val request = aiCommands.buildRAGSearchRequest(query, topK)

        // Then
        assertEquals("ai.ragSearch", request.method)
        assertEquals(query, request.params["query"])
        assertEquals(topK, request.params["topK"])
    }
}
```

### 示例2: CommandHistoryRepositoryTest.kt

```kotlin
package com.chainlesschain.android.remote.data

import app.cash.turbine.test
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class CommandHistoryRepositoryTest {

    private lateinit var repository: CommandHistoryRepository
    private lateinit var mockDao: CommandHistoryDao

    @Before
    fun setup() {
        mockDao = mockk(relaxed = true)
        repository = CommandHistoryRepository(mockDao)
    }

    @Test
    fun `insertCommand should save to database`() = runTest {
        // Given
        val command = CommandHistoryEntity(
            id = "cmd-123",
            method = "ai.chat",
            timestamp = System.currentTimeMillis(),
            status = "success"
        )

        coEvery { mockDao.insert(any()) } just Runs

        // When
        repository.insertCommand(command)

        // Then
        coVerify { mockDao.insert(command) }
    }

    @Test
    fun `getRecentCommands should return commands from DAO`() = runTest {
        // Given
        val mockCommands = listOf(
            CommandHistoryEntity("1", "ai.chat", 1000L, "success"),
            CommandHistoryEntity("2", "system.status", 2000L, "success")
        )

        coEvery { mockDao.getRecent(50) } returns mockCommands

        // When
        val result = repository.getRecentCommands(50)

        // Then
        assertEquals(2, result.size)
        assertEquals("ai.chat", result[0].method)
    }

    @Test
    fun `getCommandsFlow should emit updates`() = runTest {
        // Given
        val flow = flowOf(
            listOf(CommandHistoryEntity("1", "test", 1000L, "success"))
        )
        every { mockDao.getCommandsFlow() } returns flow

        // When/Then
        repository.getCommandsFlow().test {
            val items = awaitItem()
            assertEquals(1, items.size)
            awaitComplete()
        }
    }
}
```

---

## 运行测试命令

```bash
# 运行所有单元测试
./gradlew :app:testDebugUnitTest

# 运行特定测试类
./gradlew :app:testDebugUnitTest --tests "com.chainlesschain.android.remote.commands.AICommandsTest"

# 运行所有集成测试（真机/模拟器）
./gradlew :app:connectedDebugAndroidTest

# 生成测试覆盖率报告
./gradlew :app:jacocoTestReport

# 查看覆盖率报告
open app/build/reports/jacoco/jacocoTestReport/html/index.html
```

---

## 预期测试覆盖率提升

| 层级            | 当前覆盖率 | Phase 1后 | Phase 2后 | Phase 3后 | Phase 4后 |
| --------------- | ---------- | --------- | --------- | --------- | --------- |
| **Unit Tests**  | ~25%       | ~35%      | **70%**   | **80%**   | **90%+**  |
| **Integration** | 0%         | **60%**   | **65%**   | **70%**   | **75%**   |
| **E2E Tests**   | 80%        | 82%       | 85%       | 88%       | **92%+**  |
| **总体覆盖率**  | ~35%       | ~50%      | ~70%      | ~78%      | **85%+**  |

---

## 已修复的问题

1. ✅ `DiscoveredDevice` 缺少 `did` 字段
2. ✅ `DeviceListScreen` lambda 参数类型推断问题
3. ✅ `DeviceScanScreen` lambda 参数类型推断问题
4. ✅ `RemoteControlViewModel` 缺少 `isActive` 导入

---

## 下一步行动

### 立即可做（Phase 2优先）

1. **创建 AICommandsTest.kt**

   ```bash
   cd android-app/app/src/test/java/com/chainlesschain/android/remote/commands
   # 复制上面的示例代码
   ```

2. **创建 DesktopCommandsTest.kt**
3. **创建 FileCommandsTest.kt**
4. **创建 SystemCommandsTest.kt**

### 后续（Phase 3-4）

5. **创建 Repository 层测试**
6. **创建 ViewModel 层测试**

---

## 总结

- **当前测试用例：** 107个（65 unit + 42 E2E）
- **完成后测试用例：** ~400个
- **当前覆盖率：** ~35%
- **完成后覆盖率：** **85%+**
- **预计总时间：** 4-6周（按优先级逐步完成）

建议从 **Phase 2 (Commands层)** 开始，因为它们是业务逻辑核心且易于测试！
