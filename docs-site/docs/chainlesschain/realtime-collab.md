# 实时协作系统

> **版本: v1.0.0+ | Yjs CRDT | P2P 实时同步 | 光标共享 | 文档锁**

## 概述

实时协作系统提供去中心化的多人文档协作能力，基于 Yjs CRDT 引擎实现无冲突并发编辑，通过 P2P DataChannel 毫秒级实时同步。系统采用双层架构：底层 CRDT 引擎处理文档同步和光标感知，上层企业功能层提供段落级文档锁定、行内评论线程、版本历史回溯和协作统计。

实时协作系统提供去中心化的多人文档协作能力，基于 Yjs CRDT 引擎实现无冲突并发编辑，通过 P2P 网络实时同步。

## 核心特性

- 🔄 **CRDT 无冲突合并**: 基于 Yjs 的 CRDT 引擎，多人同时编辑自动合并，永不冲突
- 🌐 **P2P 去中心化同步**: 无需中心服务器，操作毫秒级通过 DataChannel 传播
- 👆 **光标与选区共享**: 实时显示每位协作者的光标位置、选区和编辑状态
- 🔒 **段落级文档锁**: 可选的细粒度段落锁定，防止同区域并发编辑
- 💬 **行内评论线程**: 锚定到文档位置的端到端加密评论与讨论
- 📜 **版本历史回溯**: 自动检查点保存，支持任意版本回溯和差异对比

## 系统架构

```
┌────────────┐    P2P DataChannel    ┌────────────┐
│  用户 A     │◄────────────────────►│  用户 B     │
│  Yjs Doc   │   yjs-sync/1.0.0     │  Yjs Doc   │
│  Awareness │   yjs-awareness/1.0.0│  Awareness │
└─────┬──────┘                       └─────┬──────┘
      │                                    │
      ▼                                    ▼
┌──────────────────────────────────────────────┐
│          YjsCollabManager (CRDT 引擎)         │
│  OpLog → 增量同步 → CRDT 自动合并 → 一致状态  │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│      RealtimeCollabManager (企业功能层)        │
│  段落锁 / 行内评论 / 版本历史 / 协作统计      │
└──────────────────────────────────────────────┘
```

## 系统概述

### 架构设计

```
实时协作系统 (双层架构)
├─ YjsCollabManager (底层 CRDT 引擎)
│   ├─ Yjs 文档管理
│   ├─ P2P 同步协议
│   ├─ Awareness（光标/选区感知）
│   └─ 离线缓冲与增量同步
└─ RealtimeCollabManager (上层企业功能)
    ├─ 段落级文档锁
    ├─ 冲突解决 UI
    ├─ 行内评论与线程
    ├─ 版本历史管理
    └─ 协作统计
```

### P2P 同步协议

```
协议地址:
├─ /chainlesschain/yjs-sync/1.0.0      — 文档内容同步
└─ /chainlesschain/yjs-awareness/1.0.0  — 光标/状态感知
```

### 核心特性

- **CRDT 无冲突合并**: 多人同时编辑永不冲突
- **P2P 实时同步**: 无需中心服务器，操作毫秒级传播
- **光标共享**: 实时显示协作者的光标位置和选区
- **段落级锁定**: 可选的细粒度锁，防止同区域编辑
- **行内评论**: 锚定到文档位置的评论线程
- **版本历史**: 完整的编辑历史，支持任意版本回溯
- **离线支持**: 离线编辑自动缓冲，上线后自动合并

---

## 协作流程

### 打开协作文档

```
1. 选择文档 → 点击"协作编辑"
2. 生成协作会话 ID
3. 分享会话链接给协作者
4. 协作者加入 → P2P 连接建立
5. Yjs 状态向量交换 → 增量同步
6. 实时协作开始
```

### CRDT 操作同步

```
用户A 编辑                          用户B 编辑
    │                                  │
    ▼                                  ▼
生成 CRDT 操作                     生成 CRDT 操作
(Insert/Delete)                    (Insert/Delete)
    │                                  │
    ▼                                  ▼
附加到本地 OpLog                    附加到本地 OpLog
    │                                  │
    └──── P2P DataChannel 广播 ←──────→┘
                  │
                  ▼
          CRDT 自动合并 (无冲突)
                  │
                  ▼
          所有节点一致的文档状态
```

### 冲突解决示例

```
用户A: 在位置5插入 "Hello"
用户B: 在位置5插入 "World"
CRDT 结果: "HelloWorld" 或 "WorldHello"
  (由 Yjs 逻辑时钟决定，所有节点结果一致)
```

---

## 文档锁定

### 锁类型

| 锁类型 | 粒度         | 说明                         |
| ------ | ------------ | ---------------------------- |
| 段落锁 | 段落/Section | 锁定文档某个段落，其他人只读 |
| 全文锁 | 整篇文档     | 独占编辑模式                 |
| 无锁   | —            | 完全自由的 CRDT 并发（默认） |

### 锁定流程

```
1. 用户 A 请求锁定第3段
2. 广播锁定请求到所有协作者
3. 如果无冲突 → 锁定生效，其他人第3段变为只读
4. 如果冲突 → 先到先得，后到者收到拒绝
5. 用户 A 编辑完成 → 释放锁
6. 超时自动释放（默认 30 分钟）
```

---

## 光标与 Awareness

### 感知信息

每个协作者广播以下信息：

```json
{
  "user": {
    "name": "张三",
    "color": "#FF6B6B",
    "avatar": "..."
  },
  "cursor": {
    "anchor": 42,
    "head": 56
  },
  "status": "editing"
}
```

