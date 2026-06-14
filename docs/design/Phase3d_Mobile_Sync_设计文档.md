# Phase 3d — Mobile Sync 设计文档

> 状态：v1 ADR 草案，2026-05-09 起草，等待 sign-off
> 上游：Phase 3b 已落 `syncProviders` 抽象 + `mobile.ts` placeholder；Phase 3c 已落 `sync_external_*` schema + `incremental-walker` + `sync-credentials`
> 范围：把 desktop ↔ Android 端的数据同步从 placeholder 替换成可用 v1，社交子系统优先

---

## 1. 背景与立项动机

桌面端 Phase 3b 在 `desktop-app-vue/src/renderer/utils/syncProviders/` 抽象出 6 个 provider，其中 `mobile.ts` 是 `available()=false` + `placeholder:true` 的占位实现。Android 端 `core-p2p/sync/SyncManager.kt` + `feature-p2p/sync/DefaultSyncDataApplier.kt` 已经有 436 行的 sync 框架，但**两端从未对接**。

CLAUDE.md 把"decentralized personal AI"作为立项点，桌面 ↔ 移动同步是其中一条主线。当前用户在 Android 上加的好友 / 帖子 / 通知都进不到桌面，移动端独立工作但缺"二级大脑"的双向触达。

Phase 3d 要决策：

1. **协议 envelope** — 走桌面已有的 MobileBridge JSON-RPC，还是新建 message type？
2. **Transport** — libp2p 还是 WebRTC DataChannel？
3. **Cursor 持久化** — 复用 Phase 3c 的 `sync_external_*` 还是新建表？
4. **冲突策略** — 双端算法对齐？
5. **v1 ResourceType scope** — 知识库优先（Option A）、社交子系统优先（B）、还是仅交集（C）？
6. **触发模型** — 纯 push、纯 pull、还是双向？
7. **配对 UX** — 复用 DevicePairingHandler 还是另起？

---

## 2. 现状速览（基于 2026-05-09 M0 核实）

### 2.1 桌面端（desktop-app-vue/src/main）

| 文件 | 状态 | 备注 |
|---|---|---|
| `sync/mobile-sync-manager.js` | **DEAD CODE，812 行** | 0 caller，且查 `notes` 表（schema 真表是 `knowledge_items`），任何调用都会 SQL 报错 |
| `p2p/mobile-bridge.js` | ✅ **生产级 wired** | werift WebRTC，signaling client，ICE，连接池，心跳，指数退避；`index.js:1448` 实例化，11 处 lifecycle hook |
| `p2p/device-pairing-handler.js` | ✅ **完整 315 行** | QR 扫码 + 6 位码 + 5 分钟过期 + 确认 dialog + DID 注册 + 60s 等连接 |
| `index.js:1512-1606` | ✅ **JSON-RPC 已通** | `chainlesschain:command:request/response` 走 MobileBridge，是现有 8 REMOTE skills 的协议路径 |
| `sync/sync-credentials.js` | ✅ Phase 3c 已落 | sync.* 命名空间走 safeStorage，扩 mobile 凭证零成本 |
| `sync/sync-external-store.js` | ✅ Phase 3c 已落 | cursor + tombstone CRUD，mobile 直接复用 |
| `sync/incremental-walker.js` | ✅ Phase 3c 已落 | 当前只针对 `knowledge_items`；mobile 需新增 walker 针对社交子系统表 |
| `database/database-schema.js` | ⚠️ 5/5 社交表存在但有 schema bug | `chat_sessions` 重复定义在 line 560 + 782（IF NOT EXISTS 让第二个 no-op，但应清理）|

### 2.2 Android 端（android-app）

