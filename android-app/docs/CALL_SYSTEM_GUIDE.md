# WebRTC 通话系统使用指南

## 概述

ChainlessChain Android 应用的 WebRTC 通话系统实现了基于 P2P 网络的端到端加密音视频通话功能。

**版本**: v0.32.0
**模块**: `feature-p2p`
**技术栈**: WebRTC, libp2p, Jetpack Compose

---

## 功能特性

### ✅ 已实现功能

1. **音频通话**
   - 实时语音通话
   - 麦克风静音/取消静音
   - 扬声器/听筒切换
   - 通话时长显示

2. **视频通话**
   - 实时视频通话
   - 前置/后置摄像头切换
   - 本地预览（小窗）
   - 远程画面（全屏）

3. **通话管理**
   - 发起通话
   - 接听/拒绝通话
   - 挂断通话
   - 通话状态管理

4. **信令系统**
   - 基于 P2P 网络的信令传输
   - Offer/Answer SDP 交换
   - ICE 候选收集和交换
   - 端到端加密

5. **用户界面**
   - 来电界面（呼吸动画）
   - 通话界面（音频/视频）
   - 通话控制按钮
   - 通话历史记录

---

## 架构设计

### 核心组件

```
feature-p2p/
├── call/
│   ├── WebRTCManager.kt          # WebRTC 核心管理器
│   ├── SignalingManager.kt       # 信令管理器
│   └── CallPeerConnectionObserver.kt  # PeerConnection 事件监听
├── viewmodel/call/
│   └── CallViewModel.kt          # 通话 ViewModel
└── ui/call/
    ├── CallScreen.kt             # 通话界面
    ├── IncomingCallScreen.kt     # 来电界面
    ├── CallHistoryScreen.kt      # 通话历史
    └── components/
        ├── CallControlButtons.kt # 通话控制按钮
        └── QuickCallDialog.kt    # 快速拨打对话框
```

### 数据流

```
用户操作 → ViewModel → WebRTCManager → PeerConnection
                ↓
        SignalingManager → P2PManager → 对方设备
```

---

## 使用方法

### 1. 初始化 WebRTC

在应用启动时初始化 WebRTC：

```kotlin
@Composable
fun AppContent(viewModel: CallViewModel = hiltViewModel()) {
    LaunchedEffect(Unit) {
        viewModel.initialize()
    }
    // ...
}
```

### 2. 发起通话

```kotlin
// 语音通话
viewModel.initiateCall(
    targetDid = "did:example:alice",
    isVideoCall = false
)

// 视频通话
viewModel.initiateCall(
    targetDid = "did:example:alice",
    isVideoCall = true
)
```

### 3. 接听/拒绝通话

```kotlin
// 接听
viewModel.acceptCall()

// 拒绝
viewModel.rejectCall(reason = "忙碌中")
```

### 4. 通话控制

```kotlin
// 静音/取消静音
viewModel.toggleMicrophone()

// 切换扬声器
viewModel.toggleSpeaker()

// 切换摄像头（视频通话）
viewModel.switchCamera()

// 挂断
viewModel.endCall()
```

### 5. 监听通话事件

```kotlin
LaunchedEffect(Unit) {
    viewModel.eventFlow.collectLatest { event ->
        when (event) {
            is CallEvent.IncomingCall -> {
                // 显示来电界面
                navController.navigate("incoming_call/${event.fromDid}")
            }
            is CallEvent.CallConnected -> {
                // 通话已连接
                showToast("通话已连接")
            }
            is CallEvent.CallEnded -> {
                // 通话已结束
                navController.popBackStack()
            }
            is CallEvent.ShowError -> {
                // 显示错误
                showToast(event.message)
            }
            else -> {}
        }
    }
}
```

---

## 界面集成

### 来电界面

```kotlin
IncomingCallScreen(
    callerDid = "did:example:alice",
    callerName = "Alice",
    isVideoCall = true,
    onAccept = { navController.navigate("call") },
    onReject = { navController.popBackStack() },
    onNavigateToCall = { navController.navigate("call") }
)
```

### 通话界面

```kotlin
CallScreen(
    peerDid = "did:example:alice",
    peerName = "Alice",
    isVideoCall = true,
    onCallEnded = { navController.popBackStack() }
)
```

### 通话历史

```kotlin
CallHistoryScreen(
    onNavigateToCall = { did, isVideo ->
        viewModel.initiateCall(did, isVideo)
        navController.navigate("call")
    },
    onNavigateBack = { navController.popBackStack() }
)
```

### 快速拨打对话框

```kotlin
var showQuickCallDialog by remember { mutableStateOf(false) }

if (showQuickCallDialog) {
    QuickCallDialog(
        contactName = "Alice",
        contactDid = "did:example:alice",
        onDismiss = { showQuickCallDialog = false },
        onAudioCall = {
            viewModel.initiateCall("did:example:alice", isVideoCall = false)
            navController.navigate("call")
        },
        onVideoCall = {
            viewModel.initiateCall("did:example:alice", isVideoCall = true)
            navController.navigate("call")
        }
    )
}
```

