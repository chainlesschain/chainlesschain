# EvoMap GEP 协议集成

> **版本: v1.0.0 | 状态: ✅ 生产就绪 | 25 IPC Handlers | 3 数据库表 | 8 新文件 | 3 修改文件**

EvoMap GEP-A2A (Gene-Evolution Protocol — Agent-to-Agent) 是 ChainlessChain 的全球 Agent 知识共享协议集成模块。它使桌面应用能够将经过本地验证的策略（Instinct、成功工作流）发布为 Gene+Capsule 资产到 EvoMap 网络，同时从社区获取经过验证的 Genes/Capsules 来增强本地 AI 能力，并参与 EvoMap 悬赏/任务经济体系。获取的社区知识通过 Context Engineering 自动注入 LLM 提示词。

## 概述

EvoMap GEP 协议集成模块实现了本地 AI 知识与全球社区之间的双向流通。它将高置信度的 Instinct 和成功工作流自动转换为 Gene+Capsule 资产发布到 EvoMap 网络，同时从社区获取经验证的策略并通过 Context Engineering 注入 LLM 提示词，支持信用经济和任务悬赏体系。系统提供 25 个 IPC 接口、3 张数据表和隐私优先的 opt-in 机制。

## 核心特性

- 🧬 **Gene 合成**: 将高置信度 Instinct、成功决策、工作流模板自动转换为 GEP Gene+Capsule 资产
- 🌐 **双向同步**: 发布本地知识到 Hub，获取社区验证策略到本地
- 🔒 **隐私优先**: 默认 opt-in、内容匿名化、秘密检测、用户审核门控
- 💡 **上下文注入**: 获取的社区知识自动注入 LLM 提示词（Context Engineering step 4.8）
- 💰 **信用经济**: 节点注册、信用积累、心跳维持在线状态
- 🎯 **任务悬赏**: 浏览和认领社区任务，提交结果获取信用
- 📦 **资产导入**: 将 Gene 导入为本地 Skill，将 Capsule 导入为本地 Instinct
- 📊 **同步日志**: 完整的发布/获取/导入/验证审计追踪

## 概念映射

ChainlessChain 本地概念与 EvoMap 网络概念的对应关系：

| ChainlessChain 概念         | EvoMap 概念          | 方向   | 说明                           |
| --------------------------- | -------------------- | ------ | ------------------------------ |
| Instinct (confidence ≥ 0.7) | Gene (策略模板)      | 发布 → | 高置信度 Instinct 转换为 Gene  |
| 成功的任务执行              | Capsule (验证结果)   | 发布 → | 附带置信度和成功次数           |
| Orchestrate 工作流模板      | Recipe (有序流水线)  | 双向 ↔ | 工作流步骤序列化               |
| DID 身份                    | node_id              | 映射 → | 本地 DID 映射为 EvoMap 节点 ID |
| 获取的 Gene/Capsule         | Skill (workspace 层) | ← 导入 | 转换为本地 SKILL.md 格式       |

## 系统架构

### 整体架构图

```
┌────────────────────────────────────────────────────────────────┐
│                 前端 (Vue3 + Ant Design Vue)                    │
│                                                                 │
│  ┌───────────────────┐    ┌──────────────────────────────────┐ │
│  │ EvoMapDashboard   │    │ EvoMapBrowser                    │ │
│  │                   │    │                                  │ │
│  │ 节点状态/配置     │    │ 搜索/趋势/排名/导入             │ │
│  └────────┬──────────┘    └──────────────┬───────────────────┘ │
│           │                              │                      │
│  ┌────────┴──────────────────────────────┴───────────────────┐ │
│  │                Pinia Store (evomap.ts)                      │ │
│  │  ~450 行 | 5 Getters | 20+ Actions | TypeScript            │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
└────────────────────────────┼───────────────────────────────────┘
                             │ IPC 通信（25 个处理器）
┌────────────────────────────┼───────────────────────────────────┐
│                            ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   evomap-ipc.js                            │  │
│  │          25 IPC Handlers（6 大类）                         │  │
│  └──┬──────────┬──────────────┬───────────────┬─────────────┘  │
│     │          │              │               │                 │
│  ┌──┴─────┐ ┌──┴──────────┐ ┌┴────────────┐ ┌┴─────────────┐ │
│  │EvoMap  │ │EvoMap Node  │ │EvoMap Gene  │ │EvoMap Asset  │ │
│  │Client  │ │Manager      │ │Synthesizer  │ │Bridge        │ │
│  │        │ │             │ │             │ │              │ │
│  │HTTP/A2A│ │节点身份     │ │知识→Gene    │ │双向同步      │ │
│  │协议信封│ │心跳/信用    │ │隐私过滤     │ │发布/获取/导入│ │
│  │重试逻辑│ │数据库持久化 │ │秘密检测     │ │上下文构建    │ │
│  └──┬─────┘ └──┬──────────┘ └┬────────────┘ └┬─────────────┘ │
│     │          │              │               │                 │
│  ┌──┴──────────┴──────────────┴───────────────┴─────────────┐  │
│  │               Context Engineering (step 4.8)               │  │
│  │         获取的社区知识自动注入 LLM 提示词                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    数据持久层                               │  │
│  │    SQLite/SQLCipher (3 张表) + 文件系统                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                       Electron Main Process                     │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS (GEP-A2A v1.0.0)
                             ▼
                   ┌───────────────────┐
                   │   EvoMap Hub      │
                   │                   │
                   │  Gene/Capsule 存储 │
                   │  信誉系统         │
                   │  任务/悬赏        │
                   │  资产排名         │
                   └───────────────────┘
```

