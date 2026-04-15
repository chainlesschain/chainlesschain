# 会话管理 (session)

> Headless 命令。`session` 同时承载传统会话管理能力，以及 Managed Agents 对标阶段新增的会话级审批策略入口。

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
