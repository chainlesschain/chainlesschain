# Phase 49 — Nostr Bridge 系统设计

**版本**: v1.1.0
**创建日期**: 2026-02-28
**状态**: ✅ 已实现 (v1.1.0-alpha)

---

## 一、模块概述

Phase 49 实现 Nostr 协议桥接，支持 ChainlessChain DID 身份与 Nostr 去中心化社交网络的互操作。

### 1.1 核心目标

1. **Nostr 中继管理**: 添加、连接、断开 Nostr 中继服务器
2. **事件发布/订阅**: 支持 NIP-01 基础事件类型
3. **DID-Nostr 映射**: ChainlessChain DID 与 Nostr npub/nsec 双向映射
4. **密钥对生成**: 生成 Nostr 兼容的 secp256k1 密钥对

### 1.2 技术架构

```
┌──────────────────────────────────────────────────────┐
│                   Renderer Process                   │
│  Pinia Store (nostrBridge.ts)                        │
│  NostrBridgePage.vue                                 │
└───────────────────────┬──────────────────────────────┘
                        │ IPC (6 channels)
┌───────────────────────┼──────────────────────────────┐
│                       ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ Nostr Bridge (nostr-bridge.js)              │    │
│  │ - Relay Management (add/remove/connect)     │    │
│  │ - Event Publishing (NIP-01)                 │    │
│  │ - Event Storage (local SQLite)              │    │
│  └───────────────┬─────────────────────────────┘    │
│                  │                                   │
│  ┌───────────────┼─────────────────────────────┐    │
│  │ Nostr Identity (nostr-identity.js)          │    │
│  │ - secp256k1 Key Generation                  │    │
│  │ - DID ↔ Nostr Mapping                       │    │
│  │ - npub/nsec Encoding                        │    │
│  └─────────────────────────────────────────────┘    │
│                  │                                   │
│  ┌───────────────┼─────────────────────────────┐    │
│  │ Platform Bridge (platform-bridge.js)        │    │
│  │ - 委派到 NostrBridge 处理 Nostr 事件        │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
            ┌──────────────────┐
            │  Nostr Relays    │
            │  (wss://...)     │
            └──────────────────┘
```

---

## 二、核心模块设计

### 2.1 Nostr Bridge

**文件**: `desktop-app-vue/src/main/social/nostr-bridge.js` (ES6 Module)

**事件类型常量** (NIP-01):

```javascript
const EVENT_KINDS = {
  SET_METADATA: 0, // 用户元数据
  TEXT_NOTE: 1, // 文本笔记
  RECOMMEND_RELAY: 2, // 推荐中继
  CONTACTS: 3, // 联系人列表
  ENCRYPTED_DM: 4, // 加密私信 (NIP-04)
  DELETE: 5, // 删除事件
  REPOST: 6, // 转发
  REACTION: 7, // 反应 (NIP-25)
};
```

**API**:

```javascript
class NostrBridge extends EventEmitter {
  async initialize()
  async addRelay(url)           // 添加中继
  async removeRelay(url)        // 移除中继
  async connectRelay(url)       // 连接中继
  async disconnectRelay(url)    // 断开中继
  async publishEvent({ kind, content, tags = [], pubkey }) // 发布事件
  async getEvents({ kinds, limit = 50, since })           // 获取事件
  async listRelays()            // 列出所有中继
}
```

### 2.2 Nostr Identity

**文件**: `desktop-app-vue/src/main/social/nostr-identity.js` (ES6 Module)

**功能**:

- secp256k1 密钥对生成
- hex → npub/nsec bech32 格式编码
- DID ↔ Nostr 身份双向映射 (内存 Map)

**API**:

```javascript
class NostrIdentity extends EventEmitter {
  async initialize()
  async generateKeyPair()                          // 生成 Nostr 密钥对
  async mapDIDToNostr({ did, npub, nsec })         // 映射 DID 到 Nostr
  async getNostrKeyForDID(did)                     // 查询 DID 的 Nostr 密钥
  async getDIDForNpub(npub)                        // 反向查询
  async listMappings()                             // 列出所有映射
}
```

---

## 三、数据库设计

### 3.1 nostr_relays (Nostr 中继)

```sql
CREATE TABLE IF NOT EXISTS nostr_relays (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'disconnected',
  last_connected INTEGER,
  event_count INTEGER DEFAULT 0,
  read_enabled INTEGER DEFAULT 1,
  write_enabled INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_nostr_relays_url ON nostr_relays(url);
CREATE INDEX IF NOT EXISTS idx_nostr_relays_status ON nostr_relays(status);
```

