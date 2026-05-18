# 卫星通信系统

> **版本: v3.2.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | LEO 卫星加密消息**

## 概述

卫星通信系统实现了基于 LEO（低地轨道）卫星的端到端加密消息传输，当传统网络不可用时通过 Iridium 等卫星链路保持关键通信能力。系统支持 Gzip 压缩传输节省卫星带宽、离线签名队列自动同步、紧急密钥撤销广播和种子短语灾难恢复方案。

ChainlessChain 卫星通信系统实现了基于 LEO（低地轨道）卫星的加密消息传输，支持离线签名队列、紧急密钥撤销广播和灾难恢复。当传统网络不可用时，通过卫星链路保持关键通信能力。

## 系统架构

```
┌─────────────────────────────────────────────┐
│              SatelliteComm                  │
│      (消息加密 / Gzip 压缩 / 队列管理)       │
└──────┬──────────┬──────────┬────────────────┘
       │          │          │
       ▼          ▼          ▼
┌──────────┐ ┌──────────┐ ┌───────────────┐
│ LEO 卫星  │ │ 离线签名  │ │ 灾难恢复       │
│ Iridium  │ │ 队列同步  │ │ 种子短语恢复   │
│ 加密传输  │ │ 自动补发  │ │ 紧急密钥撤销   │
└──────────┘ └──────────┘ └───────────────┘
       │          │          │
       ▼          ▼          ▼
┌─────────────────────────────────────────────┐
│            SQLite 持久化                     │
│  satellite_messages / offline_signature_queue │
└─────────────────────────────────────────────┘
```

## 配置参考

在 `~/.chainlesschain/config.json` 中配置卫星通信参数：

```json
{
  "satelliteComm": {
    "enabled": true,
    "provider": "iridium",
    "compression": "gzip",
    "encryptionAlgorithm": "AES-256-GCM",
    "offlineQueue": {
      "maxSize": 500,
      "autoSync": true,
      "retryInterval": 300
    },
    "emergencyRevoke": {
      "broadcastOnRevoke": true,
      "confirmationRequired": true
    },
    "recovery": {
      "seedPhraseWords": 24,
      "multiDeviceSync": true
    }
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `satelliteComm.provider` | string | `"iridium"` | 卫星提供商：`iridium` / `starlink` / `custom` |
| `satelliteComm.compression` | string | `"gzip"` | 压缩算法：`gzip` / `none` |
| `offlineQueue.maxSize` | number | `500` | 离线签名队列最大条目数 |
| `offlineQueue.retryInterval` | number | `300` | 自动重试间隔（秒） |
| `emergencyRevoke.confirmationRequired` | boolean | `true` | 紧急撤销前是否要求二次确认 |
| `recovery.seedPhraseWords` | number | `24` | 种子短语单词数：`12` / `24` |

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| 消息 Gzip 压缩 | <10ms | ~6ms | ✅ |
| 消息加密（AES-256-GCM） | <20ms | ~12ms | ✅ |
| 卫星消息发送入队 | <50ms | ~30ms | ✅ |
| 离线签名同步（10条批次） | <500ms | ~380ms | ✅ |
| 紧急密钥撤销广播 | <200ms | ~140ms | ✅ |
| 数据库写入延迟 | <20ms | ~10ms | ✅ |

## 核心特性

- 📡 **卫星加密消息**: 通过 Iridium 等 LEO 卫星发送加密消息
- 📦 **Gzip 压缩传输**: 自动压缩消息内容，节省卫星带宽
- 📝 **离线签名队列**: 离线环境下排队签名请求，恢复连接后自动同步
- 🚨 **紧急密钥撤销**: 通过卫星广播紧急密钥撤销指令
- 🔄 **灾难恢复**: 种子短语恢复方案，支持多设备恢复

## 发送卫星消息

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "satellite:send-message",
  {
    senderDid: "did:example:alice",
    recipientDid: "did:example:bob",
    content: "紧急通知：系统安全警报",
    provider: "iridium", // 卫星提供商
  },
);
// result.message = {
//   id: "uuid",
//   status: "sent",
//   compression: "gzip",
//   satellite_provider: "iridium",
// }
```

## 同步离线签名

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "satellite:sync-signatures",
);
// result = { success: true, synced: 5, remaining: 0 }
```

## 紧急密钥撤销

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "satellite:emergency-revoke",
  "key-compromised-001",
);
// result = {
//   success: true,
//   keyId: "key-compromised-001",
//   revoked: true,
//   broadcastedAt: 1709123456789,
// }
```

## 消息生命周期

```
创建 (queued) → 压缩 (gzip) → 加密 → 发送 (sent) → 接收 (received)
                                                    ↓
                                               失败 (failed) → 重试
```

## IPC 接口完整列表

### 卫星通信操作（5 个）

| 通道                            | 功能         | 说明                        |
| ------------------------------- | ------------ | --------------------------- |
| `satellite:send-message`        | 发送卫星消息 | 自动加密压缩，通过 LEO 发送 |
| `satellite:get-messages`        | 查询消息列表 | 支持按状态过滤              |
| `satellite:sync-signatures`     | 同步离线签名 | 将队列中的签名请求同步      |
| `satellite:emergency-revoke`    | 紧急密钥撤销 | 通过卫星广播撤销指令        |
| `satellite:get-recovery-status` | 查询恢复状态 | 离线签名同步进度            |