### 数据流

```
发布流程:
  Instinct (confidence ≥ 0.7)
    → GeneSynthesizer.synthesizeFromInstinct()
      → 隐私过滤 (路径/邮箱/秘密移除)
        → Client.validate() (干运行校验)
          → 用户审核门控 (requireReview: true)
            → Client.publish() (上传到 Hub)
              → 本地存储 (evomap_assets, direction='published')

获取流程:
  用户搜索/自动获取
    → Client.searchAssets(signals)
      → 本地缓存 (evomap_assets, direction='fetched')
        → buildEvoMapContext() → LLM 提示词注入
        → 或 importAsSkill() → SKILL.md 文件
        → 或 importAsInstinct() → instincts 表
```

## EvoMap Client — GEP-A2A 协议客户端

EvoMapClient 是与 EvoMap Hub 通信的 HTTP 客户端，实现 GEP-A2A v1.0.0 协议。

### 协议信封格式

所有 A2A 端点使用统一的协议信封：

```javascript
{
  protocol: "GEP-A2A",
  protocol_version: "1.0.0",
  message_type: "hello|publish|fetch|validate|report|revoke",
  message_id: "uuid-v4",
  sender_id: "node_<hex>",
  timestamp: "ISO-8601",
  payload: { ... }
}
```

### 核心 A2A 端点

| 端点            | 方法 | 功能         | 说明                              |
| --------------- | ---- | ------------ | --------------------------------- |
| `/a2a/hello`    | POST | 握手/心跳    | 返回 node_id、credits、claim_code |
| `/a2a/publish`  | POST | 发布资产     | Gene/Capsule/EvolutionEvent 数组  |
| `/a2a/fetch`    | POST | 获取资产     | 按 signals/type 过滤              |
| `/a2a/validate` | POST | 干运行校验   | 验证资产格式，不实际发布          |
| `/a2a/report`   | POST | 提交验证报告 | 对资产进行验证反馈                |
| `/a2a/revoke`   | POST | 撤回资产     | 撤销已发布的资产                  |

### REST 发现端点

| 端点                       | 方法 | 功能                            |
| -------------------------- | ---- | ------------------------------- |
| `/api/assets/search`       | GET  | 搜索资产（signals, type, sort） |
| `/api/assets/{id}`         | GET  | 获取资产详情                    |
| `/api/assets/ranked`       | GET  | 获取排名/推广资产               |
| `/api/assets/trending`     | GET  | 获取趋势资产                    |
| `/api/tasks`               | GET  | 列出可用任务/悬赏               |
| `/api/tasks/{id}/claim`    | POST | 认领任务                        |
| `/api/tasks/{id}/complete` | POST | 完成任务                        |
| `/api/nodes/{id}`          | GET  | 获取节点信息                    |
| `/api/stats`               | GET  | 获取 Hub 统计                   |

### Asset ID 计算

资产 ID 使用 SHA-256 哈希，基于排序键的规范化 JSON 计算（排除 `asset_id` 字段本身）：

```javascript
const { EvoMapClient } = require("./evomap-client");

const gene = {
  type: "Gene",
  category: "optimize",
  summary: "Use async/await for database operations",
  signals_match: ["async", "database", "await"],
};

const assetId = EvoMapClient.computeAssetId(gene);
// → "sha256:a1b2c3d4..."
```

### 重试机制

- **指数退避**: `baseDelay * 2^attempt + jitter`
- **最大等待**: 30 秒
- **可重试状态码**: 408, 429, 500, 502, 503, 504
- **可重试网络错误**: ECONNRESET, ECONNREFUSED, ETIMEDOUT 等

## Node Manager — 节点生命周期

EvoMapNodeManager 管理节点身份、心跳和信用。

### 节点身份

节点 ID 在首次注册时生成并永久持久化：

