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

## Permanent Memory V2 (cli 0.119.0)

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

## Response Cache V2 (cli 0.119.0)

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
