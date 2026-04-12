# 协议融合桥接系统

> **版本: v3.3.0 | 状态: ✅ 生产就绪 | 5 IPC Handlers | 2 数据库表 | 多协议统一消息**

## 概述

协议融合桥接系统实现了 DID、ActivityPub、Nostr、Matrix 四大去中心化协议的统一消息格式和跨协议智能路由。系统通过无损格式转换保留消息元数据完整性，并提供跨协议身份映射将不同网络的身份关联到同一 DID，使用户可以在一个界面中收发来自不同协议网络的消息。

ChainlessChain 协议融合桥接系统实现了 DID、ActivityPub、Nostr、Matrix 四大去中心化协议的统一消息格式和跨协议路由。通过无损格式转换和身份映射，用户可以在一个界面中收发来自不同协议网络的消息。

## 核心特性

- 🔗 **统一消息格式**: DID/ActivityPub/Nostr/Matrix 四协议消息统一化
- 🔄 **无损格式转换**: 跨协议消息转换，保留元数据完整性
- 🪪 **跨协议身份映射**: 将不同协议的身份关联到同一 DID
- 🌐 **智能消息路由**: 根据目标协议自动选择最优路径
- 📊 **协议状态监控**: 实时统计各协议的消息量和身份映射数

## 支持的协议

| 协议        | 常量值        | 说明                   |
| ----------- | ------------- | ---------------------- |
| DID         | `did`         | W3C 去中心化身份标识   |
| ActivityPub | `activitypub` | Fediverse 联邦社交协议 |
| Nostr       | `nostr`       | 简洁中继社交协议       |
| Matrix      | `matrix`      | 端到端加密即时通信     |

## 获取统一消息流

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "protocol-fusion:get-unified-feed",
  {
    protocol: "nostr", // 可选：按协议过滤
    limit: 50,
  },
);
// result.feed = [
//   { id, source_protocol: "nostr", sender_id: "npub...", content: "...", ... },
//   { id, source_protocol: "matrix", sender_id: "@user:server", content: "...", ... },
// ]
```

## 发送跨协议消息

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "protocol-fusion:send-message",
  {
    sourceProtocol: "did",
    targetProtocol: "matrix",
    senderId: "did:example:alice",
    content: "跨协议消息测试",
  },
);
// result.message = { id, converted: 1, routed: 1, ... }
```

