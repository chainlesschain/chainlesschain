# Android远程控制连接修复指南

## 问题诊断结果

**根本原因**：SignalClient使用了错误的服务器地址

### 发现的问题

1. **feature-p2p模块被禁用** - 导致SignalClient只有空的stub实现
2. **WebSocketSignalingClient硬编码错误的URL** - 使用`wss://signal.chainlesschain.com/ws`，而不是本地服务器

## 已完成的修改

### 1. 启用feature-p2p模块

**文件**: `android-app/settings.gradle.kts`

```kotlin
// 已修改（第49行）：
include(":feature-p2p") // Re-enabled to fix SignalClient connection issue
```

### 2. 修复WebSocketSignalingClient

**文件**: `android-app/feature-p2p/src/main/java/com/chainlesschain/android/feature/p2p/webrtc/signaling/WebSocketSignalingClient.kt`

**修改1** - 构造函数注入SignalingConfig（第27-30行）：
```kotlin
@Singleton
class WebSocketSignalingClient @Inject constructor(
    private val okHttpClient: OkHttpClient,
    private val json: Json,
    private val signalingConfig: com.chainlesschain.android.remote.config.SignalingConfig
) : SignalingClient {
```

**修改2** - 使用配置的URL（第62-75行）：
```kotlin
override suspend fun connect(userId: String, token: String): Result<Unit> {
    return withContext(Dispatchers.IO) {
        try {
            this@WebSocketSignalingClient.userId = userId
            this@WebSocketSignalingClient.token = token

            _connectionState.value = ConnectionState.CONNECTING

            // Use configured signaling URL instead of hardcoded
            val signalingUrl = signalingConfig.getSignalingUrl()
            Timber.d("Connecting to signaling server: $signalingUrl")

            val request = Request.Builder()
                .url(signalingUrl)
                .addHeader("Authorization", "Bearer $token")
                .addHeader("X-User-Id", userId)
                .build()

            webSocket = okHttpClient.newWebSocket(request, createWebSocketListener())

            Result.success(Unit)
        } catch (e: Exception) {
            Timber.e(e, "Failed to connect to signaling server")
            _connectionState.value = ConnectionState.FAILED
            Result.failure(e)
        }
    }
}
```

### 3. SignalingConfig已配置

**文件**: `android-app/app/src/main/java/com/chainlesschain/android/remote/config/SignalingConfig.kt`

```kotlin
const val DEFAULT_SIGNALING_URL = "ws://192.168.3.59:9001" // 真实设备访问PC局域网IP
```

## 编译指南

### 方案1：Android Studio（推荐）

1. 打开Android Studio
2. 打开项目：`File -> Open -> android-app`
3. 等待Gradle同步完成
4. 点击 `Build -> Build Bundle(s) / APK(s) -> Build APK(s)`
5. APK位置：`android-app/app/build/outputs/apk/debug/app-debug.apk`

### 方案2：命令行（如果AS失败）

```bash
cd android-app

# 停止Gradle守护进程
./gradlew --stop

# 清理（可选）
rm -rf .gradle build app/build

# 构建
./gradlew assembleDebug
```

### 方案3：使用之前的APK（临时）

如果有之前编译好的APK，可以手动修改SignalingConfig：

1. 在Android Studio中打开项目
2. 编辑 `SignalingConfig.kt` 中的 `DEFAULT_SIGNALING_URL`
3. 只构建这一个文件的更改
4. 使用Instant Run/Apply Changes

## 安装和测试

```bash
# 安装APK
adb install -r android-app/app/build/outputs/apk/debug/app-debug.apk

# 启动应用
adb shell am start -n com.chainlesschain.android.debug/com.chainlesschain.android.MainActivity

# 查看日志
adb logcat | grep -E "Signal|WebRTC|P2P|Connection"
```

## 预期结果

修复后，应用应该：
1. ✅ 连接到本地信令服务器 `ws://192.168.3.59:9001`
2. ✅ 显示"正在连接..."而不是立即报错
3. ✅ 在日志中看到"Connecting to signaling server: ws://192.168.3.59:9001"

## 故障排查

如果仍然无法连接：

1. **检查PC信令服务器**
   ```bash
   netstat -ano | findstr ":9001"
   ```
   应该看到LISTENING状态

2. **检查网络连通性**
   ```bash
   ping 192.168.3.59
   ```

3. **查看Android日志**
   ```bash
   adb logcat -c
   adb logcat | grep -E "SignalingClient|WebSocketSignalingClient"
   ```

4. **验证IP地址**
   - 确保手机和PC在同一WiFi网络
   - 确认PC的实际IP地址：`ipconfig`

## 技术细节

### 连接流程

1. Android应用启动RemoteControlViewModel
2. 调用P2PClient.connect()
3. P2PClient调用WebRTCClient.connect()
4. WebRTCClient调用SignalClient（现在是WebSocketSignalingClient）
5. WebSocketSignalingClient连接到配置的信令服务器
6. 建立WebSocket连接
7. 交换WebRTC offer/answer
8. 建立P2P数据通道

### 关键类

- `SignalingConfig` - 服务器配置
- `WebSocketSignalingClient` - WebSocket信令客户端实现
- `WebRTCClient` - WebRTC连接管理
- `P2PClient` - P2P客户端封装
- `RemoteControlViewModel` - 远程控制UI逻辑

## 附加信息

- **信令服务器端口**: 9001
- **协议**: WebSocket (ws://)
- **PC IP**: 192.168.3.59
- **包名**: com.chainlesschain.android.debug
- **主Activity**: com.chainlesschain.android.MainActivity