| 文件 | 状态 | 备注 |
|---|---|---|
| `core-p2p/sync/SyncManager.kt` | ✅ **436 行 Hilt @Singleton** | recordChange / triggerSync / handleSyncMessage / 自动 30s tick |
| `core-p2p/sync/SyncDataApplier.kt` | ✅ **真接口 3 method** | create/update/delete |
| `feature-p2p/sync/DefaultSyncDataApplier.kt` | ✅ **真实现** | 路由到 4 Repository（P2PMessage/Friend/Post/Notification）|
| `core-p2p/sync/ConflictResolver.kt` | ✅ **完整实现** | 含 KNOWLEDGE_ITEM / CONVERSATION / MESSAGE 等所有 ResourceType 的 resolver |
| `core-p2p/transport/DataChannelTransport.kt` | ✅ WebRTC 256KB 分片 + 背压 | 与桌面 MobileBridge 同语义 |
| `feature-p2p/.../social/SocialSyncAdapter.kt` | ✅ **492 行完整实现** | 12 个 `recordChange` 出向 + 5 个 `applyXxxSync` 入向 + entity↔SyncData 转换 + 扩展函数；架构正确（sync 钩子在 Repository 层而非 ViewModel）|
| `FriendRepository.kt` / `PostRepository.kt` / `NotificationRepository.kt` | ❌ **TEMP DISABLED** | 三处 `private val syncAdapter: Lazy<SocialSyncAdapter>` 注入注释（line 32 / 34 / 24）+ ~25 处 `syncAdapter.value.syncXxx(...)` 调用全部 `//` 注释。注释自承"Lazy 避免循环依赖"——但 Lazy<> 本就是 Hilt 解循环依赖的标准手法，疑似临时跳过编译错误未修复 |
| `P2PMessageRepository.kt` | ⚠️ **入向有，出向无** | `saveMessageFromSync(...)` line 328 真实存在（DefaultSyncDataApplier 入向路径完整），但 SocialSyncAdapter 不覆盖 MESSAGE，本地发送的 P2P 消息不进 sync 队列 |
| 社交 ViewModel（FriendViewModel / PostViewModel / NotificationViewModel / EditPostViewModel / AddFriendViewModel）| ✅ 架构正确 | 不直接 inject SyncManager；调 Repository，sync 钩子集中在 Repository 层（这是正确设计）|
| `feature-knowledge/.../KnowledgeViewModel.kt` | ❌ **v2 才管** | v1 不做知识库同步，KnowledgeRepository 也无 saveKnowledgeFromSync 路径，整条 chain 待 v2 |

### 2.3 ResourceType ↔ 表 映射

Android `DefaultSyncDataApplier.kt` 当前覆盖：

| Android ResourceType | Repository | 桌面对应表（schema 行） |
|---|---|---|
| MESSAGE | P2PMessageRepository | **`p2p_chat_messages`** (573) — DID + device_id + status，最佳匹配 |
| CONTACT | FriendRepository | `contacts` (706) |
| FRIEND | FriendRepository | `friends` (721) |
| POST | PostRepository | `social_posts` (747) |
| POST_COMMENT | PostRepository | `post_comments` (761), `post_likes` (772) |
| NOTIFICATION | NotificationRepository | `notifications` (690) |

**KNOWLEDGE_ITEM / CONVERSATION 落到 else 分支 + warn log "Unsupported"**——Android 端能 send 但收到不能 apply。v1 不做。

### 2.4 三个 message 表的对比 + 选型理由

桌面 schema 里有 3 张候选 message 表：

| 表 | 行 | 关键列 | 评估 |
|---|---|---|---|
| `messages` | 83 | id / conversation_id / role(user/assistant/system) / content / timestamp / tokens | LLM 对话历史，与 P2P 无关 ❌ |
| `p2p_chat_messages` | 573 | id / session_id / sender_did / receiver_did / content / message_type / encrypted / status / device_id / timestamp / forwarded_from_id | DID + device_id + status + 转发链，**v1 选这张** ✅ |
| `chat_messages` | 793 | id / session_id / sender_did / receiver_did / content / is_encrypted / is_read / created_at | 早期版本，无 device_id 无 status；FK 撞 schema bug（两处 `chat_sessions`），疑似 dead ❌ |

**副线发现**：`chat_sessions` 表在 schema 里被 CREATE 两次（line 560 + 782）。`IF NOT EXISTS` 让第二个 no-op，但是 schema 卫生 issue。Phase 3d 不修，单开 follow-up issue。

### 2.5 Transport 已就位（M0 关键发现）

桌面 MobileBridge 已经是完整 libp2p ↔ WebRTC DataChannel 桥（`mobile-bridge.js`），Android `DataChannelTransport.kt` 是同语义实现，**两端协议天然兼容，sync 不需要新建 transport**。

桌面 `index.js:1512-1606` 已经实现 JSON-RPC 2.0 over MobileBridge：
- `chainlesschain:command:request` → `routeMobileCommand(method, params)` → `chainlesschain:command:response`
- 是现有 8 REMOTE skills 的协议路径
- v1 sync 只新增 method，不新建 message type

