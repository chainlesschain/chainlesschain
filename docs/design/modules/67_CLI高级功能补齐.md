# Phase 102+ — CLI 高级功能补齐设计

**版本**: v5.0.1
**创建日期**: 2026-03-12
**状态**: ✅ 已实现

---

## 一、模块概述

### 1.1 背景

ChainlessChain CLI 在 Phase 101-102 完成了基础分发系统（npm 全局 CLI、预构建二进制、1009 测试），
但桌面端已实现的多项核心功能尚未在 CLI 侧提供对等的命令行接口。本阶段（Phase 102+）补齐 12 个
高级模块的 CLI 实现，涵盖 AI 核心、安全隔离、区块链经济和多代理协调四大领域，新增 10 个顶级命令、
36 个数据库表、440 项单元测试。

### 1.2 设计目标

| 目标                    | 描述                                                        |
| ----------------------- | ----------------------------------------------------------- |
| **功能对齐**            | CLI 与桌面端在 A2A、工作流、记忆、沙箱、ZKP 等方面功能一致 |
| **轻量化**              | 纯 JS 实现，无原生依赖，保持 CLI 包 < 3 MB                 |
| **可测试性**            | 每个模块独立、可 mock 的 DB 接口，便于单元测试              |
| **渐进式加载**          | 各模块按需 import，不影响 CLI 冷启动时间                    |
| **数据持久化**          | 全部使用 SQLite 表持久化，与桌面端共享同一数据库文件        |

### 1.3 阶段划分

| 阶段      | 领域              | 模块                                                        |
| --------- | ----------------- | ----------------------------------------------------------- |
| Phase 6   | AI 核心           | hook-manager, workflow-engine, hierarchical-memory, a2a-protocol |
| Phase 7   | 安全              | sandbox-v2, evolution-system                                |
| Phase 8   | 区块链 / 分析     | agent-economy, zkp-engine, bi-engine                        |
| Phase 9   | 多代理 / 平台     | agent-coordinator, service-container, app-builder           |

---

## 二、技术架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        chainlesschain CLI                          │
│  bin/chainlesschain.js → src/index.js (Commander)                  │
├─────────────────────────────────────────────────────────────────────┤
│                          Commands Layer                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │  hook     │ │ workflow │ │ hmemory  │ │   a2a    │  Phase 6     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘              │
│  ┌────┴─────┐ ┌────┴──────────┐                                   │
│  │ sandbox  │ │  evolution    │                          Phase 7   │
│  └────┬─────┘ └────┬──────────┘                                   │
│  ┌────┴─────┐ ┌────┴─────┐ ┌──────────┐                          │
│  │ economy  │ │   zkp    │ │    bi    │              Phase 8      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘                          │
│  ┌────┴──────────┐ ┌────┴──────────┐                              │
│  │ (coordinator) │ │   lowcode     │                  Phase 9     │
│  └────┬──────────┘ └────┬──────────┘                              │
├───────┴─────────────────┴───────────────────────────────────────────┤
│                          Library Layer                             │
│  src/lib/hook-manager.js        src/lib/workflow-engine.js         │
│  src/lib/hierarchical-memory.js src/lib/a2a-protocol.js            │
│  src/lib/sandbox-v2.js          src/lib/evolution-system.js        │
│  src/lib/agent-economy.js       src/lib/zkp-engine.js              │
│  src/lib/bi-engine.js           src/lib/agent-coordinator.js       │
│  src/lib/service-container.js   src/lib/app-builder.js             │
├─────────────────────────────────────────────────────────────────────┤
│                     Runtime / Bootstrap                            │
│  src/runtime/bootstrap.js (7-stage headless init, DB handle)       │
├─────────────────────────────────────────────────────────────────────┤
│                     Storage: SQLite (36 tables)                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、核心模块设计

### 3.1 Phase 6 — AI 核心

#### 3.1.1 Hook Manager (`hook-manager.js`)

生命周期钩子的注册、执行和统计。支持对 IPC、工具调用、会话、Git 等系统事件挂载回调。

| 功能         | 说明                                                      |
| ------------ | --------------------------------------------------------- |
| 优先级体系   | SYSTEM(0) > HIGH(100) > NORMAL(500) > LOW(900) > MONITOR(1000) |
| 执行类型     | sync / async / command / script                           |
| 事件列表     | PreIPCCall, PostIPCCall, IPCError, PreToolUse, PostToolUse, ToolError, SessionStart, SessionEnd 等 |
| 统计报表     | 每个钩子的执行次数、平均耗时、失败率                      |

**数据库表**: `hooks`, `hook_executions`

#### 3.1.2 Workflow Engine (`workflow-engine.js`)

DAG 工作流的创建、执行和管理。支持多阶段动作/审批节点、暂停/恢复、回滚、内置模板。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| DAG 验证       | DFS 环检测，确保工作流无循环依赖                  |
| 阶段类型       | action（执行）、approval（审批门）                |
| 执行控制       | pause / resume / rollback                         |
| 内置模板       | 代码部署、数据处理等标准工作流模板                |

**数据库表**: `workflows`, `workflow_executions`

#### 3.1.3 Hierarchical Memory 2.0 (`hierarchical-memory.js`)

