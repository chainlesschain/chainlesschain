# CLI — Platform Services

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)
>
> Covers: Phase 9 Low-Code, EvoMap, CLI-Anything, Server & Web Panel, AI Orchestration.

## Phase 9: Low-Code & Multi-Agent

```bash
chainlesschain lowcode create / components / publish
```

### Phase 93 — Low-Code Platform V2 (`lowcode` extension)

V2 canonical surface — strictly additive on the legacy `create / list / preview / publish / components / datasource / versions / rollback / export / deploy` commands. Adds frozen enums, validated data source registration with heuristic connection check, a proper status state machine (`draft ↔ published ↔ archived`, with `archived → published` blocked — must go via draft), app cloning, and canonical JSON import/export.

**Frozen enums**:
```bash
chainlesschain lowcode categories [--json]         # input/display/chart/layout/overlay
chainlesschain lowcode datasource-types [--json]   # rest/graphql/database/csv
chainlesschain lowcode statuses [--json]           # draft/published/archived
```

**Components V2 (with category filter)**:
```bash
chainlesschain lowcode components-v2 [-c category] [--json]
```

**Data sources V2**:
```bash
chainlesschain lowcode datasource-v2 <app-id> <name> <type> [--config <json>]
chainlesschain lowcode test-connection <datasource-id> [--json]
# REST → needs config.url; GraphQL → config.endpoint; DB → config.host; CSV → config.path
```

**Status state machine**:
```bash
chainlesschain lowcode set-status <app-id> <status>    # validated transition
chainlesschain lowcode archive <app-id>                # shortcut to archived
chainlesschain lowcode status-history <app-id> [--json]
```

Legacy `deployed` status is treated as `published` for transition purposes.

**Clone / import / export**:
```bash
chainlesschain lowcode clone <source-id> [--name <new>]
chainlesschain lowcode export-json <app-id> [-o file]  # schema=chainlesschain.lowcode.v2
chainlesschain lowcode import-json <file>              # imports app + valid data sources
chainlesschain lowcode stats-v2 [--json]
```

**Scope / 未移植 (Desktop-only)**:
- Live component canvas + drag-drop design surface — Desktop renderer only.
- Real SaaS connector execution (Airtable / Notion sync) — Desktop only.
- Multi-platform compile (web → mobile → desktop) — Desktop only.

The CLI port handles record-keeping and state transitions: enum validation, connection heuristics, status history, clone/import/export schema.


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

### Phase 63 V2 — Plugin Maturity + Runtime Task Lifecycle

V2 strictly additive in-memory surface. 4-state plugin maturity (draft/active/deprecated/retired) + 5-state runtime-task lifecycle (queued/running/completed/failed/canceled, 3 terminals). Per-owner active-plugin cap, per-owner running-task cap, auto-retire idle plugins, auto-fail stuck running tasks. `startedAt` stamped once on first RUNNING transition.

```bash
# Enum catalog
cc runtime plugin-maturities-v2 | runtime-task-lifecycles-v2

# Config
cc runtime default-max-active-plugins-per-owner | max-active-plugins-per-owner | set-max-active-plugins-per-owner <n>
cc runtime default-max-running-tasks-per-owner  | max-running-tasks-per-owner  | set-max-running-tasks-per-owner <n>
cc runtime default-plugin-idle-ms | plugin-idle-ms | set-plugin-idle-ms <ms>
cc runtime default-task-stuck-ms  | task-stuck-ms  | set-task-stuck-ms <ms>

# Counts
cc runtime active-plugin-count [-o <owner>]
cc runtime running-task-count [-o <owner>]

# Plugin lifecycle
cc runtime register-plugin-v2 <plugin-id> -o <owner> [-n <name>] [-v <version>] [-i <initial>] [-m <metadata>]
cc runtime plugin-v2 <plugin-id>
cc runtime set-plugin-maturity-v2 <plugin-id> <status> [-r <reason>] [-m <metadata>]
cc runtime activate-plugin-v2 | deprecate-plugin-v2 | retire-plugin-v2 <plugin-id> [-r <reason>]
cc runtime touch-plugin-invocation <plugin-id>

# Task lifecycle
cc runtime enqueue-runtime-task-v2 <task-id> -o <owner> -p <plugin> -k <kind> [-m <metadata>]
cc runtime runtime-task-v2 <task-id>
cc runtime set-runtime-task-status-v2 <task-id> <status> [-r <reason>] [-m <metadata>]
cc runtime start-runtime-task | complete-runtime-task | fail-runtime-task | cancel-runtime-task <task-id> [-r <reason>]

# Bulk auto-flips
cc runtime auto-retire-idle-plugins
cc runtime auto-fail-stuck-runtime-tasks

# All-enum-key zero-init stats
cc runtime stats-v2
```

Defaults: 40 active plugins/owner, 5 running tasks/owner, 90d idle, 4h stuck. 87 tests cover legacy + V2.

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

### Phase 17 V2 — Gateway Maturity + Pin Lifecycle

V2 strictly additive in-memory surface. 5-state gateway maturity (onboarding/active/degraded/offline/retired) + 4-state pin lifecycle (pending/pinned/unpinned/failed, with `failed→pending` retry path). Per-operator active-gateway cap, per-owner pending-pin cap, auto-offline stale gateways (active/degraded), auto-fail stale pending pins.

```bash
# Enum catalog
cc ipfs gateway-maturities-v2 | pin-lifecycles-v2

# Config (per-operator / per-owner caps, idle/pending timeouts)
cc ipfs default-max-active-gateways-per-operator | max-active-gateways-per-operator | set-max-active-gateways-per-operator <n>
cc ipfs default-max-pending-pins-per-owner | max-pending-pins-per-owner | set-max-pending-pins-per-owner <n>
cc ipfs default-gateway-idle-ms | gateway-idle-ms | set-gateway-idle-ms <ms>
cc ipfs default-pin-pending-ms | pin-pending-ms | set-pin-pending-ms <ms>

# Counts
cc ipfs active-gateway-count [-o <operator>]
cc ipfs pending-pin-count [-o <owner>]

# Gateway lifecycle
cc ipfs register-gateway-v2 <gateway-id> -o <operator> [-e <endpoint>] [-i <initial-status>] [-m <metadata-json>]
cc ipfs gateway-v2 <gateway-id>
cc ipfs set-gateway-maturity-v2 <gateway-id> <status> [-r <reason>] [-m <metadata>]
cc ipfs activate-gateway | degrade-gateway | offline-gateway | retire-gateway <gateway-id> [-r <reason>]
cc ipfs touch-gateway-heartbeat <gateway-id>

# Pin lifecycle (pinnedAt stamp-once on first PINNED transition)
cc ipfs register-pin-v2 <pin-id> -o <owner> -c <cid> [-z <size>] [-i <initial>] [-m <metadata>]
cc ipfs pin-v2 <pin-id>
cc ipfs set-pin-status-v2 <pin-id> <status> [-r <reason>] [-m <metadata>]
cc ipfs confirm-pin | fail-pin | unpin-v2 <pin-id> [-r <reason>]

# Bulk auto-flips (use current clock)
cc ipfs auto-offline-stale-gateways
cc ipfs auto-fail-stale-pending-pins

# All-enum-key zero-init stats
cc ipfs stats-v2
```

Defaults: 20 active gateways/operator, 100 pending pins/owner, 60d idle, 24h pending. 83 tests cover legacy + V2.

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

### Phase 27 V2 — Session Maturity + Artifact Lifecycle

```bash
chainlesschain mm session-maturities-v2 | artifact-lifecycles-v2 [--json]
chainlesschain mm default-max-active-sessions-per-owner | max-active-sessions-per-owner | set-max-active-sessions-per-owner <n>
chainlesschain mm default-max-artifacts-per-session     | max-artifacts-per-session     | set-max-artifacts-per-session <n>
chainlesschain mm default-session-idle-ms   | session-idle-ms   | set-session-idle-ms <ms>
chainlesschain mm default-artifact-stale-ms | artifact-stale-ms | set-artifact-stale-ms <ms>
chainlesschain mm active-session-count [-o owner]
chainlesschain mm artifact-count [-s session]
chainlesschain mm register-session-v2 <session-id> -o <owner> [-t|-i|-m]
chainlesschain mm session-v2 <session-id>
chainlesschain mm set-session-maturity-v2 <session-id> <status> [-r|-m]
chainlesschain mm activate-session | pause-session | complete-session-v2 | archive-session <session-id> [-r]
chainlesschain mm touch-session-activity <session-id>
chainlesschain mm register-artifact-v2 <artifact-id> -s <session> -M <modality> [-z|-i|-m]
chainlesschain mm artifact-v2 <artifact-id>
chainlesschain mm set-artifact-status-v2 <artifact-id> <status> [-r|-m]
chainlesschain mm mark-artifact-ready | purge-artifact <artifact-id> [-r]
chainlesschain mm touch-artifact-access <artifact-id>
chainlesschain mm auto-archive-idle-sessions
chainlesschain mm auto-purge-stale-artifacts
chainlesschain mm stats-v2
```

## 性能自动调优 (Phase 22)

Phase 22 Desktop 性能自动调优系统的 CLI 端口 —— 真实 `os.cpus/freemem` + `process.memoryUsage` 采样 + SQLite 环形缓冲区 (默认 8640 样本) + 5 条内置规则 + 滞后保护 + 冷却窗口。**CLI 只报告建议，不自动执行任何优化动作**。

**内置规则目录 / 状态**:
```bash
chainlesschain perf rules [--json]                # 5 条内置规则 + 实时状态
chainlesschain perf rule-show <ruleId> [--json]   # 单条规则 + 触发次数
chainlesschain perf rule-enable <ruleId> [--json]
chainlesschain perf rule-disable <ruleId> [--json]
chainlesschain perf levels [--json]               # info / warning / critical
chainlesschain perf rule-statuses [--json]        # pending / applied / dismissed
```

**采样 / 环形缓冲**:
```bash
chainlesschain perf collect [--slow-queries N] [--json]       # 采一条
chainlesschain perf metrics [--json]                          # 最近一条 (没有就现场采)
chainlesschain perf samples [--limit N] [--since-ms ms] [--json]
chainlesschain perf clear-history [--json]                    # 清空环形缓冲
```

**规则评估 / 建议**:
```bash
chainlesschain perf evaluate [--collect] [--slow-queries N] [--json]
# 评估规则, 通过滞后+冷却检查后写入 recommendation (pending) + history (trigger)
chainlesschain perf recommendations [--status pending|applied|dismissed] [--limit N] [--json]
chainlesschain perf apply <id> [-n <note>] [--json]           # 手动标记已应用
chainlesschain perf dismiss <id> [-n <note>] [--json]         # 手动驳回
```

**历史 / 告警 / 配置 / 报告**:
```bash
chainlesschain perf history [--rule-id <id>] [--limit N] [--json]
chainlesschain perf alerts [--json]                # 阈值告警 (CPU / mem / heap / load/c)
chainlesschain perf config [--max-samples N] [--interval-ms N] [--threshold metric=value] [--json]
chainlesschain perf stats [--json]
chainlesschain perf report [--json]                # 完整报告: sample + alerts + stats + pending
```

> **未移植**: IPC 拦截器、数据库查询包装器、自动调优定时器、EventEmitter 事件总线、自动 VACUUM / GC 操作、Electron 进程 handle count。CLI 是一次性调用，无后台调优循环；规则动作列为建议文本，不自动执行。`slowQueries` 计数器需外部通过 `--slow-queries N` 注入。

## 去中心化 Agent 网络 (Phase 24)

Phase 24 Desktop 去中心化 Agent 网络的 CLI 端口 —— Ed25519 Agent DID (`did:chainless:{hash}`) + W3C VC 凭证 + 联邦注册 (Kademlia k-bucket 模拟) + 挑战-响应认证 + 跨组织任务路由 + 4 维声誉 (reliability/quality/speed/cooperation, 加权平均)。

**目录 / 常量**:
```bash
chainlesschain agent-network config [--json]            # 网络常量 + 声誉权重
chainlesschain agent-network dimensions [--json]        # 4 声誉维度
chainlesschain agent-network task-statuses [--json]     # pending|routed|running|completed|failed|cancelled
```

**DID 管理** (别名 `anet`):
```bash
chainlesschain anet did-create [-n name] [-m metadata-json] [--json]
chainlesschain anet did-resolve <did> [--json]
chainlesschain anet dids [-s active|deactivated] [--limit N] [--json]
chainlesschain anet did-deactivate <did> [--json]
chainlesschain anet sign <did> <data> [--json]          # Ed25519 签名
chainlesschain anet verify <did> <data> <sig> [--json]  # 验证签名
```

**联邦注册**:
```bash
chainlesschain anet register <did> <orgId> [-c caps-json] [-e endpoint] [--json]
chainlesschain anet unregister <did> [--json]
chainlesschain anet heartbeat <did> [--json]
chainlesschain anet discover [-c capability] [-o orgId] [-s online|offline] [--json]
chainlesschain anet sweep [--json]                      # 超时 → offline
```

**Kademlia peer 簿记** (非真实 DHT, k-bucket 由 SHA256 前缀计算):
```bash
chainlesschain anet peer-add <peerId> [-e endpoint] [-d did] [--json]
chainlesschain anet peer-remove <peerId> [--json]
chainlesschain anet peers [-b bucket] [--limit N] [--json]
```

**挑战-响应认证**:
```bash
chainlesschain anet auth-start <did> [--json]
chainlesschain anet auth-complete <sessionId> <signature> [--json]
chainlesschain anet auth-validate <token> [--json]
chainlesschain anet auth-sessions [-d did] [-s pending|active|expired] [--json]
```

**W3C VC 凭证** (Ed25519 proof):
```bash
chainlesschain anet credential-issue <issuerDid> <subjectDid> [-t type] [-c claims-json] [--expires-at ms] [--json]
chainlesschain anet credential-verify <id> [--json]     # 签名 + 过期 + 撤销校验
chainlesschain anet credential-revoke <id> [--json]
chainlesschain anet credential-show <id> [--json]
chainlesschain anet credentials [-s subject] [-i issuer] [--status active|revoked] [-t type] [--json]
```

**跨组织任务路由** (按声誉权重挑选最佳 Agent):
```bash
chainlesschain anet task-route <sourceOrg> <taskType> [-t targetOrg] [-r requirements-json] [-p payload-json] [--json]
chainlesschain anet task-show <taskId> [--json]
chainlesschain anet task-status <taskId> <status> [-r result-json] [--json]
chainlesschain anet task-cancel <taskId> [-r reason] [--json]
chainlesschain anet tasks [-o orgId] [-d did] [-s status] [--json]
```

**声誉 (加权平均, 0..5)**:
```bash
chainlesschain anet rep-update <did> <dimension> <score> [-e evidence] [--json]
chainlesschain anet rep-show <did> [--json]            # 总分 + 每维度均值
chainlesschain anet rep-history <did> [--limit N] [--json]
chainlesschain anet rep-top [-d dimension] [--limit N] [--json]
chainlesschain anet stats [--json]                     # 所有表的按状态聚合
```

> **未移植**: 真实 libp2p / Kademlia DHT 节点、真实 Peer 同步、AES-256-CBC 私钥加密 (CLI 以 hex 明文存私钥)、EventEmitter 事件总线、后台心跳/清理定时器、Electron 多进程隔离、reputation 时间衰减定时器。CLI 为单进程一次性调用，k-bucket 仅从 SHA256 前缀计算并存 SQLite 行；任务路由按注册表 + 声誉打分同步挑选，不做真正的远程执行；`sweep` 需要用户主动调用。

---

## 去中心化身份 2.0 (Phase 55)

CLI 端口 `docs/design/modules/55_去中心化身份2.0.md`：W3C DID v2.0（did:key / did:web / did:chain）+ Verifiable Presentations（可验证展示，选择性披露）+ 社交恢复（k-of-n 守护人分片）+ 身份漫游 + 多源声誉聚合。

别名 `cc didv2`。全部子命令共用 Ed25519 密钥（Node `crypto.generateKeyPairSync('ed25519')`，SPKI/PKCS8 DER hex）。

**目录 / 配置**:
```bash
chainlesschain did-v2 config [--json]
chainlesschain did-v2 methods [--json]                 # key | web | chain
chainlesschain did-v2 cred-statuses [--json]
chainlesschain did-v2 recovery-statuses [--json]
```

**DID 生命周期**:
```bash
chainlesschain did-v2 create [-m key|web|chain] [-d domain]
                             [-s servicesJSON] [-g guardiansJSON] [-t threshold]
                             [--json]
chainlesschain did-v2 resolve <did> [--json]
chainlesschain did-v2 list [-m method] [-s status] [--json]
chainlesschain did-v2 revoke <did> [--json]             # 将 status 置为 revoked
```

**W3C Verifiable Credentials**:
```bash
chainlesschain did-v2 cred-issue -h <holderDid> -i <issuerDid> -t <type>
                                  [-s subjectJSON] [-e expiresMs] [--json]
chainlesschain did-v2 cred-show <id> [--json]
chainlesschain did-v2 creds [-h holder] [-i issuer] [-s status] [--json]
chainlesschain did-v2 cred-revoke <id> [-r reason] [--json]
```

**Verifiable Presentations（选择性披露 + ZKP 占位）**:
```bash
chainlesschain did-v2 present -h <holderDid> -c <credIds,csv>
                               [-r recipientDid] [-d fieldsCSV] [--ttl ms]
                               [--zkp] [--json]
chainlesschain did-v2 verify <id> [--json]              # 验证签名 + 所依赖凭证仍有效
chainlesschain did-v2 vp-show <id> [--json]
chainlesschain did-v2 presentations [-h holder] [--json]
```

**社交恢复（k-of-n 守护人分片）**:
```bash
chainlesschain did-v2 recover-start -d <did> -s <sharesJSON>
                                     # sharesJSON = [{guardian, share}, ...]
                                     # 仅接受 guardian ∈ DID 的守护人列表
chainlesschain did-v2 recover-complete <recoveryId>     # 门限达成后轮换密钥
chainlesschain did-v2 recoveries [-d did] [--json]
chainlesschain did-v2 recovery-show <id> [--json]
```

**身份漫游**:
```bash
chainlesschain did-v2 roam -d <did> -t <targetPlatform>
                           [-s sourcePlatform] [-p migrationProof] [--json]
chainlesschain did-v2 roaming-log [-d did] [--json]
```

**多源声誉聚合（on-chain=1.3 / marketplace=1.1 / social=1.0 / 其它=1.0）**:
```bash
chainlesschain did-v2 rep-record -d <did> -s <source> --score <n>
                                  [-e evidenceJSON] [--json]
chainlesschain did-v2 rep-aggregate <did> [-s sourcesCSV] [--json]
                                                         # 写回 reputationScore
```

**导出 / 统计**:
```bash
chainlesschain did-v2 export <did> [-f json-ld|jwt] [--json]
chainlesschain did-v2 stats [--json]
```

> **未移植**: 真实 did:web DNS 解析、ZKP 证明生成（仅保留 `zkp_proof_id` 占位）、Shamir 秘密分享（CLI 使用简化的 k-of-n 守护人匹配校验）、跨平台远程迁移协议（CLI 仅记录本地迁移日志 + 标记 `status=roamed`）、真实声誉 Oracle（on-chain / social / marketplace 都是调用方推送的样本）、credential 缓存 TTL 定时器。与 Phase 2 `cc did`（单用户默认身份）独立，两者不共享表。

## 开发流水线编排 (Phase 26)

`cc pipeline`（别名 `cc pipe`）是 Phase 26 **开发流水线编排系统** 的 CLI 端实现。Desktop 端提供 7 阶段（需求→架构→代码→测试→审查→部署→监控）AI 驱动流水线 + 4 种项目模板 + 6 种部署策略 + code-review/deploy 双门禁。CLI 端是**记账 + 状态机引擎**，不做真实 AI 代码生成、测试执行、git/docker/npm 动作——调用者用 `complete` / `deploy` 推入外部系统的输出。

**目录 (catalogs)**:
```bash
chainlesschain pipeline config              # 全部常量表
chainlesschain pipeline templates           # 4 模板 + 各自阶段 + 门禁阶段
chainlesschain pipeline stages              # 7 阶段名称
chainlesschain pipeline deploy-strategies   # git-pr/docker/npm-publish/local/staging/custom
chainlesschain pipeline statuses            # pipeline + stage + deploy 状态值
```

**流水线生命周期**:
```bash
chainlesschain pipeline create -t feature -n "auth flow" [-c configJSON]
chainlesschain pipeline start <pipelineId>
chainlesschain pipeline pause <pipelineId>
chainlesschain pipeline resume <pipelineId>
chainlesschain pipeline cancel <pipelineId> [-r reason]
chainlesschain pipeline list [-t template] [-s status] [-l limit]
chainlesschain pipeline show <pipelineId>
chainlesschain pipeline stage <pipelineId> <stageIndex>
```

**阶段执行（外部系统推入结果）**:
```bash
chainlesschain pipeline complete <id> -o outputJSON -a artifactsJSON
                                      # artifactsJSON = [{name,type,content,metadata}]
chainlesschain pipeline fail <id> -e "error message"
chainlesschain pipeline retry <id> -s <stageIndex>
```

**门禁审批（code-review & deploy 阶段）**:
```bash
chainlesschain pipeline approve <id>        # gate-waiting → running
chainlesschain pipeline reject <id> -r reason  # gate → failed (流水线 failed)
```

**工件 (artifacts)**:
```bash
chainlesschain pipeline artifact-add <id> -s <stageIdx> -n name
                                           [-t document|code|report|config|deploy-result]
                                           [-c content] [-m metadataJSON]
chainlesschain pipeline artifacts <id> [-s stageIdx]
```

**部署记录 & 回滚（记录, 不执行真实部署）**:
```bash
chainlesschain pipeline deploy -s docker -p <pipelineId> [-c configJSON]
                               [-r resultJSON] [--status succeeded|pending|failed]
                               [-e errorMsg]
chainlesschain pipeline deploys [-p pipelineId] [-s strategy] [--status state]
chainlesschain pipeline deploy-show <deployId>
chainlesschain pipeline rollback <deployId> [-r reason]   # 仅 succeeded → rolled-back
```

**部署后监控（日志式，无定时器）**:
```bash
chainlesschain pipeline monitor-record <deployId>
                               [-t health-check|alert|rollback-trigger]
                               [-s healthy|degraded|unhealthy] [-m metricsJSON]
chainlesschain pipeline monitor-events <deployId> [-l limit]
chainlesschain pipeline monitor-status <deployId>    # 最新事件快照
```

**导出 / 统计**:
```bash
chainlesschain pipeline export <pipelineId>   # pipeline + stages + artifacts + deploys
chainlesschain pipeline stats
```

> **未移植**: AI 驱动的需求解析 / 架构设计 / 代码生成 / 自动测试 / code-review 报告（CLI 不跑任何 LLM——调用方通过 `complete -o outputJSON` 把外部工具的输出推进来）；真实 git/docker/npm/staging 部署动作（CLI 仅记录 `recordDeploy` 条目，`rollback` 只翻状态位）；PostDeployMonitor 的 `setInterval` 健康轮询（CLI 只接受主动 `monitor-record`）；前端 Pinia store `skill-pipeline.ts` 相关订阅事件。Gate 机制完整保留（code-review + deploy 双门禁，`approve` 前不能 `complete`）。

## 智能插件生态 2.0 (Phase 64)

> Source: `docs/design/modules/64_智能插件生态2.0.md`
> CLI port: `packages/cli/src/lib/plugin-ecosystem.js` + `packages/cli/src/commands/plugin-ecosystem.js`

**目录 / 枚举**:
```bash
chainlesschain ecosystem config                 # 全部默认值 + 规则
chainlesschain ecosystem severities             # info/warning/critical/blocker
chainlesschain ecosystem statuses               # publish / install / sandbox
chainlesschain ecosystem revenue-types          # download/subscription/donation/premium
chainlesschain ecosystem dep-kinds              # required/optional/peer
chainlesschain ecosystem rules                  # 启发式 AI 审查规则
```

**插件注册**:
```bash
chainlesschain ecosystem register -n <name> -v <version> -d <devId>
                              [-c category] [-D desc] [-m manifestJSON]
chainlesschain ecosystem plugins [-c cat] [-s status] [-d devId] [-l limit]
chainlesschain ecosystem show <pluginId>
chainlesschain ecosystem update-stats <pluginId> [-d downloads] [-r rating]
```

**依赖解析（DFS + 环检测 + 版本冲突）**:
```bash
chainlesschain ecosystem dep-add <pluginId> -p <depId> -v <depVersion> [-k required|optional|peer]
chainlesschain ecosystem deps <pluginId>
chainlesschain ecosystem resolve <pluginId>    # { dependencies, conflicts, circular }
```

**安装（环/冲突时自动标记 FAILED）**:
```bash
chainlesschain ecosystem install -u <userId> -p <pluginId> [-v version] [--no-resolve]
chainlesschain ecosystem installs [-u userId] [-p pluginId] [-s status] [-l limit]
chainlesschain ecosystem uninstall <installId>
```

**启发式 AI 代码审查（不跑 LLM）**:
```bash
chainlesschain ecosystem review <pluginId> -c "<source>" [-s lenient|standard|strict]
chainlesschain ecosystem review-show <reviewId>
chainlesschain ecosystem reviews [-p pluginId] [-s severity]
```

**沙箱测试记录（调用方推送结果）**:
```bash
chainlesschain ecosystem sandbox <pluginId> [-t suite] [-r passed|failed|timeout|resource-exceeded]
                                 [-m metricsJSON] [-L logsJSON] [-d durationMs]
chainlesschain ecosystem sandbox-show <testId>
chainlesschain ecosystem sandbox-tests [-p pluginId] [-r result]
```

**发布流程 (draft → reviewing → approved/rejected → published)**:
```bash
chainlesschain ecosystem submit <pluginId>
chainlesschain ecosystem approve <pluginId>
chainlesschain ecosystem reject <pluginId> [-r reason]    # 追加 rejection review
chainlesschain ecosystem publish <pluginId> [-c source] [-l changelog]
```

**收益（记账 + 分成）**:
```bash
chainlesschain ecosystem rev-record -d <devId> -p <pluginId> -t <type> -a <amount>
                                    [-u userId] [-r ratio 0-1]
chainlesschain ecosystem revenue <developerId> [-p pluginId] [--from ts] [--to ts]
```

**启发式推荐**:
```bash
chainlesschain ecosystem recommend -u <userId> [-c category] [-l limit]
chainlesschain ecosystem stats
```

> **未移植**: AI / 协同过滤 / embedding 推荐（CLI 使用 `categoryAffinity × 10 + log10(downloads+1) × 3 + rating × 2` 启发式）；LLM 安全 / 质量 / API 合规审查（CLI 只跑 8 条正则规则 + 4 档严重度 + 权重惩罚）；真实 vm / Docker / isolate-vm 沙箱隔离（CLI 只收 caller 上报的结果）；真实打包 / 签名 / 上传（`publish` 只翻状态位 + 计算 `sourceHash = sha256(source)`）；支付网关（`rev-record` 是本地记账）。完整依赖环检测 + 多版本冲突识别已实现。

## Phase 96: Workflow Automation Engine (`automation` / `auto`)

工作流自动化引擎 — 12 个 SaaS 连接器 + 5 种触发器 + DAG 有向无环图执行引擎 + 启发式条件评估。CLI 别名 `cc auto`。

**目录 / 连接器**:
```bash
chainlesschain automation connectors [--json]        # 12 SaaS 连接器（gmail/slack/github/jira/notion/trello/discord/teams/airtable/figma/linear/confluence）
chainlesschain automation trigger-types [--json]     # webhook/schedule/event/condition/manual
chainlesschain automation statuses [--json]          # draft/active/paused/archived + execution 状态
chainlesschain automation config [--json]            # 静态快照
chainlesschain automation templates [--json]         # 4 个预置模板
```

**流程 CRUD（DAG: nodes + edges）**:
```bash
chainlesschain automation create -n <name> [-d desc] -N <nodesJSON> -E <edgesJSON> [-u userId] [-s draft]
chainlesschain automation flows [-s status] [-l limit] [--json]
chainlesschain automation show <flowId> [--json]
chainlesschain automation activate|pause|archive <flowId>
chainlesschain automation delete <flowId>                               # 级联删除触发器和执行记录
chainlesschain automation schedule <flowId> -c <cron>                   # 覆盖 schedule 字段
chainlesschain automation share <flowId> -o <orgId>
chainlesschain automation import-template <templateId> [-n name] [-u userId]
```

**触发器（webhook / schedule / event / condition / manual）**:
```bash
chainlesschain automation add-trigger <flowId> -t <type> -c <configJSON>
chainlesschain automation triggers [flowId] [--json]
chainlesschain automation enable-trigger|disable-trigger <triggerId>
chainlesschain automation fire-trigger <triggerId> [-i inputJSON]       # 触发 trigger_count++ 并执行 flow
```

**执行（DAG 拓扑排序 + 条件分支 + 循环检测）**:
```bash
chainlesschain automation execute <flowId> [-i inputJSON] [--test]      # Kahn 算法拓扑排序;condition 节点走 true/false 分支
chainlesschain automation exec-show <execId> [--json]
chainlesschain automation logs [-f flowId] [-s status] [-l limit] [--json]
chainlesschain automation stats [--json]                                # 流程/执行/触发器聚合 + 成功率 + avg duration
```

> **未移植**: 真实 SaaS 连接（CLI 只暴露目录,不调用 Gmail/Slack/GitHub API）；真实 HTTP webhook 接收器 / cron 调度器 / event bus（CLI `fire-trigger` 由调用方推送）；action 节点真实执行（CLI `_simulateNodeOutput` 构造模拟输出）；OAuth / 密钥保管。条件节点使用正则安全求值器支持 `ctx.path OP 字面量` 语法（OP ∈ {<,<=,>,>=,==,!=}），不走 `eval`。循环检测基于拓扑排序缺失节点判定。

---

## Phase 84 V2 — Multimodal Perception (sensor maturity + capture lifecycle)

`src/lib/perception.js` 在原有 perception CRUD / voice session / cross-modal index 基础上追加 V2 面：两条平行状态机 `SENSOR_MATURITY_V2` (5 态：onboarding/active/degraded/offline/retired) + `CAPTURE_LIFECYCLE_V2` (5 态：pending/processing/ready/failed/discarded；**2 个终态** ready/discarded；包含 failed→pending 重试路径)。每 operator ACTIVE sensor 上限 + 每 sensor PENDING capture 上限。`processingStartedAt` 在首次 PROCESSING 跃迁时一次性戳记并在 failed→pending→processing 重试循环中保持。

**配置默认值**:
```
PCP_DEFAULT_MAX_ACTIVE_SENSORS_PER_OPERATOR = 25
PCP_DEFAULT_MAX_PENDING_CAPTURES_PER_SENSOR = 50
PCP_DEFAULT_SENSOR_IDLE_MS                  = 30 * 86400000   // 30 天
PCP_DEFAULT_CAPTURE_STUCK_MS                = 2 * 3600000     // 2 小时
```

**枚举 + 配置**:
```bash
cc perception sensor-maturities-v2                                         # 5 态
cc perception capture-lifecycles-v2                                        # 5 态
cc perception default-max-active-sensors-per-operator | max-active-sensors-per-operator | set-max-active-sensors-per-operator <n>
cc perception default-max-pending-captures-per-sensor | max-pending-captures-per-sensor | set-max-pending-captures-per-sensor <n>
cc perception default-sensor-idle-ms | sensor-idle-ms | set-sensor-idle-ms <ms>
cc perception default-capture-stuck-ms | capture-stuck-ms | set-capture-stuck-ms <ms>
cc perception active-sensor-count [-o operator]                            # 仅 ACTIVE 计数
cc perception pending-capture-count [-s sensor]                            # 仅 PENDING 计数
```

**Sensor 生命周期（throws on cap / invalid transition / terminal initial）**:
```bash
cc perception register-sensor-v2 <sensor-id> -o <operator> -m <modality> [-i initial] [--metadata json]
cc perception sensor-v2 <sensor-id>
cc perception set-sensor-maturity-v2 <sensor-id> <status> [-r reason] [--metadata json]
cc perception activate-sensor | degrade-sensor | offline-sensor | retire-sensor <sensor-id> [-r reason]
cc perception touch-sensor-heartbeat <sensor-id>                           # 推进 lastHeartbeatAt
```

**Capture 生命周期（throws on cap / invalid transition / terminal initial）**:
```bash
cc perception register-capture-v2 <capture-id> -s <sensor> [-i initial] [--metadata json]
cc perception capture-v2 <capture-id>
cc perception set-capture-status-v2 <capture-id> <status> [-r reason] [--metadata json]
cc perception start-processing-capture | mark-capture-ready | fail-capture | discard-capture <capture-id> [-r reason]
```

**批量 auto-flip + 统计**:
```bash
cc perception auto-offline-stale-sensors              # ACTIVE/DEGRADED → OFFLINE（heartbeat 超时）
cc perception auto-fail-stuck-processing-captures     # 仅 PROCESSING → FAILED；基于 processingStartedAt
cc perception stats-v2                                 # 全枚举零初始化
```

