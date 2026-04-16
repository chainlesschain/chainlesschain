# Matrix 协议集成

> **Phase 55 | v1.1.0 | 5 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 🔐 **E2EE 端到端加密**: 基于 Olm/Megolm 协议的消息加密，前向保密与密钥轮换
- 🏠 **房间管理**: 创建/加入/搜索 Matrix 房间，成员管理与权限控制
- 🔗 **DID 身份映射**: ChainlessChain DID 与 Matrix MXID 双向绑定，支持 WebFinger 自动发现
- 🌐 **多协议桥接**: 与 ActivityPub、Nostr 协议统一桥接，跨网络消息互通
- 💬 **消息同步**: 实时消息收发与历史消息回溯，支持表情回应

## 系统架构

```
┌───────────────────────────────────────────────┐
│            前端 (Vue3 Matrix Bridge 页面)      │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ 连接管理  │  │ 房间列表  │  │ 消息视图    │ │
│  └─────┬────┘  └─────┬────┘  └──────┬──────┘ │
└────────┼─────────────┼──────────────┼─────────┘
         │             │              │
         ▼             ▼              ▼
┌───────────────────────────────────────────────┐
│           IPC 通道 (matrix:*)                  │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│          Matrix Bridge Manager                 │
│  ┌────────────┐  ┌────────────┐  ┌─────────┐ │
│  │ 认证管理    │  │ 房间管理    │  │ E2EE    │ │
│  │ (CS API)   │  │ (CS API)   │  │Olm/Megolm│ │
│  └────────────┘  └────────────┘  └─────────┘ │
│  ┌────────────┐  ┌────────────┐               │
│  │ DID 映射   │  │ 消息同步    │               │
│  └────────────┘  └────────────┘               │
└──────────────────────┬────────────────────────┘
                       │ WebSocket / HTTPS
                       ▼
              ┌─────────────────┐
              │ Matrix Homeserver│
              │ (Synapse/Dendrite)│
              └─────────────────┘
```

## 概述

Phase 55 为 ChainlessChain 引入 Matrix 协议桥接能力，支持与 Matrix 网络（Synapse/Dendrite）互通，实现 E2EE 加密群聊、DID 身份映射和跨协议消息同步。

---

## 支持的功能

| 功能          | Matrix 协议    | 状态 |
| ------------- | -------------- | ---- |
| **密码登录**  | CS API         | ✅   |
| **SSO 登录**  | CS API         | ✅   |
| **房间列表**  | CS API         | ✅   |
| **加入房间**  | CS API         | ✅   |
| **发送消息**  | m.room.message | ✅   |
| **消息历史**  | CS API         | ✅   |
| **E2EE 加密** | Olm/Megolm     | ✅   |
| **成员管理**  | m.room.member  | ✅   |
| **表情回应**  | m.reaction     | ✅   |

---

## 核心功能

### 1. 登录认证

```javascript
// 密码登录
const loginResult = await window.electronAPI.invoke("matrix:login", {
  homeserver: "https://matrix.org",
  username: "alice",
  credential: "user-credential-here",
  method: "password",
});

console.log(loginResult);
// {
//   userId: '@alice:matrix.org',
//   accessToken: 'syt_...',
//   deviceId: 'ABCDEFGHIJ',
//   homeserver: 'https://matrix.org',
//   wellKnown: { 'm.homeserver': { 'base_url': 'https://matrix.org' } }
// }

// SSO 登录
const ssoResult = await window.electronAPI.invoke("matrix:login", {
  homeserver: "https://matrix.company.com",
  method: "sso",
  ssoToken: "sso-token-here",
});
```

---

### 2. 房间管理

```javascript
// 获取已加入的房间列表
const rooms = await window.electronAPI.invoke("matrix:list-rooms");

console.log(rooms);
// [
//   {
//     roomId: '!abc:matrix.org',
//     name: 'ChainlessChain 开发者群',
//     topic: '项目开发讨论',
//     isEncrypted: true,
//     memberCount: 42,
//     lastEventAt: 1709078400000,
//     unreadCount: 5
//   },
//   ...
// ]

// 加入房间
const joinResult = await window.electronAPI.invoke("matrix:join-room", {
  roomIdOrAlias: "#chainlesschain:matrix.org",
});

console.log(joinResult);
// {
//   roomId: '!xyz:matrix.org',
//   name: 'ChainlessChain Community',
//   joined: true,
//   memberCount: 128
// }
```

---

### 3. 消息收发

```javascript
// 发送消息
const sendResult = await window.electronAPI.invoke("matrix:send-message", {
  roomId: "!abc:matrix.org",
  body: "Hello from ChainlessChain!",
  msgtype: "m.text",
  encrypted: true, // 使用 E2EE
});

console.log(sendResult);
// {
//   eventId: '$event123:matrix.org',
//   roomId: '!abc:matrix.org',
//   timestamp: 1709078400000,
//   encrypted: true
// }

// 获取消息历史
const messages = await window.electronAPI.invoke("matrix:get-messages", {
  roomId: "!abc:matrix.org",
  limit: 50,
  direction: "backward",
});

console.log(messages);
// {
//   messages: [
//     {
//       eventId: '$event123:matrix.org',
//       sender: '@alice:matrix.org',
//       body: 'Hello from ChainlessChain!',
//       msgtype: 'm.text',
//       timestamp: 1709078400000,
//       encrypted: true
//     },
//     ...
//   ],
//   hasMore: true,
//   nextBatch: 'token...'
// }
```

