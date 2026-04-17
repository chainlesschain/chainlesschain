# CLI — Phases 2–7 · Init, Persona, Cowork

> Parent: [`../CLI_COMMANDS_REFERENCE.md`](../CLI_COMMANDS_REFERENCE.md)

## Phase 2: Knowledge & Content Management

```bash
chainlesschain import markdown ./docs  # 导入 markdown 文件
chainlesschain import evernote backup.enex # 导入 Evernote
chainlesschain import pdf document.pdf # 导入 PDF
chainlesschain export site -o ./site   # 导出为静态 HTML
chainlesschain git status              # Git 集成
chainlesschain git auto-commit         # 自动提交改动
```

## Phase 3: MCP & External Integration

```bash
chainlesschain mcp servers             # 列出 MCP 服务器
chainlesschain mcp add fs -c npx -a "-y,@modelcontextprotocol/server-filesystem"
chainlesschain mcp add weather -u https://mcp.example.com/weather            # Streamable HTTP 传输 (自动识别)
chainlesschain mcp add weather -u https://mcp.example.com/weather -t http    # 显式传输类型 (http|sse|stdio)
chainlesschain mcp add weather -u https://... -H Authorization=Bearer+xyz    # 自定义请求头 (可重复)
chainlesschain mcp tools               # 列出可用工具
chainlesschain mcp scaffold weather                          # 在 ./weather 中生成 stdio MCP 服务器
chainlesschain mcp scaffold weather -t http -p 4001          # Streamable HTTP + SSE 于端口 4001
chainlesschain mcp scaffold weather --dry-run --json         # 预览文件集合, 不落盘
chainlesschain mcp scaffold weather -d "Forecasts" -a Alice  # 自定义描述 + package.json 作者
chainlesschain mcp scaffold weather -o ~/projects/w --force  # 指定输出目录, 覆盖已存在内容
chainlesschain mcp registry list                             # 浏览社区 MCP 服务器精选目录
chainlesschain mcp registry list -c database --sort rating --order desc
chainlesschain mcp registry list -t browser,automation --json
chainlesschain mcp registry search git                       # 关键字搜索 (name/description/tags)
chainlesschain mcp registry show filesystem                  # 完整条目详情 (id 或短名)
chainlesschain mcp registry install github                   # 将目录条目注册为 MCP 服务器
chainlesschain mcp registry install github --as gh --auto-connect
chainlesschain mcp registry categories                       # 列出目录分类
chainlesschain browse fetch https://example.com  # 抓取网页
chainlesschain browse scrape <url> -s "h2"       # 抓取指定元素
chainlesschain llm providers           # 列出 10 个 LLM 提供商
chainlesschain llm switch anthropic    # 切换当前提供商
chainlesschain instinct show           # 已学习的偏好
```

## Phase 4: Security & Identity

```bash
chainlesschain did create              # 创建 DID 身份 (Ed25519)
chainlesschain did list                # 列出所有身份
chainlesschain did sign "message"      # 使用默认 DID 签名
chainlesschain encrypt file secret.txt # AES-256-GCM 文件加密
chainlesschain decrypt file secret.txt.enc # 解密文件
chainlesschain auth roles              # 列出 RBAC 角色
chainlesschain auth check user1 "note:read" # 检查权限
chainlesschain audit log               # 最近审计事件
chainlesschain audit stats             # 审计统计
```

## Phase 5: P2P, Blockchain & Enterprise

```bash
chainlesschain p2p peers               # 列出 P2P 节点
chainlesschain p2p send <peer> "msg"   # 发送加密消息
chainlesschain p2p pair "My Phone"     # 配对设备
chainlesschain sync status             # 同步状态
chainlesschain sync push               # 推送本地改动
chainlesschain sync pull               # 拉取远端改动
chainlesschain wallet create --name "Main" # 创建钱包
chainlesschain wallet assets           # 列出数字资产
chainlesschain wallet transfer <id> <to> # 转账资产
chainlesschain org create "Acme Corp"  # 创建组织
chainlesschain org invite <org> <user> # 邀请成员
chainlesschain org approve <id>        # 批准申请
chainlesschain plugin list             # 列出已安装插件
chainlesschain plugin install <name>   # 安装插件
chainlesschain plugin search <query>   # 搜索插件仓库
```

