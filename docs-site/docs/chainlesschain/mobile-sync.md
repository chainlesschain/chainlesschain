# 移动端同步

> **版本: v0.35.0+ | 双向增量同步 | 3种冲突解决策略 | 离线队列**

移动端同步模块（`MobileSyncManager`）实现桌面端与移动端之间的数据双向同步，支持知识库、联系人、群聊、消息和设置五大数据类别的增量同步，内置三种冲突解决策略及离线队列管理。

**源码位置**: `desktop-app-vue/src/main/sync/mobile-sync-manager.js`

---

## 系统概述

MobileSyncManager 继承自 Node.js `EventEmitter`，通过 P2P 通道在桌面端与已注册的移动设备之间进行数据同步。核心设计要点：

- **增量同步**: 基于 `updated_at` / `created_at` 时间戳，仅同步上次同步后发生变更的数据
- **批量传输**: 大量数据自动分批（默认每批 100 条），避免单次传输过大
- **并行同步**: 各数据类别（知识库、联系人、群聊、消息）并行执行，通过 `Promise.allSettled` 保证部分失败不影响其他类别
- **双向同步**: 桌面端主动推送变更到移动端，同时接受移动端上传的变更
- **离线队列**: 设备离线时变更进入队列，设备恢复在线后自动同步
- **事件驱动**: 全程通过事件通知同步进度、完成状态和冲突信息

```
┌─────────────────────────────────────────────────────┐
│              MobileSyncManager                       │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ 设备管理  │  │ 同步引擎  │  │  冲突解决引擎    │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│       │              │               │              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ 离线队列  │  │ 进度跟踪  │  │  统计收集器      │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│                      │                              │
│              ┌───────┴───────┐                      │
│              │  P2P Manager  │                      │
│              └───────────────┘                      │
└─────────────────────────────────────────────────────┘
```

---

## 核心功能

### 设备注册与发现

移动设备在使用同步功能前，需要通过 `registerMobileDevice()` 向桌面端注册。注册后系统会：

1. 记录设备信息（peerId、deviceInfo、注册时间）
2. 将设备状态设为 `online`
3. 初始化该设备的同步时间记录（各类别均为 0，即首次全量同步）
4. 触发 `device:registered` 事件
5. 立即执行一次全量同步

```javascript
// 注册移动设备
await mobileSyncManager.registerMobileDevice(
  "device-001", // 设备唯一ID
  "peer-abc123", // P2P节点ID
  {
    // 设备信息
    name: "My Android",
    platform: "android",
    version: "1.0.0",
  },
);

// 注销设备（标记为离线）
mobileSyncManager.unregisterMobileDevice("device-001");
```

### 双向数据同步

同步分为两个方向：

**桌面端 -> 移动端（推送）**：

- `startSync(deviceId)` 查询本地数据库中自上次同步以来的变更
- 通过 P2P 通道将变更批量发送给移动设备
- 支持 `upsert`（插入/更新）和 `delete`（软删除）两种变更类型

**移动端 -> 桌面端（接收）**：

- `handleMobileSyncRequest(deviceId, payload)` 处理来自移动端的同步请求
- 根据 payload 类型分发到对应的 apply 方法
- 变更直接写入本地 SQLite 数据库

### 增量同步

每次同步完成后，系统记录各数据类别的同步时间戳。下次同步时仅查询该时间戳之后的变更：

```sql
-- 知识库增量查询示例
SELECT id, title, content, tags, category, updated_at, deleted
FROM notes
WHERE updated_at > ?    -- ? = 上次同步时间
ORDER BY updated_at ASC
```

各数据类别的增量查询字段：

| 数据类别 | 查询表                          | 时间字段     | 变更类型        |
| -------- | ------------------------------- | ------------ | --------------- |
| 知识库   | `notes`                         | `updated_at` | upsert / delete |
| 联系人   | `contacts`                      | `updated_at` | upsert / delete |
| 群聊     | `group_chats` + `group_members` | `updated_at` | upsert          |
| 消息     | `group_messages`                | `created_at` | insert          |

