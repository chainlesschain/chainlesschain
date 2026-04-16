# 会话管理 (session)

> Headless 命令。`session` 同时承载传统会话管理能力，以及 Managed Agents 对标阶段新增的会话级审批策略入口。

## 核心特性

- 📋 **完整生命周期管理** — list / show / resume / export / delete，覆盖会话全周期
- 🔒 **per-session 审批策略** — `session policy` 为每个会话独立设置 strict / trusted / autopilot
- 🔄 **格式迁移与校验** — `session migrate` 将旧 JSON 格式升级为 JSONL，`session validate` 检查完整性
- 📊 **工作流状态查看** — `session workflow` 读取 intent / plan / progress / mode 四份工件
- 💾 **持久化审批策略** — `approval-policies.json` 跨进程保存，CLI 与 Desktop 共享同一份文件
- 📤 **Markdown 导出** — `session export` 一键导出为可读 Markdown 文档
- 🔍 **JSON 输出** — 所有子命令支持 `--json`，便于脚本自动化

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    CLI session 命令                          │
├───────────────────────────────┬─────────────────────────────┤
│  传统会话管理层                 │  Managed Agents 增强层       │
│  list / show / resume         │  policy (ApprovalGate)      │
│  export / delete              │  lifecycle / park / unpark  │
│  migrate / validate / workflow│  tail / usage               │
└───────────────┬───────────────┴──────────────┬──────────────┘
                │                              │
                ▼                              ▼
  ┌─────────────────────────┐    ┌──────────────────────────┐
  │  SQLite DB              │    │  session-core            │
  │  chainlesschain.db      │    │  approval-policies.json  │
  │  + JSONL sessions       │    │  parked-sessions.json    │
  │  ~/.chainlesschain/     │    │  (MemoryStore / traces)  │
  │    sessions/<id>/       │    └──────────────────────────┘
  └─────────────────────────┘
