# CLI — Platform Services

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)
>
> Covers: Phase 9 Low-Code, EvoMap, CLI-Anything, Server & Web Panel, AI Orchestration.

## Phase 9: Low-Code & Multi-Agent

```bash
chainlesschain lowcode create / components / publish
```

## EvoMap & CLI-Anything

```bash
chainlesschain evomap search / download / publish / list / hubs
chainlesschain cli-anything doctor / scan / register / list / remove
```

## Server & Web Panel

```bash
chainlesschain serve                            # WebSocket 服务器 (端口 18800)
chainlesschain serve --port 9000 --token <s>    # 自定义端口 + 鉴权
chainlesschain serve --bundle ./agent-bundle    # 为所有会话加载 bundle (AGENTS.md + MCP + 审批)
chainlesschain ui                               # Web 面板 (端口 18810)
chainlesschain ui --port 18810 --ws-port 18800 --token <s>
```

## AI Orchestration

```bash
chainlesschain orchestrate "task"               # 自动检测 AI Agent
chainlesschain orchestrate "task" --backends claude,gemini --strategy parallel-all
chainlesschain orchestrate detect               # 检测 AI CLI 工具
chainlesschain orchestrate --status [--json]    # 查看状态
chainlesschain orchestrate --webhook [--webhook-port 9090]
```

## Phase 63: Universal Runtime (`runtime`)

统一应用运行时 — 插件生命周期、热更新/回滚、运行时剖析、状态同步、平台信息、健康检查、指标。

**目录**:
```bash
chainlesschain runtime plugin-statuses [--json]     # loading/active/suspended/error/unloaded
chainlesschain runtime update-types [--json]        # patch/minor/major/rollback
chainlesschain runtime health-levels [--json]       # healthy/degraded/critical
chainlesschain runtime profile-types [--json]       # cpu/memory/flamegraph
```

**插件生命周期**:
```bash
chainlesschain runtime plugin-load -n <name> [-v version] [-c config-json] [-a apis-json] [-p perms-json] [--json]
chainlesschain runtime plugin-unload <id> [--json]
chainlesschain runtime plugin-status <id> <status> [--json]
chainlesschain runtime plugin-show <id> [--json]
chainlesschain runtime plugins [-s status] [--limit N] [--json]
```

**热更新 / 回滚**:
```bash
chainlesschain runtime hot-update <pluginId> <newVersion> [-t patch|minor|major] [--json]
chainlesschain runtime rollback <updateId> [--json]
chainlesschain runtime updates [-p pluginId] [--limit N] [--json]
```

**剖析**:
```bash
chainlesschain runtime profile [-t cpu|memory|flamegraph] [-d ms] [--json]
chainlesschain runtime profile-show <id> [--json]
chainlesschain runtime profiles [-t type] [--limit N] [--json]
```

**状态同步 (LWW 键值)**:
```bash
chainlesschain runtime state-set <key> <value> [--json]       # value 可为 JSON 或字符串
chainlesschain runtime state-get <key> [--json]
chainlesschain runtime state-list [--limit N] [--json]
chainlesschain runtime state-delete <key> [--json]
```

**平台 / 健康 / 指标 / 配置**:
```bash
chainlesschain runtime platform [--json]      # OS/arch/Node/CPU/memory/PID
chainlesschain runtime health [--json]        # 堆使用率 + 插件计数 + 错误数
chainlesschain runtime metrics [--json]       # 运行时计数器
chainlesschain runtime configure <key> <value> [--json]
chainlesschain runtime config [--json]
chainlesschain runtime stats [--json]
```

> **未移植**: 真实插件沙箱、Yjs CRDT 合并、真实 Flame Graph 采样、差量热补丁、自愈定时器。CLI 只是一次性调用，状态同步为最后写入胜出 (LWW) 而非真正的 CRDT。

## IPFS 去中心化存储 (Phase 17)

