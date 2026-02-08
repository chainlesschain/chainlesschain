# 远程控制模块编译问题快速修复指南

## 问题概述

远程控制模块编译失败，主要原因：

1. **WebRTC 依赖缺失** - `WebRTCClient.kt` 无法找到 WebRTC 相关类
2. **Compose API 兼容性问题** - 部分 API 在新版本中已过时或更改

---

## 方案 1：暂时禁用远程控制模块（推荐用于快速测试）

### 步骤 1：禁用远程控制相关文件

```bash
# 已完成的操作：
# - WebRTCClient.kt 已重命名为 WebRTCClient.kt.disabled
# - P2PClientWithWebRTC.kt 已注释掉

# 还需要禁用的文件：
cd android-app/app/src/main/java/com/chainlesschain/android/remote

# 禁用远程控制 UI 组件
mv ui/RemoteControlScreen.kt ui/RemoteControlScreen.kt.disabled
mv ui/ai/RemoteAgentControlScreen.kt ui/ai/RemoteAgentControlScreen.kt.disabled
mv ui/desktop/RemoteDesktopScreen.kt ui/desktop/RemoteDesktopScreen.kt.disabled
mv ui/history/CommandHistoryScreen.kt ui/history/CommandHistoryScreen.kt.disabled
mv ui/system/SystemMonitorScreen.kt ui/system/SystemMonitorScreen.kt.disabled
```

### 步骤 2：更新导航文件

编辑 `NavGraph.kt`，注释掉远程控制相关的路由：

```kotlin
// 注释掉以下代码块：

// 远程控制主界面
/*
composable(route = Screen.RemoteControl.route) {
    com.chainlesschain.android.remote.ui.RemoteControlScreen(
        onNavigateToAIChat = { navController.navigate(Screen.RemoteAIChat.route) },
        // ... 其他导航
    )
}

// 远程 AI 对话界面
composable(route = Screen.RemoteAIChat.route) {
    // ...
}

// ... 其他远程控制路由
*/
```

### 步骤 3：更新 MainContainer

编辑 `MainContainer.kt`，移除远程控制导航参数：

```kotlin
// 注释掉：
// onNavigateToRemoteControl: () -> Unit = {},

// 在 NewHomeScreen 调用中：
// onNavigateToRemoteControl = onNavigateToRemoteControl  // 注释这行
```

### 步骤 4：更新首页

编辑 `NewHomeScreen.kt`，移除远程控制卡片：

```kotlin
// 在 FunctionEntryGrid 中，将远程控制改为占位：
FunctionEntryItem(
    "远程控制",
    Icons.Outlined.Computer,
    Color(0xFFFF5722),
    onClick = { /* TODO: 待 WebRTC 依赖完成后启用 */ }
)
```

---

## 方案 2：完整修复远程控制模块（用于长期开发）

### 步骤 1：添加 WebRTC 依赖

编辑 `android-app/app/build.gradle.kts`，添加：

```kotlin
dependencies {
    // WebRTC
    implementation("org.webrtc:google-webrtc:1.0.32006")

    // 或者使用 Stream 提供的版本：
    implementation("io.getstream:stream-webrtc-android:1.0.4")

    // 现有依赖...
}
```

### 步骤 2：添加相机和网络权限

编辑 `AndroidManifest.xml`：

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />

<!-- WebRTC 相关特性 -->
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

### 步骤 3：修复 Compose API 兼容性问题

#### 3.1 修复 `RemoteAgentControlScreen.kt` (line 408)

```kotlin
// 旧代码：
.background(Color.LightGray)

// 新代码：
.background(MaterialTheme.colorScheme.surfaceVariant)
```

#### 3.2 修复 `RemoteDesktopScreen.kt` (lines 308-309)

```kotlin
// 旧代码：
Image(
    painter = painter,
    contentDescription = "远程桌面",
    dstOffset = IntOffset(offsetX, offsetY),
    dstSize = IntSize(scaledWidth, scaledHeight)
)

// 新代码：
Image(
    painter = painter,
    contentDescription = "远程桌面",
    contentScale = ContentScale.Fit,
    modifier = Modifier
        .offset { IntOffset(offsetX, offsetY) }
        .size(scaledWidth.dp, scaledHeight.dp)
)
```

#### 3.3 修复 `RemoteDesktopViewModel.kt` (line 392)

在文件顶部添加实验性特性启用：

```kotlin
@OptIn(ExperimentalContracts::class)
```

或者移除 `return@` 语句，使用标准控制流。

#### 3.4 修复 `CommandHistoryScreen.kt` (line 25)

添加 Paging 3 依赖：

```kotlin
// 在 build.gradle.kts 中：
implementation("androidx.paging:paging-compose:3.2.1")
```

然后更新代码：

