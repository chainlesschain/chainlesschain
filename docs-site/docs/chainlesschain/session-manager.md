# SessionManager 会话管理

> **版本: v0.29.0 | 30-40% Token节省 | 智能上下文管理**

SessionManager 提供智能的 AI 会话上下文管理，通过自动压缩、搜索、标签等功能，优化 Token 使用并提升对话体验。

## 概述

SessionManager 是 ChainlessChain 的 AI 会话生命周期管理模块，负责会话的创建、恢复、归档、搜索和导出。它通过智能上下文压缩技术节省 30-40% 的 Token 消耗，集成永久记忆系统实现跨会话知识保留，并支持 AI 自动摘要生成和全文会话搜索，为用户提供高效的对话管理体验。

## 核心特性

- 🗜️ **智能上下文压缩**: 超过 Token 阈值自动压缩，节省 30-40% Token 消耗
- 🔍 **全文会话搜索**: 按关键词、日期、标签搜索全部历史会话
- 🏷️ **标签分类管理**: 灵活的标签系统，支持多维度会话组织
- 🧠 **永久记忆集成**: 自动识别重要信息写入 Permanent Memory，跨会话保留
- 📝 **AI 自动摘要**: 智能生成会话摘要、关键决策和待办事项
- 📦 **导出与导入**: JSON/Markdown 格式导出，支持跨设备会话迁移

## 系统架构

```
┌─────────────────────────────────────────┐
│            SessionManager               │
│  (创建/恢复/归档/删除/搜索/标签)         │
└──────┬──────┬──────┬──────┬────────────┘
       │      │      │      │
       ▼      ▼      ▼      ▼
┌────────┐┌────────┐┌────────┐┌──────────────┐
│ 压缩器  ││ 搜索器  ││ 标签器  ││ 摘要生成器    │
│ Token  ││ 全文   ││ 分类   ││ AI 自动摘要  │
│ 优化   ││ 检索   ││ 筛选   ││ 关键点提取   │
└────────┘└────────┘└────────┘└──────────────┘
       │                          │
       ▼                          ▼
┌──────────────┐          ┌──────────────────┐
│ SQLite 持久化 │          │ Permanent Memory │
│ 会话/消息/标签│          │ 跨会话知识保留    │
└──────────────┘          └──────────────────┘
```

## 关键文件

| 文件                                          | 职责                       |
| --------------------------------------------- | -------------------------- |
| `src/main/llm/session-manager.js`             | 会话管理核心逻辑           |
| `src/main/llm/context-compressor.js`          | 智能上下文压缩             |
| `src/main/llm/memory-manager.js`              | 永久记忆集成               |
| `src/renderer/pages/chat/SessionListPage.vue` | 会话列表页面               |
| `src/renderer/stores/session.ts`              | Pinia 会话状态管理         |

## 核心功能

### 功能概览

| 功能      | 说明                 | 效果             |
| --------- | -------------------- | ---------------- |
| 自动压缩  | 智能压缩长对话       | 30-40% Token节省 |
| 会话搜索  | 全文搜索历史会话     | 快速找到相关内容 |
| 标签管理  | 会话分类和组织       | 提高管理效率     |
| 导出/导入 | 会话数据迁移         | 跨设备同步       |
| 自动摘要  | AI生成会话摘要       | 快速了解会话内容 |
| 永久记忆  | 集成Permanent Memory | 跨会话知识保留   |

---

## 自动压缩

当会话 Token 超过阈值时，自动压缩上下文。

### 工作原理

```
原始对话 (10,000 tokens)
    ↓
智能分析重要性
    ↓
保留关键信息
    ↓
压缩后 (6,000 tokens)
    ↓
节省 40% Token
```

### 压缩策略

```javascript
// 配置压缩策略
sessionManager.setCompressionStrategy({
  threshold: 8000, // 触发压缩的Token阈值
  targetRatio: 0.6, // 目标压缩比例
  preserveRecent: 5, // 保留最近N轮对话
  preserveImportant: true, // 保留重要信息
});
```

### 重要性判断

系统自动识别重要内容：

- **代码块** - 完整保留
- **配置信息** - 完整保留
- **关键决策** - 完整保留
- **闲聊内容** - 压缩或省略
- **重复信息** - 合并压缩

---

