# 项目初始化 (init)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🏗️ **项目初始化**: 类似 `git init`，在当前目录创建 `.chainlesschain/` 项目结构
- 📋 **4 种模板**: code-project、data-science、devops、空项目
- ⚡ **非交互模式**: `--yes` 跳过确认，`--bare` 最小初始化
- 📁 **标准目录结构**: `config.json` + `rules.md` + `skills/`
- 🔍 **项目检测**: 自动检测已有项目，防止重复初始化

## 系统架构

```
init 命令 → init.js (Commander) → project-detector.js
                                        │
               ┌────────────────────────┼────────────────────┐
               ▼                        ▼                    ▼
        检查现有项目              选择模板                生成目录结构
    findProjectRoot()      interactive/--template     .chainlesschain/
               │                        │              ├── config.json
               ▼                        ▼              ├── rules.md
        已存在则报错            4种模板规则             └── skills/
```

## 概述

CLI Phase 102 — 在当前目录初始化 `.chainlesschain/` 项目结构，用于自定义技能、项目规则和配置管理。

## 命令参考

```bash
chainlesschain init                              # 交互式初始化
chainlesschain init --bare                       # 最小初始化（空项目模板）
chainlesschain init --template code-project      # 使用代码项目模板
chainlesschain init --template data-science --yes # 数据科学模板，跳过确认
chainlesschain init --template devops --yes      # DevOps 模板，跳过确认
```

## 选项

| 选项 | 说明 |
|------|------|
| `--template <name>` | 指定模板（code-project / data-science / devops） |
| `--yes` | 跳过交互确认，使用默认值 |
| `--bare` | 最小初始化，等同于 `--template empty --yes` |

## 模板说明

### 空项目（默认 / `--bare`）

```markdown
# Project Rules
## General
- Follow project conventions
- Write clean, maintainable code
```

### code-project

```markdown
# Project Rules
## Code Style
- Use consistent naming conventions
- Write unit tests for new features
- Document public APIs
## Git Workflow
- Use feature branches
- Write descriptive commit messages
## Code Review
- All changes require review
- Check for security issues
```

### data-science

```markdown
# Project Rules
## Data Handling
- Document data sources and transformations
- Version control datasets and models
- Use reproducible pipelines
## Analysis
- Include visualizations for key findings
- Document assumptions and limitations
## Notebooks
- Keep notebooks clean and well-organized
- Use markdown cells for explanations
```

### devops

```markdown
# Project Rules
## Infrastructure
- Use Infrastructure as Code
- Document all configurations
- Follow least-privilege principle
## Deployment
- Use CI/CD pipelines
- Implement health checks
- Plan for rollback
## Monitoring
- Set up alerts for critical metrics
- Document runbooks
```

## 生成目录结构

```
<project-root>/
└── .chainlesschain/
    ├── config.json     # 项目配置
    ├── rules.md        # 项目编码规则
    └── skills/         # 自定义技能目录
```

### config.json 结构

```json
{
  "name": "my-project",
  "template": "code-project",
  "version": "1.0.0",
  "createdAt": "2026-03-12T10:00:00.000Z"
}
```

## 项目检测

`project-detector.js` 提供项目根目录检测工具：

- `findProjectRoot(startDir?)` — 从指定目录向上遍历，查找包含 `.chainlesschain/config.json` 的目录
- `loadProjectConfig(projectRoot)` — 读取并解析项目配置
- `isInsideProject(startDir?)` — 快捷布尔判断是否在项目内

```javascript
import { findProjectRoot, isInsideProject } from "../lib/project-detector.js";

const root = findProjectRoot(); // 向上遍历查找
if (isInsideProject()) {
  // 在项目内，可加载工作区技能
}
```

## 安全考虑

- `init` 检查 `.chainlesschain/` 是否已存在，防止覆盖
- 生成的 `config.json` 不包含敏感信息
- `rules.md` 仅包含项目编码规范模板

## 使用示例

### 场景 1：交互式初始化项目

```bash
cd my-project
chainlesschain init
```

在项目根目录运行交互式初始化，选择模板并自动生成 `.chainlesschain/` 目录结构。

### 场景 2：使用模板快速初始化

```bash
chainlesschain init --template code-project --yes
chainlesschain skill sources
```

使用代码项目模板一键初始化，跳过确认提示。初始化后查看技能来源确认工作区层已就绪。

### 场景 3：最小空白项目

```bash
chainlesschain init --bare
```

创建最小项目结构，仅包含 `config.json`、`rules.md` 和空的 `skills/` 目录，适合完全自定义的场景。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 报错"已存在" | 当前目录或父目录已有 `.chainlesschain/`，不支持重复初始化 |
| 模板不存在 | 仅支持 code-project / data-science / devops，其他名称会报错 |
| 权限不足 | 检查当前目录写权限 |

## 关键文件

- `packages/cli/src/commands/init.js` — init 命令实现
- `packages/cli/src/lib/project-detector.js` — 项目检测工具

## 相关文档

- [技能系统 (skill)](./cli-skill) — 自定义技能与 4 层优先级
- [多智能体协作 (cowork)](./cli-cowork) — 多智能体协作命令
- [CLI 命令行工具](./cli) — CLI 总览
