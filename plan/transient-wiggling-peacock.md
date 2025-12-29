# P2P消息传输优化实施计划

## 概述

优化ChainlessChain的P2P消息传输系统，解决性能瓶颈、提升实时性、增强可靠性和安全性。

**当前问题**:
- 频繁磁盘I/O（每条消息触发2次JSON写入）
- 大消息内存峰值（Buffer.concat无流式处理）
- 30秒同步延迟（实时性差）
- 重试机制未激活（attempts计数器从不递增）
- 连接无复用（每条消息新建stream）
- 安全隐患（信任验证硬编码true）

**优化目标**:
- 减少90%磁盘I/O
- 消息延迟从30秒降至<1秒
- 支持100MB+大文件传输
- 99%送达率
- 完善安全验证

---

## 阶段一：关键性能修复 (P0 - 必须)

### 1.1 批量持久化层
**文件**: `desktop-app-vue/src/main/p2p/device-sync-manager.js`

**问题**: 234-235行每次消息入队都同步写入磁盘

**方案**:
- 实现写回缓存，累积脏数据
- **每1秒**或50条消息批量刷新到磁盘（用户选择：安全优先配置）
- 使用原子写入（临时文件+重命名）
- 应用关闭时强制刷新

**修改点**:
```javascript
// 第57行：添加属性
this.flushTimer = null;
this.dirtyCount = 0;
this.isDirty = false;

// 第75行：启动定时器（1秒间隔 - 安全优先配置）
startFlushTimer() {
  this.flushTimer = setInterval(() => this.flush(), 1000);
}

// 新增方法：原子刷新
async flush() {
  if (!this.isDirty) return;
  // 写入临时文件 -> fs.renameSync -> 更新isDirty
}

// 第234-235行：移除立即保存，改为标记脏数据
this.isDirty = true;
this.dirtyCount++;
if (this.dirtyCount >= 50) await this.flush();

// 第553行：关闭前刷新
await this.flush();
```

**影响**: 磁盘I/O减少约70%（1秒间隔配置，相比5秒配置的90%减少量有所降低，但更安全）

---

### 1.2 流式消息处理
**文件**:
- `desktop-app-vue/src/main/p2p/p2p-manager.js` (394-399, 978-984行)
- `desktop-app-vue/src/main/p2p/signal-session-manager.js` (295-319, 328-361行)

**问题**: Buffer.concat将所有数据累积到内存

**方案**:
- 使用Node.js Transform流
- 增量处理chunk（64KB块）
- 实现背压管理（pause/resume）
- Signal Protocol支持流式加密/解密

**修改点**:
```javascript
// p2p-manager.js 394-399行：替换累积模式
const stream = new Transform({
  transform(chunk, encoding, callback) {
    // 增量处理每个chunk
    processChunk(chunk);
    callback();
  }
});

// signal-session-manager.js：新增方法
async encryptStream(recipientId, deviceId, readableStream)
async decryptStream(senderId, deviceId, encryptedStream)
```

**影响**: 支持100MB+文件无内存溢出

---

### 1.3 智能重试机制
**文件**: `desktop-app-vue/src/main/p2p/device-sync-manager.js`

**问题**: 205行初始化attempts但从不递增，重试逻辑缺失

**方案**:
- 指数退避：min(30s, 2^attempts秒)
- 最大5次重试
- 失败后进入死信队列
- 重试状态持久化

**修改点**:
```javascript
// 第362-365行：事件处理器中递增尝试次数
message.attempts++;

// 第427-446行：重构syncDevice()
async syncDevice(deviceId) {
  const queue = this.messageQueue.get(deviceId);
  for (const msg of queue) {
    if (msg.attempts >= this.config.maxRetries) {
      await this.moveToDeadLetterQueue(msg.id, 'max retries exceeded');
      continue;
    }

    try {
      await this.sendMessage(msg);
      msg.attempts = 0; // 成功后重置
    } catch (error) {
      msg.attempts++;
      const delay = Math.min(30000, Math.pow(2, msg.attempts) * 2000);
      setTimeout(() => this.retryMessage(msg.id), delay);
    }
  }
}

// 新增方法
async moveToDeadLetterQueue(messageId, reason)
async retryMessage(messageId)
```

