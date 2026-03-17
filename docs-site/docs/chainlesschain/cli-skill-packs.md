# CLI 指令技能包系统

> **v5.0.1.9 新增** — 将 62 个 CLI 指令按功能域自动封装为 **9 个 Agent 可调用技能包**，实现 Agent 对 CLI 指令的结构化感知与智能调用。

## 核心特性

- 🤖 **9 个域技能包**: 覆盖 62 条 CLI 指令，按功能域分组
- 🔀 **执行模式区分**: `direct` / `llm-query` / `agent` / `hybrid` 四种模式明确标注，Agent 不再盲目调用
- 🔄 **自动同步机制**: SHA-256 哈希检测指令集变化，只更新有变化的包
- 📦 **postinstall 自动触发**: `npm install -g chainlesschain` 后自动生成技能包，开箱即用
- 🏗️ **三种 Handler 模板**: DirectHandler / AgentHandler / HybridHandler 自动生成
- ✅ **101 个测试**: 57 单元 + 21 集成 + 23 E2E，全部通过

## 快速开始

```bash
# 生成/同步所有 CLI 技能包
chainlesschain skill sync-cli

# 查看生成的技能包
chainlesschain skill list --category cli-direct

# Agent 调用示例
chainlesschain skill run cli-knowledge-pack "note list"
chainlesschain skill run cli-identity-pack "did create"
chainlesschain skill run cli-infra-pack "status"
```

## 9 个域技能包

| 技能包 ID | 显示名 | 执行模式 | 指令数 | 覆盖指令 |
|-----------|--------|----------|--------|---------|
| `cli-knowledge-pack` | 知识管理技能包 | `direct` | 8 | note, search, import, export, git, tokens, memory, session |
| `cli-identity-pack` | 身份安全技能包 | `direct` | 5 | did, encrypt, decrypt, auth, audit |
| `cli-infra-pack` | 基础设施技能包 | `direct` | 9 | setup, start, stop, status, services, config, update, doctor, db |
| `cli-ai-query-pack` | AI查询技能包 | `llm-query` | 4 | ask, llm, instinct, cowork |
| `cli-agent-mode-pack` | Agent模式技能包 | `agent` | 2 | chat, agent |
| `cli-web3-pack` | Web3与社交技能包 | `direct` | 9 | p2p, sync, wallet, org, dao, economy, nostr, matrix, social |
| `cli-security-pack` | 安全合规技能包 | `direct` | 7 | compliance, dlp, siem, pqc, zkp, sandbox, hardening |
| `cli-enterprise-pack` | 企业级技能包 | `direct` | 8 | bi, lowcode, terraform, scim, hook, workflow, a2a, hmemory |
| `cli-integration-pack` | 集成扩展技能包 | `hybrid` | 9 | mcp, browse, plugin, cli-anything, evomap, serve, evolution, init, persona |

**合计**: 9 个包，覆盖 61 条核心指令

## 执行模式说明

| 模式 | 标识 | 行为 | 适用场景 |
|------|------|------|---------|
| **直接执行** | `direct` | `spawnSync` 调用 CLI 子进程，返回 JSON 结果 | 绝大多数指令，无需 LLM |
| **LLM 查询** | `llm-query` | 单次非交互式 LLM 调用 | ask、llm 等 AI 查询指令 |
| **Agent 模式** | `agent` | 不执行！返回如何在终端运行的使用说明 | chat、agent 等交互式 REPL |
| **混合模式** | `hybrid` | 大部分直接执行，少量指令路由到 Agent 模式 | 集成扩展包 |

### 为什么 Agent 模式包不直接执行？

`chat` 和 `agent` 等交互式指令通过 `spawnSync` 调用会立即返回（子进程不是终端，REPL 无法启动）。技能包返回结构化使用说明，让上层 Agent 通知用户手动运行，而不是静默失败。

```json
// Agent 调用 cli-agent-mode-pack 的返回结果
{
  "success": true,
  "executionMode": "agent",
  "result": {
    "howToRun": "chainlesschain agent --provider ollama",
    "note": "此指令需要交互式终端，请直接在终端中运行"
  }
}
```

## sync-cli 命令参考