### 3.2 nostr_events (Nostr 事件)

```sql
CREATE TABLE IF NOT EXISTS nostr_events (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  kind INTEGER NOT NULL,
  content TEXT,
  tags TEXT,
  sig TEXT,
  created_at INTEGER NOT NULL,
  relay_url TEXT,
  imported INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_nostr_events_pubkey ON nostr_events(pubkey);
CREATE INDEX IF NOT EXISTS idx_nostr_events_kind ON nostr_events(kind);
CREATE INDEX IF NOT EXISTS idx_nostr_events_created_at ON nostr_events(created_at);
CREATE INDEX IF NOT EXISTS idx_nostr_events_relay_url ON nostr_events(relay_url);
```

---

## 四、IPC 接口设计

**文件**: `desktop-app-vue/src/main/social/nostr-bridge-ipc.js` (ES6 Module)

### 4.1 中继管理 IPC (2个)

- `nostr:list-relays` - 列出所有中继
- `nostr:add-relay` - 添加中继

### 4.2 事件 IPC (2个)

- `nostr:publish-event` - 发布 Nostr 事件
- `nostr:get-events` - 获取本地存储的事件

### 4.3 身份 IPC (2个)

- `nostr:generate-keypair` - 生成 Nostr 密钥对
- `nostr:map-did` - 映射 DID 到 Nostr 身份

---

## 五、前端集成

### 5.1 Pinia Store (`stores/nostrBridge.ts`)

```typescript
interface NostrRelay {
  id: string; url: string; status: string;
  event_count: number; read_enabled: number; write_enabled: number;
}

interface NostrEvent {
  id: string; pubkey: string; kind: number;
  content: string; tags: string; sig: string;
  created_at: number; relay_url: string;
}

const useNostrBridgeStore = defineStore('nostrBridge', {
  state: () => ({
    relays: [], events: [], keypair: null,
    loading: false, error: null,
  }),
  getters: {
    connectedRelays, // 已连接中继
    textNotes,       // kind=1 文本笔记
  },
  actions: {
    fetchRelays(), addRelay(), publishEvent(),
    fetchEvents(), generateKeypair(), mapDID(),
  }
})
```

### 5.2 UI 页面 (`pages/social/NostrBridgePage.vue`)

- 中继服务器列表 (URL、状态、事件计数、读写开关)
- 事件发布表单 (kind选择、内容、标签)
- 事件浏览时间线 (按kind过滤)
- DID↔Nostr 身份映射管理

---

## 六、配置选项

```javascript
nostr: {
  enabled: true,
  defaultRelays: [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band"
  ],
  autoConnect: false,
  maxEventsPerRelay: 1000,
  eventRetention: 30 // 天
}
```

---

## 七、Nostr 协议兼容性

| NIP    | 名称              | 支持状态    |
| ------ | ----------------- | ----------- |
| NIP-01 | 基础协议          | ✅ 已实现   |
| NIP-02 | 联系人列表        | ✅ 已实现   |
| NIP-04 | 加密私信          | ✅ 事件类型 |
| NIP-25 | 反应              | ✅ 事件类型 |
| NIP-19 | bech32编码 (npub) | ✅ 已实现   |

---

## 八、测试覆盖

- ✅ `nostr-bridge.test.js` - 中继管理、事件发布
- ✅ `nostr-identity.test.js` - 密钥生成、DID映射
- ✅ `nostr-bridge-ipc.test.js` - IPC处理器
- ✅ `nostrBridge.test.ts` - Pinia Store

---

## 实现更新记录

### 2026-04-12 — 真实 WebSocket 连接替换 mock

原 `nostr-bridge.js` 使用 mock WebSocket 对象，`publishEvent()` 的 `ws.send()` 为注释 stub。已替换为真实实现：

- 使用 `ws` 模块建立真实 WebSocket 连接
- 完整 NIP-01 消息处理: `["EVENT", ...]`、`["EOSE", ...]`、`["OK", ...]`、`["NOTICE", ...]`
- 指数退避重连: 1s → 2s → 4s → ... → 60s 最大间隔
- `publishEvent()` 实际调用 `ws.send()` 发送到所有已连接中继
- 连接状态独立追踪: `connected` / `disconnected` / `error`

新增测试: `nostr-bridge-ws.test.js` (26 tests)

详见: [85_文档代码差距补全.md §2.1](./85_文档代码差距补全.md)

---

**文档版本**: 1.1.0
**最后更新**: 2026-04-12
