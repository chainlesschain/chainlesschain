# 会话管理 (session)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 💾 **自动保存**: 对话历史实时持久化到数据库
- 🔄 **断点恢复**: 恢复之前的会话继续对话
- 📤 **Markdown 导出**: 将对话导出为可读的 Markdown 文件
- 📋 **元数据追踪**: 记录 Provider、模型、消息数量等信息
- 🔍 **ID 前缀匹配**: 输入部分 ID 即可定位会话

## 系统架构

```
session 命令 → session.js (Commander) → session-manager.js
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
              session list/show        session resume           session export
                    │                        │                        │
                    ▼                        ▼                        ▼
            SELECT sessions 表       加载消息历史到 REPL      生成 Markdown 文件
            按时间排序               恢复 Provider/Model       含元数据和对话
```

## 概述

管理 AI 对话会话的持久化、恢复和导出。所有 `chat` 和 `agent` 命令的对话历史自动保存，支持跨会话恢复。

## 命令参考

```bash
chainlesschain session list                # 列出所有会话
chainlesschain session show <id>           # 查看会话详情
chainlesschain session resume <id>         # 恢复会话继续对话
chainlesschain session export <id>         # 导出为 Markdown
chainlesschain session delete <id>         # 删除会话
```

## 子命令

### list — 列出会话

显示所有保存的会话，按最近使用时间排序：

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

## 关键文件

- `packages/cli/src/commands/session.js` — 命令实现
- `packages/cli/src/lib/session-manager.js` — 会话管理库

## 安全考虑

- 会话包含完整的对话历史，可能含有敏感信息
- `export` 导出的 Markdown 文件为明文，注意保管
- `delete` 操作不可恢复

## 使用示例

### 场景 1：查看和恢复会话

```bash
chainlesschain session list
chainlesschain session resume sess-a1b2c3
```

列出所有保存的会话，选择之前的对话继续讨论，完整上下文自动恢复。

### 场景 2：导出会话为文档

```bash
chainlesschain session show sess-a1b2c3
chainlesschain session export sess-a1b2c3 --output meeting-notes.md
```

查看会话详情确认内容后导出为 Markdown 文件，便于归档或分享给团队成员。

### 场景 3：清理旧会话

```bash
chainlesschain session list --limit 50
chainlesschain session delete sess-old123
```

查看全部会话列表，删除不再需要的旧会话以保持列表整洁。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `list` 为空 | 需先通过 `chat` 或 `agent` 进行对话 |
| `resume` 失败 | 检查会话 ID 是否正确，至少 4 字符前缀 |
| `export` 文件为空 | 确认会话有消息记录 |

## 相关文档

- [AI 对话](./cli-chat) — 对话命令
- [代理模式](./cli-agent) — 代理式会话
- [持久记忆](./cli-memory) — 跨会话记忆

## 依赖

- 需要先初始化数据库：`chainlesschain db init`
