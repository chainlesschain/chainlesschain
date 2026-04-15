# Managed Agents Parity — CLI 命令

> 版本: v1.9 | 日期: 2026-04-16 | 状态: CLI 已接入 `memory recall/store`、`session policy`、`config beta`，并完成跨进程持久化。

这是一页命令侧文档，聚焦当前已经可直接在 CLI 中使用的 Managed Agents 对标能力。总体设计、Phase A-F 进度和 Desktop 收口计划见 [Managed Agents 对标总览](./managed-agents-parity)。

## 命令范围

当前可直接使用的命令只有三组：

```bash
chainlesschain memory store <content> --scope <session|agent|global>
chainlesschain memory recall [query]
chainlesschain session policy <sessionId> [--set strict|trusted|autopilot]
chainlesschain config beta list|enable|disable <feature>-<YYYY-MM-DD>
```

## Scoped Memory

`memory store` / `memory recall` 使用 `@chainlesschain/session-core` 的 `MemoryStore`，与传统 `memory add`、`memory search` 的数据库实现分离。

### 写入

```bash
chainlesschain memory store "偏好 TypeScript" --scope global --category preference
chainlesschain memory store "这个会话在做 CLI 文档收口" --scope session --scope-id sess_docs --category context
chainlesschain memory store "部署相关操作需要谨慎" --scope agent --scope-id agent_codegen --category safety --tags deploy,warning
```

### 召回

```bash
chainlesschain memory recall "TypeScript" --scope global
chainlesschain memory recall "部署" --scope agent --scope-id agent_codegen --limit 5
chainlesschain memory recall --tags deploy,warning --json
```

### 持久化文件

- `~/.chainlesschain/memory-store.json`

## Session Approval Policy

`session policy` 使用 `ApprovalGate` 管理单会话审批策略。

### 支持策略

| 策略 | 说明 |
|---|---|
| `strict` | 默认最保守，中高风险操作需要确认 |
| `trusted` | 低中风险尽量放行，仅高风险要求确认 |
| `autopilot` | 自动放行 |

### 使用示例

```bash
chainlesschain session policy sess_build_001
chainlesschain session policy sess_build_001 --set trusted
chainlesschain session policy sess_build_001 --json
```

### 持久化文件

- `~/.chainlesschain/approval-policies.json`

## Beta Flags

`config beta` 使用 `BetaFlags` 管理实验特性开关。推荐命名格式：

```text
<feature>-<YYYY-MM-DD>
```

### 使用示例

```bash
chainlesschain config beta list
chainlesschain config beta enable managed-agents-2026-04-15
chainlesschain config beta disable managed-agents-2026-04-15
chainlesschain config beta list --json
```

### 持久化文件

- `~/.chainlesschain/beta-flags.json`

## 当前限制

- `memory consolidate --session <id>` 还未接入 CLI
- 新会话自动注入 top-K scoped memory 还未接入
- CLI 主运行时尚未全部切到 `ApprovalGate` / `StreamRouter`
- Desktop 端还未与 CLI 共用同一套持久化状态文件

## 测试状态

这次已实际验证：

- `@chainlesschain/session-core`: `293/293`
- CLI unit: `session-core-singletons.test.js` `4/4`
- CLI unit: `command-registration.test.js` `26/26`
- CLI integration: `managed-agents-cli.integration.test.js` `3/3`
- CLI E2E: `managed-agents-commands.test.js` `6/6`

## 关键文件

- `packages/cli/src/commands/memory.js`
- `packages/cli/src/commands/session.js`
- `packages/cli/src/commands/config.js`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/session-core/lib/file-adapters.js`

## 相关文档

- [Managed Agents 对标总览](./managed-agents-parity)
- [会话管理](./cli-session)
- [持久记忆](./cli-memory)
- [配置管理](./cli-config)
- [设计文档 91](../design/modules/91-managed-agents-parity)