### 冲突解决

当桌面端和移动端同时修改同一条数据时，系统通过冲突解决策略处理：

| 策略     | 标识          | 说明                                             |
| -------- | ------------- | ------------------------------------------------ |
| 最新优先 | `latest-wins` | 以 `updated_at` 时间戳较新的一方为准（默认策略） |
| 手动解决 | `manual`      | 检测到冲突后暂停，通过事件通知用户手动选择       |
| 智能合并 | `merge`       | 尝试在字段级别合并两端的变更                     |

冲突检测与解决时，系统触发以下事件：

- `conflict:detected` -- 发现数据冲突
- `conflict:resolved` -- 冲突已解决

### 离线队列

当目标设备处于离线状态时，变更自动进入离线队列（`offlineQueue`）。队列按设备 ID 分组管理，设备重新上线后队列中的变更将被自动同步。

```
设备离线 -> 变更入队 -> 设备上线 -> 自动消费队列 -> 完成同步
```

---

## 同步范围

MobileSyncManager 支持 5 个数据类别的同步，均可通过配置独立开关控制：

| 数据类别 | 配置项           | 默认值 | 数据库表                       | 说明                       |
| -------- | ---------------- | ------ | ------------------------------ | -------------------------- |
| 知识库   | `syncKnowledge`  | `true` | `notes`                        | 笔记标题、内容、标签、分类 |
| 联系人   | `syncContacts`   | `true` | `contacts`                     | DID、昵称、头像、状态      |
| 群聊     | `syncGroupChats` | `true` | `group_chats`, `group_members` | 群信息、群成员列表         |
| 消息     | `syncMessages`   | `true` | `group_messages`               | 群聊消息（文本、图片等）   |
| 设置     | `syncSettings`   | `true` | --                             | 用户偏好设置               |

### 各类别同步数据结构

**知识库变更**：

```json
{
  "type": "upsert",
  "entity": "note",
  "id": "note-uuid",
  "data": {
    "title": "笔记标题",
    "content": "笔记内容",
    "tags": "标签1,标签2",
    "category": "分类名",
    "updated_at": 1709000000000
  },
  "timestamp": 1709000000000
}
```

**联系人变更**：

```json
{
  "type": "upsert",
  "entity": "contact",
  "id": "did:example:abc123",
  "data": {
    "nickname": "用户昵称",
    "avatar": "avatar-url",
    "status": "online",
    "updated_at": 1709000000000
  },
  "timestamp": 1709000000000
}
```

**群聊变更**：

```json
{
  "type": "upsert",
  "entity": "group",
  "id": "group-uuid",
  "data": {
    "name": "群名称",
    "description": "群描述",
    "avatar": "group-avatar-url",
    "creator_did": "did:example:creator",
    "member_count": 5,
    "members": [
      {
        "member_did": "did:example:m1",
        "role": "admin",
        "nickname": "管理员",
        "joined_at": 1709000000000
      }
    ],
    "updated_at": 1709000000000
  },
  "timestamp": 1709000000000
}
```

**消息变更**：

```json
{
  "type": "insert",
  "entity": "message",
  "id": "msg-uuid",
  "data": {
    "group_id": "group-uuid",
    "sender_did": "did:example:sender",
    "content": "消息内容",
    "message_type": "text",
    "created_at": 1709000000000
  },
  "timestamp": 1709000000000
}
```

---

## 冲突解决策略

### latest-wins（最新优先）

默认策略。比较两端数据的 `updated_at` 时间戳，时间较新的版本覆盖旧版本。

**适用场景**: 大多数常规使用场景，单用户多设备同步。

### manual（手动解决）

检测到冲突时暂停同步，触发 `conflict:detected` 事件，由用户在界面上手动选择保留哪个版本。