四层记忆系统：working → short-term → long-term → core，基于 Ebbinghaus 遗忘曲线实现自动巩固和衰减。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 四层容量       | working(50) → short-term(500) → long-term(10000) → core |
| 遗忘曲线       | retention = e^(-decay_rate * age_hours)            |
| 巩固机制       | 高频访问的记忆自动向更深层迁移                    |
| 跨 Agent 共享  | 通过 shareMemory 接口支持记忆共享                 |

**数据库表**: `hmemory_long_term`, `hmemory_core`, `hmemory_episodic`, `hmemory_semantic`

#### 3.1.4 A2A Protocol (`a2a-protocol.js`)

实现 Google A2A 协议概念：Agent Card 注册、任务生命周期管理、能力协商和对等发现。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| Agent Card     | 注册、更新、发现，包含名称/描述/能力列表          |
| 任务生命周期   | submitted → working → completed / failed / input-required |
| 能力协商       | negotiateCapability 匹配请求者与提供者            |
| 订阅通知       | 基于 Map<taskId, Set<callback>> 的实时推送        |

**数据库表**: `a2a_agent_cards`, `a2a_tasks`, `a2a_negotiations`

### 3.2 Phase 7 — 安全

#### 3.2.1 Sandbox v2 (`sandbox-v2.js`)

安全沙箱，为 Agent 代码提供权限隔离、资源配额和行为监控的执行环境。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 权限控制       | 文件系统(read/write/denied)、网络(allowed/denied)、系统调用白名单 |
| 资源配额       | CPU(100)、内存(256MB)、存储(100MB)、网络连接(1000) |
| 行为监控       | 实时记录沙箱内操作，生成审计日志                  |
| 生命周期       | create → exec → monitor → destroy                 |

**数据库表**: `sandbox_instances`, `sandbox_audit`, `sandbox_quotas`

#### 3.2.2 Evolution System (`evolution-system.js`)

自进化 AI 系统：能力评估、增量学习、自我诊断、自我修复和行为预测。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 能力评估       | 按分类打分，追踪趋势（improving / stable / declining） |
| 增量学习       | 在线学习，无需全量重训                            |
| 自我诊断       | 检测性能退化、异常行为模式                        |
| 自我修复       | 基于诊断结果自动修复已知问题                      |
| 行为预测       | 基于历史数据预测未来行为趋势                      |

**数据库表**: `evolution_capabilities`, `evolution_growth_log`, `evolution_models`, `evolution_diagnoses`

### 3.3 Phase 8 — 区块链 / 分析

#### 3.3.1 Agent Economy (`agent-economy.js`)

代币驱动的 Agent 经济体系：微支付、State Channel、资源市场、NFT、贡献记录和收益分配。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 余额管理       | 充值、转账、锁定/解锁                             |
| State Channel  | 链下微支付通道，open / close 生命周期             |
| 资源市场       | 挂牌、摘牌、交易                                  |
| NFT            | 铸造、转让数字资产凭证                            |
| 收益分配       | 按贡献度自动分配收益                              |

**数据库表**: `economy_balances`, `economy_transactions`, `economy_channels`, `economy_market`, `economy_nfts`, `economy_contributions`

#### 3.3.2 ZKP Engine (`zkp-engine.js`)

零知识证明引擎：电路编译、证明生成、验证和选择性身份披露。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 电路编译       | 将逻辑定义编译为可执行电路                        |
| 证明生成       | 基于 Groth16 方案生成零知识证明                   |
| 证明验证       | 使用验证密钥验证证明有效性                        |
| 身份披露       | 选择性披露身份属性，无需暴露完整信息              |

**数据库表**: `zkp_circuits`, `zkp_proofs`

#### 3.3.3 BI Engine (`bi-engine.js`)

商业智能引擎：自然语言查询（NL→SQL）、仪表板、报表、异常检测、趋势预测和定时调度。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| NL→SQL         | 自然语言转化为 SQL 查询                           |
| 仪表板         | 创建/管理仪表板，支持多种 widget                  |
| 报表           | 生成 PDF/HTML/CSV 格式报表                        |
| 异常检测       | 基于统计模型检测数据异常                          |
| 趋势预测       | 时间序列分析，预测未来走势                        |
| 5 种模板       | KPI、Sales、Operations、HR、Finance               |

**数据库表**: `bi_dashboards`, `bi_reports`, `bi_scheduled_reports`, `bi_queries`

### 3.4 Phase 9 — 多代理 / 平台

#### 3.4.1 Agent Coordinator (`agent-coordinator.js`)

多代理协调器：任务分解、Agent 选择、子任务分配和结果聚合。

| 功能           | 说明                                                   |
| -------------- | ------------------------------------------------------ |
| 任务分解       | 基于关键词匹配将复杂任务拆分为子任务                   |
| Agent 类型     | code-generation, code-review, data-analysis 等多种类型 |
| 能力匹配       | 根据关键词映射自动选择最佳 Agent                       |
| 结果聚合       | 收集各子任务结果并合并为最终输出                       |

**数据库表**: `coordinator_tasks`, `coordinator_agents`, `coordinator_assignments`