**影响**: 99%送达率（处理瞬时网络故障）

---

### 1.4 实时同步通知
**文件**: `desktop-app-vue/src/main/p2p/p2p-manager.js`

**问题**: 30秒轮询导致高延迟

**方案**:
- 新协议 `/chainlesschain/sync-notification/1.0.0`
- 消息入队时立即推送通知
- 保留30秒轮询作为降级
- 15秒心跳保活

**修改点**:
```javascript
// 新增协议处理器
registerSyncNotificationHandlers() {
  this.node.handle('/chainlesschain/sync-notification/1.0.0', async ({ stream }) => {
    // 解析通知
    const notification = await readStream(stream);
    // 立即触发同步
    this.syncManager.syncDevice(notification.deviceId);
  });
}

// device-sync-manager.js queueMessage()中：
async queueMessage(targetDeviceId, message) {
  // ... 现有代码 ...

  // 推送实时通知
  if (this.p2pManager.isConnected(targetPeerId)) {
    await this.p2pManager.sendSyncNotification(targetPeerId, {
      deviceId: targetDeviceId,
      messageId: messageId
    });
  }
}

// 保留定时器作为降级
this.syncTimer = setInterval(() => this.syncAllDevices(), 30000);
```

**影响**: 消息延迟<1秒（从最高30秒）

---

## 阶段二：扩展性改进 (P1 - 应该)

### 2.1 连接池管理
**文件**: `desktop-app-vue/src/main/p2p/p2p-manager.js`

**问题**: 910-913行每条消息新建stream

**方案**:
- 维护每个peer的stream池（最多10个并发）
- 复用stream发送多条消息
- LRU淘汰策略
- 连接健康检查

**修改点**:
```javascript
// 新增类
class ConnectionPool {
  constructor(maxPerPeer = 10) {
    this.pools = new Map(); // peerId -> Stream[]
    this.maxPerPeer = maxPerPeer;
  }

  async getStream(peerId, protocol) {
    // 尝试复用或创建新stream
  }

  releaseStream(peerId, stream) {
    // 归还到池中
  }

  evictLRU(peerId) {
    // 移除最旧的stream
  }
}

// 第910-913行：使用连接池
const stream = await this.connectionPool.getStream(peerId, protocol);
// ... 使用stream ...
this.connectionPool.releaseStream(peerId, stream); // 不关闭，归还
```

**影响**: 高频消息场景下连接开销减少10倍

---

### 2.2 对等节点缓存
**文件**: `desktop-app-vue/src/main/p2p/p2p-manager.js`

**问题**: 727-735行频繁调用getConnectedPeers无缓存

**方案**:
- 5秒TTL缓存
- peer:connect/disconnect事件失效缓存
- 延迟刷新

**修改点**:
```javascript
// 第43行：添加缓存
this.peerCache = {
  list: null,
  timestamp: 0,
  ttl: 5000
};

// 第727-735行：包装缓存逻辑
getConnectedPeers() {
  const now = Date.now();
  if (this.peerCache.list && (now - this.peerCache.timestamp < this.peerCache.ttl)) {
    return this.peerCache.list;
  }

  const peers = this.node.getConnections().map(...);
  this.peerCache = { list: peers, timestamp: now, ttl: 5000 };
  return peers;
}

// 第246-266行：事件监听器失效缓存
this.node.addEventListener('peer:connect', () => {
  this.peerCache.list = null;
});
```

**影响**: 减少冗余的peer列表迭代

---

### 2.3 预密钥池自动补充
**文件**: `desktop-app-vue/src/main/p2p/signal-session-manager.js`

