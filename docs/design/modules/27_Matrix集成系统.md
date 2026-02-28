# Phase 55 — Matrix 集成系统设计

**版本**: v1.1.0
**创建日期**: 2026-02-28
**状态**: ✅ 已实现 (v1.1.0-alpha)

---

## 一、模块概述

Phase 55 实现 Matrix 协议桥接，支持与 Matrix 去中心化通信网络的互操作，包括 E2EE 加密消息。

### 1.1 核心目标

1. **Matrix CS API**: Client-Server API 登录认证
2. **房间管理**: 列出/加入 Matrix 房间
3. **E2EE 消息**: 端到端加密消息收发
4. **DID 映射**: ChainlessChain DID 与 Matrix 用户ID映射

### 1.2 技术架构

```
┌──────────────────────────────────────────────────────┐
│                   Renderer Process                   │
│  Pinia Store (matrixBridge.ts)                       │
│  MatrixBridgePage.vue                                │
└───────────────────────┬──────────────────────────────┘
                        │ IPC (5 channels)
┌───────────────────────┼──────────────────────────────┐
│                       ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ Matrix Bridge (matrix-bridge.js)            │    │
│  │ - CS API Login                              │    │
│  │ - Room Management                           │    │
│  │ - E2EE Messaging (m.room.encrypted)         │    │
│  │ - DID ↔ Matrix User Mapping                 │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
            ┌──────────────────┐
            │  Matrix          │
            │  Homeserver      │
            │  (CS API)        │
            └──────────────────┘
```

---

## 二、核心模块设计

### 2.1 Matrix Bridge

**文件**: `desktop-app-vue/src/main/social/matrix-bridge.js` (ES6 Module)

**事件类型**:

```javascript
const MATRIX_EVENT_TYPES = {
  MESSAGE: "m.room.message", // 消息
  MEMBER: "m.room.member", // 成员变更
  CREATE: "m.room.create", // 房间创建
  ENCRYPTED: "m.room.encrypted", // 加密消息
  REACTION: "m.reaction", // 反应
};
```

**登录状态**:

```javascript
const LOGIN_STATE = {
  LOGGED_OUT: "logged_out",
  LOGGING_IN: "logging_in",
  LOGGED_IN: "logged_in",
  ERROR: "error",
};
```

**API**:

```javascript
class MatrixBridge extends EventEmitter {
  async initialize()
  async login({ homeserver, userId, password })      // CS API 登录
  async listRooms()                                    // 列出已加入房间
  async sendMessage({ roomId, body, msgtype = "m.text" }) // 发送消息
  async getMessages({ roomId, limit = 50, since })     // 获取房间消息
  async joinRoom({ roomIdOrAlias })                    // 加入房间
  getLoginState()                                       // 获取登录状态
  async close()
}
```

**登录状态返回值**:

```javascript
{
  state: "logged_in",      // LOGIN_STATE
  userId: "@user:matrix.org",
  homeserver: "https://matrix.org",
  e2eeEnabled: true
}
```

---

## 三、数据库设计

### 3.1 matrix_rooms (Matrix 房间)

```sql
CREATE TABLE IF NOT EXISTS matrix_rooms (
  id TEXT PRIMARY KEY,
  room_id TEXT UNIQUE NOT NULL,
  name TEXT,
  topic TEXT,
  is_encrypted INTEGER DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  last_event_at INTEGER,
  joined_at INTEGER,
  status TEXT DEFAULT 'joined',
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_matrix_rooms_room_id ON matrix_rooms(room_id);
CREATE INDEX IF NOT EXISTS idx_matrix_rooms_status ON matrix_rooms(status);
```

### 3.2 matrix_events (Matrix 事件)

```sql
CREATE TABLE IF NOT EXISTS matrix_events (
  id TEXT PRIMARY KEY,
  event_id TEXT UNIQUE,
  room_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  event_type TEXT NOT NULL,
  content TEXT,
  origin_server_ts INTEGER,
  is_encrypted INTEGER DEFAULT 0,
  decrypted_content TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_matrix_events_room_id ON matrix_events(room_id);
CREATE INDEX IF NOT EXISTS idx_matrix_events_sender ON matrix_events(sender);
CREATE INDEX IF NOT EXISTS idx_matrix_events_type ON matrix_events(event_type);
```

---

## 四、IPC 接口设计

**文件**: `desktop-app-vue/src/main/social/matrix-ipc.js` (ES6 Module)

5个处理器:

- `matrix:login` - 登录 Matrix Homeserver
- `matrix:list-rooms` - 列出已加入房间
- `matrix:send-message` - 发送消息
- `matrix:get-messages` - 获取房间消息
- `matrix:join-room` - 加入房间

---

## 五、前端集成

### 5.1 Pinia Store (`stores/matrixBridge.ts`)

```typescript
interface MatrixRoom {
  id: string; room_id: string; name: string; topic: string;
  is_encrypted: number; member_count: number;
  last_event_at: number | null; status: string;
}

interface MatrixMessage {
  id: string; event_id: string; room_id: string;
  sender: string; event_type: string; content: any;
  origin_server_ts: number; is_encrypted: number;
}

const useMatrixBridgeStore = defineStore('matrixBridge', {
  state: () => ({
    rooms: [], messages: [],
    loginState: 'logged_out', userId: null,
    homeserver: 'https://matrix.org',
    loading: false, error: null,
  }),
  getters: {
    isLoggedIn,     // 是否已登录
    encryptedRooms, // 加密房间
    roomCount,      // 房间总数
  },
  actions: {
    login(), fetchRooms(), sendMessage(),
    fetchMessages(), joinRoom(),
  }
})
```

### 5.2 UI 页面 (`pages/social/MatrixBridgePage.vue`)

- 登录面板 (Homeserver、用户ID、密码)
- 房间列表 (名称、主题、成员数、加密状态锁图标)
- 消息时间线 (发送者、内容、时间戳、加密标志)
- 房间加入搜索 (房间ID或别名)

---

## 六、配置选项

```javascript
matrix: {
  enabled: true,
  defaultHomeserver: "https://matrix.org",
  e2eeEnabled: true,             // 端到端加密
  syncInterval: 30,              // 同步间隔 (秒)
  messageRetention: 90,          // 消息保留天数
  maxRooms: 100,                 // 最大房间数
  mediaCacheSize: 104857600      // 媒体缓存 (100MB)
}
```

---

## 七、Matrix 协议兼容性

| 功能     | Matrix 规范      | 支持状态    |
| -------- | ---------------- | ----------- |
| 用户登录 | CS API r0.6.1    | ✅ 已实现   |
| 房间管理 | CS API           | ✅ 已实现   |
| 文本消息 | m.room.message   | ✅ 已实现   |
| E2EE     | m.room.encrypted | ✅ 已实现   |
| 反应     | m.reaction       | ✅ 事件类型 |
| 成员管理 | m.room.member    | ✅ 事件类型 |

---

## 八、测试覆盖

- ✅ `matrix-bridge.test.js` - CS API、房间管理、消息
- ✅ `matrix-ipc.test.js` - IPC处理器
- ✅ `matrixBridge.test.ts` - Pinia Store

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-28
