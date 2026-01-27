# 远程控制系统集成指南

本指南详细说明如何在 ChainlessChain 项目中集成远程控制系统。

---

## 目录

1. [前置要求](#前置要求)
2. [PC 端集成](#pc-端集成)
3. [Android 端集成](#android-端集成)
4. [测试验证](#测试验证)
5. [故障排查](#故障排查)

---

## 前置要求

### PC 端

- ✅ P2P 网络已初始化（`p2pManager`）
- ✅ DID 管理器已初始化（`didManager`）
- ✅ 数据库已初始化（`database`）
- ⚠️ U-Key 管理器（可选，`ukeyManager`）
- ⚠️ AI 引擎（可选，`aiEngine`）
- ⚠️ RAG 管理器（可选，`ragManager`）

### Android 端

- ✅ Hilt 依赖注入配置完成
- ✅ Kotlin Serialization 配置完成
- ✅ 网络权限已声明

---

## PC 端集成

### 步骤 1: 在主进程中初始化远程控制系统

编辑 `desktop-app-vue/src/main/index.js`:

```javascript
const { app, BrowserWindow } = require('electron');
const { initializeRemoteControl, shutdownRemoteControl } = require('./remote/integration-example');
const { registerRemoteIPCHandlers } = require('./remote/remote-ipc');
const { logger } = require('./utils/logger');

let mainWindow = null;
let remoteGateway = null;

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadURL('http://localhost:5173');
}

// 应用就绪后初始化
app.whenReady().then(async () => {
  try {
    // 1. 创建主窗口
    createWindow();

    // 2. 初始化数据库
    const { initializeDatabase } = require('./database');
    await initializeDatabase();

    // 3. 初始化 DID 管理器
    const DIDManager = require('./did/did-manager');
    const { getDatabase } = require('./database');
    global.didManager = new DIDManager(getDatabase());
    await global.didManager.initialize();

    // 4. 初始化 P2P 网络
    const P2PManager = require('./p2p/p2p-manager');
    global.p2pManager = new P2PManager({
      port: 9000,
      dataPath: app.getPath('userData')
    });
    await global.p2pManager.start();

    // 5. 初始化 U-Key（可选）
    try {
      const UKeyManager = require('./ukey/ukey-manager');
      global.ukeyManager = new UKeyManager();
      await global.ukeyManager.initialize();
      logger.info('[Main] U-Key 管理器已初始化');
    } catch (error) {
      logger.warn('[Main] U-Key 初始化失败（将继续运行）:', error.message);
      global.ukeyManager = null;
    }

    // 6. 初始化远程控制系统 ⭐ 核心步骤
    remoteGateway = await initializeRemoteControl(app, mainWindow);

    // 7. 注册 IPC 处理器
    registerRemoteIPCHandlers(remoteGateway);

    logger.info('[Main] ✅ 所有系统初始化完成');

  } catch (error) {
    logger.error('[Main] ❌ 初始化失败:', error);
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', async () => {
  logger.info('[Main] 应用即将退出，清理资源...');

  // 关闭远程控制系统
  await shutdownRemoteControl();

  // 关闭 P2P 网络
  if (global.p2pManager) {
    await global.p2pManager.stop();
  }
});

// 所有窗口关闭时
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### 步骤 2: 添加路由（Vue Router）

编辑 `desktop-app-vue/src/renderer/router/index.js`:

```javascript
import { createRouter, createWebHashHistory } from 'vue-router'
import RemoteControl from '../pages/RemoteControl.vue'

const routes = [
  // ... 其他路由
  {
    path: '/remote-control',
    name: 'RemoteControl',
    component: RemoteControl,
    meta: {
      title: '远程控制',
      requiresAuth: true
    }
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
```

### 步骤 3: 添加导航菜单

编辑主布局文件，添加远程控制入口：

```vue
<template>
  <a-menu-item key="remote-control">
    <router-link to="/remote-control">
      <MobileOutlined />
      <span>远程控制</span>
    </router-link>
  </a-menu-item>
</template>
```

---

## Android 端集成

### 步骤 1: 添加依赖

编辑 `android-app/app/build.gradle.kts`:

```kotlin
dependencies {
    // Kotlin Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Hilt DI
    implementation("com.google.dagger:hilt-android:2.50")
    kapt("com.google.dagger:hilt-compiler:2.50")

    // Timber
    implementation("com.jakewharton.timber:timber:5.0.1")
}
```

### 步骤 2: 配置 Hilt 模块

创建 `RemoteModule.kt`:

```kotlin
package com.chainlesschain.android.di

import com.chainlesschain.android.remote.client.RemoteCommandClient
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.SystemCommands
import com.chainlesschain.android.remote.crypto.*
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object RemoteModule {

    @Provides
    @Singleton
    fun provideDIDKeyStore(): DIDKeyStore {
        return AndroidDIDKeyStore()
    }

    @Provides
    @Singleton
    fun provideDIDSigner(keyStore: DIDKeyStore): DIDSigner {
        return DIDSigner(keyStore)
    }

    @Provides
    @Singleton
    fun provideRemoteDIDManager(
        context: Context,
        didSigner: DIDSigner,
        keyStore: DIDKeyStore
    ): RemoteDIDManager {
        return RemoteDIDManager(context, didSigner, keyStore)
    }

    @Provides
    @Singleton
    fun provideSignalClient(): SignalClient {
        // TODO: 实现实际的 SignalClient
        return object : SignalClient {}
    }

    @Provides
    @Singleton
    fun provideP2PClient(
        didManager: RemoteDIDManager,
        signalClient: SignalClient
    ): P2PClient {
        return P2PClient(didManager, signalClient)
    }

    @Provides
    @Singleton
    fun provideRemoteCommandClient(p2pClient: P2PClient): RemoteCommandClient {
        return RemoteCommandClient(p2pClient)
    }

    @Provides
    @Singleton
    fun provideAICommands(client: RemoteCommandClient): AICommands {
        return AICommands(client)
    }

    @Provides
    @Singleton
    fun provideSystemCommands(client: RemoteCommandClient): SystemCommands {
        return SystemCommands(client)
    }
}
```

### 步骤 3: 在 Application 中初始化

编辑 `MainApplication.kt`:

```kotlin
@HiltAndroidApp
class MainApplication : Application() {

    @Inject
    lateinit var remoteDIDManager: RemoteDIDManager

    override fun onCreate() {
        super.onCreate()

        // 初始化 Timber
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }

        // 初始化 DID 管理器
        lifecycleScope.launch {
            remoteDIDManager.initialize()
                .onSuccess {
                    Timber.d("DID 管理器初始化成功")
                }
                .onFailure { error ->
                    Timber.e(error, "DID 管理器初始化失败")
                }
        }
    }
}
```

### 步骤 4: 创建 ViewModel

创建 `RemoteControlViewModel.kt`:

```kotlin
@HiltViewModel
class RemoteControlViewModel @Inject constructor(
    private val p2pClient: P2PClient,
    private val aiCommands: AICommands,
    private val systemCommands: SystemCommands
) : ViewModel() {

    val connectionState = p2pClient.connectionState.asStateFlow()
    val connectedPeer = p2pClient.connectedPeer.asStateFlow()

    private val _systemStatus = MutableStateFlow<SystemStatus?>(null)
    val systemStatus = _systemStatus.asStateFlow()

    // 连接到 PC
    fun connectToPC(pcPeerId: String, pcDID: String) {
        viewModelScope.launch {
            val result = p2pClient.connect(pcPeerId, pcDID)

            if (result.isSuccess) {
                Timber.d("连接成功")
                // 自动获取系统状态
                fetchSystemStatus()
            } else {
                Timber.e("连接失败: ${result.exceptionOrNull()}")
            }
        }
    }

    // 断开连接
    fun disconnect() {
        p2pClient.disconnect()
    }

    // 获取系统状态
    fun fetchSystemStatus() {
        viewModelScope.launch {
            val result = systemCommands.getStatus()

            result.onSuccess { status ->
                _systemStatus.value = status
            }

            result.onFailure { error ->
                Timber.e(error, "获取系统状态失败")
            }
        }
    }

    // AI 对话
    suspend fun sendChatMessage(message: String): Result<ChatResponse> {
        return aiCommands.chat(message)
    }

    // 截图
    suspend fun takeScreenshot(): Result<ScreenshotResponse> {
        return systemCommands.screenshot()
    }
}
```

### 步骤 5: 创建 UI（Jetpack Compose）

创建 `RemoteControlScreen.kt`:

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
                    ConnectionStatusIndicator(connectionState)
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
            ConnectionCard(
                connectionState = connectionState,
                onConnect = { peerId, did ->
                    viewModel.connectToPC(peerId, did)
                },
                onDisconnect = { viewModel.disconnect() }
            )

            // 系统状态
            if (connectionState == ConnectionState.CONNECTED && systemStatus != null) {
                SystemStatusCard(systemStatus!!)

                // 快捷操作
                QuickActionsCard(viewModel)
            }
        }
    }
}
```

---

## 测试验证

### 1. PC 端测试

启动 PC 端应用：

```bash
cd desktop-app-vue
npm run dev
```

检查日志：
```
[RemoteControl] 开始初始化远程控制系统...
[P2PCommandAdapter] 初始化 P2P 命令适配器...
[PermissionGate] 初始化权限验证器...
[CommandRouter] 初始化命令路由器...
[RemoteGateway] ✅ 远程网关初始化完成
```

访问远程控制页面：
```
http://localhost:5173/#/remote-control
```

### 2. Android 端测试

构建并运行 Android 应用：

```bash
cd android-app
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

检查日志：
```
D/RemoteDIDManager: 初始化 DID 管理器
D/RemoteDIDManager: DID 管理器初始化完成: did:chainlesschain:abc123
D/P2PClient: 开始连接 PC 节点: peer-xyz
D/P2PClient: ✅ 连接成功: peer-xyz
```

### 3. 端到端测试

**测试场景 1: 获取 PC 系统状态**

Android 端代码：
```kotlin
val result = systemCommands.getStatus()

result.onSuccess { status ->
    println("CPU 使用率: ${status.cpu.usage}%")
    println("内存使用率: ${status.memory.usagePercent}%")
}
```

预期输出：
```
CPU 使用率: 25.5%
内存使用率: 60.2%
```

**测试场景 2: AI 对话**

Android 端代码：
```kotlin
val result = aiCommands.chat("你好，PC")

result.onSuccess { response ->
    println("AI 回复: ${response.reply}")
}
```

预期输出：
```
AI 回复: 收到您的消息："你好，PC"。这是来自 PC 端的模拟回复。
```

**测试场景 3: 权限验证**

1. Android 端发送高权限命令（execCommand）
2. PC 端拒绝（设备权限为 Level 2，命令需要 Level 3）
3. PC 端记录审计日志

预期日志：
```
[PermissionGate] 验证失败: 权限不足 (需要: 3, 当前: 2)
```

---

## 故障排查

### 问题 1: P2P 连接失败

**症状**：Android 无法连接到 PC

**检查清单**：
1. ✅ PC 端 P2P 网络是否启动
2. ✅ 两台设备是否在同一局域网
3. ✅ 防火墙是否阻止端口 9000
4. ✅ Signal 服务器是否运行（port 9001）

**解决方案**：
```bash
# 检查 P2P 端口
netstat -an | grep 9000

# 检查 Signal 服务器
netstat -an | grep 9001
```

### 问题 2: 命令权限被拒绝

**症状**：命令返回 "Permission Denied"

**检查清单**：
1. ✅ 设备权限级别是否足够
2. ✅ DID 签名是否正确
3. ✅ 时间戳是否在有效期内

**解决方案**：
```javascript
// PC 端提升设备权限
await gateway.setDevicePermission(did, 3, {
  deviceName: 'My Phone',
  grantedBy: 'admin'
});
```

### 问题 3: 命令超时

**症状**：命令执行超过 30 秒无响应

**检查清单**：
1. ✅ 网络连接是否稳定
2. ✅ PC 端是否处理命令
3. ✅ 命令是否耗时过长

**解决方案**：
```kotlin
// 增加超时时间
val result = client.invoke<T>(
    method = "slow.command",
    params = params,
    timeout = 60000  // 60 秒
)
```

### 问题 4: DID 签名验证失败

**症状**："Invalid signature"

**检查清单**：
1. ✅ Android 端和 PC 端 DID 是否一致
2. ✅ 签名算法是否匹配
3. ✅ 签名数据格式是否正确

**解决方案**：
```kotlin
// Android 端检查签名数据
val signData = mapOf(
    "method" to method,
    "timestamp" to timestamp,
    "nonce" to nonce
)
val signDataJson = signData.toJsonString()
println("签名数据: $signDataJson")
```

---

## 下一步

集成完成后，你可以：

1. ✅ 添加更多命令处理器（文件、知识库、浏览器）
2. ✅ 实现 WebRTC 完整集成
3. ✅ 添加离线消息队列
4. ✅ 编写单元测试和集成测试
5. ✅ 进入 Phase 2：远程命令系统

---

## 相关文档

- [Phase 1 进度报告](./PHASE1_PROGRESS_REPORT.md)
- [PC 端使用指南](../../desktop-app-vue/src/main/remote/README.md)
- [Android 端使用指南](../../android-app/app/src/main/java/com/chainlesschain/android/remote/README.md)
- [Clawdbot 实施计划 v2.0](./CLAWDBOT_IMPLEMENTATION_PLAN_V2.md)
