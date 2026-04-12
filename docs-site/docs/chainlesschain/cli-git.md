# git 命令

> 知识库 Git 版本控制集成 — 状态查看、自动提交、钩子安装和历史分析

## 概述

`git` 命令为知识库目录提供 Git 版本控制集成，支持查看工作区状态、自动生成提交消息并提交变更、安装 Git 钩子以及分析仓库历史统计数据。所有操作仅在本地仓库执行，不会自动推送到远程。

## 核心特性

- 🔹 **状态查看**: 显示知识库目录的 Git 工作区状态
- 🔹 **自动提交**: 自动生成提交消息并提交所有变更
- 🔹 **仓库初始化**: 为知识库目录初始化 Git 仓库
- 🔹 **钩子安装**: 安装 Git 钩子实现自动化工作流
- 🔹 **历史分析**: 分析仓库统计数据，包括贡献者和提交历史

## 系统架构

```
chainlesschain git
    │
    ├── status ──────▶ gitStatus(dir)
    │                   ├── 分支信息
    │                   ├── 工作区状态 (clean / changed)
    │                   └── 变更文件列表 (M/A/D/??)
    │
    ├── init ────────▶ gitInit(dir)
    │                   └── 初始化 .git 目录
    │
    ├── auto-commit ─▶ gitAutoCommit(dir, message?)
    │                   ├── git add -A
    │                   ├── 生成/使用提交消息
    │                   └── git commit
    │
    ├── hooks ───────▶ installHooks(dir)
    │                   └── 写入 .git/hooks/ 脚本
    │
    └── history-analyze ▶ gitHistoryAnalyze(dir) + gitLog(dir, limit)
                           ├── 总提交数 / 跟踪文件数
                           ├── 首次/最后提交时间
                           ├── 贡献者列表
                           └── 最近 N 条提交日志
```

## 子命令

### git status

显示目标目录的 Git 状态。

```bash
chainlesschain git status [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-d, --dir <dir>` | 目标目录 | `.`（当前目录） |
| `--json` | JSON 格式输出 | — |

### git init

初始化 Git 仓库。

```bash
chainlesschain git init [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-d, --dir <dir>` | 目标目录 | `.` |

### git auto-commit

自动提交所有变更。

```bash
chainlesschain git auto-commit [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-d, --dir <dir>` | 目标目录 | `.` |
| `-m, --message <msg>` | 自定义提交消息 | 自动生成 |
| `--json` | JSON 格式输出 | — |

### git hooks

管理 Git 钩子。

```bash
chainlesschain git hooks [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-d, --dir <dir>` | 目标目录 | `.` |
| `--install` | 安装钩子 | — |

### git history-analyze

分析仓库历史和统计数据。

```bash
chainlesschain git history-analyze [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-d, --dir <dir>` | 目标目录 | `.` |
| `-n, --limit <n>` | 显示最近的提交数 | `10` |
| `--json` | JSON 格式输出 | — |

## 关键文件

- `packages/cli/src/commands/git.js` — 命令注册与子命令定义
- `packages/cli/src/lib/git-integration.js` — Git 操作核心：gitStatus、gitAutoCommit、gitLog、gitHistoryAnalyze、gitInit、isGitRepo、installHooks

## 安全考虑

- `auto-commit` 会执行 `git add -A`，确保 `.gitignore` 配置正确以排除敏感文件
- Git 钩子以 shell 脚本形式写入，具有可执行权限
- 操作仅在本地仓库执行，不会自动推送到远程

## 使用示例

### 场景 1：查看知识库状态

```bash
chainlesschain git status
```

输出示例：
```
Branch: main

3 changed file(s):

  M   notes/blockchain.md
  A   notes/new-topic.md
  ??  notes/draft.md
```

### 场景 2：初始化并自动提交

```bash
chainlesschain git init -d ./my-knowledge
chainlesschain git auto-commit -d ./my-knowledge
```

输出示例：
```
Committed a1b2c3d: Auto-commit: 3 files changed
  3 file(s) changed
```

### 场景 3：使用自定义提交消息

```bash
chainlesschain git auto-commit -m "添加本周学习笔记"
```

### 场景 4：安装 Git 钩子

```bash
chainlesschain git hooks --install
```

### 场景 5：分析仓库历史

```bash
chainlesschain git history-analyze -n 5
```

输出示例：
```
Repository Analysis

  Total commits: 128
  Tracked files: 45
  First commit: 2025-01-15
  Last commit: 2026-03-12

Contributors:

    85 Alice
    43 Bob

Recent Commits:

  a1b2c3d Add blockchain notes 2026-03-12
  d4e5f6a Update AI learning 2026-03-11
  ...
```

### 场景 6：JSON 格式输出（自动化集成）

```bash
chainlesschain git history-analyze --json | jq '.totalCommits'
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Not a git repository` | 运行 `chainlesschain git init` 初始化仓库 |
| `Git status failed` | 确认 Git 已安装：`git --version` |
| auto-commit 无变更 | 工作区已是 clean 状态，无需提交 |
| hooks 安装失败 | 确认目录是 Git 仓库且 `.git/hooks/` 目录存在 |
| 历史分析耗时长 | 大型仓库分析较慢，可用 `--limit` 减少显示的提交数 |

## 相关文档

- [note 命令](./cli-note) — 笔记管理
- [export 命令](./cli-export) — 知识导出
- [import 命令](./cli-import) — 知识导入
