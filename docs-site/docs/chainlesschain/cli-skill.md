# 技能系统 (skill)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🎯 **138+ 内置技能**: 覆盖开发全流程
- 📂 **24 个分类**: 从代码审查到安全分析
- 🔍 **技能搜索**: 按关键词、标签、分类查找
- ▶️ **直接运行**: 命令行一键执行技能
- 📊 **JSON 输出**: 支持脚本集成
- 🏗️ **4 层优先级系统**: bundled < marketplace < managed < workspace，同名技能按优先级覆盖
- ➕ **自定义技能**: `skill add/remove` 创建项目级或全局级技能
- 📍 **技能来源追踪**: `skill sources` 显示各层路径和技能数量
- 🤖 **CLI 指令技能包**: `skill sync-cli` 将 62 个 CLI 指令封装为 9 个 Agent 可调用技能包（v5.0.1.9 新增）

## 系统架构

```
skill 命令 → skill.js (Commander) → CLISkillLoader (4层加载)
                                         │
           ┌─────────────┬──────────────┼──────────────┬─────────────┐
           ▼             ▼              ▼              ▼             ▼
     skill list     skill info     skill run     skill add      skill sources
           │             │              │         /remove              │
           ▼             ▼              ▼              ▼             ▼
    4层技能合并    技能元数据+文档  LLM + Prompt  脚手架生成     层路径信息
    (按优先级覆盖)                  执行并返回     SKILL.md +
                                                  handler.js

    优先级: workspace(3) > managed(2) > marketplace(1) > bundled(0)
```

## 概述

管理和运行 138+ 个 AI 技能，支持 4 层优先级系统和自定义技能管理。涵盖代码审查、文档生成、测试、安全分析等 24 个分类。

## 命令参考

```bash
# 查看与搜索
chainlesschain skill list               # 按分类列出所有技能（含来源层标签）
chainlesschain skill list --category automation
chainlesschain skill list --tag code --runnable
chainlesschain skill list --json        # JSON格式输出（含 source 字段）
chainlesschain skill list --source bundled  # 按来源层过滤
chainlesschain skill categories         # 查看分类统计
chainlesschain skill info code-review   # 查看技能详情+文档
chainlesschain skill info code-review --json
chainlesschain skill search "browser"   # 按关键词搜索
chainlesschain skill run code-review "Review this code..."

# 自定义技能管理
chainlesschain skill add my-skill       # 创建项目级自定义技能
chainlesschain skill add my-skill --global  # 创建全局自定义技能
chainlesschain skill remove my-skill    # 删除项目级技能
chainlesschain skill remove my-skill --global --force  # 强制删除全局技能

# 技能来源层
chainlesschain skill sources            # 显示各层路径和技能数量
chainlesschain skill sources --json     # JSON 格式输出

# CLI 指令技能包（v5.0.1.9 新增）
chainlesschain skill sync-cli           # 检测变化并同步 9 个 CLI 技能包
chainlesschain skill sync-cli --force   # 强制全量重新生成
chainlesschain skill sync-cli --dry-run # 预览变化，不写文件
chainlesschain skill sync-cli --remove  # 删除所有 CLI 技能包
chainlesschain skill sync-cli --json    # JSON 格式输出结果
chainlesschain skill sync-cli --output <dir>  # 指定输出目录
```

## 子命令说明

### list

按分类列出所有技能，支持筛选。

```bash
chainlesschain skill list                       # 全部技能
chainlesschain skill list --category automation  # 按分类筛选
chainlesschain skill list --tag code --runnable  # 按标签筛选，仅显示可运行的
chainlesschain skill list --json                 # JSON格式输出
```

### categories

查看技能分类统计。

```bash
chainlesschain skill categories
```

### info

查看指定技能的详细信息和文档。

```bash
chainlesschain skill info code-review
chainlesschain skill info code-review --json
```

### search

按关键词搜索技能。