## 会话搜索

全文搜索所有历史会话。

### 搜索功能

```javascript
// 搜索会话
const results = await sessionManager.search({
  query: "数据库优化",
  filters: {
    dateRange: { start: "2026-01-01", end: "2026-02-11" },
    tags: ["技术", "性能"],
  },
  limit: 20,
});
```

### 搜索结果

```javascript
{
  sessions: [
    {
      id: "session-123",
      title: "PostgreSQL性能优化讨论",
      snippet: "...索引优化可以提升查询速度...",
      createdAt: "2026-02-10T10:00:00Z",
      tags: ["技术", "数据库"]
    }
  ],
  total: 15
}
```

---

## 标签管理

使用标签组织和分类会话。

### 添加标签

```javascript
// 为会话添加标签
await sessionManager.addTags("session-123", ["技术", "重要", "待跟进"]);

// 获取会话标签
const tags = await sessionManager.getTags("session-123");
```

### 按标签筛选

```javascript
// 获取带特定标签的会话
const sessions = await sessionManager.getByTags(["技术", "重要"]);
```

### 标签统计

```javascript
// 获取标签使用统计
const stats = await sessionManager.getTagStats();
// { "技术": 45, "重要": 23, "待跟进": 12, ... }
```

---

## 导出/导入

会话数据的迁移和备份。

### 导出会话

```javascript
// 导出单个会话
await sessionManager.export("session-123", {
  format: "json", // 或 "markdown"
  path: "/exports/session.json",
});

// 批量导出
await sessionManager.exportAll({
  format: "json",
  path: "/exports/all-sessions.json",
  compress: true,
});
```

### 导入会话

```javascript
// 导入会话
await sessionManager.import({
  path: "/exports/session.json",
  merge: true, // 合并到现有会话
});
```

### 导出格式

**JSON 格式：**

```json
{
  "id": "session-123",
  "title": "技术讨论",
  "messages": [...],
  "metadata": {...},
  "createdAt": "2026-02-10T10:00:00Z"
}
```

**Markdown 格式：**

```markdown
# 技术讨论

## 会话信息

- 创建时间: 2026-02-10 10:00
- 标签: 技术, 重要

## 对话内容

**用户:** 如何优化数据库查询？

**AI:** 可以从以下几个方面优化...
```

---

## 自动摘要

AI 自动生成会话摘要。

### 生成摘要

```javascript
// 生成会话摘要
const summary = await sessionManager.generateSummary("session-123")

// 摘要内容
{
  title: "PostgreSQL性能优化",
  keyPoints: [
    "讨论了索引优化策略",
    "确定了分区表方案",
    "计划下周实施"
  ],
  decisions: [
    "使用B-tree索引",
    "按月分区"
  ],
  actionItems: [
    "创建索引脚本",
    "编写迁移计划"
  ]
}
```

### 自动标题

```javascript
// 自动生成会话标题
const title = await sessionManager.generateTitle("session-123");
// "PostgreSQL查询性能优化方案讨论"
```

---

## Permanent Memory 集成

与永久记忆系统集成，实现跨会话知识保留。

### 工作流程

```
会话进行中
    ↓
识别重要信息
    ↓
写入 Permanent Memory
    ↓
下次会话自动加载相关记忆
```

### 配置集成

```javascript
// 启用永久记忆集成
sessionManager.enablePermanentMemory({
  autoSave: true, // 自动保存重要信息
  autoLoad: true, // 自动加载相关记忆
  relevanceThreshold: 0.7, // 相关性阈值
});
```

### 记忆触发

系统自动识别需要记忆的内容：

- **用户偏好** - "我喜欢使用TypeScript"
- **项目信息** - "这个项目使用React"
- **重要决策** - "我们决定采用微服务架构"
- **常用配置** - "数据库端口是5432"

---

## 会话生命周期

### 创建会话

```javascript
// 创建新会话
const session = await sessionManager.create({
  title: "技术讨论",
  tags: ["技术"],
  context: {
    project: "chainlesschain",
  },
});
```

### 恢复会话

```javascript
// 恢复之前的会话
await sessionManager.resume("session-123");
```

### 归档会话

```javascript
// 归档会话（保留但不显示在列表）
await sessionManager.archive("session-123");

// 查看归档会话
const archived = await sessionManager.getArchived();
```