---

## 3. 决策（ADR-1 ~ ADR-7）

### ADR-1 — Wire envelope: 复用 MobileBridge JSON-RPC，新增 sync.* method

**决定**：v1 sync 走 desktop 已有的 `chainlesschain:command:request` JSON-RPC 通道，新增 method：

| Method | 方向 | params | result |
|---|---|---|---|
| `sync.push` | 任一端 → 对端 | `{item: SyncItem, deviceId}` | `{status: 'applied'\|'conflict'\|'failed', resolved?: SyncItem, error?: string}` |
| `sync.pull` | 任一端 → 对端 | `{cursor: {ts, id}, resourceTypes: [...], limit}` | `{items: SyncItem[], nextCursor: {ts, id}, hasMore: boolean}` |
| `sync.ack` | 接收端 → 发送端 | `{itemId, status}` | `{}` (fire-and-forget) |

**SyncItem 形状**与 Android `SyncManager.kt:373` 的 data class 对齐：

```json
{
  "resourceType": "FRIEND",
  "resourceId": "did:cc:abc...",
  "operation": "UPDATE",
  "version": 3,
  "timestamp": 1715200000000,
  "data": "{\"nickname\":\"...\",\"avatar\":\"...\"}"
}
```

**拒绝替代方案**：
- 新建独立 message type（如 `mobile-sync:push`）：要 patch 双侧 routing，无收益。
- 走 Android `MessageType.KNOWLEDGE_SYNC` 二进制 P2PMessage：桌面要新增反序列化层，多一份 ser/de，不值得。

**Consequence**：v2 如要扩 binary blob（附件、媒体）需切 chunked transport，那时再加 message type；v1 只走 JSON 文本，单条 message ≤256KB（DataChannel 上限）。

---

### ADR-2 — Transport: 复用 MobileBridge WebRTC DataChannel

**决定**：sync 通道 = `mobileBridge.sendToMobile(peerId, message)` + `mobileBridge.on("message-from-mobile", ...)`。Android 端复用既有 `DataChannelTransport`。

**Context**：M0 验证 MobileBridge 已生产级。Android `DataChannelTransport.kt` 是 WebRTC DataChannel 实现（256KB 分片 + 1MB/256KB 高低水位线 + 背压超时 30s）。两端协议天然兼容。

**拒绝替代方案**：
- libp2p：Android 端无 libp2p。
- WebSocket 直连：丧失 P2P / 端到端属性。

**Consequence**：sync 路径只在已配对 + DataChannel 建立后可用。未配对 / DataChannel 断开时 syncProvider.available() 返 false，UI 显式提示。

---

### ADR-3 — Cursor 持久化：复用 Phase 3c `sync_external_*` 表

**决定**：mobile sync cursor 与 WebDAV/OSS 共享 `sync_external_provider_cursor` 表，主键 `(provider_id='mobile', account_key=<mobileDeviceId>)`。Tombstone 走同表 `sync_external_tombstones`，通过现有 trigger 自动 fan-out（**仅对 knowledge_items 表的 trigger 已存在；mobile sync 涉及的 5 张社交表需要 M2 时新增对应 trigger**）。

Android 端**新建对应 Room 表**：

```kotlin
@Entity(tableName = "sync_remote_cursor", primaryKeys = ["remote_device_id", "resource_type"])
data class SyncRemoteCursor(
    val remoteDeviceId: String,
    val resourceType: String,            // ResourceType.name
    val lastPullTs: Long = 0,
    val lastPullId: String? = null,
    val lastPushTs: Long = 0,
    val lastRunStatus: String? = null,   // 'success' | 'conflict' | 'failed'
    val lastRunError: String? = null,
    val lastRunDurationMs: Long? = null,
    val itemsPushed: Long = 0,
    val itemsPulled: Long = 0,
    val itemsConflicted: Long = 0
)
```

启动时 SyncManager.lastSyncTimestamp 从 Room 重载；每次 sync 完成写回。

**拒绝替代方案**：
- 给 mobile 单独建 `sync_mobile_cursor` 表：抽象重复。
- 不持久化（沿用内存 Map）：进程重启重新全量推会撞冲突。

