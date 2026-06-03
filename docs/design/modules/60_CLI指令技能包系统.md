# CLI 指令技能包系统

## 模块概述

**版本**: v1.0.0
**状态**: ✅ 已实现
**最后更新**: 2026-03-17

CLI 指令技能包系统将 62 个 CLI 指令按功能域自动封装为 **9 个 Agent 可调用技能包**，实现指令的结构化感知、模式区分（直接执行 vs Agent 模式）、以及当指令集更新时的自动同步。

### 核心特性

- **9 个域技能包**: 覆盖 62 条 CLI 指令，按功能域分组
- **执行模式区分**: `direct` / `llm-query` / `agent` / `hybrid` 四种模式明确标注
- **自动生成与同步**: `skill sync-cli` 命令自动生成/更新技能包，SHA-256 哈希检测变化
- **四层架构集成**: 生成的技能包写入 managed 层（全局）或 workspace 层（项目）
- **Agent 友好调用**: 通过 `run_skill` 工具直接调用，无需手动拼接命令
- **101 个新增测试**: 57 单元 + 21 集成 + 23 E2E，全部通过

---

## 1. 架构设计

### 1.1 整体架构图

```
┌────────────────────────────────────────────────────────────────┐
│                    62 个 CLI 指令文件                           │
│  src/commands/note.js  did.js  agent.js  chat.js  ...         │
└────────────────────┬───────────────────────────────────────────┘
                     │ 解析 (import 检测 + Commander 元数据)
                     ▼
┌────────────────────────────────────────────────────────────────┐
│           skill-packs/schema.js — 域定义 (9个域)               │
│  CLI_PACK_DOMAINS: { commands, executionMode, category, ... }  │
└────────────────────┬───────────────────────────────────────────┘
                     │ 生成
                     ▼
┌────────────────────────────────────────────────────────────────┐
│           skill-packs/generator.js — 自动生成器                │
│  generateCliPacks()  checkForUpdates()  removeCliPacks()       │
│  生成: SKILL.md (YAML元数据) + handler.js (执行逻辑)           │
└────────────────────┬───────────────────────────────────────────┘
                     │ 写入 (workspace 或 managed 层)
                     ▼
┌────────────────────────────────────────────────────────────────┐
│         .chainlesschain/skills/cli-*-pack/                     │
│                或 <userData>/skills/cli-*-pack/                │
│  ├── SKILL.md   (元数据: execution-mode, cli-domain, hash)     │
│  └── handler.js (direct/agent/hybrid 三种执行器模板)           │
└────────────────────┬───────────────────────────────────────────┘
                     │ 读取 (CLISkillLoader 四层加载)
                     ▼
┌────────────────────────────────────────────────────────────────┐
│              Agent (agent-core.js AGENT_TOOLS)                 │
│  run_skill("cli-knowledge-pack", "note list")                  │
│  list_skills(category="cli-direct")                            │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 执行模式分类

| 执行模式 | 标识 | 说明 | 技能包 |
|---------|------|------|--------|
| **直接执行** | `direct` | `spawnSync` 调用 CLI 子进程，无需 LLM | 知识/身份/基础设施/Web3/安全/企业 |
| **LLM 查询** | `llm-query` | 单次非交互式 LLM 调用 | AI查询包 |
| **Agent 模式** | `agent` | 需交互式 REPL，handler 返回使用说明 | Agent模式包 |
| **混合模式** | `hybrid` | 大部分直接执行，少量指令 Agent 路由 | 集成扩展包 |

```
direct:    chainlesschain note list     → spawnSync(['note','list'])
llm-query: chainlesschain ask "问题"   → spawnSync(['ask','问题'])
agent:     chainlesschain agent         → 返回使用说明 (不执行)
hybrid:    chainlesschain serve         → spawnSync(['serve','--quiet'])
           chainlesschain chat          → 返回使用说明 (不执行)