**问题**: 197-209行只生成100个预密钥，可能耗尽

**方案**:
- 监控预密钥消耗
- 剩余<20时触发异步补充
- 生成100个新密钥
- 通知对等节点更新

**修改点**:
```javascript
// 第41行：添加水位线
this.prekeyLowWatermark = 20;

// 第218-243行：getPreKeyBundle()中检查
async getPreKeyBundle() {
  const preKey = this.preKeys.get(preKeyId);

  // 检查剩余数量
  if (this.preKeys.size < this.prekeyLowWatermark) {
    this.generateMorePreKeys(100); // 异步，不阻塞
  }

  return { ... };
}

// 新增方法
async generateMorePreKeys(count) {
  const startId = this.nextPreKeyId;
  for (let i = 0; i < count; i++) {
    const keyPair = await KeyHelper.generatePreKey(startId + i);
    this.preKeys.set(keyPair.keyId, keyPair);
  }
  this.nextPreKeyId += count;
  await this.save();
}
```

**影响**: 消除预密钥耗尽风险

---

## 阶段三：安全强化 (P1 - 应该)

### 3.1 信任验证框架
**文件**: `desktop-app-vue/src/main/p2p/signal-session-manager.js`

**问题**: 547行isTrustedIdentity()硬编码返回true

**方案**:
- TOFU（首次使用时信任）+ 手动验证
- 首次：自动信任并存储指纹
- 后续：比对存储的指纹
- 不匹配：要求用户手动确认
- UI显示SHA-256指纹

**修改点**:
```javascript
// 第544-548行：替换为真实验证
async isTrustedIdentity(identifier, identityKey, direction) {
  const storedKey = await this.store.get(`fingerprint_${identifier}`);

  if (!storedKey) {
    // 首次接触 - TOFU
    const fingerprint = sha256(identityKey);
    await this.store.set(`fingerprint_${identifier}`, fingerprint);
    return true;
  }

  const currentFingerprint = sha256(identityKey);
  if (currentFingerprint !== storedKey) {
    // 密钥变化 - 需要用户确认
    this.emit('trust:verification-required', {
      identifier,
      oldFingerprint: storedKey,
      newFingerprint: currentFingerprint
    });
    return false;
  }

  return true;
}
```

**影响**: 防止中间人攻击

---

### 3.2 消息去重
**文件**: `desktop-app-vue/src/main/p2p/device-sync-manager.js`

**问题**: 重试可能导致重复消息

**方案**:
- Bloom过滤器或Set存储已处理消息ID
- 10,000条消息容量
- 7天滚动窗口（与messageRetention一致）

**修改点**:
```javascript
// 第53行：添加去重缓存
this.processedMessageIds = new Set();

// 消息接收处理器中：
async handleIncomingMessage(message) {
  if (this.processedMessageIds.has(message.id)) {
    console.log('Duplicate message ignored:', message.id);
    return;
  }

  this.processedMessageIds.add(message.id);

  // ... 正常处理 ...
}

// 第461-504行：cleanup()中清理旧ID
async cleanup() {
  const now = Date.now();
  const retentionMs = this.config.messageRetention * 24 * 60 * 60 * 1000;

  // 清理消息队列
  // ... 现有代码 ...

  // 清理去重缓存（简化：直接清空，实际可按时间戳过滤）
  if (this.processedMessageIds.size > 10000) {
    this.processedMessageIds.clear();
  }
}
```

**影响**: 防止重复消息处理

---

## 实施优先级（用户选择：全部阶段 + TDD）

**开发方式**: 测试驱动开发（TDD）- 先编写测试用例再实现功能
**预计总工期**: 6-7周（TDD增加20-30%时间）

### Sprint 1 (第1-2周) - P0关键修复
每个功能先写测试，然后实现：
1. **批量持久化层 (1.1)** - 4天
   - Day 1-2: 编写单元测试（原子写入、刷新逻辑、崩溃恢复）
   - Day 3-4: 实现功能并通过测试