> **未移植**: 真实 OCR / ASR / 视觉模型推理；摄像头 / 麦克风实时采集管道；WebRTC 屏幕共享实时感知；voice session 流式转录分片；CUDA 加速多模态嵌入。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (sensor 成熟度 + 带重试路径的 capture 生命周期)、双维度上限 (per-operator ACTIVE sensor + per-sensor PENDING capture)、throwing `registerSensorV2`/`registerCaptureV2` + 8 shortcuts (stamp-once `processingStartedAt` 跨重试循环保持)、`touchSensorHeartbeat` + 2 批量 auto-flip、全枚举零初始化 `getPerceptionStatsV2`。

## Phase 74-75 V2 — Decentralized Infra (provider maturity + deal lifecycle)

**状态机 (两条平行):**
- Provider maturity (5 states, `retired` terminal): `onboarding → {active, retired}`, `active → {degraded, offline, retired}`, `degraded → {active, offline, retired}`, `offline → {active, retired}` (recovery)
- Deal lifecycle (5 states, 3 terminals): `queued → {active, canceled, failed}`, `active → {completed, failed, canceled}`

**双维度上限:**
```bash
cc infra max-active-providers-per-operator             # default 20
cc infra set-max-active-providers-per-operator <n>
cc infra max-active-deals-per-provider                 # default 10
cc infra set-max-active-deals-per-provider <n>
cc infra provider-idle-ms                              # default 7 days
cc infra deal-stuck-ms                                 # default 24 hours
```

**Provider + Deal V2 CRUD:**
```bash
cc infra register-provider-v2 <provider-id> -o <operator> -k <kind> [-i initial] [--metadata json]
cc infra provider-v2 <provider-id>
cc infra set-provider-maturity-v2 <provider-id> <status> [-r reason] [--metadata json]
cc infra activate-provider | degrade-provider | offline-provider | retire-provider <provider-id> [-r reason]
cc infra touch-provider-heartbeat <provider-id>
cc infra enqueue-deal-v2 <deal-id> -p <provider> -o <owner> [--metadata json]
cc infra deal-v2 <deal-id>
cc infra set-deal-status-v2 <deal-id> <status> [-r reason] [--metadata json]
cc infra activate-deal | complete-deal | fail-deal | cancel-deal <deal-id> [-r reason]
```

**批量 auto-flip + 统计:**
```bash
cc infra auto-offline-stale-providers                  # ACTIVE/DEGRADED → OFFLINE (heartbeat timeout)
cc infra auto-fail-stuck-active-deals                  # 仅 ACTIVE → FAILED；基于 startedAt
cc infra stats-v2                                       # 全枚举零初始化
```

> **未移植**: 真实 Filecoin/IPFS deal 链上签名；provider 分布式健康探测；deal 反抽查 / PoRep / PoSt；CDN 多地域容错路由；gateway 带宽计费结算。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (provider 成熟度 w/ offline→active 恢复 + deal 3-terminal 生命周期)、双维度上限 (per-operator ACTIVE provider + per-provider active deal)、throwing `registerProviderV2`/`enqueueDealV2` (provider 必须已存在) + 8 shortcuts、stamp-once `activatedAt` + `lastHeartbeatAt` 追踪、`touchProviderHeartbeat` + 2 批量 auto-flip、全枚举零初始化 `getDecentralInfraStatsV2`。

## Phase 72-73 V2 — Protocol Fusion (bridge maturity + translation-run lifecycle)

**状态机 (两条平行):**
- Bridge maturity (5 states, `retired` terminal): `provisional → {active, retired}`, `active → {degraded, deprecated, retired}`, `degraded → {active, deprecated, retired}`, `deprecated → {active, retired}`
- Translation run (5 states, 3 terminals): `queued → {running, canceled, failed}`, `running → {succeeded, failed, canceled}`

**双维度上限 + 阈值:**
```bash
cc fusion max-active-bridges-per-operator          # default 10
cc fusion set-max-active-bridges-per-operator <n>
cc fusion max-running-translations-per-bridge      # default 5
cc fusion set-max-running-translations-per-bridge <n>
cc fusion bridge-idle-ms                           # default 14 days
cc fusion translation-stuck-ms                     # default 10 min
```

**Bridge + Translation V2 CRUD:**
```bash
cc fusion register-bridge-v2 <bridge-id> -o <operator> -s <source-protocol> -t <target-protocol> [-i initial] [--metadata json]
cc fusion bridge-v2 <bridge-id>
cc fusion list-bridges-v2 [-o operator] [-s status]
cc fusion set-bridge-maturity-v2 <bridge-id> <status> [-r reason] [--metadata json]
cc fusion activate-bridge | degrade-bridge | deprecate-bridge | retire-bridge <bridge-id> [-r reason]
cc fusion touch-bridge-usage <bridge-id>
cc fusion enqueue-translation-v2 <translation-id> -b <bridge> -t <target-lang> -x <text> [-s source-lang] [--metadata json]
cc fusion translation-v2 <translation-id>
cc fusion list-translations-v2 [-b bridge] [-s status]
cc fusion set-translation-status-v2 <translation-id> <status> [-r reason] [--metadata json] [--result json]
cc fusion start-translation | succeed-translation | fail-translation | cancel-translation <translation-id> [-r reason]
```

**批量 auto-flip + 统计:**
```bash
cc fusion auto-retire-idle-bridges                 # ACTIVE/DEGRADED/DEPRECATED → RETIRED (lastUsedAt 超时)
cc fusion auto-fail-stuck-running-translations     # 仅 RUNNING → FAILED；基于 startedAt
cc fusion stats-v2                                  # 全枚举零初始化
```

> **未移植**: 真实 DID/ActivityPub/Nostr/Matrix 协议桥；LLM 驱动的翻译引擎；WebSocket 实时消息订阅；ML 内容质量分类器。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (bridge 成熟度 w/ degraded→active 恢复 + translation 3-terminal 生命周期)、双维度上限 (per-operator ACTIVE bridge 排除 provisional + per-bridge RUNNING translation)、throwing `registerBridgeV2`/`enqueueTranslationV2` (bridge 必须已存在) + 8 shortcuts、stamp-once `activatedAt` + `startedAt`、`touchBridgeUsage` + 2 批量 auto-flip、全枚举零初始化 `getProtocolFusionStatsV2`。

## Phase 68-71 V2 — Trust & Security (HSM maturity + satellite transmission)

**状态机 (两条平行):**
- HSM device maturity (4 states, `retired` terminal): `provisional → {active, retired}`, `active → {degraded, retired}`, `degraded → {active, retired}`
- Transmission lifecycle (5 states, 3 terminals): `queued → {sending, canceled, failed}`, `sending → {confirmed, failed, canceled}`

**双维度上限 + 阈值:**
```bash
cc trust max-active-devices-per-operator           # default 8
cc trust set-max-active-devices-per-operator <n>
cc trust max-pending-transmissions-per-device      # default 20
cc trust device-idle-ms                             # default 30 days
cc trust transmission-stuck-ms                      # default 2 min
```

**Device + Transmission V2 CRUD:**
```bash
cc trust register-device-v2 <device-id> -o <operator> -v <vendor> [-i initial] [--metadata json]
cc trust device-v2 <device-id>
cc trust list-devices-v2 [-o operator] [-s status]
cc trust set-device-maturity-v2 <device-id> <status> [-r reason] [--metadata json]
cc trust activate-device | degrade-device | retire-device <device-id> [-r reason]
cc trust touch-device-usage <device-id>
cc trust enqueue-transmission-v2 <transmission-id> -d <device> -p <provider> -x <payload> [--metadata json]
cc trust transmission-v2 <transmission-id>
cc trust list-transmissions-v2 [-d device] [-s status]
cc trust set-transmission-status-v2 <transmission-id> <status> [-r reason] [--metadata json]
cc trust start-transmission | confirm-transmission | fail-transmission | cancel-transmission <transmission-id> [-r reason]
```

**批量 auto-flip + 统计:**
```bash
cc trust auto-retire-idle-devices                  # ACTIVE/DEGRADED → RETIRED (lastUsedAt 超时)
cc trust auto-fail-stuck-transmissions             # 仅 SENDING → FAILED；基于 startedAt
cc trust stats-v2                                   # 全枚举零初始化
```

> **未移植**: 真实 TPM/TEE/SE 硬件信任根；USB HSM 驱动；Iridium/Starlink/BeiDou 实际卫星通信；PQC 密钥交换。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (HSM 成熟度 w/ degraded→active 恢复 + transmission 3-terminal 生命周期)、双维度上限 (per-operator active device 排除 provisional + per-device pending transmission)、throwing `registerDeviceV2`/`enqueueTransmissionV2` (device 必须已存在) + 7 shortcuts、stamp-once `activatedAt` + `startedAt`、`touchDeviceUsage` + 2 批量 auto-flip、全枚举零初始化 `getTrustSecurityStatsV2`。

## Autonomous Developer V2 (CLI 0.103.0)

**Target**: `packages/cli/src/lib/autonomous-developer.js` · `packages/cli/src/commands/dev.js`

**V2 面**:
- `ADR_MATURITY_V2` = { PROVISIONAL(draft), ACCEPTED, DEPRECATED, SUPERSEDED(terminal) }
- `DEV_SESSION_V2` = { QUEUED, RUNNING, COMPLETED, FAILED, CANCELED } (3 terminals)
- Config: `max-active-adrs-per-author=20`, `max-running-sessions-per-developer=3`, `adr-stale-ms=90d`, `session-stuck-ms=2h`
- 计数: `getActiveAdrCount` 排除 superseded; `getRunningSessionCount` 仅 running
- Auto-flip: `autoSupersedeStaleDrafts({now})` draft→superseded; `autoFailStuckSessions({now})` running→failed

**命令**:
```bash
cc dev adr-maturities-v2 | dev-sessions-v2 | stats-v2
cc dev create-adr-v2 <adr-id> -a <author> -t <title>
cc dev enqueue-session-v2 <session-id> -d <dev> -g <goal>
cc dev accept-adr | deprecate-adr | supersede-adr <adr-id>
cc dev start-session-v2 | complete-session-v2 | fail-session-v2 | cancel-session-v2 <id>
cc dev auto-supersede-stale-drafts | auto-fail-stuck-sessions
```

> **未移植**: 真实 LLM 驱动的 ADR 生成；git 驱动的会话 checkpoint；AI 代码审查管线。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (ADR 4-state w/ deprecated→accepted 恢复 + dev-session 3-terminal 生命周期)、双维度上限 (per-author active ADR + per-developer running session)、throwing `createAdrV2`/`enqueueSessionV2` + 7 shortcuts、V2 函数 V2 后缀避名冲突、2 批量 auto-flip、全枚举零初始化 `getAutonomousDeveloperStatsV2`。

## Tech Learning Engine V2 (CLI 0.104.0)

**Target**: `packages/cli/src/lib/tech-learning-engine.js` · `packages/cli/src/commands/tech.js`

**V2 面**:
- `PROFILE_MATURITY_V2` = { DRAFT, ACTIVE, STALE, ARCHIVED(terminal) } — stale→active 恢复
- `LEARNING_RUN_V2` = { QUEUED, STUDYING, COMPLETED, ABANDONED, FAILED } (3 terminals)
- Config: `max-active-profiles-per-owner=10`, `max-studying-runs-per-learner=5`, `profile-stale-ms=60d`, `run-stuck-ms=7d`
- 计数: `getActiveProfileCountV2` 排除 draft+archived; `getStudyingRunCountV2` 仅 studying
- Stamp-once: `activatedAt` (跨 stale→active 保留), `startedAt`
- Auto-flip: `autoMarkStaleProfilesV2({now})` active→stale; `autoFailStuckRunsV2({now})` studying→failed

**命令**:
```bash
cc tech profile-maturities-v2 | learning-runs-v2 | stats-v2
cc tech create-profile-v2 <id> -o <owner> -s <stack>
cc tech enqueue-run-v2 <id> -l <learner> -t <topic>
cc tech activate-profile | mark-profile-stale | archive-profile | touch-profile <id>
cc tech start-run-v2 | complete-run-v2 | fail-run-v2 | abandon-run-v2 <id>
cc tech auto-mark-stale-profiles | auto-fail-stuck-runs
```

> **未移植**: 真实 crawler-based 开源仓库扫描；图数据库驱动的知识图谱；机器学习 pattern 提取。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (profile 4-state w/ stale→active 恢复 + learning-run 3-terminal 生命周期)、双维度上限 (per-owner active profile + per-learner studying run)、throwing `createProfileV2`/`enqueueRunV2` + 7 shortcuts、stamp-once `activatedAt` + `startedAt`、`touchProfileV2` + 2 批量 auto-flip、全枚举零初始化 `getTechLearningStatsV2`。

## Collaboration Governance V2 (CLI 0.105.0)

**Target**: `packages/cli/src/lib/collaboration-governance.js` · `packages/cli/src/commands/collab.js`

**V2 面**:
- `AGENT_MATURITY_CG_V2` = { PROVISIONAL, ACTIVE, SUSPENDED, RETIRED(terminal) } — suspended→active 恢复
- `PROPOSAL_LIFECYCLE_V2` = { DRAFT, VOTING, APPROVED, REJECTED, WITHDRAWN } (3 terminals)
- Config: `max-active-agents-per-realm=10`, `max-voting-proposals-per-proposer=3`, `agent-idle-ms-cg=30d`, `proposal-stuck-ms=7d`
- 计数: `getActiveAgentCountCgV2` 排除 provisional+retired; `getVotingProposalCountV2` 仅 voting
- Stamp-once: `activatedAt` (跨 suspended→active 保留), `votingStartedAt`, `decidedAt`
- Auto-flip: `autoRetireIdleAgentsCgV2({now})` 非终态非 provisional → retired; `autoWithdrawStuckProposalsV2({now})` voting → withdrawn

**命令**:
```bash
cc collab agent-maturities-cg-v2 | proposal-lifecycles-v2 | stats-v2
cc collab register-agent-cg-v2 <id> -r <realm> --role <role>
cc collab create-proposal-v2 <id> -p <proposer> -t <topic>
cc collab activate/suspend/retire-agent-cg | touch-agent-cg <id>
cc collab start-voting-v2 | approve/reject/withdraw-proposal-v2 <id>
cc collab auto-retire-idle-agents-cg | auto-withdraw-stuck-proposals
```

> **未移植**: 真实 raft/PBFT/Paxos 共识；ML-driven auto-merge；real-time quality monitoring。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (CG agent 4-state w/ suspended→active 恢复 + proposal 5-state w/ 3 terminals)、双维度上限 (per-realm active agent 排除 provisional + per-proposer voting proposal)、throwing `registerAgentCgV2`/`createProposalV2` + 8 shortcuts (4 agent + 4 proposal)、stamp-once `activatedAt`/`votingStartedAt`/`decidedAt`、`touchAgentCgV2` + 2 批量 auto-flip、全枚举零初始化 `getCollaborationGovernanceStatsV2`。

## Compliance UEBA V2 (Phase 19 UEBA 扩展)

**Target**: `packages/cli/src/lib/ueba.js` · `packages/cli/src/commands/compliance.js`

**V2 面**:
- `BASELINE_MATURITY_V2` = { DRAFT, ACTIVE, STALE, ARCHIVED(terminal) } — stale→active 恢复
- `INVESTIGATION_V2` = { OPEN, INVESTIGATING, CLOSED, DISMISSED, ESCALATED } (3 terminals)
- Config: `max-active-baselines-per-owner=20`, `max-open-investigations-per-analyst=10`, `baseline-stale-ms=30d`, `investigation-stuck-ms=14d`
- 计数: `getActiveBaselineCountV2` 仅 active; `getOpenInvestigationCountV2` 非终态 (open+investigating)
- Cap 例外: per-analyst 上限在 `openInvestigationV2` **创建时**强制(非过渡时),因为 open 本身就是起始态
- Stamp-once: `activatedAt` (跨 stale→active 保留), `startedAt` (open→investigating), `closedAt` (任意终态)
- Auto-flip: `autoMarkStaleBaselinesV2({now})` active → stale; `autoEscalateStuckInvestigationsV2({now})` investigating → escalated

**命令**:
```bash
cc compliance ueba baseline-maturities-v2 | investigation-lifecycles-v2 | stats-v2
cc compliance ueba create-baseline-v2 <id> -o <owner> -e <entity>
cc compliance ueba open-investigation-v2 <id> -a <analyst> -b <baseline>
cc compliance ueba activate/mark-stale/archive-baseline-v2 <id>
cc compliance ueba refresh-baseline-v2 <id>
cc compliance ueba start/close/dismiss/escalate-investigation-v2 <id>
cc compliance ueba auto-mark-stale-baselines | auto-escalate-stuck-investigations
```

> **未移植**: 真实 ML 异常检测;图神经网络行为相关性;SIEM 告警集成。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (baseline 4-state w/ stale→active 恢复 + investigation 5-state w/ 3 terminals)、双维度上限 (per-owner active baseline + per-analyst open investigation 在 openInvestigationV2 创建时强制)、throwing `createBaselineV2`/`openInvestigationV2` + 7 shortcuts、stamp-once `activatedAt`/`startedAt`/`closedAt`、`refreshBaselineV2` + 2 批量 auto-flip、全枚举零初始化 `getUebaStatsV2`。

## Compliance Threat-Intel V2 (Phase 19 STIX 扩展)

**Target**: `packages/cli/src/lib/threat-intel.js` · `packages/cli/src/commands/compliance.js`

**说明**: V2 是叠加在 SQLite IoC catalog **之上**的内存态 feed/indicator 生命周期治理层,与遗留 `importStixBundle`/`matchObservable`/`listIndicators` SQLite 流程**独立**。

**V2 面**:
- `FEED_MATURITY_V2` = { PENDING, TRUSTED, DEPRECATED, RETIRED(terminal) } — deprecated→trusted 恢复
- `INDICATOR_LIFECYCLE_V2` = { PENDING, ACTIVE, EXPIRED, REVOKED, SUPERSEDED } (3 terminals)
- Config: `max-active-feeds-per-owner=15`, `max-active-indicators-per-feed=500`, `feed-idle-ms=60d`, `indicator-stale-ms=90d`
- 计数: `getActiveFeedCountV2` 仅 trusted; `getActiveIndicatorCountV2` 仅 active
- Cap: per-owner active-feed 仅在 `pending → trusted` 强制(deprecated→trusted 恢复豁免);per-feed active-indicator 仅在 `pending → active` 强制
- Stamp-once: feed `activatedAt` (跨 deprecated→trusted 保留); indicator `activatedAt` (pending→active); indicator `resolvedAt` (任意终态)
- Auto-flip: `autoDeprecateIdleFeedsV2({now})` trusted → deprecated; `autoExpireStaleIndicatorsV2({now})` active → expired

**命令**:
```bash
cc compliance threat-intel feed-maturities-v2 | indicator-lifecycles-v2 | stats-v2
cc compliance threat-intel register-feed-v2 <id> -o <owner> -n <name>
cc compliance threat-intel create-indicator-v2 <id> -f <feedId> -t <iocType> -v <value>
cc compliance threat-intel trust/deprecate/retire-feed-v2 | touch-feed-v2 <id>
cc compliance threat-intel activate/expire/revoke/supersede-indicator-v2 | refresh-indicator-v2 <id>
cc compliance threat-intel auto-deprecate-idle-feeds | auto-expire-stale-indicators
```

> **未移植**: 真实 STIX 2.1 TAXII 服务订阅;ML-driven IoC 评分;cross-feed deduplication & confidence merging。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (feed 4-state w/ deprecated→trusted 恢复 + indicator 5-state w/ 3 terminals)、双维度上限 (per-owner active feed + per-feed active indicator)、throwing `registerFeedV2`/`createIndicatorV2` + 9 shortcuts、stamp-once `activatedAt`(feed+indicator)/`resolvedAt`、`touchFeedV2`/`refreshIndicatorV2` + 2 批量 auto-flip、全枚举零初始化 `getThreatIntelStatsV2`、SQLite catalog 与 V2 内存层完全独立。

## Org Manager V2 (Phase 14 Org 扩展)

**Target**: `packages/cli/src/lib/org-manager.js` · `packages/cli/src/commands/org.js`

**说明**: V2 是叠加在 SQLite org/team/approval 表之上的内存态 org/member 生命周期治理层,与遗留 `createOrg`/`inviteMember`/`getMembers` SQLite 流程**独立**。

**V2 面**:
- `ORG_MATURITY_V2` = { PROVISIONAL, ACTIVE, SUSPENDED, ARCHIVED(terminal) } — suspended→active 恢复
- `MEMBER_LIFECYCLE_V2` = { INVITED, ACTIVE, SUSPENDED, REVOKED, DEPARTED } (2 terminals)
- Config: `max-active-orgs-per-owner=5`, `max-active-members-per-org=200`, `org-idle-ms=90d`, `invite-stale-ms=30d`
- 计数: `getActiveOrgCountV2` 仅 active; `getActiveMemberCountV2` 仅 active
- Cap: per-owner active-org 仅在 `provisional → active` 强制(suspended→active 恢复豁免);per-org active-member 仅在 `invited → active` 强制
- Stamp-once: org `activatedAt` (跨 suspended→active 保留); member `activatedAt` (跨 suspended→active 保留); member `departedAt` (任意终态)
- `registerOrgV2`/`inviteMemberV2` 接受 `now` 覆盖以支持确定性测试
- Auto-flip: `autoArchiveIdleOrgsV2({now})` 非 provisional 非 archived → archived; `autoRevokeStaleInvitesV2({now})` invited → revoked

**命令**:
```bash
cc org maturities-v2 | member-lifecycles-v2 | stats-v2
cc org register-org-v2 <id> -o <owner> -n <name>
cc org invite-member-v2 <id> -o <orgId> -u <userId> [-r <role>]
cc org activate/suspend/archive-org-v2 | touch-org-v2 <id>
cc org activate/suspend/revoke/depart-member-v2 <id>
cc org auto-archive-idle-orgs | auto-revoke-stale-invites
```

> **未移植**: 真实 RBAC 与团队角色继承;org 跨域联邦;SaaS 计费集成。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (org 4-state w/ suspended→active 恢复 + member 5-state w/ suspended→active 恢复 + 2 terminals)、双维度上限 (per-owner active org + per-org active member)、throwing `registerOrgV2`/`inviteMemberV2` + 8 shortcuts、stamp-once `activatedAt`(org+member)/`departedAt`、`touchOrgV2` + 2 批量 auto-flip、全枚举零初始化 `getOrgManagerStatsV2`、SQLite tables 与 V2 内存层完全独立。

## Wallet Manager V2 (Wallet 扩展)

**Target**: `packages/cli/src/lib/wallet-manager.js` · `packages/cli/src/commands/wallet.js`

**说明**: V2 是叠加在 SQLite wallet/asset/transaction 表之上的内存态 wallet/tx 生命周期治理层,与遗留 `createWallet`/`transferAsset`/`getTransactions` SQLite 流程**独立**。

**V2 面**:
- `WALLET_MATURITY_V2` = { PROVISIONAL, ACTIVE, FROZEN, RETIRED(terminal) } — frozen→active 恢复
- `TX_LIFECYCLE_V2` = { PENDING, SUBMITTED, CONFIRMED, FAILED, REJECTED } (3 terminals)
- Config: `max-active-wallets-per-owner=10`, `max-pending-tx-per-wallet=25`, `wallet-idle-ms=180d`, `tx-stuck-ms=1d`
- 计数: `getActiveWalletCountV2` 仅 active; `getPendingTxCountV2` pending+submitted (in-flight)
- Cap: per-owner active-wallet 仅在 `provisional → active` 强制(frozen→active 恢复豁免);per-wallet pending-tx 在 `createTxV2` **创建时**强制
- Stamp-once: wallet `activatedAt` (跨 frozen→active 保留); tx `submittedAt` (pending→submitted); tx `settledAt` (任意终态)
- `registerWalletV2`/`createTxV2` 接受 `now` 覆盖
- Auto-flip: `autoRetireIdleWalletsV2({now})` 非 provisional 非 retired → retired; `autoFailStuckTxV2({now})` submitted → failed (基于 submittedAt)

**命令**:
```bash
cc wallet maturities-v2 | tx-lifecycles-v2 | stats-v2
cc wallet register-wallet-v2 <id> -o <owner> -a <address>
cc wallet create-tx-v2 <id> -w <walletId> -k <kind> [-a <amount>]
cc wallet activate/freeze/retire-wallet-v2 | touch-wallet-v2 <id>
cc wallet submit/confirm/fail/reject-tx-v2 <id>
cc wallet auto-retire-idle-wallets | auto-fail-stuck-tx
```

> **未移植**: 真实链上签名/广播;HD wallet 派生;multi-sig 支持;真实 gas 估算。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (wallet 4-state w/ frozen→active 恢复 + tx 5-state w/ 3 terminals)、双维度上限 (per-owner active wallet 排除 frozen + per-wallet pending+submitted tx 在 createTxV2 创建时强制)、throwing `registerWalletV2`/`createTxV2` + 8 shortcuts、stamp-once `activatedAt`(wallet)/`submittedAt`/`settledAt`、`touchWalletV2` + 2 批量 auto-flip、全枚举零初始化 `getWalletManagerStatsV2`、SQLite tables 与 V2 内存层完全独立。

### SCIM Manager V2 — `cc scim ...-v2` (Phase enterprise/SCIM)

**Lib**: `packages/cli/src/lib/scim-manager.js` (V2 surface追加 ~330 LOC,与 SCIM SQLite tables 完全独立)
**测试**: `__tests__/unit/scim-manager.test.js` (62 V2 tests)

**枚举**:
- `IDENTITY_LIFECYCLE_V2` = `{PENDING, PROVISIONED, SUSPENDED, DEPROVISIONED}` (4 states, deprovisioned terminal, suspended→provisioned 恢复)
- `SYNC_JOB_V2` = `{QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED}` (5 states, 3 terminals)

**默认配置**:
- `SCIM_DEFAULT_MAX_PROVISIONED_PER_CONNECTOR` = 1000
- `SCIM_DEFAULT_MAX_RUNNING_SYNC_PER_CONNECTOR` = 2
- `SCIM_DEFAULT_IDENTITY_IDLE_MS` = 90 天
- `SCIM_DEFAULT_SYNC_STUCK_MS` = 30 分钟

**命令**:
```bash
cc scim identity-lifecycles-v2 | sync-lifecycles-v2 | stats-v2
cc scim register-identity-v2 <id> -c <connectorId> -e <externalId> [-m <json>]
cc scim create-sync-job-v2 <id> -c <connectorId> [-k <kind>] [-m <json>]
cc scim provision/suspend/deprovision-identity-v2 | touch-identity-v2 <id>
cc scim start/succeed/fail/cancel-sync-job-v2 <id>
cc scim auto-deprovision-idle-v2 | auto-fail-stuck-sync-v2
```

> **未移植**: 真实 SCIM 2.0 PATCH 操作语义;真实 IdP 双向同步;Schema discovery & extensions。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (identity 4-state w/ suspended→provisioned 恢复 + syncJob 5-state w/ 3 terminals)、双维度上限 (per-connector provisioned 在 pending→provisioned only + per-connector running 在 queued→running)、throwing `registerIdentityV2`/`createSyncJobV2` + 8 shortcuts、stamp-once `provisionedAt`/`deprovisionedAt`/`startedAt`/`finishedAt`、`touchIdentityV2` + 2 批量 auto-flip、全枚举零初始化 `getScimManagerStatsV2`、SQLite SCIM tables 与 V2 内存层完全独立。

### Sync Manager V2 — `cc sync ...-v2` (Phase sync/governance)

**Lib**: `packages/cli/src/lib/sync-manager.js` (V2 surface追加 ~330 LOC,与 sync_state/conflicts/log SQLite tables 完全独立)
**测试**: `__tests__/unit/sync-manager.test.js` (65 V2 tests)

**枚举**:
- `RESOURCE_MATURITY_V2` = `{PENDING, ACTIVE, PAUSED, ARCHIVED}` (4 states, archived terminal, paused→active 恢复)
- `SYNC_RUN_V2` = `{QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED}` (5 states, 3 terminals)

**默认配置**:
- `SYNC_DEFAULT_MAX_ACTIVE_RESOURCES_PER_OWNER` = 200
- `SYNC_DEFAULT_MAX_RUNNING_RUNS_PER_RESOURCE` = 1
- `SYNC_DEFAULT_RESOURCE_IDLE_MS` = 30 天
- `SYNC_DEFAULT_RUN_STUCK_MS` = 15 分钟

**命令**:
```bash
cc sync resource-maturities-v2 | run-lifecycles-v2 | stats-v2
cc sync register-resource-v2 <id> -o <owner> -k <kind> [-m <json>]
cc sync create-sync-run-v2 <id> -r <resourceId> [-k <kind>] [-m <json>]
cc sync activate/pause/archive-resource-v2 | touch-resource-v2 <id>
cc sync start/succeed/fail/cancel-sync-run-v2 <id>
cc sync auto-archive-idle-v2 | auto-fail-stuck-runs-v2
```

> **未移植**: 真实远程 push/pull 协议;增量 diff/merge;冲突 UI 选择器。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (resource 4-state w/ paused→active 恢复 + syncRun 5-state w/ 3 terminals)、双维度上限 (per-owner active resource 在 pending→active only + per-resource running run 在 queued→running)、throwing `registerResourceV2`/`createSyncRunV2` + 8 shortcuts、stamp-once `activatedAt`/`archivedAt`/`startedAt`/`finishedAt`、`touchResourceV2` + 2 批量 auto-flip、全枚举零初始化 `getSyncManagerStatsV2`、SQLite sync tables 与 V2 内存层完全独立。

### Session Manager V2 — `cc session ...-v2` (Phase session/governance)

**Lib**: `packages/cli/src/lib/session-manager.js` (V2 surface追加 ~330 LOC,与 llm_sessions SQLite table 完全独立)
**测试**: `__tests__/unit/session-manager.test.js` (77 V2 tests)

**枚举**:
- `CONVERSATION_MATURITY_V2` = `{DRAFT, ACTIVE, PAUSED, ARCHIVED}` (4 states, archived terminal, paused→active 恢复)
- `TURN_LIFECYCLE_V2` = `{PENDING, STREAMING, COMPLETED, FAILED, CANCELLED}` (5 states, 3 terminals)

**默认配置**:
- `SESSION_DEFAULT_MAX_ACTIVE_CONV_PER_USER` = 50
- `SESSION_DEFAULT_MAX_PENDING_TURNS_PER_CONV` = 3
- `SESSION_DEFAULT_CONV_IDLE_MS` = 14 天
- `SESSION_DEFAULT_TURN_STUCK_MS` = 5 分钟

**命令**:
```bash
cc session conversation-maturities-v2 | turn-lifecycles-v2 | stats-v2
cc session register-conversation-v2 <id> -u <userId> -m <model>
cc session create-turn-v2 <id> -c <conversationId> [-r <role>]
cc session activate/pause/archive-conversation-v2 | touch-conversation-v2 <id>
cc session stream/complete/fail/cancel-turn-v2 <id>
cc session auto-archive-idle-conv-v2 | auto-fail-stuck-turns-v2
```

> **未移植**: 真实 LLM 流式接入;真实 token 累计;真实多模态附件追踪。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (conversation 4-state w/ paused→active 恢复 + turn 5-state w/ 3 terminals)、双维度上限 (per-user active conv 在 draft→active only + per-conv pending+streaming turn 在 createTurnV2 创建时强制)、throwing `registerConversationV2`/`createTurnV2` + 8 shortcuts、stamp-once `activatedAt`/`archivedAt`/`streamingStartedAt`/`settledAt`、`touchConversationV2` + 2 批量 auto-flip、全枚举零初始化 `getSessionManagerStatsV2`、SQLite llm_sessions 与 V2 内存层完全独立。

### Social Manager V2 — `cc social ...-v2` (Phase social/governance)

**Lib**: `packages/cli/src/lib/social-manager.js` (V2 surface追加 ~340 LOC,与 social_contacts/friends/posts/messages SQLite tables 完全独立)
**测试**: `__tests__/unit/social-manager.test.js` (75 V2 tests)

**枚举**:
- `RELATIONSHIP_MATURITY_V2` = `{PENDING, CONNECTED, MUTED, BLOCKED}` (4 states, blocked terminal, muted→connected 恢复)
- `THREAD_LIFECYCLE_V2` = `{OPEN, ENGAGED, RESOLVED, ABANDONED, REPORTED}` (5 states, 3 terminals;open 必须先 engage 才能 resolve)

**默认配置**:
- `SOCIAL_DEFAULT_MAX_CONNECTED_PER_USER` = 500
- `SOCIAL_DEFAULT_MAX_OPEN_THREADS_PER_USER` = 50
- `SOCIAL_DEFAULT_RELATIONSHIP_IDLE_MS` = 180 天
- `SOCIAL_DEFAULT_THREAD_STUCK_MS` = 7 天

