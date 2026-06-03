# Nostr 协议桥接

> **Phase 49 | v1.1.0-alpha | 6 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔗 **NIP 协议支持**: 实现 NIP-01/02/04/05/10/13/19/25/36 等 9 个核心 NIP 规范
- 🔑 **DID 身份映射**: ChainlessChain DID 与 Nostr npub 双向绑定，支持密钥导入导出
- 📡 **多 Relay 管理**: 多 Relay 连接/断开/读写权限控制，天然抗审查架构
- 📝 **双向内容同步**: ChainlessChain 本地内容与 Nostr 网络双向同步，支持批量操作
- 🔒 **密钥安全**: nsec 私钥 AES-256 加密存储，可绑定 U-Key 硬件保护

## 系统架构

```
┌───────────────────────────────────────────────┐
│           前端 (Vue3 Nostr Bridge 页面)        │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ 身份管理  │  │ Relay 管理│  │ 内容浏览    │ │
│  └─────┬────┘  └─────┬────┘  └──────┬──────┘ │
└────────┼─────────────┼──────────────┼─────────┘
         │             │              │
         ▼             ▼              ▼
┌───────────────────────────────────────────────┐
│           IPC 通道 (nostr:*)                   │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│           Nostr Bridge Manager                 │
│  ┌────────────┐  ┌────────────┐  ┌─────────┐ │
│  │ 身份管理    │  │ Relay 连接  │  │ 事件引擎 │ │
│  │ (secp256k1)│  │ (WebSocket)│  │(签名/验证)│ │
│  └────────────┘  └────────────┘  └─────────┘ │
│  ┌────────────┐  ┌────────────┐               │
│  │ DID 映射   │  │ 内容同步    │               │
│  └────────────┘  └────────────┘               │
└──────────────────────┬────────────────────────┘
                       │ WebSocket
                       ▼
         ┌──────────────────────────┐
         │    Nostr Relay 网络       │
         │ ┌──────┐┌──────┐┌──────┐│
         │ │Relay1││Relay2││Relay3││
         │ └──────┘└──────┘└──────┘│
         └──────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/p2p/nostr-bridge.js` | Nostr 桥接管理器核心 |
| `src/main/p2p/nostr-relay-pool.js` | Relay 连接池管理 |
| `src/main/p2p/nostr-identity.js` | 密钥对生成/导入/加密存储 |
| `src/main/p2p/nostr-sync.js` | 内容双向同步引擎 |
| `src/renderer/stores/nostrBridge.ts` | Pinia 状态管理 |

## 概述

Phase 49 为 ChainlessChain 引入 Nostr 协议桥接，将去中心化社交能力扩展到 Nostr 网络。与 Phase 42 的 ActivityPub 集成互补，ChainlessChain 同时支持 Fediverse 和 Nostr 两大去中心化社交生态。

---

## Nostr 协议简介

### 什么是 Nostr?

Nostr (Notes and Other Stuff Transmitted by Relays) 是一个极简的去中心化社交协议。

**核心概念**:

- **Event**: 所有数据单元（帖子、回复、点赞等）
- **Relay**: 消息中继服务器
- **Key Pair**: secp256k1 密钥对作为身份

**与 ActivityPub 的区别**:

| 特性   | Nostr              | ActivityPub     |
| ------ | ------------------ | --------------- |
| 身份   | 密钥对 (npub/nsec) | 域名 + 用户名   |
| 服务器 | Relay (可替换)     | 实例 (绑定)     |
| 协议   | WebSocket + JSON   | HTTP + JSON-LD  |
| 抗审查 | 强 (无服务器依赖)  | 中 (实例可屏蔽) |
| 生态   | Bitcoin 社区       | Mastodon 社区   |

---

## 核心功能

### 1. Nostr 身份管理

将 ChainlessChain DID 与 Nostr 密钥对绑定。

```javascript
// 生成 Nostr 密钥对
const identity = await window.electronAPI.invoke("nostr:create-identity", {
  did: "did:chainless:abc123",
  label: "主账号",
});

console.log(identity);
// {
//   npub: 'npub1...',
//   nsec: 'nsec1...' (加密存储，不直接暴露),
//   did: 'did:chainless:abc123',
//   createdAt: 1709078400000
// }

// 从现有密钥导入
const imported = await window.electronAPI.invoke("nostr:import-identity", {
  nsec: "nsec1...",
  did: "did:chainless:abc123",
});

// 列出所有身份
const identities = await window.electronAPI.invoke("nostr:list-identities");
```

