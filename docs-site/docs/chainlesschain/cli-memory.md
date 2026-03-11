# 持久记忆 (memory)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

管理 AI 助手的持久化记忆系统。支持数据库记忆条目和文件系统每日笔记，让 AI 在不同会话间保持上下文。

## 命令参考

```bash
chainlesschain memory show                 # 显示 MEMORY.md 内容
chainlesschain memory add "偏好使用 Ollama"  # 添加记忆条目
chainlesschain memory search "LLM"          # 搜索记忆
chainlesschain memory delete <id>           # 删除记忆
chainlesschain memory daily                 # 查看今日笔记
chainlesschain memory file                  # 管理 MEMORY.md 文件
```

## 子命令

### show — 显示记忆

显示 MEMORY.md 文件内容和记忆条目概览：

```bash
chainlesschain memory show
```

### add — 添加记忆

添加一条新的持久化记忆条目：

```bash
chainlesschain memory add "用户偏好 TypeScript"
chainlesschain memory add "项目使用 PostgreSQL" --category work
chainlesschain memory add "重要设计决策" --importance 5
```

**选项：**

| 选项           | 说明               | 默认值  |
| -------------- | ------------------ | ------- |
| `--category`   | 记忆分类           | general |
| `--importance` | 重要度 (1-5)       | 3       |

### search — 搜索记忆

在记忆条目中搜索关键词：

```bash
chainlesschain memory search "数据库"
chainlesschain memory search "React" --limit 5
```

### delete — 删除记忆

按 ID 或 ID 前缀删除记忆条目：

```bash
chainlesschain memory delete mem-abc123def
chainlesschain memory delete mem-abc1       # 前缀匹配（最少 4 字符）
```

### daily — 每日笔记

查看或追加每日笔记：

```bash
chainlesschain memory daily                 # 查看今日笔记
chainlesschain memory daily 2026-03-11      # 查看指定日期
chainlesschain memory daily --add "今天完成了 Phase 1"  # 追加笔记
```

### file — MEMORY.md 管理

查看或编辑 MEMORY.md 持久化知识文件：

```bash
chainlesschain memory file                  # 显示内容
chainlesschain memory file --edit           # 用编辑器打开
```

## 记忆存储

记忆数据分两层存储：

1. **数据库** (`memory_entries` 表)：结构化记忆条目，支持分类、搜索、重要度
2. **文件系统** (`~/.chainlesschain/data/memory/`)：
   - `MEMORY.md`：长期知识文件
   - `daily/YYYY-MM-DD.md`：每日笔记

## 依赖

- 需要先初始化数据库：`chainlesschain db init`
