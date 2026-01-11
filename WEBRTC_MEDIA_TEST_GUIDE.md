# WebRTC媒体流传输测试指南

## 概述

本指南提供了在真实环境中测试ChainlessChain WebRTC音视频通话功能的完整步骤。

---

## 前置条件

### 硬件要求
- 麦克风（音频输入）
- 扬声器/耳机（音频输出）
- 摄像头（视频通话，可选）
- 两台设备或两个浏览器窗口

### 软件要求
- Node.js 18+
- Docker & Docker Compose
- ChainlessChain Desktop应用
- 网络连接（用于STUN服务器）

### 网络要求
- 开放端口：9001 (WebSocket信令)
- 开放端口：9002 (HTTP健康检查)
- 访问STUN服务器（stun.l.google.com:19302）
- 可选：TURN服务器（用于严格NAT环境）

---

## 测试环境设置

### 1. 启动服务

```bash
# 启动Docker服务（包括信令服务器）
docker-compose up -d

# 验证信令服务器状态
docker-compose ps signaling-server
# 应显示: Up (healthy)

# 验证健康检查
curl http://localhost:9002/health
```

### 2. 配置STUN/TURN服务器

编辑 `.env` 文件或在应用设置中配置：

```bash
# STUN服务器（公共）
STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302

# TURN服务器（可选，用于NAT穿透）
TURN_ENABLED=false
TURN_SERVERS=[]
```

### 3. 启动Desktop应用

```bash
cd desktop-app-vue
npm run dev
```

---

## 测试场景

### 场景1: 本地回环测试（单设备）

**目的**: 验证WebRTC基础功能和媒体流获取

**步骤**:

1. 打开两个Desktop应用窗口（或使用开发者工具模拟）
2. 在窗口1中，打开开发者控制台
3. 执行以下测试代码：

```javascript
// 测试媒体流获取
async function testMediaStream() {
  try {
    // 获取音频流
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    console.log('✅ 音频流获取成功:', audioStream.getTracks());

    // 获取视频流
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    });
    console.log('✅ 视频流获取成功:', videoStream.getTracks());

    return { audioStream, videoStream };
  } catch (error) {
    console.error('❌ 媒体流获取失败:', error);
    throw error;
  }
}

// 运行测试
testMediaStream();
```

**预期结果**:
- ✅ 浏览器请求麦克风/摄像头权限
- ✅ 控制台显示音频/视频轨道信息
- ✅ 没有错误抛出

---

### 场景2: 点对点音频通话测试

**目的**: 验证完整的音频通话流程

**步骤**:

1. **设备A（发起方）**:
   - 打开Desktop应用
   - 进入"好友"或"消息"页面
   - 点击某个联系人的"语音通话"按钮

2. **设备B（接收方）**:
   - 收到来电通知
   - 点击"接受"按钮

3. **验证点**:
   - [ ] 发起方听到拨号音
   - [ ] 接收方收到来电通知
   - [ ] 接受后双方能听到对方声音
   - [ ] 通话质量指示器显示正常
   - [ ] 静音按钮工作正常
   - [ ] 挂断按钮正常结束通话

**测试脚本**:

```javascript
// 在Desktop应用的渲染进程中执行
async function testAudioCall(targetPeerId) {
  try {
    // 发起音频通话
    const callId = await window.electron.ipcRenderer.invoke('p2p:start-call', {
      peerId: targetPeerId,
      type: 'audio'
    });

    console.log('✅ 通话已发起:', callId);

    // 监听通话事件
    window.electron.ipcRenderer.on('p2p:call-connected', (event, data) => {
      console.log('✅ 通话已连接:', data);
    });

    window.electron.ipcRenderer.on('p2p:call-quality-update', (event, data) => {
      console.log('📊 通话质量:', data);
    });

    return callId;
  } catch (error) {
    console.error('❌ 通话发起失败:', error);
    throw error;
  }
}

// 使用示例
testAudioCall('test-peer-id');
```

**性能指标**:
- 通话建立时间: < 3秒
- 音频延迟: < 200ms
- 丢包率: < 5%
- 抖动: < 50ms