**适用场景**: 对数据准确性要求较高的场景，如重要笔记编辑。

### merge（智能合并）

在字段级别尝试合并两端的变更。如果两端修改了不同字段则自动合并，修改了同一字段则回退到 `latest-wins` 策略。

**适用场景**: 协作编辑场景，多人同时编辑不同字段。

---

## 配置参考

### 构造函数选项

| 参数               | 类型      | 默认值          | 说明                                             |
| ------------------ | --------- | --------------- | ------------------------------------------------ |
| `syncInterval`     | `number`  | `30000`         | 自动同步间隔，单位毫秒（30秒）                   |
| `batchSize`        | `number`  | `100`           | 批量传输大小，每批最多发送的记录数               |
| `enableAutoSync`   | `boolean` | `true`          | 是否启用自动定时同步                             |
| `syncKnowledge`    | `boolean` | `true`          | 是否同步知识库                                   |
| `syncContacts`     | `boolean` | `true`          | 是否同步联系人                                   |
| `syncGroupChats`   | `boolean` | `true`          | 是否同步群聊                                     |
| `syncMessages`     | `boolean` | `true`          | 是否同步消息                                     |
| `syncSettings`     | `boolean` | `true`          | 是否同步设置                                     |
| `conflictStrategy` | `string`  | `'latest-wins'` | 冲突解决策略：`latest-wins` / `manual` / `merge` |

### 配置示例

```javascript
const mobileSyncManager = new MobileSyncManager(database, p2pManager, {
  syncInterval: 60000, // 60秒同步一次
  batchSize: 50, // 每批50条
  enableAutoSync: true,
  syncKnowledge: true,
  syncContacts: true,
  syncGroupChats: true,
  syncMessages: true,
  syncSettings: false, // 不同步设置
  conflictStrategy: "merge", // 使用智能合并策略
});
```

---

## API 参考

### 设备管理

| 方法                                                 | 参数                                                       | 返回值          | 说明                           |
| ---------------------------------------------------- | ---------------------------------------------------------- | --------------- | ------------------------------ |
| `registerMobileDevice(deviceId, peerId, deviceInfo)` | `deviceId: string`, `peerId: string`, `deviceInfo: Object` | `Promise<void>` | 注册移动设备并立即触发全量同步 |
| `unregisterMobileDevice(deviceId)`                   | `deviceId: string`                                         | `void`          | 注销设备（标记为离线）         |
| `getMobileDevices()`                                 | --                                                         | `Array<Object>` | 获取所有已注册移动设备列表     |

### 同步控制

| 方法                                         | 参数                                   | 返回值          | 说明                     |
| -------------------------------------------- | -------------------------------------- | --------------- | ------------------------ |
| `startSync(deviceId, options?)`              | `deviceId: string`, `options?: Object` | `Promise<void>` | 手动触发对指定设备的同步 |
| `startAutoSync()`                            | --                                     | `void`          | 启动自动同步定时器       |
| `handleMobileSyncRequest(deviceId, payload)` | `deviceId: string`, `payload: Object`  | `Promise<void>` | 处理来自移动端的同步请求 |

### 分类同步

| 方法                              | 参数                                | 返回值                    | 说明           |
| --------------------------------- | ----------------------------------- | ------------------------- | -------------- |
| `syncKnowledge(deviceId, since)`  | `deviceId: string`, `since: number` | `Promise<{type, synced}>` | 同步知识库变更 |
| `syncContacts(deviceId, since)`   | `deviceId: string`, `since: number` | `Promise<{type, synced}>` | 同步联系人变更 |
| `syncGroupChats(deviceId, since)` | `deviceId: string`, `since: number` | `Promise<{type, synced}>` | 同步群聊变更   |
| `syncMessages(deviceId, since)`   | `deviceId: string`, `since: number` | `Promise<{type, synced}>` | 同步消息变更   |