---

### 2. Relay 管理

```javascript
// 添加 Relay
await window.electronAPI.invoke("nostr:add-relay", {
  url: "wss://relay.damus.io",
  read: true,
  write: true,
});

// 列出 Relay
const relays = await window.electronAPI.invoke("nostr:list-relays");
// [
//   { url: 'wss://relay.damus.io', read: true, write: true, status: 'connected' },
//   { url: 'wss://nos.lol', read: true, write: false, status: 'connected' }
// ]

// 移除 Relay
await window.electronAPI.invoke("nostr:remove-relay", {
  url: "wss://relay.damus.io",
});

// 获取 Relay 状态
const status = await window.electronAPI.invoke("nostr:relay-status");
// { connected: 3, disconnected: 1, total: 4 }
```

**数据库结构**:

```sql
CREATE TABLE nostr_relays (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  read_enabled INTEGER DEFAULT 1,
  write_enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'disconnected',
  last_connected INTEGER,
  created_at INTEGER NOT NULL
);
```

---

### 3. 事件发布与订阅

```javascript
// 发布文本笔记 (NIP-01 kind:1)
const event = await window.electronAPI.invoke("nostr:publish-event", {
  kind: 1,
  content: "这是我在 Nostr 上的第一条消息！#ChainlessChain",
  tags: [
    ["t", "ChainlessChain"],
    ["t", "Web3"],
  ],
});

console.log(event);
// {
//   id: 'event-abc123',
//   pubkey: '...',
//   kind: 1,
//   content: '...',
//   sig: '...',
//   relaysPublished: ['wss://relay.damus.io', 'wss://nos.lol']
// }

// 订阅事件
await window.electronAPI.invoke("nostr:subscribe", {
  filters: [
    { kinds: [1], limit: 50 }, // 最新 50 条笔记
    { "#t": ["ChainlessChain"] }, // 标签过滤
    { authors: ["npub1..."] }, // 作者过滤
  ],
});

// 获取订阅的事件
const events = await window.electronAPI.invoke("nostr:get-events", {
  limit: 20,
  since: Math.floor(Date.now() / 1000) - 86400, // 最近 24 小时
});
```

**数据库结构**:

```sql
CREATE TABLE nostr_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  pubkey TEXT NOT NULL,
  kind INTEGER NOT NULL,
  content TEXT,
  tags TEXT,           -- JSON 数组
  sig TEXT NOT NULL,
  relay_url TEXT,
  created_at INTEGER NOT NULL,
  synced_at INTEGER
);
```

---

### 4. 内容同步

ChainlessChain 内容与 Nostr 双向同步。

```javascript
// 将本地帖子发布到 Nostr
await window.electronAPI.invoke("nostr:sync-to-nostr", {
  contentId: "post-123",
  identity: "npub1...",
});

// 将 Nostr 事件导入本地
await window.electronAPI.invoke("nostr:import-event", {
  eventId: "event-abc123",
});

// 批量同步
await window.electronAPI.invoke("nostr:batch-sync", {
  direction: "both", // 'to-nostr' | 'from-nostr' | 'both'
  since: lastSyncTime,
});
```

---

## 前端集成

### Pinia Store

```typescript
import { useNostrBridgeStore } from "@/stores/nostrBridge";

const nostr = useNostrBridgeStore();

// 管理身份
await nostr.createIdentity(did);

// 管理 Relay
await nostr.addRelay(url);

// 发布事件
await nostr.publishNote(content);

// 获取订阅事件
await nostr.fetchEvents();
```

### 前端页面

**Nostr 桥接页面** (`/nostr-bridge`)

**功能模块**:

1. **身份管理**
   - 创建/导入 Nostr 身份
   - DID ↔ npub 映射
   - 密钥备份

2. **Relay 管理**
   - 添加/删除 Relay
   - 连接状态监控
   - 读写权限控制