```

## 概述

`chainlesschain session` 目前有两类能力：

- 传统会话管理：列出、查看、恢复、导出、删除、迁移、校验历史会话
- Managed Agents 增强：通过 `session policy` 为单个会话设置审批策略，并持久化到本地文件

## 命令总览

```bash
chainlesschain session list
chainlesschain session show <id>
chainlesschain session resume <id>
chainlesschain session export <id> --output out.md
chainlesschain session delete <id> --force
chainlesschain session migrate [source] --dry-run
chainlesschain session validate [id]
chainlesschain session workflow [id] --cwd .
chainlesschain session policy <id>
chainlesschain session policy <id> --set strict
chainlesschain session policy <id> --set trusted
chainlesschain session policy <id> --set autopilot
```

## 传统会话管理

### `list`

列出最近保存的会话，默认合并数据库会话和 JSONL 会话。

```bash
chainlesschain session list
chainlesschain session list --limit 5
chainlesschain session list --json
```

### `show`

查看指定会话的消息内容。

```bash
chainlesschain session show sess-1234
chainlesschain session show sess-1234 --limit 20
chainlesschain session show sess-1234 --json
```

### `resume`

恢复会话并重新进入 chat REPL。

```bash
chainlesschain session resume sess-1234
chainlesschain session resume sess-1234 --provider ollama --model qwen2:7b
```

### `export`

导出数据库会话为 Markdown。

```bash
chainlesschain session export sess-1234
chainlesschain session export sess-1234 --output chat-log.md
```

### `delete`

删除数据库中的指定会话。

```bash
chainlesschain session delete sess-1234
chainlesschain session delete sess-1234 --force
```

### `migrate` / `validate`

用于 JSON 会话向 JSONL 会话迁移，以及 JSONL 会话结构校验。

```bash
chainlesschain session migrate ./.chainlesschain/sessions --dry-run
chainlesschain session migrate ./.chainlesschain/sessions --sample-size 5
chainlesschain session validate
chainlesschain session validate sess-1234
```

### `workflow`

查看规范工作流会话状态，读取 `.chainlesschain/sessions/<id>/` 下的 `intent.md`、`plan.md`、`progress.log`、`mode.json`。

```bash
chainlesschain session workflow
chainlesschain session workflow wf_123 --cwd .
chainlesschain session workflow wf_123 --json
```

## Managed Agents 增强: `session policy`

`session policy` 来自 `@chainlesschain/session-core` 的 `ApprovalGate`，用于为单个会话设置审批策略。当前 CLI 已支持跨进程持久化。

### 支持的策略

| 策略 | 含义 |
|------|------|
| `strict` | 默认最保守策略，中高风险操作需要确认 |
| `trusted` | 低中风险尽量放行，仅高风险操作要求确认 |
| `autopilot` | 自动驾驶策略，直接放行 |

### 查看当前策略

```bash
chainlesschain session policy sess_build_001
chainlesschain session policy sess_build_001 --json
```

### 设置策略

```bash
chainlesschain session policy sess_build_001 --set strict
chainlesschain session policy sess_build_001 --set trusted
chainlesschain session policy sess_build_001 --set autopilot
```

### 输出示例

```json
{
  "sessionId": "sess_build_001",
  "policy": "trusted"
}
```

## 持久化文件

Managed Agents 相关策略会写入本地 home 目录：

- `~/.chainlesschain/approval-policies.json`：per-session approval policy

## 配置参考

### approval-policies.json 结构

```js
// ~/.chainlesschain/approval-policies.json
{
  "version": 1,
  "policies": {
    "sess_build_001": {
      "policy": "trusted",
      "updatedAt": "2026-04-15T10:00:00.000Z"
    },
    "sess_deploy_002": {
      "policy": "strict",
      "updatedAt": "2026-04-15T12:30:00.000Z"
    },
    "sess_local_003": {
      "policy": "autopilot",
      "updatedAt": "2026-04-15T14:00:00.000Z"
    }
  }
}
```

### 审批策略详细说明

```js
// 策略枚举及对应行为
const POLICIES = {
  // strict: 默认值，最保守 — 中/高风险工具调用均需用户确认
  strict: {
    lowRisk:    "auto-approve",   // read_file, list_files 等
    mediumRisk: "require-confirm",// write_file, run_shell 等
    highRisk:   "require-confirm" // delete, network, secrets 等
  },

  // trusted: 日常开发模式 — 仅高风险操作要求确认
  trusted: {
    lowRisk:    "auto-approve",
    mediumRisk: "auto-approve",
    highRisk:   "require-confirm"
  },

  // autopilot: 完全自动 — 直接放行所有操作（CI/受信任环境专用）
  autopilot: {
    lowRisk:    "auto-approve",
    mediumRisk: "auto-approve",
    highRisk:   "auto-approve"
  }
};
```

### JSONL 会话目录结构

```
~/.chainlesschain/sessions/<session-id>/
├── events.jsonl      # 会话事件流（主轨迹）
├── intent.md         # 规范工作流：用户意图声明
├── plan.md           # 规范工作流：执行计划
├── progress.log      # 规范工作流：进度日志
└── mode.json         # 规范工作流：当前模式状态
```

## 性能指标

| 操作 | 典型延迟 | 数据规模建议 |
|------|----------|--------------|
| `session list` | < 50ms | 建议保留 < 1,000 条会话 |
| `session show` | < 30ms | 取决于消息数量 |
| `session resume` | 1–3s | 含 LLM 初始化 |
| `session export` | < 100ms | 含 Markdown 渲染 |
| `session delete` | < 20ms | SQLite 单条删除 |
| `session migrate` (批量) | 1–10s | 取决于会话文件数 |
| `session validate` | < 200ms | JSONL 逐行校验 |
| `session policy get` | < 10ms | 读取 JSON 文件 |
| `session policy set` | < 15ms | 写入并持久化 |

## 安全考虑

### 1. 审批策略最小权限原则

`autopilot` 策略会绕过所有确认提示，仅应用于完全受信任的自动化环境：

```bash
# ✅ CI/CD 流水线中使用 autopilot（无交互终端）
chainlesschain session policy ci_sess_001 --set autopilot

# ✅ 本地开发使用 trusted（平衡效率与安全）
chainlesschain session policy dev_sess_002 --set trusted

# ✅ 生产环境操作使用 strict（默认保守）
chainlesschain session policy prod_sess_003 --set strict
```

### 2. 会话数据访问控制

JSONL 会话文件包含完整的对话历史和工具调用记录，应限制访问权限：

```bash
# 限制会话目录权限
chmod 700 ~/.chainlesschain/sessions/
chmod 600 ~/.chainlesschain/sessions/**/*.jsonl
```

### 3. 敏感会话删除

对话中涉及敏感信息的会话，完成后应及时删除：

```bash
# 强制删除（跳过确认）
chainlesschain session delete sess-sensitive-001 --force