---

## DID 身份映射

ChainlessChain DID 与 Matrix MXID 双向映射：

```
did:chainless:abc123 ↔ @alice:matrix.org
did:chainless:def456 ↔ @bob:matrix.company.com
```

**映射方式**:

1. **手动绑定**: 用户在设置中关联 DID 和 MXID
2. **WebFinger 发现**: 通过 `.well-known` 自动发现
3. **Profile 标注**: 在 Matrix Profile 中标注 DID

---

## E2EE 加密

基于 Olm/Megolm 协议的端到端加密：

```
发送方                          接收方
  │                                │
  ├── Megolm 会话密钥 ──────────→ │
  │   (通过 Olm 1:1 通道传输)     │
  │                                │
  ├── 消息 + Megolm 加密 ────────→ │
  │                                ├── Megolm 解密
  │                                │
```

**安全特性**:

- 前向保密 (Forward Secrecy)
- 密钥轮换
- 设备验证
- 跨设备密钥共享

---

## 数据库结构

```sql
CREATE TABLE matrix_rooms (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE,
  name TEXT,
  topic TEXT,
  is_encrypted INTEGER DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  last_event_at INTEGER,
  joined_at INTEGER,
  status TEXT DEFAULT 'joined',  -- joined/invited/left
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE matrix_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  event_type TEXT NOT NULL,      -- m.room.message/m.room.member/m.reaction
  content TEXT,                  -- JSON 事件内容
  timestamp INTEGER NOT NULL,
  is_encrypted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

---

## 前端集成

### Pinia Store

```typescript
import { useMatrixBridgeStore } from "@/stores/matrixBridge";

const matrix = useMatrixBridgeStore();

// 登录
await matrix.login({ homeserver, username, password });
console.log(matrix.isLoggedIn); // true

// 获取房间列表
await matrix.fetchRooms();
console.log(matrix.rooms);

// 发送消息
await matrix.sendMessage(roomId, "Hello!");

// 获取消息历史
await matrix.fetchMessages(roomId);
console.log(matrix.currentMessages);
```

### 前端页面

**Matrix 桥接页面** (`/matrix-bridge`)

**功能模块**:

1. **连接管理**
   - Homeserver 配置
   - 登录/登出
   - 连接状态监控

2. **房间列表**
   - 已加入房间展示
   - 房间搜索和加入
   - 加密状态标识

3. **消息视图**
   - 消息历史浏览
   - 实时消息发送
   - E2EE 状态显示

4. **身份映射**
   - DID ↔ MXID 绑定
   - 映射关系管理

---

## 配置选项

```json
{
  "matrix": {
    "enabled": true,
    "defaultHomeserver": "https://matrix.org",
    "e2eeEnabled": true,
    "syncInterval": 30000,
    "messageRetention": 90,
    "maxRooms": 100,
    "didMapping": {
      "enabled": true,
      "autoDiscover": true
    }
  }
}
```

---

## 与其他协议的关系

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  ActivityPub │  │    Nostr     │  │   Matrix     │
│  (Phase 42)  │  │  (Phase 49)  │  │  (Phase 55)  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       └────────────┬────┴─────────────────┘
                    │
           ┌────────┴────────┐
           │ 统一协议桥接层   │
           │ ChainlessChain  │
           └────────┬────────┘
                    │
              DID 身份映射
```

---

## 使用示例

### 示例 1: E2EE 加密消息收发

```javascript
// 1. 登录 Matrix Homeserver
const login = await window.electronAPI.invoke("matrix:login", {
  homeserver: "https://matrix.org",
  username: "alice",
  credential: "secure-password",
  method: "password",
});
console.log(`登录成功: ${login.userId}, 设备: ${login.deviceId}`);

// 2. 加入加密房间
const room = await window.electronAPI.invoke("matrix:join-room", {
  roomIdOrAlias: "#chainlesschain-dev:matrix.org",
});

// 3. 发送 E2EE 加密消息
await window.electronAPI.invoke("matrix:send-message", {
  roomId: room.roomId,
  body: "这条消息使用端到端加密传输",
  msgtype: "m.text",
  encrypted: true,
});
```

### 示例 2: 房间管理与消息历史