3. **内容浏览**
   - Nostr 事件流
   - 标签过滤
   - 内容搜索

4. **同步管理**
   - 同步状态
   - 同步历史
   - 冲突处理

---

## 配置选项

```json
{
  "nostr": {
    "enabled": true,
    "defaultRelays": [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.nostr.band"
    ],
    "autoConnect": true,
    "syncInterval": 300000,
    "maxEventsPerRelay": 1000,
    "eventKinds": [0, 1, 3, 5, 7]
  }
}
```

---

## 使用场景

### 场景 1: 跨平台社交

```javascript
// 1. 创建 Nostr 身份
const identity = await window.electronAPI.invoke("nostr:create-identity", {
  did: myDID,
});

// 2. 连接 Relay
await window.electronAPI.invoke("nostr:add-relay", {
  url: "wss://relay.damus.io",
  read: true,
  write: true,
});

// 3. 同时发布到 Nostr 和 ActivityPub
await window.electronAPI.invoke("nostr:publish-event", {
  kind: 1,
  content: "同时发布到 Nostr 和 Fediverse!",
});
await window.electronAPI.invoke("social:ap-publish-local-content", {
  contentId: postId,
  actorURI: actorURI,
});
```

### 场景 2: 抗审查内容存储

```javascript
// Nostr 的多 Relay 架构天然支持抗审查
// 内容同时存储在多个独立 Relay 上
const event = await window.electronAPI.invoke("nostr:publish-event", {
  kind: 1,
  content: "重要内容，存储到多个 Relay",
});

console.log(event.relaysPublished);
// ['wss://relay1.com', 'wss://relay2.com', 'wss://relay3.com']
```

---

## 使用示例

### 示例 1: 连接 Relay 并发布消息

```javascript
// 1. 创建身份并绑定 DID
const identity = await window.electronAPI.invoke("nostr:create-identity", {
  did: "did:chainless:myuser",
  label: "日常账号",
});

// 2. 连接多个 Relay
const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
for (const url of relays) {
  await window.electronAPI.invoke("nostr:add-relay", { url, read: true, write: true });
}

// 3. 确认连接状态
const status = await window.electronAPI.invoke("nostr:relay-status");
console.log(`已连接 ${status.connected}/${status.total} 个 Relay`);

// 4. 发布带标签的消息
await window.electronAPI.invoke("nostr:publish-event", {
  kind: 1,
  content: "ChainlessChain + Nostr 去中心化社交体验！",
  tags: [["t", "ChainlessChain"], ["t", "去中心化"]],
});
```

### 示例 2: 订阅并导入 Nostr 事件

```javascript
// 订阅特定标签和作者的事件
await window.electronAPI.invoke("nostr:subscribe", {
  filters: [{ "#t": ["ChainlessChain"], limit: 20 }],
});

// 获取最近事件并批量导入本地
const events = await window.electronAPI.invoke("nostr:get-events", { limit: 10 });
for (const event of events) {
  await window.electronAPI.invoke("nostr:import-event", { eventId: event.event_id });
}
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| Relay 连接失败 | WebSocket 地址无效或网络不通 | 检查 Relay URL 格式（必须以 `wss://` 开头），确认网络可达 |
| 事件发布无响应 | 未连接任何可写 Relay | 运行 `nostr:relay-status` 确认至少有一个 `write: true` 的连接 |
| 身份创建失败 | DID 未初始化或已绑定其他 npub | 先通过 `did:create` 创建 DID，检查是否已有绑定关系 |
| 签名验证失败 | 本地时钟偏差过大 | 同步系统时间，Nostr 事件依赖 UNIX 时间戳 |
| 同步内容为空 | 订阅过滤条件过严 | 放宽 `filters` 条件，增大 `limit` 值 |
| 批量同步缓慢 | Relay 响应慢或事件量过大 | 减小批量范围，尝试切换到延迟更低的 Relay |
| 密钥导入失败 | nsec 格式错误 | 确认使用 bech32 编码的 nsec 密钥（以 `nsec1` 开头） |

---

