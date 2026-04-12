# 笔记/知识库管理 (note)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 概述

`note` 命令提供完整的笔记 CRUD 操作，支持创建带标签和分类的笔记、列表浏览、全文搜索和软删除。笔记存储在本地加密的 SQLite 数据库中，支持 JSON 格式输出便于脚本集成和自动化处理。

## 核心特性

- 📝 **完整 CRUD**: 笔记的创建、查看、搜索、删除
- 🏷️ **标签分类**: 支持多标签和分类管理
- 🔍 **全文搜索**: 基于内容的关键词搜索
- 🗑️ **软删除**: 删除可恢复，数据安全有保障
- 📊 **JSON 输出**: 支持 `--json` 格式，便于脚本集成

## 系统架构

```
note 命令 → note.js (Commander) → @chainlesschain/core-db
                                        │
                   ┌────────────────────┼────────────────────┐
                   ▼                    ▼                    ▼
              note add              note list/show       note search
                   │                    │                    │
                   ▼                    ▼                    ▼
            INSERT notes 表       SELECT + 分页          LIKE 全文匹配
                                  按分类/标签筛选
```

## 命令参考

```bash
chainlesschain note add "我的笔记" -c "笔记内容" -t "标签1,标签2"
chainlesschain note list                # 列出最近笔记
chainlesschain note list --category dev --tag 重要
chainlesschain note list --json         # JSON格式输出
chainlesschain note show <id>           # 按ID前缀查看笔记
chainlesschain note search "关键词"      # 全文搜索
chainlesschain note delete <id>         # 软删除
```

## 子命令说明

### add

创建新笔记，支持标题、内容和标签。

```bash
chainlesschain note add "学习笔记" -c "今天学了 WebRTC" -t "学习,webrtc"
```

### list

列出笔记，支持按分类和标签筛选。

```bash
chainlesschain note list
chainlesschain note list --category dev --tag 重要
chainlesschain note list --json
```

### show

按 ID 前缀查看笔记详情。

```bash
chainlesschain note show abc123
```

### search

全文搜索笔记内容。

```bash
chainlesschain note search "关键词"
```

### delete

软删除笔记（可恢复）。

```bash
chainlesschain note delete abc123
```

## 关键文件

- `packages/cli/src/commands/note.js` — 命令实现
- `@chainlesschain/core-db` — 数据库核心包

## 安全考虑

- 笔记存储在本地 SQLite 数据库，支持 SQLCipher 加密
- `delete` 为软删除（设置 `deleted_at`），数据可恢复
- 标签和分类数据不会上传到任何外部服务

## 使用示例

### 场景 1：创建带标签的笔记

```bash
chainlesschain note add "WebRTC 学习笔记" -c "ICE 候选流程：gather → trickle → complete" -t "学习,webrtc,p2p"
chainlesschain note add "Bug 记录" -c "用户登录在 Safari 下报 CORS 错误" -t "bug,前端"
```

创建结构化笔记，通过标签分类便于后续检索和管理。

### 场景 2：搜索和查看笔记

```bash
chainlesschain note search "WebRTC"
chainlesschain note list --tag 学习
chainlesschain note show abc123
```

通过关键词全文搜索或按标签筛选找到目标笔记，使用 ID 前缀查看详细内容。

### 场景 3：脚本批量管理

```bash
chainlesschain note list --json
chainlesschain note add "自动化记录" -c "$(date): 部署完成" -t "devops,自动化"
```

JSON 输出便于脚本处理，结合 shell 命令实现自动化笔记记录。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `add` 失败 | 确认数据库已初始化：`chainlesschain db init` |
| `search` 无结果 | 检查关键词是否匹配，尝试更短的关键词 |
| `show` 找不到笔记 | ID 前缀需至少 4 个字符 |

## 相关文档

- [混合搜索](./cli-search) — BM25 高级搜索
- [数据库管理](./cli-db) — 数据库初始化与备份
- [知识库管理](./knowledge-base) — 桌面端知识库功能