### 变更应用

| 方法                              | 参数             | 返回值          | 说明                             |
| --------------------------------- | ---------------- | --------------- | -------------------------------- |
| `applyKnowledgeChanges(changes)`  | `changes: Array` | `Promise<void>` | 将移动端知识库变更写入本地数据库 |
| `applyContactsChanges(changes)`   | `changes: Array` | `Promise<void>` | 将移动端联系人变更写入本地数据库 |
| `applyGroupChatsChanges(changes)` | `changes: Array` | `Promise<void>` | 将移动端群聊变更写入本地数据库   |
| `applyMessagesChanges(changes)`   | `changes: Array` | `Promise<void>` | 将移动端消息变更写入本地数据库   |

### 辅助方法

| 方法         | 参数 | 返回值   | 说明               |
| ------------ | ---- | -------- | ------------------ |
| `getStats()` | --   | `Object` | 获取同步统计信息   |
| `cleanup()`  | --   | `void`   | 清理同步状态和资源 |

---

## 事件

MobileSyncManager 继承 EventEmitter，支持以下事件：

| 事件名                | 负载数据                                      | 触发时机                 |
| --------------------- | --------------------------------------------- | ------------------------ |
| `device:registered`   | `{ deviceId, peerId, deviceInfo }`            | 移动设备注册成功         |
| `device:unregistered` | `{ deviceId }`                                | 移动设备注销             |
| `sync:started`        | `{ deviceId }`                                | 同步开始                 |
| `sync:progress`       | `{ deviceId, type, progress }`                | 同步进度更新（0~1）      |
| `sync:completed`      | `{ deviceId, results }`                       | 同步完成（含各类别结果） |
| `sync:failed`         | `{ deviceId, error }`                         | 同步失败                 |
| `conflict:detected`   | `{ deviceId, entity, localData, remoteData }` | 检测到数据冲突           |
| `conflict:resolved`   | `{ deviceId, entity, resolution }`            | 冲突已解决               |

### 事件监听示例

```javascript
mobileSyncManager.on("sync:started", ({ deviceId }) => {
  console.log(`设备 ${deviceId} 开始同步...`);
});

mobileSyncManager.on("sync:progress", ({ deviceId, type, progress }) => {
  console.log(`${type} 同步进度: ${(progress * 100).toFixed(1)}%`);
});

mobileSyncManager.on("sync:completed", ({ deviceId, results }) => {
  console.log(`设备 ${deviceId} 同步完成`, results);
});

mobileSyncManager.on(
  "conflict:detected",
  ({ entity, localData, remoteData }) => {
    console.warn(`检测到冲突: ${entity.type} #${entity.id}`);
  },
);
```

---

## IPC 接口

移动端同步通过 P2P 消息通道进行通信，支持以下消息类型：

### 桌面端发送（推送到移动端）

| 消息类型                  | 负载字段                                       | 说明                   |
| ------------------------- | ---------------------------------------------- | ---------------------- |
| `mobile-sync:knowledge`   | `changes, batchIndex, totalBatches, timestamp` | 推送知识库变更（分批） |
| `mobile-sync:contacts`    | `changes, timestamp`                           | 推送联系人变更         |
| `mobile-sync:group-chats` | `changes, timestamp`                           | 推送群聊变更           |
| `mobile-sync:messages`    | `changes, batchIndex, totalBatches, timestamp` | 推送消息变更（分批）   |

### 移动端发送（桌面端接收）

| 消息类型                          | 负载字段  | 说明                 |
| --------------------------------- | --------- | -------------------- |
| `mobile-sync:request`             | --        | 移动端请求全量同步   |
| `mobile-sync:knowledge-changes`   | `changes` | 移动端上传知识库变更 |
| `mobile-sync:contacts-changes`    | `changes` | 移动端上传联系人变更 |
| `mobile-sync:group-chats-changes` | `changes` | 移动端上传群聊变更   |
| `mobile-sync:messages-changes`    | `changes` | 移动端上传消息变更   |

---

## 使用示例

### 基础初始化

```javascript
const MobileSyncManager = require("./sync/mobile-sync-manager");

