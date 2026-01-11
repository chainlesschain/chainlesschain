# P2P通信功能使用指南

## 目录
1. [快速开始](#快速开始)
2. [语音/视频通话](#语音视频通话)
3. [MediaStream桥接](#mediastream桥接)
4. [通话历史](#通话历史)
5. [前端集成](#前端集成)
6. [API参考](#api参考)
7. [故障排除](#故障排除)

## 快速开始

### 初始化P2P增强管理器

```javascript
const P2PEnhancedManager = require('./src/main/p2p/p2p-enhanced-manager');

// 创建实例
const enhancedManager = new P2PEnhancedManager(p2pManager, database, {
  // 通话配置
  callTimeout: 60000,
  qualityCheckInterval: 5000,

  // ICE服务器
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],

  // 音频约束
  audioConstraints: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  },

  // 视频约束
  videoConstraints: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 }
  }
});

// 初始化
await enhancedManager.initialize();
```

## 语音/视频通话

### 发起通话

#### 语音通话
```javascript
// 发起语音通话
const callId = await enhancedManager.startCall('peer-id-123', 'audio');

console.log('通话已发起:', callId);
```

#### 视频通话
```javascript
// 发起视频通话
const callId = await enhancedManager.startCall('peer-id-456', 'video', {
  videoConstraints: {
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  }
});
```

### 接听通话

```javascript
// 监听来电事件
enhancedManager.on('call:incoming', async ({ callId, peerId, type }) => {
  console.log(`收到来自 ${peerId} 的${type}通话`);

  // 接受通话
  await enhancedManager.acceptCall(callId);

  // 或拒绝通话
  // await enhancedManager.rejectCall(callId, 'busy');
});
```

### 通话控制

```javascript
// 切换静音
const isMuted = enhancedManager.toggleMute(callId);
console.log('静音状态:', isMuted);

// 切换视频
const isVideoEnabled = enhancedManager.toggleVideo(callId);
console.log('视频状态:', isVideoEnabled);

// 结束通话
await enhancedManager.endCall(callId);
```

### 监听通话事件

```javascript
// 通话已连接
enhancedManager.on('call:connected', ({ callId, peerId }) => {
  console.log('通话已连接:', callId);
});

// 通话质量更新
enhancedManager.on('call:quality-update', ({ callId, stats }) => {
  console.log('通话质量:', {
    bytesReceived: stats.bytesReceived,
    bytesSent: stats.bytesSent,
    packetsLost: stats.packetsLost,
    roundTripTime: stats.roundTripTime
  });
});

// 通话已结束
enhancedManager.on('call:ended', ({ callId }) => {
  console.log('通话已结束:', callId);
});
```

### 获取通话信息

```javascript
// 获取单个通话信息
const callInfo = enhancedManager.getCallInfo(callId);
console.log('通话信息:', {
  callId: callInfo.callId,
  peerId: callInfo.peerId,
  type: callInfo.type,
  state: callInfo.state,
  duration: callInfo.duration, // 秒
  stats: callInfo.stats
});

// 获取所有活动通话
const activeCalls = enhancedManager.getActiveCalls();
console.log(`当前有 ${activeCalls.length} 个活动通话`);
```

## MediaStream桥接

MediaStream桥接服务用于在Electron主进程和渲染进程之间传递媒体流。

### 主进程端

MediaStream桥接已自动集成到P2PEnhancedManager中，无需额外配置。

### 渲染进程端

在渲染进程中初始化MediaStream处理器：

```javascript
// 在renderer进程的入口文件中
import mediaStreamHandler from '@/utils/mediaStreamHandler';

// MediaStream处理器会自动监听主进程的请求
// 当主进程需要媒体流时，会自动调用getUserMedia
```

### 自定义媒体流处理

如果需要自定义媒体流获取逻辑：

```javascript
// 在CallWindow.vue中
import { onMounted } from 'vue';

onMounted(async () => {
  // 获取本地媒体流
  const stream = await navigator.mediaDevices.getUserMedia({
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

  // 显示本地视频
  if (localVideo.value) {
    localVideo.value.srcObject = stream;
  }

  // 通知主进程媒体流已就绪
  ipcRenderer.send('media-stream:ready', {
    requestId: 'req-123',
    streamId: stream.id,
    tracks: stream.getTracks().map(track => ({
      id: track.id,
      kind: track.kind,
      label: track.label,
      enabled: track.enabled
    })),
    type: 'video',
    callId: props.callId,
    peerId: props.peerId
  });
});
```

## 通话历史

### 获取通话历史

```javascript
// 获取所有通话历史
const history = await enhancedManager.getCallHistory({
  limit: 50,
  offset: 0
});

// 获取指定用户的通话历史
const userHistory = await enhancedManager.getCallHistory({
  peerId: 'peer-id-123',
  limit: 20
});

// 按类型筛选
const audioHistory = await enhancedManager.getCallHistory({
  type: 'audio',
  limit: 30
});

// 按方向筛选
const outgoingHistory = await enhancedManager.getCallHistory({
  direction: 'outgoing',
  limit: 25
});
```

### 获取通话详情

```javascript
const callDetails = await enhancedManager.getCallDetails(callId);

console.log('通话详情:', {
  callId: callDetails.call_id,
  peerId: callDetails.peer_id,
  type: callDetails.call_type,
  direction: callDetails.direction,
  status: callDetails.status,
  duration: callDetails.duration, // 秒
  isAnswered: callDetails.isAnswered,
  qualityStats: callDetails.qualityStats,
  startTime: new Date(callDetails.start_time),
  endTime: callDetails.end_time ? new Date(callDetails.end_time) : null
});
```

### 获取通话统计

```javascript
// 获取全局统计
const globalStats = await enhancedManager.getCallStatistics();

console.log('全局统计:', {
  totalCalls: globalStats.totalCalls,
  outgoingCalls: globalStats.outgoingCalls,
  incomingCalls: globalStats.incomingCalls,
  audioCalls: globalStats.audioCalls,
  videoCalls: globalStats.videoCalls,
  answeredCalls: globalStats.answeredCalls,
  missedCalls: globalStats.missedCalls,
  totalDuration: globalStats.totalDuration, // 秒
  avgDuration: globalStats.avgDuration // 秒
});

// 获取指定用户的统计
const userStats = await enhancedManager.getCallStatistics('peer-id-123');
```

### 管理通话历史

```javascript
// 删除单条记录
await enhancedManager.deleteCallHistory(callId);

// 清空指定用户的通话历史
await enhancedManager.clearCallHistory('peer-id-123');

// 清空所有通话历史
await enhancedManager.clearCallHistory();
```

## 前端集成

### 使用Composable

```vue
<script setup>
import { useP2PCall } from '@/composables/useP2PCall';

const {
  // 状态
  activeCall,
  incomingCall,
  activeCalls,
  callStats,

  // 方法
  startAudioCall,
  startVideoCall,
  acceptCall,
  rejectCall,
  endCall,
  toggleMute,
  toggleVideo,
  getCallInfo,
  getActiveCalls,
  getCallStats
} = useP2PCall();

// 发起语音通话
const handleAudioCall = async (peerId) => {
  const callId = await startAudioCall(peerId);
  if (callId) {
    console.log('通话已发起:', callId);
  }
};

// 发起视频通话
const handleVideoCall = async (peerId) => {
  const callId = await startVideoCall(peerId);
  if (callId) {
    console.log('视频通话已发起:', callId);
  }
};
</script>
```

### 使用UI组件

#### 来电通知组件

```vue
<template>
  <CallNotification :contacts-map="contactsMap" />
</template>

<script setup>
import { ref } from 'vue';
import CallNotification from '@/components/call/CallNotification.vue';

const contactsMap = ref(new Map());
// 加载联系人数据...
</script>
```

#### 通话窗口组件

```vue
<template>
  <CallWindow
    v-if="activeCall"
    :call-id="activeCall.callId"
    :call-type="activeCall.type"
    :peer-id="activeCall.peerId"
    :contacts-map="contactsMap"
    @call-ended="handleCallEnded"
  />
</template>

<script setup>
import { ref } from 'vue';
import CallWindow from '@/components/call/CallWindow.vue';
import { useP2PCall } from '@/composables/useP2PCall';

const { activeCall } = useP2PCall();
const contactsMap = ref(new Map());

const handleCallEnded = () => {
  console.log('通话已结束');
};
</script>
```

## API参考

### P2PEnhancedManager

#### 通话方法

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `startCall(peerId, type, options)` | peerId: string<br>type: 'audio'\|'video'<br>options?: Object | Promise\<string\> | 发起通话，返回callId |
| `acceptCall(callId)` | callId: string | Promise\<boolean\> | 接受通话 |
| `rejectCall(callId, reason)` | callId: string<br>reason?: string | Promise\<boolean\> | 拒绝通话 |
| `endCall(callId)` | callId: string | Promise\<boolean\> | 结束通话 |
| `toggleMute(callId)` | callId: string | boolean | 切换静音，返回当前静音状态 |
| `toggleVideo(callId)` | callId: string | boolean | 切换视频，返回当前视频状态 |
| `getCallInfo(callId)` | callId: string | Object\|null | 获取通话信息 |
| `getActiveCalls()` | - | Array\<Object\> | 获取所有活动通话 |

#### 通话历史方法

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `getCallHistory(options)` | options?: Object | Promise\<Array\> | 获取通话历史 |
| `getCallDetails(callId)` | callId: string | Promise\<Object\|null\> | 获取通话详情 |
| `getCallStatistics(peerId)` | peerId?: string | Promise\<Object\> | 获取通话统计 |
| `deleteCallHistory(callId)` | callId: string | Promise\<void\> | 删除通话记录 |
| `clearCallHistory(peerId)` | peerId?: string | Promise\<void\> | 清空通话历史 |

#### 事件

| 事件名 | 数据 | 描述 |
|--------|------|------|
| `call:started` | { callId, peerId, type, isInitiator } | 通话已发起 |
| `call:incoming` | { callId, peerId, type } | 收到来电 |
| `call:accepted` | { callId, peerId, type } | 通话已接受 |
| `call:rejected` | { callId, peerId, reason } | 通话已拒绝 |
| `call:connected` | { callId, peerId } | 通话已连接 |
| `call:ended` | { callId, peerId } | 通话已结束 |
| `call:remote-stream` | { callId, stream } | 收到远程流 |
| `call:quality-update` | { callId, stats } | 通话质量更新 |
| `call:mute-changed` | { callId, isMuted } | 静音状态变化 |
| `call:video-changed` | { callId, isVideoEnabled } | 视频状态变化 |

### CallHistoryManager

#### 数据库表结构

```sql
CREATE TABLE call_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT UNIQUE NOT NULL,
  peer_id TEXT NOT NULL,
  call_type TEXT NOT NULL,        -- 'audio' | 'video'
  direction TEXT NOT NULL,         -- 'outgoing' | 'incoming'
  status TEXT NOT NULL,            -- 'calling' | 'accepted' | 'rejected' | 'connected' | 'ended'
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  duration INTEGER DEFAULT 0,      -- 秒
  is_answered BOOLEAN DEFAULT 0,
  reject_reason TEXT,
  quality_stats TEXT,              -- JSON格式的质量统计
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## 故障排除

### 常见问题

#### 1. 无法获取媒体流

**问题**: 调用`getUserMedia`失败

**解决方案**:
- 确保浏览器/Electron有摄像头和麦克风权限
- 检查设备是否被其他应用占用
- 在HTTPS或localhost环境下运行

```javascript
// 检查权限
const checkPermissions = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    });

    // 权限已授予
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    console.error('权限检查失败:', error.name, error.message);
    return false;
  }
};
```

#### 2. 通话无法连接

**问题**: 通话一直处于"连接中"状态

**解决方案**:
- 检查ICE服务器配置
- 确认P2P网络连接正常
- 检查防火墙设置

```javascript
// 测试ICE服务器
const testICEServers = async () => {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('ICE候选:', event.candidate);
    } else {
      console.log('ICE收集完成');
    }
  };

  // 创建offer触发ICE收集
  await pc.createOffer();
};
```

#### 3. 通话质量差

**问题**: 音视频卡顿、延迟高

**解决方案**:
- 降低视频分辨率和帧率
- 启用音频处理（回声消除、噪声抑制）
- 检查网络带宽

```javascript
// 使用较低的视频质量
const callId = await enhancedManager.startCall('peer-id', 'video', {
  videoConstraints: {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15 }
  }
});