**Consequence**：cursor schema 跨 provider 共享，未来加新 provider 不再加表。

---

### ADR-4 — 冲突策略：双端 last-write-wins 严格对齐 Android ConflictResolver

**决定**：v1 单一策略 = `last-write-wins by (version DESC, timestamp DESC, deviceId DESC tie-break)`。Android `ConflictResolver.kt` 是权威算法；桌面在 `mobile-bridge.js` 收到 `sync.push` 时复制等价算法（~30 行 JS）。

冲突发生时：
- 远端版本胜：覆盖本地，回 `sync.ack {status: applied}`
- 本地版本胜：保留本地，回 `sync.ack {status: conflict, resolved: <local-item>}`，让对端反向 apply

**拒绝替代方案**：
- Manual conflict UI（Android `MANUAL_RESOLVE` 策略）：v1 不引入，v2 加。
- Three-way merge / CRDT：知识库已有 Yjs，但社交子系统数据（POST/MESSAGE/FRIEND）是 immutable + append-only / 单字段覆盖型，CRDT 过重。

**Consequence**：用户在两端**同时**编辑同一 FRIEND 备注，会丢一份。Settings 页文案需明确标注；同一 deviceId 的连续编辑（version 累加）不会冲突。

---

### ADR-5 — v1 ResourceType scope: 6 social subsystem types

**决定**：v1 同步 `MESSAGE / CONTACT / FRIEND / POST / POST_COMMENT / NOTIFICATION` 共 6 种。**KNOWLEDGE_ITEM / CONVERSATION / 群聊 全部推 v2**。

MESSAGE 表锁定为 **`p2p_chat_messages`**（见 §2.4）。

| 候选 | Android 工作量 | 桌面工作量 | 用户感知 | 决议 |
|---|---|---|---|---|
| A. knowledge only | +3d（补 saveFromSync × 3 + DefaultSyncDataApplier KNOWLEDGE_ITEM 分支 + ViewModel 钩子） | 中 | "second brain" 兑现 | **rejected** |
| **B. social subsystem** | 极小（DefaultSyncDataApplier 已就位）| 中（5 张表的 walker / writer） | 联系人/帖子/通知双端可见 | ✅ **selected** |
| C. contacts only | 极小 | 极小 | 弱 demo | **rejected** |

**Context**：Option B 让 Android 端 0 ResourceType 改造（DefaultSyncDataApplier 已支持 6 种全集），桌面 5 张目标表全部存在。优先**先打通管道 + 验证协议**，知识库 v2 加（届时补 KnowledgeRepository.saveFromSync × 3 + ViewModel 钩子，约 2-3 天）。

**Consequence**：用户看到的"移动同步" v1 = 联系人 / 好友 / 1:1 P2P 聊天 / 朋友圈帖子+评论 / 通知。

---

### ADR-6 — 同步触发模型：双向 push + 周期 pull

**决定**：

| 触发 | 频率 | 实现 |
|---|---|---|
| 本地变更 → push | 即时入队，30s tick 批量发 | 双端 ViewModel/Repository 在写入成功后调 `recordChange(syncItem)`（Android 端 `SyncManager.recordChange` 已有；桌面端 M2 新建 `mobile-bridge` outgoing 钩子）|
| 周期 pull | 每 5 分钟 + 应用启动时 | desktop `syncScheduler` tick + Android `SyncManager` autoSync 双方调 `sync.pull(cursor)` |
| Manual sync | 用户点"立即同步" | Settings 页按钮 → `runOnce()` 跑一轮 push + pull |

**Context**：纯 push 模式下若一端短暂离线，恢复后看不到对端期间的变更；必须 pull。`SyncManager.kt:67` 已有 30s autoSync timer，desktop syncScheduler tick 已有。

**拒绝替代方案**：
- 纯 pull 轮询：实时性差。
- push 和 pull 合并到单 method：复杂度上升，无收益。

**Consequence**：M2/M3 关键工作 = 双端 ViewModel/Repository 的 `recordChange` 钩子。Android `KnowledgeViewModel` 当前没接（M0 已验证）；社交相关 ViewModel 也需逐个核（M2 第一步）。

---

### ADR-7 — Pairing：复用 DevicePairingHandler，0 改造

**决定**：v1 Settings → 同步 → 移动设备 入口直接复用 `device-pairing-handler.js`。配对成功后 sync provider 立即可用（available()=true 当 mobileBridge.peers 包含该 deviceId）。

