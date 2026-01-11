# P2P语音/视频通话开发指南

## 概述

本文档面向开发者，介绍如何在ChainlessChain中使用和扩展P2P语音/视频通话功能。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (Vue)                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Vue Components                                        │ │
│  │  - CallNotification.vue                                │ │
│  │  - CallWindow.vue                                      │ │
│  │  - CallControls.vue                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↕                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Composables                                           │ │
│  │  - useP2PCall.js                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↕ IPC                              │
└─────────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Node.js)                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  P2PEnhancedIPC                                        │ │
│  │  - IPC handler registration                            │ │
│  │  - Event forwarding                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↕                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  P2PEnhancedManager                                    │ │
│  │  - Unified P2P management                              │ │
│  │  - Feature coordination                                │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↕                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  VoiceVideoManager                                     │ │
│  │  - Call session management                             │ │
│  │  - WebRTC peer connections                             │ │
│  │  - Quality monitoring                                  │ │
│  └────────────────────────────────────────────────────────┘ │
│                           ↕                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  P2PManager                                            │ │
│  │  - libp2p network                                      │ │
│  │  - Protocol handling                                   │ │
│  │  - NAT traversal                                       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. VoiceVideoManager

**位置**: `src/main/p2p/voice-video-manager.js`

**职责**:
- 管理通话会话生命周期
- 处理WebRTC连接
- 监控通话质量
- 处理ICE候选

**主要API**:

```javascript
const { VoiceVideoManager, CallType } = require('./p2p/voice-video-manager');

// 创建管理器
const manager = new VoiceVideoManager(p2pManager, {
  iceServers: [...],
  callTimeout: 60000,
  qualityCheckInterval: 5000
});

// 发起通话
const callId = await manager.startCall(peerId, CallType.AUDIO);

// 接受通话
await manager.acceptCall(callId);

// 结束通话
await manager.endCall(callId);

// 切换静音
const isMuted = manager.toggleMute(callId);

// 获取通话信息
const info = manager.getCallInfo(callId);
```

### 2. P2PEnhancedManager

**位置**: `src/main/p2p/p2p-enhanced-manager.js`

**职责**:
- 统一管理P2P功能
- 协调消息、文件、通话等功能
- 提供统一的事件接口

**主要API**:

```javascript
const P2PEnhancedManager = require('./p2p/p2p-enhanced-manager');

// 创建管理器
const manager = new P2PEnhancedManager(p2pManager, database, options);
await manager.initialize();

// 发起通话
const callId = await manager.startCall(peerId, 'audio');

// 接受通话
await manager.acceptCall(callId);

// 获取统计
const stats = manager.getStats();
```

### 3. P2PEnhancedIPC

**位置**: `src/main/p2p/p2p-enhanced-ipc.js`

**职责**:
- 注册IPC处理器
- 转发事件到渲染进程

**IPC通道**:

```javascript
// 发起通话
ipcRenderer.invoke('p2p-enhanced:start-call', { peerId, type, options })

// 接受通话
ipcRenderer.invoke('p2p-enhanced:accept-call', { callId })

// 拒绝通话
ipcRenderer.invoke('p2p-enhanced:reject-call', { callId, reason })

// 结束通话
ipcRenderer.invoke('p2p-enhanced:end-call', { callId })

// 切换静音
ipcRenderer.invoke('p2p-enhanced:toggle-mute', { callId })

// 切换视频
ipcRenderer.invoke('p2p-enhanced:toggle-video', { callId })

// 获取通话信息
ipcRenderer.invoke('p2p-enhanced:get-call-info', { callId })

// 获取活动通话
ipcRenderer.invoke('p2p-enhanced:get-active-calls')
```

**事件通道**:

```javascript
// 监听来电
ipcRenderer.on('p2p-enhanced:call-incoming', (event, data) => {
  console.log('来电:', data);
});

// 监听通话连接
ipcRenderer.on('p2p-enhanced:call-connected', (event, data) => {
  console.log('通话已连接:', data);
});

// 监听通话结束
ipcRenderer.on('p2p-enhanced:call-ended', (event, data) => {
  console.log('通话已结束:', data);
});

// 监听质量更新
ipcRenderer.on('p2p-enhanced:call-quality-update', (event, data) => {
  console.log('质量更新:', data.stats);
});
```

## 前端集成

### 使用Composable

推荐使用`useP2PCall` composable来管理通话：

```vue
<script setup>
import { useP2PCall } from '@/composables/useP2PCall';

const {
  activeCall,
  incomingCall,
  startAudioCall,
  startVideoCall,
  acceptCall,
  rejectCall,
  endCall
} = useP2PCall();

// 发起语音通话
const handleAudioCall = async (peerId) => {
  const callId = await startAudioCall(peerId);
  if (callId) {
    console.log('通话已发起:', callId);
  }
};

// 接听来电
const handleAcceptCall = async () => {
  if (incomingCall.value) {
    await acceptCall(incomingCall.value.callId);
  }
};
</script>
```