const mobileSyncManager = new MobileSyncManager(database, p2pManager, {
  syncInterval: 30000,
  batchSize: 100,
  enableAutoSync: true,
  conflictStrategy: "latest-wins",
});
```

### 注册设备并同步

```javascript
// 注册移动设备（注册后自动执行首次全量同步）
await mobileSyncManager.registerMobileDevice("phone-001", "peer-xyz", {
  name: "我的手机",
  platform: "android",
  version: "1.2.0",
});

// 手动触发同步
await mobileSyncManager.startSync("phone-001");
```

### 处理移动端上传的变更

```javascript
// 在 P2P 消息处理器中调用
p2pManager.on("message", async (peerId, message) => {
  if (message.type.startsWith("mobile-sync:")) {
    const deviceId = getDeviceIdByPeerId(peerId);
    await mobileSyncManager.handleMobileSyncRequest(deviceId, message);
  }
});
```

### 监控同步状态

```javascript
// 获取实时统计
const stats = mobileSyncManager.getStats();
console.log("总同步次数:", stats.totalSyncs);
console.log("在线设备数:", stats.onlineDevicesCount);
console.log("知识库已同步:", stats.knowledgeSynced);
console.log("联系人已同步:", stats.contactsSynced);
console.log("群聊已同步:", stats.groupChatsSynced);
console.log("消息已同步:", stats.messagesSynced);
console.log("冲突检测:", stats.conflictsDetected);
console.log("冲突已解决:", stats.conflictsResolved);

// 获取设备列表
const devices = mobileSyncManager.getMobileDevices();
devices.forEach((d) => {
  console.log(`${d.deviceId} - ${d.deviceInfo.name} [${d.status}]`);
});
```

### 清理资源

```javascript
// 应用退出时清理
mobileSyncManager.cleanup();
```

---

## 同步流程

### 桌面端主动推送流程

```
┌──────────┐                    ┌──────────────────┐                   ┌──────────┐
│  定时器   │                    │ MobileSyncManager │                   │ 移动设备  │
│ (30s)    │                    │                  │                   │          │
└────┬─────┘                    └────────┬─────────┘                   └────┬─────┘
     │  触发自动同步                      │                                  │
     │ ──────────────────────────────── > │                                  │
     │                                    │  1. 检查设备是否在线               │
     │                                    │  2. 查询各类别增量变更             │
     │                                    │     ┌─────────────────────┐      │
     │                                    │     │ SELECT ... WHERE    │      │
     │                                    │     │ updated_at > since  │      │
     │                                    │     └─────────────────────┘      │
     │                                    │  3. 并行执行同步任务              │
     │                                    │     ├── syncKnowledge ──────── > │
     │                                    │     ├── syncContacts  ──────── > │
     │                                    │     ├── syncGroupChats ─────── > │
     │                                    │     └── syncMessages  ──────── > │
     │                                    │                                  │
     │                                    │  4. Promise.allSettled 等待完成    │
     │                                    │  5. 更新 lastSyncTime             │
     │                                    │  6. 触发 sync:completed 事件      │
     │                                    │                                  │
```

### 移动端上传变更流程

```
┌──────────┐                    ┌──────────────────┐                   ┌──────────┐
│ 移动设备  │                    │ MobileSyncManager │                   │ Database │
│          │                    │                  │                   │ (SQLite) │
└────┬─────┘                    └────────┬─────────┘                   └────┬─────┘
     │                                    │                                  │
     │  mobile-sync:knowledge-changes     │                                  │
     │ ──────────────────────────────── > │                                  │
     │                                    │  applyKnowledgeChanges()         │
     │                                    │  遍历每条变更:                    │
     │                                    │    delete -> UPDATE SET deleted=1 │
     │                                    │    upsert -> INSERT OR REPLACE   │
     │                                    │ ──────────────────────────────── > │
     │                                    │                                  │
     │                                    │  saveToFile()                    │
     │                                    │ ──────────────────────────────── > │
     │                                    │                                  │