---

## WebRTC 配置

### STUN/TURN 服务器

默认使用 Google 的公共 STUN 服务器：

```kotlin
val iceServers = listOf(
    PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
    PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
)
```

**生产环境建议**：部署自己的 TURN 服务器（如 coturn）以提高连接成功率。

### 音视频参数

- **视频分辨率**: 640x480
- **帧率**: 30 FPS
- **编码**: VP8/H.264
- **音频**: Opus

---

## 权限要求

在 `AndroidManifest.xml` 中添加：

```xml
<!-- 通话权限 -->
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.INTERNET" />

<!-- 硬件特性 -->
<uses-feature android:name="android.hardware.camera" android:required="false" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
<uses-feature android:name="android.hardware.microphone" android:required="true" />
```

运行时权限请求：

```kotlin
val permissions = arrayOf(
    Manifest.permission.CAMERA,
    Manifest.permission.RECORD_AUDIO
)

requestPermissions(permissions) { granted ->
    if (granted) {
        viewModel.initiateCall(targetDid, isVideoCall)
    }
}
```

---

## 依赖库

在 `feature-p2p/build.gradle.kts` 中添加：

```kotlin
dependencies {
    // WebRTC
    implementation("io.getstream:stream-webrtc-android:1.1.3")

    // Kotlin 协程
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.48")
    kapt("com.google.dagger:hilt-compiler:2.48")

    // Timber
    implementation("com.jakewharton.timber:timber:5.0.1")
}
```

---

## 信令协议

### 消息格式

```json
{
  "type": "offer" | "answer" | "ice_candidate" | "hangup" | "reject",
  "data": "...",
  "fromDid": "did:example:alice"
}
```

### 消息类型

1. **Offer** - 通话邀请

   ```json
   {
     "type": "offer",
     "data": {
       "sdp": "v=0\r\no=- ...",
       "type": "offer"
     }
   }
   ```

2. **Answer** - 接听应答

   ```json
   {
     "type": "answer",
     "data": {
       "sdp": "v=0\r\no=- ...",
       "type": "answer"
     }
   }
   ```

3. **ICE Candidate** - ICE 候选

   ```json
   {
     "type": "ice_candidate",
     "data": {
       "sdpMid": "0",
       "sdpMLineIndex": 0,
       "sdp": "candidate:..."
     }
   }
   ```

4. **Hangup** - 挂断

   ```json
   {
     "type": "hangup",
     "data": ""
   }
   ```

5. **Reject** - 拒绝
   ```json
   {
     "type": "reject",
     "data": {
       "reason": "忙碌中"
     }
   }
   ```

---

## 故障排查

### 常见问题

1. **无法建立连接**
   - 检查网络连接
   - 检查 STUN/TURN 服务器配置
   - 查看 ICE 候选收集状态

2. **没有音频/视频**
   - 检查权限
   - 检查媒体流是否正确添加
   - 检查 SurfaceViewRenderer 初始化

3. **对方听不到声音**
   - 检查麦克风权限
   - 检查麦克风静音状态
   - 检查音频轨道是否启用

4. **画面黑屏**
   - 检查摄像头权限
   - 检查视频轨道渲染
   - 检查 EglBase 初始化

### 调试日志

启用详细日志：

```kotlin
Timber.plant(Timber.DebugTree())
```

关键日志标签：

- `WebRTCManager`
- `SignalingManager`
- `CallPeerConnectionObserver`

---

## 性能优化

### 电池优化

```kotlin
// 通话时禁用电池优化
val powerManager = getSystemService(PowerManager::class.java)
val wakeLock = powerManager.newWakeLock(
    PowerManager.PARTIAL_WAKE_LOCK,
    "ChainlessChain::CallWakeLock"
)
wakeLock.acquire()

// 通话结束后释放
wakeLock.release()
```

### 网络优化

- 使用自适应码率
- 动态调整视频质量
- 实现重连机制

---

## 安全性

1. **端到端加密**：所有信令消息通过 P2P 网络加密传输
2. **DID 身份验证**：基于 DID 的身份验证
3. **权限控制**：严格的权限检查

---

## 未来计划

- [ ] 群组通话
- [ ] 屏幕共享
- [ ] 通话录制
- [ ] 通话加密指示器
- [ ] 网络质量指示器
- [ ] 美颜滤镜
- [ ] 虚拟背景

---

## 参考资料

- [WebRTC 官方文档](https://webrtc.org/)
- [Stream WebRTC Android SDK](https://github.com/GetStream/stream-webrtc-android)
- [libp2p 文档](https://docs.libp2p.io/)

---

**最后更新**: 2026-01-26
**维护者**: ChainlessChain Team