## 创建身份映射

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "protocol-fusion:map-identity",
  {
    didId: "did:example:alice",
    activitypubId: "@alice@mastodon.social",
    nostrPubkey: "npub1abc...",
    matrixId: "@alice:matrix.org",
  },
);
// result.mapping = { id, verified: 0, ... }
```

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              协议融合桥接系统                       │
│                                                    │
│  ┌──────┐  ┌──────────┐  ┌──────┐  ┌──────────┐ │
│  │ DID  │  │ActivityPub│  │Nostr │  │  Matrix  │ │
│  └──┬───┘  └─────┬────┘  └──┬───┘  └─────┬────┘ │
│     │            │           │             │       │
│     ▼            ▼           ▼             ▼       │
│  ┌────────────────────────────────────────────┐   │
│  │        统一消息格式 (Unified Format)         │   │
│  │  无损转换 → 身份映射 → 智能路由              │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

## IPC 接口完整列表

### 协议融合操作（5 个）

| 通道                                  | 功能           | 说明                 |
| ------------------------------------- | -------------- | -------------------- |
| `protocol-fusion:get-unified-feed`    | 获取统一消息流 | 支持按协议过滤和分页 |
| `protocol-fusion:send-message`        | 发送跨协议消息 | 自动格式转换和路由   |
| `protocol-fusion:map-identity`        | 创建身份映射   | 关联多协议身份到 DID |
| `protocol-fusion:get-identity-map`    | 查询身份映射   | 按 DID 查询关联身份  |
| `protocol-fusion:get-protocol-status` | 查询协议状态   | 各协议消息量和身份数 |

## 数据库 Schema

**2 张核心表**:

| 表名                | 用途           | 关键字段                                              |
| ------------------- | -------------- | ----------------------------------------------------- |
| `unified_messages`  | 统一消息存储   | id, source_protocol, target_protocol, content, routed |
| `identity_mappings` | 跨协议身份映射 | id, did_id, activitypub_id, nostr_pubkey, matrix_id   |

### unified_messages 表

```sql
CREATE TABLE IF NOT EXISTS unified_messages (
  id TEXT PRIMARY KEY,
  source_protocol TEXT NOT NULL,         -- did | activitypub | nostr | matrix
  target_protocol TEXT,
  sender_id TEXT,
  content TEXT,
  unified_format TEXT,                   -- JSON: 统一格式消息
  converted INTEGER DEFAULT 0,
  routed INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_unified_msgs_protocol ON unified_messages(source_protocol);
```

### identity_mappings 表

```sql
CREATE TABLE IF NOT EXISTS identity_mappings (
  id TEXT PRIMARY KEY,
  did_id TEXT,
  activitypub_id TEXT,
  nostr_pubkey TEXT,
  matrix_id TEXT,
  verified INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_identity_map_did ON identity_mappings(did_id);
```

## 前端集成

### ProtocolFusionPage 页面

**功能模块**:

- **统计卡片**: 消息数 / 身份映射数 / 协议数
- **统一消息流**: Tab 页签，展示来源协议、发送者、内容
- **身份映射表**: 展示 DID/ActivityPub/Nostr/Matrix 四列关联
- **协议状态**: 各协议的消息量和身份数

### Pinia Store (protocolFusion.ts)

```typescript
const useProtocolFusionStore = defineStore("protocolFusion", {
  state: () => ({
    feed: [],
    identityMap: [],
    protocolStatus: null,
    loading: false,
    error: null,
  }),
  actions: {
    fetchFeed, // → protocol-fusion:get-unified-feed
    sendMessage, // → protocol-fusion:send-message
    mapIdentity, // → protocol-fusion:map-identity
    fetchIdentityMap, // → protocol-fusion:get-identity-map
    fetchProtocolStatus, // → protocol-fusion:get-protocol-status
  },
});
```

## 关键文件

| 文件                                               | 职责               | 行数 |
| -------------------------------------------------- | ------------------ | ---- |
| `src/main/social/protocol-fusion-bridge.js`        | 协议融合核心引擎   | ~250 |
| `src/main/social/protocol-fusion-ipc.js`           | IPC 处理器（5 个） | ~130 |
| `src/renderer/stores/protocolFusion.ts`            | Pinia 状态管理     | ~100 |
| `src/renderer/pages/social/ProtocolFusionPage.vue` | 协议融合页面       | ~77  |

## 测试覆盖率

```
✅ protocol-fusion-bridge.test.js           - 消息转换/身份映射/路由测试
✅ stores/protocolFusion.test.ts            - Store 状态管理测试
✅ e2e/social/protocol-fusion.e2e.test.ts   - 端到端用户流程测试
```

## 使用示例

### 查看统一消息流

1. 打开「协议融合」页面，进入「统一消息」标签
2. 消息流自动聚合来自 DID、ActivityPub、Nostr、Matrix 四个协议的消息
3. 使用 Tab 页签按协议过滤消息
4. 每条消息显示来源协议、发送者身份和内容

### 发送跨协议消息

1. 在「发送消息」面板选择源协议和目标协议
2. 输入发送者 ID 和消息内容
3. 系统自动进行格式转换和路由
4. 在消息流中确认消息已送达（routed 标记）

### 创建身份映射

1. 切换到「身份映射」标签页
2. 输入同一用户在不同协议的身份标识
3. 关联 DID / ActivityPub / Nostr / Matrix 四种身份
4. 映射完成后，跨协议消息自动识别同一用户

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 消息流为空 | 未连接任何协议网络 | 确认至少一个协议的客户端已配置并连接 |
| 跨协议发送失败 | 目标协议服务不可达 | 检查协议状态面板，确认目标协议在线 |
| 格式转换丢失信息 | 源协议特有字段无法映射 | 查看 `unified_format` 字段确认保留的元数据 |
| 身份映射验证失败 | DID 或协议 ID 格式不正确 | 确认各协议 ID 格式符合标准（如 npub/@ 前缀） |
| 协议状态全部离线 | 网络连接中断或后端服务未启动 | 检查网络连接和后端服务运行状态 |
| 消息重复显示 | 同一消息通过多个协议接收 | 系统通过内容哈希去重，检查 `unified_messages` 表 |

## 安全考虑

- **格式转换无损**: 消息转换保留所有元数据，原始格式存储在 `unified_format` JSON 中
- **身份验证**: 身份映射需经过各协议的签名验证，防止冒充
- **端到端加密**: Matrix 协议的 E2EE 消息在转发时保持加密状态
- **路由隐私**: 消息路由路径不对外暴露，仅在本地处理
- **跨协议隔离**: 一个协议的安全漏洞不会影响其他协议的通信
- **数据库加密**: 统一消息和身份映射存储在 SQLCipher 加密数据库中
- **Nostr 密钥安全**: Nostr 私钥仅用于本地签名，不通过桥接传输

## 相关文档

- [去中心化社交 →](/chainlesschain/social)
- [Nostr Bridge →](/chainlesschain/nostr-bridge)
- [Matrix Bridge →](/chainlesschain/matrix-bridge)
- [ActivityPub →](/chainlesschain/social-ai)