```

---

## 2. 9 个域技能包

### 2.1 技能包总览

| 技能包 ID | 显示名 | 执行模式 | 指令数 | 类别 |
|-----------|--------|----------|--------|------|
| `cli-knowledge-pack` | 知识管理技能包 | direct | 8 | cli-direct |
| `cli-identity-pack` | 身份安全技能包 | direct | 5 | cli-direct |
| `cli-infra-pack` | 基础设施技能包 | direct | 9 | cli-direct |
| `cli-ai-query-pack` | AI查询技能包 | llm-query | 4 | cli-direct |
| `cli-agent-mode-pack` | Agent模式技能包 | agent | 2 | cli-agent |
| `cli-web3-pack` | Web3与社交技能包 | direct | 9 | cli-direct |
| `cli-security-pack` | 安全合规技能包 | direct | 7 | cli-direct |
| `cli-enterprise-pack` | 企业级技能包 | direct | 8 | cli-direct |
| `cli-integration-pack` | 集成扩展技能包 | hybrid | 9 | cli-direct |

**合计**: 9 个包，覆盖 62 条 CLI 指令中的 61 条核心指令

### 2.2 各包指令清单

#### cli-knowledge-pack
`note`, `search`, `import`, `export`, `git`, `tokens`, `memory`, `session`

#### cli-identity-pack
`did`, `encrypt`, `decrypt`, `auth`, `audit`

#### cli-infra-pack
`setup`, `start`, `stop`, `status`, `services`, `config`, `update`, `doctor`, `db`

#### cli-ai-query-pack
`ask`, `llm`, `instinct`, `cowork`

#### cli-agent-mode-pack ⚠️ 需终端交互
`chat`, `agent` — *这些指令需要交互式 REPL，handler 不执行而是返回使用指南*

#### cli-web3-pack
`p2p`, `sync`, `wallet`, `org`, `dao`, `economy`, `nostr`, `matrix`, `social`

#### cli-security-pack
`compliance`, `dlp`, `siem`, `pqc`, `zkp`, `sandbox`, `hardening`

#### cli-enterprise-pack
`bi`, `lowcode`, `terraform`, `scim`, `hook`, `workflow`, `a2a`, `hmemory`

#### cli-integration-pack
`mcp`, `browse`, `plugin`, `cli-anything`, `evomap`, `serve`, `evolution`, `init`, `persona`

---

## 3. SKILL.md 扩展字段

CLI 技能包在标准 SKILL.md YAML frontmatter 上新增三个字段：

```yaml
---
name: cli-knowledge-pack
display-name: 知识管理技能包
description: 笔记增删改查、全文混合搜索...
version: 1.0.0
category: cli-direct          # cli-direct | cli-agent
execution-mode: direct        # NEW: direct | llm-query | agent | hybrid
cli-domain: knowledge         # NEW: 所属域名称
cli-version-hash: "ec00e811"  # NEW: SHA-256 前16位，用于 sync 检测
tags: [note, search, ...]
user-invocable: true
handler: handler.js
---
```

**skill-loader.js 对应字段** (camelCase 转换后):
- `skill.executionMode` — 执行模式
- `skill.cliDomain` — 所属域
- `skill.cliVersionHash` — 版本哈希

---

## 4. Handler 三种模板

### 4.1 Direct Handler (直接执行)

适用于：`cli-knowledge-pack`, `cli-identity-pack`, `cli-infra-pack`, `cli-web3-pack`, `cli-security-pack`, `cli-enterprise-pack`, `cli-ai-query-pack`

```javascript
const { spawnSync } = require("child_process");

const handler = {
  async execute(task, context, _skill) {
    const input = task.input || task.params?.input || "";
    const { args } = parseInput(input);  // shell-style tokenizer

    // 1. 校验指令归属此包
    if (!VALID_COMMANDS.has(args[0])) {
      return { success: false, error: `指令不在此技能包中` };
    }

    // 2. spawnSync 执行 (shell:true 跨平台)
    const result = spawnSync("chainlesschain", [...args, "--json"], {
      encoding: "utf-8", shell: true, timeout: 30000,
      cwd: context.projectRoot || process.cwd(),
    });

    // 3. 返回结构化结果 (尝试 JSON 解析)
    return { success: result.status === 0, result: parsedOrRaw };
  }
};
```

### 4.2 Agent Handler (使用说明)

适用于：`cli-agent-mode-pack`

```javascript
const handler = {
  async execute(task, _context, _skill) {
    // 不执行！返回如何在终端运行的说明
    return {
      success: true,
      executionMode: "agent",     // Agent 层读取此字段决策
      result: {
        howToRun: `chainlesschain agent --session <id>`,
        note: "此指令需要交互式终端，请直接在终端中运行",
      }
    };
  }
};
```

### 4.3 Hybrid Handler (混合路由)

适用于：`cli-integration-pack`

```javascript
const AGENT_ONLY_COMMANDS = new Set([/* 如有需要终端的指令 */]);

const handler = {
  async execute(task, context, _skill) {
    if (AGENT_ONLY_COMMANDS.has(command)) {
      return { success: true, executionMode: "agent", ... };
    }
    // 否则走 spawnSync 直接执行
    return directExecute(args, context);
  }
};
```

---

## 5. sync-cli 自动同步机制

### 5.1 哈希检测算法

```
版本哈希 = SHA-256(schema版本 | CLI版本号 | 域Key | 指令列表)[0:16]
```

当以下任一变化时，哈希失效并触发重新生成：
- `PACK_SCHEMA_VERSION`（schema 版本）
- CLI `package.json` 的 `version` 字段
- 域定义中的指令列表（新增/删除指令）

### 5.2 sync-cli 命令

```bash
chainlesschain skill sync-cli           # 检测哈希变化，只更新变化的包
chainlesschain skill sync-cli --force   # 强制全量重新生成（9个包）
chainlesschain skill sync-cli --dry-run # 预览变化，不写文件
chainlesschain skill sync-cli --remove  # 删除所有 CLI 技能包
chainlesschain skill sync-cli --json    # JSON 格式输出结果
chainlesschain skill sync-cli --output <dir>  # 指定输出目录
```

### 5.3 自动触发时机

| 触发时机 | 方式 |
|---------|------|
| `npm install -g chainlesschain` | `postinstall` 脚本自动运行 sync-cli |
| 手动版本升级 | 运行 `npm run sync-skill-packs` |
| 开发调试 | 直接运行 `chainlesschain skill sync-cli --force` |

### 5.4 sync-cli 输出示例

```
CLI Pack Sync Result:

  CLI version: 0.43.2  |  Output: /home/user/.config/.../.chainlesschain/skills

  Generated / Updated (9):
    + cli-knowledge-pack    [direct]    8 commands
    ↻ cli-identity-pack     [direct]    5 commands
    ...

  Skipped (0):

