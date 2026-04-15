# Managed Agents 对标

> 版本: v1.9 | 日期: 2026-04-16 | 状态: `session-core` Phase A-F 已落地，CLI 已接入 `memory recall/store`、`session policy`、`config beta`，Desktop 收口中。

## 概述

ChainlessChain 这轮对标的是 Anthropic Claude Managed Agents 的托管式 Agent 运行时语义，但实现策略不是复制云托管，而是把可复用的 session runtime 抽到共享包 `@chainlesschain/session-core`，再逐步接入 CLI 与 Desktop。

当前已完成：

- `SessionHandle` / `SessionManager` / `IdleParker`
- `TraceStore`
- `AgentGroup` / `SharedTaskList`
- `MemoryStore` / `MemoryConsolidator`
- `ApprovalGate`
- `BetaFlags`
- `StreamRouter`
- `file-adapters`

## 当前已落地的 CLI 命令

### 会话审批策略

```bash
chainlesschain session policy <sessionId>
chainlesschain session policy <sessionId> --set strict
chainlesschain session policy <sessionId> --set trusted
chainlesschain session policy <sessionId> --set autopilot
```

### Scoped Memory

```bash
chainlesschain memory store "偏好 TypeScript" --scope global --category preference
chainlesschain memory recall "TypeScript" --scope global
```

### Beta Flags

```bash
chainlesschain config beta list
chainlesschain config beta enable managed-agents-2026-04-15
chainlesschain config beta disable managed-agents-2026-04-15
```

## 本地持久化文件

CLI 侧当前已经通过 file adapter 做到跨进程持久化：

- `~/.chainlesschain/memory-store.json`
- `~/.chainlesschain/beta-flags.json`
- `~/.chainlesschain/approval-policies.json`

## 设计目标

这轮对标聚焦 4 个方向：

- 让 session 成为一等公民，而不是散落在多个 runtime 中
- 把 approval policy、memory、beta flags 收敛为共享语义
- 为 CLI 和 Desktop 共用同一套 session runtime 打基础
- 保持本地优先、离线可用、硬件加密兼容，而不是变成纯云托管设计

## 当前进度

### 已完成

- `packages/session-core` 共享包建立并接入 monorepo
- `session-core` 测试已达到 `293/293`
- CLI 已补齐 Managed Agents 相关单元、集成、E2E 测试
- `session policy` 已从“进程内生效”推进到“跨进程持久化”

### 进行中

- Phase G: CLI 主运行路径收口到 `AgentGroup`、`StreamRouter`、`ApprovalGate`、`MemoryConsolidator`
- Phase H: Desktop 主进程与 IPC 收口到 `session-core`

### 还未完成

- `memory consolidate --session <id>` CLI 命令
- 新会话自动注入 top-K scoped memory
- Desktop 端与 CLI 共用同一份 policy / beta / memory 持久化文件
- `session trace`、`session usage`、`session park` 等上层命令

## 测试状态

这轮已验证的核心测试包括：

- `@chainlesschain/session-core`: `293/293`
- CLI unit: `session-core-singletons.test.js` `4/4`
- CLI unit: `cli-context-engineering.test.js` `55/55`
- CLI unit: `command-registration.test.js` `26/26`
- CLI integration: `managed-agents-cli.integration.test.js` `3/3`
- CLI E2E: `managed-agents-commands.test.js` `6/6`

## 关键文件

- `packages/session-core/`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/cli/src/commands/session.js`
- `packages/cli/src/commands/memory.js`
- `packages/cli/src/commands/config.js`
- `docs/design/modules/91_Managed_Agents对标计划.md`

## 相关文档

- [会话管理](./cli-session)
- [持久记忆](./cli-memory)
- [配置管理](./cli-config)
- [设计文档 91](../design/modules/91-managed-agents-parity)
- [Hermes Agent 对标](./hermes-agent-parity)
