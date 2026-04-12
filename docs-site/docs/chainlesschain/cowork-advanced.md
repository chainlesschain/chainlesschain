# Cowork 高级功能

> **版本: v1.1.0-v2.1.0 | Instinct 学习 | Orchestrate 编排 | Verification Loop | 流水线引擎 | Git Hooks**

## 概述

Cowork 高级功能涵盖多智能体协作系统的进阶能力，包括 Instinct 学习系统（自动提取可复用模式）、Orchestrate 编排工作流（4 种多代理模板）、Verification Loop 验证流水线（6 阶段自动化验证）以及 Git Hooks 集成。配合技能懒加载和流水线引擎，实现复杂任务的高效自动化编排。

> 基础功能请参阅 [Cowork 核心文档](/chainlesschain/cowork) | 路线图请参阅 [Cowork 路线图](/chainlesschain/cowork-roadmap)

## 核心特性

- 🧠 **Instinct 学习系统**: 从用户会话中自动提取可复用模式，可信度驱动的上下文注入
- 🔀 **Orchestrate 编排工作流**: 4 种预置多代理工作流模板，结构化交接协议
- ✅ **Verification Loop 验证流水线**: 6 阶段自动化验证（Build→Test→Security→DiffReview）
- ⚡ **技能懒加载**: metadata-only 解析，启动时间从 ~360ms 降至 ~45ms（提升 87%）
- 🔗 **流水线引擎**: 5 种步骤类型（串联/并行/条件/循环/转换），10 个预置模板
- 🪝 **Git Hooks 集成**: Pre-commit 智能检查、影响范围分析、CI 失败自动修复

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                   Cowork Advanced Layer                  │
├──────────┬──────────────┬──────────────┬────────────────┤
│ Instinct │  Orchestrate │ Verification │  Git Hooks     │
│ Learning │  Workflow    │ Loop         │  Runner        │
│ System   │  (4 模板)    │ (6 阶段)     │  (4 事件)      │
├──────────┴──────┬───────┴──────────────┴────────────────┤
│  Skill Pipeline Engine (5 步骤类型, 10 模板)             │
├─────────────────┼───────────────────────────────────────┤
│  SkillRegistry  │  UnifiedToolRegistry  │ AgentPool     │
├─────────────────┴───────────────────────┴───────────────┤
│  SQLite (instincts, observations, metrics)              │
└─────────────────────────────────────────────────────────┘
```

## Instinct Learning System — v1.2.0

Instinct 学习系统自动从用户会话中提取可复用模式（"本能"），通过 Hooks 观察存入永久记忆，并在未来会话中注入相关 instinct 上下文。灵感源自 everything-claude-code 的 instinct learning 模式。

### 核心概念

```
用户会话行为
    │
    ▼
┌──────────────────┐
│ Hook 观察器       │ ── 监听: PostToolUse, PreCompact 等事件
│ (observationBuffer)│     缓冲区: 50 条上限，1 分钟定期刷新
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 观测数据库        │ ── instinct_observations 表
│ (SQLite)         │     字段: event_type, event_data, processed
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 模式进化引擎      │ ── 按事件类型分组，提取重复模式
│ (evolveInstincts) │     工具偏好、错误模式、工作流序列
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Instinct 缓存     │ ── 内存中 Map，DB 持久化
│ (instinctCache)   │     字段: pattern, confidence, category
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 上下文注入        │ ── ContextEngineering 自动注入到 LLM Prompt
│ (buildInstinctContext)│  置信度 ≥ 0.3 的 instinct 按相关度排序
└──────────────────┘
```

### Instinct 分类

| 分类            | 标识              | 说明               |
| --------------- | ----------------- | ------------------ |
| Coding Pattern  | `coding-pattern`  | 编码习惯和代码模式 |
| Tool Preference | `tool-preference` | 工具使用偏好       |
| Workflow        | `workflow`        | 工作流和工具序列   |
| Error Fix       | `error-fix`       | 错误修复模式       |
| Style           | `style`           | 代码风格偏好       |
| Architecture    | `architecture`    | 架构决策模式       |
| Testing         | `testing`         | 测试策略和模式     |
| General         | `general`         | 通用模式           |

### 置信度系统

```
置信度范围: [0.1, 0.95]    默认: 0.5

