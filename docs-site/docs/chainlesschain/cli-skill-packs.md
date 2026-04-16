# CLI 指令技能包系统

> **v5.0.1.9 新增** — 将 62 个 CLI 指令按功能域自动封装为 **9 个 Agent 可调用技能包**，实现 Agent 对 CLI 指令的结构化感知与智能调用。

## 概述

CLI 指令技能包系统将 ChainlessChain 的 63 条 CLI 指令按功能域分组，自动生成 9 个 Agent 可调用的技能包。每个技能包包含 SKILL.md 元数据和 handler.js 执行处理器，部署到 workspace 技能层（`~/.chainlesschain/skills/`），使 Agent REPL 能够通过 `run_skill` 工具结构化地调用 CLI 指令。

与 [CLI-Anything 集成](./cli-cli-anything)（注册外部第三方工具）不同，技能包系统专门包装 ChainlessChain 自身的 CLI 指令，区分四种执行模式（direct/llm-query/agent/hybrid），确保 Agent 不会盲目调用交互式指令。

## 核心特性

- 9 个域技能包，覆盖 63 条 CLI 指令，按功能域分组
- 执行模式区分: `direct` / `llm-query` / `agent` / `hybrid` 四种模式明确标注，Agent 不再盲目调用
- 自动同步机制: SHA-256 哈希检测指令集变化，只更新有变化的包
- postinstall 自动触发: `npm install -g chainlesschain` 后自动生成技能包，开箱即用
- 三种 Handler 模板: DirectHandler / AgentHandler / HybridHandler 自动生成
- 101 个测试: 57 单元 + 21 集成 + 23 E2E，全部通过

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

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  schema.js                    generator.js                          │
│  ──────────                   ────────────                          │
│  CLI_PACK_DOMAINS (9 域)  →   generateCliPacks()                    │
│  ├─ cli-knowledge-pack        ├─ computePackHash() 计算版本哈希      │
│  ├─ cli-identity-pack         ├─ readExistingHash() 读取已有哈希     │
│  ├─ cli-infra-pack            ├─ generateSkillMd() 生成 SKILL.md    │
│  ├─ cli-ai-query-pack         └─ generate*Handler() 生成 handler.js │
│  ├─ cli-agent-mode-pack           ├─ DirectHandler (spawnSync)      │
│  ├─ cli-web3-pack                 ├─ AgentHandler (返回使用说明)     │
│  ├─ cli-security-pack             └─ HybridHandler (混合路由)       │
│  ├─ cli-enterprise-pack                    │                        │
│  └─ cli-integration-pack                   ▼                        │
│                               ~/.chainlesschain/skills/cli-*-pack/  │
│                               (workspace 技能层)                     │
│                                            │                        │
│                                            ▼                        │
│                               skill-loader 自动加载 → Agent REPL    │
└─────────────────────────────────────────────────────────────────────┘
```

**数据流**: `schema.js` 定义 9 个域 (指令分组 + 执行模式) → `generator.js` 逐域计算 SHA-256 哈希，比对已有文件 → 变化时生成 SKILL.md + handler.js → 写入 workspace 层技能目录 → `skill-loader` 在 Agent 会话启动时自动加载

**哈希算法**: `SHA-256(PACK_SCHEMA_VERSION | CLI版本 | 域Key | 排序后指令列表)[0:16]`，任一因子变化即触发重新生成。

## 配置参考

```bash
# CLI 命令选项
chainlesschain skill sync-cli [options]
  --force              # 强制重新生成所有包，忽略哈希比对
  --dry-run            # 预览变化，不写入文件
  --remove             # 删除所有已生成的 CLI 技能包
  --json               # JSON 格式输出（供脚本解析）

chainlesschain skill list --category <cat>
  cli-direct           # 仅列出 CLI 直接执行包
  cli-agent            # 仅列出 CLI Agent 模式包

chainlesschain skill run <pack-name> "<cli-args>"

# 环境变量
CC_SKILL_PACKS_DIR=~/.chainlesschain/skills   # 覆盖默认 managed 层路径
CC_SKILL_PACKS_SCHEMA_VERSION                  # 覆盖 PACK_SCHEMA_VERSION (开发调试)

# 生成位置
~/.chainlesschain/skills/cli-*-pack/
├── SKILL.md           # 元数据 + 执行模式 + 哈希
└── handler.js         # 执行处理器 (Direct / Agent / Hybrid)

# 自动化触发
# package.json scripts.postinstall → 全局安装完成后自动生成
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| sync-cli 全量生成 (9 域) | < 2s | ~850ms | ✅ |
| 单域哈希比对 | < 50ms | ~15ms | ✅ |
| 单指令执行 (spawnSync) | < 500ms | ~230ms (短命令) | ✅ |
| 技能加载 (启动扫描) | < 300ms | ~180ms (9 包) | ✅ |
| dry-run 差异检测 | < 1s | ~400ms | ✅ |

## 故障排查

### sync-cli 命令无输出或报错

```bash
# 确认 CLI 已全局安装
chainlesschain --version

# 强制重新生成所有包
chainlesschain skill sync-cli --force

# 预览变化（不写入文件）
chainlesschain skill sync-cli --dry-run
```

### 包哈希不匹配导致反复重新生成