## Project Initialization & Persona

```bash
chainlesschain init                    # 交互式项目初始化
chainlesschain init --bare             # 最小项目结构
chainlesschain init --template code-project --yes
chainlesschain init --template medical-triage --yes
chainlesschain init --template agriculture-expert --yes
chainlesschain init --template general-assistant --yes
chainlesschain init --template ai-media-creator --yes
chainlesschain init --template ai-doc-creator --yes
chainlesschain persona show                # 显示当前 persona
chainlesschain persona set --name "Bot" --role "Helper"
chainlesschain persona set -b "Be polite"
chainlesschain persona set --tools-disabled run_shell
chainlesschain persona reset
```

## Multi-agent Collaboration (Cowork)

```bash
chainlesschain cowork debate <file>    # 多视角代码评审
chainlesschain cowork compare <prompt> # A/B 方案对比
chainlesschain cowork analyze <path>   # 代码分析
chainlesschain cowork status           # 显示 cowork 状态
```

## Phase 6: AI Core (Hooks, Workflow, Memory, A2A)

```bash
chainlesschain hook list / add / run / stats
chainlesschain workflow create / run / templates
chainlesschain hmemory store / recall / consolidate
chainlesschain a2a register / discover / submit
```

### Phase 83 — Hierarchical Memory 2.0 (`hmemory` extension)

Strictly-additive canonical surface on top of the original four-layer
`hmemory` commands. Adds frozen enums, metadata attachment, per-memory
promote/demote, fine-grained permission-based sharing, episodic search
with time-range + scene + context filters, concept-overlap semantic
similarity, consolidation status tracking, layer-scoped prune with custom
threshold, and extended stats.

```bash
# Enum reference
chainlesschain hmemory layers          # working / short-term / long-term / core
chainlesschain hmemory types           # episodic / semantic / procedural
chainlesschain hmemory statuses        # pending / processing / completed / failed
chainlesschain hmemory permissions     # read / copy / modify

# Metadata attach (V2 scene/context/concepts/agentId)
chainlesschain hmemory attach-metadata <id> \
  [--scene kitchen] [--context "morning"] [--concepts ai,ml,llm] [--agent-id did:a]

# Promote / demote between layers
chainlesschain hmemory promote-v2 <id>   # working → short-term → long-term
chainlesschain hmemory demote-v2 <id>    # short-term → working

# Permission-based sharing
chainlesschain hmemory share-v2 <id> <target> \
  [--source did:a] [--permissions read,copy,modify]
chainlesschain hmemory revoke-share <shareId>
chainlesschain hmemory shares [--memory-id <id>] [--target <agent>] [--active-only]

# V2 search (time range + scene + concept similarity)
chainlesschain hmemory search-episodic-v2 [query] \
  [--from <iso>] [--to <iso>] [--scene <s>] [--context <c>] [-n 20]
chainlesschain hmemory search-semantic-v2 [query] \
  [--concepts c1,c2] [--similarity 0.3] [-n 20]

# Consolidation with status tracking + pattern extraction
chainlesschain hmemory consolidate-v2 [--extract-patterns]
chainlesschain hmemory consolidations [--status completed]

# Layer-scoped prune + extended stats
chainlesschain hmemory prune-v2 [--layer working|short-term|long-term] \
  [--max-age 720] [--threshold 0.3]
chainlesschain hmemory stats-v2 [--json]
```

**Similarity formula**: `|A ∩ B| / max(|A|, |B|)` (overlap / larger-set size)
on concept-tag arrays. Query-only search (no concepts) falls back to
content substring match across both in-memory layers.