强化 (reinforce):
  newConfidence = min(0.95, current + 0.05 × (1 - current))
  使用次数 +1, 更新 lastUsed

衰减 (decay):
  newConfidence = max(0.1, current × 0.9)

检索过滤: 仅 confidence ≥ 0.3 的 instinct 参与上下文匹配
```

### 模式进化

`evolveInstincts()` 从未处理的观测中提取三类模式：

| 模式类型     | 提取条件            | 初始置信度         |
| ------------ | ------------------- | ------------------ |
| 工具使用频率 | 同一工具使用 ≥ 3 次 | 0.3 + count × 0.05 |
| 工具序列     | 连续 ≥ 3 个工具调用 | 0.35               |
| 重复错误     | 同类错误出现 ≥ 2 次 | 0.3 + count × 0.10 |

### 上下文注入

InstinctManager 通过 `ContextEngineering.setInstinctManager()` 注入，在 KV-Cache 优化 Prompt 构建时自动添加已学习模式：

```javascript
// ContextEngineering 第 4.5 步：注入 Instinct 上下文
const instinctContext = instinctManager.buildInstinctContext(contextHint, 5);
// 输出示例:
// ## Learned Patterns (Instincts)
// - [tool-preference] (confidence: 0.72) User frequently uses tool "file_reader"
// - [workflow] (confidence: 0.35) Common tool sequence: file_reader → code_analyzer → file_writer
```

### 数据库 Schema

```sql
CREATE TABLE instincts (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  category TEXT DEFAULT 'general',
  examples TEXT DEFAULT '[]',
  source TEXT DEFAULT 'auto',       -- auto | manual | import
  use_count INTEGER DEFAULT 0,
  last_used TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE instinct_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,          -- PostToolUse, IPCError, SessionEnd 等
  event_data TEXT DEFAULT '{}',
  processed INTEGER DEFAULT 0,
  created_at TEXT
);
```

### 关键文件

| 文件                                  | 行数   | 职责                      |
| ------------------------------------- | ------ | ------------------------- |
| `src/main/llm/instinct-manager.js`    | ~1,100 | Instinct 管理核心         |
| `src/main/llm/instinct-ipc.js`        | ~280   | 11 个 IPC Handler         |
| `src/main/llm/context-engineering.js` | +35    | Instinct 上下文注入集成   |
| `src/main/database.js`                | +30    | instincts/observations 表 |
| `src/main/ipc/ipc-registry.js`        | +44    | Phase 17 注册             |

## Orchestrate Workflow — v1.2.0

多代理工作流编排技能，提供 4 种预置工作流模板，每个模板包含有序的代理链和结构化交接协议。灵感源自 everything-claude-code 的 orchestrate 模式。

### 工作流模板

| 模板             | 代理链                                                       | 用途         |
| ---------------- | ------------------------------------------------------------ | ------------ |
| `feature`        | planner → architect → coder → reviewer → verification        | 新功能开发   |
| `bugfix`         | debugger → coder → tester → verification                     | Bug 诊断修复 |
| `refactor`       | architect → coder → reviewer → verification                  | 代码重构     |
| `security-audit` | security-reviewer → coder → security-verifier → verification | 安全审计修复 |

### 使用方式

```bash
/orchestrate feature "add user profile page"
/orchestrate bugfix "login fails with special characters"
/orchestrate refactor "extract auth module"
/orchestrate security-audit "review API endpoints"
```

### 代理交接协议

每个代理完成后生成结构化交接文档，传递给下一个代理：

```json
{
  "agent": "planner",
  "agentType": "document",
  "status": "complete",
  "deliverables": ["requirements.md", "acceptance-criteria.md"],
  "decisions": ["Use Vue 3 composables", "Add Pinia store"],
  "concerns": ["Performance impact on large datasets"],
  "nextAgentInstructions": "Implement based on requirements..."
}
```

### 执行模式

```
1. AgentCoordinator 可用 → 通过 coordinator.orchestrate() 真实代理执行
2. AgentCoordinator 不可用 → 结构化模拟输出（标注代理角色和预期行为）
3. 最终阶段 → 自动调用 verification-loop handler 执行验证
```

### 裁决等级

| 裁决           | 条件                           |
| -------------- | ------------------------------ |
| **SHIP**       | 所有代理成功且验证通过         |
| **NEEDS WORK** | 代理标记了 concerns 或验证失败 |
| **BLOCKED**    | 非验证阶段发生关键失败         |

### 关键文件

| 文件                                                              | 行数 | 职责         |
| ----------------------------------------------------------------- | ---- | ------------ |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/SKILL.md`   | ~112 | 技能定义     |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/handler.js` | ~507 | 编排引擎实现 |

## Verification Loop — v1.2.0

6 阶段自动化验证流水线，产出 READY / NOT READY 裁决。自动检测项目类型（Node.js / TypeScript / Python / Java）并适配对应的构建、检查、测试命令。

### 验证阶段

| 阶段       | 功能                     | 工具 / 命令                                  |
| ---------- | ------------------------ | -------------------------------------------- |
| Build      | 编译 / 打包项目          | `npm run build` / `mvn compile`              |
| TypeCheck  | 静态类型检查             | `tsc --noEmit` / `mypy`                      |
| Lint       | 代码风格检查             | `eslint` / `flake8`                          |
| Test       | 执行测试套件             | `vitest` / `jest` / `pytest`                 |
| Security   | 安全扫描                 | 委托 `security-audit` handler                |
| DiffReview | AI 审查未提交的 git diff | 检测 console.log、debugger、TODO、硬编码凭据 |

### 使用方式

```bash
/verification-loop                           # 全部 6 阶段
/verification-loop src/ --skip typecheck     # 跳过类型检查
/verification-loop --stages build,test,security  # 仅指定阶段
/verification-loop --verbose                 # 显示详细输出
```

### 项目类型检测

```
package.json 存在？
  ├── 是 → tsconfig.json 或 typescript 依赖？
  │       ├── 是 → TypeScript
  │       └── 否 → Node.js
  ├── pom.xml / build.gradle？
  │       └── 是 → Java
  └── pyproject.toml / setup.py / requirements.txt？
          └── 是 → Python