### 删除会话

```javascript
// 删除会话
await sessionManager.delete("session-123");

// 批量删除
await sessionManager.deleteMany(["session-1", "session-2"]);
```

---

## 配置选项

### 全局配置

```javascript
sessionManager.configure({
  // 压缩设置
  compression: {
    enabled: true,
    threshold: 8000,
    targetRatio: 0.6,
  },

  // 自动保存
  autoSave: {
    enabled: true,
    interval: 30000, // 30秒
  },

  // 永久记忆
  permanentMemory: {
    enabled: true,
    autoSave: true,
    autoLoad: true,
  },

  // 摘要生成
  summary: {
    autoGenerate: true,
    minMessages: 10,
  },
});
```

---

## IPC 处理器

SessionManager 提供以下 IPC 处理器：

| 处理器                    | 功能     |
| ------------------------- | -------- |
| `session:create`          | 创建会话 |
| `session:get`             | 获取会话 |
| `session:list`            | 列出会话 |
| `session:update`          | 更新会话 |
| `session:delete`          | 删除会话 |
| `session:search`          | 搜索会话 |
| `session:export`          | 导出会话 |
| `session:import`          | 导入会话 |
| `session:compress`        | 压缩会话 |
| `session:generateSummary` | 生成摘要 |
| `session:addTags`         | 添加标签 |
| `session:getTags`         | 获取标签 |

---

## 性能指标

| 操作     | 响应时间 |
| -------- | -------- |
| 创建会话 | <20ms    |
| 获取会话 | <10ms    |
| 搜索会话 | <100ms   |
| 压缩会话 | <500ms   |
| 生成摘要 | <2s      |

---

## 配置参考

### 核心配置

```javascript
// desktop-app-vue/src/main/llm/session-manager.js
const sessionManagerConfig = {
  // 存储路径
  storage: {
    dbPath: path.join(dataDir, 'chainlesschain.db'),   // SQLCipher 加密库
    backupDir: path.join(dataDir, 'session-backups'),
    exportDir: path.join(dataDir, 'exports'),
  },

  // 上下文压缩
  compression: {
    enabled: true,
    threshold: 8000,         // 触发压缩的 Token 阈值
    targetRatio: 0.6,        // 压缩目标比例（保留 60%）
    preserveRecent: 5,       // 无论重要性，始终保留最近 N 轮
    preserveImportant: true, // 代码块/配置/关键决策完整保留
  },

  // 自动保存
  autoSave: {
    enabled: true,
    interval: 30000, // 每 30 秒写库
  },

  // 永久记忆集成
  permanentMemory: {
    enabled: true,
    autoSave: true,           // 会话中自动提取写入
    autoLoad: true,           // 新会话自动注入相关记忆
    relevanceThreshold: 0.7,  // 余弦相似度阈值
  },

  // AI 自动摘要
  summary: {
    autoGenerate: true,
    minMessages: 10,          // 至少 N 条消息才触发摘要
    model: 'ollama',          // 本地模型，不出境
  },

  // 会话生命周期（Managed Agents 扩展）
  lifecycle: {
    idleTimeout: 300000,      // 300 秒无活动后标记 idle
    parkOnExit: true,         // CLI exit 时自动 park
    autoConsolidate: true,    // close 时自动写 MemoryStore
  },
};
```

### WebSocket 会话配置

```javascript
// packages/cli/src/lib/ws-session-manager.js
const wsSessionConfig = {
  // 连接参数
  port: 18800,
  authToken: process.env.CC_SERVE_TOKEN,

  // 每会话资源隔离
  perSessionIsolation: {
    contextEngine: true,    // 独立 CLIContextEngineering 实例
    permanentMemory: true,  // 独立 CLIPermanentMemory
    planModeManager: true,  // 非单例 PlanModeManager
  },

  // 审批策略（ApprovalGate）
  approvalGate: {
    defaultPolicy: 'strict', // strict | trusted | autopilot
    persistPolicy: true,     // 策略写入 approval-policies.json
  },
};
```

### CLI 会话配置