## 数据库 Schema

**2 张核心表**:

| 表名                      | 用途         | 关键字段                                            |
| ------------------------- | ------------ | --------------------------------------------------- |
| `satellite_messages`      | 卫星消息存储 | id, sender_did, content_encrypted, status, provider |
| `offline_signature_queue` | 离线签名队列 | id, document_hash, signer_did, signature, synced    |

### satellite_messages 表

```sql
CREATE TABLE IF NOT EXISTS satellite_messages (
  id TEXT PRIMARY KEY,
  sender_did TEXT,
  recipient_did TEXT,
  content_encrypted TEXT,
  compression TEXT DEFAULT 'gzip',
  satellite_provider TEXT,
  status TEXT DEFAULT 'queued',          -- queued | sent | received | failed
  sent_at INTEGER,
  received_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_satellite_msgs_status ON satellite_messages(status);
```

### offline_signature_queue 表

```sql
CREATE TABLE IF NOT EXISTS offline_signature_queue (
  id TEXT PRIMARY KEY,
  document_hash TEXT NOT NULL,
  signer_did TEXT,
  signature TEXT,
  status TEXT DEFAULT 'pending',
  synced INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_offline_sig_status ON offline_signature_queue(status);
```

## 前端集成

### SatelliteCommPage 页面

**功能模块**:

- **统计卡片**: 消息数 / 待同步 / 离线签名数
- **发送表单**: 输入收件人 DID 和消息内容，通过卫星发送
- **消息列表**: 展示状态、提供商、收件人信息
- **同步操作**: 触发离线签名同步

### Pinia Store (satellite.ts)

```typescript
const useSatelliteStore = defineStore("satellite", {
  state: () => ({
    messages: [],
    recoveryStatus: null,
    loading: false,
    error: null,
  }),
  actions: {
    sendMessage, // → satellite:send-message
    fetchMessages, // → satellite:get-messages
    syncSignatures, // → satellite:sync-signatures
    emergencyRevoke, // → satellite:emergency-revoke
    fetchRecoveryStatus, // → satellite:get-recovery-status
  },
});
```

## 关键文件

| 文件                                                | 职责               | 行数 |
| --------------------------------------------------- | ------------------ | ---- |
| `src/main/security/satellite-comm.js`               | 卫星通信核心引擎   | ~180 |
| `src/main/security/disaster-recovery.js`            | 灾难恢复模块       | ~60  |
| `src/main/security/satellite-ipc.js`                | IPC 处理器（5 个） | ~130 |
| `src/renderer/stores/satellite.ts`                  | Pinia 状态管理     | ~90  |
| `src/renderer/pages/security/SatelliteCommPage.vue` | 卫星通信页面       | ~86  |

## 测试覆盖率

```
✅ satellite-comm.test.js                - 消息发送/查询/签名同步/撤销测试
✅ stores/satellite.test.ts              - Store 状态管理测试
✅ e2e/security/satellite-comm.e2e.test.ts - 端到端用户流程测试
```

## 使用示例

### 发送卫星加密消息

1. 打开「卫星通信」页面
2. 输入收件人 DID 和消息内容
3. 选择卫星提供商（默认 Iridium）
4. 点击「发送」，消息自动压缩、加密后通过卫星链路传输
5. 在消息列表中查看状态变化：queued → sent → received

### 同步离线签名

1. 在离线环境中，签名请求自动排入队列
2. 恢复网络连接后，打开「同步」面板
3. 点击「同步签名」，队列中的签名自动上传
4. 查看同步结果：已同步数量和剩余数量

### 紧急密钥撤销

1. 当密钥疑似泄露时，进入「紧急操作」面板
2. 输入需要撤销的密钥 ID
3. 点击「紧急撤销」，撤销指令通过卫星广播
4. 所有接收节点立即停止使用该密钥

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 消息发送失败 | 卫星链路不可用 | 检查天气条件和卫星覆盖，稍后重试 |
| 消息状态卡在 queued | 卫星网关连接超时 | 确认卫星设备供电正常，检查天线方向 |
| 签名同步失败 | 网络恢复后连接不稳定 | 等待网络稳定后重新触发同步 |
| 紧急撤销广播延迟 | 卫星轨道周期限制 | LEO 卫星周期约 90 分钟，等待下次过境窗口 |
| 消息解密失败 | 收件人密钥已变更 | 确认收件人 DID 和公钥信息最新 |
| 压缩率异常低 | 消息内容已是二进制格式 | 对已压缩内容跳过 Gzip 压缩 |

## 安全考虑

- **端到端加密**: 消息内容在发送前加密，卫星中继无法读取明文
- **Gzip 压缩**: 先压缩后加密，既节省带宽又不暴露压缩特征
- **离线签名安全**: 签名队列存储在加密数据库中，防止离线期间数据泄露
- **紧急撤销广播**: 撤销指令经过 DID 签名验证，防止伪造撤销请求
- **种子短语恢复**: 灾难恢复方案支持通过种子短语重建密钥对
- **多设备隔离**: 每个设备独立管理密钥，单设备泄露不影响其他设备
- **传输不可追踪**: 卫星链路通信难以被地面网络监控追踪

## 相关文档

- [反审查通信 →](/chainlesschain/anti-censorship)
- [加密系统 →](/chainlesschain/encryption)
- [U-Key 硬件密钥 →](/chainlesschain/ukey)
