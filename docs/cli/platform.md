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