**Scope / 未移植**: Cross-agent transport (IPFS/WebRTC), embedding-vector
semantic search, and full-LLM pattern clustering remain Desktop-only. The
CLI port is the deterministic state machine + metadata + concept-overlap
scoring + consolidation status tracking.

### Phase 82 — Autonomous Workflow Orchestrator (Workflow Engine extension)

Extends `chainlesschain workflow` with the canonical Phase 82 surface: frozen
enums (`WORKFLOW_STATUS` / `NODE_STATUS` / `TEMPLATE_TYPE`), 5 canonical
templates keyed by `TEMPLATE_TYPE`, checkpoint snapshots, conditional
breakpoints, and JSON import/export. All breakpoint conditions are evaluated
via a regex-safe parser (`input.<path> OP <literal>`, no `eval`).

```bash
# Canonical templates and enum reference
chainlesschain workflow canonical-templates       # ci_cd / data_pipeline / code_review / deployment / test_suite
chainlesschain workflow statuses [--json]         # Frozen WORKFLOW_STATUS + NODE_STATUS + TEMPLATE_TYPE

# Checkpoints (snapshot execution state, rollback to specific point)
chainlesschain workflow checkpoint <exec-id> [--json]
chainlesschain workflow checkpoints <exec-id> [--json]
chainlesschain workflow rollback-to <exec-id> <checkpoint-id>

# Breakpoints (conditional pause points for debugging)
chainlesschain workflow breakpoint-set <wf-id> <node-id> [-c "input.priority > 5"]
chainlesschain workflow breakpoints <wf-id> [--json]
chainlesschain workflow breakpoint-remove <bp-id>

# Import / export workflows as JSON
chainlesschain workflow export <wf-id> [-o path.json]
chainlesschain workflow import <path.json> [--json]
```

**Scope / 未移植**: Parallel node execution, approval timeouts with auto-escalation,
and DAG live visualization remain Desktop-only. The CLI port covers the
deterministic record-keeping surface: DAG validation + topological sort,
5 canonical templates, checkpoint snapshots + rollback-to-checkpoint,
conditional breakpoints with safe expression evaluation, and portable
JSON workflow import/export.

## Phase 7: Security & Evolution

```bash
chainlesschain sandbox create / exec / audit
chainlesschain evolution assess / diagnose / learn
chainlesschain evomap federation list-hubs / sync / pressure
chainlesschain evomap gov propose / vote / dashboard
chainlesschain dao propose / vote / delegate / execute / treasury / stats
```

### Phase 100 — Self-Evolving AI (`evolution` extension)

Strictly-additive V2 layer on top of the pre-existing `evolution` command.
Adds four frozen canonical enums (6 capability dimensions / 4 diagnosis
severities / 4 repair strategies / 4 growth milestone types), dimension-
validated capability assessment with auto-milestone on ≥0.1 gain, strategy-
aware incremental training with knowledge-retention ratio, severity-bucketed
self-diagnosis with root cause + repair suggestion, strategy-validated
self-repair that marks diagnoses completed, horizon-aware behavior
prediction, and config CRUD over 10 keys.

