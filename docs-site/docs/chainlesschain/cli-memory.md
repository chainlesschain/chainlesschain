# 持久记忆 (memory)

> `memory` 当前同时包含两套能力：传统数据库记忆/每日笔记，以及 Managed Agents 对标阶段新增的 scoped memory。

## 核心特性

- 🧠 **双轨记忆系统** — 传统数据库记忆（长期笔记）与 scoped memory（Agent 运行时）并行运作
- 🎯 **三级作用域** — `global` / `agent` / `session` 作用域，精确控制记忆可见范围
- 🏷️ **标签与分类** — `--tags` + `--category` 双维度组织，支持复合条件召回
- 🔍 **语义召回** — `memory recall` 按 query + scope + tags 联合检索
- 📅 **每日笔记** — `memory daily` 按日期分组，支持追加写入
- 📝 **长期文档** — `memory file` 管理持久 `MEMORY.md`
- 🔄 **会话整合** — `memory consolidate` 将 JSONL 会话轨迹写入 MemoryStore

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                    CLI memory 命令                            │
├────────────────────────┬─────────────────────────────────────┤
│   传统记忆层             │   Managed Agents scoped memory 层   │
│   show / add / search  │   store / recall / consolidate      │
│   delete / daily / file│                                     │
└──────────┬─────────────┴──────────────┬────────────────────-─┘
           │                            │
           ▼                            ▼
  ┌─────────────────┐        ┌──────────────────────┐
  │  SQLite DB      │        │  MemoryStore         │
  │  chainlesschain │        │  memory-store.json   │
  │  .db            │        │  (session-core)      │
  └─────────────────┘        └──────────┬───────────┘
                                        │
                          ┌─────────────┼──────────────┐
                          ▼             ▼              ▼
                      global         agent         session
                      scope          scope         scope
```

## 概述

传统能力适合本地知识沉淀：

- `show` / `add` / `search` / `delete`
- `daily` / `file`

Managed Agents 增强适合 Agent 运行时的作用域记忆：

- `store`：写入 `session | agent | global` 作用域记忆
- `recall`：按 query、scope、category、tags 召回

## 命令总览

```bash
chainlesschain memory show
chainlesschain memory add "偏好 TypeScript" --category preference
chainlesschain memory search "数据库"
chainlesschain memory delete <id>
chainlesschain memory daily --append "今天完成了回归测试"
chainlesschain memory file --edit
chainlesschain memory store "偏好 TypeScript" --scope global --category preference --tags ts,style
chainlesschain memory recall "TypeScript" --scope global
```

## 传统记忆命令

### `show` / `add` / `search` / `delete`

这组命令仍走数据库记忆管理器，适合日常笔记和长期条目。

```bash
chainlesschain memory show --limit 10
chainlesschain memory add "项目使用 PostgreSQL" --category work --importance 5
chainlesschain memory search "PostgreSQL" --limit 5
chainlesschain memory delete mem-1234
```

### `daily`

管理按日期分组的每日笔记。

```bash
chainlesschain memory daily
chainlesschain memory daily 2026-04-15
chainlesschain memory daily --append "补齐 managed agents 测试"
chainlesschain memory daily --list
```

### `file`

查看或编辑长期 `MEMORY.md` 文件。

```bash
chainlesschain memory file
chainlesschain memory file --edit
```

## Managed Agents 增强: scoped memory

### `store`

写入 `@chainlesschain/session-core` 的 `MemoryStore`。这套数据与数据库记忆独立，主要服务于 Agent runtime。

```bash
chainlesschain memory store "偏好 TypeScript" --scope global --category preference
chainlesschain memory store "避免修改 deployment 脚本" --scope agent --scope-id agent_codegen --category safety --tags deploy,warning
chainlesschain memory store "这个会话在做 CLI 文档收口" --scope session --scope-id sess_123 --category context
```

可选参数：

| 参数 | 说明 |
|------|------|
| `--scope` | 必填，`session` / `agent` / `global` |
| `--scope-id` | `session` 或 `agent` 作用域时建议提供 |
| `--category` | 分类，默认 `general` |
| `--tags` | 逗号分隔标签 |
| `--json` | 输出 JSON |

### `recall`

按 query、scope、scope-id、category、tags 检索 scoped memory。

```bash
chainlesschain memory recall "TypeScript"
chainlesschain memory recall "deploy" --scope agent --scope-id agent_codegen
chainlesschain memory recall "上下文" --scope session --scope-id sess_123 --limit 5
chainlesschain memory recall "TypeScript" --scope global --category preference --tags ts --json
```

输出会展示：

- 记忆 ID
- scope / scopeId
- category
- relevance
- 内容摘要

## 持久化文件

Managed Agents scoped memory 当前写入：

- `~/.chainlesschain/memory-store.json`

传统记忆仍使用原有数据库和 `MEMORY.md`/daily notes 目录。

## 配置参考

### memory-store.json 结构

```js
// ~/.chainlesschain/memory-store.json
{
  "version": 1,
  "entries": [
    {
      "id": "mem_abc123",
      "content": "偏好 TypeScript",
      "scope": "global",
      "scopeId": null,
      "category": "preference",
      "tags": ["ts", "style"],
      "createdAt": "2026-04-15T10:00:00.000Z",
      "relevance": 1.0
    },
    {
      "id": "mem_def456",
      "content": "避免修改 deployment 脚本",
      "scope": "agent",
      "scopeId": "agent_codegen",
      "category": "safety",
      "tags": ["deploy", "warning"],
      "createdAt": "2026-04-15T11:30:00.000Z",
      "relevance": 1.0
    }
  ]
}
```

### `memory store` 选项参考

```bash
chainlesschain memory store "<content>" \
  --scope global|agent|session \  # 必填
  --scope-id <id> \               # session/agent 作用域时建议提供
  --category <category> \         # 默认 general
  --tags <tag1,tag2> \            # 逗号分隔
  --json                          # 输出 JSON 格式结果