```

### 批量传输流程

对于知识库和消息等数据量较大的类别，系统自动分批传输：

```
数据总量: 350条, batchSize: 100

Batch 1: [  1 ~ 100 ] ──> P2P发送 ──> 进度: 25%
Batch 2: [101 ~ 200 ] ──> P2P发送 ──> 进度: 50%
Batch 3: [201 ~ 300 ] ──> P2P发送 ──> 进度: 75%
Batch 4: [301 ~ 350 ] ──> P2P发送 ──> 进度: 100%
```

---

## 统计信息

通过 `getStats()` 方法获取运行时统计数据：

| 字段                 | 类型      | 说明                   |
| -------------------- | --------- | ---------------------- |
| `totalSyncs`         | `number`  | 累计同步次数           |
| `knowledgeSynced`    | `number`  | 累计同步的知识库条目数 |
| `contactsSynced`     | `number`  | 累计同步的联系人数     |
| `groupChatsSynced`   | `number`  | 累计同步的群聊数       |
| `messagesSynced`     | `number`  | 累计同步的消息数       |
| `conflictsDetected`  | `number`  | 累计检测到的冲突数     |
| `conflictsResolved`  | `number`  | 累计已解决的冲突数     |
| `isSyncing`          | `boolean` | 当前是否正在同步       |
| `mobileDevicesCount` | `number`  | 已注册的移动设备总数   |
| `onlineDevicesCount` | `number`  | 当前在线的移动设备数   |

---

## 故障排除

### 同步未触发

**现象**: 自动同步未按预期间隔执行。

**排查步骤**:

1. 确认 `enableAutoSync` 配置为 `true`
2. 确认目标设备状态为 `online`（使用 `getMobileDevices()` 检查）
3. 检查 `isSyncing` 是否为 `true`（上一次同步尚未完成会阻塞新的同步）

### 部分数据类别同步失败

**现象**: `sync:completed` 事件中 results 包含 `rejected` 状态。

**排查步骤**:

1. 检查对应数据库表是否存在（如 `notes`、`contacts`、`group_chats`）
2. 确认 P2P 连接稳定（`p2pManager.sendMessage` 是否正常）
3. 查看日志中 `[MobileSyncManager]` 前缀的错误信息

### 设备注册后无法同步

**现象**: 调用 `registerMobileDevice` 后未触发同步。

**排查步骤**:

1. 确认 `peerId` 对应的 P2P 节点在线且可达
2. 检查是否有其他同步正在进行（`isSyncing === true`）
3. 确认设备未被立即标记为 `offline`

### 数据冲突频繁发生

**现象**: `conflictsDetected` 计数持续增长。

**解决方案**:

1. 缩短 `syncInterval`（如改为 10000 毫秒），减少冲突窗口期
2. 如果冲突主要发生在知识库，考虑使用 `merge` 策略
3. 对于关键数据，使用 `manual` 策略确保人工确认

### 大量数据同步缓慢

**现象**: 首次全量同步耗时过长。

**解决方案**:

1. 增大 `batchSize`（如设为 500），减少网络往返次数
2. 按需关闭不必要的同步类别（如 `syncSettings: false`）
3. 监听 `sync:progress` 事件显示进度提示

---

## 相关文档

- [去中心化社交](./social.md) -- P2P 通信和群聊功能
- [知识库管理](./knowledge-base.md) -- 笔记和知识库数据结构
- [配置管理](./configuration.md) -- 统一配置系统
- [加密与安全](./encryption.md) -- 数据传输加密
