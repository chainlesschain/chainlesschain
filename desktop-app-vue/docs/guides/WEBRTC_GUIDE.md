# WebRTC P2P连接使用指南

**版本**: v0.21.0
**更新日期**: 2026-01-09

---

## 📋 目录

1. [概述](#概述)
2. [WebRTC优势](#webrtc优势)
3. [配置说明](#配置说明)
4. [STUN/TURN服务器](#stunturn服务器)
5. [NAT穿透策略](#nat穿透策略)
6. [连接质量监控](#连接质量监控)
7. [故障排除](#故障排除)
8. [最佳实践](#最佳实践)

---

## 概述

ChainlessChain使用WebRTC作为P2P通信的主要传输层之一。WebRTC（Web Real-Time Communication）提供了浏览器和移动应用之间的实时通信能力，特别适合需要低延迟、高质量的P2P连接场景。

### 支持的传输协议

ChainlessChain支持多种传输协议，可根据网络环境自动选择：

1. **WebRTC** - 低延迟、NAT穿透能力强（推荐）
2. **WebSocket** - 稳定性好、兼容性强
3. **TCP** - 本地网络首选
4. **Circuit Relay** - 后备中继方案

---

## WebRTC优势

### 1. 低延迟
- 直接P2P连接，无需中间服务器
- 适合实时通信和文件传输

### 2. NAT穿透
- 内置STUN/TURN支持
- 支持多种NAT类型（Full Cone、Restricted、Symmetric等）

### 3. 安全性
- 强制加密（DTLS-SRTP）
- 端到端安全

### 4. 自适应
- 自动调整带宽
- 网络质量自适应

---

## 配置说明

### 数据库配置

WebRTC相关配置存储在数据库的`settings`表中：

#### 基础配置

```sql
-- 启用WebRTC传输
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.transports.webrtc.enabled', 'true');

-- WebRTC监听端口
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.webrtc.port', '9095');

-- ICE传输策略 ('all' 或 'relay')
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.webrtc.iceTransportPolicy', 'all');

-- ICE候选池大小
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.webrtc.iceCandidatePoolSize', '10');
```

#### 传输层自动选择

```sql
-- 启用智能传输选择（根据NAT类型自动选择最优传输）
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.transports.autoSelect', 'true');
```

---

## STUN/TURN服务器

### STUN服务器配置

STUN（Session Traversal Utilities for NAT）服务器用于NAT穿透和公网IP发现。

#### 默认STUN服务器

```sql
INSERT OR REPLACE INTO settings (key, value) VALUES (
  'p2p.stun.servers',
  '["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302","stun:stun2.l.google.com:19302","stun:stun3.l.google.com:19302","stun:stun4.l.google.com:19302"]'
);
```

#### 公共STUN服务器列表

```
stun:stun.l.google.com:19302
stun:stun1.l.google.com:19302
stun:stun2.l.google.com:19302
stun:stun3.l.google.com:19302
stun:stun4.l.google.com:19302
stun:stun.stunprotocol.org:3478
stun:stun.voip.blackberry.com:3478
```

### TURN服务器配置

TURN（Traversal Using Relays around NAT）服务器用于在无法建立直接P2P连接时提供中继服务。

#### 启用TURN

```sql
-- 启用TURN服务器
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.turn.enabled', 'true');

-- 配置TURN服务器（需要认证）
INSERT OR REPLACE INTO settings (key, value) VALUES (
  'p2p.turn.servers',
  '[{
    "urls": "turn:turn.example.com:3478",
    "username": "your-username",
    "credential": "your-password"
  }]'
);
```

#### 公共TURN服务器

**注意**: 公共TURN服务器通常有使用限制，生产环境建议自建。

免费TURN服务器选项：
1. **Twilio STUN/TURN** - https://www.twilio.com/stun-turn
2. **Xirsys** - https://xirsys.com/
3. **自建Coturn** - https://github.com/coturn/coturn

#### 自建TURN服务器（Coturn）

```bash
# Ubuntu/Debian安装
sudo apt-get install coturn

# 配置文件 /etc/turnserver.conf
listening-port=3478
fingerprint
lt-cred-mech
user=username:password
realm=yourdomain.com
```

---

## NAT穿透策略

### NAT类型检测

ChainlessChain会自动检测NAT类型并选择最优传输策略：

```sql
-- 启用NAT自动检测
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.nat.autoDetect', 'true');

-- NAT检测间隔（毫秒）
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.nat.detectionInterval', '3600000');
```

### NAT类型与传输策略

| NAT类型 | 优先传输 | 说明 |
|---------|---------|------|
| **Full Cone** | WebRTC | 最容易穿透，WebRTC效果最好 |
| **Restricted** | WebRTC | 较容易穿透，WebRTC优先 |
| **Port Restricted** | WebRTC | 中等难度，WebRTC可用 |
| **Symmetric** | WebSocket | 难以穿透，WebSocket更稳定 |
| **无NAT** | TCP | 本地网络，TCP最快 |

### ICE传输策略

```sql
-- 'all': 尝试所有候选（STUN + TURN）
-- 'relay': 仅使用TURN中继（强制中继，更私密但速度慢）
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.webrtc.iceTransportPolicy', 'all');
```

---

## 连接质量监控

### 质量指标

WebRTC质量监控器会实时监控以下指标：

1. **丢包率** (Packet Loss)
   - 优秀: < 1%
   - 良好: 1-2%
   - 一般: 2-5%
   - 较差: 5-10%
   - 严重: > 10%

2. **往返时间** (RTT)
   - 优秀: < 50ms
   - 良好: 50-150ms
   - 一般: 150-300ms
   - 较差: 300-500ms
   - 严重: > 500ms

3. **抖动** (Jitter)
   - 优秀: < 10ms
   - 良好: 10-30ms
   - 一般: 30-50ms
   - 较差: 50-100ms
   - 严重: > 100ms

4. **带宽** (Bandwidth)
   - 最低要求: 100 kbps
   - 推荐: > 1 Mbps

### 质量等级

- **Excellent** (优秀) - 所有指标优秀
- **Good** (良好) - 大部分指标良好
- **Fair** (一般) - 可用但有改进空间
- **Poor** (较差) - 体验不佳，建议优化
- **Critical** (严重) - 连接质量严重问题

### 监控配置

```sql
-- 连接健康检查间隔（毫秒）
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.connection.healthCheckInterval', '60000');
```

### 获取质量报告

通过IPC调用获取WebRTC连接质量报告：

```javascript
// 获取特定peer的质量报告
const report = await window.electron.p2p.getWebRTCQualityReport(peerId);

// 获取所有连接的质量报告
const allReports = await window.electron.p2p.getWebRTCQualityReport();

// 获取优化建议
const suggestions = await window.electron.p2p.getWebRTCOptimizationSuggestions(peerId);
```

---

## 故障排除

### 常见问题

#### 1. WebRTC连接失败

**症状**: 无法建立WebRTC连接，回退到WebSocket或TCP

**可能原因**:
- 防火墙阻止UDP流量
- NAT类型不兼容
- STUN服务器不可达

**解决方案**:
```bash
# 检查UDP端口是否开放
netstat -an | grep 9095

# 测试STUN服务器连通性
nc -u stun.l.google.com 19302

# 启用TURN服务器作为后备
```

#### 2. 高延迟/丢包

**症状**: 连接质量监控显示高RTT或丢包率

**可能原因**:
- 网络拥塞
- 路由不优
- 对等节点距离远

**解决方案**:
- 使用有线连接替代WiFi
- 连接地理位置更近的节点
- 启用TURN中继

#### 3. 对称NAT无法穿透

**症状**: 对称NAT环境下连接失败

**解决方案**:
```sql
-- 启用TURN服务器
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.turn.enabled', 'true');

-- 或强制使用中继
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.webrtc.iceTransportPolicy', 'relay');
```

#### 4. 连接不稳定

**症状**: 连接频繁断开重连

**可能原因**:
- 网络不稳定
- NAT映射超时
- 防火墙规则变化

**解决方案**:
```sql
-- 增加连接超时时间
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.connection.dialTimeout', '60000');

-- 增加重试次数
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.connection.maxRetries', '5');
```

### 调试日志

启用详细日志以诊断问题：

```javascript
// 在开发者工具控制台中
localStorage.setItem('debug', 'libp2p:*,webrtc:*');
```

---

## 最佳实践

### 1. 网络环境优化

- **使用有线连接**: WiFi可能导致丢包和延迟
- **关闭VPN**: VPN可能影响NAT穿透
- **配置防火墙**: 允许UDP端口9095

### 2. STUN/TURN配置

- **多个STUN服务器**: 提高可用性
- **自建TURN服务器**: 生产环境必备
- **地理分布**: TURN服务器应靠近用户

### 3. 连接策略

- **启用自动选择**: 根据NAT类型自动优化
- **保留多种传输**: WebRTC + WebSocket + TCP
- **启用Circuit Relay**: 作为最后的后备方案

### 4. 监控和告警

- **定期检查质量报告**: 及时发现问题
- **设置告警阈值**: 自动通知质量问题
- **收集统计数据**: 用于长期优化

### 5. 安全考虑

- **使用TLS**: TURN服务器应使用TLS
- **认证TURN访问**: 防止滥用
- **限制ICE候选**: 避免泄露内网信息

```sql
-- 仅使用中继（最私密，但速度慢）
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.webrtc.iceTransportPolicy', 'relay');
```

### 6. 性能优化

```sql
-- 增加ICE候选池大小（更快建立连接）
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.webrtc.iceCandidatePoolSize', '20');

-- 减少健康检查频率（降低开销）
INSERT OR REPLACE INTO settings (key, value) VALUES ('p2p.connection.healthCheckInterval', '120000');
```

---

## 参考资源

### 官方文档
- [WebRTC官方网站](https://webrtc.org/)
- [libp2p WebRTC文档](https://docs.libp2p.io/concepts/transports/webrtc/)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)

### STUN/TURN服务器
- [Coturn项目](https://github.com/coturn/coturn)
- [公共STUN服务器列表](https://gist.github.com/sagivo/3a4b2f2c7ac6e1b5267c2f1f59ac6c6b)

### 工具
- [WebRTC Troubleshooter](https://test.webrtc.org/)
- [Trickle ICE测试](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)

---

## 技术支持

如遇到问题，请：

1. 查看日志文件: `logs/p2p.log`
2. 运行诊断工具: 设置 → P2P网络 → 诊断
3. 提交Issue: https://github.com/chainlesschain/chainlesschain/issues

---

**文档版本**: v1.0
**最后更新**: 2026-01-09
**维护者**: ChainlessChain Team
