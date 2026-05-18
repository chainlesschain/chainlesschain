# 多模态感知引擎 (perception)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **多模态记录**: 支持 `screen` / `voice` / `document` / `video` 四种模态，按分析类型 (ocr/object_detection/scene_recognition/action_detection) 细分
- **语音会话状态机**: `idle` → `recording` → `transcribing` → `completed` 全流程追踪
- **跨模态索引**: 对任意感知结果建索引（摘要 + tags），支持跨模态文本查询
- **上下文快照**: 聚合最近感知状态为"感知上下文"供 Agent 消费

## 概述

ChainlessChain CLI 多模态感知引擎 (Phase 84) 是 Desktop 端 Multimodal Perception Engine 的 CLI 移植。CLI 侧侧重"记录-索引-查询"三阶段: 用 `record` 登记任一模态的分析结果，用 `index-add` 建立可搜索条目，再用 `query` 跨模态检索。语音专用 `voice-start/status/transcript` 管理会话生命周期。

## 命令参考

### perception modalities / voice-statuses / analysis-types — 枚举目录

```bash
chainlesschain perception modalities [--json]       # screen, voice, document, video
chainlesschain perception voice-statuses [--json]   # idle, recording, transcribing, completed
chainlesschain perception analysis-types [--json]   # ocr, object_detection, scene_recognition, action_detection
```

### perception record — 记录感知结果

```bash
chainlesschain perception record -m screen -a ocr -i screenshot-123 -r '{"text":"hello"}' -c 0.92
chainlesschain perception record -m video -a action_detection -r '{"actions":["walking"]}' --json
```

记录一次感知分析结果。`-m` 模态 (必填)，`-a` 分析类型，`-i` 源 ID，`-r` 结果 JSON，`-c` 置信度 (0-1)。

### perception show / results — 查看感知结果

```bash
chainlesschain perception show <result-id>
chainlesschain perception results -m screen -a ocr --limit 50 --json
```

`show` 查看单条详情；`results` 列出结果，支持按模态和分析类型过滤。

### perception voice-start — 启动语音会话

```bash
chainlesschain perception voice-start
chainlesschain perception voice-start -l zh-CN -m whisper-large --json
```

创建语音会话 (初始状态 `idle`)。`-l` 语言代码，`-m` 模型名。

### perception voice-status — 更新会话状态

```bash
chainlesschain perception voice-status <session-id> recording
chainlesschain perception voice-status <session-id> completed --json
```

状态转换需遵循 `idle → recording → transcribing → completed` 顺序。

### perception voice-transcript — 设置转写内容

```bash
chainlesschain perception voice-transcript <session-id> "hello world"
chainlesschain perception voice-transcript <session-id> "你好世界" --json
```

### perception voice-show / voice-sessions — 查看语音会话

```bash
chainlesschain perception voice-show <session-id>
chainlesschain perception voice-sessions -s completed -l zh-CN --limit 50 --json
```

### perception index-add — 添加索引条目

```bash
chainlesschain perception index-add -m screen -s screenshot-123 -c "购物车页面" -t "shopping,cart"
chainlesschain perception index-add -m document -s doc-42 -c "季度财报摘要" -t "finance,q1" --json
```

对感知结果建立可搜索索引。`-s` 源 ID，`-c` 摘要文本，`-t` 逗号分隔 tags。

### perception index-show / index-list / index-remove — 索引管理

```bash
chainlesschain perception index-show <index-id>
chainlesschain perception index-list -m screen --limit 50 --json
chainlesschain perception index-remove <index-id> --json
```

### perception query — 跨模态搜索

```bash
chainlesschain perception query "shopping cart"
chainlesschain perception query "财报" -m document,screen --limit 10 --json
```

基于摘要和 tags 的文本匹配搜索。`-m` 限定模态 CSV。

### perception context — 感知上下文快照

```bash
chainlesschain perception context
chainlesschain perception context --json
```

返回最近感知结果汇总、活跃语音会话、索引统计等聚合上下文。

### perception stats — 感知引擎统计

```bash
chainlesschain perception stats
chainlesschain perception stats --json
```

显示各模态/分析类型的计数、语音会话状态分布、索引条目数等。

## 数据存储