```javascript
// packages/cli/src/repl/agent-repl.js — 启动参数
const replOptions = {
  sessionId: undefined,      // 指定则自动恢复已有会话
  noRecallMemory: false,     // --no-recall-memory 禁用记忆注入
  recallLimit: 5,            // --recall-limit N 启动时注入 Top-N
  noParkOnExit: false,       // --no-park-on-exit 退出时关闭而非 park
  noStream: false,           // --no-stream 禁用流式渲染
};
```

---

## 测试覆盖率

| 测试文件 | 覆盖功能 | 用例数 |
|----------|----------|--------|
| ✅ `desktop-app-vue/tests/unit/llm/session-manager.test.js` | 创建/恢复/归档/删除/搜索/标签 | 42 |
| ✅ `desktop-app-vue/tests/unit/llm/context-compressor.test.js` | 压缩策略、重要性判断、Token 节省率 | 28 |
| ✅ `desktop-app-vue/tests/unit/llm/memory-manager.test.js` | 永久记忆读写、相关性阈值 | 19 |
| ✅ `packages/cli/src/__tests__/ws-session-manager.test.js` | WS 会话注册表、per-session 隔离 | 31 |
| ✅ `packages/cli/src/__tests__/ws-agent-handler.test.js` | Agent 会话处理、agentLoop 集成 | 24 |
| ✅ `packages/cli/src/__tests__/ws-chat-handler.test.js` | Chat 流式对话、history 过滤 | 17 |
| ✅ `packages/cli/src/__tests__/interaction-adapter.test.js` | Terminal/WS 交互抽象切换 | 12 |
| ✅ `packages/session-core/__tests__/session-handle.test.js` | SessionHandle 生命周期、park/unpark | 26 |
| ✅ `packages/session-core/__tests__/approval-gate.test.js` | 审批策略持久化、strict/trusted/autopilot | 22 |

---

## 下一步

- [Context Engineering](/chainlesschain/context-engineering) - KV-Cache优化
- [Permanent Memory](/chainlesschain/permanent-memory) - 永久记忆系统
- [AI 模型配置](/chainlesschain/ai-models) - 配置AI模型

---

## 使用示例

### CLI 会话操作

```bash
# 查看会话列表
chainlesschain session list

# 启动 AI 对话
chainlesschain chat

# 单次提问
chainlesschain ask "如何优化数据库索引？"

# 保存记忆
chainlesschain memory add "项目使用 Vue3 + TypeScript 技术栈"
```

### 桌面端会话管理

```javascript
// 创建新会话
const session = await sessionManager.create({
  title: '架构讨论',
  tags: ['技术', '架构'],
  context: { project: 'chainlesschain' }
});

// 搜索历史会话
const results = await sessionManager.search({
  query: '数据库优化',
  filters: { tags: ['技术'] },
  limit: 10
});

// 导出会话为 Markdown
await sessionManager.export('session-123', {
  format: 'markdown',
  path: '/exports/session.md'
});
```

---

## 故障排查

### 会话上下文丢失

- **Token 超限**: 当对话过长时触发自动压缩，可调整 `threshold` 值延迟压缩
- **会话未保存**: 确认 `autoSave` 已启用（默认 30 秒间隔自动保存）
- **数据库异常**: 使用 `chainlesschain db info` 检查 SQLite 数据库状态

### 自动压缩效果差

- **关键信息丢失**: 调整 `preserveRecent` 值保留更多最近对话轮次
- **代码块被压缩**: 确认 `preserveImportant: true` 已启用，代码块默认完整保留
- **压缩比过高**: 将 `targetRatio` 从 0.6 调整为 0.7-0.8 保留更多内容

### 搜索结果不全

- **索引未更新**: 旧会话可能未被索引，尝试重建会话索引
- **日期范围过窄**: 扩大 `dateRange` 搜索范围确认会话存在
- **标签不匹配**: 检查标签拼写是否一致，标签匹配区分大小写

### 永久记忆未生效

- **集成未启用**: 确认 `permanentMemory.enabled` 和 `autoSave` 均为 `true`
- **相关性不足**: 调低 `relevanceThreshold`（默认 0.7）提高记忆匹配灵敏度
- **LLM 不可用**: 智能提取依赖本地 LLM，确认 Ollama 服务正常运行

---

## 安全考虑

### 会话数据保护

- 所有会话数据存储在 **SQLCipher 加密数据库** 中，AES-256 全库加密
- 会话内容在内存中处理时使用安全缓冲，退出后自动清理
- 会话导出文件默认不包含系统提示词和内部元数据