# 迁移前备份，再删除旧格式
chainlesschain session migrate --dry-run  # 先预览
chainlesschain session migrate            # 再迁移
```

### 4. 审批策略文件保护

`approval-policies.json` 控制工具执行权限，应防止未授权修改：

```bash
# 仅当前用户可读写
chmod 600 ~/.chainlesschain/approval-policies.json
```

## 故障排查

**Q: `session list` 返回空列表，但我有历史对话**

A: 检查是否混用了数据库会话和 JSONL 会话。旧版本使用 SQLite 存储，新版本使用 JSONL 文件。两者默认都会列出，但需确认会话目录路径：

```bash
ls ~/.chainlesschain/sessions/
chainlesschain session list --json
```

**Q: `session resume` 报错 `session not found`**

A: 确认 session ID 格式正确。使用 `session list` 获取可用 ID，注意区分数据库会话 ID（`sess-`前缀）和 JSONL 会话 ID（`sess_`前缀）：

```bash
chainlesschain session list --json | jq '.[].id'
```

**Q: `session policy --set` 成功但下次启动 agent 没有生效**

A: 当前 CLI 主运行时还未完全接入 `ApprovalGate`，部分审批路径仍走旧的 `permissionGate`。这是 Phase J 待收口项，使用前请查看最新版本发布说明。

**Q: `session migrate` 后旧的 `session show` 找不到会话**

A: 迁移后数据格式已变化，需用迁移后的新 ID 查询。在 `--dry-run` 模式可预览 ID 映射：

```bash
chainlesschain session migrate --dry-run
```

**Q: `session workflow` 显示字段全为空**

A: `workflow` 命令依赖规范工作流生成的四份工件（`intent.md` / `plan.md` / `progress.log` / `mode.json`）。普通 chat 会话不生成这些文件，只有通过 `agent --workflow` 模式启动的会话才有。

**Q: `session validate` 报 `invalid JSONL` 错误**

A: JSONL 文件中存在格式损坏的行（如不完整的 JSON）。可能是会话意外中断导致。使用 `--sample-size` 参数定位问题行：

```bash
chainlesschain session validate sess-1234 --json
```

## 使用示例

```bash
# --- 传统会话管理 ---

# 列出最近 10 条会话
chainlesschain session list --limit 10

# 以 JSON 格式列出（适合脚本处理）
chainlesschain session list --json | jq '.[0].id'

# 查看某会话的消息内容
chainlesschain session show sess-1234 --limit 20

# 恢复会话并继续对话
chainlesschain session resume sess-1234

# 切换模型继续会话
chainlesschain session resume sess-1234 --provider anthropic --model claude-sonnet-4-6

# 导出会话为 Markdown 文档
chainlesschain session export sess-1234 --output ./meeting-notes.md

# 删除会话（有确认提示）
chainlesschain session delete sess-1234

# 强制删除（跳过确认，适合脚本）
chainlesschain session delete sess-1234 --force

# 预览迁移（不实际执行）
chainlesschain session migrate ./.chainlesschain/sessions --dry-run

# 执行迁移，以 5 条为样本
chainlesschain session migrate --sample-size 5

# 校验所有 JSONL 会话
chainlesschain session validate

# 校验单个会话
chainlesschain session validate sess-1234

# 查看规范工作流会话状态
chainlesschain session workflow wf_123 --cwd . --json

# --- Managed Agents 审批策略 ---

# 查看某会话的当前审批策略
chainlesschain session policy sess_build_001

# 以 JSON 格式查看（便于脚本判断）
chainlesschain session policy sess_build_001 --json

# 设置为 trusted（日常开发推荐）
chainlesschain session policy sess_build_001 --set trusted

# CI 环境设置为 autopilot
chainlesschain session policy ci_pipeline_sess --set autopilot

# 生产操作恢复 strict 策略
chainlesschain session policy prod_hotfix_sess --set strict

# 批量为多个会话设置策略（配合 xargs）
chainlesschain session list --json \
  | jq -r '.[].id' \
  | xargs -I{} chainlesschain session policy {} --set trusted
```

## 当前限制

- `session policy` 已持久化，但 CLI 主运行时还没有把全部审批路径统一切到 `ApprovalGate`
- `session trace`、`session usage`、`session park/resume` 仍属于规划中的收口项
- Desktop 端尚未接入同一套 `ApprovalGate` 持久化文件

## 关键文件

- `packages/cli/src/commands/session.js`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/session-core/lib/approval-gate.js`
- `packages/session-core/lib/file-adapters.js`

## 测试覆盖

本轮已补齐并通过：

- Unit: `session-core-singletons.test.js` `4/4`
- Integration: `managed-agents-cli.integration.test.js` 中 `session policy` 用例
- E2E: `managed-agents-commands.test.js` 中 `session policy` 用例

## 相关文档

- [持久记忆](./cli-memory)
- [配置管理](./cli-config)
- [Managed Agents 对标](./managed-agents-parity)
- [设计文档 91](../design/modules/91-managed-agents-parity)