---

### 场景3: 点对点视频通话测试

**目的**: 验证视频通话和画面传输

**步骤**:

1. **发起视频通话**:
   - 点击"视频通话"按钮
   - 允许摄像头权限

2. **验证点**:
   - [ ] 本地视频预览正常显示
   - [ ] 远程视频流正常显示
   - [ ] 视频画面流畅（30fps）
   - [ ] 视频开关按钮工作正常
   - [ ] 画面质量自适应网络状况

**测试脚本**:

```javascript
async function testVideoCall(targetPeerId) {
  try {
    const callId = await window.electron.ipcRenderer.invoke('p2p:start-call', {
      peerId: targetPeerId,
      type: 'video'
    });

    console.log('✅ 视频通话已发起:', callId);

    // 监听远程视频流
    window.electron.ipcRenderer.on('p2p:call-remote-stream', (event, data) => {
      console.log('✅ 收到远程视频流:', data);

      // 获取视频轨道信息
      const videoTrack = data.stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      console.log('📹 视频设置:', {
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate
      });
    });

    return callId;
  } catch (error) {
    console.error('❌ 视频通话失败:', error);
    throw error;
  }
}
```

**性能指标**:
- 视频分辨率: 720p (1280x720)
- 帧率: 30fps
- 视频延迟: < 300ms
- 带宽使用: 500-1500 Kbps

---

### 场景4: NAT穿透测试

**目的**: 验证不同NAT类型下的连接能力

**测试环境**:
- Full Cone NAT
- Restricted NAT
- Port Restricted NAT
- Symmetric NAT

**步骤**:

1. 检测NAT类型：

```javascript
async function detectNATType() {
  const result = await window.electron.ipcRenderer.invoke('p2p:detect-nat');
  console.log('NAT类型:', result.type);
  console.log('公网IP:', result.publicIP);
  return result;
}
```

2. 测试连接建立：

```javascript
async function testNATTraversal(targetPeerId) {
  const natInfo = await detectNATType();

  console.log('开始NAT穿透测试...');
  console.log('本地NAT类型:', natInfo.type);

  const callId = await window.electron.ipcRenderer.invoke('p2p:start-call', {
    peerId: targetPeerId,
    type: 'audio'
  });

  // 监听ICE候选
  window.electron.ipcRenderer.on('p2p:ice-candidate', (event, data) => {
    console.log('ICE候选:', data.candidate.type);
  });

  // 监听连接状态
  window.electron.ipcRenderer.on('p2p:connection-state', (event, data) => {
    console.log('连接状态:', data.state);
  });
}
```

**预期结果**:
- Full Cone NAT: 直接P2P连接 ✅
- Restricted NAT: 通过STUN建立连接 ✅
- Symmetric NAT: 需要TURN中继 ⚠️

---

### 场景5: 网络质量测试

**目的**: 验证不同网络条件下的通话质量

**测试条件**:
- 正常网络（延迟 < 50ms）
- 高延迟网络（延迟 200-500ms）
- 丢包网络（丢包率 5-10%）
- 低带宽网络（带宽 < 500 Kbps）

**模拟网络条件**（macOS）:

```bash
# 安装Network Link Conditioner
# 或使用tc命令模拟网络条件

# 模拟高延迟
sudo tc qdisc add dev eth0 root netem delay 200ms

# 模拟丢包
sudo tc qdisc add dev eth0 root netem loss 5%

# 模拟带宽限制
sudo tc qdisc add dev eth0 root tbf rate 500kbit burst 32kbit latency 400ms

# 清除限制
sudo tc qdisc del dev eth0 root
```

**测试脚本**:

```javascript
async function testNetworkQuality(targetPeerId) {
  const callId = await window.electron.ipcRenderer.invoke('p2p:start-call', {
    peerId: targetPeerId,
    type: 'audio'
  });

  // 监听质量指标
  const qualityMetrics = [];

  window.electron.ipcRenderer.on('p2p:call-quality-update', (event, data) => {
    qualityMetrics.push({
      timestamp: Date.now(),
      rtt: data.roundTripTime,
      jitter: data.jitter,
      packetLoss: data.packetsLost / data.packetsReceived * 100,
      bitrate: data.bytesReceived * 8 / 1000 // Kbps
    });

    // 每5秒输出一次统计
    if (qualityMetrics.length % 5 === 0) {
      const avg = calculateAverage(qualityMetrics.slice(-5));
      console.log('📊 平均质量指标:', avg);
    }
  });

  return callId;
}

function calculateAverage(metrics) {
  const sum = metrics.reduce((acc, m) => ({
    rtt: acc.rtt + m.rtt,
    jitter: acc.jitter + m.jitter,
    packetLoss: acc.packetLoss + m.packetLoss,
    bitrate: acc.bitrate + m.bitrate
  }), { rtt: 0, jitter: 0, packetLoss: 0, bitrate: 0 });

  return {
    rtt: sum.rtt / metrics.length,
    jitter: sum.jitter / metrics.length,
    packetLoss: sum.packetLoss / metrics.length,
    bitrate: sum.bitrate / metrics.length
  };
}
```

**质量标准**:
- 优秀: RTT < 100ms, 丢包 < 1%, 抖动 < 20ms
- 良好: RTT < 200ms, 丢包 < 3%, 抖动 < 50ms
- 可接受: RTT < 300ms, 丢包 < 5%, 抖动 < 100ms
- 差: RTT > 300ms, 丢包 > 5%, 抖动 > 100ms

---

## 自动化测试脚本

创建 `test-webrtc-media.js`:

```javascript
/**
 * WebRTC媒体流自动化测试
 *
 * 注意：此脚本需要在Electron环境中运行
 */

const { app, BrowserWindow } = require('electron');

class WebRTCMediaTest {
  constructor() {
    this.results = {
      mediaAccess: false,
      audioCall: false,
      videoCall: false,
      natTraversal: false,
      qualityMetrics: []
    };
  }

  async runAllTests() {
    console.log('='.repeat(60));
    console.log('WebRTC媒体流自动化测试');
    console.log('='.repeat(60));

    try {
      await this.testMediaAccess();
      await this.testAudioCall();
      await this.testVideoCall();
      await this.testNATTraversal();

      this.printReport();
    } catch (error) {
      console.error('测试失败:', error);
    }
  }

  async testMediaAccess() {
    console.log('\n[测试1] 媒体设备访问测试...');

    // 此测试需要在渲染进程中执行
    // 这里仅作为示例框架

    console.log('  ⚠️  需要在Desktop应用中手动测试');
    console.log('  提示: 使用开发者工具执行 testMediaStream()');
  }

  async testAudioCall() {
    console.log('\n[测试2] 音频通话测试...');
    console.log('  ⚠️  需要两个设备进行测试');
    console.log('  提示: 参考测试指南中的场景2');
  }

  async testVideoCall() {
    console.log('\n[测试3] 视频通话测试...');
    console.log('  ⚠️  需要两个设备进行测试');
    console.log('  提示: 参考测试指南中的场景3');
  }

  async testNATTraversal() {
    console.log('\n[测试4] NAT穿透测试...');
    console.log('  ⚠️  需要不同网络环境进行测试');
    console.log('  提示: 参考测试指南中的场景4');
  }

  printReport() {
    console.log('\n' + '='.repeat(60));
    console.log('测试报告');
    console.log('='.repeat(60));
    console.log('\nWebRTC媒体流测试需要在真实环境中手动执行');
    console.log('请参考 WEBRTC_MEDIA_TEST_GUIDE.md 进行完整测试');
    console.log('\n建议测试清单:');
    console.log('  [ ] 媒体设备访问（麦克风、摄像头）');
    console.log('  [ ] 音频通话（本地回环）');
    console.log('  [ ] 音频通话（跨设备）');
    console.log('  [ ] 视频通话（本地回环）');
    console.log('  [ ] 视频通话（跨设备）');
    console.log('  [ ] NAT穿透（不同NAT类型）');
    console.log('  [ ] 网络质量测试（模拟弱网）');
    console.log('  [ ] 长时间通话稳定性（30分钟+）');
    console.log('='.repeat(60));
  }
}

// 导出测试类
module.exports = WebRTCMediaTest;

// 如果直接运行
if (require.main === module) {
  const test = new WebRTCMediaTest();
  test.runAllTests();
}
```

