# 永久记忆系统

> **版本: v0.1.0+ | Clawdbot 风格 | 混合搜索 (Vector + BM25)**

## 概述

永久记忆系统 (`PermanentMemoryManager`) 是 ChainlessChain 的核心模块之一，实现了 Clawdbot 风格的永久记忆机制。该系统通过 Daily Notes（每日日志）和 MEMORY.md（长期知识库）两种存储形式，帮助 AI 助手在跨会话间持久化重要信息、用户偏好、技术发现和架构决策。

系统内置混合搜索引擎（Vector + BM25），支持对记忆内容进行语义搜索和关键词匹配，结合 Embedding 缓存和文件监听功能，实现高效的自动索引和实时更新，让 Agent 具备跨会话的"长期记忆"能力。

## 系统概述

永久记忆系统在 ChainlessChain 中扮演"记忆中枢"的角色：上层对话、技能执行、Agent 工作流均可读写记忆，下层通过混合搜索引擎和 Embedding 缓存保障检索性能。

## 核心特性

- 📝 **Daily Notes 每日日志**: 自动记录每日运行日志，支持追加模式和 30 天自动清理
- 🧠 **MEMORY.md 长期知识库**: 跨会话持久化用户偏好、架构决策、技术发现和问题解决方案
- 🔍 **混合搜索引擎**: Vector 语义搜索(0.6权重) + BM25 关键词(0.4权重) + RRF 融合算法
- 📊 **自动索引系统**: 文件监听(1.5s去抖) + SHA-256 变更检测 + 增量索引更新
- 💾 **Embedding 缓存**: SQLite 缓存向量，避免重复计算，节省 70% 计算时间
- 🤖 **智能提取**: LLM 自动从对话中提取技术发现，保存到长期知识库

## 系统架构

```
用户对话 / 文件变更
        │
        ▼
┌────────────────────────┐
│  PermanentMemoryManager │
└───┬────────────┬───────┘
    │            │
    ▼            ▼
┌────────┐  ┌──────────┐
│ Daily  │  │ MEMORY.md│
│ Notes  │  │ 长期知识  │
│ (日志) │  │ (5章节)  │
└───┬────┘  └────┬─────┘
    │            │
    ▼            ▼
┌────────────────────────┐
│  MemoryFileWatcher      │
│  (文件监听+变更检测)    │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  HybridSearchEngine     │
│  ┌──────┐  ┌────────┐  │
│  │Vector│  │ BM25   │  │
│  │ 0.6  │  │  0.4   │  │
│  └──┬───┘  └───┬────┘  │
│     └────┬─────┘        │
│          ▼              │
│     RRF 融合            │
└────────────────────────┘
```