```bash
chainlesschain evolution dimensions                  # reasoning/knowledge/creativity/accuracy/speed/adaptability
chainlesschain evolution severities                  # normal/warning/critical/fatal
chainlesschain evolution strategies                  # parameter_tune/model_rollback/cache_rebuild/full_reset
chainlesschain evolution milestones                  # capability_gain/knowledge_expansion/self_repair_success/prediction_accuracy

chainlesschain evolution assess-v2 <dim> <score> [-m '{}']       # validates dim ∈ enum, score ∈ [0,1]
chainlesschain evolution capabilities-v2 [--json]
chainlesschain evolution train-v2 -s <strategy> --data-size N --loss-before N --loss-after N
chainlesschain evolution training-log-v2 [-s strategy] [-l N]
chainlesschain evolution diagnose-v2 [--scope s] [--depth d]     # returns severity + rootCause + repairSuggestion
chainlesschain evolution diagnoses-v2 [-s severity]
chainlesschain evolution diagnosis-show <id>
chainlesschain evolution repair-v2 <diagnosis-id> -s <strategy>  # marks completed; records SELF_REPAIR_SUCCESS
chainlesschain evolution predict-v2 [--horizon-ms N]
chainlesschain evolution record-milestone <type> -d "desc" [--capability-id id]
chainlesschain evolution growth-v2 [-t type] [--from ms] [--to ms] [-l N]
chainlesschain evolution configure -k <key> -v <val>             # 10 keys (strategy/threshold/intervals/...)
chainlesschain evolution config [--json]
chainlesschain evolution stats-v2                                # byDimension + bySeverity + byMilestone
```

**Knowledge retention**: `retention = 1 − |lossAfter − lossBefore| / max(|lossBefore|, 0.01)`,
clamped to [0, 1]. Status `completed` when ≥ `knowledgeRetentionThreshold`,
else `retention_low`.

**Diagnosis heuristics**: sharp capability drop ≥ 0.2 → WARNING +
`parameter_tune`; 3+ recent training runs below retention threshold →
CRITICAL + `model_rollback`.

**Scope / 未移植**: Real online learning (replay buffer + elastic weight
consolidation + knowledge distillation) against production models, live
behavior prediction against user telemetry, capability heatmap UI, and
IPC auto-repair coordination remain Desktop-only. The CLI port is the
deterministic record-keeping + policy surface: enum validation, retention
math, state machine (diagnose → repair), milestone log, and config CRUD.

### Phase 87 — Agent Security Sandbox 2.0 (`sandbox` extension)

Strictly-additive V2 layer on top of the pre-existing `sandbox` command. Adds
frozen canonical enums (6 statuses / 5 permission types / 5 risk levels / 5
quota types), an explicit lifecycle state machine (pause/resume/terminate),
per-type quota set+check, permission enforcement with deny-by-default, risk
score classification, auto-isolation, and filtered audit + extended stats.

```bash
chainlesschain sandbox statuses                     # creating / ready / running / paused / terminated / error
chainlesschain sandbox permission-types             # filesystem / network / syscall / ipc / process
chainlesschain sandbox risk-levels                  # safe / low / medium / high / critical
chainlesschain sandbox quota-types                  # cpu_percent / memory_mb / disk_mb / network_kbps / process_count
chainlesschain sandbox pause <id>                   # active → paused
chainlesschain sandbox resume <id>                  # paused → active
chainlesschain sandbox terminate <id> [--reason r]  # canonical destroy (status=terminated, reason recorded)
chainlesschain sandbox set-quota-typed <id> <type> <limit>
chainlesschain sandbox check-permission <id> <type> <target> [--mode read|write]
chainlesschain sandbox check-quota <id> <type> [amount]
chainlesschain sandbox risk-score <id>              # score + bucketed risk level
chainlesschain sandbox risk-level <score>           # static score → bucket mapping
chainlesschain sandbox auto-isolate <id> [--reason r]  # record isolation + terminate
chainlesschain sandbox isolations [--sandbox id] [--reason r]
chainlesschain sandbox audit-filter [id] [-e types,...] [--from iso] [--to iso] [-l n]
chainlesschain sandbox stats-v2                     # byStatus + auditByAction + isolations
```

**Risk buckets**: `<20 safe ≤ low <40 ≤ medium <60 ≤ high <80 ≤ critical`.

**Quota field mapping**: canonical `cpu_percent→cpu`, `memory_mb→memory`,
`disk_mb→storage`, `network_kbps→network`, `process_count→processCount`
(merges into pre-existing `sandbox.quota` without breaking base APIs).