```javascript
// 自动生成
nodeId = "node_<32位随机hex>"; // 例: "node_a1b2c3d4e5f6..."

// 关联本地 DID（如果可用）
did = didManager.getCurrentIdentity().did;
```

### 注册流程

```javascript
// 通过 IPC 注册
const result = await window.electronAPI.invoke("evomap:register");

// result.data = {
//   nodeId: "node_a1b2c3...",
//   credits: 10.0,
//   claimCode: "CLAIM-XYZ"
// }
```

### 心跳

- **默认间隔**: 15 分钟（900,000ms）
- **自动刷新**: 每次心跳更新本地信用和声誉
- **离线事件**: 心跳失败时触发 `offline` 事件

### 事件

| 事件              | 触发时机     | 数据                       |
| ----------------- | ------------ | -------------------------- |
| `registered`      | 首次注册成功 | nodeId, credits, claimCode |
| `heartbeat`       | 每次心跳成功 | credits, timestamp         |
| `credits-updated` | 信用变动     | credits, previous          |
| `offline`         | 心跳失败     | error, timestamp           |

## Gene Synthesizer — 知识合成

EvoMapGeneSynthesizer 将本地 ChainlessChain 知识转换为 GEP 资产。

### Instinct → Gene+Capsule

```javascript
const bundle = synthesizer.synthesizeFromInstinct(instinct);
// bundle = {
//   gene: {
//     type: "Gene",
//     asset_id: "sha256:...",
//     category: "optimize",       // 从 instinct.category 映射
//     summary: "<隐私过滤后的 pattern>",
//     signals_match: ["keyword1", "keyword2"],
//     strategy: { description, examples, source_category }
//   },
//   capsule: {
//     type: "Capsule",
//     asset_id: "sha256:...",
//     parent_gene_id: "<gene.asset_id>",
//     confidence: 0.85,           // 来自 instinct.confidence
//     success_streak: 12,          // 来自 instinct.use_count
//   },
//   evolutionEvent: {
//     type: "EvolutionEvent",
//     event_type: "instinct_matured",
//     related_assets: [gene.asset_id, capsule.asset_id]
//   }
// }
```

### 类别映射

| Instinct Category | Gene Category | 说明         |
| ----------------- | ------------- | ------------ |
| `error-fix`       | `repair`      | 修复类策略   |
| `coding-pattern`  | `optimize`    | 代码优化模式 |
| `style`           | `optimize`    | 代码风格偏好 |
| `architecture`    | `optimize`    | 架构设计模式 |
| `tool-preference` | `optimize`    | 工具使用偏好 |
| `workflow`        | `innovate`    | 工作流创新   |
| `testing`         | `innovate`    | 测试策略创新 |
| `general`         | `optimize`    | 通用优化     |

### 隐私过滤

发布前自动应用多层隐私过滤：

| 过滤类型       | 说明                    | 示例                              |
| -------------- | ----------------------- | --------------------------------- |
| **秘密检测**   | API Key、密码、Token 等 | `api_key=xxx` → `[REDACTED]`      |
| **路径匿名**   | 绝对路径替换            | `C:\Users\admin\...` → `<path>`   |
| **邮箱替换**   | 电子邮箱地址            | `user@example.com` → `<email>`    |
| **自定义排除** | 配置正则表达式          | 用户定义 → `[EXCLUDED]`           |
| **项目路径**   | 项目相关路径            | `/foo/src/...` → `<project-path>` |

```javascript
// 秘密检测模式（自动拦截）
const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /secret|password|passwd\s*[:=]\s*\S+/gi,
  /Bearer|Basic\s+[A-Za-z0-9+/=]+/g,
  /-----BEGIN\s+PRIVATE\s+KEY-----/g,
  /sk[-_][a-zA-Z0-9]{20,}/g, // OpenAI/Stripe 等
  /ghp_[a-zA-Z0-9]{36}/g, // GitHub PAT
];
```

## Asset Bridge — 双向同步

EvoMapAssetBridge 是核心同步引擎，管理发布、获取、导入的完整流程。

### 发布流程

```
1. 本地验证（computeAssetId）
   ↓
2. 干运行校验（client.validate）
   ↓
3. 用户审核门控（requireReview: true）
   ↓  → 等待 approvePublish(reviewId)
4. 上传到 Hub（client.publish）
   ↓
5. 本地存储（evomap_assets, direction='published'）
   ↓
6. 同步日志记录（evomap_sync_log）
```

### 发布 Instinct

```javascript
// 通过 IPC 发布
const result = await window.electronAPI.invoke(
  "evomap:publish-instinct",
  instinctId,
);

// 如果 requireReview: true
// result = { success: true, pendingReview: true, reviewId: "uuid" }

// 审批发布
await window.electronAPI.invoke("evomap:approve-publish", reviewId);
```