```

### DiffReview 检测规则

| 检测项          | 正则 / 逻辑                                              |
| --------------- | -------------------------------------------------------- |
| console.log     | `/console\.log\s*\(/`                                    |
| debugger 语句   | `/debugger\b/`                                           |
| TODO/FIXME 注释 | `/TODO\|FIXME\|HACK\|XXX/`                               |
| 硬编码凭据      | `/(?:password\|secret\|token)\s*[:=]\s*['"][^'"]+['"]/i` |

### 输出示例

```
Verification Loop Report
========================
Project: desktop-app-vue (typescript)

| Stage      | Status | Duration | Details          |
| ---------- | ------ | -------- | ---------------- |
| build      | PASS   | 12.3s    | Clean build      |
| typecheck  | PASS   | 4.1s     | 0 type errors    |
| lint       | PASS   | 2.8s     | 0 lint issues    |
| test       | PASS   | 8.5s     | 157 tests passed |
| security   | PASS   | 1.2s     | 0 findings       |
| diffreview | PASS   | 0.3s     | 5 file(s) changed, no issues |

Stages: 6 passed, 0 failed, 0 skipped (6 active)
Duration: 29.2s

Verdict: READY
```

### 关键文件

| 文件                                                                    | 行数 | 职责         |
| ----------------------------------------------------------------------- | ---- | ------------ |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/SKILL.md`   | ~118 | 技能定义     |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | ~547 | 验证引擎实现 |

## v1.1.0 新增功能

### 技能懒加载（启动提升 87%）

v1.1.0 引入 metadata-only 解析策略，90 技能启动时间从 ~360ms 降至 ~45ms：

```
启动加载流程:
  parseMetadataOnly() ── 只读 YAML frontmatter，跳过 Markdown body
       ↓
  创建 SkillDefinitionStub (_isStub: true, _bodyLoaded: false)
       ↓
  注册到 SkillRegistry（轻量元数据）
       ↓
  首次使用时 ensureFullyLoaded() 完整解析 body + handler
```

**热加载/热卸载**: 支持运行时动态注册和移除技能

```javascript
// 热加载新技能
await skillRegistry.hotLoadSkill("my-skill", definition);
// 事件: skill-hot-loaded

// 热卸载技能
await skillRegistry.hotUnloadSkill("my-skill");
// 事件: skill-hot-unloaded
```

**Marketplace 自动热加载**: 安装插件时，如果包含 `SKILL.md`，自动调用 `loadSingleSkill()` + `hotLoadSkill()` 注册到 SkillRegistry 并刷新 UnifiedToolRegistry。

### 技能流水线引擎（Skill Pipeline Engine）

流水线引擎支持多技能编排，提供 5 种步骤类型和变量传递机制：

#### 步骤类型

| 类型        | 说明                                          |
| ----------- | --------------------------------------------- |
| `SKILL`     | 执行单个技能，输入映射 → 输出变量             |
| `CONDITION` | 基于表达式分支（true/false 输出口）           |
| `PARALLEL`  | 并行执行多个技能，`Promise.allSettled()` 合并 |
| `TRANSFORM` | JavaScript 表达式进行数据转换                 |
| `LOOP`      | 遍历数组输出，逐项执行子步骤                  |

#### Pipeline 执行模式

```
串联模式 (Serial):
┌──────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│web-scrap │──→│data-analysis │──→│chart-creator │──→│doc-generator │
│  ing     │   │              │   │              │   │              │
└──────────┘   └──────────────┘   └──────────────┘   └──────────────┘
     ↓              ↓                   ↓                   ↓
  原始HTML      结构化数据          图表PNG/SVG          PDF报告

并行模式 (Parallel):
┌──────────────┐
│code-review   │──→ 代码质量报告
├──────────────┤
│security-audit│──→ 安全漏洞报告    ──→ 合并结果
├──────────────┤
│test-generator│──→ 测试用例
└──────────────┘

条件分支 (Condition):
┌──────────┐   ┌──────────────┐   ┌──────true──→ 发布
│ 代码审查  │──→│ 测试通过?     │──→│
└──────────┘   └──────────────┘   └──────false──→ 修复
```

#### 变量传递

步骤间通过 `${stepName.result.field}` 模板引用传递数据：

```javascript
const pipeline = engine.createPipeline({
  name: "data-report",
  steps: [
    {
      id: "fetch",
      type: "SKILL",
      skillId: "web-scraping",
      outputVariable: "fetch",
    },
    {
      id: "analyze",
      type: "SKILL",
      skillId: "data-analysis",
      inputMapping: { data: "${fetch.result.content}" },
      outputVariable: "analyze",
    },
    {
      id: "check",
      type: "CONDITION",
      expression: "${analyze.result.count} >= 10",
      trueBranch: "report",
      falseBranch: null,
    },
    {
      id: "report",
      type: "SKILL",
      skillId: "doc-generator",
      inputMapping: { summary: "${analyze.result.summary}" },
    },
  ],
});

const result = await engine.executePipeline(pipeline.id, {
  url: "https://...",
});
```

#### 执行控制

```javascript
// 暂停
await engine.pausePipeline(executionId);
// 恢复
await engine.resumePipeline(executionId);
// 取消
await engine.cancelPipeline(executionId);
// 查询状态
const status = engine.getPipelineStatus(executionId);
// { state: 'RUNNING', currentStep: 2, totalSteps: 4, startedAt: ..., results: [...] }
```

#### 事件

| 事件                      | 触发时机   |
| ------------------------- | ---------- |
| `pipeline:created`        | 流水线创建 |
| `pipeline:started`        | 开始执行   |
| `pipeline:step-started`   | 步骤开始   |
| `pipeline:step-completed` | 步骤完成   |
| `pipeline:step-failed`    | 步骤失败   |
| `pipeline:completed`      | 流水线完成 |
| `pipeline:failed`         | 流水线失败 |
| `pipeline:paused`         | 流水线暂停 |

### 10 预置流水线模板

| #   | 模板名           | 技能串联                                                                 | 分类        |
| --- | ---------------- | ------------------------------------------------------------------------ | ----------- |
| 1   | data-report      | web-scraping → data-analysis → chart-creator → doc-generator             | data        |
| 2   | code-review      | code-review → security-audit → lint-and-fix → doc-generator              | development |
| 3   | release          | test-generator → test-and-fix → changelog-generator → release-manager    | development |
| 4   | research         | web-scraping → data-analysis → knowledge-graph → doc-generator           | knowledge   |
| 5   | onboarding       | repo-map → dependency-analyzer → onboard-project → doc-generator         | development |
| 6   | security-audit   | security-audit → vulnerability-scanner → impact-analyzer → doc-generator | security    |
| 7   | i18n             | i18n-manager → code-translator → doc-generator                           | development |
| 8   | media-processing | audio-transcriber → subtitle-generator → doc-converter                   | media       |
| 9   | performance      | performance-optimizer → log-analyzer → chart-creator                     | devops      |
| 10  | data-migration   | db-migration → data-exporter → backup-manager                            | devops      |

```javascript
// 获取所有模板
const templates = getTemplates();
// 按分类筛选
const devTemplates = getTemplatesByCategory("development"); // 4 个
// 从模板创建流水线
const pipeline = engine.createPipeline(getTemplateById("tpl-code-review"));
```

### 技能指标采集器（Skill Metrics Collector）

实时采集技能和流水线执行指标，支持仪表板可视化：

```javascript
// 查询单技能指标
const metrics = collector.getSkillMetrics("code-review");
// { executions: 42, successRate: 0.95, avgDuration: 2300, totalTokens: 15000, totalCost: 0.45 }

// Top 技能排行
const top = collector.getTopSkills(5, "executions");
// [{ skillId: 'code-review', executions: 42, ... }, ...]

// 时间序列（图表数据）
const series = collector.getTimeSeriesData("code-review", "day");
// [{ timestamp: ..., executions: 5, avgDuration: 2100, successRate: 1.0 }, ...]

// 导出全量指标
const exported = collector.exportMetrics();
```

**存储**: 内存 Map + 定期刷入 SQLite（`skill_execution_metrics` 表），60 秒刷新间隔。

### Git Hooks 集成

GitHookRunner 将技能流水线与 Git 工作流打通：

#### Pre-commit 智能检查

```javascript
const result = await runner.runPreCommit([
  "src/main/index.js",
  "src/utils/helper.js",
]);
// {
//   passed: true,
//   duration: 45000,
//   steps: [
//     { skill: 'lint-and-fix', issues: [...], fixes: [...] },
//     { skill: 'code-review', issues: [...] },
//     { skill: 'security-audit', issues: [...] },
//   ],
//   issues: [...],      // 所有问题汇总
//   autoFixes: [...],   // 自动修复列表
//   blocking: false,    // 是否阻止提交
// }
```

#### 影响范围分析

```javascript
const impact = await runner.runImpactAnalysis(["src/main/database.js"]);
// {
//   affectedFiles: ['src/main/index.js', 'tests/db.test.js', ...],
//   suggestedTests: ['tests/db.test.js', 'tests/integration/...'],
//   riskScore: 7.5,
//   duration: 12000,
// }
```

#### CI 失败自动修复

```javascript
const fix = await runner.runAutoFix([
  "test-login-flow",
  "test-auth-middleware",
]);
// {
//   fixed: ['test-login-flow'],
//   remaining: ['test-auth-middleware'],
//   patchFiles: ['patches/fix-login.patch'],
//   duration: 30000,
// }
```

#### Git Hooks 工作流

```
git commit
    │
    ▼
┌──────────────────┐
│ Pre-commit Hook   │
│                   │
│  ┌─────────────┐ │
│  │ lint-and-fix │ │ ── 自动修复 ESLint/Prettier
│  └──────┬──────┘ │
│         ▼        │
│  ┌─────────────┐ │
│  │ code-review  │ │ ── AI 快速审查关键问题
│  └──────┬──────┘ │
│         ▼        │
│  ┌──────────────┐│
│  │security-audit││ ── 敏感信息/漏洞扫描
│  └──────────────┘│
└──────────────────┘
    │
    ▼
  提交成功 (30-60秒, 原 2-5 分钟)
```

**Hook 事件**: 新增 `PreGitCommit`、`PostGitCommit`、`PreGitPush`、`CIFailure` 4 个事件到 HookRegistry。

### 可视化工作流编辑器

基于 Vue Flow 的拖拽式工作流设计器，支持 8 种节点类型：

#### 节点类型

| 节点类型         | 说明             | 对应 Pipeline 步骤 |
| ---------------- | ---------------- | ------------------ |
| `START_NODE`     | 流程起始         | —                  |
| `END_NODE`       | 流程结束         | —                  |
| `SKILL_NODE`     | 技能执行节点     | SKILL              |
| `CONDITION_NODE` | 条件分支（菱形） | CONDITION          |
| `PARALLEL_NODE`  | 并行 Fork/Join   | PARALLEL           |
| `LOOP_NODE`      | 循环迭代         | LOOP               |
| `TRANSFORM_NODE` | 数据转换         | TRANSFORM          |
| `MERGE_NODE`     | 结果合并         | —                  |

#### Pipeline 互转

```javascript
// Pipeline → Workflow（自动生成节点位置）
const workflow = engine.importFromPipeline(pipelineId);

// Workflow → Pipeline（拓扑排序生成步骤顺序）
const pipeline = engine.exportToPipeline(workflowId);
```

#### 工作流执行

```javascript
// 委托 SkillPipelineEngine 执行
const result = await engine.executeWorkflow(workflowId, { input: "data" });
```

**前端页面**: `#/cowork/workflow` — WorkflowDesignerPage.vue，三栏布局（技能面板 + 画布 + 属性面板 + 调试面板）

### UnifiedToolRegistry 增强（v1.1.0）

- **事件驱动刷新**: 监听 SkillRegistry 的 `skill-registered`、`skill-unregistered`、`skill-hot-loaded`、`skill-hot-unloaded` 事件，自动刷新工具列表
- **统一执行 API**: `executeToolByName(toolName, params, context)` — 路由到 FunctionCaller/MCP/SkillRegistry
- **执行器查询**: `getToolExecutor(toolName)` — 返回绑定执行器函数
- **新增 2 IPC**: `tools:execute-by-name`、`tools:get-executors`（总计 8 handlers）

### Agent 池化增强（v1.1.0）

- **能力池化**: `_pools: Map<agentType, Agent[]>` 按类型分池，`acquireByCapabilities(capabilities)` 匹配
- **温复用**: `_warmResetAgent(agent)` 重置状态保留连接（冷启动 ~2s → ~200ms）
- **内存感知**: 监控 `process.memoryUsage().heapUsed`，超阈值自动缩池
- **健康检查**: 60s 周期探活，自动移除无响应 agent

```javascript
const stats = agentPool.getPoolStats();
// {
//   pools: { 'CodeSecurity': { total: 3, available: 2, busy: 1 }, ... },
//   memory: { heapUsed: 150MB, heapTotal: 256MB, heapRatio: 0.59, rss: 320MB },
// }
```

### 增量检查点（v1.1.0）

任务 > 5 分钟默认启用增量模式，全量 ~50-100KB/次 → 增量 ~2-10KB/次（节省 60-80%）：

```javascript
const checkpoint = new IncrementalCheckpoint();

// 创建基线（全量快照）
checkpoint.createBaseline(state);

// 创建增量（只保存 JSON diff）
checkpoint.createDelta(currentState);
// { type: 'delta', size: 1234, changes: 5 }

// 恢复（基线 + 累加 delta）
const restored = checkpoint.restore(checkpointId);

// 压缩（合并旧 delta 为新基线）
checkpoint.compact(currentState);
```

---

## 使用示例

### 辩论式代码审查

```bash
# 多角色代理辩论审查代码质量
chainlesschain cowork debate src/main/index.js
# 输出包含安全审查员、性能审查员、可读性审查员的多角度意见和最终裁决
```

### 代码知识图谱分析

```bash
# 生成项目代码架构的知识图谱
chainlesschain cowork analyze src/ --type knowledge-graph
# 输出实体(模块/类/函数)和关系(调用/依赖/继承)的结构化图谱
```

### 决策知识库查询

```bash
# 分析项目中的架构决策记录
chainlesschain cowork analyze src/ --type decisions
# 输出已识别的架构决策、上下文、后果和替代方案
```

## 故障排除

### Agent 执行超时

**现象**: Orchestrate 工作流中某个代理步骤长时间无响应。

**排查步骤**:
1. 检查 LLM 服务是否可用，Agent 执行依赖 LLM 生成响应
2. 确认 AgentCoordinator 是否已正确初始化（不可用时回退为模拟模式）
3. 查看 Agent Pool 状态（`agentPool.getPoolStats()`），确认目标类型池有空闲 Agent
4. 降低任务复杂度或拆分为更小的子任务以减少单个 Agent 处理时间

### 多 Agent 结果不一致

**现象**: 多个代理对同一任务给出矛盾的分析结果。

**排查步骤**:
1. 这是多 Agent 辩论模式的正常现象，最终裁决会综合各方意见
2. 检查各 Agent 的角色配置是否正确，避免角色重叠导致冗余评估
3. 查看 Orchestrate 工作流的交接文档（handoff），确认上下文正确传递
4. 若需一致性结果，使用 `verification-loop` 替代辩论模式

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 多 Agent 辩论超时未产出结论 | 参与 Agent 数量过多或共识阈值过高 | 减少参与者数量，降低 `consensusThreshold` |
| 知识图谱构建缓慢 | 实体数量大或关系抽取模型负载高 | 启用增量构建，分批处理实体 |
| 决策冲突多个 Agent 结论矛盾 | 角色分配不明确或评价标准不统一 | 明确角色 prompt，设置统一评分标准 |
| 辩论轮次过多收敛慢 | 初始立场差异过大或调停策略不佳 | 限制最大轮次 `maxRounds`，启用调停 Agent |
| A/B 对比结果不可复现 | 随机种子未固定或上下文差异 | 设置 `seed` 参数，确保输入上下文一致 |

### 常见错误修复

**错误: `DEBATE_TIMEOUT` 辩论超时**

```bash
# 查看辩论状态
chainlesschain cowork debate-status --session-id <id>

# 强制结束辩论并汇总当前结果
chainlesschain cowork debate-conclude --session-id <id> --force
```

**错误: `KG_BUILD_SLOW` 知识图谱构建过慢**

```bash
# 切换为增量构建模式
chainlesschain cowork analyze <path> --mode incremental

# 限制单次处理文件数量
chainlesschain cowork analyze <path> --batch-size 50
```

**错误: `DECISION_CONFLICT` Agent 决策冲突**

```bash
# 查看冲突详情
chainlesschain cowork conflict-detail --session-id <id>

# 启用调停 Agent 重新裁定
chainlesschain cowork mediate --session-id <id>
```

## 安全考虑

### 多 Agent 数据隔离

- **Agent 沙箱**: 每个 Agent 在独立的上下文中执行，无法直接访问其他 Agent 的内部状态
- **交接文档审查**: Agent 间传递的交接文档不应包含敏感凭证，仅传递任务相关上下文
- **Agent Pool 内存**: Agent 温复用时通过 `_warmResetAgent()` 重置状态，防止跨任务信息泄露
- **工具权限**: 每个 Agent 仅能使用其角色授权的工具子集，通过 UnifiedToolRegistry 控制
- **执行日志**: 所有 Agent 操作记录到 Cowork 审计事件中，支持事后审查

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/llm/instinct-manager.js` | Instinct 学习系统核心（~1,100 行） |
| `desktop-app-vue/src/main/llm/instinct-ipc.js` | Instinct 11 个 IPC Handler |
| `desktop-app-vue/src/main/llm/context-engineering.js` | Instinct 上下文注入集成 |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/orchestrate/handler.js` | Orchestrate 编排引擎（~507 行） |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | 验证流水线引擎（~547 行） |
| `desktop-app-vue/src/main/ai-engine/cowork/skill-pipeline-engine.js` | 流水线引擎（5 步骤类型） |
| `desktop-app-vue/src/main/ai-engine/cowork/skill-metrics-collector.js` | 技能指标采集器 |
| `desktop-app-vue/src/main/ai-engine/cowork/git-hook-runner.js` | Git Hooks 集成 |
| `desktop-app-vue/src/main/ai-engine/cowork/workflow-designer-engine.js` | 可视化工作流引擎 |

## 相关文档

- [Cowork 核心文档](/chainlesschain/cowork) — TeammateTool、Agent Pool、FileSandbox、Skills 系统
- [Cowork 路线图](/chainlesschain/cowork-roadmap) — v3.0-v4.0 未来规划
- [Skills 技能系统](/chainlesschain/skills)
- [Hooks 系统](/chainlesschain/hooks)
- [Context Engineering](/chainlesschain/context-engineering)