**命令**:
```bash
cc social relationship-maturities-v2 | thread-lifecycles-v2 | stats-v2
cc social register-relationship-v2 <id> -u <userId> -p <peerId>
cc social create-thread-v2 <id> -u <userId> -t <topic>
cc social connect/mute/block-relationship-v2 | touch-relationship-v2 <id>
cc social engage/resolve/abandon/report-thread-v2 <id>
cc social auto-mute-idle-rel-v2 | auto-abandon-stuck-threads-v2
```

> **未移植**: 真实 P2P 联邦同步;真实 IPFS 帖子持久化;反垃圾/审核 ML 模型。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (relationship 4-state w/ muted→connected 恢复 + thread 5-state w/ 3 terminals,open 必须 engage 后再 resolve)、双维度上限 (per-user connected 在 pending→connected only + per-user open+engaged thread 在 createThreadV2 创建时强制)、throwing `registerRelationshipV2`/`createThreadV2` + 8 shortcuts、stamp-once `connectedAt`/`blockedAt`/`engagedAt`/`settledAt`、`touchRelationshipV2` + 2 批量 auto-flip、全枚举零初始化 `getSocialManagerStatsV2`、SQLite social tables 与 V2 内存层完全独立。

## Instinct Manager V2 (cli 0.114.0)

V2 治理层位于 `src/lib/instinct-manager.js`,在已有 SQLite `instincts` 表之上叠加内存态 profile/observation 治理(legacy `recordInstinct`/`getInstincts`/`decayInstincts` 不变):

- **Profile 成熟度** (4 状态, archived 终态, dormant→active 恢复): `pending → {active, archived}` · `active → {dormant, archived}` · `dormant → {active, archived}` · `archived` 终态
- **Observation 生命周期** (5 状态, 2 终态: discarded/promoted): `captured → {reviewed, discarded}` · `reviewed → {reinforced, discarded, promoted}` · `reinforced → {promoted, discarded}` · `captured` 不能直接 promote (必须先 review)
- **Caps**: 每用户 active-profile 上限 (默认 5,仅在 `pending → active` 强制,`dormant → active` 恢复豁免) · 每 profile pending-obs 上限 (默认 100,统计 captured + reviewed,在 `createObservationV2` 创建时强制)
- **Stamp-once**: `activatedAt` (首次 pending→active,跨 dormant 恢复保留) · `archivedAt` · `reviewedAt` (首次 captured→reviewed) · `settledAt` (任意 observation 终态 discarded/promoted)
- **Auto-flip**: `autoDormantIdleProfilesV2({ now })` (active→dormant,默认 60 天阈值) · `autoDiscardStaleObservationsV2({ now })` (captured/reviewed→discarded,默认 14 天阈值)

```bash
cc instinct profile-maturities-v2 | observation-lifecycles-v2 | stats-v2
cc instinct register-profile-v2 <id> -u <userId> -c <category>
cc instinct create-observation-v2 <id> -p <profileId> -s <signal>
cc instinct activate/dormant/archive-profile-v2 | touch-profile-v2<id>
cc instinct review/reinforce/promote/discard-observation-v2 <id>
cc instinct auto-dormant-idle-profiles-v2 | auto-discard-stale-observations-v2
```

> **未移植**: 真实跨会话观察聚合;LLM-based 偏好评估器;长期 RL 自举权重。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (profile 4-state w/ dormant→active 恢复 + observation 5-state w/ 2 terminals,captured 必须先 review 才能 promote)、双维度上限 (per-user active 在 pending→active only + per-profile captured+reviewed 在 createObservationV2 创建时强制)、throwing `registerProfileV2`/`createObservationV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`reviewedAt`/`settledAt`、`touchProfileV2` + 2 批量 auto-flip、全枚举零初始化 `getInstinctManagerStatsV2`、SQLite instincts 表与 V2 内存层完全独立。

## Memory Manager V2 (cli 0.115.0)

V2 治理层位于 `src/lib/memory-manager.js`,在已有 SQLite `memory_entries` 表(及文件系统 daily notes / MEMORY.md)之上叠加内存态 entry / consolidation-job 治理(legacy `addMemory`/`searchMemory`/`listMemory`/`deleteMemory` 与 `appendDailyNote`/`updateMemoryFile` 不变):

- **Entry 成熟度** (4 状态, archived 终态, parked→active 恢复): `pending → {active, archived}` · `active → {parked, archived}` · `parked → {active, archived}` · `archived` 终态
- **Consolidation-job 生命周期** (5 状态, 3 终态: succeeded/failed/cancelled): `queued → {running, cancelled}` · `running → {succeeded, failed, cancelled}`
- **Caps**: 每 category active-entry 上限 (默认 200,仅在 `pending → active` 强制,`parked → active` 恢复豁免) · 每 source running-job 上限 (默认 2,仅在 `queued → running` 强制)
- **Stamp-once**: `activatedAt` (首次 pending→active,跨 parked 恢复保留) · `archivedAt` · `startedAt` (首次 queued→running) · `finishedAt` (任意 job 终态 succeeded/failed/cancelled)
- **Auto-flip**: `autoParkIdleEntriesV2({ now })` (active→parked,默认 90 天阈值) · `autoFailStuckJobsV2({ now })` (running→failed,默认 10 分钟阈值)

```bash
cc memory entry-maturities-v2 | consolidation-lifecycles-v2 | stats-v2
cc memory register-entry-v2 <id> -c <category> -s <summary>
cc memory create-job-v2 <id> -s <source> -c <scope>
cc memory activate/park/archive-entry-v2 | touch-entry-v2 <id>
cc memory start/succeed/fail/cancel-job-v2 <id>
cc memory auto-park-idle-entries-v2 | auto-fail-stuck-jobs-v2
```

> **未移植**: 真实 LLM-based 摘要/聚类工作流;BM25 增量索引;跨 daily-notes 的语义合并。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (entry 4-state w/ parked→active 恢复 + job 5-state w/ 3 terminals)、双维度上限 (per-category active 在 pending→active only + per-source running 在 queued→running only)、throwing `registerEntryV2`/`createConsolidationJobV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`startedAt`/`finishedAt`、`touchEntryV2` + 2 批量 auto-flip、全枚举零初始化 `getMemoryManagerStatsV2`、SQLite memory_entries 表与 V2 内存层完全独立。

## Note Versioning V2 (cli 0.116.0)

V2 治理层位于 `src/lib/note-versioning.js`,在已有 SQLite `note_versions` 表之上叠加内存态 note + revision 治理(legacy `saveVersion`/`getHistory`/`getVersion`/`revertToVersion`/`simpleDiff`/`formatDiff` 不变):

- **Note 成熟度** (4 状态, archived 终态, locked→active 恢复): `draft → {active, archived}` · `active → {locked, archived}` · `locked → {active, archived}` (恢复 — unlock) · `archived` 终态
- **Revision 生命周期** (5 状态, 3 终态): `proposed → {reviewed, discarded}` · `reviewed → {applied, discarded, superseded}` · `applied → {superseded}` (applied **非终态** — 仍可被新 revision supersede) · 终态: superseded, discarded
- **Caps**: 每作者 active-note 上限 (默认 100,仅在 `draft → active` 强制,`locked → active` 恢复豁免) · 每 note open-revision 上限 (默认 10,统计 proposed + reviewed,在 `createRevisionV2` 创建时强制)
- **Stamp-once**: `activatedAt` (首次 draft→active,跨 locked 恢复保留) · `archivedAt` · `reviewedAt` (首次 proposed→reviewed) · `appliedAt` (首次 reviewed→applied,**非** settledAt) · `settledAt` (任意 revision 终态 superseded/discarded)
- **Auto-flip**: `autoLockIdleNotesV2({ now })` (active→locked,默认 30 天阈值) · `autoDiscardStaleRevisionsV2({ now })` (proposed/reviewed→discarded,默认 7 天阈值)

```bash
cc note note-maturities-v2 | revision-lifecycles-v2 | stats-v2
cc note register-note-v2 <id> -a <authorId> -t <title>
cc note create-revision-v2 <id> -n <noteId> -s <summary>
cc note activate/lock/archive-note-v2 | touch-note-v2 <id>
cc note review/apply/supersede/discard-revision-v2 <id>
cc note auto-lock-idle-notes-v2 | auto-discard-stale-revisions-v2
```

> **未移植**: 真实 OT/CRDT 协同编辑;LLM-based 自动 review;diff 阻塞规则。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (note 4-state w/ locked→active 恢复 + revision 5-state w/ 3 terminals 且 applied **非终态** 可被新 rev supersede)、双维度上限 (per-author active 在 draft→active only + per-note proposed+reviewed 在 createRevisionV2 创建时强制)、throwing `registerNoteV2`/`createRevisionV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`reviewedAt`/`appliedAt` (非 settledAt) /`settledAt`、`touchNoteV2` + 2 批量 auto-flip、全枚举零初始化 `getNoteVersioningStatsV2`、SQLite note_versions 表与 V2 内存层完全独立。

## Token Tracker V2 (cli 0.117.0)

V2 治理层位于 `src/lib/token-tracker.js`,在已有 SQLite `llm_usage_log` 表之上叠加内存态 budget + usage-record 治理(legacy `recordUsage`/`getUsageStats`/`getCostBreakdown`/`getRecentUsage`/`getTodayStats`/`calculateCost` 不变):

- **Budget 成熟度** (4 状态, archived 终态, suspended→active 恢复): `planning → {active, archived}` · `active → {suspended, archived}` · `suspended → {active, archived}` (恢复) · `archived` 终态
- **Usage Record 生命周期** (5 状态, 3 终态: billed/rejected/refunded): `pending → {recorded, rejected}` · `recorded → {billed, rejected, refunded}` · 终态: billed, rejected, refunded
- **Caps**: 每 owner active-budget 上限 (默认 10,仅在 `planning → active` 强制,`suspended → active` 恢复豁免) · 每 budget pending-record 上限 (默认 500,统计 pending + recorded,在 `createUsageRecordV2` 创建时强制)
- **Stamp-once**: `activatedAt` (首次 planning→active,跨 suspended 恢复保留) · `archivedAt` · `recordedAt` (首次 pending→recorded) · `settledAt` (任意 record 终态 billed/rejected/refunded)
- **Special**: `units` 接受 `0` (非负有限数);拒绝负数/NaN
- **Auto-flip**: `autoSuspendIdleBudgetsV2({ now })` (active→suspended,默认 30 天阈值) · `autoRejectStaleRecordsV2({ now })` (pending/recorded→rejected,默认 1 小时阈值)

```bash
cc tokens budget-maturities-v2 | usage-record-lifecycles-v2 | stats-v2
cc tokens register-budget-v2 <id> -o <ownerId> -l <label>
cc tokens create-usage-record-v2 <id> -b <budgetId> -u <units>
cc tokens activate/suspend/archive-budget-v2 | touch-budget-v2 <id>
cc tokens record/bill/reject/refund-usage-v2 <id>
cc tokens auto-suspend-idle-budgets-v2 | auto-reject-stale-records-v2
```

> **未移植**: 真实计费/出账系统集成;LLM 调用前置预算检查;退款审批工作流。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (budget 4-state w/ suspended→active 恢复 + record 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 planning→active only + per-budget pending+recorded 在 createUsageRecordV2 创建时强制)、throwing `registerBudgetV2`/`createUsageRecordV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`recordedAt`/`settledAt`、`touchBudgetV2` + 2 批量 auto-flip、全枚举零初始化 `getTokenTrackerStatsV2`、SQLite llm_usage_log 表与 V2 内存层完全独立。

## Automation Engine V2 (cli 0.118.0)

V2 治理层位于 `src/lib/automation-engine.js`,在已有 SQLite automation 表之上叠加内存态 automation + execution 治理(legacy `createFlow`/`executeFlow`/`fireTrigger`/连接器/模板/触发器/统计 不变):

- **Automation 成熟度** (4 状态, retired 终态, paused→active 恢复): `draft → {active, retired}` · `active → {paused, retired}` · `paused → {active, retired}` (恢复) · `retired` 终态
- **Execution 生命周期** (5 状态, 3 终态: succeeded/failed/cancelled): `queued → {running, cancelled}` · `running → {succeeded, failed, cancelled}` · 终态: succeeded, failed, cancelled
- **Caps**: 每 owner active-automation 上限 (默认 20,仅在 `draft → active` 强制,`paused → active` 恢复豁免) · 每 automation running-execution 上限 (默认 3,在 `queued → running` 强制,因为 execution 创建时为 queued)
- **Stamp-once**: `activatedAt` (首次 draft→active,跨 paused 恢复保留) · `retiredAt` · `startedAt` (首次 queued→running) · `settledAt` (任意 execution 终态 succeeded/failed/cancelled)
- **Hook 旁路**: 父命令 `automation`/`auto` 的 `preAction` 钩子初始化数据库;V2 子命令通过 `actionCommand.name().endsWith("-v2")` 提前 return,跳过 DB 引导。
- **Auto-flip**: `autoPauseIdleAutomationsV2({ now })` (active→paused,默认 14 天阈值) · `autoFailStuckExecutionsV2({ now })` (running→failed,默认 30 分钟阈值)

```bash
cc automation automation-maturities-v2 | execution-lifecycles-v2 | stats-v2
cc automation register-automation-v2 <id> -o <ownerId> -n <name>
cc automation create-execution-v2 <id> -a <automationId>
cc automation activate/pause/retire-automation-v2 | touch-automation-v2 <id>
cc automation start/succeed/fail/cancel-execution-v2 <id>
cc automation auto-pause-idle-automations-v2 | auto-fail-stuck-executions-v2
# 同样的命令也可用 cc auto <subcmd>
```

> **未移植**: 真实 SaaS 连接器认证;触发器订阅注册到 V2;模板克隆与 V2 治理。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (automation 4-state w/ paused→active 恢复 + execution 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 draft→active only + per-automation running 在 queued→running 强制)、throwing `registerAutomationV2`/`createExecutionV2` + 7 shortcuts、stamp-once `activatedAt`/`retiredAt`/`startedAt`/`settledAt`、`touchAutomationV2` + 2 批量 auto-flip、全枚举零初始化 `getAutomationEngineStatsV2`、`actionCommand.name()` 钩子旁路保护 V2 子命令免被强制 DB 引导。

## Permanent Memory V2 (cli 0.122.0)

V2 治理层位于 `src/lib/permanent-memory.js`,新建 `cc permmem` 顶级命名空间(避免与已存在的 `cc memory` 冲突,后者属于 memory-manager 模块)。V2 与原有 `CLIPermanentMemory` 类(MEMORY.md 文件 I/O、SQLite、daily notes、BM25 混合搜索)完全独立:

- **Pin 成熟度** (4 状态, archived 终态, dormant→active 恢复): `pending → {active, archived}` · `active → {dormant, archived}` · `dormant → {active, archived}` (恢复) · `archived` 终态
- **Retention Job 生命周期** (5 状态, 3 终态: completed/failed/cancelled): `queued → {running, cancelled}` · `running → {completed, failed, cancelled}` · 终态: completed, failed, cancelled
- **Caps**: 每 owner active-pin 上限 (默认 500,仅在 `pending → active` 强制,`dormant → active` 恢复豁免) · 每 pin pending-job 上限 (默认 2,统计 queued + running,在 `createRetentionJobV2` 创建时强制)
- **Stamp-once**: `activatedAt` (首次 pending→active,跨 dormant 恢复保留) · `archivedAt` · `startedAt` (首次 queued→running) · `settledAt` (任意 job 终态)
- **Auto-flip**: `autoDormantIdlePinsV2({ now })` (active→dormant,默认 90 天阈值) · `autoFailStuckJobsV2({ now })` (running→failed,默认 15 分钟阈值)

```bash
cc permmem pin-maturities-v2 | retention-job-lifecycles-v2 | stats-v2
cc permmem register-pin-v2 <id> -o <ownerId> -l <label>
cc permmem create-retention-job-v2 <id> -p <pinId> [-k <kind>]
cc permmem activate/dormant/archive-pin-v2 | touch-pin-v2 <id>
cc permmem start/complete/fail/cancel-retention-job-v2 <id>
cc permmem auto-dormant-idle-pins-v2 | auto-fail-stuck-jobs-v2
```

> **未移植**: 真实 BM25/向量索引与 V2 治理联动;MEMORY.md 文件挂钩到 pin 元数据;daily notes 与 retention-job 联动调度。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (pin 4-state w/ dormant→active 恢复 + retention-job 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 pending→active only + per-pin queued+running 在 createRetentionJobV2 创建时强制)、throwing `registerPinV2`/`createRetentionJobV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`startedAt`/`settledAt`、`touchPinV2` + 2 批量 auto-flip、全枚举零初始化 `getPermanentMemoryStatsV2`、新建 `cc permmem` 命名空间(避免与 `cc memory` 冲突)。CLIPermanentMemory 类与 V2 内存层完全独立。

## Response Cache V2 (cli 0.122.0)

V2 治理层位于 `src/lib/response-cache.js`,新建 `cc rcache` 顶级命名空间(legacy LRU 工具仍位于 `cc tokens cache`)。V2 与 SQLite `llm_cache` 表完全独立,聚焦缓存档案 (cache profile) + 刷新作业 (refresh job) 的状态机治理:

- **Profile 成熟度** (4 状态, archived 终态, suspended→active 恢复): `pending → {active, archived}` · `active → {suspended, archived}` · `suspended → {active, archived}` (恢复) · `archived` 终态
- **Refresh Job 生命周期** (5 状态, 3 终态: completed/failed/cancelled): `queued → {running, cancelled}` · `running → {completed, failed, cancelled}` · 终态: completed, failed, cancelled
- **Caps**: 每 owner active-profile 上限 (默认 25,仅在 `pending → active` 强制,`suspended → active` 恢复豁免) · 每 profile pending-job 上限 (默认 4,统计 queued + running,在 `createRefreshJobV2` 创建时强制)
- **Stamp-once**: `activatedAt` (首次 pending→active,跨 suspended 恢复保留) · `archivedAt` · `startedAt` (首次 queued→running) · `settledAt` (任意 job 终态)
- **Auto-flip**: `autoSuspendIdleProfilesV2({ now })` (active→suspended,默认 7 天阈值) · `autoFailStuckRefreshJobsV2({ now })` (running→failed,默认 10 分钟阈值)

```bash
cc rcache profile-maturities-v2 | refresh-job-lifecycles-v2 | stats-v2
cc rcache register-profile-v2 <id> -o <ownerId> -l <label>
cc rcache create-refresh-job-v2 <id> -p <profileId> [-k <kind>]
cc rcache activate/suspend/archive-profile-v2 | touch-profile-v2 <id>
cc rcache start/complete/fail/cancel-refresh-job-v2 <id>
cc rcache auto-suspend-idle-profiles-v2 | auto-fail-stuck-refresh-jobs-v2
```

> **未移植**: SQLite llm_cache 表 LRU 与 V2 治理联动;真实 LLM 响应预热作业;profile 维度的命中率 / 命中区分计费。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (profile 4-state w/ suspended→active 恢复 + refresh-job 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 pending→active only + per-profile queued+running 在 createRefreshJobV2 创建时强制)、throwing `registerProfileV2`/`createRefreshJobV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`startedAt`/`settledAt`、`touchProfileV2` + 2 批量 auto-flip、全枚举零初始化 `getResponseCacheStatsV2`、新建 `cc rcache` 命名空间(legacy LRU 仍在 `cc tokens cache`)。SQLite llm_cache 表与 V2 内存层完全独立。

## Knowledge Importer V2 (cli 0.121.0)

V2 治理层位于 `src/lib/knowledge-importer.js`,在已有 `cc import` 命名空间上追加(legacy `markdown`/`evernote`/`notion`/`pdf` 子命令各自直接调用 `bootstrap()`,无共享 preAction 钩子)。V2 与 SQLite `notes` 表完全独立,聚焦 source manifest + 导入作业的状态机治理:

- **Source 成熟度** (4 状态, archived 终态, paused→active 恢复): `pending → {active, archived}` · `active → {paused, archived}` · `paused → {active, archived}` (恢复) · `archived` 终态
- **Import Job 生命周期** (5 状态, 3 终态: completed/failed/cancelled): `queued → {running, cancelled}` · `running → {completed, failed, cancelled}` · 终态: completed, failed, cancelled
- **Caps**: 每 owner active-source 上限 (默认 15,仅在 `pending → active` 强制,`paused → active` 恢复豁免) · 每 source pending-job 上限 (默认 3,统计 queued + running,在 `createImportJobV2` 创建时强制)
- **Stamp-once**: `activatedAt` (首次 pending→active,跨 paused 恢复保留) · `archivedAt` · `startedAt` (首次 queued→running) · `settledAt` (任意 job 终态)
- **Auto-flip**: `autoPauseIdleSourcesV2({ now })` (active→paused,默认 7 天阈值) · `autoFailStuckImportJobsV2({ now })` (running→failed,默认 20 分钟阈值)

```bash
cc import source-maturities-v2 | import-job-lifecycles-v2 | stats-v2
cc import register-source-v2 <id> -o <ownerId> -l <label> [-k <kind>]
cc import create-import-job-v2 <id> -s <sourceId> [-k <kind>]
cc import activate/pause/archive-source-v2 | touch-source-v2 <id>
cc import start/complete/fail/cancel-import-job-v2 <id>
cc import auto-pause-idle-sources-v2 | auto-fail-stuck-import-jobs-v2
```

> **未移植**: 真实 SQLite notes 表与 V2 source manifest 联动;markdown/ENEX/Notion 解析进度回报到 V2 import job;PDF 大文件分页流式导入。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (source 4-state w/ paused→active 恢复 + import-job 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 pending→active only + per-source queued+running 在 createImportJobV2 创建时强制)、throwing `registerSourceV2`/`createImportJobV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`startedAt`/`settledAt`、`touchSourceV2` + 2 批量 auto-flip、全枚举零初始化 `getKnowledgeImporterStatsV2`、追加到 `cc import` 命名空间(legacy 子命令直接 `bootstrap()`,无 preAction 钩子)。SQLite notes 表与 V2 内存层完全独立。

## Knowledge Exporter V2 (cli 0.122.0)

V2 治理层位于 `src/lib/knowledge-exporter.js`,在已有 `cc export` 命名空间上追加(legacy `markdown`/`site` 子命令各自直接调用 `bootstrap()`,无共享 preAction 钩子)。V2 与 SQLite `notes` 表完全独立,聚焦 export target + 导出作业的状态机治理:

- **Target 成熟度** (4 状态, archived 终态, paused→active 恢复): `pending → {active, archived}` · `active → {paused, archived}` · `paused → {active, archived}` (恢复) · `archived` 终态
- **Export Job 生命周期** (5 状态, 3 终态: completed/failed/cancelled): `queued → {running, cancelled}` · `running → {completed, failed, cancelled}` · 终态: completed, failed, cancelled
- **Caps**: 每 owner active-target 上限 (默认 12,仅在 `pending → active` 强制,`paused → active` 恢复豁免) · 每 target pending-job 上限 (默认 3,统计 queued + running,在 `createExportJobV2` 创建时强制)
- **Stamp-once**: `activatedAt` (首次 pending→active,跨 paused 恢复保留) · `archivedAt` · `startedAt` (首次 queued→running) · `settledAt` (任意 job 终态)
- **Auto-flip**: `autoPauseIdleTargetsV2({ now })` (active→paused,默认 14 天阈值) · `autoFailStuckExportJobsV2({ now })` (running→failed,默认 25 分钟阈值)

```bash
cc export target-maturities-v2 | export-job-lifecycles-v2 | stats-v2
cc export register-target-v2 <id> -o <ownerId> -l <label> [-f <format>]
cc export create-export-job-v2 <id> -t <targetId> [-k <kind>]
cc export activate/pause/archive-target-v2 | touch-target-v2 <id>
cc export start/complete/fail/cancel-export-job-v2 <id>
cc export auto-pause-idle-targets-v2 | auto-fail-stuck-export-jobs-v2
```

> **未移植**: 真实 SQLite notes 表 → V2 export target 联动;markdown/site 写盘进度回报到 V2 export job;增量导出去重 / 缓存命中重用。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (target 4-state w/ paused→active 恢复 + export-job 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 pending→active only + per-target queued+running 在 createExportJobV2 创建时强制)、throwing `registerTargetV2`/`createExportJobV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`startedAt`/`settledAt`、`touchTargetV2` + 2 批量 auto-flip、全枚举零初始化 `getKnowledgeExporterStatsV2`、追加到 `cc export` 命名空间(legacy 子命令直接 `bootstrap()`,无 preAction 钩子)。SQLite notes 表与 V2 内存层完全独立。

### Skill Loader V2 (`cc skill` V2 surface, cli 0.123.0)

在已有四层 `CLISkillLoader` (bundled < marketplace < managed < workspace) 之上叠加内存治理层,跟踪 *skill 清单*的成熟度与执行生命周期。Legacy loader 完全不动,V2 仅维护两个独立 Map (skills / executions) 与默认配额。

- **冻结枚举**: `SKILL_MATURITY_V2` = pending|active|deprecated|archived (archived 终态;deprecated→active 恢复且豁免 cap);`EXECUTION_LIFECYCLE_V2` = queued|running|succeeded|failed|cancelled (3 终态)。
- **双维度上限**: per-owner active-skill cap 仅在 pending→active 强制 (恢复豁免);per-skill pending-execution cap 计 queued+running,在 `createExecutionV2` 创建时强制。
- **Stamp-once**: `activatedAt` 在 deprecated→active 恢复期间保留;`archivedAt`/`startedAt`/`settledAt` 一次性写入。
- **Auto-flip**: `autoDeprecateIdleSkillsV2({ now })` 把 `lastSeenAt` 超过 `skillIdleMs` (默认 30 天) 的 active 清单转 deprecated;`autoFailStuckExecutionsV2({ now })` 把 `startedAt` 超过 `execStuckMs` (默认 15 分钟) 的 running 执行转 failed。
- **CLI 子命令**: 28 个 V2 子命令追加到现有 `cc skill` 命名空间 (skill.js 无 preAction 钩子,无需 bypass)。

```text
cc skill skill-maturities-v2 | execution-lifecycles-v2 | stats-v2
cc skill get/set-max-active-skills-v2 [n]
cc skill get/set-max-pending-executions-v2 [n]
cc skill get/set-skill-idle-ms-v2 [ms]
cc skill get/set-exec-stuck-ms-v2 [ms]
cc skill active-skill-count-v2 <ownerId>
cc skill pending-execution-count-v2 <skillId>
cc skill register-skill-v2 <id> -o <owner> -n <name> [-l <layer>]
cc skill get-skill-v2 <id> | list-skills-v2 [-o] [-s] [-l]
cc skill set-skill-status-v2 <id> <next>
cc skill activate/deprecate/archive-skill-v2 | touch-skill-v2 <id>
cc skill create-execution-v2 <id> -s <skillId> [-k <kind>]
cc skill get-execution-v2 <id> | list-executions-v2 [-s] [-t]
cc skill set-execution-status-v2 <id> <next>
cc skill start/succeed/fail/cancel-execution-v2 <id>
cc skill auto-deprecate-idle-skills-v2 | auto-fail-stuck-executions-v2
```

> **未移植**: 真实文件系统 skill 目录扫描 → V2 skill 清单联动;`skill run` 调用执行器进度回报到 V2 execution;layer 优先级冲突解析。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (skill 4-state w/ deprecated→active 恢复 + execution 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 pending→active only + per-skill queued+running 在 createExecutionV2 创建时强制)、throwing `registerSkillV2`/`createExecutionV2` + 7 shortcuts、stamp-once `activatedAt`/`archivedAt`/`startedAt`/`settledAt`、`touchSkillV2` + 2 批量 auto-flip、全枚举零初始化 `getSkillLoaderStatsV2`、追加到 `cc skill` 命名空间。Multi-layer CLISkillLoader 与 V2 内存层完全独立。

### Agent Network V2 (`cc anet` V2 surface, cli 0.124.0)

在 Phase 24 去中心化 Agent 网络的 SQLite 表 (agent_dids / federated_registry_peers / agent_credentials / agent_tasks / sessions) 之上叠加内存治理层,跟踪 *agent registry 条目*的成熟度与 *task* 生命周期。Legacy DID/Kademlia/credential/task-router 代码完全不动,V2 仅维护两个独立 Map (agents / tasks) 与默认配额。

- **冻结枚举**: `AGENT_MATURITY_V2` = pending|active|suspended|revoked (revoked 终态;suspended→active 恢复且豁免 cap);`TASK_LIFECYCLE_V2` = queued|running|completed|failed|cancelled (3 终态)。
- **双维度上限**: per-network active-agent cap 仅在 pending→active 强制 (恢复豁免);per-agent pending-task cap 计 queued+running,在 `createTaskV2` 创建时强制。
- **Stamp-once**: `activatedAt` 在 suspended→active 恢复期间保留;`revokedAt`/`startedAt`/`settledAt` 一次性写入。
- **Auto-flip**: `autoSuspendIdleAgentsV2({ now })` 把 `lastSeenAt` 超过 `agentIdleMs` (默认 7 天) 的 active agent 转 suspended;`autoFailStuckTasksV2({ now })` 把 `startedAt` 超过 `taskStuckMs` (默认 30 分钟) 的 running task 转 failed。
- **CLI 子命令**: 28 个 V2 子命令追加到现有 `cc anet` 命名空间;preAction 钩子通过 `actionCommand.name().endsWith("-v2")` 提前 return,V2 子命令跳过 `_dbFromCtx` / `ensureAgentNetworkTables` 调用。

```text
cc anet agent-maturities-v2 | task-lifecycles-v2 | stats-v2
cc anet get/set-max-active-agents-v2 [n]
cc anet get/set-max-pending-tasks-v2 [n]
cc anet get/set-agent-idle-ms-v2 [ms]
cc anet get/set-task-stuck-ms-v2 [ms]
cc anet active-agent-count-v2 <networkId>
cc anet pending-task-count-v2 <agentId>
cc anet register-agent-v2 <id> -n <networkId> -d <did> [--display name]
cc anet get-agent-v2 <id> | list-agents-v2 [-n] [-s]
cc anet set-agent-status-v2 <id> <next>
cc anet activate/suspend/revoke-agent-v2 | touch-agent-v2 <id>
cc anet create-task-v2 <id> -a <agentId> [-k kind]
cc anet get-task-v2 <id> | list-tasks-v2 [-a] [-s]
cc anet set-task-status-v2 <id> <next>
cc anet start/complete/fail/cancel-task-v2 <id>
cc anet auto-suspend-idle-agents-v2 | auto-fail-stuck-tasks-v2
```

> **未移植**: 真实 SQLite agent_dids / federated_registry_peers / agent_tasks 表 → V2 agent/task 联动;Kademlia DHT 路由 / Ed25519 签名 / VC 颁发回报到 V2 agent;心跳 sweep / cross-org 任务路由进度回报到 V2 task。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (agent 4-state w/ suspended→active 恢复 + task 5-state w/ 3 terminals)、双维度上限 (per-network active 在 pending→active only + per-agent queued+running 在 createTaskV2 创建时强制)、throwing `registerAgentV2`/`createTaskV2` + 7 shortcuts、stamp-once `activatedAt`/`revokedAt`/`startedAt`/`settledAt`、`touchAgentV2` + 2 批量 auto-flip、全枚举零初始化 `getAgentNetworkStatsV2`、追加到 `cc anet` 命名空间(preAction 钩子 V2 旁路)。Phase 24 SQLite 表与 V2 内存层完全独立。

### LLM Providers V2 (`cc llm` V2 surface, cli 0.125.0)

在已有 `LLMProviderRegistry` 类与 SQLite `llm_providers` 表之上叠加内存治理层,跟踪 *provider profile* 的成熟度与 *request* 生命周期。Legacy `BUILT_IN_PROVIDERS` 目录与 Ollama/OpenAI 接口完全不动。

- **冻结枚举**: `PROVIDER_MATURITY_V2` = pending|active|suspended|retired (retired 终态;suspended→active 恢复且豁免 cap);`REQUEST_LIFECYCLE_V2` = queued|running|completed|failed|cancelled (3 终态)。
- **双维度上限**: per-owner active-profile cap 仅在 pending→active 强制 (恢复豁免);per-profile pending-request cap 计 queued+running,在 `createRequestV2` 创建时强制。
- **Stamp-once**: `activatedAt` 在 suspended→active 恢复期间保留;`retiredAt`/`startedAt`/`settledAt` 一次性写入。
- **Auto-flip**: `autoSuspendIdleProfilesV2({ now })` 把 `lastSeenAt` 超过 `profileIdleMs` (默认 14 天) 的 active profile 转 suspended;`autoFailStuckRequestsV2({ now })` 把 `startedAt` 超过 `requestStuckMs` (默认 5 分钟) 的 running request 转 failed。
- **CLI 子命令**: 28 个 V2 子命令追加到现有 `cc llm` 命名空间(llm.js 无 preAction 钩子,V2 子命令直接跳过 bootstrap)。