```javascript
// 获取已加入的所有房间
const rooms = await window.electronAPI.invoke("matrix:list-rooms");
console.log(`已加入 ${rooms.length} 个房间`);

// 查看指定房间的历史消息
const history = await window.electronAPI.invoke("matrix:get-messages", {
  roomId: rooms[0].roomId,
  limit: 30,
  direction: "backward",
});

// 遍历消息，显示加密状态
history.messages.forEach(msg => {
  console.log(`[${msg.encrypted ? "加密" : "明文"}] ${msg.sender}: ${msg.body}`);
});
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 登录失败 | Homeserver 地址错误或凭证无效 | 检查 homeserver URL（含 `https://`），确认用户名密码正确 |
| E2EE 解密失败 | 密钥未同步或设备未验证 | 在 Matrix 客户端中验证设备，确保密钥备份已导入 |
| 房间列表为空 | 未完成初始同步 | 等待 `syncInterval` 周期完成首次同步（默认 30 秒） |
| 消息发送超时 | 网络中断或 Homeserver 不可达 | 检查网络连接，确认 Homeserver 服务正常运行 |
| DID 映射失败 | WebFinger 服务未配置 | 手动在设置中绑定 DID 和 MXID，或配置 `.well-known` 文件 |
| SSO 登录报错 | Token 过期或 SSO Provider 异常 | 重新获取 SSO Token，检查企业 IdP 服务状态 |
| 加入房间被拒 | 房间设置为邀请制 | 联系房间管理员获取邀请，或搜索公开房间加入 |

---

## 配置参考

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `matrix.enabled` | boolean | `true` | 是否启用 Matrix 桥接 |
| `matrix.defaultHomeserver` | string | `"https://matrix.org"` | 默认 Homeserver 地址 |
| `matrix.e2eeEnabled` | boolean | `true` | 是否默认启用 E2EE 加密 |
| `matrix.syncInterval` | number | `30000` | 消息同步间隔（毫秒） |
| `matrix.messageRetention` | number | `90` | 本地消息保留天数 |
| `matrix.maxRooms` | number | `100` | 最大房间缓存数量 |
| `matrix.didMapping.enabled` | boolean | `true` | 是否启用 DID 身份映射 |
| `matrix.didMapping.autoDiscover` | boolean | `true` | 是否通过 WebFinger 自动发现映射 |

**配置示例**（`.chainlesschain/config.json`）：

```json
{
  "matrix": {
    "enabled": true,
    "defaultHomeserver": "https://matrix.example.com",
    "e2eeEnabled": true,
    "syncInterval": 15000,
    "messageRetention": 30,
    "maxRooms": 50,
    "didMapping": {
      "enabled": true,
      "autoDiscover": false
    }
  }
}
```

---

## 测试覆盖

### 单元测试

| 测试文件 | 覆盖范围 | 测试数 |
| --- | --- | --- |
| `tests/unit/p2p/matrix-bridge.test.js` | 登录认证、房间管理、消息收发 | 24 |
| `tests/unit/p2p/matrix-e2ee.test.js` | Olm/Megolm 加解密、密钥轮换 | 18 |
| `tests/unit/p2p/matrix-did-mapper.test.js` | DID ↔ MXID 映射、WebFinger 发现 | 12 |
| `src/renderer/stores/__tests__/matrixBridge.test.ts` | Pinia store 状态管理 | 16 |

**运行测试**：

```bash
# Matrix 桥接全量测试
cd desktop-app-vue && npx vitest run tests/unit/p2p/matrix-bridge.test.js

# E2EE 加密测试
cd desktop-app-vue && npx vitest run tests/unit/p2p/matrix-e2ee.test.js

# Store 测试
cd desktop-app-vue && npx vitest run src/renderer/stores/__tests__/matrixBridge.test.ts
```

### 集成测试要点

- **登录认证**: 测试密码登录和 SSO 登录两种流程，mock Homeserver CS API 响应
- **E2EE 加解密**: 验证 Olm 1:1 会话建立与 Megolm 群组加密的密钥交换流程
- **DID 映射**: 测试手动绑定和 WebFinger 自动发现两种映射方式
- **断线重连**: 模拟 Homeserver 断开，验证 `syncInterval` 触发重连逻辑

---

## 安全考虑

1. **E2EE 默认**: 所有房间默认启用端到端加密
2. **密钥管理**: 加密密钥安全存储在本地
3. **Token 保护**: Access Token 使用 AES-256 加密存储
4. **设备验证**: 支持交叉签名设备验证
5. **消息脱敏**: 本地缓存的消息可配置自动清理

---

## 性能指标

| 指标         | 目标   | 实际   |
| ------------ | ------ | ------ |
| 登录延迟     | <3s    | ~2s    |
| 房间列表加载 | <1s    | ~500ms |
| 消息发送延迟 | <500ms | ~300ms |
| E2EE 加解密  | <50ms  | ~30ms  |

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/p2p/matrix-bridge.js` | Matrix 桥接管理器核心，CS API 交互 |
| `src/main/p2p/matrix-e2ee.js` | Olm/Megolm 端到端加密实现 |
| `src/main/p2p/matrix-did-mapper.js` | DID 与 MXID 双向映射管理 |
| `src/renderer/stores/matrixBridge.ts` | Pinia 状态管理 |
| `src/renderer/pages/MatrixBridge.vue` | Matrix 桥接前端页面 |

## 相关文档

- [去中心化社交](/chainlesschain/social)
- [Nostr 桥接](/chainlesschain/nostr-bridge)
- [Social AI + ActivityPub](/chainlesschain/social-ai)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