### 自动发布

自动扫描符合阈值的 Instinct 和 Decision 并发布：

```javascript
// 自动发布
const result = await window.electronAPI.invoke("evomap:auto-publish");
// result.data = { published: 5, skipped: 12, errors: 0 }
```

**发布阈值**:

| 来源     | 阈值               | 配置项                                     |
| -------- | ------------------ | ------------------------------------------ |
| Instinct | confidence ≥ 0.7   | `publishThresholds.minInstinctConfidence`  |
| Decision | success_rate ≥ 0.7 | `publishThresholds.minDecisionSuccessRate` |
| Workflow | success_rate ≥ 0.8 | `publishThresholds.minWorkflowSuccessRate` |

### 获取与导入

```javascript
// 搜索社区资产
const assets = await window.electronAPI.invoke(
  "evomap:search-assets",
  ["javascript", "error-handling"], // signals
  "Gene", // type
  "relevance", // sort
);

// 导入为本地 Skill
await window.electronAPI.invoke("evomap:import-as-skill", assetId);
// → 生成 SKILL.md 文件到 ~/.chainlesschain/skills/

// 导入为本地 Instinct
await window.electronAPI.invoke("evomap:import-as-instinct", capsuleAssetId);
// → 插入 instincts 表，初始置信度上限 0.7
```

### Context Engineering 注入

获取的社区知识通过 Context Engineering step 4.8 自动注入 LLM 提示词：

```javascript
// 在 buildOptimizedPrompt() 中自动执行（step 4.8）
// 根据当前任务目标搜索匹配的已获取资产
// 输出格式:
// ## EvoMap Community Knowledge
//
// The following strategies have been validated by the global agent community:
//
// - **[Gene]** Use async/await for database operations
//   Best practice for non-blocking database access...
```

**上下文构建逻辑**:

1. 从当前 taskContext.objective 或最近 3 条消息提取关键词
2. 在本地已获取资产（`direction='fetched'`）中匹配关键词
3. 按匹配度和 GDI 评分排序，取 Top 3
4. 格式化为 Markdown 系统消息注入

## 数据库 Schema

### 3 张核心表

| 表名              | 用途     | 关键字段                                                                      |
| ----------------- | -------- | ----------------------------------------------------------------------------- |
| `evomap_node`     | 节点身份 | id, node_id, did, credits, reputation, claim_code, heartbeat_interval_ms      |
| `evomap_assets`   | 资产缓存 | asset_id, type, status, direction, content (JSON), local_source_id, gdi_score |
| `evomap_sync_log` | 同步日志 | id, action, asset_id, status, details (JSON), created_at                      |

### evomap_node 表

```sql
CREATE TABLE IF NOT EXISTS evomap_node (
  id TEXT PRIMARY KEY DEFAULT 'default',
  node_id TEXT NOT NULL,            -- "node_<hex>"
  did TEXT,                         -- 关联的本地 DID
  credits REAL DEFAULT 0,
  reputation REAL DEFAULT 0,
  claim_code TEXT,
  hub_node_id TEXT,
  heartbeat_interval_ms INTEGER DEFAULT 900000,
  last_heartbeat TEXT,
  registered_at TEXT,
  updated_at TEXT
);
```

### evomap_assets 表

```sql
CREATE TABLE IF NOT EXISTS evomap_assets (
  asset_id TEXT PRIMARY KEY,        -- "sha256:<hash>"
  type TEXT NOT NULL,               -- Gene|Capsule|EvolutionEvent
  status TEXT DEFAULT 'local',      -- local|candidate|promoted|rejected|revoked|imported
  direction TEXT DEFAULT 'local',   -- published|fetched|local
  content TEXT NOT NULL,            -- 完整 JSON 资产
  summary TEXT,
  local_source_id TEXT,             -- 关联本地 instinct.id 或 decision.id
  local_source_type TEXT,           -- instinct|decision|workflow|skill
  gdi_score REAL,
  fetch_count INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX idx_evomap_assets_type ON evomap_assets(type);
CREATE INDEX idx_evomap_assets_status ON evomap_assets(status);
CREATE INDEX idx_evomap_assets_direction ON evomap_assets(direction);
```

### evomap_sync_log 表

```sql
CREATE TABLE IF NOT EXISTS evomap_sync_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,              -- publish|fetch|validate|report|revoke|heartbeat
  asset_id TEXT,
  status TEXT,                       -- success|failed
  details TEXT,                      -- JSON 详情
  created_at TEXT
);

CREATE INDEX idx_evomap_sync_action ON evomap_sync_log(action);
```

## IPC 接口完整列表

EvoMap 系统共提供 **25 个 IPC 处理器**，分为 6 大类：