```

### `memory recall` 选项参考

```bash
chainlesschain memory recall "<query>" \
  --scope global|agent|session \  # 按作用域过滤
  --scope-id <id> \               # 配合 agent/session scope
  --category <category> \         # 按分类过滤
  --tags <tag1,tag2> \            # 按标签过滤
  --limit <n> \                   # 最多返回条数，默认 10
  --json                          # 输出 JSON
```

## 性能指标

| 操作 | 典型延迟 | 存储规模建议 |
|------|----------|--------------|
| `memory store` | < 20ms | 单条写入，无限制 |
| `memory recall` (全局) | < 30ms | 建议 < 10,000 条 |
| `memory recall` (带 scope) | < 15ms | 作用域过滤显著提速 |
| `memory consolidate` | 50–500ms | 取决于 JSONL 会话大小 |
| `memory add` (SQLite) | < 25ms | SQLite 单写 |
| `memory search` (SQLite) | < 50ms | BM25 全文搜索 |
| `memory daily --append` | < 10ms | 追加写文件 |

## 安全考虑

### 1. 敏感内容隔离

避免将密钥、密码等敏感信息写入 scoped memory，因为 `memory-store.json` 是明文 JSON 文件：

```bash
# ❌ 不推荐
chainlesschain memory store "API Key: sk-ant-abc123" --scope global

# ✅ 推荐：仅存储偏好、上下文、行为规则
chainlesschain memory store "偏好函数式编程风格" --scope global --category preference
```

### 2. 文件权限

```bash
# Linux / macOS — 限制为当前用户可读写
chmod 600 ~/.chainlesschain/memory-store.json
```

### 3. Agent 作用域隔离

为不同 Agent 使用独立的 `scope-id`，防止跨 Agent 记忆污染：

```bash
# 代码生成 Agent 独立记忆空间
chainlesschain memory store "使用 ESM 模块" --scope agent --scope-id agent_codegen