```kotlin
// 导入：
import androidx.paging.compose.collectAsLazyPagingItems
import androidx.paging.compose.items

// 使用：
val lazyPagingItems = viewModel.commandHistory.collectAsLazyPagingItems()

LazyColumn {
    items(
        count = lazyPagingItems.itemCount,
        key = { index -> lazyPagingItems[index]?.id ?: index }
    ) { index ->
        val item = lazyPagingItems[index]
        item?.let {
            CommandHistoryItem(
                command = it,
                onCommandClick = { /* ... */ }
            )
        }
    }
}
```

#### 3.5 修复 `SystemMonitorScreen.kt` (lines 289, 295)

```kotlin
// 旧代码：
.background(Color.Green)

// 新代码：
.background(MaterialTheme.colorScheme.primary)
```

### 步骤 4：恢复被禁用的文件

```bash
# 恢复 WebRTCClient
mv WebRTCClient.kt.disabled WebRTCClient.kt

# 取消注释 P2PClientWithWebRTC.kt 中的代码
```

### 步骤 5：清理并重新编译

```bash
cd android-app
./gradlew clean
./gradlew assembleDebug
```

---

## 方案 3：最小化远程控制功能（折中方案）

如果完整的 WebRTC 功能太复杂，可以实现一个简化版本：

### 步骤 1：创建 Mock RemoteControlScreen

```kotlin
// RemoteControlScreen.kt (简化版)
@Composable
fun RemoteControlScreen(
    onNavigateBack: () -> Unit = {}
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("远程控制") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = Icons.Default.Computer,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "远程控制功能",
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "该功能需要 WebRTC 支持，正在开发中...",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(24.dp))

            OutlinedButton(
                onClick = { /* TODO: 打开设置页面 */ }
            ) {
                Text("配置远程连接")
            }
        }
    }
}
```

### 步骤 2：更新路由使用简化版

在 `NavGraph.kt` 中使用简化版的 RemoteControlScreen。

---

## 推荐方案

**对于当前的 E2E 测试需求**：

- 推荐使用 **方案 1**（暂时禁用），快速完成其他核心功能的测试

**对于长期开发**：

- 推荐使用 **方案 2**（完整修复），提供完整的远程控制功能

**对于演示和原型**：

- 推荐使用 **方案 3**（最小化实现），保留功能入口但暂不实现复杂逻辑

---

## 验证步骤

### 方案 1 验证

```bash
cd android-app
./gradlew clean assembleDebug

# 期望输出：
# BUILD SUCCESSFUL
```

### 方案 2 验证

```bash
cd android-app
./gradlew clean assembleDebug

# 期望输出：
# BUILD SUCCESSFUL

# 然后运行应用，测试远程控制功能：
# 1. 进入首页
# 2. 点击"远程控制"
# 3. 尝试连接桌面端
# 4. 测试各子功能
```

### 方案 3 验证

```bash
cd android-app
./gradlew assembleDebug

# 期望输出：
# BUILD SUCCESSFUL

# 运行应用，验证：
# 1. 远程控制入口可点击
# 2. 显示占位界面
# 3. 不会崩溃
```

---

## 常见问题

### Q1: WebRTC 依赖太大，APK 体积增加怎么办？

**A**: 可以使用应用分包 (App Bundle) 或动态功能模块 (Dynamic Feature Module)，将远程控制功能作为可选模块。

### Q2: WebRTC 在某些设备上不支持怎么办？

**A**: 添加运行时检测，如果设备不支持 WebRTC，显示提示信息并禁用相关功能。

```kotlin
fun isWebRTCSupported(): Boolean {
    return try {
        Class.forName("org.webrtc.PeerConnectionFactory")
        true
    } catch (e: ClassNotFoundException) {
        false
    }
}
```

### Q3: 远程控制需要哪些测试？

**A**:

1. 连接测试 - 验证 WebRTC 连接建立
2. 数据传输测试 - 验证命令发送和响应接收
3. 断线重连测试 - 验证网络中断后的恢复机制
4. 并发测试 - 验证多个命令同时执行
5. 性能测试 - 验证延迟和吞吐量

---

## 相关资源

- [WebRTC Android 官方文档](https://webrtc.org/native-code/android/)
- [Stream WebRTC Android SDK](https://getstream.io/video/docs/android/)
- [Jetpack Compose 迁移指南](https://developer.android.com/jetpack/compose/migrate)
- [Paging 3 Compose 集成](https://developer.android.com/topic/libraries/architecture/paging/v3-compose)

---

## 联系支持

如果在修复过程中遇到问题，请：

1. 查看详细的编译日志 (`./gradlew assembleDebug --stacktrace`)
2. 检查依赖冲突 (`./gradlew app:dependencies`)
3. 提交 Issue 到项目仓库，附上错误信息和环境描述
