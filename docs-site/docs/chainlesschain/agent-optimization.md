# Agent 架构优化 (v5.0.2.9)

> 2026-04-06 补充增强：
> 已新增任务历史分页检索、任务输出摘要、多节点恢复策略基础能力；
> Worktree 冲突自动化候选项与 diff 预览入口；
> 压缩观测时间窗口筛选及 provider/model 切片；
> 旧 JSON 会话到 JSONL 的 dry-run 报告、抽样校验与失败重试。

## v5.0.2.10 / 2026-04-06 补充增强

### 后台任务

- `tasks-history` 新增 `offset` / `limit` 分页能力。
- 任务详情中新增 `outputSummary`，便于面板快速预览输出结果。
- 恢复逻辑新增多节点策略基础能力：
  - `claim-stale`
  - `local-only`
  - `observe-only`

### Worktree

- 冲突结果中新增 `automationCandidates`。
- 冲突结果中新增 `diffPreview` 与 `previewEntrypoints`。

### 压缩观测

- `compression-stats` 支持 `windowMs`、`provider`、`model` 参数。
- Dashboard 新增时间窗口、Provider、Model 三组筛选维度。

### 会话迁移

- 新增 `migrateLegacySessionsBatch()`。
- `session migrate` 支持 `--sample-size` 与 `--retry-failures`。
- 迁移结果增加 summary 和 sampled validation 报告。

### 本轮验证

- CLI 定向单元：`125/125`
- CLI 定向集成：`18/18`
- Web Panel 定向单元：`12/12`
- Web Panel E2E：`29/29`

> 5 个核心优化模块 + 4 项增强集成，借鉴 Claude Code 12 层渐进式 harness 架构，为 CLI Agent 提供特性门控、自适应上下文压缩、JSONL 会话持久化、后台任务监控和 Worktree 隔离。

## 快速开始

```bash
# 查看所有特性标志
chainlesschain config features list

# 启用/禁用特性
chainlesschain config features enable CONTEXT_SNIP
chainlesschain config features disable CONTEXT_SNIP

# 环境变量覆盖（优先级最高）
CC_FLAG_CONTEXT_SNIP=true chainlesschain agent
```

## 五个优化模块

### 1. Feature Flags（特性门控）

渐进式发布系统，支持三级优先级控制：

**优先级**: 环境变量 `CC_FLAG_<NAME>` > 配置文件 `config.features.<NAME>` > 默认值

| 标志名 | 默认值 | 说明 |
|--------|--------|------|
| `BACKGROUND_TASKS` | false | 后台任务队列 |
| `WORKTREE_ISOLATION` | false | Git Worktree 隔离 |
| `CONTEXT_SNIP` | false | snipCompact 压缩策略 |
| `CONTEXT_COLLAPSE` | false | contextCollapse 折叠策略 |
| `JSONL_SESSION` | false | JSONL 追加式会话持久化 |
| `PROMPT_COMPRESSOR` | true | 提示压缩器（默认开启） |

支持百分比灰度发布，基于确定性哈希实现 A/B 分流。

### 2. Prompt Compressor（上下文压缩）

5 策略流水线，自动管理 Agent 上下文窗口：

| 策略 | 说明 | 门控 |
|------|------|------|
| 去重 (Deduplicate) | Jaccard 相似度去重 | 始终启用 |
| 截断 (Truncate) | 保留最近 N 条消息 | 始终启用 |
| 摘要 (Summarize) | LLM 生成历史摘要 | 始终启用 |
| 清理 (SnipCompact) | 移除陈旧标记 | `CONTEXT_SNIP` |
| 折叠 (ContextCollapse) | 折叠连续工具调用 | `CONTEXT_COLLAPSE` |

**Token 估算**：中文 1.5 字符/token，英文 4 字符/token

**自动触发**：消息数超过阈值或 token 数超限时自动压缩。

**自适应策略** (v5.0.2.9 新增)：根据当前 LLM provider 的 context window 大小自动调整压缩阈值。例如：
- Ollama 本地模型 (8k-32k): 更积极压缩，maxMessages ≈ 20
- OpenAI GPT-4o (128k): 适中压缩，maxMessages ≈ 35
- Anthropic Claude (200k): 宽松压缩，maxMessages ≈ 40
- Gemini (1M): 最宽松，maxMessages = 50