Phase 17 Desktop IPFS 模块的 CLI 端口 —— 不依赖真实 libp2p/Helia，使用确定性 CID 模拟 (`bafy` + sha256 hex 前缀) + AES-256-GCM 加密 + 配额/垃圾回收 + 知识附件链接。

**节点生命周期 / 模式**:
```bash
chainlesschain ipfs node-start [--mode light|full|gateway] [--json]
chainlesschain ipfs node-stop [--json]
chainlesschain ipfs node-status [--json]
chainlesschain ipfs set-mode <mode> [--json]
chainlesschain ipfs modes [--json]
chainlesschain ipfs statuses [--json]
```

**内容存取**:
```bash
chainlesschain ipfs add [-f <file>] [-t text|json] [--json-body <string>] [--encrypt] [--passphrase <p>] [--json]
chainlesschain ipfs get <cid> [--passphrase <p>] [--json]
chainlesschain ipfs show <cid> [--json]
chainlesschain ipfs list [--type text|json|binary] [--limit N] [--json]
```

**钉选 / 统计 / 回收 / 配额**:
```bash
chainlesschain ipfs pin <cid> [--json]
chainlesschain ipfs unpin <cid> [--json]
chainlesschain ipfs pins [--json]
chainlesschain ipfs stats [--json]
chainlesschain ipfs gc [--json]                                 # 清理未钉选内容
chainlesschain ipfs set-quota <bytes> [--json]
```

**知识库附件**:
```bash
chainlesschain ipfs attach <cid> --knowledge-id <id> [--json]
chainlesschain ipfs attachments --knowledge-id <id> [--json]
```

> **未移植**: 真实 libp2p/Helia 节点、DHT 发现、真实 CID v1 计算、gateway HTTP 服务。CLI 仅本地 SQLite 模拟，生产侧仍走桌面端原生实现。

## 多模态协作 (Phase 27)

Phase 27 Desktop 多模态协作层的 CLI 端口 —— 5 种模态 (text/document/image/audio/screen) + 加权融合 + 原生解析 (txt/md/csv/json) + 上下文构建 (4000 token cap) + 6 种输出格式 (markdown/html/chart/slides/json/csv)。

**会话 / 模态目录**:
```bash
chainlesschain multimodal modalities [--json]          # 5 模态 + 权重
chainlesschain multimodal input-formats [--json]       # 7 输入格式
chainlesschain multimodal output-formats [--json]      # 6 输出格式
chainlesschain multimodal statuses [--json]
```

**会话生命周期**:
```bash
chainlesschain mm session-create [--title <t>] [--metadata <json>] [--json]
chainlesschain mm session-show <sessionId> [--json]
chainlesschain mm sessions [--status active|completed] [--limit N] [--json]
chainlesschain mm session-complete <sessionId> [--json]
chainlesschain mm session-delete <sessionId> [--json]
```

**添加 / 查看模态**:
```bash
chainlesschain mm add <sessionId> <modality> [-c <content>] [-f <file>] [--json]
chainlesschain mm modalities-of <sessionId> [--json]
```

**融合 / 文档解析**:
```bash
chainlesschain mm fuse <sessionId> [--json]            # 按权重拼接
chainlesschain mm parse <file> [--json]                # 原生: txt/md/csv/json
```

**上下文 / 输出**:
```bash
chainlesschain mm build-context <sessionId> [--max-tokens N] [--json]
chainlesschain mm get-context <sessionId> [--json]
chainlesschain mm clear-context <sessionId> [--json]
chainlesschain mm trim-context <sessionId> --max-tokens N [--json]
chainlesschain mm generate <sessionId> <format> [--json]   # 生成并存入 artifacts
chainlesschain mm artifacts <sessionId> [--type input|output] [--modality <m>] [--limit N] [--json]
chainlesschain mm stats [--json]
```

> **未移植**: 真实 PDF/DOCX/XLSX 解析 (报告 `parser_not_available`)、图像/音频/屏幕内容自动 OCR/ASR、浏览器端 Reveal.js / ECharts 交互渲染。CLI 仅做轻量文本流水线，生成产物是 HTML/JSON/Markdown 骨架。