---

## 测试检查清单

### 功能测试
- [ ] 麦克风权限请求和访问
- [ ] 摄像头权限请求和访问
- [ ] 音频通话发起
- [ ] 音频通话接受
- [ ] 音频通话拒绝
- [ ] 视频通话发起
- [ ] 视频通话接受
- [ ] 视频通话拒绝
- [ ] 通话中静音/取消静音
- [ ] 通话中开启/关闭视频
- [ ] 通话正常结束
- [ ] 通话异常断开处理

### 性能测试
- [ ] 通话建立时间 < 3秒
- [ ] 音频延迟 < 200ms
- [ ] 视频延迟 < 300ms
- [ ] 丢包率 < 5%
- [ ] 抖动 < 50ms
- [ ] CPU使用率 < 30%
- [ ] 内存使用稳定

### 兼容性测试
- [ ] Full Cone NAT环境
- [ ] Restricted NAT环境
- [ ] Symmetric NAT环境
- [ ] 防火墙环境
- [ ] 代理环境

### 稳定性测试
- [ ] 30分钟长时间通话
- [ ] 网络切换（WiFi <-> 4G）
- [ ] 弱网环境（高延迟、丢包）
- [ ] 多次通话（连续10次）
- [ ] 并发通话（多人会议）

---

## 常见问题排查

### 问题1: 无法获取媒体设备

**症状**:
```
DOMException: Permission denied
```

**解决方案**:
1. 检查浏览器/应用权限设置
2. 确认麦克风/摄像头未被其他应用占用
3. 检查系统隐私设置

### 问题2: 无法建立P2P连接

**症状**:
```
ICE connection failed
```

**解决方案**:
1. 检查STUN服务器配置
2. 验证网络防火墙设置
3. 考虑配置TURN服务器
4. 检查NAT类型

### 问题3: 音视频不同步

**症状**: 画面和声音延迟不一致

**解决方案**:
1. 检查网络延迟
2. 调整缓冲区大小
3. 启用自适应码率

### 问题4: 通话质量差

**症状**: 卡顿、杂音、画面模糊

**解决方案**:
1. 检查网络带宽
2. 降低视频分辨率
3. 启用回声消除和降噪
4. 检查CPU使用率

---

## 性能优化建议

### 1. 编解码器选择
- 音频: Opus (推荐)
- 视频: VP8/VP9 或 H.264

### 2. 自适应码率
```javascript
// 根据网络状况动态调整码率
const constraints = {
  video: {
    width: { min: 640, ideal: 1280, max: 1920 },
    height: { min: 480, ideal: 720, max: 1080 },
    frameRate: { min: 15, ideal: 30, max: 60 }
  }
};
```

### 3. 回声消除
```javascript
const audioConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};
```

### 4. 连接优化
- 优先使用UDP传输
- 启用ICE候选收集优化
- 配置合适的STUN/TURN服务器

---

## 测试报告模板

```markdown
# WebRTC媒体流测试报告

**测试日期**: YYYY-MM-DD
**测试人员**:
**测试环境**:

## 测试结果

### 功能测试
- 媒体设备访问: ✅/❌
- 音频通话: ✅/❌
- 视频通话: ✅/❌
- NAT穿透: ✅/❌

### 性能指标
- 通话建立时间: ___ 秒
- 音频延迟: ___ ms
- 视频延迟: ___ ms
- 丢包率: ___ %
- 抖动: ___ ms

### 发现的问题
1.
2.
3.

### 改进建议
1.
2.
3.
```

---

## 参考资料

- [WebRTC官方文档](https://webrtc.org/)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [STUN/TURN服务器列表](https://gist.github.com/sagivo/3a4b2f2c7ac6e1b5267c2f1f59ac6c6b)
- [WebRTC故障排查指南](https://webrtc.github.io/samples/)

---

**最后更新**: 2026-01-11