```text
cc llm provider-maturities-v2 | request-lifecycles-v2 | stats-v2
cc llm get/set-max-active-profiles-v2 [n]
cc llm get/set-max-pending-requests-v2 [n]
cc llm get/set-profile-idle-ms-v2 [ms]
cc llm get/set-request-stuck-ms-v2 [ms]
cc llm active-profile-count-v2 <ownerId>
cc llm pending-request-count-v2 <profileId>
cc llm register-profile-v2 <id> -o <ownerId> -p <provider> [-m model]
cc llm get-profile-v2 <id> | list-profiles-v2 [-o] [-s] [-p]
cc llm set-profile-status-v2 <id> <next>
cc llm activate/suspend/retire-profile-v2 | touch-profile-v2 <id>
cc llm create-request-v2 <id> -p <profileId> [-k kind]
cc llm get-request-v2 <id> | list-requests-v2 [-p] [-s]
cc llm set-request-status-v2 <id> <next>
cc llm start/complete/fail/cancel-request-v2 <id>
cc llm auto-suspend-idle-profiles-v2 | auto-fail-stuck-requests-v2
```

> **未移植**: 真实 SQLite `llm_providers` CRUD → V2 profile 联动;Ollama/OpenAI 实际请求执行进度回报到 V2 request;模型切换 / API key 解密 / 测速回报到 V2 profile。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (profile 4-state w/ suspended→active 恢复 + request 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 pending→active only + per-profile queued+running 在 createRequestV2 创建时强制)、throwing `registerProfileV2`/`createRequestV2` + 7 shortcuts、stamp-once `activatedAt`/`retiredAt`/`startedAt`/`settledAt`、`touchProfileV2` + 2 批量 auto-flip、全枚举零初始化 `getLlmProvidersStatsV2`、追加到 `cc llm` 命名空间。`LLMProviderRegistry` 类与 V2 内存层完全独立。

---

## P2P Manager V2 (cli 0.126.0)

在 `packages/cli/src/lib/p2p-manager.js` 末尾追加 ~330 LOC V2 内存治理面,SQLite `p2p_peers` / `p2p_messages` 表与 `P2PBridge` 类保持独立。

### 双状态机

- `PEER_MATURITY_V2` = {PENDING, ACTIVE, OFFLINE, ARCHIVED}
  - `archived` 终态;`offline → active` 为恢复转移,豁免 per-network active 上限
- `MESSAGE_LIFECYCLE_V2` = {QUEUED, SENDING, DELIVERED, FAILED, CANCELLED}
  - 3 终态:`delivered` / `failed` / `cancelled`

### 默认配置

- 每网络 100 active peer
- 每 peer 50 pending message (queued+sending)
- peer idle 阈值 10 分钟
- message stuck 阈值 60 秒

### 双维度上限

- **per-network active-peer** 仅在 `pending → active` 首次激活时检查 (offline → active 恢复豁免)
- **per-peer pending-message** 在 `createMessageV2` 时按 (queued + sending) 计数强制

### Auto-flip

- `autoOfflineIdlePeersV2({ now })` — `lastSeenAt` 距 `now` 超过 `peerIdleMs` 的 active peer → offline
- `autoFailStuckMessagesV2({ now })` — `startedAt` 距 `now` 超过 `messageStuckMs` 的 sending message → failed

### Stamp-once 时间戳

- `activatedAt` 仅首次 active 时戳一次,offline → active 恢复保持原值
- `archivedAt` / `startedAt` / `settledAt` 各仅戳一次

### CLI

```bash
cc p2p peer-maturities-v2 | message-lifecycles-v2 | stats-v2 | config-v2
cc p2p set-max-active-peers-per-network-v2 <n>
cc p2p set-max-pending-messages-per-peer-v2 <n>
cc p2p register-peer-v2 <id> -n <network> [-d name] [-t type]
cc p2p activate-peer-v2 | offline-peer-v2 | archive-peer-v2 | touch-peer-v2 <id>
cc p2p list-peers-v2 [-n] [-s] [-t]
cc p2p create-message-v2 <id> -p <peerId> [-k kind]
cc p2p start/deliver/fail/cancel-message-v2 <id>
cc p2p auto-offline-idle-peers-v2 | auto-fail-stuck-messages-v2
```

> **未移植**: 真实 SQLite peer/message CRUD、`P2PBridge` 实际网络收发、`pairDevice` / `confirmPairing` 设备配对流程都不与 V2 联动。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (peer 4-state w/ offline→active 恢复 + message 5-state w/ 3 terminals)、双维度上限 (per-network active 在 pending→active only + per-peer queued+sending 在 createMessageV2 创建时强制)、throwing `registerPeerV2` / `createMessageV2` + 7 shortcuts、stamp-once `activatedAt` / `archivedAt` / `startedAt` / `settledAt`、`touchPeerV2` + 2 批量 auto-flip、全枚举零初始化 `getP2pManagerStatsV2`、追加到 `cc p2p` 命名空间(p2p.js 无 preAction hook,V2 子命令直接跳过 bootstrap)。

---

## PQC Manager V2 (cli 0.127.0)

在 `packages/cli/src/lib/pqc-manager.js` 末尾追加 V2 内存治理面,SQLite `pqc_keys` 表与 NIST FIPS 203/204/205 算法目录 (`ML-KEM-*` / `ML-DSA-*` / `SLH-DSA-*` + 3 hybrid) 完全独立。

### 双状态机

- `KEY_MATURITY_V2` = {PENDING, ACTIVE, DEPRECATED, ARCHIVED}
  - `archived` 终态;`deprecated → active` 为恢复转移,豁免 per-owner active 上限
- `MIGRATION_LIFECYCLE_V2` = {QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED}
  - 3 终态:`completed` / `failed` / `cancelled`

### 默认配置

- 每 owner 16 active key
- 每 key 8 pending migration (queued+running)
- key idle 阈值 30 天
- migration stuck 阈值 10 分钟

### 双维度上限

- **per-owner active-key** 仅在 `pending → active` 首次激活时检查(deprecated → active 恢复豁免)
- **per-key pending-migration** 在 `createMigrationV2` 时按 (queued + running) 计数强制

### Auto-flip

- `autoDeprecateIdleKeysV2({ now })` — `lastSeenAt` 距 `now` 超过 `keyIdleMs` 的 active key → deprecated
- `autoFailStuckMigrationsV2({ now })` — `startedAt` 距 `now` 超过 `migrationStuckMs` 的 running migration → failed

### Stamp-once 时间戳

- `activatedAt` 仅首次 active 时戳一次,deprecated → active 恢复保持原值
- `archivedAt` / `startedAt` / `settledAt` 各仅戳一次

### CLI

```bash
cc pqc key-maturities-v2 | migration-lifecycles-v2 | stats-v2 | config-v2
cc pqc set-max-active-keys-per-owner-v2 <n>
cc pqc set-max-pending-migrations-per-key-v2 <n>
cc pqc register-key-v2 <id> -o <owner> -a <algo> [-p purpose]
cc pqc activate-key-v2 | deprecate-key-v2 | archive-key-v2 | touch-key-v2 <id>
cc pqc list-keys-v2 [-o] [-s] [-a]
cc pqc create-migration-v2 <id> -k <keyId> -t <targetAlgo>
cc pqc start/complete/fail/cancel-migration-v2 <id>
cc pqc auto-deprecate-idle-keys-v2 | auto-fail-stuck-migrations-v2
```

> **未移植**: 真实 SQLite `pqc_keys` CRUD 与 V2 key 联动;`generateKey` 真实 PQC 密钥生成回报到 V2;`migrate` 历史迁移计划与 V2 migration 联动;`ALGORITHM_SPECS` / `algorithmSpec` / `listAlgorithms` 仅在 legacy 面使用。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (key 4-state w/ deprecated→active 恢复 + migration 5-state w/ 3 terminals)、双维度上限 (per-owner active 在 pending→active only + per-key queued+running 在 createMigrationV2 创建时强制,sourceAlgorithm 自动从 key 取)、throwing `registerKeyV2` / `createMigrationV2` + 7 shortcuts、stamp-once `activatedAt` / `archivedAt` / `startedAt` / `settledAt`、`touchKeyV2` + 2 批量 auto-flip、全枚举零初始化 `getPqcManagerStatsV2`、追加到 `cc pqc` 命名空间(pqc.js 无 preAction hook,V2 子命令直接跳过 bootstrap)。

---

## DID Manager V2 (cli 0.128.0)

在 `packages/cli/src/lib/did-manager.js` 末尾追加 V2 内存治理面,SQLite `did_identities` 表与 Ed25519 sign/verify 辅助函数 (`createIdentity` / `signMessage` / `verifyWithDID` / `resolveDID`) 完全独立,`did-v2-manager` 也不受影响。

### 双状态机

- `IDENTITY_MATURITY_V2` = {PENDING, ACTIVE, SUSPENDED, REVOKED}
  - `revoked` 终态;`suspended → active` 为恢复转移,豁免 per-owner 上限
- `ISSUANCE_LIFECYCLE_V2` = {QUEUED, ISSUING, ISSUED, FAILED, CANCELLED}
  - 3 终态:`issued` / `failed` / `cancelled`

### 默认配置

- 每 owner 8 active identity / 每 identity 12 pending issuance / identity idle 90 天 / issuance stuck 5 分钟

### 双维度上限

- **per-owner active-identity** 仅在 `pending → active` 首次激活时检查
- **per-identity pending-issuance** 在 `createIssuanceV2` 时按 (queued + issuing) 计数强制

### Auto-flip

- `autoSuspendIdleIdentitiesV2` / `autoFailStuckIssuancesV2`,均接受 `{ now }` 覆盖

### CLI

```bash
cc did identity-maturities-v2 | issuance-lifecycles-v2 | stats-v2 | config-v2
cc did register-identity-v2 <id> -o <owner> -m <method> [-d displayName]
cc did activate-identity-v2 | suspend-identity-v2 | revoke-identity-v2 | touch-identity-v2 <id>
cc did list-identities-v2 [-o] [-s] [-m]
cc did create-issuance-v2 <id> -i <identityId> -t <credentialType>
cc did start/complete/fail/cancel-issuance-v2 <id>
cc did auto-suspend-idle-identities-v2 | auto-fail-stuck-issuances-v2
```

> **未移植**: 真实 Ed25519 密钥/DID 文档生成与 V2 identity 联动;真实 VC issuance/JSON-LD 与 V2 issuance 联动;`did-v2-manager` (DID v2.0 W3C key/web/chain) 完全独立。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (identity 4-state w/ suspended→active 恢复 + issuance 5-state w/ 3 terminals)、双维度上限、throwing API、stamp-once、`touchIdentityV2` + 2 批量 auto-flip、全枚举零初始化 stats、追加到 `cc did` 命名空间(无 preAction hook,V2 子命令直接跳过 bootstrap)。

## Crypto Manager V2 (cli 0.129.0)

在 `packages/cli/src/lib/crypto-manager.js` 末尾追加 V2 内存治理面,与既有 AES-256-GCM 加解密辅助函数完全独立。V2 命令文件 (`encrypt.js`) 通过 import alias (`KEY_MATURITY_V2 as CRYPTO_KEY_MATURITY_V2`、`cryptoRegisterKey` 等) 避免与其他 V2 模块的同名导出冲突。

### 双状态机

- `KEY_MATURITY_V2` = {PENDING, ACTIVE, ROTATED, RETIRED}
  - `retired` 终态;`rotated → active` 为恢复转移,豁免 per-owner 上限
- `CRYPTO_JOB_LIFECYCLE_V2` = {QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED}
  - 3 终态:`completed` / `failed` / `cancelled`

### 默认配置

- 每 owner 12 active key / 每 key 16 pending job / key idle 14 天 / job stuck 5 分钟
- `createJobV2` 的 `kind` 默认 `"encrypt"`,`purpose` 默认 `"encryption"`

### 双维度上限

- **per-owner active-key** 仅在 `pending → active` 首次激活时检查
- **per-key pending-job** 在 `createJobV2` 时按 (queued + running) 计数强制

### Auto-flip

- `autoRotateIdleKeysV2` / `autoFailStuckJobsV2`,均接受 `{ now }` 覆盖
- 闲置 active key → rotated;停滞 running job → failed

### Stamp-once 时间戳

- `activatedAt` (穿越 `rotated → active` 恢复保留)
- `retiredAt` / `startedAt` / `settledAt` 一次性写入

### CLI

```bash
cc encrypt key-maturities-v2 | crypto-job-lifecycles-v2 | stats-v2 | config-v2
cc encrypt register-key-v2 <id> -o <owner> -a <algorithm> [-p purpose]
cc encrypt activate-key-v2 | rotate-key-v2 | retire-key-v2 | touch-key-v2 <id>
cc encrypt list-keys-v2 [-o] [-s] [-a]
cc encrypt create-job-v2 <id> -k <keyId> [-K kind] [-P payloadHash]
cc encrypt start/complete/fail/cancel-job-v2 <id>
cc encrypt auto-rotate-idle-keys-v2 | auto-fail-stuck-jobs-v2
```

> **未移植**: 真实 AES-256-GCM 密钥派生/加解密路径与 V2 key 联动;真实加解密任务调度(并发/重试/Worker)与 V2 job 联动。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (key 4-state w/ rotated→active 恢复 + job 5-state w/ 3 terminals)、双维度上限、throwing API、stamp-once、`touchKeyV2` + 2 批量 auto-flip、全枚举零初始化 stats、追加到 `cc encrypt` 命名空间(无 preAction hook,V2 子命令直接跳过 bootstrap)。

## SSO Manager V2 (cli 0.130.0)

在 `packages/cli/src/lib/sso-manager.js` 末尾追加 V2 内存治理面,与既有 SQLite SSO 表 (`sso_configurations` / `sso_sessions` / `sso_identity_mappings`) 与 PKCE/SAML/OIDC 助手完全独立。

### 双状态机

- `PROVIDER_MATURITY_V2` = {PENDING, ACTIVE, DEPRECATED, RETIRED}
  - `retired` 终态;`deprecated → active` 为恢复转移,豁免 per-owner 上限
- `LOGIN_LIFECYCLE_V2` = {QUEUED, AUTHENTICATING, AUTHENTICATED, FAILED, CANCELLED}
  - 3 终态:`authenticated` / `failed` / `cancelled`

### 默认配置

- 每 owner 8 active provider / 每 provider 16 pending login / provider idle 30 天 / login stuck 5 分钟

### 双维度上限

- **per-owner active-provider** 仅在 `pending → active` 首次激活时检查
- **per-provider pending-login** 在 `createLoginV2` 时按 (queued + authenticating) 计数强制

### Auto-flip

- `autoDeprecateIdleProvidersV2` / `autoFailStuckLoginsV2`,均接受 `{ now }` 覆盖

### CLI

```bash
cc sso provider-maturities-v2 | login-lifecycles-v2 | stats-v2 | config-v2
cc sso register-provider-v2 <id> -o <owner> -p <protocol> [-d displayName]
cc sso activate-provider-v2 | deprecate-provider-v2 | retire-provider-v2 | touch-provider-v2 <id>
cc sso list-providers-v2 [-o] [-s] [-p]
cc sso create-login-v2 <id> -p <providerId> [-s subject]
cc sso start/complete/fail/cancel-login-v2 <id>
cc sso auto-deprecate-idle-providers-v2 | auto-fail-stuck-logins-v2
```

> **未移植**: 真实 SAML/OIDC/OAuth2 提供商交互、PKCE 流转与 V2 provider 联动;真实 IdP token 流与 V2 login 联动。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (provider 4-state w/ deprecated→active 恢复 + login 5-state w/ 3 terminals)、双维度上限、throwing API、stamp-once、`touchProviderV2` + 2 批量 auto-flip、全枚举零初始化 stats、追加到 `cc sso` 命名空间(preAction hook 通过 `actionCommand.name().endsWith("-v2")` 旁路 bootstrap)。

## Workflow Engine V2 (cli 0.130.0)

在 `packages/cli/src/lib/workflow-engine.js` 末尾追加 V2 内存治理面,与既有 SQLite workflow 表与 DAG 执行器 (`createWorkflow` / `executeWorkflow` / templates / checkpoints / breakpoints) 完全独立。

### 双状态机

- `WORKFLOW_MATURITY_V2` = {DRAFT, ACTIVE, PAUSED, RETIRED}
  - `retired` 终态;`paused → active` 为恢复转移,豁免 per-owner 上限
- `RUN_LIFECYCLE_V2` = {QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED}
  - 3 终态:`completed` / `failed` / `cancelled`

### 默认配置

- 每 owner 12 active workflow / 每 workflow 8 pending run / workflow idle 60 天 / run stuck 10 分钟

### 双维度上限

- **per-owner active-workflow** 仅在 `draft → active` 首次激活时检查
- **per-workflow pending-run** 在 `createRunV2` 时按 (queued + running) 计数强制

### Auto-flip

- `autoPauseIdleWorkflowsV2` / `autoFailStuckRunsV2`,均接受 `{ now }` 覆盖

### CLI

```bash
cc workflow workflow-maturities-v2 | run-lifecycles-v2 | stats-v2 | config-v2
cc workflow register-workflow-v2 <id> -o <owner> [-n name]
cc workflow activate-workflow-v2 | pause-workflow-v2 | retire-workflow-v2 | touch-workflow-v2 <id>
cc workflow list-workflows-v2 [-o] [-s]
cc workflow create-run-v2 <id> -w <workflowId> [-t trigger]
cc workflow start/complete/fail/cancel-run-v2 <id>
cc workflow auto-pause-idle-workflows-v2 | auto-fail-stuck-runs-v2
```

> **未移植**: 真实 DAG 拓扑执行、checkpoints/rollback/breakpoints 与 V2 workflow 联动;真实 Kahn 排序/state-channel 调度与 V2 run 联动。CLI V2 仅覆盖冻结枚举面、两条平行状态机 (workflow 4-state w/ paused→active 恢复 + run 5-state w/ 3 terminals)、双维度上限、throwing API、stamp-once、`touchWorkflowV2` + 2 批量 auto-flip、全枚举零初始化 stats、追加到 `cc workflow` 命名空间(无 preAction hook,V2 子命令直接跳过 bootstrap)。

## MCP Registry V2 (`cc mcp ... -v2`) — Phase added 2026-04-18

V2 治理覆盖层叠加在 `cc mcp` 命名空间(MCPClient 传输层不动)。状态机:server 4-state(retired 终态,degraded→active 恢复)+ invocation 5-state(3 terminals)。

```bash
cc mcp server-maturities-v2 | invocation-lifecycle-v2
cc mcp stats-v2 | config-v2 | reset-state-v2
cc mcp register-server-v2 <id> <owner> <endpoint>
cc mcp activate/degrade/retire/touch-server-v2 <id>
cc mcp get-server-v2 <id> | list-servers-v2
cc mcp create-invocation-v2 <id> <serverId> <tool>
cc mcp dispatch/complete/fail/cancel-invocation-v2 <id>
cc mcp get-invocation-v2 <id> | list-invocations-v2
cc mcp auto-degrade-idle-servers-v2 | auto-fail-stuck-invocations-v2
cc mcp set-max-active-servers-v2 <n> | set-max-pending-invocations-v2 <n>
cc mcp set-server-idle-ms-v2 <n> | set-invocation-stuck-ms-v2 <n>
```

> **未移植**: 真实 MCP transport(stdio/sse/ws)与 V2 lifecycle 联动;tool/call 调用结果回灌 V2 invocation。CLI V2 仅覆盖冻结枚举面、两条平行状态机(server 4-state w/ degraded→active 恢复 + invocation 5-state w/ 3 terminals)、双维度上限(`maxActiveServersPerOwner=10`,`maxPendingInvocationsPerServer=20`)、throwing API、stamp-once、`touchServerV2` + 2 批量 auto-flip(`serverIdleMs=7d`,`invocationStuckMs=2min`)、全枚举零初始化 stats。33 V2 tests / 65 file total。

## Agent Coordinator V2 (`cc cowork coord-*-v2`) — Phase added 2026-04-18

V2 治理覆盖层叠加在 `cc cowork` 命名空间(team/template/result 流程不动)。函数名使用 `Coord` 前缀避免与现有导出冲突。状态机:agent 4-state(retired 终态,idle→active 恢复)+ assignment 5-state(3 terminals)。

```bash
cc cowork coord-agent-maturities-v2 | coord-assignment-lifecycle-v2
cc cowork coord-stats-v2 | coord-config-v2 | coord-reset-state-v2
cc cowork coord-register-agent-v2 <id> <owner>
cc cowork coord-activate/idle/retire/touch-agent-v2 <id>
cc cowork coord-get-agent-v2 <id> | coord-list-agents-v2
cc cowork coord-create-assignment-v2 <id> <agentId>
cc cowork coord-dispatch/complete/fail/cancel-assignment-v2 <id>
cc cowork coord-get-assignment-v2 <id> | coord-list-assignments-v2
cc cowork coord-auto-idle-agents-v2 | coord-auto-fail-stuck-assignments-v2
cc cowork coord-set-max-active-agents-v2 <n> | coord-set-max-pending-assignments-v2 <n>
cc cowork coord-set-agent-idle-ms-v2 <n> | coord-set-assignment-stuck-ms-v2 <n>
```

> **未移植**: 真实 cowork team/template 调度与 V2 agent/assignment 联动;skill-tool-system 工具回调挂接到 V2 lifecycle。CLI V2 仅覆盖冻结枚举面、两条平行状态机(agent 4-state w/ idle→active 恢复 + assignment 5-state w/ 3 terminals)、双维度上限(`maxActiveAgentsPerOwner=8`,`maxPendingAssignmentsPerAgent=12`)、throwing API、stamp-once、`touchCoordAgentV2` + 2 批量 auto-flip(`agentIdleMs=1hr`,`assignmentStuckMs=5min`)、全枚举零初始化 stats。32 V2 tests / 74 file total。

## Agent Router V2 (`cc router ...-v2`) — Phase added 2026-04-18

V2 治理覆盖层以新顶层 `cc router` 命名空间引入(`cc orchestrate` 本体不动)。状态机:profile 4-state(retired 终态,degraded→active 恢复)+ dispatch 5-state(3 terminals)。

```bash
cc router maturities-v2 | dispatch-lifecycle-v2
cc router stats-v2 | config-v2 | reset-state-v2
cc router register-profile-v2 <id> <owner>
cc router activate/degrade/retire/touch-profile-v2 <id>
cc router get-profile-v2 <id> | list-profiles-v2
cc router create-dispatch-v2 <id> <profileId> [task]
cc router dispatch-v2 <id> | complete/fail/cancel-dispatch-v2 <id>
cc router get-dispatch-v2 <id> | list-dispatches-v2
cc router auto-degrade-idle-v2 | auto-fail-stuck-v2
cc router set-max-active-profiles-v2 <n> | set-max-pending-dispatches-v2 <n>
cc router set-profile-idle-ms-v2 <n> | set-dispatch-stuck-ms-v2 <n>
```

> **未移植**: 真实 ClaudeCodePool/Codex/Gemini/Ollama 多路后端调度与 V2 dispatch 联动;parallel-all 策略与 V2 dispatchedAt 写入。CLI V2 仅覆盖冻结枚举面、两条平行状态机(profile 4-state w/ degraded→active 恢复 + dispatch 5-state w/ 3 terminals)、双维度上限(`maxActiveProfilesPerOwner=8`,`maxPendingDispatchesPerProfile=16`)、throwing API、stamp-once、`touchRouterProfileV2` + 2 批量 auto-flip(`profileIdleMs=6hr`,`dispatchStuckMs=5min`)、全枚举零初始化 stats。37 V2 tests / 43 file total。

## Hook Manager V2 (`cc hook ...-v2`) — Phase added 2026-04-18

V2 治理覆盖层叠加在现有 `cc hook` 命名空间(SQLite 钩子表、`registerHook`/`executeHooks` 不动)。状态机:profile 4-state(retired 终态,disabled→active 恢复)+ exec 5-state(3 terminals)。

```bash
cc hook maturities-v2 | exec-lifecycle-v2
cc hook stats-v2 | config-v2 | reset-state-v2
cc hook register-profile-v2 <id> <owner> [event]
cc hook activate/disable/retire/touch-profile-v2 <id>
cc hook get-profile-v2 <id> | list-profiles-v2
cc hook create-exec-v2 <id> <hookId>
cc hook start/complete/fail/cancel-exec-v2 <id>
cc hook get-exec-v2 <id> | list-execs-v2
cc hook auto-disable-idle-v2 | auto-fail-stuck-v2
cc hook set-max-active-hooks-v2 <n> | set-max-pending-execs-v2 <n>
cc hook set-hook-idle-ms-v2 <n> | set-hook-exec-stuck-ms-v2 <n>
```

> **未移植**: HookEvents 枚举全集与 V2 profile event 字段的自动匹配;PreToolUse/PostToolUse/IPCError 全链路命令/脚本执行与 V2 exec lifecycle 联动。CLI V2 仅覆盖冻结枚举面、两条平行状态机(profile 4-state w/ disabled→active 恢复 + exec 5-state w/ 3 terminals)、双维度上限(`maxActiveHooksPerOwner=20`,`maxPendingExecsPerHook=32`)、throwing API、stamp-once、`touchHookProfileV2` + 2 批量 auto-flip(`hookIdleMs=24hr`,`hookExecStuckMs=1min`)、全枚举零初始化 stats。42 V2 tests / 76 file total。

## Sub-Agent Registry V2 (`cc subagent ...-v2`) — Phase added 2026-04-18

V2 治理覆盖层以新顶层 `cc subagent` 命名空间引入。状态机:profile 4-state(retired 终态,paused→active 恢复)+ task 5-state(3 terminals)。

```bash
cc subagent maturities-v2 | task-lifecycle-v2 | stats-v2 | config-v2 | reset-state-v2
cc subagent register-profile-v2 <id> <owner> [role]
cc subagent activate/pause/retire/touch-profile-v2 <id>
cc subagent get-profile-v2 <id> | list-profiles-v2
cc subagent create-task-v2 <id> <profileId> [desc]
cc subagent start/complete/fail/cancel-task-v2 <id>
cc subagent get-task-v2 <id> | list-tasks-v2
cc subagent auto-pause-idle-v2 | auto-fail-stuck-v2
cc subagent set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
```

> **未移植**: RingBuffer 历史、singleton 全进程 hook、Claude Code sub-agent 协作链路与 V2 task lifecycle 联动。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限(`maxActiveSubagentsPerOwner=12`,`maxPendingTasksPerSubagent=24`)、throwing API、stamp-once、`touchSubagentProfileV2` + 2 批量 auto-flip(`subagentIdleMs=2hr`,`subagentTaskStuckMs=5min`)、全枚举零初始化 stats。37 V2 tests / 43 file total。

## Execution Backend V2 (`cc execbe ...-v2`) — Phase added 2026-04-18

V2 治理覆盖层以新顶层 `cc execbe` 命名空间引入。状态机:backend 4-state(retired 终态,degraded→active 恢复)+ job 5-state w/ `succeeded` 终态(3 terminals)。

```bash
cc execbe maturities-v2 | job-lifecycle-v2 | stats-v2 | config-v2 | reset-state-v2
cc execbe register-backend-v2 <id> <owner> [kind]
cc execbe activate/degrade/retire/touch-backend-v2 <id>
cc execbe get-backend-v2 <id> | list-backends-v2
cc execbe create-job-v2 <id> <backendId> [cmd]
cc execbe start/succeed/fail/cancel-job-v2 <id>
cc execbe get-job-v2 <id> | list-jobs-v2
cc execbe auto-degrade-idle-v2 | auto-fail-stuck-v2
cc execbe set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
```

> **未移植**: LocalBackend/DockerBackend/SSHBackend 的真实 execSync 调度,`agent.executionBackend` 配置键与 V2 backend lifecycle 联动。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限(`maxActiveBackendsPerOwner=6`,`maxPendingJobsPerBackend=20`)、throwing API、stamp-once、`touchBackendV2` + 2 批量 auto-flip(`backendIdleMs=12hr`,`execJobStuckMs=10min`)、全枚举零初始化 stats。46 V2 tests / 68 file total。

## Todo Manager V2 (`cc todo ...-v2`) — Phase added 2026-04-18

V2 治理覆盖层以新顶层 `cc todo` 命名空间引入。状态机:list 4-state(archived 终态,paused→active 恢复)+ item 5-state w/ `in_progress` 中间态(3 terminals)。

```bash
cc todo maturities-v2 | item-lifecycle-v2 | stats-v2 | config-v2 | reset-state-v2
cc todo register-list-v2 <id> <owner> [title]
cc todo activate/pause/archive/touch-list-v2 <id>
cc todo get-list-v2 <id> | list-lists-v2
cc todo create-item-v2 <id> <listId> [desc]
cc todo start/complete/fail/cancel-item-v2 <id>
cc todo get-item-v2 <id> | list-items-v2
cc todo auto-pause-idle-v2 | auto-fail-stuck-v2
cc todo set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
```

> **未移植**: 单 `in_progress` 全局验证、per-session `writeTodos`/`getTodos` 回灌 V2 lifecycle、open-agents todo_write 工具 I/O。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限(`maxActiveTodoListsPerOwner=10`,`maxPendingItemsPerTodoList=40`)、throwing API、stamp-once、`touchTodoListV2` + 2 批量 auto-flip(`todoListIdleMs=7d`,`todoItemStuckMs=24hr`)、全枚举零初始化 stats。39 V2 tests / 41 file total。

## Session Consolidator V2 (`cc consol ...-v2`, CLI v0.134.0)

V2 治理层附加到 `packages/cli/src/lib/session-consolidator.js`，新建顶层 `cc consol` 命令，与既有 `cc session` V2 互不影响。

- `CONSOL_PROFILE_MATURITY_V2`: pending → active → paused → archived (paused → active 为 recovery，免 cap)。Terminal: archived。
- `CONSOL_JOB_LIFECYCLE_V2`: queued → running → completed | failed | cancelled。三终态。
- Caps: `maxActiveConsolProfilesPerOwner=8`, `maxPendingConsolJobsPerProfile=12`, `consolProfileIdleMs=7d`, `consolJobStuckMs=10min`。
- Auto: `autoPauseIdleConsolProfilesV2`, `autoFailStuckConsolJobsV2`。

```
cc consol enums-v2 | stats-v2
cc consol register-profile-v2 --id <id> --owner <owner> [--scope <scope>]
cc consol activate-profile-v2 <id> | pause-profile-v2 <id> | archive-profile-v2 <id> | touch-profile-v2 <id>
cc consol get-profile-v2 <id> | list-profiles-v2
cc consol create-job-v2 --id <id> --profile-id <pid> [--session-id <sid>]
cc consol start-job-v2 <id> | complete-job-v2 <id> | fail-job-v2 <id> [--reason <r>] | cancel-job-v2 <id> [--reason <r>]
cc consol get-job-v2 <id> | list-jobs-v2
cc consol set-max-active-profiles-v2 <n> | set-max-pending-jobs-v2 <n> | set-profile-idle-ms-v2 <n> | set-job-stuck-ms-v2 <n>
cc consol auto-pause-idle-profiles-v2 | auto-fail-stuck-jobs-v2
```

> **未移植**: 实际 JSONL session 读取、MemoryStore/MemoryConsolidator 挂接。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once(`activatedAt`,`archivedAt`,`startedAt`,`settledAt`)、`touchConsolProfileV2` + 2 批量 auto-flip、全枚举零初始化 stats。38 V2 tests (38 file)。

## Browser Automation V2 (`cc browse ...-v2`, CLI v0.134.0)

V2 治理层附加到 `packages/cli/src/lib/browser-automation.js`，作为 `cc browse` 的 V2 子命令注入，与既有 fetch/scrape/screenshot 辅助函数互不影响。

- `BROWSE_TARGET_MATURITY_V2`: pending → active → degraded → retired (degraded → active 为 recovery，免 cap)。Terminal: retired。
- `BROWSE_ACTION_LIFECYCLE_V2`: queued → running → completed | failed | cancelled。三终态。
- Caps: `maxActiveBrowseTargetsPerOwner=8`, `maxPendingBrowseActionsPerTarget=20`, `browseTargetIdleMs=12hr`, `browseActionStuckMs=3min`。
- Auto: `autoDegradeIdleBrowseTargetsV2`, `autoFailStuckBrowseActionsV2`。

```
cc browse enums-v2 | stats-v2
cc browse register-target-v2 --id <id> --owner <owner> [--url <url>]
cc browse activate-target-v2 <id> | degrade-target-v2 <id> | retire-target-v2 <id> | touch-target-v2 <id>
cc browse get-target-v2 <id> | list-targets-v2
cc browse create-action-v2 --id <id> --target-id <tid> [--kind <k>]
cc browse start-action-v2 <id> | complete-action-v2 <id> | fail-action-v2 <id> [--reason <r>] | cancel-action-v2 <id>
cc browse get-action-v2 <id> | list-actions-v2
cc browse set-max-active-targets-v2 <n> | set-max-pending-actions-v2 <n> | set-target-idle-ms-v2 <n> | set-action-stuck-ms-v2 <n>
cc browse auto-degrade-idle-targets-v2 | auto-fail-stuck-actions-v2
```