**Context**：M0 验证 DevicePairingHandler 已生产级（QR + 6 位码 + 5 分钟过期 + 确认 dialog）。

**Consequence**：M4 仅是 Settings UI 接现有 IPC，0.5 天搞定。

---

## 4. 待实施（M2 ~ M5）

### 4.1 M2 — Desktop 改造（2-3 天）

**A. 删 dead code**
- 删除 `desktop-app-vue/src/main/sync/mobile-sync-manager.js`（dead + schema 错）
- 检查并删除任何 require 它的代码（M0 grep 显示 0 caller，应该 clean）

**B. 新建 `src/main/sync/mobile-bridge-sync.js`（~250 行）**

```js
class MobileBridgeSync {
  constructor({ mobileBridge, dbManager, deviceManager, logger }) { /* ... */ }

  // 注册到 routeMobileCommand 路由表
  registerRoutes(commandRouter) {
    commandRouter.register('sync.push', this.handlePush.bind(this));
    commandRouter.register('sync.pull', this.handlePull.bind(this));
    commandRouter.register('sync.ack',  this.handleAck.bind(this));
  }

  // 接收对端 push 的 SyncItem，跑 ConflictResolver，写表，返回 ack
  async handlePush({ item, deviceId }) { /* ... */ }

  // 对端拉取 cursor 之后的变更，从 5 张表 query 转 SyncItem
  async handlePull({ cursor, resourceTypes, limit }) { /* ... */ }

  // 本地变更入队（5 张表的 INSERT/UPDATE/DELETE 触发器调用）
  recordChange(resourceType, resourceId, operation, data) { /* ... */ }

  // syncProvider.runOnce() 入口
  async runOnce(deviceId) {
    await this.pushPending(deviceId);
    await this.pullRemote(deviceId);
    return { pushed, pulled, conflicts, durationMs };
  }
}
```

**C. 新建 5 张表的 walker query**

复用 `incremental-walker.js` 模式，每张表一个 `fetchBatchFor<Table>(cursor, batchSize)`：
- `p2p_chat_messages`：order by `(timestamp, id)`，cursor `WHERE timestamp > ? OR (timestamp = ? AND id > ?)`
- `contacts` / `friends` / `social_posts` / `post_comments` / `notifications`：同模式

**D. 新建 5 张表的 tombstone trigger**

参考 Phase 3c 的 `trg_sync_ext_tombstone_on_delete`（database-schema.js ~line 184）模板，给每张目标表建 trigger。

**E. 替换 `desktop-app-vue/src/renderer/utils/syncProviders/mobile.ts` placeholder**

参考 `webdav.ts` 实现：暴露 `electronAPI.sync.mobile.run` IPC、配对状态查询、错误映射。

**F. 注册 IPC channel**
- `sync:mobile:run` → `mobileBridgeSync.runOnce(deviceId)`
- `sync:mobile:status` → 读 `sync_external_provider_cursor` (provider_id='mobile')
- `sync:mobile:list-paired` → `deviceManager.listPaired()`
- `sync:mobile:unpair` → 清 cursor + 移除 paired device

**G. 测试**：mock Android peer，~30 测试覆盖 6 ResourceType × CRUD × 冲突路径。

### 4.2 M3 — Android 改造（0.5-1 天）

> M2 第一步扫描已大幅收敛 scope：原方案的 ViewModel 钩子工作量被 SocialSyncAdapter 的 492 行已实现 + 三 Repository 的 ~25 处 `//`-comment 抹掉。M3 退化为"取消注释 + 加 MESSAGE + 持久化 + 协议路由"4 件事。

**A. 取消三 Repository 的 TEMP DISABLED 注释（1-2 小时）**

机械活：
1. `FriendRepository.kt`：取消 line 32 的 `Lazy<SocialSyncAdapter>` 注入注释 + 取消 line 245/258/271/286/316/332/348/364/380/396 共 9 处调用注释。
2. `PostRepository.kt`：取消 line 34 的注入 + line 141/154/169/196/237/255/271/... 共 8+ 处调用。
3. `NotificationRepository.kt`：取消 line 24 的注入 + 调用注释（行号待 M3 数）。
4. **真试 Lazy 是否解循环依赖**：编译，挂 Robolectric 单测。如失败，备选方案是 Provider 模式或在 SocialSyncAdapter 这侧改 Lazy 反向注入 Repository。