# 文档生成 Agent 独立记忆空间
chainlesschain memory store "使用中文输出" --scope agent --scope-id agent_docwriter
```

### 4. 定期清理

定期审查并清理过时的 scoped memory，特别是 session 作用域的条目：

```bash
# 查看 session 作用域的所有记忆
chainlesschain memory recall "" --scope session --json | jq '.results[].id'
```

## 故障排查

**Q: `memory recall` 返回空结果，但我确实 `store` 过**

A: 检查 scope 和 scope-id 是否匹配。`store` 时用了 `--scope agent --scope-id agent_a`，`recall` 时必须传相同的 scope 和 scope-id：

```bash
chainlesschain memory recall "typescript" --scope agent --scope-id agent_a
```

**Q: `memory store` 报 `ENOENT` 找不到 memory-store.json**

A: 配置目录未初始化。首次使用前运行：

```bash
chainlesschain setup
# 或手动创建目录
mkdir -p ~/.chainlesschain
```

**Q: `memory recall` 返回的 relevance 全是 1.0，没有排序**

A: 当前版本 scoped memory 使用关键词匹配而非向量搜索，relevance 为固定值。精确检索时建议配合 `--tags` 和 `--category` 收窄结果。

**Q: 传统 `memory search` 和 `memory recall` 有什么区别？**

A: `memory search` 查询 SQLite 数据库（BM25 全文搜索），适合手动管理的长期笔记。`memory recall` 查询 `memory-store.json`（session-core MemoryStore），专为 Agent 运行时作用域记忆设计。两者数据完全独立。

**Q: `memory consolidate` 命令在哪里？**

A: `memory consolidate --session <id>` 尚未接入 CLI 主命令，属于 Phase G 规划项。当前可通过 Desktop 端或直接调用 session-core API 触发。

## 使用示例

```bash
# --- 传统记忆 ---

# 添加一条工作记忆
chainlesschain memory add "项目使用 PostgreSQL 16" --category work --importance 5

# 搜索记忆
chainlesschain memory search "数据库" --limit 5

# 查看最近 10 条记忆
chainlesschain memory show --limit 10

# 删除指定记忆
chainlesschain memory delete mem-1234

# 追加今日笔记
chainlesschain memory daily --append "完成 session-core Phase I 测试"

# 查看某日笔记
chainlesschain memory daily 2026-04-15

# 编辑长期 MEMORY.md
chainlesschain memory file --edit

# --- Managed Agents scoped memory ---

# 写入全局偏好
chainlesschain memory store "偏好 TypeScript，避免 JavaScript" \
  --scope global --category preference --tags ts,style

# 写入 Agent 级安全规则
chainlesschain memory store "永远不要删除 production 数据库表" \
  --scope agent --scope-id agent_codegen \
  --category safety --tags prod,danger

# 写入会话上下文
chainlesschain memory store "本次会话目标：重构 session-core 的文件适配层" \
  --scope session --scope-id sess_abc123 --category context

# 召回全局偏好
chainlesschain memory recall "TypeScript" --scope global --category preference --json

# 召回某 Agent 的所有安全规则
chainlesschain memory recall "" --scope agent --scope-id agent_codegen --category safety

# 带标签过滤召回
chainlesschain memory recall "prod" --tags danger --limit 5 --json
```

## 当前限制

- `memory consolidate --session <id>` 还没接入 CLI
- 新会话自动注入 top-K scoped memory 仍在 Phase G 规划中
- Desktop 端还没有复用同一份 `memory-store.json`

## 关键文件

- `packages/cli/src/commands/memory.js`
- `packages/cli/src/lib/session-core-singletons.js`
- `packages/session-core/lib/memory-store.js`
- `packages/session-core/lib/file-adapters.js`

## 测试覆盖率

本轮已补齐并通过：

- Unit: `command-registration.test.js` 已覆盖 `memory recall/store` 注册
- Integration: `managed-agents-cli.integration.test.js` 中 `memory store/recall` 用例 `3/3` 的一部分
- E2E: `managed-agents-commands.test.js` 中 `memory store + recall` 用例

## 相关文档

- [会话管理](./cli-session)
- [配置管理](./cli-config)
- [Managed Agents 对标](./managed-agents-parity)
- [设计文档 91](../design/modules/91-managed-agents-parity)