> **未移植**: 实际 HTTP 获取、playwright 截图、HTML 选择器。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once、`touchBrowseTargetV2` + 2 批量 auto-flip、全枚举零初始化 stats。37 V2 tests (62 file total: 25 legacy + 37 V2)。

## Matrix Bridge V2 (`cc matrix ...-v2`, CLI v0.134.0)

V2 治理层附加到 `packages/cli/src/lib/matrix-bridge.js`，作为 `cc matrix` 的 V2 子命令注入，与既有 login/E2EE/SQLite tables 互不影响。

- `MX_ROOM_MATURITY_V2`: pending → active → muted → archived (muted → active 为 recovery，免 cap)。Terminal: archived。
- `MX_MESSAGE_LIFECYCLE_V2`: queued → sending → delivered | failed | cancelled。三终态。
- Caps: `maxActiveMatrixRoomsPerOwner=20`, `maxPendingMatrixMessagesPerRoom=40`, `matrixRoomIdleMs=24hr`, `matrixMessageStuckMs=3min`。
- Auto: `autoMuteIdleMatrixRoomsV2`, `autoFailStuckMatrixMessagesV2`。

```
cc matrix enums-v2 | stats-v2
cc matrix register-room-v2 --id <id> --owner <owner> [--alias <a>]
cc matrix activate-room-v2 <id> | mute-room-v2 <id> | archive-room-v2 <id> | touch-room-v2 <id>
cc matrix get-room-v2 <id> | list-rooms-v2
cc matrix create-msg-v2 --id <id> --room-id <rid> [--body <b>]
cc matrix start-msg-v2 <id> | deliver-msg-v2 <id> | fail-msg-v2 <id> [--reason <r>] | cancel-msg-v2 <id>
cc matrix get-msg-v2 <id> | list-msgs-v2
cc matrix set-max-active-rooms-v2 <n> | set-max-pending-msgs-v2 <n> | set-room-idle-ms-v2 <n> | set-msg-stuck-ms-v2 <n>
cc matrix auto-mute-idle-rooms-v2 | auto-fail-stuck-msgs-v2
```

> **未移植**: 实际 homeserver login、E2EE、spaces、SQLite matrix_rooms/matrix_events。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once、`touchMatrixRoomV2` + 2 批量 auto-flip、全枚举零初始化 stats。37 V2 tests (86 file total: 49 legacy + 37 V2)。

## Nostr Bridge V2 (`cc nostr ...-v2`, CLI v0.134.0)

V2 治理层附加到 `packages/cli/src/lib/nostr-bridge.js`，作为 `cc nostr` 的 V2 子命令注入，与既有 relay/keypair/event-publishing/DID-mapping helpers 互不影响。

- `NOSTR_RELAY_MATURITY_V2`: pending → active → offline → retired (offline → active 为 recovery，免 cap)。Terminal: retired。
- `NOSTR_EVENT_LIFECYCLE_V2`: queued → publishing → published | failed | cancelled。三终态。
- Caps: `maxActiveNostrRelaysPerOwner=10`, `maxPendingNostrEventsPerRelay=30`, `nostrRelayIdleMs=1hr`, `nostrEventStuckMs=2min`。
- Auto: `autoOfflineIdleNostrRelaysV2`, `autoFailStuckNostrEventsV2`。

```
cc nostr enums-v2 | stats-v2
cc nostr register-relay-v2 --id <id> --owner <owner> [--url <u>]
cc nostr activate-relay-v2 <id> | offline-relay-v2 <id> | retire-relay-v2 <id> | touch-relay-v2 <id>
cc nostr get-relay-v2 <id> | list-relays-v2
cc nostr create-event-v2 --id <id> --relay-id <rid> [--kind <k>]
cc nostr start-event-v2 <id> | publish-event-v2 <id> | fail-event-v2 <id> [--reason <r>] | cancel-event-v2 <id>
cc nostr get-event-v2 <id> | list-events-v2
cc nostr set-max-active-relays-v2 <n> | set-max-pending-events-v2 <n> | set-relay-idle-ms-v2 <n> | set-event-stuck-ms-v2 <n>
cc nostr auto-offline-idle-relays-v2 | auto-fail-stuck-events-v2
```

> **未移植**: 实际 WebSocket 连接、nostr-crypto 签名、DID 映射、SQLite nostr_relays/nostr_events。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once、`touchNostrRelayV2` + 2 批量 auto-flip、全枚举零初始化 stats。39 V2 tests (80 file total: 41 legacy + 39 V2)。

## ActivityPub Bridge V2 (`cc activitypub ...-v2`, CLI v0.135.0)

V2 治理层附加到 `packages/cli/src/lib/activitypub-bridge.js`，作为 `cc activitypub` 的 V2 子命令注入，与既有 actor/outbox/inbox/delivery helpers 互不影响。

- `AP_ACTOR_MATURITY_V2`: pending → active → suspended → deactivated (suspended → active 为 recovery，免 cap)。Terminal: deactivated。
- `AP_ACTIVITY_LIFECYCLE_V2`: queued → delivering → delivered | failed | cancelled。三终态。
- Caps: `maxActiveApActorsPerOwner=15`, `maxPendingApActivitiesPerActor=25`, `apActorIdleMs=24hr`, `apActivityStuckMs=3min`。
- Auto: `autoSuspendIdleApActorsV2`, `autoFailStuckApActivitiesV2`。

```
cc activitypub enums-v2 | gov-stats-v2
cc activitypub register-actor-v2 --id <id> --owner <o> [--handle <h>]
cc activitypub activate-actor-v2 <id> | suspend-actor-v2 <id> | deactivate-actor-v2 <id> | touch-actor-v2 <id>
cc activitypub get-actor-v2 <id> | list-actors-v2
cc activitypub create-activity-v2 --id <id> --actor-id <aid> [--kind <k>]
cc activitypub start-activity-v2 <id> | deliver-activity-v2 <id> | fail-activity-v2 <id> [--reason <r>] | cancel-activity-v2 <id>
cc activitypub get-activity-v2 <id> | list-activities-v2
cc activitypub set-max-active-actors-v2 <n> | set-max-pending-activities-v2 <n> | set-actor-idle-ms-v2 <n> | set-activity-stuck-ms-v2 <n>
cc activitypub auto-suspend-idle-actors-v2 | auto-fail-stuck-activities-v2
```

> **未移植**: 实际 HTTP signatures、federation delivery、SQLite ap_* 表、WebFinger。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once、`touchApActorV2` + 2 批量 auto-flip、全枚举零初始化 stats。39 V2 tests。

## BI Engine V2 (`cc bi ...-v2`, CLI v0.135.0)

V2 治理层附加到 `packages/cli/src/lib/bi-engine.js`，与既有 query/dashboard/report/anomaly/predict 命令并存（既有 `stats-v2` 保留，治理层改用 `gov-stats-v2` 消歧）。

- `BI_DATASET_MATURITY_V2`: pending → active → stale → archived (stale → active 为 recovery，免 cap)。Terminal: archived。
- `BI_QUERY_LIFECYCLE_V2`: queued → running → completed | failed | cancelled。三终态。
- Caps: `maxActiveBiDatasetsPerOwner=8`, `maxPendingBiQueriesPerDataset=10`, `biDatasetIdleMs=7d`, `biQueryStuckMs=5min`。
- Auto: `autoStaleIdleBiDatasetsV2`, `autoFailStuckBiQueriesV2`。

```
cc bi enums-v2 | gov-stats-v2
cc bi register-dataset-v2 --id <id> --owner <o> [--source <s>]
cc bi activate-dataset-v2 <id> | stale-dataset-v2 <id> | archive-dataset-v2 <id> | touch-dataset-v2 <id>
cc bi get-dataset-v2 <id> | list-datasets-v2
cc bi create-query-v2 --id <id> --dataset-id <did> [--sql <s>]
cc bi start-query-v2 <id> | complete-query-v2 <id> | fail-query-v2 <id> [--reason <r>] | cancel-query-v2 <id>
cc bi get-query-v2 <id> | list-queries-v2
cc bi set-max-active-datasets-v2 <n> | set-max-pending-queries-v2 <n> | set-dataset-idle-ms-v2 <n> | set-query-stuck-ms-v2 <n>
cc bi auto-stale-idle-datasets-v2 | auto-fail-stuck-queries-v2
```

> **未移植**: 真实 SQL 执行、图表渲染、异常检测、预测模型、SQLite datasets/reports 表。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once、`touchBiDatasetV2` + 2 批量 auto-flip、全枚举零初始化 stats。39 V2 tests。

## DLP Engine V2 (`cc dlp ...-v2`, CLI v0.135.0)

V2 治理层附加到 `packages/cli/src/lib/dlp-engine.js`，与既有 scan/incident/policy 命令并存（既有 `dlp stats-v2` 保留，治理层改用 `gov-stats-v2` 消歧）。

- `DLP_POLICY_MATURITY_V2`: pending → active → suspended → retired (suspended → active 为 recovery，免 cap)。Terminal: retired。
- `DLP_SCAN_LIFECYCLE_V2`: queued → scanning → completed | failed | cancelled。三终态。
- Caps: `maxActiveDlpPoliciesPerOwner=16`, `maxPendingDlpScansPerPolicy=20`, `dlpPolicyIdleMs=12hr`, `dlpScanStuckMs=5min`。
- Auto: `autoSuspendIdleDlpPoliciesV2`, `autoFailStuckDlpScansV2`。

```
cc dlp enums-v2 | gov-stats-v2
cc dlp register-policy-v2 --id <id> --owner <o> [--classification <c>]
cc dlp activate-policy-v2 <id> | suspend-policy-v2 <id> | retire-policy-v2 <id> | touch-policy-v2 <id>
cc dlp get-policy-v2 <id> | list-policies-v2
cc dlp create-scan-v2 --id <id> --policy-id <pid> [--target <t>]
cc dlp start-scan-v2 <id> | complete-scan-v2 <id> | fail-scan-v2 <id> [--reason <r>] | cancel-scan-v2 <id>
cc dlp get-scan-v2 <id> | list-scans-v2
cc dlp set-max-active-policies-v2 <n> | set-max-pending-scans-v2 <n> | set-policy-idle-ms-v2 <n> | set-scan-stuck-ms-v2 <n>
cc dlp auto-suspend-idle-policies-v2 | auto-fail-stuck-scans-v2
```

> **未移植**: 真实 pattern matching、incident 存储、渠道集成、SQLite dlp_policies/dlp_incidents 表。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once、`touchDlpPolicyV2` + 2 批量 auto-flip、全枚举零初始化 stats。40 V2 tests。

## EvoMap Manager V2 (`cc evomap ...-v2`, CLI v0.135.0)

V2 治理层附加到 `packages/cli/src/lib/evomap-manager.js`，与既有 federation/gov 嵌套子命令并存。

- `EVOMAP_MAP_MATURITY_V2`: pending → active → stale → archived (stale → active 为 recovery，免 cap)。Terminal: archived。
- `EVOMAP_EVOLUTION_LIFECYCLE_V2`: queued → running → completed | failed | cancelled。三终态。
- Caps: `maxActiveEvoMapsPerOwner=10`, `maxPendingEvoEvolutionsPerMap=15`, `evoMapIdleMs=7d`, `evoEvolutionStuckMs=5min`。
- Auto: `autoStaleIdleEvoMapsV2`, `autoFailStuckEvoEvolutionsV2`。

```
cc evomap enums-v2 | gov-stats-v2
cc evomap register-map-v2 --id <id> --owner <o> [--name <n>]
cc evomap activate-map-v2 <id> | stale-map-v2 <id> | archive-map-v2 <id> | touch-map-v2 <id>
cc evomap get-map-v2 <id> | list-maps-v2
cc evomap create-evolution-v2 --id <id> --map-id <mid> [--strategy <s>]
cc evomap start-evolution-v2 <id> | complete-evolution-v2 <id> | fail-evolution-v2 <id> [--reason <r>] | cancel-evolution-v2 <id>
cc evomap get-evolution-v2 <id> | list-evolutions-v2
cc evomap set-max-active-maps-v2 <n> | set-max-pending-evolutions-v2 <n> | set-map-idle-ms-v2 <n> | set-evolution-stuck-ms-v2 <n>
cc evomap auto-stale-idle-maps-v2 | auto-fail-stuck-evolutions-v2
```

> **未移植**: 真实 genetic/evolutionary 算法、federation consensus、gov voting、SQLite evomap_* 表。CLI V2 仅覆盖冻结枚举面、两条平行状态机、双维度上限、throwing API、stamp-once、`touchEvoMapV2` + 2 批量 auto-flip、全枚举零初始化 stats。39 V2 tests。

### A2A 协议 V2 治理层 (v0.136.0)

V2 治理层附加到 `packages/cli/src/lib/a2a-protocol.js`，与既有 A2A task/card/subscription 流程并存。

- `A2A_AGENT_MATURITY_V2`: pending → active → suspended → active (recovery 免 cap) | retired (terminal)。
- `A2A_MESSAGE_LIFECYCLE_V2`: queued → sending → delivered | failed | cancelled。三终态。
- Caps: `maxActiveA2aAgentsPerOwner=12`, `maxPendingA2aMessagesPerAgent=20`, `a2aAgentIdleMs=6h`, `a2aMessageStuckMs=3min`。
- Auto: `autoSuspendIdleA2aAgentsV2`, `autoFailStuckA2aMessagesV2`。

```
cc a2a enums-v2 | gov-stats-v2
cc a2a register-agent-v2 --id <id> --owner <o> [--capabilities csv]
cc a2a activate-agent-v2 <id> | suspend-agent-v2 <id> | retire-agent-v2 <id> | touch-agent-v2 <id>
cc a2a get-agent-v2 <id> | list-agents-v2
cc a2a create-message-v2 --id <id> --agent-id <aid> [--peer-id <p>] [--payload <p>]
cc a2a start-message-v2 <id> | deliver-message-v2 <id> | fail-message-v2 <id> [--reason <r>] | cancel-message-v2 <id>
cc a2a get-message-v2 <id> | list-messages-v2
cc a2a set-max-active-agents-v2 <n> | set-max-pending-messages-v2 <n> | set-agent-idle-ms-v2 <n> | set-message-stuck-ms-v2 <n>
cc a2a auto-suspend-idle-agents-v2 | auto-fail-stuck-messages-v2
```

> **未移植**: 真实 agent-card discovery、task dispatch、typed subscription pub/sub。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、capabilities 数组深拷贝、throwing API、stamp-once、`touchA2aAgentV2` + 2 批量 auto-flip、全枚举零初始化 stats。40 V2 tests。

### ZKP 引擎 V2 治理层 (v0.136.0)

V2 治理层附加到 `packages/cli/src/lib/zkp-engine.js`，与既有电路编译 / 证明生成 helper 并存。

- `ZKP_CIRCUIT_MATURITY_V2`: pending → active → deprecated → active (recovery 免 cap) | archived (terminal)。
- `ZKP_PROOF_LIFECYCLE_V2`: queued → proving → verified | failed | cancelled。三终态。
- Caps: `maxActiveZkpCircuitsPerOwner=10`, `maxPendingZkpProofsPerCircuit=15`, `zkpCircuitIdleMs=30d`, `zkpProofStuckMs=10min`。
- Auto: `autoDeprecateIdleZkpCircuitsV2`, `autoFailStuckZkpProofsV2`。

```
cc zkp enums-v2 | gov-stats-v2
cc zkp register-circuit-v2 --id <id> --owner <o> [--scheme groth16]
cc zkp activate-circuit-v2 <id> | deprecate-circuit-v2 <id> | archive-circuit-v2 <id> | touch-circuit-v2 <id>
cc zkp get-circuit-v2 <id> | list-circuits-v2
cc zkp create-proof-v2 --id <id> --circuit-id <cid> [--inputs <i>]
cc zkp start-proof-v2 <id> | verify-proof-v2 <id> | fail-proof-v2 <id> [--reason <r>] | cancel-proof-v2 <id>
cc zkp get-proof-v2 <id> | list-proofs-v2
cc zkp set-max-active-circuits-v2 <n> | set-max-pending-proofs-v2 <n> | set-circuit-idle-ms-v2 <n> | set-proof-stuck-ms-v2 <n>
cc zkp auto-deprecate-idle-circuits-v2 | auto-fail-stuck-proofs-v2
```

> **未移植**: 真实 groth16/plonk/stark 证明生成、witness 编译、pairing verify。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、scheme 默认 groth16、throwing API、stamp-once、`touchZkpCircuitV2` + 2 批量 auto-flip、全枚举零初始化 stats。41 V2 tests。

### Cross-Chain V2 治理层 (v0.136.0)

V2 治理层附加到 `packages/cli/src/lib/cross-chain.js`，与 Phase-89 SQLite bridge 表 + SUPPORTED_CHAINS catalog 并存。

- `XCHAIN_CHANNEL_MATURITY_V2`: pending → active → paused → active (recovery 免 cap) | decommissioned (terminal)。
- `XCHAIN_TRANSFER_LIFECYCLE_V2`: queued → relaying → confirmed | failed | cancelled。三终态。
- Caps: `maxActiveXchainChannelsPerOwner=10`, `maxPendingXchainTransfersPerChannel=20`, `xchainChannelIdleMs=24h`, `xchainTransferStuckMs=15min`。
- Auto: `autoPauseIdleXchainChannelsV2`, `autoFailStuckXchainTransfersV2`。

```
cc crosschain enums-v2 | gov-stats-v2
cc crosschain register-channel-v2 --id <id> --owner <o> [--from-chain <f>] [--to-chain <t>]
cc crosschain activate-channel-v2 <id> | pause-channel-v2 <id> | decommission-channel-v2 <id> | touch-channel-v2 <id>
cc crosschain get-channel-v2 <id> | list-channels-v2
cc crosschain create-transfer-v2 --id <id> --channel-id <cid> [--amount <a>]
cc crosschain start-transfer-v2 <id> | confirm-transfer-v2 <id> | fail-transfer-v2 <id> [--reason <r>] | cancel-transfer-v2 <id>
cc crosschain get-transfer-v2 <id> | list-transfers-v2
cc crosschain set-max-active-channels-v2 <n> | set-max-pending-transfers-v2 <n> | set-channel-idle-ms-v2 <n> | set-transfer-stuck-ms-v2 <n>
cc crosschain auto-pause-idle-channels-v2 | auto-fail-stuck-transfers-v2
```

> **未移植**: 真实 bridge relayer、chain RPC、transfer proof verification、SQLite bridge/swap 表。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、fromChain/toChain 字段保留、throwing API、stamp-once、`touchXchainChannelV2` + 2 批量 auto-flip、全枚举零初始化 stats。40 V2 tests。

### DAO 治理 V2 治理层 (v0.136.0)

V2 治理层附加到 `packages/cli/src/lib/dao-governance.js`，与既有 treasury/member/vote 流程并存。

- `DAO_ORG_MATURITY_V2`: pending → active → paused → active (recovery 免 cap) | dissolved (terminal)。
- `DAO_PROPOSAL_LIFECYCLE_V2`: queued → voting → passed | failed | cancelled。三终态。
- Caps: `maxActiveDaoOrgsPerOwner=8`, `maxPendingDaoProposalsPerOrg=50`, `daoOrgIdleMs=7d`, `daoProposalStuckMs=2min`。
- Auto: `autoPauseIdleDaoOrgsV2`, `autoFailStuckDaoProposalsV2`。

```
cc dao enums-v2 | gov-stats-v2
cc dao register-org-v2 --id <id> --owner <o> [--name <n>]
cc dao activate-org-v2 <id> | pause-org-v2 <id> | dissolve-org-v2 <id> | touch-org-v2 <id>
cc dao get-org-v2 <id> | list-orgs-v2
cc dao create-proposal-v2 --id <id> --org-id <oid> [--title <t>]
cc dao start-proposal-v2 <id> | pass-proposal-v2 <id> | fail-proposal-v2 <id> [--reason <r>] | cancel-proposal-v2 <id>
cc dao get-proposal-v2 <id> | list-proposals-v2
cc dao set-max-active-orgs-v2 <n> | set-max-pending-proposals-v2 <n> | set-org-idle-ms-v2 <n> | set-proposal-stuck-ms-v2 <n>
cc dao auto-pause-idle-orgs-v2 | auto-fail-stuck-proposals-v2
```

> **未移植**: 真实 on-chain vote tally、treasury 转账、member 权重计算、SQLite dao_* 表。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchDaoOrgV2` + 2 批量 auto-flip、全枚举零初始化 stats。41 V2 tests。

---

## `cc economy` V2 Governance Surface (v0.137.0)

在 `agent-economy.js` 上叠加 in-memory V2 治理层,独立于现有支付/市场/NFT 流程。

- 账户 maturity（4 态）: `pending → active → frozen → active`(恢复), 终态 `closed`。
- Tx lifecycle（5 态,3 终态）: `queued → processing → {settled|failed|cancelled}`。
- 上限: `maxActiveEconomyAccountsPerHolder=20`（仅 pending→active 检查,恢复豁免）, `maxPendingEconomyTxsPerAccount=30`（createEconomyTxV2 时按 queued+processing 计数）。
- 阈值: `economyAccountIdleMs=7d`, `economyTxStuckMs=5min`。
- Stamp-once: `activatedAt`、`closedAt`、`startedAt`、`settledAt`。
- Auto: `autoFreezeIdleEconomyAccountsV2`, `autoFailStuckEconomyTxsV2`（均可传 `{ now }` 覆盖）。

```
cc economy enums-v2 | config-v2 | gov-stats-v2
cc economy register-account-v2 <id> <holder> [--currency <c>]
cc economy activate-account-v2 <id> | freeze-account-v2 <id> | close-account-v2 <id> | touch-account-v2 <id>
cc economy get-account-v2 <id> | list-accounts-v2
cc economy create-tx-v2 <id> <accountId> [--amount <a>]
cc economy start-tx-v2 <id> | settle-tx-v2 <id> | fail-tx-v2 <id> [reason] | cancel-tx-v2 <id> [reason]
cc economy get-tx-v2 <id> | list-txs-v2
cc economy set-max-active-accounts-v2 <n> | set-max-pending-txs-v2 <n> | set-account-idle-ms-v2 <n> | set-tx-stuck-ms-v2 <n>
cc economy auto-freeze-idle-v2 | auto-fail-stuck-v2
```

> **未移植**: price/pay/channel/market/nft/revenue 等现有命令、SQLite economy_* 表、真实清算/链上结算。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchEconomyAccountV2` + 2 批量 auto-flip、全枚举零初始化 stats（使用 `gov-stats-v2` 避免与现有 `stats-v2` 冲突）。41 V2 tests。

---

## `cc pipeline` V2 Governance Surface (v0.137.0)

在 `pipeline-orchestrator.js`(Phase 26)上叠加 in-memory V2 治理层,独立于 7-stage dev pipeline + gate + deploy 流程。

- Pipeline maturity（4 态）: `pending → active → paused → active`(恢复), 终态 `archived`。
- Run lifecycle（5 态,3 终态）: `queued → running → {completed|failed|cancelled}`。
- 上限: `maxActivePipelinesPerOwner=10`（仅 pending→active 检查,恢复豁免）, `maxPendingPipelineRunsPerPipeline=20`（createPipelineRunV2 时按 queued+running 计数）。
- 阈值: `pipelineIdleMs=3d`, `pipelineRunStuckMs=10min`。
- Stamp-once: `activatedAt`、`archivedAt`、`startedAt`、`settledAt`。
- Auto: `autoPauseIdlePipelinesV2`, `autoFailStuckPipelineRunsV2`。

```
cc pipeline enums-v2 | config-v2 | gov-stats-v2
cc pipeline register-pipeline-v2 <id> <owner> [--name <n>]
cc pipeline activate-pipeline-v2 <id> | pause-pipeline-v2 <id> | archive-pipeline-v2 <id> | touch-pipeline-v2 <id>
cc pipeline get-pipeline-v2 <id> | list-pipelines-v2
cc pipeline create-run-v2 <id> <pipelineId> [--trigger <t>]
cc pipeline start-run-v2 <id> | complete-run-v2 <id> | fail-run-v2 <id> [reason] | cancel-run-v2 <id> [reason]
cc pipeline get-run-v2 <id> | list-runs-v2
cc pipeline set-max-active-pipelines-v2 <n> | set-max-pending-runs-v2 <n> | set-pipeline-idle-ms-v2 <n> | set-run-stuck-ms-v2 <n>
cc pipeline auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**: 7-stage dev pipeline DAG 执行、gate/deploy/artifact 真实调度、SQLite pipeline_* 表。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchPipelineV2` + 2 批量 auto-flip、全枚举零初始化 stats。41 V2 tests。

---

## `cc evolution` V2 Governance Surface (v0.137.0)

在 `evolution-system.js` 上叠加 in-memory V2 治理层,独立于现有 capability assess/learn/diagnose 流程。

- Goal maturity（4 态）: `pending → active → paused → active`(恢复), 终态 `archived`。
- Cycle lifecycle（5 态,3 终态）: `queued → running → {completed|failed|cancelled}`。
- 上限: `maxActiveEvoGoalsPerOwner=6`（仅 pending→active 检查,恢复豁免）, `maxPendingEvoCyclesPerGoal=12`（createEvoCycleV2 时按 queued+running 计数）。
- 阈值: `evoGoalIdleMs=14d`, `evoCycleStuckMs=10min`。
- Stamp-once: `activatedAt`、`archivedAt`、`startedAt`、`settledAt`。
- Auto: `autoPauseIdleEvoGoalsV2`, `autoFailStuckEvoCyclesV2`。

```
cc evolution enums-v2 | config-v2 | gov-stats-v2
cc evolution register-goal-v2 <id> <owner> [--objective <o>]
cc evolution activate-goal-v2 <id> | pause-goal-v2 <id> | archive-goal-v2 <id> | touch-goal-v2 <id>
cc evolution get-goal-v2 <id> | list-goals-v2
cc evolution create-cycle-v2 <id> <goalId> [--generation <n>]
cc evolution start-cycle-v2 <id> | complete-cycle-v2 <id> | fail-cycle-v2 <id> [reason] | cancel-cycle-v2 <id> [reason]
cc evolution get-cycle-v2 <id> | list-cycles-v2
cc evolution set-max-active-goals-v2 <n> | set-max-pending-cycles-v2 <n> | set-goal-idle-ms-v2 <n> | set-cycle-stuck-ms-v2 <n>
cc evolution auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**: capability score 计算、learning 真实训练、diagnose 推理、SQLite evolution_* 表。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchEvoGoalV2` + 2 批量 auto-flip、全枚举零初始化 stats（使用 `gov-stats-v2` 避免与现有 `stats-v2` 冲突）。41 V2 tests。

---

## `cc hmemory` V2 Governance Surface (v0.137.0)

在 `hierarchical-memory.js` 上叠加 in-memory V2 治理层,独立于现有四层存储/检索流程。

- Tier maturity（4 态）: `pending → active → dormant → active`(恢复), 终态 `retired`。
- Promotion lifecycle（5 态,3 终态）: `queued → promoting → {promoted|failed|cancelled}`。
- 上限: `maxActiveHmemTiersPerOwner=12`（仅 pending→active 检查,恢复豁免）, `maxPendingHmemPromotionsPerTier=30`（createHmemPromotionV2 时按 queued+promoting 计数）。
- 阈值: `hmemTierIdleMs=30d`, `hmemPromotionStuckMs=5min`。
- Stamp-once: `activatedAt`、`retiredAt`、`startedAt`、`settledAt`。
- Auto: `autoDormantIdleHmemTiersV2`, `autoFailStuckHmemPromotionsV2`。

```
cc hmemory enums-v2 | config-v2 | gov-stats-v2
cc hmemory register-tier-v2 <id> <owner> [--level <l>]
cc hmemory activate-tier-v2 <id> | dormant-tier-v2 <id> | retire-tier-v2 <id> | touch-tier-v2 <id>
cc hmemory get-tier-v2 <id> | list-tiers-v2
cc hmemory create-promotion-v2 <id> <tierId> [--item-key <k>]
cc hmemory start-promotion-v2 <id> | complete-promotion-v2 <id> | fail-promotion-v2 <id> [reason] | cancel-promotion-v2 <id> [reason]
cc hmemory get-promotion-v2 <id> | list-promotions-v2
cc hmemory set-max-active-tiers-v2 <n> | set-max-pending-promotions-v2 <n> | set-tier-idle-ms-v2 <n> | set-promotion-stuck-ms-v2 <n>
cc hmemory auto-dormant-idle-v2 | auto-fail-stuck-v2
```

> **未移植**: 真实四层 RAG 查询/检索、importance-based 层级分发、embeddings、SQLite hmem_* 表。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchHmemTierV2` + 2 批量 auto-flip、全枚举零初始化 stats（使用 `gov-stats-v2` 避免与现有 `stats-v2` 冲突）。41 V2 tests。

### App Builder V2 治理面（v0.138.0）

CLI 子命令 `cc lowcode ...-v2` 在 app-builder.js 之上新增内存内 V2 治理层，与原有 create/deploy/generate 流程相互独立。

- App maturity（4 态）: `pending → active → paused → active`(恢复), 终态 `archived`。
- Build lifecycle（5 态,3 终态）: `queued → building → {succeeded|failed|cancelled}`。
- 上限: `maxActiveAppsPerOwner=10`（仅 pending→active 检查,恢复豁免）, `maxPendingAppBuildsPerApp=20`（createAppBuildV2 时按 queued+building 计数）。
- 阈值: `appIdleMs=30d`, `appBuildStuckMs=10min`。
- Stamp-once: `activatedAt`、`archivedAt`、`startedAt`、`settledAt`。
- Auto: `autoPauseIdleAppsV2`, `autoFailStuckAppBuildsV2`。

```
cc lowcode enums-v2 | config-v2 | gov-stats-v2
cc lowcode register-app-v2 <id> <owner> [--name <n>]
cc lowcode activate-app-v2 <id> | pause-app-v2 <id> | archive-app-v2 <id> | touch-app-v2 <id>
cc lowcode get-app-v2 <id> | list-apps-v2
cc lowcode create-build-v2 <id> <appId> [--target <t>]
cc lowcode start-build-v2 <id> | succeed-build-v2 <id> | fail-build-v2 <id> [reason] | cancel-build-v2 <id> [reason]
cc lowcode get-build-v2 <id> | list-builds-v2
cc lowcode set-max-active-apps-v2 <n> | set-max-pending-builds-v2 <n> | set-app-idle-ms-v2 <n> | set-build-stuck-ms-v2 <n>
cc lowcode auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**: 真实低代码 schema/build pipeline/部署目标。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchAppV2` + 2 批量 auto-flip、全枚举零初始化 stats。45 V2 tests。

### SIEM Exporter V2 治理面（v0.138.0）

CLI 子命令 `cc siem ...-v2` 在 siem-exporter.js 之上新增内存内 V2 治理层，与原有 SQLite 目标/导出流程相互独立。

- Target maturity（4 态）: `pending → active → degraded → active`(恢复), 终态 `retired`。
- Export lifecycle（5 态,3 终态）: `queued → sending → {delivered|failed|cancelled}`。
- 上限: `maxActiveSiemTargetsPerOperator=8`（仅 pending→active 检查,恢复豁免）, `maxPendingSiemExportsPerTarget=50`（createSiemExportV2 时按 queued+sending 计数）。
- 阈值: `siemTargetIdleMs=24h`, `siemExportStuckMs=5min`。
- Stamp-once: `activatedAt`、`retiredAt`、`startedAt`、`settledAt`。
- Auto: `autoDegradeIdleSiemTargetsV2`, `autoFailStuckSiemExportsV2`。

```
cc siem enums-v2 | config-v2 | gov-stats-v2
cc siem register-target-v2 <id> <operator> [--kind <k>]
cc siem activate-target-v2 <id> | degrade-target-v2 <id> | retire-target-v2 <id> | touch-target-v2 <id>
cc siem get-target-v2 <id> | list-targets-v2
cc siem create-export-v2 <id> <targetId> [--format <f>]
cc siem start-export-v2 <id> | deliver-export-v2 <id> | fail-export-v2 <id> [reason] | cancel-export-v2 <id> [reason]
cc siem get-export-v2 <id> | list-exports-v2
cc siem set-max-active-targets-v2 <n> | set-max-pending-exports-v2 <n> | set-target-idle-ms-v2 <n> | set-export-stuck-ms-v2 <n>
cc siem auto-degrade-idle-v2 | auto-fail-stuck-v2
```

> **未移植**: 真实 Splunk HEC/Elastic/Syslog 协议适配、批量推送队列、SIEM 模板。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchSiemTargetV2` + 2 批量 auto-flip、全枚举零初始化 stats。45 V2 tests。

### Autonomous Agent V2 治理面（v0.138.0）