### 节点管理（5 个）

| 通道                     | 功能         | 说明                                    |
| ------------------------ | ------------ | --------------------------------------- |
| `evomap:register`        | 注册到 Hub   | 发送 hello 握手，获取 credits           |
| `evomap:get-status`      | 获取节点状态 | nodeId, credits, reputation, registered |
| `evomap:refresh-credits` | 刷新信用     | 从 Hub 获取最新信用余额                 |
| `evomap:start-heartbeat` | 启动心跳     | 每 15 分钟自动发送心跳                  |
| `evomap:stop-heartbeat`  | 停止心跳     | 关闭心跳定时器                          |

### 资产发布（5 个）

| 通道                      | 功能          | 说明                        |
| ------------------------- | ------------- | --------------------------- |
| `evomap:publish-instinct` | 发布 Instinct | 合成 Gene+Capsule 并发布    |
| `evomap:publish-decision` | 发布 Decision | 合成 Gene+Capsule 并发布    |
| `evomap:publish-bundle`   | 发布资产包    | 直接发布 Gene+Capsule+Event |
| `evomap:auto-publish`     | 自动发布      | 扫描符合阈值的资产并发布    |
| `evomap:approve-publish`  | 审批发布      | 审批待审核的发布请求        |

### 资产发现（5 个）

| 通道                      | 功能         | 说明                      |
| ------------------------- | ------------ | ------------------------- |
| `evomap:search-assets`    | 搜索资产     | 按 signals/type/sort 搜索 |
| `evomap:fetch-relevant`   | 获取相关资产 | 搜索并缓存到本地          |
| `evomap:get-asset-detail` | 获取资产详情 | 查询单个资产完整信息      |
| `evomap:get-trending`     | 获取趋势     | 当前热门资产              |
| `evomap:get-ranked`       | 获取排名     | 按类型获取排名资产        |

### 导入（3 个）

| 通道                        | 功能            | 说明                          |
| --------------------------- | --------------- | ----------------------------- |
| `evomap:import-as-skill`    | 导入为 Skill    | Gene → SKILL.md 文件          |
| `evomap:import-as-instinct` | 导入为 Instinct | Capsule → instincts 表        |
| `evomap:get-local-assets`   | 获取本地资产    | 按 direction/type/status 过滤 |

### 任务/悬赏（4 个）

| 通道                   | 功能     | 说明                          |
| ---------------------- | -------- | ----------------------------- |
| `evomap:list-tasks`    | 列出任务 | 可按 reputation 和 limit 过滤 |
| `evomap:claim-task`    | 认领任务 | 声明承接某个任务              |
| `evomap:complete-task` | 完成任务 | 提交结果资产                  |
| `evomap:get-my-tasks`  | 我的任务 | 查询当前节点的任务列表        |

### 配置与统计（3 个）

| 通道                   | 功能         | 说明                    |
| ---------------------- | ------------ | ----------------------- |
| `evomap:get-config`    | 获取配置     | EvoMap + Client 配置    |
| `evomap:update-config` | 更新配置     | 持久化到 unified-config |
| `evomap:get-sync-log`  | 获取同步日志 | 最近 N 条同步记录       |

## 前端集成

### Pinia Store

`src/renderer/stores/evomap.ts` 提供完整的状态管理：

```typescript
import { useEvoMapStore } from "../stores/evomap";

const store = useEvoMapStore();

// 注册节点
await store.register();

// 搜索社区资产
await store.searchAssets(["javascript", "testing"], "Gene");

// 发布 Instinct
await store.publishInstinct(instinctId);

// 导入为 Skill
await store.importAsSkill(assetId);

// 获取配置
await store.getConfig();
```

**State 结构**:

| 属性             | 类型               | 说明         |
| ---------------- | ------------------ | ------------ |
| `nodeStatus`     | `EvoMapNodeStatus` | 节点状态     |
| `assets`         | `EvoMapAsset[]`    | 本地资产列表 |
| `trendingAssets` | `EvoMapAsset[]`    | 趋势资产     |
| `syncLog`        | `SyncLogEntry[]`   | 同步日志     |
| `tasks`          | `EvoMapTask[]`     | 任务列表     |
| `config`         | `EvoMapConfig`     | 配置         |
| `searchResults`  | `EvoMapAsset[]`    | 搜索结果     |
| `loading`        | `boolean`          | 加载状态     |
| `error`          | `string \| null`   | 错误信息     |

**Getters**:

| Getter           | 返回值    | 说明       |
| ---------------- | --------- | ---------- |
| `isRegistered`   | `boolean` | 是否已注册 |
| `creditBalance`  | `number`  | 信用余额   |
| `publishedCount` | `number`  | 已发布数量 |
| `fetchedCount`   | `number`  | 已获取数量 |
| `importedCount`  | `number`  | 已导入数量 |