```bash
chainlesschain skill search "browser"
chainlesschain skill search "security"
```

### run

直接运行指定技能。

```bash
chainlesschain skill run code-review "Review this code..."
chainlesschain skill run summarize "Summarize this article..."
```

### add

在项目或全局创建自定义技能脚手架。

```bash
chainlesschain skill add my-analysis          # 项目级（.chainlesschain/skills/）
chainlesschain skill add my-global --global   # 全局级（<userData>/skills/）
```

生成目录结构：

```
.chainlesschain/skills/my-analysis/
├── SKILL.md      # YAML 前置 + Markdown 文档
└── handler.js    # 技能处理器
```

### remove

删除自定义技能。

```bash
chainlesschain skill remove my-analysis                # 项目级
chainlesschain skill remove my-global --global --force # 全局级（--force 跳过确认）
```

### sources

显示 4 层技能来源路径和每层的技能数量。

```bash
chainlesschain skill sources          # 表格输出
chainlesschain skill sources --json   # JSON 输出
```

输出示例：

```
  Skill Source Layers

  Layer         Path                                      Exists  Count
  bundled       .../skills/builtin/                      ✓       138
  marketplace   ~/.chainlesschain/marketplace/skills/     ✗       0
  managed       ~/.chainlesschain/skills/                 ✓       9
  workspace     .chainlesschain/skills/                   ✓       2
```

### sync-cli ⭐ v5.0.1.9

将 62 个 CLI 指令按功能域自动封装为 9 个 Agent 可调用技能包，写入 managed 层（全局）或 workspace 层（项目）。

```bash
chainlesschain skill sync-cli              # 检测哈希变化，只更新变化的包
chainlesschain skill sync-cli --force      # 强制全量重新生成（9 个包）
chainlesschain skill sync-cli --dry-run    # 预览变化，不写文件
chainlesschain skill sync-cli --remove     # 删除所有 CLI 技能包
chainlesschain skill sync-cli --json       # JSON 格式输出结果
chainlesschain skill sync-cli --output <dir>  # 指定输出目录（默认 managed 层）
```

输出示例：

```
CLI Pack Sync Result:

  CLI version: 0.43.2  |  Output: ~/.chainlesschain/skills

  Generated / Updated (9):
    + cli-knowledge-pack    [direct]      8 commands
    + cli-identity-pack     [direct]      5 commands
    + cli-infra-pack        [direct]      9 commands
    + cli-ai-query-pack     [llm-query]   4 commands
    + cli-agent-mode-pack   [agent]       2 commands
    + cli-web3-pack         [direct]      9 commands
    + cli-security-pack     [direct]      7 commands
    + cli-enterprise-pack   [direct]      8 commands
    + cli-integration-pack  [hybrid]      9 commands

  Skipped (0):

✓ 9 pack(s) generated, 0 skipped (9 total domains)

Run chainlesschain skill list --category cli-direct to see the packs.
```

技能包安装后可通过 Agent 直接调用：

```bash
chainlesschain skill run cli-knowledge-pack "note list"    # 列出所有笔记
chainlesschain skill run cli-identity-pack "did create"    # 创建 DID 身份
chainlesschain skill run cli-infra-pack "status"           # 查看系统状态
```

> **自动触发**: `npm install -g chainlesschain` 的 `postinstall` 脚本会自动运行 `sync-cli`，开箱即用。
>
> **详细文档**: 参见 [CLI 指令技能包系统](./cli-skill-packs)

## 4 层优先级系统

| 层 | 优先级 | 路径 | 用途 |
|---|--------|------|------|
| bundled | 0 (最低) | `desktop-app-vue/.../skills/builtin/` | 138 内置技能 |
| marketplace | 1 | `<userData>/marketplace/skills/` | 插件安装的技能 |
| managed | 2 | `<userData>/skills/` | 用户全局自定义技能 |
| workspace | 3 (最高) | `<projectRoot>/.chainlesschain/skills/` | 项目级自定义技能 |