### 使用组件

```vue
<template>
  <div>
    <!-- 来电通知 -->
    <CallNotification :contacts-map="contactsMap" />

    <!-- 通话窗口 -->
    <CallWindow
      v-if="activeCall"
      :call-id="activeCall.callId"
      :call-type="activeCall.type"
      :peer-id="activeCall.peerId"
      :contacts-map="contactsMap"
      @call-ended="handleCallEnded"
    />
  </div>
</template>

<script setup>
import CallNotification from '@/components/call/CallNotification.vue';
import CallWindow from '@/components/call/CallWindow.vue';
import { useP2PCall } from '@/composables/useP2PCall';

const { activeCall } = useP2PCall();
const contactsMap = ref(new Map());

const handleCallEnded = () => {
  console.log('通话已结束');
};
</script>
```

## 媒体流处理

### 获取本地媒体流

```javascript
// 语音通话
const audioStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  },
  video: false
});

// 视频通话
const videoStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  },
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 }
  }
});
```

### 显示视频流

```vue
<template>
  <video ref="videoRef" autoplay playsinline></video>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const videoRef = ref(null);

onMounted(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true
  });

  if (videoRef.value) {
    videoRef.value.srcObject = stream;
  }
});
</script>
```

### 处理远程流

```javascript
// 监听远程流事件
ipcRenderer.on('p2p-enhanced:call-remote-stream', (event, data) => {
  const { callId, stream } = data;

  // 显示远程视频
  if (remoteVideoRef.value) {
    remoteVideoRef.value.srcObject = stream;
  }
});
```

## WebRTC配置

### ICE服务器配置

```javascript
const iceServers = [
  // STUN服务器（用于NAT穿透）
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },

  // TURN服务器（用于中继）
  {
    urls: 'turn:turn.example.com:3478',
    username: 'user',
    credential: 'pass'
  }
];
```

### 媒体约束配置

```javascript
const audioConstraints = {
  echoCancellation: true,      // 回声消除
  noiseSuppression: true,      // 噪音抑制
  autoGainControl: true,       // 自动增益控制
  sampleRate: 48000,           // 采样率
  channelCount: 1              // 单声道
};

const videoConstraints = {
  width: { min: 640, ideal: 1280, max: 1920 },
  height: { min: 480, ideal: 720, max: 1080 },
  frameRate: { min: 15, ideal: 30, max: 60 },
  facingMode: 'user'           // 前置摄像头
};
```

## 事件系统

### 通话事件

```javascript
// 通话发起
manager.on('call:started', (data) => {
  console.log('通话已发起:', data);
});

// 来电
manager.on('call:incoming', (data) => {
  console.log('收到来电:', data);
});

// 通话连接
manager.on('call:connected', (data) => {
  console.log('通话已连接:', data);
});

// 通话结束
manager.on('call:ended', (data) => {
  console.log('通话已结束:', data);
});

// 通话拒绝
manager.on('call:rejected', (data) => {
  console.log('通话被拒绝:', data);
});

// 远程流
manager.on('call:remote-stream', (data) => {
  console.log('收到远程流:', data);
});

// 质量更新
manager.on('call:quality-update', (data) => {
  console.log('质量更新:', data.stats);
});

// 静音变化
manager.on('call:mute-changed', (data) => {
  console.log('静音状态:', data.isMuted);
});

// 视频变化
manager.on('call:video-changed', (data) => {
  console.log('视频状态:', data.isVideoEnabled);
});
```

## 错误处理

### 常见错误

```javascript
try {
  await manager.startCall(peerId, CallType.AUDIO);
} catch (error) {
  if (error.message === '该用户已在通话中') {
    // 用户忙
    message.warning('对方正在通话中');
  } else if (error.message === 'P2P管理器未初始化') {
    // P2P未初始化
    message.error('P2P网络未就绪');
  } else {
    // 其他错误
    message.error('发起通话失败: ' + error.message);
  }
}
```

### 超时处理

```javascript
// 设置通话超时
const manager = new VoiceVideoManager(p2pManager, {
  callTimeout: 60000  // 60秒
});

// 监听超时事件
manager.on('call:ended', (data) => {
  if (data.reason === 'timeout') {
    message.info('对方未接听');
  }
});
```

## 测试

### 单元测试

```javascript
import { VoiceVideoManager, CallType } from '@/p2p/voice-video-manager';

describe('VoiceVideoManager', () => {
  let manager;

  beforeEach(() => {
    manager = new VoiceVideoManager(mockP2PManager);
  });

  test('should start audio call', async () => {
    const callId = await manager.startCall('peer-123', CallType.AUDIO);
    expect(callId).toBeTruthy();
    expect(manager.sessions.has(callId)).toBe(true);
  });

  test('should accept incoming call', async () => {
    // 模拟来电
    await manager._handleCallRequest('peer-456', {
      callId: 'call-789',
      callType: CallType.AUDIO,
      offer: mockOffer
    });

    // 接受通话
    await manager.acceptCall('call-789');

    const session = manager.sessions.get('call-789');
    expect(session.state).toBe(CallState.CONNECTED);
  });
});
```