#### 3.4.2 Service Container (`service-container.js`)

CLI 服务的依赖注入容器，支持 singleton/transient 生命周期、延迟解析、循环依赖检测和标签查询。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 生命周期       | singleton（缓存实例）、transient（每次新建）      |
| 延迟解析       | lazy=true 时首次使用才实例化                       |
| 循环检测       | 通过 _initializing Set 检测循环依赖               |
| 标签系统       | 基于 tags 分组查询服务                            |
| 批量销毁       | dispose() 清理所有已解析实例                      |

**说明**: Service Container 为纯内存模块，不使用数据库表。

#### 3.4.3 App Builder (`app-builder.js`)

低代码应用构建器：创建、设计、预览、发布和管理低代码应用，内置 15 种组件和数据源管理。

| 功能           | 说明                                              |
| -------------- | ------------------------------------------------- |
| 15 种组件      | Form, DataTable, BarChart, LineChart, PieChart, Dashboard, Button, TextInput, Select, Modal, Card, List, Image, Tabs, Alert |
| 数据源         | 连接外部数据源，绑定到组件                        |
| 版本管理       | 保存/回滚应用设计版本                             |
| 发布/导出      | 发布应用或导出为静态文件                          |

**数据库表**: `lowcode_apps`, `lowcode_datasources`, `lowcode_versions`

---

## 四、新增命令一览

| 命令          | 子命令                                                                   | 描述                       |
| ------------- | ------------------------------------------------------------------------ | -------------------------- |
| `hook`        | list, add, remove, run, stats, events                                    | 生命周期钩子管理           |
| `workflow`    | create, list, run, status, pause, resume, rollback, templates, delete    | DAG 工作流引擎             |
| `hmemory`     | store, recall, consolidate, search, stats, share, prune                  | 层次化记忆 2.0             |
| `a2a`         | register, discover, submit, status, complete, fail, peers, cards, negotiate | A2A 协议通信            |
| `sandbox`     | create, exec, destroy, list, audit, quota, monitor                       | 安全沙箱 v2               |
| `evolution`   | assess, learn, diagnose, repair, predict, growth, stats, export          | 自进化 AI 系统             |
| `economy`     | price, pay, balance, channel, market, trade, nft, revenue, contribute    | Agent 经济系统             |
| `zkp`         | compile, prove, verify, identity, stats, circuits, proofs                | 零知识证明引擎             |
| `bi`          | query, dashboard, report, schedule, anomaly, predict, templates          | BI 智能分析                |
| `lowcode`     | create, list, preview, publish, components, datasource, versions, rollback, export, deploy | 低代码应用平台 |

> **注**: `agent-coordinator` 和 `service-container` 为库模块，不单独暴露顶级命令。
> Agent Coordinator 通过 `cowork` 命令内部调用；Service Container 为框架基础设施。

---

## 五、数据库表

### 5.1 Phase 6 — AI 核心 (10 表)