## 配置参考

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `nostr.enabled` | boolean | `true` | 是否启用 Nostr 桥接 |
| `nostr.defaultRelays` | string[] | 见下方 | 默认连接的 Relay 列表 |
| `nostr.autoConnect` | boolean | `true` | 启动时是否自动连接 Relay |
| `nostr.syncInterval` | number | `300000` | 事件同步间隔（毫秒） |
| `nostr.maxEventsPerRelay` | number | `1000` | 每个 Relay 最大缓存事件数 |
| `nostr.eventKinds` | number[] | `[0,1,3,5,7]` | 订阅的事件类型（kind 值） |

**配置示例**（`.chainlesschain/config.json`）：

```json
{
  "nostr": {
    "enabled": true,
    "defaultRelays": [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.nostr.band"
    ],
    "autoConnect": true,
    "syncInterval": 60000,
    "maxEventsPerRelay": 500,
    "eventKinds": [0, 1, 3, 7]
  }
}
```

**eventKinds 速查**：

| Kind | 说明 |
| --- | --- |
| `0` | 用户元数据（Profile） |
| `1` | 文本笔记 |
| `3` | 联系人列表 |
| `5` | 事件删除 |
| `7` | 反应（点赞等） |

---

## 测试覆盖率

### 单元测试

| 测试文件 | 覆盖范围 | 测试数 |
| --- | --- | --- |
| `tests/unit/p2p/nostr-bridge.test.js` | 身份管理、事件发布与订阅、内容同步 | 28 |
| `tests/unit/p2p/nostr-relay-pool.test.js` | Relay 连接/断开、读写权限、状态管理 | 16 |
| `tests/unit/p2p/nostr-identity.test.js` | 密钥对生成、nsec 导入/导出、加密存储 | 14 |
| `src/renderer/stores/__tests__/nostrBridge.test.ts` | Pinia store 状态管理 | 12 |

**运行测试**：

```bash
# Nostr 桥接全量测试
cd desktop-app-vue && npx vitest run tests/unit/p2p/nostr-bridge.test.js

# Relay 连接池测试
cd desktop-app-vue && npx vitest run tests/unit/p2p/nostr-relay-pool.test.js

# Store 测试
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/nostrBridge.test.ts
```

### 集成测试要点

- **密钥对生成与导入**: 验证 secp256k1 密钥对生成、bech32 编码的 npub/nsec 格式正确性及 AES-256 加密存储
- **Schnorr 签名验证**: 发布事件后验证签名，确保接收方能通过 `sig` 字段完成验证
- **多 Relay 广播**: 发布事件时测试多 Relay 并发写入，断线 Relay 自动跳过不阻塞
- **NIP-13 PoW 过滤**: mock 低 PoW 难度事件，确认被正确过滤丢弃

---

## 安全考虑

1. **密钥安全**: nsec 私钥使用 AES-256 加密存储，可绑定 U-Key
2. **签名验证**: 所有接收事件验证 Schnorr 签名
3. **Relay 信任**: 支持设置 Relay 信任等级
4. **内容过滤**: NIP-36 内容警告标签支持
5. **垃圾过滤**: PoW 难度要求 (NIP-13)

---

## 支持的 NIP

| NIP    | 名称        | 状态 |
| ------ | ----------- | ---- |
| NIP-01 | 基础协议    | ✅   |
| NIP-02 | 联系人列表  | ✅   |
| NIP-04 | 加密私信    | ✅   |
| NIP-05 | DNS 验证    | ✅   |
| NIP-10 | 回复标签    | ✅   |
| NIP-13 | PoW         | ✅   |
| NIP-19 | bech32 编码 | ✅   |
| NIP-25 | 反应        | ✅   |
| NIP-36 | 内容警告    | ✅   |

---

## 性能指标

| 指标             | 目标   | 实际   |
| ---------------- | ------ | ------ |
| Relay 连接延迟   | <1s    | ~500ms |
| 事件发布延迟     | <500ms | ~300ms |
| 事件订阅延迟     | <200ms | ~100ms |
| 批量同步 (100条) | <5s    | ~3s    |

---

## 相关文档

- [Social AI + ActivityPub](/chainlesschain/social-ai)
- [去中心化社交](/chainlesschain/social)
- [内容推荐](/chainlesschain/content-recommendation)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