```bash
chainlesschain skill sync-cli              # 检测哈希变化，只更新变化的包
chainlesschain skill sync-cli --force      # 强制全量重新生成（9 个包）
chainlesschain skill sync-cli --dry-run    # 预览变化，不写文件
chainlesschain skill sync-cli --remove     # 删除所有 CLI 技能包
chainlesschain skill sync-cli --json       # JSON 格式输出结果
chainlesschain skill sync-cli --output <dir>  # 指定输出目录
```

### 哈希检测机制

技能包版本哈希基于以下三个维度计算（SHA-256 前 16 位）：

```
版本哈希 = SHA-256(schema版本 | CLI版本号 | 域Key | 指令列表)[0:16]
```

当以下任一变化时，哈希失效并触发重新生成：
- Schema 版本升级
- CLI `package.json` 的 `version` 字段变化
- 域定义中的指令列表变化（新增/删除指令）

## Agent 调用示例

### 发现技能包

```bash
# 列出所有 CLI 直接执行技能包
chainlesschain skill list --category cli-direct

# 列出所有 CLI Agent 技能包（需终端交互）
chainlesschain skill list --category cli-agent
```

### 直接执行 CLI 指令

```bash
# 笔记管理
chainlesschain skill run cli-knowledge-pack "note list"
chainlesschain skill run cli-knowledge-pack "note search AI"
chainlesschain skill run cli-knowledge-pack "search keyword"

# 身份与安全
chainlesschain skill run cli-identity-pack "did create"
chainlesschain skill run cli-identity-pack "did list"
chainlesschain skill run cli-identity-pack "audit log"

# 基础设施
chainlesschain skill run cli-infra-pack "status"
chainlesschain skill run cli-infra-pack "doctor"
chainlesschain skill run cli-infra-pack "db info"

# AI 查询
chainlesschain skill run cli-ai-query-pack "ask 什么是 DID？"
chainlesschain skill run cli-ai-query-pack "instinct show"

# Web3 与区块链
chainlesschain skill run cli-web3-pack "wallet assets"
chainlesschain skill run cli-web3-pack "dao stats"

# 安全合规
chainlesschain skill run cli-security-pack "compliance report gdpr"
chainlesschain skill run cli-security-pack "dlp incidents"
```

### 处理 Agent 模式返回

当调用 `cli-agent-mode-pack` 时，技能包不会执行交互式命令，而是返回使用说明：

```bash
chainlesschain skill run cli-agent-mode-pack "agent --provider ollama"
```

返回：
```json
{
  "success": true,
  "executionMode": "agent",
  "result": {
    "howToRun": "chainlesschain agent --provider ollama",
    "note": "此指令需要交互式终端，请直接在终端中运行"
  }
}
```

## 技能包文件结构

生成的技能包写入 managed 层（默认 `~/.chainlesschain/skills/`）：

```
~/.chainlesschain/skills/
├── cli-knowledge-pack/
│   ├── SKILL.md     # 元数据 (含 execution-mode, cli-domain, cli-version-hash)
│   └── handler.js   # direct 执行器
├── cli-agent-mode-pack/
│   ├── SKILL.md
│   └── handler.js   # agent 使用说明返回器
├── cli-integration-pack/
│   ├── SKILL.md
│   └── handler.js   # hybrid 混合路由器
└── ...（共 9 个）
```

### SKILL.md 扩展字段

```yaml
---
name: cli-knowledge-pack
display-name: 知识管理技能包
description: 笔记增删改查、全文混合搜索...
version: 1.0.0
category: cli-direct          # cli-direct | cli-agent
execution-mode: direct        # direct | llm-query | agent | hybrid
cli-domain: knowledge         # 所属域名称
cli-version-hash: "ec00e811"  # SHA-256 前 16 位，用于 sync 检测
tags: [note, search, ...]
user-invocable: true
handler: handler.js
---
```

## 相关文档

- [技能系统](./cli-skill) — 完整技能命令参考，包括 `sync-cli` 子命令
- [代理模式](./cli-agent) — 在 Agent 对话中使用技能包
- [设计文档：CLI 指令技能包系统](../design/modules/60b-cli-skill-packs) — 完整技术设计
