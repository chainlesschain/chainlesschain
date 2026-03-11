# 技能系统 (skill)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

管理和运行 138 个内置 AI 技能，涵盖代码审查、文档生成、测试、安全分析等 24 个分类。

## 命令参考

```bash
chainlesschain skill list               # 按分类列出所有技能
chainlesschain skill list --category automation
chainlesschain skill list --tag code --runnable
chainlesschain skill list --json        # JSON格式输出
chainlesschain skill categories         # 查看分类统计
chainlesschain skill info code-review   # 查看技能详情+文档
chainlesschain skill info code-review --json
chainlesschain skill search "browser"   # 按关键词搜索
chainlesschain skill run code-review "Review this code..."
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

## 技能分类（24类）

ai, analysis, automation, code-review, data, database, debugging, design, development (41个), devops, document, documentation, general, knowledge, learning, media, productivity, quality, remote, security, system, testing, utility, workflow
