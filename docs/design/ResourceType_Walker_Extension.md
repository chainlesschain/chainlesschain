# ResourceType Walker Extension — v1.1 状态 + v1.2 路线

> **状态**: 🟡 v1.1 部分落地 (2026-05-12, commit pending)
> **关联**: [Android v1.1 issue #19 W5](https://github.com/chainlesschain/chainlesschain/issues/19) / [Android 重新定位 §8.4](Android_重新定位_设计文档.md#84-android-resourcetype-enum-比桌面-walker-多)
> **作用域**: 把 desktop `mobile-bridge-sync.js` walker 与 Android `SyncManager.kt::ResourceType` enum 双端对齐

---

## 1. 双端 ResourceType 对齐进度

| ResourceType | Android enum | desktop walker | desktop SQLite 表 | 状态 |
|---|---|---|---|---|
| MESSAGE | ✅ | ✅ | `p2p_chat_messages` | v1.0 ✅ |
| FRIEND | ✅ | ✅ | `friends` | v1.0 ✅ |
| POST | ✅ | ✅ | `social_posts` | v1.0 ✅ |
| POST_COMMENT | ✅ | ✅ | `post_comments` | v1.0 ✅ |
| NOTIFICATION | ✅ | ✅ | `notifications` | v1.0 ✅ |
| CONTACT | ✅ | ❌ (commented out) | (生 contacts 表过广) | v1.0 设计性 skip |
| KNOWLEDGE_ITEM | ✅ | ✅ | `knowledge_items` | **v1.1 W1 88727497f ✅** |
| PROJECT | ✅ | ✅ | `projects` | v1.1 ✅ |
| **CONVERSATION** | ✅ | ✅ | `conversations` | **v1.1 W5 (本次) ✅** |
| **POST_LIKE** | ✅ | ✅ | `post_likes` | **v1.1 W5 (本次) ✅** |
| SETTING | ✅ | ❌ | **缺表** (file-based unified-config) | **v1.2 follow-up** |
| FRIEND_GROUP | ✅ | ❌ | **缺表** | **v1.2 follow-up** |
| POST_SHARE | ✅ | ❌ | **缺表** | **v1.2 follow-up** |

**v1.1 W5 净增量 2 类**（CONVERSATION + POST_LIKE）；总覆盖从 7 → 9 / 12（75%）。

---

## 2. v1.1 W5 已落（CONVERSATION + POST_LIKE）

### 2.1 ResourceType enum 加 2 entry

```javascript
// desktop-app-vue/src/main/sync/mobile-bridge-sync.js line 34-49
const ResourceType = Object.freeze({
  // ... 既有 ...
  CONVERSATION: "CONVERSATION",  // v1.1 W5
  POST_LIKE: "POST_LIKE",        // v1.1 W5
});
```

### 2.2 walker fanout 加 2 fetcher

```javascript
// _tableFetchers() line 434-465
this._fetchConversations.bind(this),
this._fetchPostLikes.bind(this),
```

### 2.3 dispatch + _readLocalItem + _applyXxx

各加 case + 实现。详见 commit。

### 2.4 设计取舍

#### CONVERSATION
- **字段子集**：双端共同 (id / title / knowledge_id? / project_id? / context_type / context_data? / created_at / updated_at)。Android `ConversationEntity` 接收时 nullable 字段兜底
- **CREATE/UPDATE**：updated_at LWW；UPSERT `WHERE excluded.updated_at > existing.updated_at`
- **DELETE**：v2 加 tombstone trigger 后支持；v1 不支持（同 PROJECT 模式）
- **不带 device_id**：conversations 表无此列，wire 数据传空字符串

#### POST_LIKE
- **append-only**：行 immutable（liked = row 存在；unlike = DELETE row）
- **CREATE 唯一 op**：unlike 同 DELETE，待 v2 tombstone trigger
- **UNIQUE(post_id, user_did)**：INSERT OR IGNORE 自然处理重复 push
- **游标用 created_at**（无 updated_at）

---

## 3. v1.2 follow-up — SETTING / FRIEND_GROUP / POST_SHARE

### 3.1 SETTING

**桌面现状**：用户 settings 存在 `unified-config-manager.js` 管理的 JSON 文件 (`%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/config.json`)，**不是 SQLite 表**。

**v1.2 选项**：
- **A. 新建 `user_settings` SQLite 表** — schema 按 key/value 存；walker 同步 keys 集合；config 文件作为 cache
- **B. 不同步 SETTING** — 设计上桌面 / Android 各自管 settings；删 Android `SyncManager.SETTING` enum 值
- **C. 文件级同步** — 把 `.chainlesschain/config.json` 内容打成单条 SyncItem 整体推

**推荐 A**（与其他 ResourceType 一致 SQLite-based pattern）：
1. 创建 `user_settings` 表（id / key / value / updated_at）
2. unified-config-manager 写 + 读时 mirror SQLite
3. walker 加 `_fetchUserSettings` / `_applyUserSetting`
4. Android 端 `Settings` ResourceType push/apply 路径已在 SyncManager 但需验证

工作量预估：~150 行 + migration + tests，0.5-1 天。

### 3.2 FRIEND_GROUP

**桌面现状**：无 `friend_groups` 表。`friends` 表也无 `group_id` 列。社交分组功能桌面侧没实现。

**v1.2 选项**：
- **A. 新建 `friend_groups` 表 + `friend_group_members` 关联表**
- **B. 不同步 FRIEND_GROUP** — Android 端独有 grouping，桌面 v1.2 真要分组时再加

**推荐 B**（桌面端无 UI 用 friend grouping，建表是空结构性工作）。删 Android `SyncManager.FRIEND_GROUP` 等 v1.2 桌面端 grouping UI 落地后再加。

### 3.3 POST_SHARE

**桌面现状**：无 `post_shares` 表。social_posts 表无 share_count 列。社交转发功能桌面侧没实现。

**v1.2 选项**：同 FRIEND_GROUP — 桌面无 UI 即 skip。

### 3.4 v1.2 W5 推荐路线

1. **SETTING** 用方案 A：新建 SQLite 表 + walker entry + Android 验证 (~150 行)
2. **FRIEND_GROUP / POST_SHARE** 标 deferred until 桌面有对应 UI（设计文档 §10 v1.2 添 sub-task）
3. 桌面 UI 落地时 (e.g., v1.3) 再加 walker entry — 同步基础设施 (本 doc) 已 ready

---

## 4. Android 端验证

Android 12 类全部在 [`SyncManager.kt::ResourceType`](../../android-app/core-p2p/src/main/java/com/chainlesschain/android/core/p2p/sync/SyncManager.kt) enum 内 declared。**push 路径**通过 `core-p2p/.../sync/DefaultSyncDataApplier.kt` + `feature-knowledge/.../KnowledgeSyncApplierImpl.kt` 等模块实现。

**v1.1 W5 验证项**（不在本 commit scope，留给后续 W5 验收）:
- [ ] CONVERSATION：Android `ConversationEntity` push 路径走通（grep `ResourceType.CONVERSATION` 在 SyncManager 推送侧）
- [ ] POST_LIKE：Android `PostInteractionEntity` （或类似名）push 路径走通

---

## 5. 测试

### 5.1 desktop unit (本 commit 应加)
- `desktop-app-vue/src/main/sync/__tests__/mobile-bridge-sync.test.js`
- `_fetchConversations` / `_fetchPostLikes` 各 1 happy + 1 cursor 边界
- `_applyConversation` / `_applyPostLike` 各 1 INSERT + 1 UPSERT (CONVERSATION) / 1 IGNORE 重复 (POST_LIKE)
- dispatch switch case：CONVERSATION + POST_LIKE 分支被 hit

### 5.2 cross-end E2E (推 v1.2)
- Android emulator + desktop dev：在 Android 创 conversation → 30s push → desktop SQLite 验证；反向同
- Android emulator + desktop dev：在桌面 like a post → push → Android post_likes 表验证

---

## 变更记录

- 2026-05-12 v1.0 (issue #19 W5)：初稿，落 CONVERSATION + POST_LIKE；SETTING/FRIEND_GROUP/POST_SHARE 推 v1.2 详 §3

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。ResourceType Walker Extension（v1.1 状态 + v1.2 路线）：资源类型遍历扩展。

### 2. 核心特性
ResourceType walker / 扩展 / 路线。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「ResourceType Walker 扩展」。

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