**Scope / 未移植**: OS-level namespace / cgroup / seccomp isolation, real
process fork+exec sandboxing, kernel-mode hooks, and chaos-engineering fault
injection remain Desktop-only. The CLI port is the deterministic
record-keeping + policy surface: enum validation, lifecycle state machine,
quota arithmetic, permission decision, risk classification, and audit.

### Phase 92 — DAO Governance 2.0

Strictly-additive extensions on top of the original `dao` surface (all legacy
subcommands keep their names and behaviour). The V2 layer adds a 4-phase
proposal lifecycle (DRAFT → ACTIVE → QUEUE → EXECUTE), quadratic voting,
cycle-safe delegation with depth limit, and proposal-linked treasury
allocation with post-allocation balance snapshots.

```bash
chainlesschain dao statuses                        # draft / active / queue / execute / passed / rejected / cancelled
chainlesschain dao propose-v2 -t "Title" -d "Body" --proposer did:key:alice \
  [--type parameter|grant|upgrade] [--actions '<json>'] [--duration <ms>]
chainlesschain dao activate <proposalId>           # DRAFT → ACTIVE
chainlesschain dao cast-vote <proposalId> --voter did:key:alice \
  --type for|against|abstain --count <n> --balance <tokens>  # cost = n² tokens
chainlesschain dao delegate-v2 --from did:key:alice --to did:key:bob \
  [--weight 1] [--expires-at <epoch-ms>]            # rejects cycles + self-delegation
chainlesschain dao revoke-delegation <fromDid>
chainlesschain dao active-delegations [--json]      # auto-expires past expiresAt
chainlesschain dao queue <proposalId>               # ACTIVE → QUEUE (majority + quorum)
chainlesschain dao execute-v2 <proposalId>          # QUEUE → EXECUTE after timelock
chainlesschain dao cancel <proposalId>              # → CANCELLED (rejected if EXECUTE)
chainlesschain dao allocate-v2 <proposalId> --recipient did:key:bob \
  --amount <n> [--asset CLC] [--memo "grant"]       # requires EXECUTE status
chainlesschain dao deposit-v2 --amount <n> [--asset CLC] [--depositor did] [--memo ...]
chainlesschain dao treasury-state [--json]
chainlesschain dao stats-v2 [--total-members <n>] [--json]
chainlesschain dao configure-v2 --key <k> --value <v>  # 7 config keys
chainlesschain dao config-v2 [--json]
```

**Config keys**: `votingDurationMs`, `quorumPercentage` (0..1),
`timelockMs`, `quadraticEnabled`, `maxDelegationDepth`,
`proposalThreshold` (tokens required to propose),
`maxSingleAllocation` (per-allocation cap).

**Scope / 未移植**: On-chain settlement of proposal execution, physical token
transfer, and wallet-signature auth remain Desktop-only. The CLI port is the
deterministic record-keeping surface: proposal lifecycle state machine,
quadratic-cost vote accounting, cycle + depth + expiry safe delegation,
timelock enforcement, and proposal-linked treasury with balance snapshots.

## Phase 14: SSO Enterprise Authentication