**B. 补 MESSAGE 出向路径（1-2 小时）**

`SocialSyncAdapter` 当前不覆盖 MESSAGE（FRIEND/POST/POST_LIKE/POST_COMMENT/NOTIFICATION 5 种）。两选一：
- **B1（推荐）**：扩 SocialSyncAdapter 加 `syncMessageSent(message)` / `syncMessageStatusChanged(message)` / `syncMessageDeleted(messageId)` + `applyMessageSync(syncItem)`（路由到现有 `P2PMessageRepository.saveMessageFromSync` 等）。+ `MessageSyncData` data class + entity 转换扩展函数。
- **B2**：新建独立 `MessageSyncAdapter.kt`。架构更干净，但多一个类 + Hilt 注入 + 重复 entity 转换 boilerplate。

选 B1。在 P2PMessageRepository 里把 sendMessage / updateMessageStatus / deleteMessage 后挂上 `syncAdapter.value.syncMessageXxx(...)`。

**C. 持久化 cursor（Room）**

新建 `SyncRemoteCursor` Entity（schema 见 ADR-3）+ DAO + 启动时 reload。`SyncManager.lastSyncTimestamp` 从 ConcurrentHashMap 改为 Room-backed lazy 读写。

**D. 新增 sync.pull / sync.push JSON-RPC handler**

Android 端目前 SyncManager 走 DataChannelTransport 的 P2PMessage 二进制 envelope。v1 改走 MobileBridge JSON-RPC：在 SyncManager 加 `handleSyncRpcRequest(method, params)` 路由 sync.push/pull/ack；P2PMessage 路径保留作为 v2 binary 备用。

**E. 测试**：现有 `SyncManagerTest.kt` 扩展（已用 NoOpSyncDataApplier） + 加 fake desktop peer 集成测试覆盖 6 ResourceType × CRUD + 冲突场景 ~20 测试。

### 4.3 M4 — Pairing UX（0.5 天）

- Settings → 同步 → 移动设备 页面，挂现有 IPC：`device-pairing:start-scanner` / `device-pairing:pair-with-code`。
- 配对成功后跳转回 sync 主页面，显示新 paired 设备 + "立即同步"按钮。

### 4.4 M5 — Settings + 状态显示（1 天）

参考 webdav 模板（待 Phase 3c.3 落地）：

- 已配对设备列表 + 每台的 `sync_external_provider_cursor` 状态（上次同步时间 / 推送计数 / 拉取计数 / 冲突计数 / 错误）
- 每 ResourceType 启用开关（v1 默认全开）
- 「立即同步」按钮 → `electronAPI.sync.mobile.run(deviceId)`
- 「断开」按钮 → confirm + `unpair`

---

## 5. v1 验收标准（demo 路径）

1. 用户在 desktop Settings → 同步 → 移动设备 → 扫码绑定一台 Android 设备。
2. Android 端添加一个新好友（FRIEND），10 秒内 desktop `friends` 表出现该记录。
3. Desktop 端编辑该好友备注，10 秒内 Android 端 FriendRepository 反映新备注。
4. Android 离线 30 分钟，期间 desktop 加 3 个 NOTIFICATION，Android 上线后 sync.pull 拉到 3 条。
5. 双端同时改同一 FRIEND 备注，最终一致（last-write-wins by version + ts），UI 不卡死。
6. 双端各 5 个 P2P 聊天消息，message reactions / forwards 不破坏 sync（message_reactions 不在 v1 scope，但 forward chain 不能让 walker 死循环）。
7. 用户解绑设备，cursor + tombstone 行被清理。

---

## 6. 副线发现（不在 Phase 3d 范围，单开 issue）

### 6.1 `chat_sessions` 表重复定义

`database-schema.js` line 560 + 782 都有 `CREATE TABLE IF NOT EXISTS chat_sessions`。`IF NOT EXISTS` 让第二个 no-op，但 schema 卫生 issue + 可能误导工程师。`chat_messages`（line 793）是疑似 dead 表（与 `p2p_chat_messages` 重复）。建议单独 issue 清理。

### 6.2 `MobileSyncManager` (812 行) 是 dead code