哈希基于 `PACK_SCHEMA_VERSION`、CLI `package.json` 中的 `version` 字段和域指令列表三个维度。如果 CLI 版本频繁变化（如本地开发中），每次 sync 都会检测到变化并重新生成。

```bash
# 查看当前哈希状态
chainlesschain skill sync-cli --dry-run --json
```

### handler 执行报错 "指令不在此技能包中"

输入的第一个词必须匹配该包定义的指令名。检查 `schema.js` 中对应域的 `commands` 字段确认支持的指令列表。

```bash
# 正确: 第一个词是指令名
chainlesschain skill run cli-knowledge-pack "note list"

# 错误: 多余前缀
chainlesschain skill run cli-knowledge-pack "chainlesschain note list"
```

### Agent 模式指令静默失败

`chat` 和 `agent` 等交互式 REPL 指令无法通过 `spawnSync` 子进程调用。`cli-agent-mode-pack` 的 handler 会返回结构化使用说明而非执行指令，这是设计预期行为。

### postinstall 未自动触发

确认 `packages/cli/package.json` 的 `scripts.postinstall` 配置正确，且全局安装时 npm 有权限写入技能目录。

## 测试覆盖率

```
packages/cli/__tests__/unit/
├── ✅ skill-packs-schema.test.js       # 9 域定义校验 + 版本哈希
├── ✅ skill-packs-generator.test.js    # SKILL.md / handler.js 生成器
├── ✅ skill-packs-handler.test.js      # Direct/Agent/Hybrid 三种 handler 模板
└── ✅ skill-sync-cli.test.js           # sync-cli 命令 + dry-run / remove
```

- **域定义**: 9 个 CLI_PACK_DOMAINS 覆盖 knowledge / identity / infra / ai / web3 / security 等
- **哈希比对**: SCHEMA_VERSION / CLI version / commands list 三维度变化检测
- **生成模板**: Direct 直接 spawnSync、Agent 返回说明、Hybrid 双模式
- **CLI 命令**: sync-cli 的 force / dry-run / remove / json 路径全覆盖

## 安全考虑

- **同权限执行**: 技能包通过 `spawnSync("chainlesschain", args)` 调用 CLI 子进程，以当前用户权限运行，无特权提升
- **指令白名单**: 每个 handler.js 内置 `VALID_COMMANDS` Set，只允许该域定义的指令通过，输入的第一个词必须匹配白名单
- **Shell 注入防护**: 输入通过自定义 tokenizer 解析（处理单引号/双引号），拆分为参数数组后传给 `spawnSync`，不进行 shell 字符串拼接
- **超时保护**: 所有子进程设置 30 秒超时 (`timeout: 30000`)
- **无远程代码执行**: 技能包仅包装本地 CLI 指令，不涉及远程服务器调用或代码下载
- **可审计**: 生成的 handler.js 包含 "自动生成 -- 请勿手动修改" 注释，所有生成/删除操作可通过 `sync-cli --dry-run` 预览

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/skill-packs/schema.js` | 9 域定义（`CLI_PACK_DOMAINS`）、执行模式说明、Agent 模式指令集、schema 版本 |
| `packages/cli/src/lib/skill-packs/generator.js` | 包生成器（哈希计算、SKILL.md 生成、三种 handler 模板、批量生成/检查/删除） |
| `packages/cli/src/commands/skill.js` | `sync-cli` 子命令注册入口 |
| `~/.chainlesschain/skills/cli-*-pack/SKILL.md` | 生成的技能元数据（含 `execution-mode`、`cli-version-hash` 扩展字段） |
| `~/.chainlesschain/skills/cli-*-pack/handler.js` | 生成的执行处理器（CJS，DirectHandler/AgentHandler/HybridHandler 三种模板） |

## 使用示例

```bash
# 首次生成 / 同步所有包
chainlesschain skill sync-cli

# 预览变化（不写入文件）
chainlesschain skill sync-cli --dry-run --json

# 强制重新生成
chainlesschain skill sync-cli --force

# 清理所有已生成包
chainlesschain skill sync-cli --remove

# 列出所有 CLI 技能包
chainlesschain skill list --category cli-direct

# 在 Agent 会话中通过技能包调用 CLI
chainlesschain skill run cli-knowledge-pack "note list"
chainlesschain skill run cli-identity-pack "did create"
chainlesschain skill run cli-infra-pack "doctor"
chainlesschain skill run cli-ai-query-pack "ask 什么是 DID？"
chainlesschain skill run cli-web3-pack "wallet assets"
chainlesschain skill run cli-security-pack "compliance report gdpr"

# Agent 模式技能包返回使用说明（不实际执行）
chainlesschain skill run cli-agent-mode-pack "agent --provider ollama"

# 在 Agent 对话中让 LLM 自动发现并调用
chainlesschain agent
> 列出我最近的笔记   # LLM 会选 cli-knowledge-pack 执行 note list
```

## 相关文档

- [技能系统](./cli-skill) — 完整技能命令参考，包括 `sync-cli` 子命令
- [CLI-Anything 集成](./cli-cli-anything) — 注册外部第三方 CLI 工具为技能（不同于技能包系统）
- [代理模式](./cli-agent) — 在 Agent 对话中使用技能包
- [设计文档：CLI 指令技能包系统](../design/modules/60b-cli-skill-packs) — 完整技术设计