新增顶层命令 `cc autoagent ...-v2`，在 autonomous-agent.js 之上提供内存内 V2 治理层。与交互式 `cc agent`（启动 agent session,无子命令）相互独立。

- Agent maturity（4 态）: `pending → active → paused → active`(恢复), 终态 `archived`。
- Run lifecycle（5 态,3 终态）: `queued → running → {completed|failed|cancelled}`。
- 上限: `maxActiveAutoAgentsPerOwner=5`（仅 pending→active 检查,恢复豁免）, `maxPendingAutoAgentRunsPerAgent=10`（createAutoAgentRunV2 时按 queued+running 计数）。
- 阈值: `autoAgentIdleMs=7d`, `autoAgentRunStuckMs=30min`。
- Stamp-once: `activatedAt`、`archivedAt`、`startedAt`、`settledAt`。
- Auto: `autoPauseIdleAutoAgentsV2`, `autoFailStuckAutoAgentRunsV2`。

```
cc autoagent enums-v2 | config-v2 | gov-stats-v2
cc autoagent register-agent-v2 <id> <owner> [--goal <g>]
cc autoagent activate-agent-v2 <id> | pause-agent-v2 <id> | archive-agent-v2 <id> | touch-agent-v2 <id>
cc autoagent get-agent-v2 <id> | list-agents-v2
cc autoagent create-run-v2 <id> <agentId> [--prompt <p>]
cc autoagent start-run-v2 <id> | complete-run-v2 <id> | fail-run-v2 <id> [reason] | cancel-run-v2 <id> [reason]
cc autoagent get-run-v2 <id> | list-runs-v2
cc autoagent set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc autoagent auto-pause-idle-v2 | auto-fail-stuck-v2 | reset-state-v2
```

> **未移植**: 真实 ReAct/思维链执行循环、tool-use、planner/critic 协作。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchAutoAgentV2` + 2 批量 auto-flip、全枚举零初始化 stats。45 V2 tests。

### Compliance Framework Reporter V2 治理面（v0.138.0）

`cc compliance fwrep-...-v2` 子命令在 compliance-framework-reporter.js 之上新增内存内 V2 治理层。`fwrep-*` 前缀避免与已有 compliance V2（`frameworks-v2`、`evidence-statuses-v2`、`stats-v2`）冲突。

- Framework maturity（4 态）: `pending → active → deprecated → active`(恢复), 终态 `archived`。
- Report lifecycle（5 态,3 终态）: `queued → generating → {completed|failed|cancelled}`。
- 上限: `maxActiveComplianceFwsPerOwner=8`（仅 pending→active 检查,恢复豁免）, `maxPendingComplianceFwReportsPerFw=15`（createComplianceFwReportV2 时按 queued+generating 计数）。
- 阈值: `complianceFwIdleMs=90d`, `complianceFwReportStuckMs=10min`。
- Stamp-once: `activatedAt`、`archivedAt`、`startedAt`、`settledAt`。
- Auto: `autoDeprecateIdleComplianceFwsV2`, `autoFailStuckComplianceFwReportsV2`。

```
cc compliance fwrep-enums-v2 | fwrep-config-v2 | fwrep-gov-stats-v2
cc compliance fwrep-register-v2 <id> <owner> [--name <n>]
cc compliance fwrep-activate-v2 <id> | fwrep-deprecate-v2 <id> | fwrep-archive-v2 <id> | fwrep-touch-v2 <id>
cc compliance fwrep-get-v2 <id> | fwrep-list-v2
cc compliance fwrep-create-report-v2 <id> <frameworkId> [--format <f>]
cc compliance fwrep-start-report-v2 <id> | fwrep-complete-report-v2 <id> | fwrep-fail-report-v2 <id> [reason] | fwrep-cancel-report-v2 <id> [reason]
cc compliance fwrep-get-report-v2 <id> | fwrep-list-reports-v2
cc compliance fwrep-set-max-active-v2 <n> | fwrep-set-max-pending-v2 <n> | fwrep-set-fw-idle-ms-v2 <n> | fwrep-set-report-stuck-ms-v2 <n>
cc compliance fwrep-auto-deprecate-idle-v2 | fwrep-auto-fail-stuck-v2
```

> **未移植**: 真实 GDPR/SOC2/HIPAA/ISO27001 evidence 收集、控制项 → 报告聚合渲染。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchComplianceFwV2` + 2 批量 auto-flip、全枚举零初始化 stats（使用 `fwrep-gov-stats-v2` 避免与现有 `stats-v2` 冲突）。45 V2 tests。

---

## Phase Iter11-A: Git Integration V2 治理面（CLI v0.139.0）

`cc git ...-v2` —— 将治理覆盖层追加到 `packages/cli/src/lib/git-integration.js`，原 `gitStatus / gitAutoCommit / gitLog / gitHistoryAnalyze / gitInit / isGitRepo` helpers 不变。

### 设计要点
- 4 态仓库成熟度：`pending → active → archived → decommissioned`（`decommissioned` 终态；`archived → active` 恢复豁免 active 上限）
- 5 态提交生命周期：`queued → committing → {committed, failed, cancelled}`（3 终态）
- 上限：`maxActiveGitReposPerOwner=10`、`maxPendingGitCommitsPerRepo=20`
- 阈值：`gitRepoIdleMs=30 天`、`gitCommitStuckMs=5 分钟`
- 自动翻转：`autoArchiveIdleGitReposV2`、`autoFailStuckGitCommitsV2`（均支持 `{ now }` 注入）
- Stamp-once：`activatedAt`、`decommissionedAt`、`startedAt`、`settledAt`
- 仓库字段：`branch`（默认 `"main"`）、`owner` 必填
- 提交字段：`message`、`repoId` 必填

### 命令
```
cc git enums-v2 | gov-stats-v2
cc git config-set-v2 --max-active <n> --max-pending <n> --idle-ms <n> --stuck-ms <n>
cc git register-repo-v2 <id> --owner <owner> [--branch <b>]
cc git activate-repo-v2 <id> | archive-repo-v2 <id> | decommission-repo-v2 <id> | touch-repo-v2 <id>
cc git get-repo-v2 <id> | list-repos-v2
cc git create-commit-v2 <id> --repo-id <rid> [--message <m>]
cc git start-commit-v2 <id> | commit-commit-v2 <id> | fail-commit-v2 <id> | cancel-commit-v2 <id>
cc git get-commit-v2 <id> | list-commits-v2
cc git auto-archive-repos-v2 | auto-fail-commits-v2
```

> **未移植**：真实 git 仓库状态读取、auto-commit 推送、history 分析。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchGitRepoV2` + 2 批量 auto-flip、全枚举零初始化 stats。45 V2 tests。

---

## Phase Iter11-B: Cowork Task Runner V2 治理面（CLI v0.139.0）

`cc cowork runner-...-v2` —— 将治理覆盖层追加到 `packages/cli/src/lib/cowork-task-runner.js`，原 `CoworkTaskRunner` 类不变。使用 `runner-*` 前缀避免与现有 `coord-*-v2`（Agent Coordinator V2）命令冲突。

### 设计要点
- 4 态 Runner Profile 成熟度：`pending → active → paused → retired`（`retired` 终态；`paused → active` 恢复豁免 active 上限）
- 5 态 Runner Exec 生命周期：`queued → running → {succeeded, failed, cancelled}`（3 终态）
- 上限：`maxActiveRunnerProfilesPerOwner=8`、`maxPendingRunnerExecsPerProfile=15`
- 阈值：`runnerProfileIdleMs=14 天`、`runnerExecStuckMs=20 分钟`
- 自动翻转：`autoPauseIdleRunnerProfilesV2`、`autoFailStuckRunnerExecsV2`
- Stamp-once：`activatedAt`、`retiredAt`、`startedAt`、`settledAt`
- Profile 字段：`template`（默认 `"default"`）、`owner` 必填
- Exec 字段：`taskInput`、`profileId` 必填

### 命令
```
cc cowork runner-enums-v2 | runner-gov-stats-v2
cc cowork runner-config-set-v2 --max-active <n> --max-pending <n> --idle-ms <n> --stuck-ms <n>
cc cowork runner-register-profile-v2 <id> --owner <owner> [--template <t>]
cc cowork runner-activate-profile-v2 <id> | runner-pause-profile-v2 <id> | runner-retire-profile-v2 <id> | runner-touch-profile-v2 <id>
cc cowork runner-get-profile-v2 <id> | runner-list-profiles-v2
cc cowork runner-create-exec-v2 <id> --profile-id <pid> [--task-input <t>]
cc cowork runner-start-exec-v2 <id> | runner-succeed-exec-v2 <id> | runner-fail-exec-v2 <id> | runner-cancel-exec-v2 <id>
cc cowork runner-get-exec-v2 <id> | runner-list-execs-v2
cc cowork runner-auto-pause-profiles-v2 | runner-auto-fail-execs-v2
```

> **未移植**：真实 Runner 子进程编排、模板装配、结果归集。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchRunnerProfileV2` + 2 批量 auto-flip、全枚举零初始化 stats（使用 `runner-gov-stats-v2` 避免与 `coord-gov-stats-v2` 重名）。45 V2 tests。

---

## Phase Iter11-C: Inference Network V2 治理面（CLI v0.139.0）

`cc inference ...-v2`（治理覆盖层）—— 追加到 `packages/cli/src/lib/inference-network.js`，与文件中预存在的 task-scheduling V2 面（`submit-v2 / dispatch-v2 / complete-v2 / fail-v2 / node-statuses-v2 / task-statuses-v2 / privacy-modes-v2 / stats-v2`）共存：本治理面引入 operator 维度的节点生命周期与按节点的 job 生命周期。

### 设计要点
- 4 态 Inference Node 成熟度：`pending → active → degraded → decommissioned`（`decommissioned` 终态；`degraded → active` 恢复豁免 active 上限）
- 5 态 Inference Job 生命周期：`queued → running → {completed, failed, cancelled}`（3 终态）
- 上限：`maxActiveInferenceNodesPerOperator=12`、`maxPendingInferenceJobsPerNode=25`
- 阈值：`inferenceNodeIdleMs=24 小时`、`inferenceJobStuckMs=10 分钟`
- 自动翻转：`autoDegradeIdleInferenceNodesV2`、`autoFailStuckInferenceJobsV2`
- Stamp-once：`activatedAt`、`decommissionedAt`、`startedAt`、`settledAt`
- Node 字段：`model`（默认 `"default"`）、`operator` 必填
- Job 字段：`prompt`、`nodeId` 必填

### 命令
```
cc inference enums-v2 | gov-stats-v2
cc inference config-set-v2 --max-active <n> --max-pending <n> --idle-ms <n> --stuck-ms <n>
cc inference register-node-v2 <id> --operator <op> [--model <m>]
cc inference activate-node-v2 <id> | degrade-node-v2 <id> | decommission-node-v2 <id> | touch-node-v2 <id>
cc inference get-node-v2 <id> | list-nodes-v2
cc inference create-job-v2 <id> --node-id <nid> [--prompt <p>]
cc inference start-job-v2 <id> | complete-job-v2 <id> | fail-job-v2 <id> | cancel-job-v2 <id>
cc inference get-job-v2 <id> | list-jobs-v2
cc inference auto-degrade-nodes-v2 | auto-fail-jobs-v2
```

> **未移植**：真实分布式推理调度、模型路由、隐私模式枚举执行（已存在于其他 V2 面）。CLI V2 治理面仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchInferenceNodeV2` + 2 批量 auto-flip、全枚举零初始化 stats（使用 `gov-stats-v2` 避免与 `stats-v2` 冲突）。45 V2 tests。

---

## Phase Iter11-D: Content Recommender V2 治理面（CLI v0.139.0）

`cc recommend cr-...-v2` —— 将治理覆盖层追加到 `packages/cli/src/lib/content-recommender.js`，使用 `cr-*` 前缀避免与 `content-recommendation.js` 既有 `register-profile-v2 / register-feed-v2 / stats-v2` 命令冲突。

### 设计要点
- 4 态 Recommender Profile 成熟度：`pending → active → stale → archived`（`archived` 终态；`stale → active` 恢复豁免 active 上限）
- 5 态 Recommendation Job 生命周期：`queued → running → {completed, failed, cancelled}`（3 终态）
- 上限：`maxActiveRecommenderProfilesPerOwner=8`、`maxPendingRecommendationJobsPerProfile=10`
- 阈值：`recommenderProfileIdleMs=7 天`、`recommendationJobStuckMs=5 分钟`
- 自动翻转：`autoStaleIdleRecommenderProfilesV2`、`autoFailStuckRecommendationJobsV2`
- Stamp-once：`activatedAt`、`archivedAt`、`startedAt`、`settledAt`
- Profile 字段：`strategy`（默认 `"tfidf"`）、`owner` 必填
- Job 字段：`query`、`profileId` 必填

### 命令
```
cc recommend cr-enums-v2 | cr-gov-stats-v2
cc recommend cr-config-set-v2 --max-active <n> --max-pending <n> --idle-ms <n> --stuck-ms <n>
cc recommend cr-register-profile-v2 <id> --owner <owner> [--strategy <s>]
cc recommend cr-activate-profile-v2 <id> | cr-stale-profile-v2 <id> | cr-archive-profile-v2 <id> | cr-touch-profile-v2 <id>
cc recommend cr-get-profile-v2 <id> | cr-list-profiles-v2
cc recommend cr-create-job-v2 <id> --profile-id <pid> [--query <q>]
cc recommend cr-start-job-v2 <id> | cr-complete-job-v2 <id> | cr-fail-job-v2 <id> | cr-cancel-job-v2 <id>
cc recommend cr-get-job-v2 <id> | cr-list-jobs-v2
cc recommend cr-auto-stale-profiles-v2 | cr-auto-fail-jobs-v2
```

> **未移植**：真实 TF-IDF / BM25 / 协同过滤排序、向量召回、点击反馈循环。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchRecommenderProfileV2` + 2 批量 auto-flip、全枚举零初始化 stats（使用 `cr-*` 前缀 + `cr-gov-stats-v2` 避免与现有面冲突）。45 V2 tests。

## Phase Iter12-A — Orchestrator V2 治理面（CLI v0.140.0）

新增 `cc orchgov` 顶级命令，独立于已存在的 `cc orchestrate router *-v2`（Agent Router V2），治理 orchestrator profile + task lifecycle。

### 设计要点
- 4 态 Orch Profile 成熟度：`pending → active → paused → retired`（`retired` 终态；`paused → active` 恢复豁免 active 上限）
- 5 态 Orch Task 生命周期：`queued → dispatching → {completed, failed, cancelled}`（3 终态）
- 上限：`maxActiveOrchProfilesPerOwner=6`、`maxPendingOrchTasksPerProfile=12`
- 阈值：`orchProfileIdleMs=14 天`、`orchTaskStuckMs=15 分钟`
- 自动翻转：`autoPauseIdleOrchProfilesV2`、`autoFailStuckOrchTasksV2`
- Stamp-once：`activatedAt`、`retiredAt`、`startedAt`、`settledAt`
- Profile 字段：`source`（默认 `"cli"`）、`owner` 必填
- Task 字段：`prompt`、`profileId` 必填

### 命令
```
cc orchgov enums-v2 | gov-stats-v2 | config-v2
cc orchgov set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc orchgov register-profile-v2 <id> <owner> [--source <s>]
cc orchgov activate-profile-v2 <id> | pause-profile-v2 <id> | retire-profile-v2 <id> | touch-profile-v2 <id>
cc orchgov get-profile-v2 <id> | list-profiles-v2
cc orchgov create-task-v2 <id> <profileId> [--prompt <p>]
cc orchgov dispatch-task-v2 <id> | complete-task-v2 <id> | fail-task-v2 <id> [reason] | cancel-task-v2 <id> [reason]
cc orchgov get-task-v2 <id> | list-tasks-v2
cc orchgov auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 LLM 调度、Cowork agent 协作、流式输出。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchOrchProfileV2` + 2 批量 auto-flip、全枚举零初始化 stats（新顶级 `orchgov` 避免与已存在 `cc orchestrate router *-v2` 冲突）。45 V2 tests。

## Phase Iter12-B — Perf Tuning V2 治理面（CLI v0.140.0）

在已存在的 `cc perf` 顶级命令下追加 V2 governance overlay，治理 perf tuning profile + bench lifecycle，独立于 Phase 22 的 SQLite 采样器。

### 设计要点
- 4 态 Perf Tuning Profile 成熟度：`pending → active → stale → decommissioned`（`decommissioned` 终态；`stale → active` 恢复豁免 active 上限）
- 5 态 Perf Bench 生命周期：`queued → running → {completed, failed, cancelled}`（3 终态）
- 上限：`maxActivePerfTuningProfilesPerOwner=6`、`maxPendingPerfBenchesPerProfile=10`
- 阈值：`perfTuningProfileIdleMs=7 天`、`perfBenchStuckMs=30 分钟`
- 自动翻转：`autoStaleIdlePerfTuningProfilesV2`、`autoFailStuckPerfBenchesV2`
- Stamp-once：`activatedAt`、`decommissionedAt`、`startedAt`、`settledAt`
- Profile 字段：`target`（默认 `"default"`）、`owner` 必填
- Bench 字段：`scenario`、`profileId` 必填

### 命令
```
cc perf enums-v2 | gov-stats-v2 | config-v2
cc perf set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc perf register-profile-v2 <id> <owner> [--target <t>]
cc perf activate-profile-v2 <id> | stale-profile-v2 <id> | decommission-profile-v2 <id> | touch-profile-v2 <id>
cc perf get-profile-v2 <id> | list-profiles-v2
cc perf create-bench-v2 <id> <profileId> [--scenario <s>]
cc perf start-bench-v2 <id> | complete-bench-v2 <id> | fail-bench-v2 <id> [reason] | cancel-bench-v2 <id> [reason]
cc perf get-bench-v2 <id> | list-benches-v2
cc perf auto-stale-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：os.cpus 实采、SQLite 环形缓冲、5 内置规则评估。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchPerfTuningProfileV2` + 2 批量 auto-flip、全枚举零初始化 stats（V2 命令以 `*-v2` 后缀注入 perf 顶级，与 Phase 22 SQLite 命令不冲突）。45 V2 tests。

## Phase Iter12-C — Topic Classifier V2 治理面（CLI v0.140.0）

新增 `cc topiccls` 顶级命令，治理 topic classifier profile + classification job lifecycle。

### 设计要点
- 4 态 Topic Cls Profile 成熟度：`pending → active → stale → archived`（`archived` 终态；`stale → active` 恢复豁免 active 上限）
- 5 态 Topic Cls Job 生命周期：`queued → running → {completed, failed, cancelled}`（3 终态）
- 上限：`maxActiveTopicClsProfilesPerOwner=8`、`maxPendingTopicClsJobsPerProfile=20`
- 阈值：`topicClsProfileIdleMs=14 天`、`topicClsJobStuckMs=5 分钟`
- 自动翻转：`autoStaleIdleTopicClsProfilesV2`、`autoFailStuckTopicClsJobsV2`
- Stamp-once：`activatedAt`、`archivedAt`、`startedAt`、`settledAt`
- Profile 字段：`model`（默认 `"default"`）、`owner` 必填
- Job 字段：`text`、`profileId` 必填

### 命令
```
cc topiccls enums-v2 | gov-stats-v2 | config-v2
cc topiccls set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc topiccls register-profile-v2 <id> <owner> [--model <m>]
cc topiccls activate-profile-v2 <id> | stale-profile-v2 <id> | archive-profile-v2 <id> | touch-profile-v2 <id>
cc topiccls get-profile-v2 <id> | list-profiles-v2
cc topiccls create-job-v2 <id> <profileId> [--text <t>]
cc topiccls start-job-v2 <id> | complete-job-v2 <id> | fail-job-v2 <id> [reason] | cancel-job-v2 <id> [reason]
cc topiccls get-job-v2 <id> | list-jobs-v2
cc topiccls auto-stale-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 BM25/TF-IDF 主题归类、模型推断、置信度评分。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchTopicClsProfileV2` + 2 批量 auto-flip、全枚举零初始化 stats（新顶级 `topiccls` 命名空间）。45 V2 tests。

## Phase Iter12-D — Iteration Budget V2 治理面（CLI v0.140.0）

新增 `cc itbudget` 顶级命令，治理 iteration budget profile + run lifecycle。终态 `exhausted` 在语义上区别于 `retired/archived/decommissioned`，标识预算耗尽。

### 设计要点
- 4 态 Iter Budget Profile 成熟度：`pending → active → paused → exhausted`（`exhausted` 终态；`paused → active` 恢复豁免 active 上限）
- 5 态 Iter Run 生命周期：`queued → running → {completed, failed, cancelled}`（3 终态）
- 上限：`maxActiveIterBudgetProfilesPerOwner=4`、`maxPendingIterRunsPerProfile=8`
- 阈值：`iterBudgetProfileIdleMs=24 小时`、`iterRunStuckMs=60 分钟`
- 自动翻转：`autoPauseIdleIterBudgetProfilesV2`、`autoFailStuckIterRunsV2`
- Stamp-once：`activatedAt`、`exhaustedAt`、`startedAt`、`settledAt`
- Profile 字段：`budget`（默认 `50`）、`owner` 必填
- Run 字段：`goal`、`profileId` 必填

### 命令
```
cc itbudget enums-v2 | gov-stats-v2 | config-v2
cc itbudget set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc itbudget register-profile-v2 <id> <owner> [--budget <n>]
cc itbudget activate-profile-v2 <id> | pause-profile-v2 <id> | exhaust-profile-v2 <id> | touch-profile-v2 <id>
cc itbudget get-profile-v2 <id> | list-profiles-v2
cc itbudget create-run-v2 <id> <profileId> [--goal <g>]
cc itbudget start-run-v2 <id> | complete-run-v2 <id> | fail-run-v2 <id> [reason] | cancel-run-v2 <id> [reason]
cc itbudget get-run-v2 <id> | list-runs-v2
cc itbudget auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 token 计费、预算扣减、agent loop budget enforcement。CLI V2 仅覆盖冻结枚举面、双状态机、双维度上限、throwing API、stamp-once、`touchIterBudgetProfileV2` + 2 批量 auto-flip、全枚举零初始化 stats（新顶级 `itbudget` 命名空间，`exhausted` 终态语义独特）。45 V2 tests。

## Phase Iter13-A — Plan Mode V2 治理覆盖层（CLI 0.141.0）

**已移植**：`cc planmode ...-v2` 独立顶级命令树，覆盖在 `lib/plan-mode.js` 之上。

- 4 态 profile maturity：pending / active / paused / archived（终态）。恢复路径：paused→active 豁免 active cap。
- 5 态 step 生命周期：queued / running / completed / failed / cancelled（3 终态）。
- 容量：`maxActivePlanProfilesPerOwner=6`、`maxPendingPlanStepsPerProfile=15`（统计 queued+running）。
- 阈值：`planProfileIdleMs=7d`、`planStepStuckMs=30min`。
- Profile 字段：`goal`（默认 ""）。Step 字段：`action`。
- Auto-flip：`auto-pause-idle-v2`（active idle→paused）、`auto-fail-stuck-v2`（running stuck→failed，reason `auto-fail-stuck`）。
- Stamp-once 时间戳：activatedAt / archivedAt / startedAt / settledAt 跨恢复保持。

```
cc planmode enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc planmode set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc planmode register-profile-v2 <id> <owner> [--goal <g>]
cc planmode activate-profile-v2 <id> | pause-profile-v2 <id> | archive-profile-v2 <id> | touch-profile-v2 <id>
cc planmode get-profile-v2 <id> | list-profiles-v2
cc planmode create-step-v2 <id> <profileId> [--action <a>]
cc planmode start-step-v2 <id> | complete-step-v2 <id> | fail-step-v2 <id> [reason] | cancel-step-v2 <id> [reason]
cc planmode get-step-v2 <id> | list-steps-v2
cc planmode auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 plan execution、step dependency DAG、interactive plan REPL。CLI V2 仅覆盖治理面（双状态机 + 双维度上限 + 自动流转）。新顶级 `planmode`（避免与任何 plan 调用流冲突）。39 V2 tests；遗留 `__tests__/unit/plan-mode.test.js`（71 tests）零改动。

## Phase Iter13-B — Permission Engine V2 治理覆盖层（CLI 0.141.0）

**已移植**：`cc perm ...-v2` 独立顶级命令树，覆盖在 `lib/permission-engine.js` 之上。

- 4 态 rule maturity：pending / active / disabled / retired（终态）。恢复路径：disabled→active 豁免 active cap。
- 5 态 check 生命周期：queued / evaluating / allowed / denied / cancelled（3 终态：allowed/denied/cancelled）。
- 容量：`maxActivePermRulesPerOwner=10`、`maxPendingPermChecksPerRule=30`（统计 queued+evaluating）。
- 阈值：`permRuleIdleMs=30d`、`permCheckStuckMs=60s`。
- Rule 字段：`scope`（默认 "*"）。Check 字段：`subject`。
- Auto-flip：`auto-disable-idle-v2`（active idle→disabled）、`auto-deny-stuck-v2`（evaluating stuck→denied，reason `auto-deny-stuck`，注意 deny 是终态语义）。
- Stamp-once 时间戳：activatedAt / retiredAt / startedAt / settledAt 跨恢复保持。

```
cc perm enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc perm set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc perm register-rule-v2 <id> <owner> [--scope <s>]
cc perm activate-rule-v2 <id> | disable-rule-v2 <id> | retire-rule-v2 <id> | touch-rule-v2 <id>
cc perm get-rule-v2 <id> | list-rules-v2
cc perm create-check-v2 <id> <ruleId> [--subject <s>]
cc perm evaluate-check-v2 <id> | allow-check-v2 <id> | deny-check-v2 <id> [reason] | cancel-check-v2 <id> [reason]
cc perm get-check-v2 <id> | list-checks-v2
cc perm auto-disable-idle-v2 | auto-deny-stuck-v2
```

> **未移植**：真实 ABAC/RBAC 评估、policy 编译、capability 推导。CLI V2 仅覆盖治理面（双状态机 + 双维度上限 + 自动流转）。新顶级 `perm`。38 V2 tests；遗留 `__tests__/unit/permission-engine.test.js`（36 tests）零改动。

## Phase Iter13-C — User Profile V2 治理覆盖层（CLI 0.141.0）

**已移植**：`cc uprof ...-v2` 独立顶级命令树，覆盖在 `lib/user-profile.js` 之上。

- 4 态 profile maturity：pending / active / dormant / archived（终态）。恢复路径：dormant→active 豁免 active cap。
- 5 态 pref 生命周期：proposed / applied / rejected / superseded / cancelled（3 终态：rejected/superseded/cancelled）。注意：APPLIED 非终态，可继续 → SUPERSEDED。
- 容量：`maxActiveUserProfilesPerOwner=5`、`maxPendingUserPrefsPerProfile=20`（仅统计 PROPOSED）。
- 阈值：`userProfileIdleMs=90d`、`userPrefStuckMs=7d`。
- Profile 字段：`handle`（默认 = id）。Pref 字段：`key`。
- Auto-flip：`auto-dormant-idle-v2`（active idle→dormant）、`auto-cancel-stale-v2`（proposed stuck→cancelled，reason `auto-cancel-stale`）。
- Stamp-once 时间戳：activatedAt / archivedAt / settledAt 跨恢复保持；createUserPrefV2 即时设置 startedAt。

```
cc uprof enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc uprof set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc uprof register-profile-v2 <id> <owner> [--handle <h>]
cc uprof activate-profile-v2 <id> | dormant-profile-v2 <id> | archive-profile-v2 <id> | touch-profile-v2 <id>
cc uprof get-profile-v2 <id> | list-profiles-v2
cc uprof create-pref-v2 <id> <profileId> [--key <k>]
cc uprof apply-pref-v2 <id> | reject-pref-v2 <id> [reason] | supersede-pref-v2 <id> | cancel-pref-v2 <id> [reason]
cc uprof get-pref-v2 <id> | list-prefs-v2
cc uprof auto-dormant-idle-v2 | auto-cancel-stale-v2
```

> **未移植**：真实 SQLite/file profile storage、preference resolution chain、cross-device sync。CLI V2 仅覆盖治理面（双状态机 + 双维度上限 + supersede 转移）。新顶级 `uprof`。37 V2 tests；遗留 `__tests__/unit/user-profile.test.js`（27 tests）零改动。

## Phase Iter13-D — Social Graph V2 治理覆盖层（CLI 0.141.0）

**已移植**：`cc social sg-...-v2` 子命令组，覆盖在 `lib/social-graph.js` 之上，注入到现有 `cc social`（Phase 84+ social-manager V2 零改动）。`sg-*` 前缀避免与 social-manager V2 冲突。

- 4 态 node maturity：pending / active / inactive / removed（终态）。恢复路径：inactive→active 豁免 active cap。
- 5 态 edge 生命周期：proposed / established / severed / expired / cancelled（3 终态：severed/expired/cancelled）。注意：ESTABLISHED 非终态，可继续 → SEVERED 或 EXPIRED。
- 容量：`maxActiveSgNodesPerOwner=50`、`maxPendingSgEdgesPerNode=100`（仅统计 PROPOSED）。
- 阈值：`sgNodeIdleMs=60d`、`sgEdgeStuckMs=14d`。
- Node 字段：`handle`（默认 = id）。Edge 字段：`targetId`。
- Auto-flip：`sg-auto-deactivate-idle-v2`（active idle→inactive）、`sg-auto-expire-stale-v2`（proposed stuck→cancelled，reason `auto-cancel-stale`）。
- Stamp-once 时间戳：activatedAt / removedAt / settledAt 跨恢复保持；createSgEdgeV2 即时设置 startedAt；established 设置 settledAt，severed/expired 不再覆盖。

```
cc social sg-enums-v2 | sg-config-v2 | sg-gov-stats-v2 | sg-reset-state-v2
cc social sg-set-max-active-v2 <n> | sg-set-max-pending-v2 <n> | sg-set-idle-ms-v2 <n> | sg-set-stuck-ms-v2 <n>
cc social sg-register-node-v2 <id> <owner> [--handle <h>]
cc social sg-activate-node-v2 <id> | sg-deactivate-node-v2 <id> | sg-remove-node-v2 <id> | sg-touch-node-v2 <id>
cc social sg-get-node-v2 <id> | sg-list-nodes-v2
cc social sg-create-edge-v2 <id> <nodeId> [--target <t>]
cc social sg-establish-edge-v2 <id> | sg-sever-edge-v2 <id> [reason] | sg-expire-edge-v2 <id> | sg-cancel-edge-v2 <id> [reason]
cc social sg-get-edge-v2 <id> | sg-list-edges-v2
cc social sg-auto-deactivate-idle-v2 | sg-auto-expire-stale-v2
```

> **未移植**：真实 SQLite social_graph_edges 表、邻居/中心性/最短路径/社区检测算法（lib/social-graph-analytics.js 零改动）。CLI V2 仅覆盖治理面（双状态机 + 双维度上限 + established 中间态分支）。`sg-*` 前缀注入 `cc social`，避免与 social-manager V2 冲突。37 V2 tests；遗留 `__tests__/unit/social-graph.test.js`（36 tests）零改动。

## Phase Iter13-E — Service Container V2 治理覆盖层（CLI 0.141.0）

**已移植**：`cc svccont ...-v2` 独立顶级命令树，覆盖在 `lib/service-container.js` 之上。

- 4 态 container maturity：pending / active / degraded / decommissioned（终态）。恢复路径：degraded→active 豁免 active cap。
- 5 态 resolution 生命周期：queued / resolving / resolved / failed / cancelled（3 终态）。
- 容量：`maxActiveSvcContainersPerOwner=8`、`maxPendingSvcResolutionsPerContainer=25`（统计 queued+resolving）。
- 阈值：`svcContainerIdleMs=60min`、`svcResolutionStuckMs=30s`。
- Container 字段：`scope`（默认 "default"）。Resolution 字段：`token`。
- Auto-flip：`auto-degrade-idle-v2`（active idle→degraded）、`auto-fail-stuck-v2`（resolving stuck→failed，reason `auto-fail-stuck`）。
- Stamp-once 时间戳：activatedAt / decommissionedAt / startedAt / settledAt 跨恢复保持。