### 隐私保护

- AI 对话完全在本地运行（使用 Ollama 本地模型），不上传到任何云端
- 自动压缩和摘要生成均在设备端完成，对话内容不外泄
- 永久记忆提取的内容仅存储在本地 `memory/` 目录中

### Token 安全

- Token 使用量追踪帮助识别异常消耗，防止 Token 滥用
- 会话上下文大小受 `maxHistoryMessages` 限制，防止内存溢出攻击
- 导入会话数据时自动验证格式，防止恶意数据注入

---

## WebSocket 会话管理 (v0.41.0)

> 通过 WebSocket 服务器管理有状态的 agent/chat 会话，支持远程创建、恢复和交互。

### WSSessionManager

CLI WebSocket 服务器使用独立的 `WSSessionManager` 管理 WebSocket 会话，与桌面端 `SessionManager` 共享底层 SQLite 持久化。

```
┌─────────────────────────────────────────┐
│        WSSessionManager                 │
│  (创建/恢复/关闭/列出/持久化)           │
└──────┬──────┬──────┬──────────────────┘
       │      │      │
       ▼      ▼      ▼
┌──────────┐┌──────────────┐┌───────────────────┐
│ Agent    ││ Chat         ││ Interaction       │
│ Handler  ││ Handler      ││ Adapter           │
│ (工具+   ││ (流式对话)   ││ (Terminal/WS)     │
│  agentLoop)│             ││                   │
└──────────┘└──────────────┘└───────────────────┘
       │                          │
       ▼                          ▼
┌──────────────┐          ┌──────────────────┐
│ SQLite 持久化 │          │ Per-Session 隔离  │
│ (session-    │          │ ContextEngine    │
│  manager.js) │          │ PermanentMemory  │
└──────────────┘          │ PlanModeManager  │
                          └──────────────────┘
```

### Per-Session 隔离

每个 WebSocket 会话拥有独立的上下文实例，避免多会话间状态污染：

| 组件 | 隔离级别 | 说明 |
|------|----------|------|
| `messages[]` | per-session | 完整对话历史 |
| `CLIContextEngineering` | per-session | 上下文注入引擎 |
| `CLIPermanentMemory` | per-session | 永久记忆 |
| `PlanModeManager` | per-session | 规划模式（非单例） |
| `WebSocketInteractionAdapter` | per-session | 交互抽象 |

### 创建 WebSocket 会话

```javascript
// 通过 WebSocket 创建 agent 会话
ws.send(JSON.stringify({
  id: '1',
  type: 'session-create',
  sessionType: 'agent',
  provider: 'ollama',
  model: 'qwen2.5:7b',
  projectRoot: '/path/to/project'
}));

// 响应
// {"id":"1","type":"session-created","sessionId":"session-abc123","sessionType":"agent"}
```

### 恢复 WebSocket 会话

```javascript
// 从 DB 恢复之前的会话
ws.send(JSON.stringify({
  id: '2',
  type: 'session-resume',
  sessionId: 'session-abc123'
}));

// 响应包含历史消息（已过滤 system 消息）
// {"id":"2","type":"session-resumed","sessionId":"session-abc123","history":[...]}
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/lib/ws-session-manager.js` | WS 会话注册表与生命周期管理 |
| `packages/cli/src/lib/ws-agent-handler.js` | Agent 会话处理器 |
| `packages/cli/src/lib/ws-chat-handler.js` | Chat 会话处理器 |
| `packages/cli/src/lib/interaction-adapter.js` | 交互抽象层（Terminal/WebSocket） |

详见 [WebSocket 服务器](/chainlesschain/cli-serve) 文档。

---

## 相关文档

- [Context Engineering](/chainlesschain/context-engineering) - KV-Cache 优化与上下文工程
- [Permanent Memory](/chainlesschain/permanent-memory) - 永久记忆系统详解
- [AI 模型配置](/chainlesschain/ai-models) - 本地 AI 模型管理
- [Token 追踪](/chainlesschain/token-tracker) - Token 使用量统计与分析
- [WebSocket 服务器](/chainlesschain/cli-serve) - WebSocket 会话协议详解

---

**智能管理，高效对话** 💬