所有数据持久化到 SQLite (`_perception_results` / `_perception_voice_sessions` / `_perception_index` 三张表)，首次执行子命令时自动建表。

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│        chainlesschain perception (Phase 84)          │
├─────────────────────────────────────────────────────┤
│  Record                 │  Voice Session             │
│  4 modalities ×         │  idle → recording →        │
│  4 analysis types       │  transcribing → completed  │
├─────────────────────────────────────────────────────┤
│  Index (cross-modal)                                 │
│  summary + tags → searchable                         │
├─────────────────────────────────────────────────────┤
│  Query (cross-modal text)   │  Context Snapshot      │
│  -m modality CSV filter     │  recent results + stats│
├─────────────────────────────────────────────────────┤
│  SQLite: _perception_results / _voice_sessions /     │
│          _perception_index                           │
└─────────────────────────────────────────────────────┘
```

三阶段：**记录**（`record` 任一模态结果）→ **索引**（`index-add` 摘要+tags）→ **查询**
（`query` 跨模态文本匹配）。语音流程走独立的状态机（`voice-start/status/transcript`）。

## 配置参考

| 配置项                    | 含义                  | 默认                            |
| ------------------------- | --------------------- | ------------------------------- |
| `modalities`              | 支持的模态            | screen / voice / document / video |
| `analysis-types`          | 分析类型              | ocr / object_detection / scene_recognition / action_detection |
| `voice-statuses`          | 语音会话状态          | idle / recording / transcribing / completed |
| `confidence` 范围         | `-c` 置信度           | 0.0 – 1.0                       |
| V2 sensor maturity (Phase 84) | 5 态 sensor + 5 态 capture lifecycle | 见 `perception_v2_phase84_cli.md` |

## 性能指标

| 操作                         | 典型耗时          |
| ---------------------------- | ----------------- |
| record 写入                  | < 15 ms           |
| index-add                    | < 15 ms           |
| query（1000 条索引）         | < 30 ms           |
| voice-status 转换            | < 5 ms            |
| context 快照聚合             | < 30 ms           |
| V2 capture processing timeout | 可配置            |

## 测试覆盖率

```
__tests__/unit/perception.test.js — 96 tests (1054 lines)
```

覆盖：4 种模态 record、4 种分析类型、voice 状态机全路径（含非法转换拒绝）、
index-add/remove、query 跨模态文本匹配（summary + tags）、context 快照、
JSON 输出一致性。V2 surface：96 V2 tests（见 `perception_v2_phase84_cli.md`）。

## 安全考虑

1. **感知数据本地存** — 所有模态结果仅存本地 SQLite；不会自动上传
2. **置信度透明** — `-c` 字段便于下游按阈值过滤，防止低置信结果误用
3. **语音状态机约束** — 强制 `idle → recording → transcribing → completed` 顺序，避免漏步
4. **索引元数据有限** — 仅 summary + tags，原始感知数据由 source-id 间接引用
5. **删除级联** — `index-remove` 不删除 result，避免误删已引用数据

## 故障排查

**Q: `voice-status` 报非法转换?**

状态机强制单向：`idle → recording → transcribing → completed`；不能跳步或倒退。
需重新 `voice-start` 开新会话。

**Q: `query` 返回空但索引中明显有匹配?**

1. `index-list` 检查 summary + tags 是否包含关键词
2. 查询是字符串匹配（非向量）；用 tag 精确过滤更有效
3. `-m` 限定的模态是否正确

**Q: V2 sensor 自动 offline?**

V2 下 sensor 有 heartbeat 超时；若长时间未 record 新结果会自动置为 offline。
运行 `heartbeat` 或新建 `record` 刷新。

## 关键文件

- `packages/cli/src/commands/perception.js` — Commander 子命令（~675 行）
- `packages/cli/src/lib/perception.js` — 4 模态 + 4 分析 + 跨模态索引
- `packages/cli/__tests__/unit/perception.test.js` — 单测（96 tests）
- 数据表：`_perception_results` / `_perception_voice_sessions` / `_perception_index`
- 设计文档：`docs/design/modules/49_多模态感知层.md`

## 使用示例

```bash
# 1. 记录多模态感知
chainlesschain perception record -m screen -a ocr -i shot-001 -r '{"text":"购物车"}' -c 0.92
chainlesschain perception record -m video -a action_detection -r '{"actions":["walking"]}'

# 2. 建立跨模态索引
chainlesschain perception index-add -m screen -s shot-001 -c "购物车页面" -t "shopping,cart"
chainlesschain perception index-add -m document -s doc-42 -c "Q1 财报摘要" -t "finance,q1"

# 3. 查询
chainlesschain perception query "shopping"
chainlesschain perception query "财报" -m document,screen --limit 10

# 4. 语音会话全流程
sess=$(chainlesschain perception voice-start -l zh-CN --json | jq -r .id)
chainlesschain perception voice-status $sess recording
chainlesschain perception voice-status $sess transcribing
chainlesschain perception voice-transcript $sess "你好世界"
chainlesschain perception voice-status $sess completed

# 5. 感知上下文快照
chainlesschain perception context --json
chainlesschain perception stats
```

## 相关文档

- 设计文档: `docs/design/modules/49_多模态感知层.md`
- 管理器: `packages/cli/src/lib/perception.js`
- 命令: `packages/cli/src/commands/perception.js`
- [Multimodal →](/chainlesschain/cli-mm)
- [Browser Automation →](/chainlesschain/cli-browse)
