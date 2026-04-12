# 85. Hermes Agent 对标实施方案 (Agent Parity Roadmap v2.0)

> **状态**: ✅ 全部完成（Phase 1–6 全部落地，253 tests 全绿）
> **日期**: 2026-04-12
> **作用范围**: `packages/cli`
> **对标对象**: [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Nous Research
> **关联文档**: [84. 自主学习闭环系统](./84_自主学习闭环系统.md) · [16. AI技能系统](./16_AI技能系统.md) · [78. CLI Agent Runtime](./78_CLI_Agent_Runtime重构实施计划.md) · [82. CLI Runtime 收口路线图](./82_CLI_Runtime收口路线图.md)

---

## 1. 概述

### 1.1 背景

Hermes Agent 是 Nous Research 于 2026 年 2 月发布的自改进型个人 AI Agent 框架，核心理念为 "Agent That Grows With You"。通过对 ChainlessChain CLI Agent 系统与 Hermes Agent 的系统性对比，识别出 6 个关键差距维度，按影响力优先级形成分阶段实施方案。

本轮 v2.0 全部 6 个 Phase 已完成落地。

### 1.2 对标分析总览

| 维度 | Hermes Agent | ChainlessChain 实施前 | ChainlessChain 实施后 | 差距等级 |
|------|-------------|---------------------|---------------------|---------|
| 迭代预算 | 90 次共享预算，渐进警告 | MAX_ITERATIONS=15 硬编码 | ✅ 50 次共享预算 + 渐进警告 (38 tests) | **已消除** |
| 跨会话搜索 | FTS5 全文检索所有历史会话 | 会话已存储但不可搜索 | ✅ FTS5 + /search + search_sessions 工具 (32 tests) | **已消除** |
| 用户画像 | USER.md (AI 策展) | 无用户画像文件 | ✅ USER.md + /profile + 上下文注入 (27 tests) | **已消除** |
| 冻结提示词 | 会话启动时快照，不可变 | 每轮重新构建 | ✅ buildSystemPrompt 一次性调用 | **已消除** |
| 插件加载 | 文件投放自动加载 | 需要 DB 注册 | ✅ plugins/*.js 自动扫描加载 (30 tests) | **已消除** |
| 执行后端 | Local/Docker/SSH/Daytona/Modal | 仅 Local | ✅ Local/Docker/SSH 三后端 (42 tests) | **已消除** |
| 消息网关 | Telegram/Discord/Slack/WhatsApp/Signal/Email | CLI + WS + Web UI | ✅ GatewayBase + Telegram/Discord (37 tests) | **大幅缩小** |
| 技能自动生成 | 复杂任务后自动提取 | ✅ 已实现（学习闭环） | ✅ 已实现 | **无差距** |
| 记忆系统 | 3 层 | ✅ 4 层层次记忆 + MEMORY.md | ✅ 已实现 | **无差距** |
| 对话压缩 | /compress | ✅ /compact + PromptCompressor | ✅ 已实现 | **无差距** |

### 1.3 已有优势（无需对标）

- **学习闭环**: 轨迹记录 → 结果反馈 → 技能合成 → 技能改进 → 周期反思（完整 P0-P3，224 tests）
- **4 层记忆**: working → short-term → long-term → core，Ebbinghaus 遗忘曲线
- **技能体系**: 138 内置技能，4 层优先级加载，SKILL.md + Agent Skills 标准
- **多代理**: sub-agent 隔离、worktree 隔离、自主 agent 目标分解
- **30+ 生命周期钩子**: PreToolUse/PostToolUse/SessionStart 等完整事件体系

### 1.4 系统架构

```
┌───────────────────────────────────────────────────────────┐
│                    Agent REPL (入口)                        │
│  /search  /profile  /plan  /compact  /auto  /cowork       │
├───────────────┬───────────────┬───────────────────────────┤
│ IterationBudget│ UserProfile   │ Plugin AutoDiscovery      │
│ (共享预算)     │ (USER.md)     │ (文件投放自动加载)         │
├───────────────┼───────────────┼───────────────────────────┤
│            Agent Core (agentLoop)                          │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐                 │
│  │run_shell│ │run_code  │ │search_sess.│                  │
│  └────┬────┘ └────┬─────┘ └────┬───────┘                 │
│       │           │            │                           │
│  ┌────▼────────────▼────┐ ┌────▼──────────┐              │
│  │  ExecutionBackend    │ │SessionSearch  │               │
│  │  Local/Docker/SSH    │ │  FTS5 Index   │               │
│  └──────────────────────┘ └───────────────┘               │
├───────────────────────────────────────────────────────────┤
│              CLIContextEngineering                         │
│  [SystemPrompt] [Instinct] [UserProfile] [Memory] [Notes] │
├───────────────────────────────────────────────────────────┤
│              Gateways (消息网关)                            │
│  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐     │
│  │  REPL  │ │ WebSocket│ │ Telegram │ │  Discord  │     │
│  └────────┘ └──────────┘ └──────────┘ └───────────┘     │
└───────────────────────────────────────────────────────────┘
```

## 2. 实施方案

### Phase 1: 迭代预算系统 (Iteration Budget) ✅

**影响**: HIGH | **工作量**: LOW | **测试**: 38 pass

#### 2.1.1 问题

`agent-core.js:1586` 硬编码 `MAX_ITERATIONS = 15`，复杂 agentic 任务频繁超过 15 次工具调用被截断。子代理使用独立的 `DEFAULT_MAX_ITERATIONS = 8`，无法与父代理共享预算。

#### 2.1.2 方案

引入 `IterationBudget` 类作为共享引用，父代理创建后传递给子代理消费同一池：

```javascript
// 创建（REPL 或 caller 层）
const budget = new IterationBudget({ limit: 50, owner: sessionId });

// 传入 agentLoop
for await (const event of agentLoop(messages, { iterationBudget: budget })) { ... }

// 子代理接收同一实例
SubAgentContext.create({ iterationBudget: budget }); // 共享消费
```

**配置优先级**: `CC_ITERATION_BUDGET` 环境变量 > 默认值 50

**渐进警告**:
- 70% → `iteration-warning` 事件 + 工具结果追加警告文本
- 90% → `iteration-wrapping-up` 事件
- 100% → `iteration-budget-exhausted` 事件 + 强制停止并返回工作摘要

#### 2.1.3 核心特性

| 特性 | 说明 |
|------|------|
| 共享预算 | 父子代理消费同一 IterationBudget 实例 |
| 渐进警告 | 70%/90%/100% 三级警告，LLM 可见 |
| 环境变量配置 | `CC_ITERATION_BUDGET=90` 覆盖默认值 |
| 警告去重 | `recordWarning()` + `hasWarned()` 防止重复提醒 |
| 钩子事件 | `IterationWarning` / `IterationBudgetExhausted` |
| 向后兼容 | 不传 budget → 自动创建默认 50 |

#### 2.1.4 实现文件

| 操作 | 文件 | 变更 |
|------|------|------|
| 新建 | `src/lib/iteration-budget.js` (176L) | `IterationBudget` 类全实现 |
| 修改 | `src/runtime/agent-core.js` | `while (budget.hasRemaining())` 替代 `for (i < 15)` |
| 修改 | `src/lib/sub-agent-context.js` | 接受并传递 `iterationBudget` |
| 修改 | `src/lib/autonomous-agent.js` | initialize 接受 `iterationBudget` |
| 修改 | `src/repl/agent-repl.js` | 每次用户输入创建新 budget |
| 修改 | `src/lib/hook-manager.js` | 新增 2 个钩子事件 |

#### 2.1.5 使用示例

```bash
# 默认 50 次迭代
chainlesschain agent

# 环境变量覆盖为 90 次
CC_ITERATION_BUDGET=90 chainlesschain agent

# Agent 在 70% 时收到警告:
#   [Budget Warning] 15 iterations remaining out of 50. Start wrapping up your work.
# Agent 在 100% 时自动停止并返回工作摘要
```

---

### Phase 2: 跨会话 FTS 搜索 (Cross-Session Search) ✅

**影响**: HIGH | **工作量**: MEDIUM | **测试**: 32 pass

#### 2.2.1 问题

会话数据已存储（DB + JSONL），但用户无法搜索历史对话。

#### 2.2.2 方案

- SQLite FTS5 虚拟表 `session_fts`，索引消息内容
- `SessionEnd` 钩子触发索引
- `/search <query>` REPL 斜杠命令
- `search_sessions` Agent 工具（LLM 可主动搜索上下文）
- FTS5 `highlight()` 提取匹配片段，`>>>...<<<` 标记

#### 2.2.3 核心特性

| 特性 | 说明 |
|------|------|
| FTS5 全文索引 | `session_fts` 虚拟表，unicode61 分词 |
| REPL 搜索 | `/search <query>` 实时搜索历史对话 |
| Agent 工具 | `search_sessions` 工具，LLM 主动搜索 |
| 高亮片段 | `highlight()` 函数生成 `>>>match<<<` 片段 |
| 幂等索引 | 同一会话重复索引不会产生重复 |
| FTS 语法容错 | 特殊字符自动降级为引号短语查询 |
| 空 DB 优雅降级 | db=null 时所有方法返回空结果 |

#### 2.2.4 实现文件

| 操作 | 文件 | 变更 |
|------|------|------|
| 新建 | `src/lib/session-search.js` (192L) | `SessionSearchIndex` 全实现 |
| 修改 | `src/repl/agent-repl.js` | `/search` 命令 |
| 修改 | `src/runtime/agent-core.js` | `search_sessions` 工具处理器 |
| 修改 | `coding-agent-contract-shared.cjs` | 工具契约（只读，tier=extension） |
| 修改 | `coding-agent-policy.cjs` | LOW risk，SEARCH 类别 |

#### 2.2.5 使用示例

```bash
# REPL 中搜索
> /search authentication JWT
# 输出：
#   sess-abc123def456 [user] How do I implement >>>JWT<<< >>>authentication<<<...
#   sess-xyz789abc012 [assistant] Use JWT tokens for >>>authentication<<<...

# LLM 通过 search_sessions 工具主动搜索:
# Tool call: search_sessions({ query: "database migration", limit: 5 })
```

---

### Phase 3: USER.md + 冻结提示词 (User Profile + Frozen Prompt) ✅

**影响**: MEDIUM | **工作量**: LOW | **测试**: 27 pass

#### 2.3.1 问题

- 无持久化用户画像文件
- 用户偏好散落在 instinct 模式中，不可直接编辑

#### 2.3.2 方案

**USER.md**: `~/.chainlesschain/USER.md`，2000 字符上限，LLM 自动整理

**冻结提示词**: `buildSystemPrompt()` 在会话启动时一次性调用（`agent-repl.js:197`），整个会话使用该快照

**上下文注入**: `cli-context-engineering.js` 在 instinct 和 memory 之间注入 USER.md

```
[System Prompt] → [Instinct] → [User Profile] → [Memory] → [Notes]
```

#### 2.3.3 核心特性

| 特性 | 说明 |
|------|------|
| 全局持久化 | `~/.chainlesschain/USER.md` |
| 2000 字符上限 | 超限时 LLM 自动整理合并 |
| REPL 管理 | `/profile show/set/clear/path` |
| 上下文自动注入 | 出现在 instinct 和 memory 之间 |
| `_deps` 可测试 | readFileSync/writeFileSync 通过 `_deps` 注入 |
| 优雅降级 | 文件不存在时静默跳过 |

#### 2.3.4 实现文件

| 操作 | 文件 | 变更 |
|------|------|------|
| 新建 | `src/lib/user-profile.js` (173L) | 完整 CRUD + LLM consolidation |
| 修改 | `src/lib/cli-context-engineering.js` | Section 2b: User Profile 注入 |
| 修改 | `src/repl/agent-repl.js` | `/profile` 命令 + help 更新 |

#### 2.3.5 使用示例

```bash
# 查看用户画像
> /profile
# User Profile (USER.md):
# I prefer functional programming with TypeScript.
# ...
# Path: ~/.chainlesschain/USER.md

# 设置用户画像
> /profile set I prefer TypeScript, clean code, and minimal dependencies.
# Profile updated (62 chars)

# 清除用户画像
> /profile clear
# Profile cleared.
```

---

### Phase 4: 零摩擦插件自动加载 (Zero-Friction Plugins) ✅

**影响**: MEDIUM | **工作量**: MEDIUM | **测试**: 30 pass

#### 2.4.1 问题

现有插件系统需要 DB 注册。Hermes 用户只需将文件放入目录即可自动加载。

#### 2.4.2 方案

启动时扫描 `~/.chainlesschain/plugins/*.js`，自动验证导出格式并注入。

插件导出格式:

```javascript
// ~/.chainlesschain/plugins/my-plugin.js
export default {
  name: "my-plugin",
  version: "1.0.0",
  description: "My custom plugin",
  
  // 工具定义 (OpenAI function-calling 格式)
  tools: [{
    type: "function",
    function: { name: "my_tool", description: "...", parameters: {...} }
  }],
  
  // 钩子 (按事件名映射)
  hooks: {
    PostToolUse: async (ctx) => { /* ... */ }
  },
  
  // REPL 斜杠命令
  commands: {
    greet: { handler: (args) => console.log("Hello!"), description: "Say hello" }
  }
};
```

#### 2.4.3 核心特性

| 特性 | 说明 |
|------|------|
| 文件投放 | `~/.chainlesschain/plugins/*.js` 自动扫描 |
| 导出验证 | `validatePluginExports()` 校验 name/tools/hooks/commands |
| 工具注入 | 通过 `extraTools` 参数注入 agent-core |
| 命令注入 | REPL 斜杠命令自动注册 |
| DB 优先 | DB 注册的同名插件覆盖文件投放版本 |
| 容错加载 | 单个插件加载失败不影响其他插件 |

#### 2.4.4 实现文件

| 操作 | 文件 | 变更 |
|------|------|------|
| 新建 | `src/lib/plugin-autodiscovery.js` (227L) | scan/load/validate/extract 全实现 |

---

### Phase 5: Docker/SSH 执行后端 (Execution Backends) ✅

**影响**: MEDIUM | **工作量**: HIGH | **测试**: 42 pass

#### 2.5.1 问题

Agent 只能在本地执行命令。Hermes 支持 6 种执行后端。

#### 2.5.2 方案

`ExecutionBackend` 抽象基类 + 三种实现：

```javascript
// 工厂创建
const backend = createBackend({ type: "docker", options: { container: "dev" } });

// 统一接口
const { stdout, stderr, exitCode } = backend.execute("ls -la", { cwd: "/app", timeout: 30000 });
```

#### 2.5.3 核心特性

| 特性 | 说明 |
|------|------|
| LocalBackend | 封装 execSync，默认后端 |
| DockerBackend | 支持 exec（已有容器）和 run（临时容器）两种模式 |
| SSHBackend | 支持 user/key/port 自定义，StrictHostKeyChecking=no |
| 工厂模式 | `createBackend(config)` 从配置创建 |
| 配置驱动 | `.chainlesschain/config.json` → `agent.executionBackend` |
| 命令转义 | `_escapeCommand()` 防止注入 |
| `_deps` 注入 | execSync 通过 `_deps` 可测试 |

#### 2.5.4 实现文件

| 操作 | 文件 | 变更 |
|------|------|------|
| 新建 | `src/lib/execution-backend.js` (242L) | 基类 + Local/Docker/SSH + createBackend 工厂 |

#### 2.5.5 使用示例

```jsonc
// .chainlesschain/config.json
{
  "agent": {
    "executionBackend": {
      "type": "docker",
      "options": {
        "container": "my-dev-container",
        "workdir": "/workspace",
        "shell": "bash"
      }
    }
  }
}
```

```jsonc
// SSH 后端配置
{
  "agent": {
    "executionBackend": {
      "type": "ssh",
      "options": {
        "host": "dev-server.example.com",
        "user": "deploy",
        "key": "~/.ssh/id_rsa",
        "port": 22,
        "workdir": "/opt/app"
      }
    }
  }
}
```

---

### Phase 6: 消息平台网关 (Messaging Gateways) ✅

**影响**: LOW-MED | **工作量**: HIGH | **测试**: 37 pass

#### 2.6.1 问题

Agent 仅可通过 CLI/WS/Web UI 访问。Hermes 支持 6 种消息平台。

#### 2.6.2 方案

- `GatewayBase` 抽象基类: 会话-per-chat、消息映射、速率限制、响应分块
- Telegram 格式化器: MarkdownV2 转义 + 4000 字符限制
- Discord 格式化器: 2000 字符分块 + 代码块 + 引用块
- 会话存入相同 JSONL 存储（Phase 2 的 FTS 自动索引）

#### 2.6.3 核心特性

| 特性 | 说明 |
|------|------|
| 会话管理 | 每个 chatId 独立会话，自动创建/清除 |
| 速率限制 | 可配置窗口期和最大消息数 |
| 响应分块 | 优先在换行符处分割，保持可读性 |
| Telegram 格式化 | MarkdownV2 转义 + 代码块保留 |
| Discord 格式化 | 代码块高亮 + 引用块 + 2000 字符分块 |
| 事件驱动 | `started`/`stopped` 事件通知 |

#### 2.6.4 实现文件

| 操作 | 文件 | 变更 |
|------|------|------|
| 新建 | `src/gateways/gateway-base.js` (189L) | 共享基类全实现 |
| 新建 | `src/gateways/telegram/telegram-formatter.js` (96L) | MarkdownV2 格式化 |
| 新建 | `src/gateways/discord/discord-formatter.js` (93L) | Discord 格式化 |

## 3. 实施顺序与依赖

```
Phase 1 (预算) ✅ ──────────────────┐
Phase 2 (FTS搜索) ✅ ──────────┐    │
Phase 3 (USER.md) ✅            │    │
                                │    │
Phase 4 (插件) ✅ ── 独立       │    │
                                │    │
Phase 5 (后端) ✅ ── 依赖 Phase 1 (预算跨后端共享)
Phase 6 (网关) ✅ ── 受益于 Phase 2 (网关会话可被搜索)
```

**Phase 1-4 独立**，并行开发完成。Phase 5-6 依赖/受益于前置 Phase。

## 4. 总量统计

| 指标 | 计划 | 实际 |
|------|------|------|
| 新建文件 | ~15 | 8 (更紧凑的实现) |
| 修改文件 | ~20 | 9 |
| 新增源代码 | ~2,000-2,500 行 | ~1,400 行 |
| 新增测试 | ~105 | 253 (206 unit + 25 integration + 22 E2E) |
| 新增 CLI 命令 | `/search`, `/profile` | ✅ 已实现 |
| 新增 Agent 工具 | `search_sessions` | ✅ 已实现 |

## 5. 测试矩阵

### 5.1 单元测试 (206 tests)

| 测试文件 | 测试数 | 覆盖范围 |
|---------|--------|---------|
| `iteration-budget.test.js` | 38 | 创建/消费/警告/共享/环境变量/边界 |
| `session-search.test.js` | 32 | FTS建表/索引/搜索/重建/容错/空DB |
| `user-profile.test.js` | 27 | CRUD/字符限制/LLM整理/追加/路径 |
| `plugin-autodiscovery.test.js` | 30 | 扫描/验证/加载/提取工具/提取命令/DB冲突 |
| `execution-backend.test.js` | 42 | Local/Docker/SSH/工厂/命令转义/错误 |
| `gateway-base.test.js` | 37 | 生命周期/会话/速率限制/分块/Telegram/Discord |

### 5.2 集成测试 (25 tests)

| 测试文件 | 测试数 | 覆盖范围 |
|---------|--------|---------|
| `hermes-parity-workflow.test.js` | 25 | 预算+AgentCore / 搜索+会话 / Profile+上下文 / 插件管线 / 后端工厂 / 网关生命周期 |

### 5.3 E2E 测试 (22 tests)

| 测试文件 | 测试数 | 覆盖范围 |
|---------|--------|---------|
| `hermes-parity-commands.test.js` | 22 | 模块导入 / Profile CLI / Budget CLI / Backend CLI / Plugin CLI / Gateway CLI |

## 6. 关键文件清单

| 文件 | 类型 | 行数 | 说明 |
|------|------|------|------|
| `src/lib/iteration-budget.js` | 新建 | 176 | 共享迭代预算 |
| `src/lib/session-search.js` | 新建 | 192 | FTS5 跨会话搜索 |
| `src/lib/user-profile.js` | 新建 | 173 | USER.md 用户画像 |
| `src/lib/plugin-autodiscovery.js` | 新建 | 227 | 零摩擦插件发现 |
| `src/lib/execution-backend.js` | 新建 | 242 | 执行后端抽象 |
| `src/gateways/gateway-base.js` | 新建 | 189 | 网关基类 |
| `src/gateways/telegram/telegram-formatter.js` | 新建 | 96 | Telegram 格式化 |
| `src/gateways/discord/discord-formatter.js` | 新建 | 93 | Discord 格式化 |
| `src/runtime/agent-core.js` | 修改 | — | budget loop + search_sessions |
| `src/lib/cli-context-engineering.js` | 修改 | — | USER.md 上下文注入 |
| `src/repl/agent-repl.js` | 修改 | — | /search + /profile + budget |
| `src/runtime/coding-agent-contract-shared.cjs` | 修改 | — | search_sessions 契约 |
| `src/runtime/coding-agent-policy.cjs` | 修改 | — | search_sessions 策略 |
| `src/lib/sub-agent-context.js` | 修改 | — | iterationBudget 传递 |
| `src/lib/hook-manager.js` | 修改 | — | 2 个新钩子事件 |
| `src/lib/autonomous-agent.js` | 修改 | — | iterationBudget 参数 |

## 7. 故障排查

### Issue: Budget Warning 没有出现

**症状**: Agent 超过 35 次迭代但未看到 `[Budget Warning]`

**原因**: 
1. 未使用 REPL 的 `agentLoop` wrapper（直接调用 `coreAgentLoop` 不显示事件）
2. `CC_ITERATION_BUDGET` 设为过大值

**解决方案**:
```bash
# 检查当前预算值
CC_ITERATION_BUDGET=50 chainlesschain agent
# 确保通过 agent-repl.js 启动（非直接 API 调用）
```

### Issue: /search 返回空结果

**症状**: 搜索已知存在的内容但返回 "No results found"

**原因**: FTS 索引尚未构建（需要在会话结束时触发索引）

**解决方案**:
```bash
# 在 REPL 中手动重建索引
> /reindex
# 或通过 search_sessions 工具（Agent 自动触发）
```

### Issue: 文件投放插件未加载

**症状**: 放入 `~/.chainlesschain/plugins/my-plugin.js` 后重启 agent 未生效

**原因**:
1. 插件未导出 `name` 字段（必填）
2. DB 中已注册同名插件（DB 版本优先）
3. 文件不是 `.js` 扩展名

**解决方案**:
```javascript
// 确保插件导出 name
export default { name: "my-plugin", tools: [...] };
```

### Issue: Docker 后端连接失败

**症状**: `Docker backend: neither container nor image specified`

**原因**: config.json 中 `executionBackend.options` 未指定 `container` 或 `image`

**解决方案**:
```jsonc
// 二选一: container (exec 模式) 或 image (run 模式)
{ "type": "docker", "options": { "container": "my-container" } }
// 或
{ "type": "docker", "options": { "image": "node:18" } }
```

## 8. 安全考虑

| 方面 | 措施 |
|------|------|
| **插件隔离** | 文件投放插件通过 `validatePluginExports()` 验证导出格式，拒绝非法结构 |
| **FTS 注入** | search 参数通过 FTS5 MATCH 语法解析，特殊字符降级为引号短语 |
| **SSH 密钥** | 密钥路径从 config.json 读取，不从环境变量泄露 |
| **Docker 命令** | `_escapeCommand()` 转义双引号防止命令注入 |
| **速率限制** | GatewayBase 内置速率限制，防止网关消息洪水 |
| **USER.md 上限** | 2000 字符强制限制，防止 LLM 上下文膨胀 |
| **SQL 注入** | session_search 使用参数化查询，session_id 使用 `''` 转义 |
| **Shell Policy** | run_shell 继续使用现有 `evaluateShellCommandPolicy()` 策略过滤 |

## 9. 相关文档

- [84. 自主学习闭环系统](./84_自主学习闭环系统.md) — 技能自动生成（已有优势）
- [78. CLI Agent Runtime 重构](./78_CLI_Agent_Runtime重构实施计划.md) — agent-core 架构基础
- [82. CLI Runtime 收口路线图](./82_CLI_Runtime收口路线图.md) — envelope 协议统一
- [16. AI 技能系统](./16_AI技能系统.md) — 138 技能 + 4 层加载
- [CLAUDE-patterns.md](../../CLAUDE-patterns.md) — Hooks 三件套、Skill-Embedded MCP 等模式
- [docs-site 英文版](../../docs-site/docs/design/modules/85-hermes-agent-parity.md) — 用户文档