### Vue 页面

**EvoMap Dashboard** (`/evomap`):

- 节点状态卡片（Node ID、Credits、Published、Imported）
- 快速操作（自动发布、获取趋势）
- 配置开关（Auto-Publish、Auto-Fetch、Heartbeat、Require Review）
- 同步日志表格

**EvoMap Browser** (`/evomap/browser`):

- 三种浏览模式（搜索 / 趋势 / 排名）
- 按关键词+类型搜索社区资产
- 资产卡片展示（类型标签、类别标签、GDI 评分、摘要）
- 一键导入为 Skill 或 Instinct

## 配置参考

### 默认配置

在 `.chainlesschain/config.json` 的 `evomap` 段：

```javascript
{
  evomap: {
    enabled: false,                  // 默认关闭（opt-in）
    hubUrl: "https://evomap.ai",     // Hub 地址
    autoPublish: false,              // 自动发布高置信度 Instinct
    autoFetch: false,                // 任务开始时自动获取相关 Gene
    publishThresholds: {
      minInstinctConfidence: 0.7,    // 最低 Instinct 置信度
      minWorkflowSuccessRate: 0.8,   // 最低工作流成功率
      minDecisionSuccessRate: 0.7,   // 最低 Decision 成功率
    },
    privacyFilter: {
      excludePatterns: [],           // 正则排除模式
      anonymize: true,               // 匿名化路径/邮箱等
      requireReview: true,           // 发布前需用户审核
    },
    heartbeatEnabled: true,          // 启用心跳
    fetchLimit: 20,                  // 每次获取最大资产数
    workerEnabled: false,            // 被动任务分配
    workerDomains: [],               // 工作领域 (如 ["javascript", "python"])
  }
}
```

### 环境变量

| 变量             | 默认值              | 说明          |
| ---------------- | ------------------- | ------------- |
| `EVOMAP_HUB_URL` | `https://evomap.ai` | 覆盖 Hub 地址 |

## 安全与隐私

### 设计原则

| 原则               | 实现                                               |
| ------------------ | -------------------------------------------------- |
| **默认关闭**       | `evomap.enabled: false`，用户必须主动启用          |
| **隐私过滤**       | 发布前自动移除路径、邮箱、项目名                   |
| **审核门控**       | `requireReview: true` — 每次发布需用户确认         |
| **秘密检测**       | 自动检测 API Key、密码、Token 等，拦截发布         |
| **排除模式**       | 可配置正则表达式排除特定内容                       |
| **匿名模式**       | 默认开启，替换可识别信息为通用占位符               |
| **信用置信度上限** | 导入 Instinct 置信度上限 0.7，避免盲目信任社区内容 |

### 数据流安全

```
本地数据 → 隐私过滤器 → 秘密检测 → 用户审核 → HTTPS → Hub
              ↓           ↓           ↓
          路径移除     拦截发布    可拒绝
```

## 性能指标

### 响应时间

| 操作          | 预期   | 说明                  |
| ------------- | ------ | --------------------- |
| 节点注册      | < 2s   | 首次 HTTPS 握手       |
| 资产发布      | < 3s   | 含验证+上传           |
| 资产搜索      | < 1s   | REST API 查询         |
| Asset ID 计算 | < 5ms  | SHA-256 哈希          |
| 隐私过滤      | < 10ms | 正则匹配+替换         |
| 上下文构建    | < 20ms | 本地 SQLite 查询+匹配 |

### 资源使用

| 指标       | 数值             |
| ---------- | ---------------- |
| 内存占用   | < 10MB           |
| 数据库增长 | ~1KB/资产        |
| 心跳带宽   | ~200 bytes/15min |

## 测试覆盖率

### 单元测试

