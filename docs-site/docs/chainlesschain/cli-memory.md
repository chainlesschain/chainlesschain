# 持久记忆 (memory)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🧠 **跨会话记忆**: AI 在不同对话间保持上下文
- 📝 **每日笔记**: 自动按日期组织笔记文件
- 🔍 **记忆搜索**: 按关键词检索历史记忆
- 📊 **重要度分级**: 1-5 级重要度标记
- 📁 **双层存储**: 数据库 + 文件系统双持久化

## 系统架构

```
memory 命令 → memory.js (Commander) → memory-manager.js
                                           │
                      ┌────────────────────┼────────────────────┐
                      ▼                    ▼                    ▼
                数据库记忆              每日笔记            MEMORY.md
             (memory_entries)    (daily/YYYY-MM-DD.md)    (长期知识)
                      │                    │                    │
                      ▼                    ▼                    ▼
               分类 + 搜索           追加 + 浏览          编辑器打开
               重要度排序
```

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

## 关键文件

- `packages/cli/src/commands/memory.js` — 命令实现
- `packages/cli/src/lib/memory-manager.js` — 记忆管理库

## 安全考虑

- 记忆数据存储在本地数据库和文件系统，不上传到外部
- MEMORY.md 文件可能包含敏感信息，注意不要提交到公开仓库
- `delete` 操作不可恢复，建议先备份

## 使用示例

### 场景 1：添加项目偏好记忆

```bash
chainlesschain memory add "项目使用 TypeScript + Vue3 技术栈" --category work --importance 5
chainlesschain memory add "偏好使用 Ollama 本地模型" --category preference
chainlesschain memory show
```

记录重要的项目信息和个人偏好，AI 在后续对话中会参考这些记忆提供更准确的建议。

### 场景 2：搜索历史记忆

```bash
chainlesschain memory search "数据库"
chainlesschain memory search "React" --limit 5
```

按关键词检索相关记忆条目，快速回顾之前记录的技术决策和上下文。

### 场景 3：每日笔记管理

```bash
chainlesschain memory daily --add "完成用户认证模块重构"
chainlesschain memory daily --add "发现 P2P 连接超时问题待排查"
chainlesschain memory daily
chainlesschain memory daily 2026-03-11
```

每日记录工作进展，查看今日或指定日期的笔记，形成持续的工作日志。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `add` 失败 | 确认数据库已初始化：`chainlesschain db init` |
| `daily` 显示为空 | 当天未添加任何笔记，使用 `--add` 添加 |
| `file` 无法编辑 | 检查 `~/.chainlesschain/data/memory/` 目录权限 |

## 相关文档

- [数据库管理](./cli-db) — 数据库初始化
- [会话管理](./cli-session) — 对话历史管理
- [持久记忆集成](./permanent-memory) — 桌面端记忆系统

## 依赖

- 需要先初始化数据库：`chainlesschain db init`