### 状态类型

- `editing` — 正在编辑
- `viewing` — 仅浏览
- `idle` — 空闲（5分钟无操作）
- `selecting` — 正在选择文本

---

## 行内评论

### 评论功能

- 选中文本 → 添加评论（锚定到文档位置）
- 评论线程：支持回复和讨论
- 评论解决：标记为已解决
- 端到端加密：评论通过 Signal 协议加密

### 评论数据结构

```json
{
  "id": "comment-uuid",
  "anchor": { "from": 100, "to": 150 },
  "author": "did:chainlesschain:QmXXX",
  "text": "这段代码需要重构",
  "replies": [...],
  "resolved": false,
  "createdAt": "2026-01-15T10:30:00Z"
}
```

---

## 版本历史

- 自动保存检查点（每 5 分钟或重大变更时）
- 任意版本回溯和比较
- 版本标签（可手动标记重要版本）
- 版本差异可视化

---

## 数据库表

### `collaboration_sessions`

| 字段         | 类型     | 说明            |
| ------------ | -------- | --------------- |
| `id`         | TEXT     | 会话 ID         |
| `doc_id`     | TEXT     | 文档 ID         |
| `created_by` | TEXT     | 创建者 DID      |
| `status`     | TEXT     | active / closed |
| `created_at` | DATETIME | 创建时间        |

### `collab_cursor_positions`

协作者光标位置实时记录。

### `collab_document_locks`

段落级文档锁记录。

### `collab_conflict_history`

冲突事件历史（用于分析）。

### `knowledge_yjs_updates`

Yjs 增量更新持久化（离线恢复）。

### `knowledge_comments`

行内评论及回复线程。

### `collab_stats`

协作统计数据（编辑次数、在线时长等）。

---

## 关键文件

| 文件                                                | 职责                         |
| --------------------------------------------------- | ---------------------------- |
| `src/main/collaboration/yjs-collab-manager.js`      | Yjs CRDT 引擎，P2P 同步协议  |
| `src/main/collaboration/realtime-collab-manager.js` | 企业协作功能（锁/评论/版本） |
| `src/main/collaboration/realtime-collab-ipc.js`     | 协作 IPC 处理器              |
| `src/renderer/pages/CollabEditorPage.vue`           | 协作编辑器页面               |
| `src/renderer/components/social/CursorOverlay.vue`  | 远端光标显示                 |
| `src/renderer/stores/socialCollab.ts`               | 协作状态管理                 |

---

## 使用示例

### 创建协作会话并邀请协作者

```javascript
// 创建协作会话
const session = await window.electronAPI.invoke('collab:create-session', {
  docId: 'note-123',
  permissions: 'editor'  // editor / viewer
});

// 生成邀请链接分享给协作者
const link = await window.electronAPI.invoke('collab:generate-invite', {
  sessionId: session.id
});
// 协作者通过链接加入会话，P2P 连接自动建立
```

### 同步编辑与光标感知

```javascript
// 加入协作会话
await window.electronAPI.invoke('collab:join-session', {
  sessionId: 'session-xxx'
});

// 监听远程编辑事件
window.electronAPI.on('collab:remote-update', (event, data) => {
  // data 包含 CRDT 操作，编辑器自动应用
  console.log(`${data.user.name} 正在编辑...`);
});

// 监听协作者光标位置
window.electronAPI.on('collab:awareness-update', (event, data) => {
  // 渲染远程光标和选区
  console.log(`${data.user.name} 光标在位置 ${data.cursor.anchor}`);
});
```

### 段落锁定与版本回溯

```javascript
// 锁定某个段落防止并发编辑
await window.electronAPI.invoke('collab:lock-section', {
  sessionId: 'session-xxx',
  sectionId: 'paragraph-3'
});

// 查看版本历史
const versions = await window.electronAPI.invoke('collab:list-versions', {
  docId: 'note-123'
});

// 回溯到指定版本
await window.electronAPI.invoke('collab:restore-version', {
  docId: 'note-123',
  versionId: versions[0].id
});
```

---

## 故障排查

### 同步延迟

- 检查 P2P 连接质量
- 确认双方网络可达
- 查看 Yjs 状态向量是否一致

### 光标不显示

- 确认 Awareness 协议已连接
- 检查用户颜色配置
- 重新加入协作会话

### 离线后合并失败

- Yjs CRDT 理论上不会合并失败
- 检查是否有损坏的 Yjs 更新记录
- 重新从其他节点全量同步

---

## 安全考虑

- **端到端加密**: 协作数据通过 P2P DataChannel（DTLS 内置加密）传输，行内评论额外使用 Signal 协议加密
- **访问控制**: 协作会话基于 DID 身份验证，仅受邀协作者可加入，支持 editor/viewer 权限分级
- **锁定防篡改**: 段落锁定状态通过 P2P 广播确认，防止未授权用户绕过锁定编辑
- **版本完整性**: 每个版本检查点包含内容哈希，确保历史版本不可被篡改
- **冲突解决安全**: CRDT 合并是确定性的，所有节点结果一致，不存在被恶意操作利用的空间
- **会话超时**: 空闲协作会话自动关闭（默认 30 分钟），防止资源泄漏

---

## 相关文档

- [P2P 加密通信](/chainlesschain/p2p) - P2P 网络与加密消息基础
- [DID 身份管理](/chainlesschain/did) - 去中心化身份认证
- [知识库管理](/chainlesschain/knowledge-base) - 文档与笔记管理系统