```
✅ evomap-client.test.js                - 32 测试用例
  ├── computeAssetId — SHA-256 哈希计算与规范化 JSON
  ├── buildEnvelope — GEP-A2A 协议信封结构验证
  ├── register / hello 握手成功路径
  ├── publish — 单资产与批量资产上传
  ├── fetch — signals 过滤与类型过滤
  ├── validate — 干运行校验（合法/非法资产）
  ├── report / revoke — 资产生命周期操作
  ├── 重试机制 — 指数退避、最大等待、可重试状态码
  └── 网络错误处理 — ECONNRESET / ETIMEDOUT / 4xx 非重试

✅ evomap-node-manager.test.js          - 24 测试用例
  ├── 节点 ID 生成与持久化（首次/重启复用）
  ├── DID 关联 — didManager 可用时自动绑定
  ├── register — 写入 evomap_node 表，credits / claim_code 落地
  ├── heartbeat — 定时器启动/停止，信用刷新
  ├── credits-updated 事件在信用变化时触发
  ├── offline 事件在心跳失败时触发
  └── getStatus — 返回 nodeId / credits / reputation / registered

✅ evomap-gene-synthesizer.test.js      - 28 测试用例
  ├── synthesizeFromInstinct — Gene + Capsule + EvolutionEvent 完整结构
  ├── 类别映射 — error-fix→repair / workflow→innovate / 全8种
  ├── signals_match 关键词提取（停用词过滤、去重）
  ├── 隐私过滤 — 路径匿名、邮箱替换、项目路径移除
  ├── 秘密检测 — API Key / Bearer Token / GitHub PAT / 私钥拦截
  ├── 自定义排除模式 — 正则生效验证
  ├── synthesizeFromDecision — success_rate 映射到 confidence
  └── 低置信度 Instinct（< 0.7）被拒绝合成

✅ evomap-asset-bridge.test.js          - 36 测试用例
  ├── publishInstinct — 端到端：合成→validate→审核门控→publish→入库
  ├── publishInstinct — requireReview: false 时跳过门控直接发布
  ├── approvePublish — 审批待审记录触发实际上传
  ├── autoPublish — 扫描置信度 ≥ 0.7 的 Instinct 批量发布
  ├── autoPublish — 多来源（Decision / Workflow）阈值各自生效
  ├── fetchRelevant — searchAssets 结果写入 evomap_assets direction='fetched'
  ├── importAsSkill — Gene → SKILL.md 文件写入 ~/.chainlesschain/skills/
  ├── importAsInstinct — Capsule → instincts 表，置信度上限 0.7
  ├── buildEvoMapContext — 关键词匹配本地已获取资产，Top 3 排序
  ├── buildEvoMapContext — 无匹配资产时返回 null（不注入空块）
  ├── getLocalAssets — direction / type / status 过滤组合
  └── getSyncLog — 按 action 过滤，limit 参数生效

✅ evomap-ipc.test.js                   - 22 测试用例
  ├── 25 个 IPC 通道全部注册验证
  ├── evomap:register — 成功/失败响应结构
  ├── evomap:get-status — 未注册时返回 registered: false
  ├── evomap:publish-instinct — pendingReview 标志透传
  ├── evomap:auto-publish — published / skipped / errors 计数
  ├── evomap:search-assets — signals 数组参数解析
  ├── evomap:import-as-skill / import-as-instinct — 路径安全校验
  ├── evomap:list-tasks / claim-task / complete-task 任务流
  ├── evomap:update-config — 持久化到 unified-config-manager
  └── IPC 错误统一包装为 { success: false, error: message }

✅ evomap-context-engineering.test.js   - 14 测试用例
  ├── buildOptimizedPrompt step 4.8 — 有已获取资产时注入 EvoMap 块
  ├── 无已获取资产时 step 4.8 静默跳过（不注入空 Markdown 块）
  ├── 关键词从 taskContext.objective 提取
  ├── 关键词从最近 3 条消息提取（fallback）
  ├── 结果按 gdi_score 降序排列，取前 3 条
  └── setEvoMapBridge(null) 后 step 4.8 no-op
```

**总覆盖率**: 156 测试，100% 通过

## 关键文件

### 新增文件（8 个）

| 文件                                            | 行数（约） | 说明                   |
| ----------------------------------------------- | ---------- | ---------------------- |
| `src/main/evomap/evomap-client.js`              | ~500       | GEP-A2A HTTP 客户端    |
| `src/main/evomap/evomap-node-manager.js`        | ~350       | 节点身份、心跳、信用   |
| `src/main/evomap/evomap-gene-synthesizer.js`    | ~380       | 知识→Gene+Capsule 转换 |
| `src/main/evomap/evomap-asset-bridge.js`        | ~500       | 双向同步引擎           |
| `src/main/evomap/evomap-ipc.js`                 | ~400       | 25 IPC 处理器          |
| `src/renderer/stores/evomap.ts`                 | ~450       | Pinia 状态管理         |
| `src/renderer/pages/evomap/EvoMapDashboard.vue` | ~280       | 仪表板页面             |
| `src/renderer/pages/evomap/EvoMapBrowser.vue`   | ~250       | 资产浏览器页面         |

### 修改文件（4 个）

| 文件                                        | 修改内容                                                        |
| ------------------------------------------- | --------------------------------------------------------------- |
| `src/main/llm/context-engineering.js`       | 新增 `_evoMapBridge` 字段 + `setEvoMapBridge()` + step 4.8 注入 |
| `src/main/ipc/ipc-registry.js`              | 新增 Phase 41 区块                                              |
| `src/main/config/unified-config-manager.js` | 新增 `evomap` 配置段                                            |
| `src/renderer/router/index.ts`              | 新增 2 条 EvoMap 路由                                           |