```bash
chainlesschain sso protocols                       # saml / oauth2 / oidc
chainlesschain sso provider-types                  # azure_ad / okta / google / onelogin / custom
chainlesschain sso templates                       # 5 built-in templates
chainlesschain sso template <id>                   # Show one template

# Configuration CRUD
chainlesschain sso create -n "Okta Prod" -p oidc -t okta -c '<oidc-config-json>'
chainlesschain sso configs [-p oidc|saml|oauth2] [--enabled|--disabled]
chainlesschain sso show <configId>
chainlesschain sso update <configId> [-n name] [--enable|--disable] [-c '<json>']
chainlesschain sso delete <configId>
chainlesschain sso test <configId> --success | --failure -e "401 Unauthorized"

# Authorization flow helpers (caller opens browser)
chainlesschain sso generate-pkce
chainlesschain sso login-url <configId> [--state s] [--nonce n] [--prompt login]
chainlesschain sso saml-authn-request <configId> [--relay-state rs]

# Sessions (caller feeds tokens back after IdP round-trip)
chainlesschain sso complete-login <configId> -a <access> -r <refresh> -i <id> -e <expiresMs> -d <did>
chainlesschain sso sessions [-c configId] [-s active|expired|revoked] [-d did]
chainlesschain sso session <sessionId>
chainlesschain sso refresh-session <sessionId> -a <new-access> -e <expiresMs>
chainlesschain sso destroy-session <sessionId>          # → revoked
chainlesschain sso expire-session <sessionId>           # → expired
chainlesschain sso valid <sessionId>

# DID ↔ SSO identity bridge
chainlesschain sso link -d <did> -p okta -u <ssoUserId> -e <email>
chainlesschain sso unlink -d <did> -p okta
chainlesschain sso identities <did>
chainlesschain sso did-for-sso -p okta -u <ssoUserId>
chainlesschain sso identity-mappings [-p okta] [-d <did>]
chainlesschain sso conflict-check -p okta -u <ssoUserId>

chainlesschain sso stats
```

**Scope / 未移植**: The CLI can't open a browser and isn't a redirect target. The port covers configuration CRUD, PKCE helpers, authorization-URL / SAML AuthnRequest builders, token storage (AES-256-GCM with PBKDF2 key derivation), session lifecycle, and the DID ↔ SSO identity bridge. The actual IdP browser round-trip, token endpoint exchange, SAML Response signature verification, SCIM provisioning, and MFA flows remain Desktop-side — callers feed the resulting tokens back in via `complete-login`.

## Social Graph Analytics (18_社交AI系统 Phase 42)

Pure-function analytics over the snapshot produced by `cc social graph snapshot`
(`lib/social-graph.js`). All commands share the existing `--type <edgeType>`
filter from the snapshot step and accept `--edge-types <list>` to narrow by
multiple relationship kinds (e.g. `follow,friend`). Output is human-formatted
by default; pass `--json` to get the raw score map or result object.

```bash
# Per-DID centrality scores (top-N, ties broken lexicographically)
chainlesschain social graph degree      [-d in|out|both] [--no-normalize] [-l 10]
chainlesschain social graph closeness   [--directed] [--no-normalize] [-l 10]
chainlesschain social graph betweenness [--directed] [--no-normalize] [-l 10]   # Brandes' O(V·E)
chainlesschain social graph eigenvector [--directed] [--iterations 100] [--tolerance 1e-6]

# Composite influence (weighted sum of normalized {degree, closeness, betweenness, eigenvector})
chainlesschain social graph influence \
  --w-degree 0.25 --w-closeness 0.25 --w-betweenness 0.25 --w-eigenvector 0.25

# Label-propagation communities with modularity Q
chainlesschain social graph communities [--max-iterations 20] [--min-size 2]

# Shortest path via BFS (default directed; pass --undirected to relax)
chainlesschain social graph path <source> <target> [--undirected] [-e follow,friend]

# Unified top-N entry point (metric ∈ {degree, closeness, betweenness, eigenvector, influence})
chainlesschain social graph top <metric> [--directed] [-l 10]

# Roll-up: nodeCount / edgeCount / density / top-5 influence
chainlesschain social graph analytics-stats
```

**Scope / 未移植**: Sentiment analysis, the 3-style AI Social Assistant, ActivityPub WebFinger lookups, and ActivityPub content sync remain Desktop-only (they require LLM calls or outbound federation I/O). The CLI port covers the deterministic numeric surface: 4 centralities (degree/closeness/betweenness/eigenvector), composite influence scoring, label-propagation community detection with modularity, unweighted shortest path, and a unified top-N ranker. Power iteration uses a shift-by-I trick to break bipartite oscillation (e.g. star graphs).