✓ 9 pack(s) generated, 0 skipped (9 total domains, outputDir: ...)

Run chainlesschain skill list --category cli-direct to see the packs.
```

---

## 6. Agent 调用示例

### 6.1 发现技能包

```
// Agent 调用 list_skills
[list_skills] category=cli-direct
→ 返回 9 个 cli-*-pack 技能，包含 description 和 executionMode
```

### 6.2 直接执行指令

```
// 用户: 帮我列出所有笔记并搜索关键词"AI"
[run_skill] cli-knowledge-pack, "note list"
→ { success: true, result: [...notes as JSON] }

[run_skill] cli-knowledge-pack, "note search AI"
→ { success: true, result: [匹配结果] }
```

### 6.3 处理 Agent 模式包

```
// 用户: 开始一个 agent 会话
[run_skill] cli-agent-mode-pack, "agent --provider ollama"
→ {
    success: true,
    executionMode: "agent",
    result: {
      howToRun: "chainlesschain agent --provider ollama",
      note: "此指令需要交互式终端，请直接在终端中运行"
    }
  }
// Agent 告知用户: "请在终端中运行: chainlesschain agent --provider ollama"
```

---

## 7. 文件结构

```
packages/cli/
├── src/lib/skill-packs/
│   ├── schema.js          # 9个域定义 + EXECUTION_MODE_DESCRIPTIONS + AGENT_MODE_COMMANDS
│   └── generator.js       # generateCliPacks / checkForUpdates / removeCliPacks / computePackHash
├── src/commands/skill.js  # 新增 sync-cli 子命令
├── src/lib/skill-loader.js # 扩展: executionMode / cliDomain / cliVersionHash 字段
└── __tests__/
    ├── unit/skill-packs/
    │   ├── generator.test.js              # 36 tests: hash/generateSkillMd/schema验证/生成流程
    │   └── skill-loader-cli-fields.test.js # 21 tests: 新字段解析/loader集成
    ├── integration/
    │   └── skill-packs-workflow.test.js   # 21 tests: generator→loader pipeline/handler执行
    └── e2e/
        └── skill-packs-commands.test.js   # 23 tests: sync-cli完整CLI命令流程

.chainlesschain/skills/         # 生成的技能包 (workspace 层)
├── cli-knowledge-pack/
│   ├── SKILL.md                # 元数据 (含 execution-mode, cli-domain, cli-version-hash)
│   └── handler.js              # direct 执行器
├── cli-agent-mode-pack/
│   ├── SKILL.md
│   └── handler.js              # agent 使用说明返回器
└── ...（共9个）
```

---

## 8. 测试覆盖

| 测试层 | 文件 | 测试数 | 覆盖内容 |
|--------|------|--------|---------|
| 单元 | `generator.test.js` | 36 | hash算法/SKILL.md生成/schema校验/生成/同步/删除 |
| 单元 | `skill-loader-cli-fields.test.js` | 21 | parseSkillMd新字段/loader集成/生成pack加载 |
| 集成 | `skill-packs-workflow.test.js` | 21 | generator→loader pipeline/handler执行/编码检测 |
| E2E | `skill-packs-commands.test.js` | 23 | sync-cli全命令流程/文件验证/JSON输出 |
| **合计** | | **101** | |

---

## 9. 设计决策

### 为什么用 workspace/managed 层而非 bundled 层？

CLI 技能包依赖 CLI 指令集定义，需要与 CLI 版本保持同步。放入 bundled 层（desktop-app-vue）会造成跨包耦合。workspace/managed 层可独立更新，且通过 `postinstall` 自动同步，保持松耦合。

### 为什么 Agent 模式包不直接执行？

`chat` 和 `agent` 等交互式指令通过 `spawnSync` 调用会立即返回（因为子进程不是终端，REPL 无法启动）。Agent handler 返回结构化使用说明，让上层 Agent 决策是通知用户手动执行还是通过其他方式处理，而不是静默失败。

### 为什么用哈希而非版本号比较？

哈希基于 `schema版本 + CLI版本 + 指令列表`，确保任意维度的变化都能被检测到。单纯比较版本号会漏掉"同版本内改了域定义"的情况。
