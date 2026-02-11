# SessionManager 会话管理

> **版本: v0.29.0 | 30-40% Token节省 | 智能上下文管理**

SessionManager 提供智能的 AI 会话上下文管理，通过自动压缩、搜索、标签等功能，优化 Token 使用并提升对话体验。

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

## 下一步

- [Context Engineering](/chainlesschain/context-engineering) - KV-Cache优化
- [Permanent Memory](/chainlesschain/permanent-memory) - 永久记忆系统
- [AI 模型配置](/chainlesschain/ai-models) - 配置AI模型

---

**智能管理，高效对话** 💬
