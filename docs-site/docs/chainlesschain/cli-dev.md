# 自主开发者 (dev)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **自主开发会话**: 创建、管理带自治等级 (L0-L4) 的开发会话
- **阶段推进**: 按开发阶段 (analysis, design, implement, test, review, deploy) 推进会话
- **代码审查**: 使用启发式反模式检测对文件进行质量评分
- **架构决策记录**: 为会话记录 ADR (Architecture Decision Record)，支持 Markdown 渲染
- **重构类型目录**: 查看内置重构类型 (rename, extract, inline 等)

## 概述

ChainlessChain CLI 自主开发者模块 (Phase 63) 提供完整的自主开发会话管理。每个会话绑定一个需求描述和自治等级 (L0 人工驱动 ~ L4 完全自主)，按阶段推进开发流程。`review` 子命令复用反模式检测引擎对文件打分，`adr` 子命令记录架构决策并可渲染为 Markdown。

## 命令参考

### dev levels — 查看自治等级

```bash
chainlesschain dev levels
chainlesschain dev levels --json
```

列出 L0-L4 自治等级的名称和描述。

### dev phases — 查看开发阶段

```bash
chainlesschain dev phases
chainlesschain dev phases --json
```

按顺序列出开发阶段 (analysis → design → implement → test → review → deploy)。

### dev refactor-types — 重构类型目录

```bash
chainlesschain dev refactor-types
chainlesschain dev refactor-types --json
```

列出已知重构类型 (rename, extract-method, inline, move 等)。

### dev start — 启动开发会话

```bash
chainlesschain dev start "实现用户注册功能"
chainlesschain dev start "重构数据库层" -l 3 -b alice --json
```

创建新开发会话。`-l` 指定自治等级 (0-4, 默认 2)，`-b` 标记创建者。

### dev list — 列出开发会话

```bash
chainlesschain dev list
chainlesschain dev list -s active -p implement --limit 20 --json
```

列出会话。可按状态 (`active|paused|completed|failed`) 和阶段过滤。

### dev show — 查看会话详情

```bash
chainlesschain dev show <session-id>
chainlesschain dev show <session-id> --json
```

显示会话完整信息：需求、阶段、状态、自治等级、审查反馈。

### dev phase — 推进阶段

```bash
chainlesschain dev phase <session-id> implement
chainlesschain dev phase <session-id> test --json
```

将会话推进到指定阶段。

### dev pause / resume / complete / fail — 生命周期管理

```bash
chainlesschain dev pause <session-id>
chainlesschain dev resume <session-id>
chainlesschain dev complete <session-id>
chainlesschain dev fail <session-id> -r "依赖服务不可用"
```

暂停、恢复、完成或标记失败。`fail` 支持 `-r` 指定失败原因。

### dev review — 代码审查

```bash
chainlesschain dev review src/main.js
chainlesschain dev review src/main.js -s <session-id> --min-score 0.8 --json
```

使用启发式检测对文件评分 (0-1)，返回 grade、findings 和 severity。`-s` 可将审查绑定到会话。

### dev adr — 记录架构决策

```bash
chainlesschain dev adr <session-id> "使用 SQLite" "选择 SQLite 作为本地存储"
chainlesschain dev adr <session-id> "采用微服务" "拆分为独立服务" -c "需要水平扩展" -a "单体,Serverless" --render
```

记录 ADR。`-c` 上下文，`-q` 后果，`-a` 替代方案 (逗号分隔)，`-s` 状态 (proposed|accepted|deprecated|superseded)，`--render` 输出 Markdown。

### dev adrs — 列出 ADR

```bash
chainlesschain dev adrs
chainlesschain dev adrs -s <session-id> -S accepted --limit 20 --json
```

列出 ADR，可按会话和状态过滤。

## 数据库表

| 表名 | 说明 |
|------|------|
| `autonomous_dev_sessions` | 开发会话（需求、阶段、状态、自治等级、创建者、审查反馈） |
| `autonomous_dev_adrs` | 架构决策记录（标题、决策、上下文、后果、替代方案、状态） |

## 系统架构

```
用户命令 → dev.js (Commander) → autonomous-developer.js
                                       │
              ┌────────────────────────┼───────────────────────┐
              ▼                        ▼                       ▼
         会话管理                   代码审查                  ADR
  (start/phase/pause/resume     (review → anti-        (adr/adrs/render)
   complete/fail/list/show)      pattern detect)
              ▼                        ▼                       ▼
   autonomous_dev_sessions       文件系统扫描         autonomous_dev_adrs
```

## 配置参考

```bash
# dev start
<requirement>                  # 需求描述（必填）
-l, --level <n>                # 自治等级 0..4 (默认 2)
-b, --by <author>              # 创建者标记

# dev list
-s, --status <s>               # active|paused|completed|failed
-p, --phase <p>                # 阶段过滤
--limit <n>                    # 最大条目数 (默认 50)

# dev review
<file>                         # 文件路径（必填）
-s, --session <id>             # 绑定会话
--min-score <n>                # 最低通过分 0..1 (默认 0.7)

# dev adr
<session-id> <title> <decision>  # 必填
-c, --context <text>             # 决策上下文
-q, --consequences <text>        # 后果
-a, --alternatives <csv>         # 替代方案 (逗号分隔)
-s, --status <s>                 # proposed|accepted|deprecated|superseded
--render                         # 渲染 Markdown
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| start 创建会话 | < 200ms | ~120ms | OK |
| phase 推进阶段 | < 100ms | ~60ms | OK |
| review 文件审查 | < 2s | ~1.2s | OK |
| adr 记录 | < 150ms | ~80ms | OK |
| list 列出 (50 条) | < 300ms | ~140ms | OK |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/dev.js` | dev 命令主入口 (Phase 63) |
| `packages/cli/src/lib/autonomous-developer.js` | 会话管理、阶段推进、ADR、代码审查核心实现 |
