# instinct 命令

> 本能学习系统 — 查看、管理和维护 AI 从用户交互中学习到的偏好模式

## 概述

`instinct` 命令管理 AI 的本能学习系统，该系统从用户交互中自动学习偏好模式（如代码风格、回复格式等）并以置信度评分的方式持久化存储。用户可以查看、筛选、删除已学习的偏好，生成系统提示词，以及对长期未使用的偏好进行衰减处理。

## 核心特性

- 🔹 **偏好展示**: 查看已学习的用户偏好，含置信度可视化进度条
- 🔹 **分类浏览**: 按类别筛选和浏览本能规则
- 🔹 **提示生成**: 根据高置信度本能自动生成系统提示词
- 🔹 **衰减机制**: 对长期未使用的偏好进行置信度衰减
- 🔹 **精细管理**: 支持按 ID 删除单条本能或重置全部

## 系统架构

```
chainlesschain instinct
    │
    ├── show (默认) ─▶ getInstincts(db, filters) / getStrongInstincts(db)
    │                   └── 显示偏好列表 + 置信度进度条
    │
    ├── categories ──▶ INSTINCT_CATEGORIES
    │                   └── 列出所有本能类别
    │
    ├── prompt ──────▶ generateInstinctPrompt(db)
    │                   └── 高置信度本能 → 系统提示词
    │
    ├── delete <id> ─▶ deleteInstinct(db, id)
    │                   └── 按 ID（或前缀）删除单条
    │
    ├── reset ───────▶ resetInstincts(db)
    │                   └── 清空所有本能（需确认）
    │
    └── decay ───────▶ decayInstincts(db, days)
                        └── 衰减超过 N 天未使用的本能置信度
```

## 子命令

### instinct show（默认子命令）

显示已学习的本能偏好。

```bash
chainlesschain instinct [show] [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--category <cat>` | 按类别过滤 | — |
| `-n, --limit <n>` | 最大显示数 | `30` |
| `--strong` | 仅显示高置信度本能（>= 70%） | — |
| `--json` | JSON 格式输出 | — |

### instinct categories

列出所有本能类别。

```bash
chainlesschain instinct categories
```

### instinct prompt

根据高置信度本能生成系统提示词。

```bash
chainlesschain instinct prompt [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--json` | JSON 格式输出 | — |

### instinct delete

按 ID 删除单条本能。

```bash
chainlesschain instinct delete <id>
```

| 参数 | 说明 |
|------|------|
| `<id>` | 本能 ID 或 ID 前缀 |

### instinct reset

重置所有已学习的本能。

```bash
chainlesschain instinct reset [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--force` | 跳过确认提示 | — |

### instinct decay

衰减长期未使用的本能置信度。

```bash
chainlesschain instinct decay [options]
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--days <n>` | 天数阈值（超过该天数未使用的本能会被衰减） | `30` |

## 关键文件

- `packages/cli/src/commands/instinct.js` — 命令注册与子命令定义
- `packages/cli/src/lib/instinct-manager.js` — 核心逻辑：`getInstincts()`、`getStrongInstincts()`、`resetInstincts()`、`deleteInstinct()`、`decayInstincts()`、`generateInstinctPrompt()`、`INSTINCT_CATEGORIES`
- `packages/cli/src/runtime/bootstrap.js` — 运行时初始化，提供数据库连接

## 安全考虑

- 本能数据存储在加密数据库中（SQLCipher AES-256）
- `reset` 操作不可逆，默认需要交互式确认（可用 `--force` 跳过）
- 本能学习基于用户交互模式，不会收集或外传个人数据
- 衰减机制确保过时的偏好不会持续影响 AI 行为

## 使用示例

### 场景 1：查看所有已学习偏好

```bash
chainlesschain instinct show
```

输出示例：
```
Learned Instincts (12):

  a1b2c3d4  code_style          ████████░░ 80%
    Prefers TypeScript with strict mode
    seen 15x | last: 2026-03-10

  e5f6g7h8  response_format     ██████░░░░ 60%
    Prefers concise answers with code examples
    seen 8x | last: 2026-03-08
```

### 场景 2：仅查看高置信度偏好

```bash
chainlesschain instinct show --strong
```

### 场景 3：按类别筛选

```bash
chainlesschain instinct show --category code_style
```

### 场景 4：生成系统提示词

```bash
chainlesschain instinct prompt
```

### 场景 5：衰减旧偏好

```bash
chainlesschain instinct decay --days 60
# 输出: Decayed 3 old instincts
```

### 场景 6：删除错误学习的偏好

```bash
chainlesschain instinct delete a1b2c3d4
# 输出: Instinct deleted
```

### 场景 7：重置全部偏好

```bash
chainlesschain instinct reset
# 提示: Reset all learned instincts? This cannot be undone. (y/N)
```

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `Database not available` | 运行 `chainlesschain setup` 初始化环境 |
| `No instincts learned yet` | 使用 `chainlesschain agent` 或 `chainlesschain chat` 与 AI 交互以积累偏好 |
| `No strong instincts yet` | 需要更多交互次数以提高置信度 |
| `Instinct not found` | 检查 ID 是否正确，使用 `instinct show --json` 获取完整 ID |
| 偏好学习不准确 | 使用 `instinct delete` 删除错误条目，或 `instinct reset` 重新开始 |

## 相关文档

- [agent 命令](./cli-agent) — Agentic AI 会话（交互中学习偏好）
- [chat 命令](./cli-chat) — 交互式 AI 对话
- [memory 命令](./cli-memory) — 持久化记忆管理