```
cc svccont enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc svccont set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc svccont register-container-v2 <id> <owner> [--scope <s>]
cc svccont activate-container-v2 <id> | degrade-container-v2 <id> | decommission-container-v2 <id> | touch-container-v2 <id>
cc svccont get-container-v2 <id> | list-containers-v2
cc svccont create-resolution-v2 <id> <containerId> [--token <t>]
cc svccont resolving-resolution-v2 <id> | resolve-resolution-v2 <id> | fail-resolution-v2 <id> [reason] | cancel-resolution-v2 <id> [reason]
cc svccont get-resolution-v2 <id> | list-resolutions-v2
cc svccont auto-degrade-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 DI container 实例化、binding/scope chain、circular dependency detection。CLI V2 仅覆盖治理面（双状态机 + 双维度上限 + 自动流转）。新顶级 `svccont`。37 V2 tests；遗留 `__tests__/unit/service-container.test.js`（26 tests）零改动。

## Phase Iter13-F — Task Model Selector V2 治理覆盖层（CLI 0.141.0）

**已移植**：`cc tms ...-v2` 独立顶级命令树,覆盖在 `lib/task-model-selector.js` 之上。

- 4 态 profile maturity：pending / active / stale / decommissioned（终态）。恢复路径：stale→active 豁免 active cap。
- 5 态 selection 生命周期：queued / scoring / completed / failed / cancelled（3 终态）。
- 容量：`maxActiveTmsProfilesPerOwner=8`、`maxPendingTmsSelectionsPerProfile=16`（统计 queued+scoring）。
- 阈值：`tmsProfileIdleMs=14d`、`tmsSelectionStuckMs=2min`。
- Profile 字段：`strategy`（默认 "default"）。Selection 字段：`task`。
- Auto-flip：`auto-stale-idle-v2`（active idle→stale）、`auto-fail-stuck-v2`（scoring stuck→failed，reason `auto-fail-stuck`）。
- Stamp-once 时间戳：activatedAt / decommissionedAt / startedAt / settledAt 跨恢复保持。

```
cc tms enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc tms set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc tms register-profile-v2 <id> <owner> [--strategy <s>]
cc tms activate-profile-v2 <id> | stale-profile-v2 <id> | decommission-profile-v2 <id> | touch-profile-v2 <id>
cc tms get-profile-v2 <id> | list-profiles-v2
cc tms create-selection-v2 <id> <profileId> [--task <t>]
cc tms score-selection-v2 <id> | complete-selection-v2 <id> | fail-selection-v2 <id> [reason] | cancel-selection-v2 <id> [reason]
cc tms get-selection-v2 <id> | list-selections-v2
cc tms auto-stale-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 model scoring heuristic、capability matching、cost/latency budget。CLI V2 仅覆盖治理面（双状态机 + 双维度上限 + 自动流转）。新顶级 `tms`。37 V2 tests；遗留 `__tests__/unit/task-model-selector.test.js`（32 tests）零改动。

## Phase Iter14-A: Slot Filler V2 治理面 (`cc slotfill ...-v2`)

**目标**: 在 `lib/slot-filler.js` 之上叠加 in-memory 治理层，覆盖 slot 模板成熟度 + 填充作业生命周期，遗留 slot-filler 解析逻辑保持零改动。

**双状态机**:
- `SLOTF_PROFILE_MATURITY_V2` (4 态): pending → active ↔ stale → archived（终态）。stale → active 恢复豁免活跃上限。
- `SLOTF_FILL_LIFECYCLE_V2` (5 态): queued → filling → filled / failed / cancelled（3 终态）。

**双维度上限**: 每 owner 活跃模板上限 10；每模板挂起填充上限 20。

**自动流转**: `autoStaleIdleSlotfTemplatesV2`（默认 30 天）+ `autoFailStuckSlotfFillsV2`（默认 30 秒）。

**命令面**:
```bash
cc slotfill enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc slotfill set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc slotfill register-template-v2 <id> <owner> [--schema <s>]
cc slotfill activate-template-v2 <id> | stale-template-v2 <id> | archive-template-v2 <id> | touch-template-v2 <id>
cc slotfill get-template-v2 <id> | list-templates-v2
cc slotfill create-fill-v2 <id> <templateId> [--input <s>]
cc slotfill filling-fill-v2 <id> | fill-fill-v2 <id> | fail-fill-v2 <id> [reason] | cancel-fill-v2 <id> [reason]
cc slotfill get-fill-v2 <id> | list-fills-v2
cc slotfill auto-stale-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 schema 校验、token-level diff、grammar inference。CLI V2 仅覆盖治理面。新顶级 `slotfill`。37 V2 tests。

## Phase Iter14-B: Web Fetch V2 治理面 (`cc webfetch ...-v2`)

**目标**: 在 `lib/web-fetch.js` 之上叠加 in-memory 治理层，覆盖 fetch target 成熟度 + 作业生命周期，遗留 fetch helper 保持零改动。

**双状态机**:
- `WFET_TARGET_MATURITY_V2` (4 态): pending → active ↔ degraded → retired（终态）。degraded → active 恢复豁免活跃上限。
- `WFET_JOB_LIFECYCLE_V2` (5 态): queued → fetching → succeeded / failed / cancelled（3 终态）。

**双维度上限**: 每 owner 活跃 target 上限 12；每 target 挂起作业上限 30。

**自动流转**: `autoDegradeIdleWfetTargetsV2`（默认 7 天，比其他模块更短）+ `autoFailStuckWfetJobsV2`（默认 60 秒）。

**命令面**:
```bash
cc webfetch enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc webfetch set-max-active-v2 <n> | set-max-pending-v2 <n> | set-idle-ms-v2 <n> | set-stuck-ms-v2 <n>
cc webfetch register-target-v2 <id> <owner> [--baseUrl <u>]
cc webfetch activate-target-v2 <id> | degrade-target-v2 <id> | retire-target-v2 <id> | touch-target-v2 <id>
cc webfetch get-target-v2 <id> | list-targets-v2
cc webfetch create-job-v2 <id> <targetId> [--kind <k>]
cc webfetch fetching-job-v2 <id> | succeed-job-v2 <id> | fail-job-v2 <id> [reason] | cancel-job-v2 <id> [reason]
cc webfetch get-job-v2 <id> | list-jobs-v2
cc webfetch auto-degrade-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 HTTP 抓取、HTML→Markdown 转换、机器人识别。CLI V2 仅覆盖治理面。新顶级 `webfetch`。37 V2 tests。

## Phase Iter14-C: Memory Injection V2 治理面 (`cc meminj ...-v2`)

**目标**: 在 `lib/memory-injection.js` 之上叠加 in-memory 治理层，覆盖注入规则成熟度 + 注入作业生命周期。

**双状态机**:
- `MINJ_RULE_MATURITY_V2` (4 态): pending → active ↔ paused → archived（终态）。
- `MINJ_INJECTION_LIFECYCLE_V2` (5 态): queued → injecting → applied / failed / cancelled（3 终态）。

**双维度上限**: 每 owner 活跃规则上限 10；每规则挂起注入上限 25。

**自动流转**: `autoPauseIdleMinjRulesV2`（默认 30 天）+ `autoFailStuckMinjInjectionsV2`（默认 30 秒）。

**命令面**:
```bash
cc meminj enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc meminj register-rule-v2 <id> <owner> [--scope <s>]
cc meminj activate-rule-v2 <id> | pause-rule-v2 <id> | archive-rule-v2 <id> | touch-rule-v2 <id>
cc meminj create-injection-v2 <id> <ruleId> [--payload <p>]
cc meminj injecting-injection-v2 <id> | apply-injection-v2 <id> | fail-injection-v2 <id> [reason] | cancel-injection-v2 <id> [reason]
cc meminj auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 prompt template 渲染、scope matcher、context window budget。CLI V2 仅覆盖治理面。新顶级 `meminj`。37 V2 tests。

## Phase Iter14-D: Session Search V2 治理面 (`cc seshsearch ...-v2`)

**目标**: 在 `lib/session-search.js` 之上叠加 in-memory 治理层，覆盖搜索 profile 成熟度 + 查询作业生命周期。

**双状态机**:
- `SSCH_PROFILE_MATURITY_V2` (4 态): pending → active ↔ stale → archived（终态）。
- `SSCH_QUERY_LIFECYCLE_V2` (5 态): queued → searching → completed / failed / cancelled（3 终态）。

**双维度上限**: 每 owner 活跃 profile 上限 8；每 profile 挂起查询上限 20。

**自动流转**: `autoStaleIdleSschProfilesV2`（30 天）+ `autoFailStuckSschQueriesV2`（30 秒）。

**命令面**:
```bash
cc seshsearch enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc seshsearch register-profile-v2 <id> <owner> [--scope <s>]
cc seshsearch activate-profile-v2 <id> | stale-profile-v2 <id> | archive-profile-v2 <id> | touch-profile-v2 <id>
cc seshsearch create-query-v2 <id> <profileId> [--q <q>]
cc seshsearch searching-query-v2 <id> | complete-query-v2 <id> | fail-query-v2 <id> [reason] | cancel-query-v2 <id> [reason]
cc seshsearch auto-stale-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 BM25/向量混合搜索、faceted filter、relevance ranker。CLI V2 仅覆盖治理面。新顶级 `seshsearch`。37 V2 tests。

## Phase Iter14-E: Session Tail V2 治理面 (`cc seshtail ...-v2`)

**目标**: 在 `lib/session-tail.js` 之上叠加 in-memory 治理层，覆盖 tail 订阅成熟度 + 事件生命周期。

**双状态机**:
- `STAIL_SUB_MATURITY_V2` (4 态): pending → active ↔ paused → closed（终态）。
- `STAIL_EVENT_LIFECYCLE_V2` (5 态): queued → tailing → completed / failed / cancelled（3 终态）。

**双维度上限**: 每 owner 活跃订阅上限 10；每订阅挂起事件上限 30。

**自动流转**: `autoPauseIdleStailSubsV2`（默认 24 小时，比其他模块更短，因 tail 是交互场景）+ `autoFailStuckStailEventsV2`（60 秒）。

**命令面**:
```bash
cc seshtail enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc seshtail register-sub-v2 <id> <owner> [--sessionId <s>]
cc seshtail activate-sub-v2 <id> | pause-sub-v2 <id> | close-sub-v2 <id> | touch-sub-v2 <id>
cc seshtail create-event-v2 <id> <subId> [--cursor <c>]
cc seshtail tailing-event-v2 <id> | complete-event-v2 <id> | fail-event-v2 <id> [reason] | cancel-event-v2 <id> [reason]
cc seshtail auto-pause-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 SSE/WebSocket 推送、cursor 持久化、back-pressure。CLI V2 仅覆盖治理面。新顶级 `seshtail`。37 V2 tests。

## Phase Iter14-F: Session Usage V2 治理面 (`cc seshu ...-v2`)

**目标**: 在 `lib/session-usage.js` 之上叠加 in-memory 治理层，覆盖 usage budget 成熟度 + 用量记录生命周期。

**双状态机**:
- `SUSE_BUDGET_MATURITY_V2` (4 态): pending → active ↔ exhausted → archived（终态）。
- `SUSE_RECORD_LIFECYCLE_V2` (5 态): queued → recording → recorded / rejected / cancelled（3 终态）。

**双维度上限**: 每 owner 活跃 budget 上限 5；每 budget 挂起记录上限 50。

**自动流转**: `autoExhaustIdleSuseBudgetsV2`（30 天）+ `autoRejectStuckSuseRecordsV2`（30 秒，写入 `rejectReason="auto-reject-stuck"`）。

**命令面**:
```bash
cc seshu enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc seshu register-budget-v2 <id> <owner> [--limit <n>]
cc seshu activate-budget-v2 <id> | exhaust-budget-v2 <id> | archive-budget-v2 <id> | touch-budget-v2 <id>
cc seshu create-record-v2 <id> <budgetId> [--amount <n>]
cc seshu recording-record-v2 <id> | record-record-v2 <id> | reject-record-v2 <id> [reason] | cancel-record-v2 <id> [reason]
cc seshu auto-exhaust-idle-v2 | auto-reject-stuck-v2
```

> **未移植**：真实 token 计量、模型计价、quota 联动。CLI V2 仅覆盖治理面。注意 stuck record 走 reject（非 fail），与计费语义对齐。新顶级 `seshu`。37 V2 tests。

## Phase Iter14-G: Session Hooks V2 治理面 (`cc seshhook ...-v2`)

**目标**: 在 `lib/session-hooks.js` 之上叠加 in-memory 治理层，覆盖 hook profile 成熟度 + 调用生命周期，与 SQLite 后端的 `cc hook` 注册表互不影响。

**双状态机**:
- `SHOK_PROFILE_MATURITY_V2` (4 态): pending → active ↔ disabled → retired（终态）。
- `SHOK_INVOCATION_LIFECYCLE_V2` (5 态): queued → running → completed / failed / cancelled（3 终态）。

**双维度上限**: 每 owner 活跃 profile 上限 12；每 profile 挂起调用上限 25。

**自动流转**: `autoDisableIdleShokProfilesV2`（30 天）+ `autoFailStuckShokInvocationsV2`（30 秒）。

**命令面**:
```bash
cc seshhook enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc seshhook register-profile-v2 <id> <owner> [--event <e>]
cc seshhook activate-profile-v2 <id> | disable-profile-v2 <id> | retire-profile-v2 <id> | touch-profile-v2 <id>
cc seshhook create-invocation-v2 <id> <profileId> [--payload <p>]
cc seshhook running-invocation-v2 <id> | complete-invocation-v2 <id> | fail-invocation-v2 <id> [reason] | cancel-invocation-v2 <id> [reason]
cc seshhook auto-disable-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 hook handler 执行、event matcher、shell-out 隔离。CLI V2 仅覆盖治理面。新顶级 `seshhook`，避免与 SQLite-backed `cc hook` 命名冲突。37 V2 tests。

## Phase Iter14-H: MCP Scaffold V2 治理面 (`cc mcpscaf ...-v2`)

**目标**: 在 `lib/mcp-scaffold.js` 之上叠加 in-memory 治理层，覆盖 scaffold profile 成熟度 + 生成作业生命周期，与 `cc mcp` MCP 注册表互不影响。

**双状态机**:
- `MSCAF_PROFILE_MATURITY_V2` (4 态): pending → active ↔ stale → archived（终态）。
- `MSCAF_GENERATION_LIFECYCLE_V2` (5 态): queued → generating → generated / failed / cancelled（3 终态）。注意 failed 仅可由 generating 进入，不能直接由 queued 进入。

**双维度上限**: 每 owner 活跃 profile 上限 6；每 profile 挂起生成上限 15。

**自动流转**: `autoStaleIdleMscafProfilesV2`（30 天）+ `autoFailStuckMscafGenerationsV2`（60 秒）。

**命令面**:
```bash
cc mcpscaf enums-v2 | config-v2 | gov-stats-v2 | reset-state-v2
cc mcpscaf register-profile-v2 <id> <owner> [--transport <t>]
cc mcpscaf activate-profile-v2 <id> | stale-profile-v2 <id> | archive-profile-v2 <id> | touch-profile-v2 <id>
cc mcpscaf create-generation-v2 <id> <profileId> [--target <t>]
cc mcpscaf generating-generation-v2 <id> | generate-generation-v2 <id> | fail-generation-v2 <id> [reason] | cancel-generation-v2 <id> [reason]
cc mcpscaf auto-stale-idle-v2 | auto-fail-stuck-v2
```

> **未移植**：真实 MCP server 模板渲染、transport bootstrap、tool schema introspection。CLI V2 仅覆盖治理面。新顶级 `mcpscaf`，避免与 `cc mcp` 命名冲突。37 V2 tests。


### Phase Iter15-A: Feature Flags V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/feature-flags.js`
**命令**: `cc fflag ...-v2`

新顶层命名空间，附加在 `feature-flags.js` 之上的内存治理覆盖层（独立于任何已有的 flag 切换辅助函数）。

- **Profile 4 态**：`pending → active → paused → archived`（`archived` 为终态；`paused → active` 为恢复路径）
- **Eval 5 态**：`queued → evaluating → evaluated | failed | cancelled`（3 个终态；`evaluated` 仅可由 `evaluating` 进入）
- **容量上限**：每个 owner 最多 15 个 active profile；每个 profile 最多 30 个 pending eval（queued + evaluating）
- **自动翻转**：`auto-pause-idle`（30 天空闲）；`auto-fail-stuck`（30 秒卡顿）
- **profile 字段**：`scope`（默认 `"*"`）；**eval 字段**：`key`
- **聚合函数**：`getFeatureFlagsGovStatsV2()` → `cc fflag gov-stats-v2`
- **测试**：38 个 V2 测试

### Phase Iter15-B: Prompt Compressor V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/prompt-compressor.js`
**命令**: `cc promcomp ...-v2`

新顶层命令（避免与内部 `pcomp` 短令牌冲突）。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Run 5 态**：`queued → compressing → compressed | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`variant`（默认 `"default"`）；**run 字段**：`input`
- **聚合**：`getPromptCompressorGovStatsV2()` → `cc promcomp gov-stats-v2`
- **测试**：38 个 V2 测试

### Phase Iter15-C: Cowork Cron V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/cowork-cron.js`
**命令**: `cc ccron ...-v2`

- **Profile 4 态**：`pending → active → paused → archived`（`paused → active` 恢复）
- **Tick 5 态**：`queued → running → completed | failed | cancelled`
- **容量**：6 active / 15 pending；`auto-pause-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`expr`（默认 `"0 0 * * *"`）；**tick 字段**：`tickAt`
- **聚合**：`getCoworkCronGovStatsV2()` → `cc ccron gov-stats-v2`
- **测试**：38 个 V2 测试

### Phase Iter15-D: Version Checker V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/version-checker.js`
**命令**: `cc vcheck ...-v2`

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Check 5 态**：`queued → checking → completed | failed | cancelled`
- **容量**：5 active / 10 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(30s)
- **profile 字段**：`channel`（默认 `"stable"`）；**check 字段**：`currentVersion`
- **聚合**：`getVersionCheckerGovStatsV2()` → `cc vcheck gov-stats-v2`
- **测试**：38 个 V2 测试

### Phase Iter15-E: PDF Parser V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/pdf-parser.js`
**命令**: `cc pdfp ...-v2`

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Parse 5 态**：`queued → parsing → parsed | failed | cancelled`
- **容量**：6 active / 12 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`encoding`（默认 `"utf-8"`）；**parse 字段**：`path`
- **聚合**：`getPdfParserGovStatsV2()` → `cc pdfp gov-stats-v2`
- **测试**：38 个 V2 测试

### Phase Iter15-F: BM25 Search V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/bm25-search.js`
**命令**: `cc bm25 ...-v2`

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Query 5 态**：`queued → searching → completed | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(30s)
- **profile 字段**：`field`（默认 `"content"`）；**query 字段**：`q`
- **聚合**：`getBm25SearchGovStatsV2()` → `cc bm25 gov-stats-v2`
- **测试**：38 个 V2 测试

### Phase Iter15-G: Compression Telemetry V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/compression-telemetry.js`
**命令**: `cc compt ...-v2`

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Sample 5 态**：`queued → recording → recorded | failed | cancelled`
- **容量**：10 active / 30 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(30s)
- **profile 字段**：`kind`（默认 `"default"`）；**sample 字段**：`metric`
- **聚合**：`getCompressionTelemetryGovStatsV2()` → `cc compt gov-stats-v2`
- **测试**：38 个 V2 测试

### Phase Iter15-H: Social Graph Analytics V2 (CLI v0.143.0)

**模块**: `packages/cli/src/lib/social-graph-analytics.js`
**命令**: `cc sganal ...-v2`

新顶层命名空间，避免与已有的 `cc social sg-...-v2`（社交图谱命令）冲突。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Run 5 态**：`queued → running → completed | failed | cancelled`
- **容量**：6 active / 12 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`algorithm`（默认 `"centrality"`）；**run 字段**：`snapshotId`
- **聚合**：`getSocialGraphAnalyticsGovStatsV2()` → `cc sganal gov-stats-v2`
- **测试**：38 个 V2 测试


### Phase Iter16-A: Audit Logger V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/audit-logger.js`
**命令**: `cc audit aud-gov-...-v2`

附加在 `audit-logger.js` 之上的内存治理覆盖层（独立于已有 LOG_STATUS_V2 等审计枚举）。

- **Profile 4 态**：`pending → active → suspended → archived`（`suspended → active` 恢复）
- **Write 5 态**：`queued → writing → written | failed | cancelled`
- **容量**：8 active / 30 pending；`auto-suspend-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`level`（默认 `"info"`）；**write 字段**：`key`
- **聚合**：`getAuditLoggerGovStatsV2()` → `cc audit aud-gov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter16-B: Knowledge Graph V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/knowledge-graph.js`
**命令**: `cc kg kgov-...-v2`

新前缀 `kgov-` 以避免与已有的 ENTITY_STATUS_V2 / RELATION_STATUS_V2 冲突。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Import 5 态**：`queued → importing → imported | failed | cancelled`
- **容量**：6 active / 20 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`namespace`（默认 `"default"`）；**import 字段**：`source`
- **聚合**：`getKnowledgeGraphGovStatsV2()` → `cc kg kgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter16-C: Sandbox Governance V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/sandbox-v2.js`
**命令**: `cc sandbox sbox-gov-...-v2`

新前缀 `sbox-gov-` 与 Phase 87 的 `pauseSandboxV2` 等实例操作并存（两套独立）。

- **Profile 4 态**：`pending → active → paused → archived`（`paused → active` 恢复）
- **Exec 5 态**：`queued → running → completed | failed | cancelled`
- **容量**：6 active / 12 pending；`auto-pause-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`template`（默认 `"default"`）；**exec 字段**：`command`
- **聚合**：`getSandboxGovStatsV2()` → `cc sandbox sbox-gov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter16-D: SLA Manager V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/sla-manager.js`
**命令**: `cc sla slagov-...-v2`

- **Profile 4 态**：`pending → active → breached → archived`（`breached → active` 恢复）
- **Measurement 5 态**：`queued → measuring → measured | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-breach-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`tier`（默认 `"standard"`）；**measurement 字段**：`metric`
- **聚合**：`getSlaManagerGovStatsV2()` → `cc sla slagov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter16-E: Stress Tester V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/stress-tester.js`
**命令**: `cc stress strgov-...-v2`

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Run 5 态**：`queued → running → completed | failed | cancelled`
- **容量**：5 active / 10 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`scenario`（默认 `"ramp"`）；**run 字段**：`profileRef`
- **聚合**：`getStressTesterGovStatsV2()` → `cc stress strgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter16-F: Terraform Manager V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/terraform-manager.js`
**命令**: `cc terraform tfgov-...-v2`

- **Profile 4 态**：`pending → active → drifted → archived`（`drifted → active` 恢复）
- **Apply 5 态**：`queued → applying → applied | failed | cancelled`
- **容量**：6 active / 12 pending；`auto-drift-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`provider`（默认 `"aws"`）；**apply 字段**：`resource`
- **聚合**：`getTerraformManagerGovStatsV2()` → `cc terraform tfgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter16-G: Reputation Optimizer V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/reputation-optimizer.js`
**命令**: `cc reputation repgov-...-v2`

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Cycle 5 态**：`queued → running → completed | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`objective`（默认 `"quality"`）；**cycle 字段**：`subject`
- **聚合**：`getReputationOptimizerGovStatsV2()` → `cc reputation repgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter16-H: Skill Marketplace V2 (CLI v0.144.0)

**模块**: `packages/cli/src/lib/skill-marketplace.js`
**命令**: `cc marketplace mktgov-...-v2`

新前缀 `mktgov-` 以避免与 Phase 65 的 SERVICE_STATUS_V2 等市场枚举冲突。

- **Profile 4 态**：`pending → active → suspended → archived`（`suspended → active` 恢复）
- **Order 5 态**：`queued → processing → processed | failed | cancelled`
- **容量**：10 active / 25 pending；`auto-suspend-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`category`（默认 `"general"`）；**order 字段**：`listingId`
- **聚合**：`getSkillMarketplaceGovStatsV2()` → `cc marketplace mktgov-gov-stats-v2`
- **测试**：44 个 V2 测试


### Phase Iter17-A: Chat Core V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/chat-core.js`
**命令**: `cc chat chatgov-...-v2`

附加在 `chat-core.js` 之上的内存治理覆盖层。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Message 5 态**：`queued → sending → sent | failed | cancelled`
- **容量**：8 active / 30 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`mode`（默认 `"interactive"`）；**message 字段**：`role`
- **聚合**：`getChatCoreGovStatsV2()` → `cc chat chatgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter17-B: Claude Code Bridge V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/claude-code-bridge.js`
**命令**: `cc orchestrate ccbgov-...-v2`

附加在 `claude-code-bridge.js` 之上，挂载到 `cc orchestrate`（与现有 router/v2 并存）。

- **Profile 4 态**：`pending → active → degraded → archived`（`degraded → active` 恢复）
- **Invocation 5 态**：`queued → running → completed | failed | cancelled`
- **容量**：6 active / 15 pending；`auto-degrade-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`channel`（默认 `"stdio"`）；**invocation 字段**：`command`
- **聚合**：`getClaudeCodeBridgeGovStatsV2()` → `cc orchestrate ccbgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter17-C: Compliance Manager V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/compliance-manager.js`
**命令**: `cc compliance cmgr-...-v2`

新前缀 `cmgr-` 以避免与已有的 `cc compliance fwrep-...-v2`（framework reporter V2）冲突。

- **Profile 4 态**：`pending → active → deprecated → archived`（`deprecated → active` 恢复）
- **Audit 5 态**：`queued → auditing → audited | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-deprecate-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`framework`（默认 `"soc2"`）；**audit 字段**：`control`
- **聚合**：`getComplianceManagerGovStatsV2()` → `cc compliance cmgr-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter17-D: Cowork Learning V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/cowork-learning.js`
**命令**: `cc cowork learn-...-v2`

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Sample 5 态**：`queued → training → trained | failed | cancelled`
- **容量**：6 active / 20 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`topic`（默认 `"general"`）；**sample 字段**：`signal`
- **聚合**：`getCoworkLearningGovStatsV2()` → `cc cowork learn-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter17-E: Cowork Workflow V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/cowork-workflow.js`
**命令**: `cc cowork cwwf-...-v2`

- **Profile 4 态**：`pending → active → paused → archived`（`paused → active` 恢复）
- **Step 5 态**：`queued → running → completed | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-pause-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`mode`（默认 `"sequential"`）；**step 字段**：`task`
- **聚合**：`getCoworkWorkflowGovStatsV2()` → `cc cowork cwwf-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter17-F: Privacy Computing V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/privacy-computing.js`
**命令**: `cc privacy pcgov-...-v2`

- **Profile 4 态**：`pending → active → suspended → archived`（`suspended → active` 恢复）
- **Job 5 态**：`queued → computing → computed | failed | cancelled`
- **容量**：6 active / 15 pending；`auto-suspend-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`technique`（默认 `"mpc"`）；**job 字段**：`dataset`
- **聚合**：`getPrivacyComputingGovStatsV2()` → `cc privacy pcgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter17-G: Token Incentive V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/token-incentive.js`
**命令**: `cc incentive incgov-...-v2`

- **Profile 4 态**：`pending → active → paused → archived`（`paused → active` 恢复）
- **Payout 5 态**：`queued → processing → paid | failed | cancelled`
- **容量**：10 active / 30 pending；`auto-pause-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`token`（默认 `"CLC"`）；**payout 字段**：`recipient`
- **聚合**：`getTokenIncentiveGovStatsV2()` → `cc incentive incgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter17-H: Hardening Manager V2 (CLI v0.145.0)

**模块**: `packages/cli/src/lib/hardening-manager.js`
**命令**: `cc hardening hardgov-...-v2`

- **Profile 4 态**：`pending → active → disabled → archived`（`disabled → active` 恢复）
- **Scan 5 态**：`queued → scanning → scanned | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-disable-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`category`（默认 `"system"`）；**scan 字段**：`target`
- **聚合**：`getHardeningManagerGovStatsV2()` → `cc hardening hardgov-gov-stats-v2`
- **测试**：44 个 V2 测试


### Phase Iter18-A: AIOps V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/aiops.js`
**命令**: `cc ops aiopsgov-...-v2`

附加在 `aiops.js` 之上的内存治理覆盖层，与 Phase Playbook/Remediation V2 并存。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Incident 5 态**：`queued → triaging → triaged | failed | cancelled`
- **容量**：6 active / 15 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`mode`（默认 `"monitor"`）；**incident 字段**：`summary`
- **聚合**：`getAiopsGovStatsV2()` → `cc ops aiopsgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter18-B: Multimodal V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/multimodal.js`
**命令**: `cc multimodal mmgov-...-v2`

附加在 `multimodal.js` 之上，与 Session/Artifact V2 并存。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Job 5 态**：`queued → processing → processed | failed | cancelled`
- **容量**：6 active / 15 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`kind`（默认 `"text"`）；**job 字段**：`input`
- **聚合**：`getMultimodalGovStatsV2()` → `cc multimodal mmgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter18-C: Instinct Manager V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/instinct-manager.js`
**命令**: `cc instinct instgov-...-v2`

附加在 `instinct-manager.js` 之上，与 Profile/Observation V2 并存。

- **Profile 4 态**：`pending → active → dormant → archived`（`dormant → active` 恢复）
- **Trigger 5 态**：`queued → firing → fired | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-dormant-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`priority`（默认 `"normal"`）；**trigger 字段**：`pattern`
- **聚合**：`getInstinctManagerGovStatsV2()` → `cc instinct instgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter18-D: Tenant SaaS V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/tenant-saas.js`
**命令**: `cc tenant tnsgov-...-v2`

附加在 `tenant-saas.js` 之上，与 Tenant/Subscription V2 并存（allocation 子模型避免与 Subscription 冲突）。

- **Profile 4 态**：`pending → active → suspended → archived`（`suspended → active` 恢复）
- **Allocation 5 态**：`queued → provisioning → provisioned | failed | cancelled`
- **容量**：10 active / 25 pending；`auto-suspend-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`plan`（默认 `"free"`）；**allocation 字段**：`resource`
- **聚合**：`getTenantSaasGovStatsV2()` → `cc tenant tnsgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter18-E: Quantization V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/quantization.js`
**命令**: `cc quantize qntgov-...-v2`

附加在 `quantization.js` 之上，与 Phase 20 Model V2 并存。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Job 5 态**：`queued → quantizing → quantized | failed | cancelled`
- **容量**：6 active / 12 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`precision`（默认 `"int8"`）；**job 字段**：`model`
- **聚合**：`getQuantizationGovStatsV2()` → `cc quantize qntgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter18-F: Trust Security V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/trust-security.js`
**命令**: `cc trust trustgov-...-v2`

附加在 `trust-security.js` 之上，与 Device V2 并存。

- **Profile 4 态**：`pending → active → suspended → archived`（`suspended → active` 恢复）
- **Check 5 态**：`queued → verifying → verified | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-suspend-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`level`（默认 `"medium"`）；**check 字段**：`subject`
- **聚合**：`getTrustSecurityGovStatsV2()` → `cc trust trustgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter18-G: NL Programming V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/nl-programming.js`
**命令**: `cc nlprog nlpgov-...-v2`

附加在 `nl-programming.js` 之上，与 Spec/Turn V2 并存。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Translation 5 态**：`queued → translating → translated | failed | cancelled`
- **容量**：8 active / 20 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`style`（默认 `"natural"`）；**translation 字段**：`intent`
- **聚合**：`getNlProgrammingGovStatsV2()` → `cc nlprog nlpgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter18-H: Perception V2 (CLI v0.146.0)

**模块**: `packages/cli/src/lib/perception.js`
**命令**: `cc perception percgov-...-v2`

附加在 `perception.js` 之上，与 Sensor/Capture V2 并存。

- **Profile 4 态**：`pending → active → stale → archived`（`stale → active` 恢复）
- **Signal 5 态**：`queued → analyzing → analyzed | failed | cancelled`
- **容量**：6 active / 12 pending；`auto-stale-idle`(30d) + `auto-fail-stuck`(60s)
- **profile 字段**：`modality`（默认 `"vision"`）；**signal 字段**：`source`
- **聚合**：`getPerceptionGovStatsV2()` → `cc perception percgov-gov-stats-v2`
- **测试**：44 个 V2 测试

### Phase Iter19-A: Code Agent Governance V2（cdagov-*-v2 / `cc codegen`）

在 `cc codegen` 下追加 V2 治理覆盖层，复用 `code-agent.js` 内存状态。

- 4 态档案：pending / active / stale / archived（archived 终结，stale → active 恢复）
- 5 态编辑生命周期：queued / editing / edited / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`language` = "javascript"，生命周期字段 `target`
- 聚合器：`cdagov-gov-stats-v2`
- 测试：44 V2

### Phase Iter19-B: Collaboration Governance V2（cogov-*-v2 / `cc collab`）

在 `cc collab` 下追加 V2 治理覆盖层，复用 `collaboration-governance.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态决议生命周期：queued / deliberating / decided / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`scope` = "team"，生命周期字段 `topic`
- 聚合器：`cogov-gov-stats-v2`
- 测试：44 V2

### Phase Iter19-C: Community Governance V2（commgov-*-v2 / `cc governance`）

在 `cc governance` 下追加 V2 治理覆盖层，复用 `community-governance.js` 内存状态。

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态议案生命周期：queued / voting / voted / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 25 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`chamber` = "general"，生命周期字段 `subject`
- 聚合器：`commgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter19-D: DID Manager Governance V2（didgov-*-v2 / `cc did`）

在 `cc did` 下追加 V2 治理覆盖层，复用 `did-manager.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态解析生命周期：queued / resolving / resolved / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 25 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`method` = "key"，生命周期字段 `identifier`
- 聚合器：`didgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter19-E: SSO Manager Governance V2（ssogov-*-v2 / `cc sso`）