// 监听质量更新
enhancedManager.on('call:quality-update', ({ callId, stats }) => {
  if (stats.packetsLost > 50) {
    console.warn('丢包率过高，建议降低质量');
  }

  if (stats.roundTripTime > 0.3) {
    console.warn('延迟过高:', stats.roundTripTime * 1000, 'ms');
  }
});
```

#### 4. 通话历史记录失败

**问题**: 无法保存或查询通话历史

**解决方案**:
- 确认数据库已正确初始化
- 检查数据库文件权限
- 查看错误日志

```javascript
// 测试数据库连接
const testDatabase = async () => {
  try {
    const stats = await enhancedManager.getCallStatistics();
    console.log('数据库连接正常:', stats);
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error);
    return false;
  }
};
```

### 调试技巧

#### 启用详细日志

```javascript
// 在初始化时启用调试模式
const enhancedManager = new P2PEnhancedManager(p2pManager, database, {
  debug: true,
  logLevel: 'verbose'
});

// 监听所有事件
enhancedManager.onAny((event, data) => {
  console.log('[P2P Event]', event, data);
});
```

#### 查看WebRTC统计

```javascript
// 获取详细的WebRTC统计
const getDetailedStats = async (callId) => {
  const callInfo = enhancedManager.getCallInfo(callId);
  if (!callInfo) return null;

  // 从VoiceVideoManager获取原始统计
  const session = enhancedManager.voiceVideoManager.sessions.get(callId);
  if (!session || !session.peerConnection) return null;

  const stats = await session.peerConnection.getStats();
  const report = {};

  stats.forEach(stat => {
    report[stat.type] = stat;
  });

  return report;
};
```

## 最佳实践

### 1. 错误处理

始终使用try-catch包装异步调用：

```javascript
const makeCall = async (peerId) => {
  try {
    const callId = await enhancedManager.startCall(peerId, 'audio');
    console.log('通话已发起:', callId);
  } catch (error) {
    console.error('发起通话失败:', error);
    // 显示用户友好的错误消息
    message.error('无法发起通话，请稍后重试');
  }
};
```

### 2. 资源清理

确保在组件卸载时清理资源：

```javascript
onUnmounted(() => {
  // 停止所有媒体流
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  // 移除事件监听
  ipcRenderer.removeAllListeners('p2p-enhanced:call-incoming');
  ipcRenderer.removeAllListeners('p2p-enhanced:call-ended');
});
```

### 3. 用户体验优化

- 显示通话状态指示器
- 提供通话质量反馈
- 实现通话重连机制
- 添加通话录音功能（需用户同意）

### 4. 性能优化

- 使用视频流的多个质量级别
- 实现自适应码率
- 限制并发通话数量
- 定期清理过期的通话历史

## 相关文档

- [P2P Voice/Video Implementation](./P2P_VOICE_VIDEO_IMPLEMENTATION.md)
- [P2P Communication Improvement Summary](./P2P_COMMUNICATION_IMPROVEMENT_SUMMARY.md)
- [Verification and Testing Guide](./VERIFICATION_AND_TESTING_GUIDE.md)