内置 30+ 模型的 context window 注册表 (`CONTEXT_WINDOWS`)，支持 `adaptToModel()` 动态切换。

### 3. JSONL Session Store（会话持久化）

**v5.0.2.9 全面集成**：启用 `JSONL_SESSION` 后，`agent-repl.js` 和所有 `session` 命令自动切换到 JSONL 模式，替代全量 JSON 覆写。

- **崩溃恢复**：每条消息同步写入，进程异常终止后可从 JSONL 重建完整会话
- **事件类型**：`session_start`、`user_message`、`assistant_message`、`compact`（快照）、`fork`（分支会话）
- **增量写入**：Agent 每轮对话只追加 user + assistant 事件，不重写全量
- **compact 检查点**：自动压缩后写入 compact 事件，包含压缩后的消息快照
- **session 命令**：`session list` 合并显示 DB + JSONL 会话，`session show/resume` 优先使用 JSONL

```bash
# 启用 JSONL 会话
chainlesschain config features enable JSONL_SESSION

# 恢复历史会话
chainlesschain agent --session <session-id>

# 查看所有会话（合并 DB + JSONL）
chainlesschain session list
```

### 4. Background Task Manager（后台任务）

使用 `child_process.fork()` 实现后台执行：

- **任务生命周期**：pending → running → completed/failed/cancelled
- **IPC 心跳**：子进程定期上报进度和状态
- **队列持久化**：任务元数据持久化到 JSONL，重启后可恢复
- **Web Panel 监控** (v5.0.2.9 新增)：通过 `chainlesschain ui` 打开 Web 面板，在「后台任务」页面实时查看任务状态、停止运行中的任务

**WS 协议**：
- `{ type: "tasks-list" }` → 返回所有任务列表
- `{ type: "tasks-stop", taskId }` → 停止指定任务

```bash
# 启用后台任务
chainlesschain config features enable BACKGROUND_TASKS
```

### 5. Worktree Isolator（Git Worktree 隔离）

为并发 Agent 任务提供独立工作目录：

- **自动创建**：`isolateTask(name, fn)` 自动创建临时 worktree
- **分支命名**：`agent/<taskName>-<timestamp>`
- **自动清理**：任务完成后自动移除 worktree
- **Sub-Agent 集成** (v5.0.2.9 新增)：`SubAgentContext` 启用 `WORKTREE_ISOLATION` 后，子 Agent 自动在独立 worktree 中运行，文件操作完全隔离

```bash
# 启用 Worktree 隔离
chainlesschain config features enable WORKTREE_ISOLATION
```

## 配置示例

```json
{
  "features": {
    "PROMPT_COMPRESSOR": true,
    "CONTEXT_SNIP": true,
    "CONTEXT_COLLAPSE": true,
    "JSONL_SESSION": true,
    "BACKGROUND_TASKS": false,
    "WORKTREE_ISOLATION": false
  }
}
```

## 测试覆盖

| 文件 | 类型 | 测试数 |
|------|------|--------|
| `prompt-compressor.test.js` | 单元 | 24 |
| `feature-flags.test.js` | 单元 | 27 |
| `jsonl-session-store.test.js` | 单元 | 21 |
| `background-task-manager.test.js` | 单元 | 20 |
| `worktree-isolator.test.js` | 单元 | 12 |
| `agent-optimization-extended.test.js` | 单元 | 56 |
| `v5029-features.test.js` | 单元 | 33 |
| `v5029-extended.test.js` | 单元 | 62 |
| `agent-optimization-workflow.test.js` | 集成 | 23 |
| `v5029-workflow.test.js` | 集成 | 19 |
| `agent-optimization-commands.test.js` | E2E | 23 |
| `v5029-commands.test.js` | E2E | 14 |
| **合计** | | **334** |

## 相关文档

- [设计文档 — 模块 77](../design/modules/77-agent-optimization) — 完整技术架构与实现细节
- [CLI 配置管理 (config)](./cli-config) — 配置命令参考
- [Agent 模式 (agent)](./cli-agent) — Agent 会话使用指南
