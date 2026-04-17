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

## 相关文档

- 设计文档: `docs/design/modules/49_多模态感知层.md`
- 管理器: `packages/cli/src/lib/perception.js`
- 命令: `packages/cli/src/commands/perception.js`