### 集成测试

```javascript
describe('P2P Call Integration', () => {
  test('should complete full call flow', async () => {
    // 1. 发起通话
    const callId = await startAudioCall('peer-123');
    expect(callId).toBeTruthy();

    // 2. 模拟对方接听
    await simulateCallAnswer(callId);

    // 3. 验证通话已连接
    const info = await getCallInfo(callId);
    expect(info.state).toBe('connected');

    // 4. 结束通话
    await endCall(callId);

    // 5. 验证通话已结束
    const finalInfo = await getCallInfo(callId);
    expect(finalInfo.state).toBe('ended');
  });
});
```

## 性能优化

### 1. 媒体流优化

```javascript
// 使用较低的分辨率和帧率以节省带宽
const constraints = {
  video: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15 }
  }
};
```

### 2. 质量监控优化

```javascript
// 降低质量检查频率
const manager = new VoiceVideoManager(p2pManager, {
  qualityCheckInterval: 10000  // 10秒检查一次
});
```

### 3. 连接池优化

```javascript
// 使用连接池复用连接
const manager = new P2PEnhancedManager(p2pManager, database, {
  maxConnections: 50,
  connectionTimeout: 30000
});
```

## 调试技巧

### 1. 启用详细日志

```javascript
// 在main process中
process.env.DEBUG = 'p2p:*,webrtc:*';
```

### 2. 查看WebRTC统计

```javascript
const stats = await peerConnection.getStats();
stats.forEach(report => {
  console.log(report.type, report);
});
```

### 3. 网络诊断

```javascript
// 检查NAT类型
const natInfo = await p2pManager.detectNAT();
console.log('NAT类型:', natInfo.type);

// 检查连接质量
const diagnostics = await p2pManager.runDiagnostics();
console.log('诊断结果:', diagnostics);
```

## 扩展功能

### 添加屏幕共享

```javascript
// 1. 获取屏幕流
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: {
    cursor: 'always'
  },
  audio: false
});

// 2. 替换视频轨道
const videoTrack = screenStream.getVideoTracks()[0];
const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
await sender.replaceTrack(videoTrack);

// 3. 监听停止共享
videoTrack.onended = () => {
  console.log('屏幕共享已停止');
};
```

### 添加通话录制

```javascript
// 1. 创建MediaRecorder
const recorder = new MediaRecorder(stream, {
  mimeType: 'video/webm;codecs=vp9'
});

const chunks = [];

recorder.ondataavailable = (event) => {
  chunks.push(event.data);
};

recorder.onstop = () => {
  const blob = new Blob(chunks, { type: 'video/webm' });
  // 保存录制文件
  saveRecording(blob);
};

// 2. 开始录制
recorder.start();

// 3. 停止录制
recorder.stop();
```

## 最佳实践

### 1. 资源管理

```javascript
// 始终清理资源
onUnmounted(() => {
  // 停止媒体流
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  // 关闭连接
  if (peerConnection) {
    peerConnection.close();
  }

  // 移除事件监听
  ipcRenderer.removeAllListeners('p2p-enhanced:call-*');
});
```

### 2. 错误恢复

```javascript
// 实现自动重连
peerConnection.onconnectionstatechange = () => {
  if (peerConnection.connectionState === 'failed') {
    // 尝试重新连接
    restartIce();
  }
};

const restartIce = async () => {
  const offer = await peerConnection.createOffer({ iceRestart: true });
  await peerConnection.setLocalDescription(offer);
  // 发送新的offer
};
```

### 3. 用户体验

```javascript
// 显示连接状态
const connectionState = ref('connecting');

peerConnection.onconnectionstatechange = () => {
  connectionState.value = peerConnection.connectionState;

  switch (connectionState.value) {
    case 'connected':
      message.success('通话已连接');
      break;
    case 'disconnected':
      message.warning('连接已断开');
      break;
    case 'failed':
      message.error('连接失败');
      break;
  }
};
```

## 参考资料

- [WebRTC API文档](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [libp2p文档](https://docs.libp2p.io/)
- [wrtc包文档](https://github.com/node-webrtc/node-webrtc)
- [ChainlessChain P2P架构](../design/p2p-architecture.md)

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork项目
2. 创建功能分支
3. 编写代码和测试
4. 提交Pull Request

详见 [CONTRIBUTING.md](../../CONTRIBUTING.md)

## 许可证

MIT License - 详见 [LICENSE](../../LICENSE)