2. **智能重试机制 (1.3)** - 3天
   - Day 1: 编写重试测试（指数退避、最大次数、DLQ）
   - Day 2-3: 实现并验证
3. **实时同步通知 (1.4)** - 4天
   - Day 1-2: 编写集成测试（WebSocket通知、降级）
   - Day 3-4: 实现协议处理器

### Sprint 2 (第3-4周) - P0+P1性能
1. **流式消息处理 (1.2)** - 6天
   - Day 1-3: 编写流式处理测试（大文件、背压）
   - Day 4-6: 实现Transform流和Signal流式加密
2. **连接池管理 (2.1)** - 3天
   - Day 1: 编写连接池测试（复用、LRU、泄漏检测）
   - Day 2-3: 实现ConnectionPool类

### Sprint 3 (第5周) - P1安全+扩展性
1. **信任验证框架 (3.1)** - 4天
   - Day 1-2: 编写TOFU测试、指纹比对测试
   - Day 3-4: 实现信任验证逻辑
2. **消息去重 (3.2)** - 2天
   - Day 1: 编写去重测试
   - Day 2: 实现去重缓存
3. **对等节点缓存 (2.2) + 预密钥池 (2.3)** - 3天
   - Day 1: 编写缓存和预密钥测试
   - Day 2-3: 实现

### Sprint 4 (第6周) - 系统测试
1. **性能基准测试** - 2天
   - 吞吐量、延迟、内存、I/O指标
2. **可靠性集成测试** - 2天
   - 网络分区、崩溃恢复、并发
3. **安全渗透测试** - 1天
   - MITM、重放攻击、去重验证

---

## 关键文件清单

1. **device-sync-manager.js** (565行)
   - 批量持久化 (1.1)
   - 智能重试 (1.3)
   - 消息去重 (3.2)

2. **p2p-manager.js** (1286行)
   - 流式处理 (1.2)
   - 实时同步 (1.4)
   - 连接池 (2.1)
   - 节点缓存 (2.2)

3. **signal-session-manager.js** (565行)
   - 流式加密 (1.2)
   - 预密钥补充 (2.3)
   - 信任验证 (3.1)

4. **device-manager.js** (413行)
   - 连接池集成（小改动）

---

## 成功指标

**性能**:
- ✅ 磁盘I/O：<1次/秒（1秒批量刷新，vs当前~1次/消息，约70%减少）
- ✅ 消息延迟：<1秒P95（vs当前最高30秒）
- ✅ 大文件支持：100MB+无内存溢出
- ✅ 吞吐量：1000+消息/秒

**可靠性**:
- ✅ 送达率：99%+（含重试）
- ✅ 重复消息：0%（去重生效）

**资源**:
- CPU：空闲同步<5%
- 内存：P2P子系统<100MB
- 连接建立：<300ms P95

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 批量写入数据丢失 | 低 | 中 | **已采用1秒刷新间隔（用户选择）**，原子写入 |
| 流式处理复杂性bug | 中 | 中 | 充分测试，保持小消息向后兼容 |
| 连接池资源泄漏 | 低 | 中 | LRU淘汰，健康检查 |
| 信任验证误报 | 低 | 高 | 清晰的UI指纹验证流程 |

---

## 向后兼容性

**无破坏性变更** - 所有优化均为内部实现：
- 协议保持兼容（相同的 `/chainlesschain/*` 处理器）
- 新功能可选（如WebSocket通知降级到轮询）
- 现有消息队列文件可直接加载

**功能开关**:
```javascript
config = {
  enableBatchedWrites: true,     // 批量写入
  enableStreamProcessing: true,  // 流式处理
  enableRealtimeSync: true,      // 实时同步
  enableConnectionPool: true     // 连接池
}
```

**回滚计划**:
- 各阶段独立部署
- 监控仪表板跟踪指标
- 快速回滚能力
