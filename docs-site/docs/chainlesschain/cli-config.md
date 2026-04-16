# 配置管理 (config)

> `config` 除了传统 `config.json` 管理外，当前还承载 Managed Agents 对标阶段新增的 `beta` 子命令。

## 核心特性

- 🗂️ **三层配置体系** — 基础配置 / 通用功能开关 / Managed Agents Beta Flags 各司其职
- 🔑 **点分路径读写** — `config get/set llm.provider` 支持嵌套路径直接操作
- 🧪 **Beta Flags 灰度** — `<feature>-<YYYY-MM-DD>` 命名规范，滚动发布实验特性
- 📄 **JSON 输出** — 所有子命令支持 `--json`，便于脚本集成
- 🔄 **双文件持久化** — `config.json` 负责主配置，`beta-flags.json` 独立维护实验开关
- 🖊️ **原地编辑** — `config edit` 打开编辑器直接修改配置文件
- ♻️ **一键重置** — `config reset` 恢复出厂默认值

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                  CLI config 命令                     │
├──────────────────┬──────────────┬────────────────────┤
│  基础配置层       │  features 层  │  beta 层           │
│  config.json     │  功能开关      │  beta-flags.json   │
│  get/set/edit    │  enable/      │  enable/disable    │
│  list/reset      │  disable/list │  list              │
└────────┬─────────┴──────┬───────┴────────┬───────────┘
         │                │                │
         ▼                ▼                ▼
  ~/.chainlesschain/  feature-flags    session-core
    config.json         (in-memory)   BetaFlags API
```

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

## 配置参考

### config.json 结构

```js
// ~/.chainlesschain/config.json
{
  "llm": {
    "provider": "ollama",          // 活跃 LLM 提供商: ollama | anthropic | openai | custom
    "model": "qwen2:7b",           // 默认模型
    "baseUrl": "http://localhost:11434",
    "apiKey": ""                   // 云端提供商 API Key
  },
  "db": {
    "path": "~/.chainlesschain/chainlesschain.db",
    "encryptionKey": ""            // 留空则不加密
  },
  "p2p": {
    "enabled": false,
    "signalingServer": "wss://signaling.chainlesschain.io:9001"
  },
  "agent": {
    "approvalPolicy": "strict",    // 全局默认: strict | trusted | autopilot
    "recallLimit": 5,              // 启动时注入记忆条数
    "parkOnExit": true             // 退出时自动 park 会话
  }
}
```

### beta-flags.json 结构

```js
// ~/.chainlesschain/beta-flags.json
{
  "enabled": [
    "managed-agents-2026-04-15",
    "idle-park-2026-05-01"
  ],
  "known": [
    "managed-agents-2026-04-15",
    "idle-park-2026-05-01",
    "stream-router-2026-06-01"
  ]
}
```

### 环境变量覆盖

```bash
# 覆盖 LLM 提供商（优先级高于 config.json）
OLLAMA_HOST=http://localhost:11434
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# 覆盖数据库路径
CHAINLESSCHAIN_DB_PATH=/custom/path/chainlesschain.db

# 覆盖配置目录
CHAINLESSCHAIN_CONFIG_DIR=/custom/config/dir
```

## 性能指标

| 操作 | 典型延迟 | 说明 |
|------|----------|------|
| `config list` | < 10ms | 读取本地 JSON 文件 |
| `config get <key>` | < 5ms | 点分路径解析 |
| `config set <key> <val>` | < 15ms | 写入并同步到磁盘 |
| `config edit` | 取决于编辑器 | 打开系统默认编辑器 |
| `config reset` | < 20ms | 覆写为默认模板 |
| `config beta list` | < 10ms | 读取 beta-flags.json |
| `config beta enable <flag>` | < 15ms | 追加并持久化 |
| `config beta disable <flag>` | < 15ms | 移除并持久化 |

## 安全考虑

### 1. API Key 保护

`config.json` 以明文存储 API Key，建议：

```bash
# 优先使用环境变量而非写入 config.json
export ANTHROPIC_API_KEY=sk-ant-...

# 查看当前是否已在 config.json 中明文存储
chainlesschain config get llm.apiKey
```

文件权限应限制为仅当前用户可读：

```bash
# Linux / macOS
chmod 600 ~/.chainlesschain/config.json
```

### 2. Beta Flag 命名约定

Beta Flag 格式 `<feature>-<YYYY-MM-DD>` 中的日期是版本标识符，不是到期时间。禁用不再需要的 flag 可以减少攻击面：

```bash
chainlesschain config beta disable old-feature-2025-01-01
```

### 3. 配置目录权限

```bash
# 确认配置目录只有当前用户可写
ls -la ~/.chainlesschain/
# 预期: drwx------ (700)
```

## 故障排查

**Q: `config get` 返回 `undefined`，但我确实设置了该键**

A: 检查键名的大小写和层级分隔符是否正确。`llm.provider` 与 `LLM.Provider` 不等同。可用 `config list` 查看完整键结构：

```bash
chainlesschain config list
```

**Q: `config edit` 打开后保存，但重新 `config list` 看不到变化**

A: 编辑器保存的是临时副本。确保编辑器写入了原始路径而非交换文件。也可直接用 `config set` 覆盖：

```bash
chainlesschain config set llm.model qwen2:7b
```

**Q: `config beta enable` 后，功能仍然没有变化**

A: Beta Flag 只是开关，功能本身需要代码路径支持。部分 Beta Flag 仅完成底层能力，还未默认接入主运行路径。查看文档说明该 flag 对应的功能状态。

**Q: `config reset` 后 beta-flags.json 是否也会被清空？**

A: 不会。`config reset` 仅重置 `config.json`，`beta-flags.json` 独立管理，需用 `config beta disable` 逐条清除。

**Q: 多用户/多项目环境下如何隔离配置？**

A: 通过 `CHAINLESSCHAIN_CONFIG_DIR` 环境变量指向不同目录，实现多套配置隔离：

```bash
CHAINLESSCHAIN_CONFIG_DIR=./project-a/.chainlesschain chainlesschain config list
```

## 使用示例

```bash
# 查看全部配置
chainlesschain config list

# 切换 LLM 提供商到 Anthropic
chainlesschain config set llm.provider anthropic
chainlesschain config set llm.model claude-sonnet-4-6

# 切换回本地 Ollama
chainlesschain config set llm.provider ollama
chainlesschain config set llm.model qwen2:7b

# 以 JSON 格式读取特定值（用于脚本）
chainlesschain config get llm.provider --json

# 开启实验性 idle-park 特性
chainlesschain config beta enable idle-park-2026-05-01

# 查看所有 beta 开关状态
chainlesschain config beta list --json

# 在 CI 中禁用某个实验特性
chainlesschain config beta disable stream-router-2026-06-01

# 开启通用功能开关
chainlesschain config features enable CONTEXT_SNIP

# 直接编辑配置文件（适合批量修改）
chainlesschain config edit

# 重置配置到出厂默认
chainlesschain config reset
```

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