`desktop-app-vue/src/main/sync/mobile-sync-manager.js` 0 caller + schema 错（查 `notes` 表）。M2 删除即可，无外部依赖。

### 6.3 Android KnowledgeViewModel 缺 sync 钩子（v2 必修）

v2 知识库同步开始前必须先补 `KnowledgeRepository.saveKnowledgeFromSync` 系列方法 + `SocialSyncAdapter` 加 KNOWLEDGE_ITEM 分支（或新建 KnowledgeSyncAdapter）+ KnowledgeViewModel/Repository 出向钩子，否则本地编辑不进 sync 队列。当前 v1 跳过 KNOWLEDGE_ITEM。

### 6.4 三 Repository 的 TEMP DISABLED 注释（M3 在 Phase 3d 内消解，但成因待审）

`FriendRepository` / `PostRepository` / `NotificationRepository` 三处 `Lazy<SocialSyncAdapter>` 注入 + ~25 处 syncAdapter 调用全部 `//`-comment 注释。注释自承"使用 Lazy 避免循环依赖"——但 `Lazy<>` 本就是 Hilt 解循环依赖的标准手法，注释禁用而非修复说明：
- 可能 1：临时跳过编译错误未回头修复；
- 可能 2：Lazy<> 在该处确实不够（涉及 multibinding 或更深的循环），需改 Provider 模式或 architecture-level 解耦；
- 可能 3：当时还没建 SocialSyncAdapter 的 dep graph，原作者注释占位等后续接线。

M3 第一步真试 Lazy<> 编译——成功就是可能 1（5 分钟搞定），失败则需要分析 dep graph，可能拖工作量。**这是 Phase 3d 内 M3 的唯一未知**。

---

## 7. 工作量与风险

| Milestone | 工作量 | 关键风险 |
|---|---|---|
| M1 ADR | ✅ 完成（本文档）| — |
| M2 第一步（Android scan）| ✅ 完成 | scope 大幅收敛，详 §2.2 + §6.4 |
| M2 Desktop 改造 | 2-3 天 | 5 张表的 walker / trigger 逐张写；冲突 resolver JS 实现要严格对齐 Kotlin |
| M3 Android | **0.5-1 天** | Lazy<SocialSyncAdapter> 真能解循环依赖 vs 需要 architectural 改造（§6.4 三种可能） |
| M4 Pairing | 0.5 天 | — |
| M5 Settings | 1 天 | — |
| **合计** | **4-6 天**（旧估 5-8 天，M2 第一步收敛 1-2 天） | |

主要风险（按发生概率）：

1. **Lazy<SocialSyncAdapter> 是否真解循环依赖** — §6.4 三种可能。M3 第一步真试编译（5 分钟），失败则需要 Provider 模式或 dep graph 重构。这是 M3 唯一未知。
2. **冲突 resolver 双端漂移** — JS 复制 Kotlin 算法的过程中行为差异肉眼难发现；建议 M2 测试用同一 JSON fixture 驱动两端，输出 diff。
3. **5 张表的 trigger 性能** — `social_posts` / `notifications` 高频写入时，每条 INSERT/DELETE 触发 trigger 写 cursor 表，需 batch 模式或 debounce。基准 < 1000 行/分钟没问题，超过需 follow-up。

> ✅ 已消解风险（旧"saveFromSync 系列在 Android 端可能 stub"）：M2 第一步核实 `P2PMessageRepository.saveMessageFromSync:328` + `FriendRepository.saveFriendFromSync:553` 等都是真实现。

---

## 8. 后续 milestone（v2 / v3 占位）

- v2：补 KNOWLEDGE_ITEM / CONVERSATION 同步（Android 端 +3 saveFromSync method + DefaultSyncDataApplier 分支 + KnowledgeViewModel/ConversationViewModel 钩子）
- v2：群聊同步（`group_chats` / `group_members` / `group_messages` / `group_message_reads`，5 张表的协议 + 加密元数据 sync）
- v3：附件 / 媒体 chunked binary transport（切独立 message type，break 256KB DataChannel 上限）
- v3：Manual conflict resolution UI（双端）
- v3：Selective sync（按 folder / tag / time-range 过滤）

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Phase 3d Mobile Sync 设计：桌面 ↔ 移动双向同步。

### 2. 核心特性
Mobile Sync / 双向同步 / 冲突。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「Mobile Sync（Phase 3d）」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