同名技能按优先级覆盖：workspace > managed > marketplace > bundled。

## 技能分类（24类）

ai, analysis, automation, code-review, data, database, debugging, design, development (41个), devops, document, documentation, general, knowledge, learning, media, productivity, quality, remote, security, system, testing, utility, workflow

## 配置参考

```bash
# CLI 标志
--category <name>      # 按分类过滤 (skill list)
--tag <tag>            # 按标签过滤 (skill list)
--runnable             # 仅显示可运行的技能 (skill list)
--source <layer>       # 按来源层过滤：bundled/marketplace/managed/workspace
--global               # 操作全局技能层（skill add/remove）
--force                # 强制删除（skill remove）
--json                 # JSON 格式输出
--force                # 强制全量重新生成 (skill sync-cli)
--dry-run              # 预览变化，不写文件 (skill sync-cli)
--remove               # 删除所有 CLI 技能包 (skill sync-cli)
--output <dir>         # 自定义输出目录 (skill sync-cli)

# 四层技能路径
# bundled:     desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/
# marketplace: <userData>/marketplace/skills/
# managed:     <userData>/skills/
# workspace:   <projectRoot>/.chainlesschain/skills/
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| skill list (138 技能) | < 200ms | ~100ms | ✅ |
| skill info (带文档) | < 50ms | ~20ms | ✅ |
| skill search (关键词) | < 80ms | ~40ms | ✅ |
| skill add (脚手架) | < 100ms | ~50ms | ✅ |
| skill sync-cli (增量) | < 2s | ~800ms | ✅ |
| skill sync-cli (--force 全量) | < 5s | ~2.5s | ✅ |

## 测试覆盖率

```
✅ skill.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/skill.js` — 命令实现（含 add/remove/sources）
- `packages/cli/src/lib/skill-loader.js` — 多层技能加载器（CLISkillLoader）
- `packages/cli/src/repl/agent-repl.js` — 技能运行引擎（使用 CLISkillLoader）
- `desktop-app-vue/src/main/ai-engine/cowork/skills/` — 138 个内置技能定义文件

## 安全考虑

- 技能执行在 FileSandbox 沙箱内运行，限制文件访问范围
- `run` 命令默认使用本地 Ollama，不会将代码发送到外部
- 使用 `--provider openai` 时代码会发送到 OpenAI API

## 使用示例

### 场景 1：查找并运行技能

```bash
chainlesschain skill search "security"
chainlesschain skill info security-audit
chainlesschain skill run security-audit "检查 src/auth 目录的安全漏洞"
```

搜索安全相关技能，查看技能说明和参数后运行，AI 自动分析并返回结果。

### 场景 2：创建项目自定义技能

```bash
chainlesschain init --bare
chainlesschain skill add api-doc-gen
chainlesschain skill sources
```

初始化项目后创建自定义技能脚手架，编辑生成的 `SKILL.md` 和 `handler.js` 实现项目专属技能。

### 场景 3：按分类浏览技能

```bash
chainlesschain skill categories
chainlesschain skill list --category code-review
chainlesschain skill list --source bundled --json
```

查看 24 个技能分类的统计信息，按分类或来源层筛选，JSON 输出便于工具集成。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `run` 报 LLM 连接失败 | 确认 Ollama 已启动或提供有效的 API Key |
| `list` 显示 0 技能 | 技能从内置定义加载，检查 CLI 安装完整性 |
| 技能执行结果为空 | 检查输入内容是否足够，尝试更详细的描述 |

## 相关文档

- [CLI 指令技能包系统](./cli-skill-packs) — 9 个 CLI 域技能包详情，Agent 调用指南
- [代理模式](./cli-agent) — 代理模式中使用技能
- [Cowork 多智能体协作](./cowork) — 桌面端技能系统详情
- [AI 对话](./cli-chat) — 基础对话功能
