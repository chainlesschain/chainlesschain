# 持久记忆 (memory)

> `memory` 当前同时包含两套能力：传统数据库记忆/每日笔记，以及 Managed Agents 对标阶段新增的 scoped memory。

## 概述

传统能力适合本地知识沉淀：

- `show` / `add` / `search` / `delete`
- `daily` / `file`

Managed Agents 增强适合 Agent 运行时的作用域记忆：

- `store`：写入 `session | agent | global` 作用域记忆
- `recall`：按 query、scope、category、tags 召回

## 命令总览

```bash
chainlesschain memory show
chainlesschain memory add "偏好 TypeScript" --category preference
chainlesschain memory search "数据库"
chainlesschain memory delete <id>
chainlesschain memory daily --append "今天完成了回归测试"
chainlesschain memory file --edit
chainlesschain memory store "偏好 TypeScript" --scope global --category preference --tags ts,style
chainlesschain memory recall "TypeScript" --scope global
```

## 传统记忆命令

### `show` / `add` / `search` / `delete`

这组命令仍走数据库记忆管理器，适合日常笔记和长期条目。

```bash
chainlesschain memory show --limit 10
chainlesschain memory add "项目使用 PostgreSQL" --category work --importance 5
chainlesschain memory search "PostgreSQL" --limit 5
chainlesschain memory delete mem-1234
```

### `daily`

管理按日期分组的每日笔记。

```bash
chainlesschain memory daily
chainlesschain memory daily 2026-04-15
chainlesschain memory daily --append "补齐 managed agents 测试"
chainlesschain memory daily --list
```

### `file`

查看或编辑长期 `MEMORY.md` 文件。

```bash
chainlesschain memory file
chainlesschain memory file --edit
```

## Managed Agents 增强: scoped memory

### `store`

写入 `@chainlesschain/session-core` 的 `MemoryStore`。这套数据与数据库记忆独立，主要服务于 Agent runtime。

```bash
chainlesschain memory store "偏好 TypeScript" --scope global --category preference
chainlesschain memory store "避免修改 deployment 脚本" --scope agent --scope-id agent_codegen --category safety --tags deploy,warning
chainlesschain memory store "这个会话在做 CLI 文档收口" --scope session --scope-id sess_123 --category context
```

可选参数：

| 参数 | 说明 |
|------|------|
| `--scope` | 必填，`session` / `agent` / `global` |
| `--scope-id` | `session` 或 `agent` 作用域时建议提供 |
| `--category` | 分类，默认 `general` |
| `--tags` | 逗号分隔标签 |
| `--json` | 输出 JSON |

### `recall`

按 query、scope、scope-id、category、tags 检索 scoped memory。

```bash
chainlesschain memory recall "TypeScript"
chainlesschain memory recall "deploy" --scope agent --scope-id agent_codegen
chainlesschain memory recall "上下文" --scope session --scope-id sess_123 --limit 5
chainlesschain memory recall "TypeScript" --scope global --category preference --tags ts --json
```

输出会展示：

- 记忆 ID
- scope / scopeId
- category
- relevance
- 内容摘要

## 持久化文件

Managed Agents scoped memory 当前写入：

- `~/.chainlesschain/memory-store.json`

传统记忆仍使用原有数据库和 `MEMORY.md`/daily notes 目录。

## 当前限制

- `memory consolidate --session <id>` 还没接入 CLI
- 新会话自动注入 top-K scoped memory 仍在 Phase G 规划中
- Desktop 端还没有复用同一份 `memory-store.json`

## 关键文件

- `packages/cli/src/commands/memory.js`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/session-core/lib/memory-store.js`
- `packages/session-core/lib/file-adapters.js`

## 测试覆盖

本轮已补齐并通过：

- Unit: `command-registration.test.js` 已覆盖 `memory recall/store` 注册
- Integration: `managed-agents-cli.integration.test.js` 中 `memory store/recall` 用例 `3/3` 的一部分
- E2E: `managed-agents-commands.test.js` 中 `memory store + recall` 用例

## 相关文档

- [会话管理](./cli-session)
- [配置管理](./cli-config)
- [Managed Agents 对标](./managed-agents-parity)
- [设计文档 91](../design/modules/91-managed-agents-parity)