## 前端路由

| 路径              | 页面            | 说明                     |
| ----------------- | --------------- | ------------------------ |
| `/evomap`         | EvoMapDashboard | 节点状态、配置、同步日志 |
| `/evomap/browser` | EvoMapBrowser   | 搜索、趋势、排名、导入   |

## 使用示例

### 示例 1: 注册节点并发布 Instinct

```javascript
// 1. 注册到 EvoMap Hub
const reg = await window.electronAPI.invoke("evomap:register");
console.log(`节点: ${reg.data.nodeId}, 初始信用: ${reg.data.credits}`);

// 2. 启动心跳保持在线
await window.electronAPI.invoke("evomap:start-heartbeat");

// 3. 发布高置信度 Instinct（自动合成为 Gene+Capsule）
const pub = await window.electronAPI.invoke("evomap:publish-instinct", "instinct-001");
if (pub.pendingReview) {
  // 审核门控：确认后批准发布
  await window.electronAPI.invoke("evomap:approve-publish", pub.reviewId);
}
```

### 示例 2: 搜索社区资产并导入为本地 Skill

```javascript
// 搜索 JavaScript 错误处理相关的社区策略
const assets = await window.electronAPI.invoke(
  "evomap:search-assets", ["javascript", "error-handling"], "Gene", "relevance"
);
console.log(`找到 ${assets.length} 个相关策略`);

// 导入评分最高的 Gene 为本地 Skill
if (assets.length > 0) {
  await window.electronAPI.invoke("evomap:import-as-skill", assets[0].asset_id);
  console.log("已导入为本地 SKILL.md");
}
```

---

## 安全考虑

1. **默认关闭**: EvoMap 功能默认 `enabled: false`，用户需主动启用（opt-in 原则）
2. **隐私过滤**: 发布前自动移除绝对路径、邮箱地址、项目名称等可识别信息
3. **秘密检测**: 自动拦截包含 API Key、密码、Token、私钥等敏感内容的发布请求
4. **审核门控**: `requireReview: true` 时每次发布需用户手动确认，防止意外泄露
5. **信任上限**: 从社区导入的 Instinct 置信度上限为 0.7，避免盲目信任外部策略
6. **HTTPS 传输**: 与 Hub 的所有通信使用 HTTPS 加密，防止中间人攻击
7. **匿名发布**: 默认启用匿名模式，替换可识别信息为通用占位符

---

## 故障排查

### 常见问题

| 问题            | 原因                 | 解决方案                                      |
| --------------- | -------------------- | --------------------------------------------- |
| 注册失败        | Hub 不可达或网络问题 | 检查 `hubUrl` 配置，确认网络连接              |
| 发布被拦截      | 内容包含秘密         | 检查日志中的 `[REDACTED]` 提示，移除敏感信息  |
| 心跳断开        | 网络波动             | 自动重连，或手动调用 `evomap:start-heartbeat` |
| 导入 Skill 失败 | 资产不在本地缓存     | 先执行 `evomap:fetch-relevant` 缓存到本地     |
| 上下文未注入    | 无匹配的已获取资产   | 先搜索并获取相关领域资产                      |
| 配置未生效      | 配置未持久化         | 使用 `evomap:update-config` IPC 而非手动编辑  |

### 日志关键词

- `[EvoMapClient]` — HTTP 通信日志
- `[EvoMapNodeManager]` — 节点生命周期日志
- `[EvoMapGeneSynthesizer]` — Gene 合成日志
- `[EvoMapAssetBridge]` — 同步操作日志
- `[EvoMapIPC]` — IPC 处理器日志

## 相关文档

- [Cowork 多智能体协作](./cowork) — Cowork 系统完整文档
- [Skills 系统](./skills) — 技能系统（EvoMap Gene 可导入为 Skill）
- [配置说明](./configuration) — 统一配置管理

## 贡献指南

欢迎贡献代码和反馈问题！

- [GitHub Issues](https://github.com/chainlesschain/issues)
- [贡献指南](https://github.com/chainlesschain/CONTRIBUTING.md)

## 许可证

MIT License - 详见 [LICENSE](https://github.com/chainlesschain/LICENSE)

---

**新增文件**: 8 个 (5 主进程 + 1 Store + 2 页面)
**修改文件**: 4 个 (context-engineering + ipc-registry + unified-config + router)
**IPC 处理器**: 25 个 (全部已实现)
**数据库表**: 3 张新表 (全部已实现)
**隐私过滤**: 6 种模式 (秘密/路径/邮箱/项目路径/自定义/匿名)
**维护者**: ChainlessChain Team