**参考**: [Clawdbot Memory Concepts](https://docs.openclaw.ai/concepts/memory)

**源码位置**:

- 核心模块: `desktop-app-vue/src/main/llm/permanent-memory-manager.js`
- IPC 接口: `desktop-app-vue/src/main/llm/permanent-memory-ipc.js`
- 文件监听: `desktop-app-vue/src/main/llm/memory-file-watcher.js`
- 混合搜索: `desktop-app-vue/src/main/rag/hybrid-search-engine.js`
- Embedding 缓存: `desktop-app-vue/src/main/rag/embedding-cache.js`
- 数据库迁移: `desktop-app-vue/src/main/database/migrations/009_embedding_cache.sql`

---

## 核心功能

### Daily Notes 每日日志

Daily Notes 以日期命名的 Markdown 文件存储每天的运行日志，包含对话记录、完成任务、待办事项和技术发现。

- **文件格式**: `memory/daily/YYYY-MM-DD.md`
- **自动创建**: 首次写入时自动生成当日文件及头部模板
- **追加模式**: 默认以追加方式写入，不覆盖已有内容
- **自动清理**: 根据 `maxDailyNotesRetention` 配置（默认 30 天）自动删除过期文件
- **元数据追踪**: 解析对话数、完成任务数、待办事项数、技术发现数和字数统计

每日日志头部模板：

```markdown
# 2026-02-26 运行日志

## 今日概览

- 总对话数: 0
- 活跃会话: 0
- 创建笔记: 0

## 重要对话

## 完成任务

## 待办事项

## 技术发现
```

### MEMORY.md 长期知识库

MEMORY.md 是永久记忆的核心文件，用于存储跨会话的长期知识，包括用户偏好、架构决策、问题解决方案和技术发现。

- **文件位置**: `memory/MEMORY.md`
- **章节结构**: 预定义多个章节（用户偏好、架构决策、常见问题、技术发现、系统配置）
- **章节追加**: 支持按章节名称精确追加内容
- **完整覆盖**: 支持完整更新 MEMORY.md 内容
- **自动更新**: 最后更新时间自动维护

预定义章节：

| 章节名称         | 用途                   |
| ---------------- | ---------------------- |
| 用户偏好         | 开发习惯、技术栈偏好   |
| 架构决策         | ADR 格式记录的架构决策 |
| 常见问题解决方案 | 遇到的问题和解决方案   |
| 重要技术发现     | 技术发现和最佳实践     |
| 系统配置         | 系统配置和环境变量     |

### 自动索引

当 `enableAutoIndexing` 选项开启时，系统会通过 `MemoryFileWatcher` 监听 `memory/` 目录下的文件变化，自动触发索引更新：

- **文件监听**: 基于 `MemoryFileWatcher`，debounce 为 1500ms
- **变更检测**: 通过 SHA-256 内容哈希判断文件是否实际变更
- **增量索引**: 仅对变化的文件进行重新索引
- **全量重建**: 支持 `rebuildIndex()` 进行全量重建
- **索引状态追踪**: 记录每个文件的索引状态（`pending`、`indexed`、`failed`）

自动索引事件流：

```
文件变化 → MemoryFileWatcher 检测
  → 计算内容 Hash
    → Hash 变化? → 触发 index-needed 事件
      → HybridSearchEngine 索引文档
        → 更新 memory_file_hashes 表
```

### 混合搜索

混合搜索引擎结合 Vector（语义向量）搜索和 BM25（关键词）搜索，通过 RRF (Reciprocal Rank Fusion) 算法融合两种搜索结果，提供高质量的记忆检索。

- **Vector 权重**: 0.6（语义相似度）
- **BM25 权重**: 0.4（关键词匹配）
- **RRF K 值**: 60
- **语言**: `zh`（中文优化）
- **回退机制**: 当混合搜索引擎不可用时，自动回退到简单文本匹配搜索

---

## 目录结构

```
memory/
├── daily/                    # Daily Notes 每日日志目录
│   ├── 2026-02-24.md        # 每日日志文件
│   ├── 2026-02-25.md
│   └── 2026-02-26.md
├── MEMORY.md                 # 长期知识库
└── index/                    # 索引文件目录（自动索引使用）
```

**目录说明**：

- `daily/`: 存储以 `YYYY-MM-DD.md` 格式命名的每日日志文件。超过保留天数的文件会被自动清理。
- `MEMORY.md`: 长期知识库文件，包含多个预定义章节。由系统自动创建和维护，也支持手动编辑。
- `index/`: 自动索引相关文件的存储目录。仅当 `enableAutoIndexing` 开启时创建。

---

## 配置参考

### 构造函数参数

| 参数                     | 类型      | 必填 | 默认值 | 说明                           |
| ------------------------ | --------- | ---- | ------ | ------------------------------ |
| `memoryDir`              | `string`  | 是   | -      | 记忆目录路径                   |
| `database`               | `Object`  | 是   | -      | 数据库实例（SQLite）           |
| `llmManager`             | `Object`  | 否   | `null` | LLM 管理器实例（用于智能提取） |
| `ragManager`             | `Object`  | 否   | `null` | RAG 管理器实例（用于混合搜索） |
| `enableDailyNotes`       | `boolean` | 否   | `true` | 是否启用 Daily Notes           |
| `enableLongTermMemory`   | `boolean` | 否   | `true` | 是否启用 MEMORY.md             |
| `enableAutoIndexing`     | `boolean` | 否   | `true` | 是否启用自动索引               |
| `maxDailyNotesRetention` | `number`  | 否   | `30`   | Daily Notes 保留天数           |
| `enableEmbeddingCache`   | `boolean` | 否   | `true` | 是否启用 Embedding 缓存        |

### HybridSearchEngine 默认配置

| 参数           | 默认值 | 说明                         |
| -------------- | ------ | ---------------------------- |
| `vectorWeight` | `0.6`  | Vector 搜索权重              |
| `textWeight`   | `0.4`  | BM25 文本搜索权重            |
| `rrfK`         | `60`   | RRF 融合算法 K 值            |
| `language`     | `"zh"` | 搜索语言（影响分词和停用词） |

### EmbeddingCache 默认配置

| 参数                | 默认值                  | 说明             |
| ------------------- | ----------------------- | ---------------- |
| `maxCacheSize`      | `100000`                | 缓存最大条目数   |
| `cacheExpiration`   | `2592000000` (30 天 ms) | 缓存过期时间     |
| `enableAutoCleanup` | `true`                  | 是否启用自动清理 |

### MemoryFileWatcher 默认配置

| 参数         | 默认值 | 说明                        |
| ------------ | ------ | --------------------------- |
| `debounceMs` | `1500` | 文件变化 debounce 延迟 (ms) |

---

## API 参考

### 生命周期方法

#### `initialize()`

初始化永久记忆管理器：创建目录结构、确保 MEMORY.md 存在、清理过期 Daily Notes、初始化统计、启动 Embedding 缓存自动清理和文件监听。

```javascript
const manager = new PermanentMemoryManager({
  memoryDir: "/path/to/memory",
  database: dbInstance,
  ragManager: ragInstance,
});
await manager.initialize();
```

#### `destroy()`

销毁实例：停止文件监听、清理 Embedding 缓存、清空内存缓存、移除所有事件监听。

```javascript
await manager.destroy();
```

### Daily Notes 方法

#### `writeDailyNote(content, options)`

写入今日 Daily Note。

| 参数             | 类型      | 说明                        |
| ---------------- | --------- | --------------------------- |
| `content`        | `string`  | Markdown 格式内容           |
| `options.append` | `boolean` | 是否追加模式（默认 `true`） |

返回值: `Promise<string>` - Daily Note 文件路径。

#### `readDailyNote(date)`

读取指定日期的 Daily Note。支持内存缓存。

| 参数   | 类型     | 说明                  |
| ------ | -------- | --------------------- |
| `date` | `string` | 日期格式 `YYYY-MM-DD` |

返回值: `Promise<string|null>` - 内容或 `null`（文件不存在时）。

#### `getRecentDailyNotes(limit)`

从数据库获取最近的 Daily Notes 元数据列表。

| 参数    | 类型     | 默认值 | 说明     |
| ------- | -------- | ------ | -------- |
| `limit` | `number` | `7`    | 返回数量 |

返回值: `Promise<Array>` - 元数据列表，按日期降序排列。

#### `cleanupExpiredDailyNotes()`

清理超过保留期限的 Daily Notes 文件。初始化时自动调用。

### MEMORY.md 方法

#### `readMemory()`

读取 MEMORY.md 完整内容。支持内存缓存。

返回值: `Promise<string>` - MEMORY.md 内容。

#### `appendToMemory(content, options)`

追加内容到 MEMORY.md。

| 参数              | 类型     | 说明                                      |
| ----------------- | -------- | ----------------------------------------- |
| `content`         | `string` | Markdown 格式内容                         |
| `options.section` | `string` | 目标章节名称（可选），如 `"重要技术发现"` |

不指定 `section` 时追加到文件末尾；指定时追加到匹配的 `## 章节名` 末尾。

#### `updateMemory(content)`

完整覆盖 MEMORY.md 内容。自动更新最后更新时间。

| 参数      | 类型     | 说明         |
| --------- | -------- | ------------ |
| `content` | `string` | 新的完整内容 |

#### `getMemorySections()`

获取 MEMORY.md 的章节列表及统计信息。

返回值: `Promise<Array<Object>>` - 包含 `title`、`itemCount`、`hasContent` 的章节信息数组。

### 搜索方法

#### `searchMemory(query, options)`

混合搜索记忆内容（Vector + BM25）。

| 参数                       | 类型      | 默认值 | 说明                 |
| -------------------------- | --------- | ------ | -------------------- |
| `query`                    | `string`  | -      | 查询字符串           |
| `options.limit`            | `number`  | `10`   | 返回结果数量         |
| `options.searchDailyNotes` | `boolean` | `true` | 是否搜索 Daily Notes |
| `options.searchMemory`     | `boolean` | `true` | 是否搜索 MEMORY.md   |
| `options.vectorWeight`     | `number`  | `0.6`  | Vector 搜索权重      |
| `options.textWeight`       | `number`  | `0.4`  | BM25 搜索权重        |
| `options.vectorLimit`      | `number`  | `20`   | Vector 搜索返回上限  |
| `options.bm25Limit`        | `number`  | `20`   | BM25 搜索返回上限    |
| `options.threshold`        | `number`  | `0`    | 最低分数阈值         |

返回值: `Promise<Array<Object>>` - 搜索结果数组。

#### `simpleSearch(query, options)`

简单文本搜索（回退方案）。当混合搜索引擎不可用时自动使用。

### 会话记忆提取方法

#### `saveToMemory(content, options)`

保存内容到永久记忆。根据类型自动选择保存位置。

| 参数              | 类型     | 默认值           | 说明                        |
| ----------------- | -------- | ---------------- | --------------------------- |
| `content`         | `string` | -                | 要保存的内容                |
| `options.type`    | `string` | `"conversation"` | 类型（见下方说明）          |
| `options.section` | `string` | -                | 指定 MEMORY.md 章节（可选） |

**类型映射**：

| 类型值                   | 保存位置    | 目标章节         |
| ------------------------ | ----------- | ---------------- |
| `conversation` / `daily` | Daily Notes | -                |
| `discovery`              | MEMORY.md   | 重要技术发现     |
| `solution`               | MEMORY.md   | 常见问题解决方案 |
| `preference`             | MEMORY.md   | 用户偏好         |
| `architecture`           | MEMORY.md   | 架构决策         |
| `config`                 | MEMORY.md   | 系统配置         |

#### `extractFromConversation(messages, conversationTitle)`

从对话消息中提取重要信息并保存到永久记忆。

| 参数                | 类型                     | 说明             |
| ------------------- | ------------------------ | ---------------- |
| `messages`          | `Array<{role, content}>` | 对话消息数组     |
| `conversationTitle` | `string`                 | 对话标题（可选） |

工作流程：

1. 构建对话摘要（显示首条和最后 5 条消息，中间省略）
2. 将摘要保存到 Daily Notes
3. 若有 LLM 管理器，调用 LLM 提取技术发现（最多 5 个）
4. 将技术发现保存到 MEMORY.md 的"重要技术发现"章节

返回值: `Promise<Object>` - 包含 `savedTo`、`messageCount`、`title`、`discoveriesExtracted` 的结果对象。

### 索引方法

#### `startFileWatcher()`

启动文件监听。监听 `index-needed` 和 `index-delete` 事件。

#### `stopFileWatcher()`

停止文件监听。

#### `rebuildIndex()`

全量重建索引。扫描 `memory/` 目录下所有文件并重新索引。

返回值: `Promise<Object>` - 包含 `total`、`indexed`、`failed`、`timestamp` 的结果对象。

#### `getIndexStats()`

获取索引统计信息。

返回值: `Object` - 包含 `embeddingCache`、`fileWatcher`、`indexedFiles` 的统计对象。

#### `getStats()`

获取记忆系统综合统计。

返回值: `Promise<Object>` - 包含以下字段：

| 字段                    | 说明                  |
| ----------------------- | --------------------- |
| `dailyNotesCount`       | Daily Notes 文件数量  |
| `memorySectionsCount`   | MEMORY.md 章节数量    |
| `cachedEmbeddingsCount` | 缓存的 Embedding 数量 |
| `indexedFilesCount`     | 已索引文件数量        |
| `date`                  | 统计日期              |

### 事件

`PermanentMemoryManager` 继承自 `EventEmitter`，支持以下事件：

| 事件名                 | 触发时机          | 数据                                                  |
| ---------------------- | ----------------- | ----------------------------------------------------- |
| `daily-note-updated`   | Daily Note 写入后 | `{ date, filePath }`                                  |
| `memory-updated`       | MEMORY.md 更新后  | `{ section, filePath }` 或 `{ fullUpdate, filePath }` |
| `file-changed`         | 监听到文件变化    | `{ event, filePath, relativePath }`                   |
| `file-indexed`         | 文件索引完成      | `{ relativePath, contentHash }`                       |
| `file-unindexed`       | 文件索引删除      | `{ relativePath }`                                    |
| `index-error`          | 索引失败          | `{ relativePath, error }`                             |
| `index-rebuilt`        | 全量重建完成      | `{ total, indexed, failed, timestamp }`               |
| `file-watcher-started` | 文件监听启动      | -                                                     |
| `file-watcher-stopped` | 文件监听停止      | -                                                     |

---

## IPC 接口

永久记忆系统通过 Electron IPC 通道向渲染进程提供服务。所有接口均返回 `{ success: boolean, ...data }` 格式的响应。

### 基础 IPC 通道

| 通道名                          | 说明                 | 参数                   |
| ------------------------------- | -------------------- | ---------------------- |
| `memory:write-daily-note`       | 写入 Daily Note      | `{ content, append }`  |
| `memory:read-daily-note`        | 读取 Daily Note      | `{ date }`             |
| `memory:get-recent-daily-notes` | 获取最近 Daily Notes | `{ limit }`            |
| `memory:read-memory`            | 读取 MEMORY.md       | -                      |
| `memory:append-to-memory`       | 追加到 MEMORY.md     | `{ content, section }` |
| `memory:update-memory`          | 完整更新 MEMORY.md   | `{ content }`          |
| `memory:get-stats`              | 获取记忆统计         | -                      |
| `memory:search`                 | 混合搜索记忆         | `{ query, options }`   |
| `memory:get-today-date`         | 获取今日日期         | -                      |

### 索引管理 IPC 通道 (Phase 4 & 5)

| 通道名                             | 说明                    | 参数 |
| ---------------------------------- | ----------------------- | ---- |
| `memory:get-index-stats`           | 获取索引统计            | -    |
| `memory:rebuild-index`             | 全量重建索引            | -    |
| `memory:start-file-watcher`        | 启动文件监听            | -    |
| `memory:stop-file-watcher`         | 停止文件监听            | -    |
| `memory:get-embedding-cache-stats` | 获取 Embedding 缓存统计 | -    |
| `memory:clear-embedding-cache`     | 清空 Embedding 缓存     | -    |

### 会话记忆提取 IPC 通道 (Phase 6)

| 通道名                             | 说明                     | 参数                              |
| ---------------------------------- | ------------------------ | --------------------------------- |
| `memory:save-to-memory`            | 保存内容到永久记忆       | `{ content, type, section }`      |
| `memory:extract-from-conversation` | 从对话提取并保存         | `{ messages, conversationTitle }` |
| `memory:extract-from-session`      | 从会话提取（兼容旧调用） | `{ sessionId }`                   |
| `memory:get-memory-sections`       | 获取 MEMORY.md 章节列表  | -                                 |

### 高级搜索 IPC 通道 (Phase 7)

| 通道名                          | 说明           | 参数                                   |
| ------------------------------- | -------------- | -------------------------------------- |
| `memory:advanced-search`        | 高级搜索       | `{ query, options }`                   |
| `memory:search-by-tier`         | 按记忆层级搜索 | `{ query, tier, options }`             |
| `memory:search-by-date-range`   | 按时间范围搜索 | `{ query, dateFrom, dateTo, options }` |
| `memory:get-important-memories` | 获取重要记忆   | `{ minImportance, limit }`             |
| `memory:get-recent-memories`    | 获取最近记忆   | `{ days, limit }`                      |
| `memory:set-importance`         | 设置记忆重要性 | `{ memoryId, importance }`             |
| `memory:get-memory-tier-stats`  | 获取层级统计   | -                                      |

### 记忆分析 IPC 通道 (Phase 7)

| 通道名                         | 说明           | 参数        |
| ------------------------------ | -------------- | ----------- |
| `memory:get-dashboard-data`    | 获取仪表板数据 | -           |
| `memory:get-overview`          | 获取记忆概览   | -           |
| `memory:get-trends`            | 获取趋势数据   | `{ days }`  |
| `memory:get-top-keywords`      | 获取热门关键词 | `{ limit }` |
| `memory:get-search-statistics` | 获取搜索统计   | -           |
| `memory:get-health-score`      | 获取健康度评分 | -           |

### 语义分块 IPC 通道 (Phase 7)

| 通道名                         | 说明               | 参数                    |
| ------------------------------ | ------------------ | ----------------------- |
| `memory:chunk-document`        | 对文档进行语义分块 | `{ content, metadata }` |
| `memory:update-chunker-config` | 更新分块器配置     | `{ config }`            |

---

## 使用示例

### 基础初始化

```javascript
const { PermanentMemoryManager } = require("./llm/permanent-memory-manager");

const memoryManager = new PermanentMemoryManager({
  memoryDir: "/path/to/memory",
  database: databaseInstance,
  ragManager: ragManagerInstance, // 可选，启用混合搜索
  llmManager: llmManagerInstance, // 可选，启用智能提取
  enableDailyNotes: true,
  enableLongTermMemory: true,
  enableAutoIndexing: true,
  maxDailyNotesRetention: 30,
  enableEmbeddingCache: true,
});

await memoryManager.initialize();
```

### 写入和读取 Daily Notes

```javascript
// 写入今日 Daily Note（追加模式）
await memoryManager.writeDailyNote(
  "### 14:30 - 完成了 RAG 搜索优化\n\n- 优化了向量搜索权重\n- 测试通过率提升到 95%",
);

// 读取指定日期的 Daily Note
const content = await memoryManager.readDailyNote("2026-02-26");

// 获取最近 7 天的 Daily Notes 元数据
const recentNotes = await memoryManager.getRecentDailyNotes(7);
```

### 操作 MEMORY.md

```javascript
// 追加到指定章节
await memoryManager.appendToMemory(
  "- BM25 搜索在中文场景下需要使用 jieba 分词\n- Vector 权重 0.6 + BM25 权重 0.4 是较优的混合比例",
  { section: "重要技术发现" },
);

// 读取完整 MEMORY.md
const memory = await memoryManager.readMemory();

// 获取章节列表
const sections = await memoryManager.getMemorySections();
// => [{ title: '用户偏好', itemCount: 3, hasContent: true }, ...]
```

### 搜索记忆

```javascript
// 混合搜索
const results = await memoryManager.searchMemory("向量搜索优化", {
  limit: 10,
  searchDailyNotes: true,
  searchMemory: true,
  vectorWeight: 0.6,
  textWeight: 0.4,
});

// 搜索结果格式
// [{ document: { id, content, metadata }, score: 0.85, source: 'hybrid' }]
```

### 保存对话记忆

```javascript
// 直接保存内容
await memoryManager.saveToMemory("用户偏好使用 Vue 3 + TypeScript", {
  type: "preference",
});

// 从对话中提取并保存
const result = await memoryManager.extractFromConversation(
  [
    { role: "user", content: "如何优化 SQLite 查询性能？" },
    { role: "assistant", content: "可以通过以下方式优化..." },
  ],
  "SQLite 性能优化讨论",
);
// => { savedTo: 'daily_notes', messageCount: 2, discoveriesExtracted: 2 }
```

### 在渲染进程中使用（IPC）

```javascript
// 渲染进程中通过 IPC 调用
const { ipcRenderer } = require("electron");

// 搜索记忆
const { success, results } = await ipcRenderer.invoke("memory:search", {
  query: "数据库优化",
  options: { limit: 5 },
});

// 保存到记忆
await ipcRenderer.invoke("memory:save-to-memory", {
  content: "发现 Qdrant 在大批量写入时需要设置 batch_size",
  type: "discovery",
});

// 获取统计
const { stats } = await ipcRenderer.invoke("memory:get-stats");
```

### 索引管理

```javascript
// 全量重建索引
const result = await memoryManager.rebuildIndex();
// => { total: 35, indexed: 33, failed: 2, timestamp: 1740000000000 }

// 获取索引统计
const stats = memoryManager.getIndexStats();

// 监听索引事件
memoryManager.on("file-indexed", ({ relativePath }) => {
  console.log("文件已索引:", relativePath);
});
```

---

## 搜索功能

### 混合搜索原理

永久记忆系统使用 `HybridSearchEngine` 实现混合搜索，结合两种互补的搜索方法：

1. **Vector 搜索（语义搜索）**: 通过 Embedding 模型将查询和文档转换为向量，计算余弦相似度。擅长理解语义和同义词匹配。
2. **BM25 搜索（关键词搜索）**: 基于词频-逆文档频率 (TF-IDF) 的经典信息检索算法。擅长精确关键词匹配。

### RRF 融合算法

Reciprocal Rank Fusion (RRF) 将两种搜索结果按排名融合：

```
RRF_score(d) = vectorWeight / (K + rank_vector(d)) + textWeight / (K + rank_bm25(d))
```

其中：

- `K = 60`（平滑参数，防止高排名文档权重过大）
- `vectorWeight = 0.6`（Vector 搜索权重）
- `textWeight = 0.4`（BM25 搜索权重）

### 搜索流程

```
用户查询
  ├── Vector 搜索 (RAG Manager)
  │     ├── 检查 Embedding 缓存
  │     ├── 命中 → 使用缓存向量
  │     └── 未命中 → 计算 Embedding → 写入缓存
  │           └── 余弦相似度排序 → Top N 结果
  │
  ├── BM25 搜索 (自然语言处理)
  │     ├── 中文分词
  │     ├── 去除停用词
  │     └── TF-IDF 评分排序 → Top N 结果
  │
  └── RRF 融合
        ├── 按排名计算融合分数
        ├── 去重
        └── 最终排序 → 返回结果
```

### 回退搜索

当 `ragManager` 未提供或混合搜索引擎初始化失败时，系统自动使用简单文本搜索：

- 遍历最近 30 天的 Daily Notes
- 检查 MEMORY.md 内容
- 使用 `String.includes()` 进行大小写不敏感的文本匹配
- Daily Notes 匹配分数固定为 `0.5`，MEMORY.md 匹配分数固定为 `0.7`

---

## 数据库 Schema

永久记忆系统使用 5 张数据库表，定义在迁移文件 `009_embedding_cache.sql` 中。

### embedding_cache 表

Embedding 向量缓存表，避免重复计算，节省约 70% 的计算时间。

```sql
CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash TEXT PRIMARY KEY,       -- 内容 SHA-256 哈希
  embedding BLOB NOT NULL,             -- 序列化的 Embedding 向量 (Float32Array)
  model TEXT NOT NULL,                 -- 模型名称 (如 'qwen2:7b')
  dimension INTEGER NOT NULL,          -- 向量维度
  original_content TEXT,               -- 原始内容（可选，调试用）
  created_at INTEGER NOT NULL,         -- 创建时间 (Unix ms)
  last_accessed_at INTEGER NOT NULL,   -- 最后访问时间 (LRU 清理用)
  access_count INTEGER DEFAULT 1       -- 访问计数
);
```

索引: `model`、`last_accessed_at`、`created_at`

### memory_file_hashes 表

文件哈希跟踪表，用于检测文件变化和管理索引状态。

```sql
CREATE TABLE IF NOT EXISTS memory_file_hashes (
  file_path TEXT PRIMARY KEY,          -- 文件相对路径
  content_hash TEXT NOT NULL,          -- 内容 SHA-256 哈希
  file_size INTEGER NOT NULL,          -- 文件大小 (bytes)
  last_modified_at INTEGER NOT NULL,   -- 最后修改时间 (Unix ms)
  last_indexed_at INTEGER NOT NULL,    -- 最后索引时间
  index_status TEXT DEFAULT 'pending', -- 索引状态: pending/indexed/failed
  chunk_count INTEGER DEFAULT 0,       -- 分块数量
  error_message TEXT                   -- 错误信息（索引失败时）
);
```

索引: `index_status`、`last_modified_at`

### daily_notes_metadata 表

Daily Notes 元数据表，存储每日日志的统计信息。

```sql
CREATE TABLE IF NOT EXISTS daily_notes_metadata (
  date TEXT PRIMARY KEY,               -- 日期 (YYYY-MM-DD)
  title TEXT,                          -- 标题
  conversation_count INTEGER DEFAULT 0,-- 对话数
  completed_tasks INTEGER DEFAULT 0,   -- 完成任务数
  pending_tasks INTEGER DEFAULT 0,     -- 待办任务数
  discoveries_count INTEGER DEFAULT 0, -- 技术发现数
  word_count INTEGER DEFAULT 0,        -- 字数统计
  created_at INTEGER NOT NULL,         -- 创建时间
  updated_at INTEGER NOT NULL          -- 最后更新时间
);
```

索引: `date DESC`

### memory_sections 表

MEMORY.md 内容分类表，对长期知识进行结构化存储。

```sql
CREATE TABLE IF NOT EXISTS memory_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,              -- 分类: user_preference/architecture_decision/
                                       --       troubleshooting/discovery/config
  subcategory TEXT,                    -- 子分类（可选）
  title TEXT NOT NULL,                 -- 标题
  content TEXT NOT NULL,               -- 内容 (Markdown)
  tags TEXT,                           -- 标签 (JSON 数组)
  importance INTEGER DEFAULT 3,        -- 重要程度: 1-5
  created_at INTEGER NOT NULL,         -- 创建时间
  updated_at INTEGER NOT NULL          -- 最后更新时间
);
```

索引: `category`、`importance DESC`、`updated_at DESC`

### memory_stats 表

记忆系统统计表，按日记录系统运行指标。

```sql
CREATE TABLE IF NOT EXISTS memory_stats (
  date TEXT PRIMARY KEY,               -- 统计日期 (YYYY-MM-DD)
  daily_notes_count INTEGER DEFAULT 0, -- Daily Notes 总数
  memory_sections_count INTEGER DEFAULT 0, -- MEMORY.md 条目数
  cached_embeddings_count INTEGER DEFAULT 0, -- 缓存 Embedding 数
  indexed_files_count INTEGER DEFAULT 0,     -- 索引文件数
  total_searches INTEGER DEFAULT 0,    -- 总搜索次数
  vector_searches INTEGER DEFAULT 0,   -- Vector 搜索次数
  bm25_searches INTEGER DEFAULT 0,     -- BM25 搜索次数
  hybrid_searches INTEGER DEFAULT 0,   -- 混合搜索次数
  cache_hits INTEGER DEFAULT 0,        -- 缓存命中次数
  cache_misses INTEGER DEFAULT 0,      -- 缓存未命中次数
  avg_search_latency REAL DEFAULT 0,   -- 平均搜索延迟 (ms)
  updated_at INTEGER NOT NULL          -- 更新时间
);
```

索引: `date DESC`

---

## 故障排除

### 混合搜索引擎未初始化

**现象**: 搜索时日志输出"混合搜索引擎未初始化，回退到简单搜索"。

**原因**: 未提供 `ragManager` 参数或 `HybridSearchEngine` 初始化失败。

**解决方案**:

1. 确保传入有效的 `ragManager` 实例
2. 检查 Qdrant 向量数据库服务是否正常运行（默认端口 `6333`）
3. 查看日志中 `HybridSearchEngine` 的错误信息

### Embedding 缓存初始化失败

**现象**: 日志输出"Embedding 缓存初始化失败"。

**原因**: 数据库中缺少 `embedding_cache` 表。

**解决方案**:

1. 确保数据库迁移 `009_embedding_cache.sql` 已执行
2. 检查数据库连接是否正常

### Daily Notes 文件未创建

**现象**: 调用 `writeDailyNote` 后文件未出现在 `daily/` 目录。

**原因**: `enableDailyNotes` 配置为 `false`，或 `memoryDir` 路径不正确。

**解决方案**:

1. 确认 `enableDailyNotes` 未被显式设置为 `false`
2. 检查 `memoryDir` 路径是否存在且有写入权限

### 文件监听不工作

**现象**: 文件变化后未触发自动索引。

**原因**: `enableAutoIndexing` 为 `false`，或文件监听器初始化失败。

**解决方案**:

1. 确认 `enableAutoIndexing` 配置为 `true`
2. 手动调用 `startFileWatcher()` 启动监听
3. 检查 `MemoryFileWatcher` 的初始化日志

### 搜索结果质量差

**现象**: 搜索返回的结果与查询不相关。

**解决方案**:

1. 调整 `vectorWeight` 和 `textWeight` 参数比例
2. 对于精确关键词查询，提高 `textWeight`（如设置为 `0.7`）
3. 对于语义模糊查询，提高 `vectorWeight`（如设置为 `0.8`）
4. 尝试调用 `rebuildIndex()` 重建索引

### 内存占用过高

**现象**: 缓存数据过多导致内存增长。

**解决方案**:

1. 通过 IPC 调用 `memory:clear-embedding-cache` 清空 Embedding 缓存
2. 减小 `maxDailyNotesRetention` 值以保留更少的 Daily Notes
3. 检查 `EmbeddingCache` 的 `maxCacheSize` 配置

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/llm/permanent-memory-manager.js` | 永久记忆核心管理器 |
| `src/main/llm/permanent-memory-ipc.js` | IPC 处理器（30+ 个） |
| `src/main/llm/memory-file-watcher.js` | 文件变更监听器 |
| `src/main/rag/hybrid-search-engine.js` | 混合搜索引擎（Vector+BM25） |
| `src/main/rag/embedding-cache.js` | Embedding 向量缓存 |
| `src/main/database/migrations/009_embedding_cache.sql` | 数据库迁移（5 张表） |

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 记忆检索响应慢 | 向量索引未优化或嵌入缓存失效 | 执行 `memory index-optimize`，启用嵌入缓存 |
| 向量索引损坏查询报错 | 索引文件异常写入或磁盘故障 | 重建向量索引 `memory index-rebuild` |
| 存储空间不足 | 记忆数据量超出磁盘限额 | 清理过期记忆 `memory gc`，迁移到更大存储 |
| 记忆去重失败出现重复 | 相似度阈值过高或嵌入模型变更 | 降低去重阈值 `deduplicationThreshold`，重新嵌入 |
| 记忆导入后查询不到 | 导入数据未生成嵌入向量 | 执行 `memory embed-pending` 补充缺失嵌入 |

### 常见错误修复

**错误: `RETRIEVAL_SLOW` 记忆检索超时**

```bash
# 优化向量索引
chainlesschain memory index-optimize

# 查看索引状态和大小
chainlesschain memory index-stats
```

**错误: `INDEX_CORRUPTED` 向量索引损坏**

```bash
# 重建向量索引（保留原始数据）
chainlesschain memory index-rebuild --preserve-data

# 验证索引完整性
chainlesschain memory index-verify
```

**错误: `STORAGE_FULL` 记忆存储空间不足**

```bash
# 查看存储使用情况
chainlesschain memory stats --storage

# 清理过期和低重要性记忆
chainlesschain memory gc --max-age 365d --min-importance 0.2
```

## 性能指标

### 核心操作延迟

| 操作 | 目标 | 实际 | 状态 |
| ---- | ---- | ---- | ---- |
| Daily Note 写入（追加模式） | < 50ms | ~20ms | ✅ |
| MEMORY.md 章节追加 | < 100ms | ~35ms | ✅ |
| Embedding 缓存命中搜索 | < 500ms | ~120ms | ✅ |
| 首次混合搜索（冷启动） | < 5s | ~2.5s | ✅ |
| 全量索引重建（35 文件） | < 30s | ~12s | ✅ |
| 文件变化检测到触发索引 | < 2s | ~1.6s | ✅ |
| `getStats()` 统计查询 | < 200ms | ~80ms | ✅ |
| `extractFromConversation()` LLM 提取 | < 10s | ~4s | ✅ |

### 资源使用

| 指标 | 典型值 | 上限 | 说明 |
| ---- | ------ | ---- | ---- |
| 内存占用（基础） | ~15MB | ~50MB | 不含 Embedding 缓存 |
| Embedding 缓存内存 | ~30MB | ~200MB | 10 万条向量，384 维 |
| SQLite 文件大小（10 万缓存条目） | ~200MB | — | 含向量 BLOB |
| Daily Notes 磁盘（30 天） | ~5MB | — | 取决于对话频率 |
| 文件监听 CPU（idle） | < 0.1% | — | debounce 1500ms |
| Embedding 缓存命中率 | ~70% | — | 重复查询场景下 |

---

## 测试覆盖率

### 测试文件列表

✅ `desktop-app-vue/tests/unit/llm/permanent-memory-manager.test.js` — 核心管理器（Daily Notes、MEMORY.md 读写、章节追加、自动清理）
✅ `desktop-app-vue/tests/unit/llm/permanent-memory-ipc.test.js` — IPC 处理器（30+ 通道、参数校验、错误响应格式）
✅ `desktop-app-vue/tests/unit/llm/memory-file-watcher.test.js` — 文件监听（debounce、SHA-256 变更检测、index-needed 事件）
✅ `desktop-app-vue/tests/unit/rag/hybrid-search-engine.test.js` — 混合搜索引擎（RRF 融合、Vector+BM25 权重、回退搜索）
✅ `desktop-app-vue/tests/unit/rag/embedding-cache.test.js` — Embedding 缓存（LRU 清理、过期淘汰、命中率统计）
✅ `desktop-app-vue/tests/unit/llm/permanent-memory-search.test.js` — 搜索集成（`searchMemory`、`simpleSearch` 回退、按层级/日期范围搜索）
✅ `desktop-app-vue/tests/unit/llm/permanent-memory-extract.test.js` — 会话提取（`extractFromConversation`、LLM 提取路径、`saveToMemory` 类型映射）
✅ `desktop-app-vue/tests/unit/llm/permanent-memory-index.test.js` — 索引管理（`rebuildIndex`、增量索引、`getIndexStats`、索引状态追踪）

---

## 安全考虑

### 数据存储安全

- 记忆数据存储在 **SQLCipher 加密数据库** 中，AES-256 全库透明加密
- `memory/` 目录下的 Markdown 文件建议通过 git-crypt 加密保护
- Embedding 向量缓存存储在本地 SQLite 中，不上传到外部向量数据库

### 隐私保护

- 所有记忆搜索（Vector + BM25）完全在本地运行，查询内容不外泄
- LLM 智能提取使用本地 Ollama 模型，对话内容不发送到云端
- 文件监听仅监控 `memory/` 目录，不会扫描其他敏感目录

### 数据生命周期

- Daily Notes 支持自动清理（默认 30 天），过期文件安全删除
- Embedding 缓存支持自动清理（默认 30 天过期），释放存储空间
- MEMORY.md 长期知识库由用户手动管理，重要内容建议定期备份

### 记忆内容安全

- 自动提取的技术发现在保存前不包含敏感数据（密码、密钥等）
- 搜索结果按分数排序返回，不暴露底层索引结构和完整数据集
- IPC 接口受权限系统保护，未授权的渲染进程无法访问记忆数据

---

## 故障深度排查

### 记忆丢失

1. **文件路径检查**: 确认 `memoryDir` 指向正确目录，`memory/MEMORY.md` 和 `memory/daily/` 文件是否存在
2. **写入权限**: 检查目录写入权限（Windows 上特别注意 UAC 限制），日志搜索 `EACCES` 或 `EPERM` 错误
3. **自动清理误删**: `maxDailyNotesRetention` 默认 30 天，超期文件被自动删除属正常行为；重要内容应保存到 MEMORY.md 长期知识库
4. **数据库回退**: 若 `daily_notes_metadata` 表数据丢失，可从 `memory/daily/` 目录下的 Markdown 文件手动恢复

### 检索缓慢

| 现象 | 解决方案 |
|------|---------|
| 首次搜索慢（>5s） | Embedding 缓存为空，首次需计算向量；后续搜索会命中缓存，延迟降至 <500ms |
| 所有搜索均慢 | 检查 Qdrant 服务是否运行（端口 6333），若不可用则回退到简单搜索 |
| 索引重建耗时长 | 文件数量多时 `rebuildIndex()` 耗时正常；可分批索引或在后台执行 |

### 存储满

- 通过 `memory:get-stats` 查看 `cachedEmbeddingsCount`，超过 10 万条时调用 `memory:clear-embedding-cache` 清理
- 减小 `maxDailyNotesRetention`（如设为 14 天）以减少磁盘占用
- 检查 `embedding_cache` 表大小，可通过 `maxCacheSize` 配置限制上限

## 安全深度说明

### 加密存储
- 记忆数据库通过 **SQLCipher AES-256** 全库透明加密，数据库文件被拷贝后无法读取
- `memory/` 目录下的 Markdown 文件为明文存储，建议敏感项目使用 **git-crypt** 或系统级磁盘加密保护
- Embedding 向量缓存在本地 SQLite 中，不上传到外部向量数据库或云端

### 隐私保护
- LLM 智能提取使用本地 Ollama 模型，对话内容不发送到云端；若使用云端 LLM，需注意对话内容可能被传输
- 搜索查询仅在本地执行，不记录搜索历史到外部服务
- `extractFromConversation` 提取的技术发现不包含密码、密钥等敏感数据，提取逻辑由 LLM prompt 控制

## 相关文档

- [知识库管理](./knowledge-base.md) - 知识库系统的使用和管理
- [AI 模型配置](./ai-models.md) - LLM 和 Embedding 模型的配置说明
- [会话管理](./session-manager.md) - 会话管理器与记忆系统的集成
- [系统配置](./configuration.md) - 统一配置管理
- [混合搜索引擎](../features/PERMANENT_MEMORY_INTEGRATION.md) - 混合搜索引擎的详细设计文档
