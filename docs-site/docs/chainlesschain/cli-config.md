# 配置管理 (config)

> `config` 除了传统 `config.json` 管理外，当前还承载 Managed Agents 对标阶段新增的 `beta` 子命令。

## 概述

`chainlesschain config` 现在分三层：

- 基础配置：`list` / `get` / `set` / `edit` / `reset`
- 通用功能开关：`features list|enable|disable`
- Managed Agents Beta Flags：`beta list|enable|disable`

## 基础配置

### 列出配置

```bash
chainlesschain config list
```

### 读取与写入配置

```bash
chainlesschain config get llm.provider
chainlesschain config set llm.provider ollama
```

### 编辑与重置

```bash
chainlesschain config edit
chainlesschain config reset
```

## 通用功能开关: `features`

```bash
chainlesschain config features list
chainlesschain config features enable CONTEXT_SNIP
chainlesschain config features disable CONTEXT_SNIP
```

这部分用于现有 CLI feature flag 体系，和 Managed Agents Beta Flags 是并行关系。

## Managed Agents 增强: `beta`

`config beta` 接入 `@chainlesschain/session-core` 的 `BetaFlags`，用于管理实验特性开关，命名格式建议为：

```text
<feature>-<YYYY-MM-DD>
```

### 查看已启用和已知 Beta Flags

```bash
chainlesschain config beta list
chainlesschain config beta list --json
```

### 启用 Beta Flag

```bash
chainlesschain config beta enable managed-agents-2026-04-15
chainlesschain config beta enable idle-park-2026-05-01
```

### 禁用 Beta Flag

```bash
chainlesschain config beta disable managed-agents-2026-04-15
```

### JSON 输出示例

```json
{
  "enabled": ["managed-agents-2026-04-15"],
  "known": ["managed-agents-2026-04-15"]
}
```

## 持久化文件

- `config.json`：基础 CLI 配置
- `~/.chainlesschain/beta-flags.json`：Managed Agents Beta Flags

## 当前限制

- `beta` 目前主要用于 CLI Managed Agents 对标阶段的灰度开关
- Desktop 端尚未切换到同一份 `beta-flags.json`
- 某些 Beta Flag 仅完成底层能力，还未默认接入主运行路径

## 关键文件

- `packages/cli/src/commands/config.js`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/session-core/lib/beta-flags.js`
- `packages/session-core/lib/file-adapters.js`

## 测试覆盖

本轮已补齐并通过：

- Unit: `command-registration.test.js` 已覆盖 `config beta list|enable|disable`
- Integration: `managed-agents-cli.integration.test.js` 中 `config beta enable/list/disable` 用例
- E2E: `managed-agents-commands.test.js` 中 `config beta` 帮助与持久化用例

## 相关文档

- [持久记忆](./cli-memory)
- [会话管理](./cli-session)
- [Managed Agents 对标](./managed-agents-parity)
- [设计文档 91](../design/modules/91-managed-agents-parity)