在 `cc sso` 下追加 V2 治理覆盖层，复用 `sso-manager.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态登录生命周期：queued / authenticating / authenticated / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 30 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`protocol` = "oidc"，生命周期字段 `subject`
- 聚合器：`ssogov-gov-stats-v2`
- 测试：44 V2

### Phase Iter19-F: Org Manager Governance V2（orggov-*-v2 / `cc org`）

在 `cc org` 下追加 V2 治理覆盖层，复用 `org-manager.js` 内存状态。

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态邀请生命周期：queued / inviting / invited / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 30 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`tier` = "standard"，生命周期字段 `email`
- 聚合器：`orggov-gov-stats-v2`
- 测试：44 V2

### Phase Iter19-G: SCIM Manager Governance V2（scimgov-*-v2 / `cc scim`）

在 `cc scim` 下追加 V2 治理覆盖层，复用 `scim-manager.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态同步生命周期：queued / syncing / synced / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`resource` = "users"，生命周期字段 `endpoint`
- 聚合器：`scimgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter19-H: Sync Manager Governance V2（syncgov-*-v2 / `cc sync`）

在 `cc sync` 下追加 V2 治理覆盖层，复用 `sync-manager.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态批次生命周期：queued / replicating / replicated / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`target` = "primary"，生命周期字段 `scope`
- 聚合器：`syncgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-A: Agent Network Governance V2（anetgov-*-v2 / `cc agent-network`）

在 `cc agent-network` 下追加 V2 治理覆盖层，复用 `agent-network.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态调度生命周期：queued / dispatching / dispatched / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 25 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`role` = "worker"，生命周期字段 `target`
- 聚合器：`anetgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-B: Browser Automation Governance V2（bagov-*-v2 / `cc browse`）

在 `cc browse` 下追加 V2 治理覆盖层，复用 `browser-automation.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态导航生命周期：queued / navigating / navigated / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`engine` = "chromium"，生命周期字段 `url`
- 聚合器：`bagov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-C: DLP Engine Governance V2（dlpgov-*-v2 / `cc dlp`）

在 `cc dlp` 下追加 V2 治理覆盖层，复用 `dlp-engine.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态扫描生命周期：queued / scanning / scanned / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`classification` = "internal"，生命周期字段 `resource`
- 聚合器：`dlpgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-D: Evomap Governance V2（evgov-*-v2 / `cc evomap`）

在 `cc evomap` 下追加 V2 治理覆盖层，复用 `evomap-governance.js` 内存状态。

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态议案生命周期：queued / reviewing / reviewed / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`lane` = "core"，生命周期字段 `topic`
- 聚合器：`evgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-E: Federation Hardening Governance V2（fedgov-*-v2 / `cc federation`）

在 `cc federation` 下追加 V2 治理覆盖层，复用 `federation-hardening.js` 内存状态。

- 4 态档案：pending / active / degraded / archived（degraded → active 恢复）
- 5 态探针生命周期：queued / probing / probed / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-degrade-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`region` = "default"，生命周期字段 `endpoint`
- 聚合器：`fedgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-F: IPFS Storage Governance V2（ipfsgov-*-v2 / `cc ipfs`）

在 `cc ipfs` 下追加 V2 治理覆盖层，复用 `ipfs-storage.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态固定生命周期：queued / pinning / pinned / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`mode` = "local"，生命周期字段 `cid`
- 聚合器：`ipfsgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-G: P2P Manager Governance V2（p2pgov-*-v2 / `cc p2p`）

在 `cc p2p` 下追加 V2 治理覆盖层，复用 `p2p-manager.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态广播生命周期：queued / broadcasting / broadcast / failed / cancelled（3 终结）
- 容量：每 owner 12 active / 每档案 30 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`transport` = "tcp"，生命周期字段 `topic`
- 聚合器：`p2pgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter20-H: Wallet Manager Governance V2（walgov-*-v2 / `cc wallet`）

在 `cc wallet` 下追加 V2 治理覆盖层，复用 `wallet-manager.js` 内存状态。

- 4 态档案：pending / active / frozen / archived（frozen → active 恢复）
- 5 态转账生命周期：queued / signing / signed / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-freeze-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`chain` = "mainnet"，生命周期字段 `to`
- 聚合器：`walgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-A: ActivityPub Bridge Governance V2（apgov-*-v2 / `cc activitypub`）

在 `cc activitypub` 下追加 V2 治理覆盖层，复用 `activitypub-bridge.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态投递生命周期：queued / delivering / delivered / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 25 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`actor` = "person"，生命周期字段 `inbox`
- 聚合器：`apgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-B: Matrix Bridge Governance V2（matgov-*-v2 / `cc matrix`）

在 `cc matrix` 下追加 V2 治理覆盖层，复用 `matrix-bridge.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态发送生命周期：queued / sending / sent / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 20 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`homeserver` = "matrix.org"，生命周期字段 `room`
- 聚合器：`matgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-C: Nostr Bridge Governance V2（nosgov-*-v2 / `cc nostr`）

在 `cc nostr` 下追加 V2 治理覆盖层，复用 `nostr-bridge.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态发布生命周期：queued / publishing / published / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 25 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`relay` = "wss://relay.local"，生命周期字段 `kind`
- 聚合器：`nosgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-D: BI Engine Governance V2（bigov-*-v2 / `cc bi`）

在 `cc bi` 下追加 V2 治理覆盖层，复用 `bi-engine.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态查询生命周期：queued / querying / queried / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`dataset` = "default"，生命周期字段 `kpi`
- 聚合器：`bigov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-E: Memory Manager Governance V2（memgov-*-v2 / `cc memory`）

在 `cc memory` 下追加 V2 治理覆盖层，复用 `memory-manager.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态召回生命周期：queued / recalling / recalled / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 30 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`scope` = "user"，生命周期字段 `key`
- 聚合器：`memgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-F: Session Manager Governance V2（sesgov-*-v2 / `cc session`）

在 `cc session` 下追加 V2 治理覆盖层,复用 `session-manager.js` 内存状态。

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态轮次生命周期：queued / advancing / advanced / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`channel` = "default"，生命周期字段 `topic`
- 聚合器：`sesgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-G: Hook Manager Governance V2（hookgov-*-v2 / `cc hook`）

在 `cc hook` 下追加 V2 治理覆盖层，复用 `hook-manager.js` 内存状态。

- 4 态档案：pending / active / disabled / archived（disabled → active 恢复）
- 5 态触发生命周期：queued / firing / fired / failed / cancelled（3 终结）
- 容量：每 owner 12 active / 每档案 25 pending
- 自动翻转：auto-disable-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`event` = "preTurn"，生命周期字段 `payload`
- 聚合器：`hookgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter21-H: Workflow Engine Governance V2（wfgov-*-v2 / `cc workflow`）

在 `cc workflow` 下追加 V2 治理覆盖层，复用 `workflow-engine.js` 内存状态。

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态步骤生命周期：queued / executing / executed / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`kind` = "sequential"，生命周期字段 `stepName`
- 聚合器：`wfgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-A: Automation Engine Governance V2（augov-*-v2 / `cc automation`）

在 `cc automation` 下追加 V2 治理覆盖层，复用 `automation-engine.js` 内存状态。

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态流生命周期：queued / running / completed / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 25 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`connector` = "webhook"，生命周期字段 `trigger`
- 聚合器：`augov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-B: Cowork Share Governance V2（shgov-*-v2 / `cc cowork`）

在 `cc cowork` 下追加 V2 治理覆盖层，复用 `cowork-share.js` 内存状态。

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态共享生命周期：queued / sharing / shared / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`visibility` = "private"，生命周期字段 `target`
- 聚合器：`shgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-C: DID V2 Manager Governance V2（dv2gov-*-v2 / `cc did-v2`）

在 `cc did-v2` 下追加 V2 治理覆盖层，复用 `did-v2-manager.js` 内存状态。

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态凭证生命周期：queued / issuing / issued / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`method` = "web"，生命周期字段 `subject`
- 聚合器：`dv2gov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-D: Knowledge Exporter Governance V2（kexpgov-*-v2 / `cc export`）

在 `cc export` 下追加 V2 治理覆盖层，复用 `knowledge-exporter.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态导出生命周期：queued / exporting / exported / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`format` = "json"，生命周期字段 `destination`
- 聚合器：`kexpgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-E: Knowledge Importer Governance V2（kimpgov-*-v2 / `cc import`）

在 `cc import` 下追加 V2 治理覆盖层，复用 `knowledge-importer.js` 内存状态。

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态导入生命周期：queued / importing / imported / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`format` = "json"，生命周期字段 `source`
- 聚合器：`kimpgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-F: LLM Providers Governance V2（llmgov-*-v2 / `cc llm`）

在 `cc llm` 下追加 V2 治理覆盖层，复用 `llm-providers.js` 内存状态。

- 4 态档案：pending / active / degraded / archived（degraded → active 恢复）
- 5 态补全生命周期：queued / inferring / inferred / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 25 pending
- 自动翻转：auto-degrade-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`provider` = "ollama"，生命周期字段 `model`
- 聚合器：`llmgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-G: PQC Manager Governance V2（pqcgov-*-v2 / `cc pqc`）

在 `cc pqc` 下追加 V2 治理覆盖层，复用 `pqc-manager.js` 内存状态。

- 4 态档案：pending / active / deprecated / archived（deprecated → active 恢复）
- 5 态密钥生成生命周期：queued / generating / generated / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 12 pending
- 自动翻转：auto-deprecate-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`algorithm` = "kyber"，生命周期字段 `purpose`
- 聚合器：`pqcgov-gov-stats-v2`
- 测试：44 V2

### Phase Iter22-H: Social Manager Governance V2（smgov-*-v2 / `cc social`）

在 `cc social` 下追加 V2 治理覆盖层，复用 `social-manager.js` 内存状态。

- 4 态档案：pending / active / muted / archived（muted → active 恢复）
- 5 态发布生命周期：queued / posting / posted / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 30 pending
- 自动翻转：auto-mute-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`channel` = "timeline"，生命周期字段 `author`
- 聚合器：`smgov-gov-stats-v2`
- 测试：44 V2

---

## CLI Iter23 V2 治理覆盖（v0.151.0）

8 个 lib 模块新增 V2 治理覆盖（4 态档案 + 5 态生命周期 + 容量 + 自动翻转），共 352 V2 测试通过。

### `cc rcache rcgov-...-v2` — Response Cache Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态刷新生命周期：queued / refreshing / refreshed / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`lane` = "default"，生命周期字段 `source`
- 聚合器：`rcgov-gov-stats-v2`
- 测试：44 V2

### `cc tech techgov-...-v2` — Tech Learning Engine Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态课业生命周期：queued / studying / studied / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 12 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`topic` = "general"，生命周期字段 `source`
- 聚合器：`techgov-gov-stats-v2`
- 测试：44 V2

### `cc runtime rtgov-...-v2` — Universal Runtime Gov V2

- 4 态档案：pending / active / degraded / archived（degraded → active 恢复）
- 5 态任务生命周期：queued / executing / executed / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-degrade-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`runtime` = "node"，生命周期字段 `kind`
- 聚合器：`rtgov-gov-stats-v2`
- 测试：44 V2

### `cc note ntgov-...-v2` — Note Versioning Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态修订生命周期：queued / reviewing / merged / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 30 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`series` = "default"，生命周期字段 `author`
- 聚合器：`ntgov-gov-stats-v2`
- 测试：44 V2

### `cc permmem pmgov-...-v2` — Permanent Memory Gov V2

- 4 态档案：pending / active / dormant / archived（dormant → active 恢复）
- 5 态固化生命周期：queued / pinning / pinned / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 30 pending
- 自动翻转：auto-dormant-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`bucket` = "default"，生命周期字段 `key`
- 聚合器：`pmgov-gov-stats-v2`
- 测试：44 V2

### `cc fusion pfgov-...-v2` — Protocol Fusion Gov V2

- 4 态档案：pending / active / degraded / archived（degraded → active 恢复）
- 5 态路由生命周期：queued / routing / routed / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-degrade-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`protocol` = "hybrid"，生命周期字段 `destination`
- 聚合器：`pfgov-gov-stats-v2`
- 测试：44 V2

### `cc dbevo dbevogov-...-v2` — Database Evolution Gov V2

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态迁移生命周期：queued / applying / applied / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`schema` = "default"，生命周期字段 `version`
- 聚合器：`dbevogov-gov-stats-v2`
- 测试：44 V2

### `cc infra digov-...-v2` — Decentral Infra Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态交易生命周期：queued / negotiating / settled / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`region` = "us-east"，生命周期字段 `provider`
- 聚合器：`digov-gov-stats-v2`
- 测试：44 V2

---

## CLI Iter24 V2 治理覆盖（v0.152.0）

8 个 lib 模块新增 V2 治理覆盖（4 态档案 + 5 态生命周期 + 容量 + 自动翻转），共 352 V2 测试通过。

### `cc recommend rcmdgov-...-v2` — Content Recommendation Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态推荐生命周期：queued / scoring / recommended / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`channel` = "default"，生命周期字段 `user`
- 聚合器：`rcmdgov-gov-stats-v2`
- 测试：44 V2

### `cc mcp mcpgov-...-v2` — MCP Registry Gov V2

- 4 态档案：pending / active / suspended / archived（suspended → active 恢复）
- 5 态调用生命周期：queued / invoking / invoked / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 25 pending
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`transport` = "stdio"，生命周期字段 `tool`
- 聚合器：`mcpgov-gov-stats-v2`
- 测试：44 V2

### `cc ecosystem ecogov-...-v2` — Plugin Ecosystem Gov V2

- 4 态档案：pending / active / disabled / archived（disabled → active 恢复）
- 5 态安装生命周期：queued / installing / installed / failed / cancelled（3 终结）
- 容量：每 owner 12 active / 每档案 30 pending
- 自动翻转：auto-disable-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`category` = "general"，生命周期字段 `version`
- 聚合器：`ecogov-gov-stats-v2`
- 测试：44 V2

### `cc skill sklgov-...-v2` — Skill Loader Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态加载生命周期：queued / loading / loaded / failed / cancelled（3 终结）
- 容量：每 owner 10 active / 每档案 25 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`source` = "local"，生命周期字段 `skillId`
- 聚合器：`sklgov-gov-stats-v2`
- 测试：44 V2

### `cc tokens toktgov-...-v2` — Token Tracker Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态用量生命周期：queued / recording / recorded / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`budget` = "default"，生命周期字段 `model`
- 聚合器：`toktgov-gov-stats-v2`
- 测试：44 V2

### `cc dev devgov-...-v2` — Autonomous Developer Gov V2

- 4 态档案：pending / active / paused / archived（paused → active 恢复）
- 5 态运行生命周期：queued / developing / shipped / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`level` = "assist"，生命周期字段 `goal`
- 聚合器：`devgov-gov-stats-v2`
- 测试：44 V2

### `cc compliance tigov-...-v2` — Threat Intel Gov V2

- 4 态档案：pending / active / stale / archived（stale → active 恢复）
- 5 态情报源生命周期：queued / ingesting / ingested / failed / cancelled（3 终结）
- 容量：每 owner 6 active / 每档案 15 pending
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`source` = "otx"，生命周期字段 `indicator`
- 聚合器：`tigov-gov-stats-v2`
- 测试：44 V2

### `cc compliance uebgov-...-v2` — UEBA Gov V2

- 4 态档案：pending / active / suppressed / archived（suppressed → active 恢复）
- 5 态告警生命周期：queued / analyzing / triaged / failed / cancelled（3 终结）
- 容量：每 owner 8 active / 每档案 20 pending
- 自动翻转：auto-suppress-idle（30 天）+ auto-fail-stuck（60 秒）
- 字段默认：`entity` = "user"，生命周期字段 `behavior`
- 聚合器：`uebgov-gov-stats-v2`
- 测试：44 V2

## CLI v0.153.0 — Iter25 V2 治理覆盖层（8 个模块）

### Cowork Task Templates V2 治理（cttgov-*）
- 命令：`cc cowork cttgov-...-v2`，覆盖 `packages/cli/src/lib/cowork-task-templates.js`。
- 4 状态档案（pending/active/stale/archived；stale → active 恢复）。
- 5 状态生命周期（queued/applying/applied/failed/cancelled；3 终态）。
- 容量：每 owner 8 active / 每档案 20 pending。
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`category` = "general"，生命周期字段 `context`。
- 聚合器：`cttgov-gov-stats-v2`。
- 测试：44 V2。

### Cowork Template Marketplace V2 治理（ctmgov-*）
- 命令：`cc cowork ctmgov-...-v2`，覆盖 `packages/cli/src/lib/cowork-template-marketplace.js`。
- 4 状态档案（pending/active/suspended/archived；suspended → active 恢复）。
- 5 状态生命周期（queued/fulfilling/fulfilled/failed/cancelled；3 终态）。
- 容量：每 owner 6 active / 每档案 15 pending。
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`vendor` = "default"，生命周期字段 `templateId`。
- 聚合器：`ctmgov-gov-stats-v2`。
- 测试：44 V2。

### CLI Anything Bridge V2 治理（clibgov-*）
- 命令：`cc cli-anything clibgov-...-v2`，覆盖 `packages/cli/src/lib/cli-anything-bridge.js`。
- 4 状态档案（pending/active/degraded/archived；degraded → active 恢复）。
- 5 状态生命周期（queued/bridging/bridged/failed/cancelled；3 终态）。
- 容量：每 owner 8 active / 每档案 20 pending。
- 自动翻转：auto-degrade-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`tool` = "generic"，生命周期字段 `command`。
- 聚合器：`clibgov-gov-stats-v2`。
- 测试：44 V2。

### Agent Router V2 治理（argov-*）
- 命令：`cc orchestrate argov-...-v2`，覆盖 `packages/cli/src/lib/agent-router.js`。
- 4 状态档案（pending/active/stale/archived；stale → active 恢复）。
- 5 状态生命周期（queued/routing_run/routed/failed/cancelled；3 终态）。
- 容量：每 owner 8 active / 每档案 20 pending。
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`strategy` = "round-robin"，生命周期字段 `target`。
- 聚合器：`argov-gov-stats-v2`，与既有 router-* V2 共存。
- 测试：44 V2。

### Sub-Agent Registry V2 治理（saregov-*）
- 命令：`cc agent saregov-...-v2`，覆盖 `packages/cli/src/lib/sub-agent-registry.js`。
- 4 状态档案（pending/active/suspended/archived；suspended → active 恢复）。
- 5 状态生命周期（queued/spawning/spawned/failed/cancelled；3 终态）。
- 容量：每 owner 10 active / 每档案 25 pending。
- 自动翻转：auto-suspend-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`kind` = "general"，生命周期字段 `task`。
- 聚合器：`saregov-gov-stats-v2`。
- 测试：44 V2。

### Todo Manager V2 治理（todogov-*）
- 命令：`cc agent todogov-...-v2`，覆盖 `packages/cli/src/lib/todo-manager.js`。
- 4 状态档案（pending/active/paused/archived；paused → active 恢复）。
- 5 状态生命周期（queued/doing/done/failed/cancelled；3 终态）。
- 容量：每 owner 10 active / 每档案 30 pending。
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`list` = "default"，生命周期字段 `title`。
- 聚合器：`todogov-gov-stats-v2`。
- 测试：44 V2。

### Execution Backend V2 治理（ebgov-*）
- 命令：`cc agent ebgov-...-v2`，覆盖 `packages/cli/src/lib/execution-backend.js`。
- 4 状态档案（pending/active/degraded/archived；degraded → active 恢复）。
- 5 状态生命周期（queued/executing/succeeded/failed/cancelled；3 终态）。
- 容量：每 owner 6 active / 每档案 15 pending。
- 自动翻转：auto-degrade-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`backend` = "local"，生命周期字段 `task`。
- 聚合器：`ebgov-gov-stats-v2`。
- 测试：44 V2。

### Evomap Federation V2 治理（evfedgov-*）
- 命令：`cc evomap evfedgov-...-v2`，覆盖 `packages/cli/src/lib/evomap-federation.js`。
- 4 状态档案（pending/active/stale/archived；stale → active 恢复）。
- 5 状态生命周期（queued/syncing/synced/failed/cancelled；3 终态）。
- 容量：每 owner 6 active / 每档案 15 pending。
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`hub` = "primary"，生命周期字段 `geneId`。
- 聚合器：`evfedgov-gov-stats-v2`，与既有 evgov-*（iter20）共存。
- 测试：44 V2。

## CLI v0.154.0 — Iter26 V2 治理覆盖层（8 个全新模块）

### Interactive Planner V2 治理（plannergov-*）
- 命令：`cc planmode plannergov-...-v2`，覆盖 `packages/cli/src/lib/interactive-planner.js`。
- 4 状态档案（pending/active/paused/archived；paused → active 恢复）。
- 5 状态生命周期（queued/asking/answered/failed/cancelled；3 终态）。
- 容量：每 owner 6 active / 每档案 15 pending。
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`persona` = "default"，生命周期字段 `question`。
- 聚合器：`plannergov-gov-stats-v2`。
- 测试：44 V2。

### CLI Context Engineering V2 治理（ctxenggov-*）
- 命令：`cc cli-anything ctxenggov-...-v2`，覆盖 `packages/cli/src/lib/cli-context-engineering.js`。
- 4 状态档案（pending/active/stale/archived；stale → active 恢复）。
- 5 状态生命周期（queued/building/built/failed/cancelled；3 终态）。
- 容量：每 owner 8 active / 每档案 20 pending。
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`scope` = "session"，生命周期字段 `prompt`。
- 聚合器：`ctxenggov-gov-stats-v2`，与 iter25 clibgov-* 共存。
- 测试：44 V2。

### Sub-Agent Context V2 治理（sactxgov-*）
- 命令：`cc agent sactxgov-...-v2`，覆盖 `packages/cli/src/lib/sub-agent-context.js`。
- 4 状态档案（pending/active/stale/archived；stale → active 恢复）。
- 5 状态生命周期（queued/transferring/transferred/failed/cancelled；3 终态）。
- 容量：每 owner 8 active / 每档案 20 pending。
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`scope` = "task"，生命周期字段 `subAgent`。
- 聚合器：`sactxgov-gov-stats-v2`，与 iter25 saregov-*/todogov-*/ebgov- 共存。
- 测试：44 V2。

### Interaction Adapter V2 治理（iagov-*）
- 命令：`cc chat iagov-...-v2`，覆盖 `packages/cli/src/lib/interaction-adapter.js`。
- 4 状态档案（pending/active/idle/archived；idle → active 恢复）。
- 5 状态生命周期（queued/responding/responded/failed/cancelled；3 终态）。
- 容量：每 owner 6 active / 每档案 15 pending。
- 自动翻转：auto-idle-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`adapter` = "cli"，生命周期字段 `input`。
- 聚合器：`iagov-gov-stats-v2`，与 iter17 chatgov-* 共存。
- 测试：44 V2。

### Workflow Expr V2 治理（wfexgov-*）
- 命令：`cc workflow wfexgov-...-v2`，覆盖 `packages/cli/src/lib/workflow-expr.js`。
- 4 状态档案（pending/active/paused/archived；paused → active 恢复）。
- 5 状态生命周期（queued/evaluating/evaluated/failed/cancelled；3 终态）。
- 容量：每 owner 8 active / 每档案 20 pending。
- 自动翻转：auto-pause-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`language` = "cel"，生命周期字段 `expression`。
- 聚合器：`wfexgov-gov-stats-v2`，与 iter21 wfgov-* 共存。
- 测试：44 V2。

### Plugin Autodiscovery V2 治理（padgov-*）
- 命令：`cc plugin padgov-...-v2`，覆盖 `packages/cli/src/lib/plugin-autodiscovery.js`。
- 4 状态档案（pending/active/stale/archived；stale → active 恢复）。
- 5 状态生命周期（queued/scanning/scanned/failed/cancelled；3 终态）。
- 容量：每 owner 6 active / 每档案 15 pending。
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`root` = ".chainlesschain"，生命周期字段 `path`。
- 聚合器：`padgov-gov-stats-v2`。
- 测试：44 V2。

### Hashline V2 治理（hlgov-*）
- 命令：`cc memory hlgov-...-v2`，覆盖 `packages/cli/src/lib/hashline.js`。
- 4 状态档案（pending/active/stale/archived；stale → active 恢复）。
- 5 状态生命周期（queued/hashing/hashed/failed/cancelled；3 终态）。
- 容量：每 owner 8 active / 每档案 20 pending。
- 自动翻转：auto-stale-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`algorithm` = "sha256"，生命周期字段 `content`。
- 聚合器：`hlgov-gov-stats-v2`，与 iter21 memgov-* 共存。
- 测试：44 V2。

### Web UI Server V2 治理（webuigov-*）
- 命令：`cc ui webuigov-...-v2`，覆盖 `packages/cli/src/lib/web-ui-server.js`。
- 4 状态档案（pending/active/degraded/archived；degraded → active 恢复）。
- 5 状态生命周期（queued/serving/served/failed/cancelled；3 终态）。
- 容量：每 owner 10 active / 每档案 25 pending。
- 自动翻转：auto-degrade-idle（30 天）+ auto-fail-stuck（60 秒）。
- 字段默认：`endpoint` = "/"，生命周期字段 `method`。
- 聚合器：`webuigov-gov-stats-v2`。
- 测试：44 V2。

## CLI v0.155.0 — Iter27 V2 治理覆盖层（16 模块一次性批量港）

单轮港入全部 16 个中等体量（100–200 行）lib 模块，均为前所未有的治理覆盖层。

### Downloader V2 治理（dlgov-*，cc setup）
- `category="mirror"`（默认 "default"），生命周期 Download（queued/fetching/fetched/failed/cancelled）；caps 6/15；stale→active 恢复。

### Skill MCP V2 治理（smcpgov-*，cc skill）
- `server` 默认 "default"；生命周期 Call（queued/invoking/invoked/failed/cancelled）；caps 6/15；stale→active。

### Cowork MCP Tools V2 治理（cmcpgov-*，cc cowork）
- `toolset` 默认 "default"；生命周期 Exec（queued/running/completed/failed/cancelled）；caps 8/20；stale→active。

### STIX Parser V2 治理（stixgov-*，cc compliance）
- `stixVersion` 默认 "2.1"；生命周期 Parse（queued/parsing/parsed/failed/cancelled）；caps 6/15；stale→active。

### Sub-Agent Profiles V2 治理（sapgov-*，cc agent）
- `role` 默认 "general"；生命周期 Apply（queued/applying/applied/failed/cancelled）；caps 8/20；suspended→active。

### Cowork Observe V2 治理（cobsgov-*，cc cowork）
- `channel` 默认 "default"；生命周期 Event（queued/recording/recorded/failed/cancelled）；caps 10/25；muted→active。

### Process Manager V2 治理（pmgrgov-*，cc start）
- `kind` 默认 "service"；生命周期 Proc（queued/starting/running/failed/cancelled）；caps 8/20；stopped→active。

### WS Chat Handler V2 治理（wscgov-*，cc chat）
- `connection` 默认 "default"；生命周期 Msg（queued/handling/handled/failed/cancelled）；caps 10/25；idle→active。

### Evomap Client V2 治理（evcligov-*，cc evomap）
- `endpoint` 默认 "primary"；生命周期 Rpc（queued/calling/returned/failed/cancelled）；caps 6/15；stale→active。

### Provider Options V2 治理（poptgov-*，cc llm）
- `provider` 默认 "default"；生命周期 Resolve（queued/resolving/resolved/failed/cancelled）；caps 8/20；stale→active。

### Session Core Singletons V2 治理（scsgov-*，cc config）
- `component` 默认 "default"；生命周期 Access（queued/resolving/resolved/failed/cancelled）；caps 8/20；stale→active。

### Service Manager V2 治理（smgrgov-*，cc services）
- `service` 默认 "default"；生命周期 Op（queued/operating/operated/failed/cancelled）；caps 8/20；degraded→active。

### Cowork Evomap Adapter V2 治理（ceadgov-*，cc cowork）
- `direction` 默认 "bidirectional"；生命周期 Bind（queued/binding/bound/failed/cancelled）；caps 6/15；stale→active。

### Provider Stream V2 治理（pstrmgov-*，cc stream）
- `provider` 默认 "default"；生命周期 Chunk（queued/streaming/flushed/failed/cancelled）；caps 8/25；stale→active。

### Cowork Observe HTML V2 治理（cohtgov-*，cc cowork）
- `template` 默认 "default"；生命周期 Render（queued/rendering/rendered/failed/cancelled）；caps 6/15；stale→active。

### Cowork Adapter V2 治理（cadpgov-*，cc cowork）
- `target` 默认 "default"；生命周期 Adapt（queued/adapting/adapted/failed/cancelled）；caps 6/15；stale→active。

**共计**：16 × 44 = 704 V2 测试，全部通过；16 × 23 = 368 个 V2 子命令；聚合器 `*-gov-stats-v2`。

## CLI Iter28 — 16 模块一次性 V2 治理覆盖（v0.156.0）

为尚未有 V2 治理层的 16 个中型 lib 增加 4-state 成熟度 + 5-state 生命周期治理，覆盖协议、编排、经济、自治代理、对话、合规、跨链、加密、DAO、进化、演化地图、分层记忆、推理网络、知识图谱、Plan Mode、Pipeline。命名用 prefix 前缀区分（A2apgov/Acrdgov/…），独立于旧有 `{Name}Gov` 表面，无冲突共存。

### A2A Protocol V2 治理（a2apgov-*，cc a2a）
- `endpoint` 默认 "default"；生命周期 Msg（queued/dispatching/delivered/failed/cancelled）；caps 8/20；stale→active。

### Agent Coordinator V2 治理（acrdgov-*，cc orchestrate）
- `role` 默认 "leader"；生命周期 Coord（queued/coordinating/coordinated/failed/cancelled）；caps 6/15；idle→active。

### Agent Economy V2 治理（aecogov-*，cc economy）
- `market` 默认 "default"；生命周期 Trade（queued/trading/settled/failed/cancelled）；caps 8/25；paused→active。

### Autonomous Agent V2 治理（autagov-*，cc agent）
- `tier` 默认 "assist"；生命周期 Run（queued/running/finished/failed/cancelled）；caps 6/15；paused→active。

### Chat Core V2 治理（ccoregov-*，cc chat）
- `channel` 默认 "default"；生命周期 Msg（queued/sending/sent/failed/cancelled）；caps 10/25；idle→active。

### Compliance Manager V2 治理（cmpmgov-*，cc compliance）
- `framework` 默认 "soc2"；生命周期 Report（queued/reporting/reported/failed/cancelled）；caps 6/15；stale→active。

### Cross Chain V2 治理（crchgov-*，cc crosschain）
- `bridge` 默认 "default"；生命周期 Transfer（queued/transferring/transferred/failed/cancelled）；caps 6/15；stale→active。

### Crypto Manager V2 治理（crygov-*，cc encrypt）
- `provider` 默认 "default"；生命周期 Encrypt（queued/encrypting/encrypted/failed/cancelled）；caps 8/20；stale→active。

### DAO Governance V2 治理（daomgov-*，cc dao）
- `realm` 默认 "default"；生命周期 Proposal（queued/voting/resolved/failed/cancelled）；caps 6/15；paused→active。

### Evolution System V2 治理（esysgov-*，cc evolution）
- `lane` 默认 "default"；生命周期 Cycle（queued/evolving/evolved/failed/cancelled）；caps 6/15；paused→active。

### Evomap Manager V2 治理（emgrgov-*，cc evomap）
- `map` 默认 "default"；生命周期 Op（queued/operating/operated/failed/cancelled）；caps 8/20；stale→active。

### Hierarchical Memory V2 治理（hmemgov-*，cc hmemory）
- `tier` 默认 "short-term"；生命周期 Recall（queued/recalling/recalled/failed/cancelled）；caps 10/30；stale→active。

### Inference Network V2 治理（infnetgov-*，cc inference）
- `node` 默认 "default"；生命周期 Request（queued/inferring/inferred/failed/cancelled）；caps 8/25；stale→active。

### Knowledge Graph V2 治理（kggov-*，cc kg）
- `kind` 默认 "default"；生命周期 Query（queued/querying/answered/failed/cancelled）；caps 8/20；stale→active。

### Plan Mode V2 治理（pmodegov-*，cc planmode）
- `template` 默认 "default"；生命周期 Plan（queued/planning/finalized/failed/cancelled）；caps 6/15；paused→active。

### Pipeline Orchestrator V2 治理（pipogov-*，cc pipeline）
- `pipeline` 默认 "default"；生命周期 Run（queued/running/finished/failed/cancelled）；caps 8/20；paused→active。

**共计**：16 × 44 = 704 V2 测试，全部通过；16 × 23 = 368 个 V2 子命令；聚合器 `*-gov-stats-v2`；命名 scheme 用 prefix-大写化做聚合器，避免与旧 `{ModuleName}Gov*` 表面冲突。
