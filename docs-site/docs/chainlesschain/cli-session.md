# 会话管理 (session)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

管理 AI 对话会话的持久化、恢复和导出。所有 `chat` 和 `agent` 命令的对话历史自动保存，支持跨会话恢复。

## 命令参考

```bash
chainlesschain session list                # 列��所有会话
chainlesschain session show <id>           # 查看会话详情
chainlesschain session resume <id>         # 恢复会话继续对话
chainlesschain session export <id>         # 导出为 Markdown
chainlesschain session delete <id>         # 删除会话
```

## 子命令

### list — 列出会话

显示所有保存的会话，按最���使用时间排序：

```bash
chainlesschain session list
chainlesschain session list --limit 5
```

**输出示例：**

```
Sessions (showing 3 of 15)
──────────────────────────
1. [sess-a1b2c3] "代码重构讨论" (ollama/qwen2:7b)
   Created: 2026-03-11 14:30  Messages: 12
2. [sess-d4e5f6] "API 设计方案" (openai/gpt-4o)
   Created: 2026-03-10 09:15  Messages: 28
3. [sess-g7h8i9] "Bug 排查" (ollama/qwen2:7b)
   Created: 2026-03-09 16:00  Messages: 8
```

### show — 查看详情

显示会话的完整信息和消息历史：

```bash
chainlesschain session show sess-a1b2c3
chainlesschain session show sess-a1b2     # 支持 ID 前缀匹配
```

### resume — 恢复会话

恢复之前的会话继续对话，加载完整的消息历史：

```bash
chainlesschain session resume sess-a1b2c3
```

恢复后进入交互式对话模式，之前的上下文完全保留。

### export — 导出 Markdown

将会话导出为 Markdown 文件，便于归档或分享：

```bash
chainlesschain session export sess-a1b2c3
chainlesschain session export sess-a1b2c3 --output chat-log.md
```

**导出格式：**

```markdown
# 代码重构讨论

- **Date**: 2026-03-11 14:30
- **Provider**: ollama
- **Model**: qwen2:7b
- **Messages**: 12

---

**You**: 帮我重构 utils.js

**AI**: 我来分析这个文件的结构...
```

### delete — 删除会话

删除指定会话及其所有消息历史：

```bash
chainlesschain session delete sess-a1b2c3
```

## 自动保存

`chat` 和 `agent` 命令在对话过程中自动保存会话：

- 每次用户发送消息后自动保存
- 会话标题根据第一条消息自动生成
- 保存 Provider、模型、消息数量等元数据

## 依赖

- 需要先初始化数据库：`chainlesschain db init`