```sql
-- Hook Manager
CREATE TABLE IF NOT EXISTS hooks (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  handler TEXT NOT NULL,
  type TEXT DEFAULT 'async',
  priority INTEGER DEFAULT 500,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hook_executions (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL,
  event TEXT,
  status TEXT DEFAULT 'success',
  duration_ms REAL,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow Engine
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  dag TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  input TEXT,
  log TEXT DEFAULT '[]',
  current_stage TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Hierarchical Memory 2.0
CREATE TABLE IF NOT EXISTS hmemory_long_term (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT,
  importance REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  retention REAL DEFAULT 1.0,
  created_at TEXT DEFAULT (datetime('now')),
  last_accessed TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hmemory_core (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT,
  importance REAL DEFAULT 0.9,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hmemory_episodic (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  context TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hmemory_semantic (
  id TEXT PRIMARY KEY,
  concept TEXT NOT NULL,
  relations TEXT,
  embedding TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- A2A Protocol
CREATE TABLE IF NOT EXISTS a2a_agent_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  capabilities TEXT,
  endpoint TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS a2a_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  status TEXT DEFAULT 'submitted',
  input TEXT,
  output TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 5.2 Phase 7 — 安全 (7 表)

```sql
-- Sandbox v2
CREATE TABLE IF NOT EXISTS sandbox_instances (
  id TEXT PRIMARY KEY,
  name TEXT,
  permissions TEXT,
  quota TEXT,
  status TEXT DEFAULT 'created',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sandbox_audit (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  action TEXT,
  details TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sandbox_quotas (
  sandbox_id TEXT PRIMARY KEY,
  cpu INTEGER DEFAULT 100,
  memory INTEGER DEFAULT 268435456,
  storage INTEGER DEFAULT 104857600,
  network INTEGER DEFAULT 1000
);

-- Evolution System
CREATE TABLE IF NOT EXISTS evolution_capabilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score REAL DEFAULT 0,
  category TEXT,
  trend TEXT DEFAULT 'stable',
  history TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evolution_growth_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  description TEXT,
  capability_id TEXT,
  delta REAL DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evolution_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  config TEXT,
  accuracy REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evolution_diagnoses (
  id TEXT PRIMARY KEY,
  issue TEXT NOT NULL,
  severity TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'open',
  repair_action TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 5.3 Phase 8 — 区块链 / 分析 (12 表)

```sql
-- Agent Economy
CREATE TABLE IF NOT EXISTS economy_balances (
  agent_id TEXT PRIMARY KEY,
  balance REAL DEFAULT 0,
  locked REAL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS economy_transactions (
  id TEXT PRIMARY KEY,
  from_agent TEXT,
  to_agent TEXT,
  amount REAL NOT NULL,
  type TEXT DEFAULT 'transfer',
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS economy_channels (
  id TEXT PRIMARY KEY,
  party_a TEXT NOT NULL,
  party_b TEXT NOT NULL,
  deposit REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS economy_market (
  id TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  resource TEXT,
  price REAL,
  status TEXT DEFAULT 'listed',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS economy_nfts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  metadata TEXT,
  minted_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS economy_contributions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT,
  amount REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ZKP Engine
CREATE TABLE IF NOT EXISTS zkp_circuits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT,
  compiled TEXT,
  verification_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zkp_proofs (
  id TEXT PRIMARY KEY,
  circuit_id TEXT NOT NULL,
  proof TEXT,
  public_inputs TEXT,
  verified INTEGER DEFAULT 0,
  scheme TEXT DEFAULT 'groth16',
  created_at TEXT DEFAULT (datetime('now'))
);

-- BI Engine
CREATE TABLE IF NOT EXISTS bi_dashboards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  widgets TEXT,
  layout TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bi_reports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT,
  result TEXT,
  format TEXT DEFAULT 'pdf',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bi_scheduled_reports (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  cron TEXT,
  next_run TEXT,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bi_queries (
  id TEXT PRIMARY KEY,
  nl_query TEXT,
  sql_query TEXT,
  result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 5.4 Phase 9 — 多代理 / 平台 (6 表)

```sql
-- Agent Coordinator
CREATE TABLE IF NOT EXISTS coordinator_tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  subtasks TEXT,
  status TEXT DEFAULT 'pending',
  result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coordinator_agents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  capabilities TEXT,
  status TEXT DEFAULT 'idle',
  registered_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coordinator_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  subtask TEXT,
  status TEXT DEFAULT 'assigned',
  result TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Low-Code App Builder
CREATE TABLE IF NOT EXISTS lowcode_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  design TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lowcode_datasources (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  config TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lowcode_versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

> **Service Container**: 纯内存模块，无数据库表。

---

## 六、测试覆盖

共计 **12 个测试文件**，**440 项单元测试**，位于 `packages/cli/__tests__/unit/`。

| 测试文件                       | 测试数 | 覆盖模块                |
| ------------------------------ | ------ | ----------------------- |
| `hook-manager.test.js`         | 46     | Hook Manager            |
| `workflow-engine.test.js`      | 41     | Workflow Engine          |
| `hierarchical-memory.test.js`  | 30     | Hierarchical Memory 2.0 |
| `a2a-protocol.test.js`         | 34     | A2A Protocol             |
| `sandbox-v2.test.js`           | 33     | Sandbox v2              |
| `evolution-system.test.js`     | 42     | Evolution System        |
| `agent-economy.test.js`        | 34     | Agent Economy            |
| `zkp-engine.test.js`           | 50     | ZKP Engine               |
| `bi-engine.test.js`            | 40     | BI Engine                |
| `agent-coordinator.test.js`    | 33     | Agent Coordinator        |
| `service-container.test.js`    | 26     | Service Container        |
| `app-builder.test.js`          | 31     | App Builder              |
| **合计**                       | **440**|                         |

### 测试运行

```bash
cd packages/cli

# 运行全部 Phase 6-9 测试
npm test -- --grep "hook-manager|workflow-engine|hierarchical-memory|a2a-protocol|sandbox-v2|evolution-system|agent-economy|zkp-engine|bi-engine|agent-coordinator|service-container|app-builder"

# 按阶段运行
npm test -- __tests__/unit/hook-manager.test.js __tests__/unit/workflow-engine.test.js __tests__/unit/hierarchical-memory.test.js __tests__/unit/a2a-protocol.test.js
npm test -- __tests__/unit/sandbox-v2.test.js __tests__/unit/evolution-system.test.js
npm test -- __tests__/unit/agent-economy.test.js __tests__/unit/zkp-engine.test.js __tests__/unit/bi-engine.test.js
npm test -- __tests__/unit/agent-coordinator.test.js __tests__/unit/service-container.test.js __tests__/unit/app-builder.test.js
```

---

## 七、核心文件列表

### 7.1 库文件 (`src/lib/`)

| 文件                        | 职责                                           |
| --------------------------- | ---------------------------------------------- |
| `hook-manager.js`           | 钩子注册/执行/优先级/统计                      |
| `workflow-engine.js`        | DAG 工作流创建/执行/暂停/回滚/模板             |
| `hierarchical-memory.js`    | 四层记忆/遗忘曲线/巩固/共享                    |
| `a2a-protocol.js`           | Agent Card/任务生命周期/能力协商/订阅          |
| `sandbox-v2.js`             | 沙箱创建/权限/配额/行为监控/审计               |
| `evolution-system.js`       | 能力评估/增量学习/诊断/修复/预测               |
| `agent-economy.js`          | 余额/支付/State Channel/市场/NFT/贡献/分配     |
| `zkp-engine.js`             | 电路编译/证明生成/验证/身份披露                |
| `bi-engine.js`              | NL→SQL/仪表板/报表/异常检测/趋势预测/调度      |
| `agent-coordinator.js`      | 任务分解/Agent选择/子任务分配/结果聚合          |
| `service-container.js`      | DI容器/singleton/transient/延迟解析/标签        |
| `app-builder.js`            | 应用创建/15组件/数据源/版本/发布/导出           |

### 7.2 命令文件 (`src/commands/`)

| 文件            | 注册函数                       | 顶级命令     |
| --------------- | ------------------------------ | ------------ |
| `hook.js`       | `registerHookCommand`          | `hook`       |
| `workflow.js`   | `registerWorkflowCommand`      | `workflow`   |
| `hmemory.js`    | `registerHmemoryCommand`       | `hmemory`    |
| `a2a.js`        | `registerA2aCommand`           | `a2a`        |
| `sandbox.js`    | `registerSandboxCommand`       | `sandbox`    |
| `evolution.js`  | `registerEvolutionCommand`     | `evolution`  |
| `economy.js`    | `registerEconomyCommand`       | `economy`    |
| `zkp.js`        | `registerZkpCommand`           | `zkp`        |
| `bi.js`         | `registerBiCommand`            | `bi`         |
| `lowcode.js`    | `registerLowcodeCommand`       | `lowcode`    |

### 7.3 测试文件 (`__tests__/unit/`)

| 文件                          | 测试项 |
| ----------------------------- | ------ |
| `hook-manager.test.js`        | 46     |
| `workflow-engine.test.js`     | 41     |
| `hierarchical-memory.test.js` | 30     |
| `a2a-protocol.test.js`        | 34     |
| `sandbox-v2.test.js`          | 33     |
| `evolution-system.test.js`    | 42     |
| `agent-economy.test.js`       | 34     |
| `zkp-engine.test.js`          | 50     |
| `bi-engine.test.js`           | 40     |
| `agent-coordinator.test.js`   | 33     |
| `service-container.test.js`   | 26     |
| `app-builder.test.js`         | 31     |

---

## 八、Context Engineering 适配器

### 8.1 概述

`cli-context-engineering.js` 是桌面端 Context Engineering 系统的 CLI 轻量级移植。桌面端有 18 个注入器，
CLI 保留适用的 6 个（Instinct / Memory / BM25 Notes / Task Reminder / Permanent Memory / Compaction Summary），
加上 KV-Cache 友好的 System Prompt 清理、稳定前缀缓存和基于重要性评分的智能压缩（含可恢复摘要）。

### 8.2 架构

```
agent-repl.js
    │
    ├── bootstrap() → ctx.db
    │
    ├── CLIContextEngineering({ db })
    │       │
    │       ├── buildOptimizedMessages(rawMessages, { userQuery })
    │       │       ├── 1. System Prompt 清理 (时间戳/UUID/session_id → 占位符) + 稳定前缀缓存
    │       │       ├── 2. Instinct 注入 (generateInstinctPrompt)
    │       │       ├── 3. Memory 注入 (recallMemory, limit: 5)
    │       │       ├── 4. BM25 Notes 注入 (topK: 3, threshold: 0.5)
    │       │       ├── 5. Permanent Memory 注入 (getRelevantContext, limit: 3)
    │       │       ├── 5b. Compaction Summary 注入 (被丢弃消息的单行摘要)
    │       │       ├── 6. 对话历史清理 (删除 metadata)
    │       │       ├── 7. 错误上下文 (最近 5 条 + 解决方案)
    │       │       └── 8. Task 重述 (objective + steps + progress)
    │       │
    │       ├── smartCompact(messages, { keepPairs: 6 })
    │       │       评分: 时间近(5) + tool_calls(2) + 任务相关(3) + Error(1)
    │       │
    │       ├── recordError({ step, message, resolution })
    │       ├── setTask(objective, steps) / clearTask()
    │       └── getStats() / reindexNotes()
    │
    ├── session-manager (createSession / saveMessages / getSession)
    └── hierarchical-memory (storeMemory / consolidateMemory)
```

### 8.3 依赖关系

| 依赖 | 用途 | 降级策略 |
|------|------|----------|
| `bootstrap.js` | DB 初始化 | 失败则 db=null，静态 prompt |
| `instinct-manager.js` | 偏好注入 | try/catch 跳过 |
| `hierarchical-memory.js` | 记忆注入 + 存储 | try/catch 跳过 |
| `bm25-search.js` | 笔记搜索 | 懒加载，失败跳过 |
| `permanent-memory.js` | 跨会话持久记忆 | try/catch 跳过 |
| `session-manager.js` | 会话持久化 | try/catch 跳过 |

### 8.4 新增斜杠命令

| 命令 | 功能 |
|------|------|
| `/task <objective>` | 设置任务目标 |
| `/task clear` | 清除任务 |
| `/session` | 显示 Session 信息 |
| `/session resume <id>` | 恢复历史会话 |
| `/reindex` | 重新索引笔记 |
| `/stats` | Context Engine 统计 |
| `/auto <goal>` | 提交自主执行目标 |
| `/auto status` | 查看自主目标进度 |
| `/auto pause/resume/cancel` | 暂停/恢复/取消自主执行 |
| `/auto list` | 列出所有目标 |
| `/plan execute` | 按 DAG 依赖顺序执行计划 |
| `/plan risk` | 显示风险评估报告 |
| `/cowork graph` | ASCII 代码知识图谱 |
| `/cowork decision` | 决策追踪知识库 |
| `/provider <p>` | 切换提供商 (7 providers: ollama/anthropic/openai/deepseek/dashscope/mistral/gemini) |

### 8.5 测试

| 测试文件 | 测试数 |
|----------|--------|
| `cli-context-engineering.test.js` (unit) | ~50 |
| `agent-repl.test.js` (unit, 含新增) | 12 |
| `context-engineering.test.js` (e2e) | 11 |
| `permanent-memory.test.js` (unit) | 22 |
| `autonomous-agent.test.js` (unit) | 28 |
| `content-recommender.test.js` (unit) | 19 |
| `evomap-client.test.js` (unit) | 23 |
| `plan-mode.test.js` (unit, 含新增 DAG/风险) | ~60 |
| `phase102-commands.test.js` (e2e) | 27 |

---

## 九、Phase 102+ — CLI-Desktop 对齐 (6 Phase 实现)

### 9.1 概述

基于 docs-site 156 文档页面与 CLI 实际实现的对比分析，完成 9 个高优先级缺失功能的对齐。
新增 4 个核心模块、增强 2 个现有模块、新增 1 个顶级命令（`evomap`），新增约 200 项测试。

### 9.2 新增模块

#### 9.2.1 Permanent Memory (`permanent-memory.js`)

跨会话持久记忆，支持 Daily Notes、MEMORY.md 和 BM25 混合搜索。

| 功能 | 说明 |
|------|------|
| Daily Notes | 每日追加笔记，自动按日期分组 |
| MEMORY.md | 更新章节式永久记忆文件 |
| 混合搜索 | BM25 搜索 DB 条目 + Daily Notes + MEMORY.md |
| 自动摘要 | 会话结束自动提取关键事实存入永久记忆 |
| 优雅降级 | 无 DB 时降级为只读 MEMORY.md |

**数据库表**: `permanent_memory`

**API**:
```js
class CLIPermanentMemory {
  initialize()
  appendDailyNote(content)
  updateMemoryFile(section, content)
  hybridSearch(query, { topK })
  getRelevantContext(query, limit)  // 供 context engine 第 5 注入源
  autoSummarize(sessionMessages)
}
```

#### 9.2.2 Autonomous Agent (`autonomous-agent.js`)

ReAct 自主任务循环，将 CLI agent 从被动问答升级为自主执行。

| 功能 | 说明 |
|------|------|
| 目标分解 | LLM 自动将目标拆分为可执行子步骤 |
| ReAct 循环 | Reason → Act → Observe 循环执行 |
| 自我纠正 | 失败时 LLM 重新规划替代方案 |
| 暂停/恢复 | 支持暂停、恢复、取消目标 |
| 事件驱动 | EventEmitter 通知目标生命周期变更 |

**API**:
```js
class CLIAutonomousAgent extends EventEmitter {
  initialize({ llmChat, toolExecutor, hookManager })
  submitGoal(description, { tokenBudget })
  pauseGoal(goalId) / resumeGoal(goalId) / cancelGoal(goalId)
  getGoalStatus(goalId) / listGoals()
}
```

**斜杠命令**: `/auto <goal>`, `/auto status`, `/auto pause`, `/auto resume`, `/auto cancel`, `/auto list`

#### 9.2.3 Content Recommender (`content-recommender.js`)

TF-IDF 工具相似度计算 + 工具链频率推荐。

| 功能 | 说明 |
|------|------|
| TF-IDF 特征 | 基于工具描述构建特征向量 |
| 余弦相似度 | 计算工具间语义相似度 |
| 链频率追踪 | 记录工具使用序列，检测常见链 |
| 下一工具推荐 | 基于链频率推荐最可能的下一个工具 |
| 技能推荐 | BM25 匹配用户查询与技能描述 |

**API**:
```js
class CLIContentRecommender {
  buildToolFeatures(tools)
  calculateSimilarity(tool1, tool2)
  recordToolUse(toolName)
  recommendNextTool(currentTool)
  recommendSkill(userQuery, skills)
  getChainStats() / getSimilarityMatrix()
}
```

#### 9.2.4 EvoMap Client + Manager (`evomap-client.js`, `evomap-manager.js`)

GEP-A2A (Gene Exchange Protocol) HTTP 客户端 + 本地 gene 管理。

| 功能 | 说明 |
|------|------|
| Hub 搜索 | 搜索远程 Hub 上的 gene 包 |
| 下载/发布 | 下载 gene 到本地 / 发布到 Hub |
| 本地管理 | 安装、列表、删除本地 gene |
| 打包 | 将本地技能打包为 gene 格式 |
| 多 Hub | 支持自定义 Hub URL |

**数据库表**: `evomap_genes`

**CLI 命令**: `evomap search|download|publish|list|hubs`

### 9.3 增强模块

#### 9.3.1 Context Engineering 增强 (`cli-context-engineering.js`)

| 增强 | 说明 |
|------|------|
| Permanent Memory 注入 | 第 5 注入源：跨会话持久记忆 |
| 可恢复压缩摘要 | smartCompact 被丢弃消息生成单行摘要（max 20），注入 `## Compacted Context Summary` |
| 稳定前缀缓存 | SHA-256 hash 稳定前缀，仅重新清洗动态后缀，提升 KV-Cache 命中率 |
| 增强统计 | `getStats()` 新增 `hasPermanentMemory`、`compactionSummaries`、`prefixCached` |

#### 9.3.2 Plan Mode 增强 (`plan-mode.js`)

| 增强 | 说明 |
|------|------|
| DAG 拓扑排序执行 | `ExecutionPlan.executeInOrder()` 按依赖排序，失败阻塞下游 |
| 风险评分 | `PlanItem.riskScore = tool_weight × impact_multiplier` (read=1/write=2/shell=3 × low=1/medium=2/high=3) |
| 风险评估 | `getRiskAssessment()` 返回 level/totalScore/maxScore/averageScore/itemScores |
| Hook 集成 | PlanModeEnter/PlanApproved/PlanRejected/PlanItemExecute 事件 |

**新增斜杠命令**: `/plan execute`, `/plan risk`

#### 9.3.3 Agent-REPL 增强 (`agent-repl.js`)

| 增强 | 说明 |
|------|------|
| Hook 管道 | `executeTool()` 前后触发 PreToolUse/PostToolUse/ToolError |
| 多 Provider | 7 个 LLM 提供商 (ollama/anthropic/openai/deepseek/dashscope/mistral/gemini) |
| Anthropic 适配 | `_normalizeAnthropicResponse()` 转换 tool_use → tool_calls 格式 |
| 自主模式 | `/auto` 系列命令集成 CLIAutonomousAgent |
| Cowork 扩展 | `/cowork graph` (ASCII 知识图谱), `/cowork decision` (决策追踪) |

### 9.4 新增测试

| 测试文件 | 类型 | 测试数 |
|----------|------|--------|
| `cli-context-engineering.test.js` | unit | ~50 (含新增 14) |
| `permanent-memory.test.js` | unit | 22 |
| `autonomous-agent.test.js` | unit | 28 |
| `content-recommender.test.js` | unit | 19 |
| `evomap-client.test.js` | unit | 23 |
| `plan-mode.test.js` | unit | ~60 (含新增 20) |
| `phase102-commands.test.js` | e2e | 27 |
| **新增合计** | | **~153** |

### 9.5 依赖关系

```
Phase 1 (Context Engineering + Hook + Multi-Provider)
  ├──→ Phase 2 (Permanent Memory)
  │      └──→ Phase 5b (EvoMap)
  ├──→ Phase 3 (Autonomous Agent)
  │      └──→ Phase 4 (Advanced Plan Mode)
  ├──→ Phase 5a (Content Recommender)
  └──→ Phase 6 (补全部分实现)
```

### 9.6 核心文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/lib/permanent-memory.js` | 新建 | 跨会话持久记忆 |
| `src/lib/autonomous-agent.js` | 新建 | ReAct 自主任务循环 |
| `src/lib/content-recommender.js` | 新建 | TF-IDF 工具推荐 |
| `src/lib/evomap-client.js` | 新建 | EvoMap Hub HTTP 客户端 |
| `src/lib/evomap-manager.js` | 新建 | 本地 gene 管理 |
| `src/commands/evomap.js` | 新建 | evomap 命令入口 |
| `src/lib/cli-context-engineering.js` | 增强 | +Permanent Memory 注入 +可恢复压缩 +稳定前缀缓存 |
| `src/lib/plan-mode.js` | 增强 | +DAG 执行 +风险评分 +Hook 集成 |
| `src/repl/agent-repl.js` | 增强 | +Hook 管道 +7 Provider +/auto +/cowork graph+decision |

---

## 十、Phase 7-8 企业功能补齐

### 10.1 概述

在 Phase 102+ 基础上，进一步补齐 CLI 与桌面端的功能差距。新增 13 个库文件、11 个命令文件、
13 个测试文件（322 项新增测试），覆盖 EvoMap 联邦治理、DAO 治理 v2、安全合规、通信桥接、
基础设施加固和社交平台六大领域。CLI 命令总数从 48 → 59。

### 10.2 新增模块

| 阶段 | 领域 | 模块 | DB 表 |
|------|------|------|-------|
| Phase 7 | EvoMap 联邦 | evomap-federation, evomap-governance | evomap_hub_federation, gene_lineage, gene_ownership, evomap_governance_proposals |
| Phase 7 | DAO 治理 v2 | dao-governance | dao_v2_proposals, dao_v2_votes, dao_v2_treasury, dao_v2_delegations |
| Phase 8 | 安全合规 | compliance-manager, dlp-engine, siem-exporter, pqc-manager | compliance_evidence, compliance_reports, compliance_policies, dlp_incidents, dlp_policies, siem_exports, pqc_keys, pqc_migration_status |
| Phase 8 | 通信桥接 | nostr-bridge, matrix-bridge, scim-manager | nostr_relays, nostr_events, matrix_rooms, matrix_events, scim_resources, scim_sync_log |
| Phase 8 | 基础设施 | terraform-manager, hardening-manager | terraform_workspaces, terraform_runs, performance_baselines, hardening_audits |
| Phase 8 | 社交平台 | social-manager | social_contacts, social_friends, social_posts, social_messages |

### 10.3 新增命令

| 命令 | 子命令 | 描述 |
|------|--------|------|
| `dao` | propose, vote, delegate, execute, treasury, allocate, stats, configure | DAO 治理 v2 (二次方投票+委托+国库) |
| `compliance` | evidence, report, classify, scan, policies, check-access | 合规管理 (GDPR/SOC2/HIPAA/ISO27001) |
| `dlp` | scan, incidents, resolve, stats, policy | 数据防泄漏 (正则+关键词+策略) |
| `siem` | targets, add-target, export, stats | SIEM 日志导出 (Splunk/ES/Azure) |
| `pqc` | keys, generate, migration-status, migrate | 后量子密码 (ML-KEM/ML-DSA/混合模式) |
| `nostr` | relays, add-relay, publish, events, keygen, map-did | Nostr 桥接 (NIP-01/密钥生成/DID 映射) |
| `matrix` | login, rooms, send, messages, join | Matrix 桥接 (E2EE/房间管理) |
| `scim` | users, connectors, sync, status | SCIM 2.0 用户配置 |
| `terraform` | workspaces, create, plan, runs | 基础设施编排 (工作区/Plan/Apply) |
| `hardening` | baseline, audit | 安全加固 (性能基线+回归检测+审计) |
| `social` | contact, friend, post, chat, stats | 社交平台 (联系人/好友/动态/即时聊天) |

### 10.4 扩展命令

| 命令 | 新增子命令组 | 描述 |
|------|-------------|------|
| `evomap federation` | list-hubs, add-hub, sync, pressure, recombine, lineage | EvoMap 联邦 (Hub 管理/基因同步/压力分析) |
| `evomap gov` | ownership-register, ownership-trace, propose, vote, dashboard | EvoMap 治理 (基因IP/提案/投票/仪表板) |

### 10.5 测试覆盖

| 测试文件 | 测试数 | 覆盖模块 |
|----------|--------|----------|
| `evomap-federation.test.js` | 26 | EvoMap Federation |
| `evomap-governance.test.js` | 26 | EvoMap Governance |
| `dao-governance.test.js` | 33 | DAO Governance v2 |
| `compliance-manager.test.js` | 30 | Compliance Manager |
| `dlp-engine.test.js` | 25 | DLP Engine |
| `siem-exporter.test.js` | 16 | SIEM Exporter |
| `pqc-manager.test.js` | 19 | PQC Manager |
| `nostr-bridge.test.js` | 22 | Nostr Bridge |
| `matrix-bridge.test.js` | 22 | Matrix Bridge |
| `scim-manager.test.js` | 23 | SCIM Manager |
| `terraform-manager.test.js` | 18 | Terraform Manager |
| `hardening-manager.test.js` | 21 | Hardening Manager |
| `social-manager.test.js` | 41 | Social Manager |
| **合计** | **322** | |

### 10.6 核心文件

| 文件 | 类型 |
|------|------|
| `src/lib/evomap-federation.js` | 新建 |
| `src/lib/evomap-governance.js` | 新建 |
| `src/lib/dao-governance.js` | 新建 |
| `src/lib/compliance-manager.js` | 新建 |
| `src/lib/dlp-engine.js` | 新建 |
| `src/lib/siem-exporter.js` | 新建 |
| `src/lib/pqc-manager.js` | 新建 |
| `src/lib/nostr-bridge.js` | 新建 |
| `src/lib/matrix-bridge.js` | 新建 |
| `src/lib/scim-manager.js` | 新建 |
| `src/lib/terraform-manager.js` | 新建 |
| `src/lib/hardening-manager.js` | 新建 |
| `src/lib/social-manager.js` | 新建 |
| `src/commands/dao.js` | 新建 |
| `src/commands/compliance.js` | 新建 |
| `src/commands/dlp.js` | 新建 |
| `src/commands/siem.js` | 新建 |
| `src/commands/pqc.js` | 新建 |
| `src/commands/nostr.js` | 新建 |
| `src/commands/matrix.js` | 新建 |
| `src/commands/scim.js` | 新建 |
| `src/commands/terraform.js` | 新建 |
| `src/commands/hardening.js` | 新建 |
| `src/commands/social.js` | 新建 |
| `src/commands/evomap.js` | 扩展 |
| `src/index.js` | 扩展 |

---

> **最后更新**: 2026-03-12 (v5.0.1, Phase 102+ CLI高级功能补齐 + Context Engineering + CLI-Desktop 对齐 + Phase 7-8 企业功能补齐, 30模块/22命令/63表/2009测试)
