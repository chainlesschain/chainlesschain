# 103. Agent 平台化方案：协议、App Server 与 Graph Kernel

> 状态：核心首次随 Agent Platform `0.166.0` 与 TypeScript/Python Agent SDK `0.2.0` 发布；完整门禁的生产推荐 CLI 为 `0.166.5`，npm `latest` 为 `0.166.6`，Agent SDK 为 `0.2.4`、Agent Protocol 为 `0.1.5`（2026-08-27）。37 类 canonical stream event 的 payload union、跨端 causal conformance、Desktop/VS Code 固定能力 pilot 与 App Server 实验 WebSocket已闭环；`0.166.6` 有界 Agent IPC 已公开，但精确提交门禁未闭环。

## 1. 目标

把 `cc agent` 的流式会话从“多个客户端分别拼参数和解析事件”升级为一套可生成、可协商、可恢复、可审计的平台契约：

1. 以一个版本化 JSON Schema 生成 TypeScript、Python、Kotlin 与 Swift 协议绑定；
2. 通过 CC App Server 为 IDE、桌面端和自动化宿主提供统一 Thread / Turn / Item / Approval 生命周期；
3. 以 canonical Graph Kernel 统一确定性 Task DAG、动态 Agent、Artifact、Message、Effect 与 HumanTask 的状态和证据；
4. 保留 `cc agent` / Agent SDK 轻量入口，不强迫所有消费者立即迁移到 App Server。

## 2. 发布组成

| 组件                                   | 发布状态     | 角色                                                                           |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------------ |
| `chainlesschain@0.166.5`               | npm `latest` | Team/Session、结构化审批、payload union、App/Graph Kernel、实验 App Server WS 与 `cc exec` |
| `@chainlesschain/agent-sdk@0.2.4`      | npm 公开     | `AgentSession`、`AppServerClient`、固定能力 `AppServerPilotClient`、严格 canonical event validator |
| `chainlesschain-agent-sdk==0.2.4`      | PyPI 公开    | Python ≥ 3.10 异步客户端、结构化审批、生成 payload union 与 validator          |
| `@chainlesschain/agent-protocol@0.1.5` | npm 公开     | canonical Schema、37-event payload union、causal fixtures、v1 baseline 与四语言 codegen |

上述协调发布绑定最终候选 `2f5b0f263a`；Protocol/Python 包源码与其更早的发布提交逐字节一致。三平台门禁、OIDC/Trusted Publishing、provenance、公网安装回读，以及 App Server 1,800 秒 overload/RSS soak 均已闭环。后续 CLI `0.166.6@7f18511fbc` 已进入 npm，但它自己的 CLI CI/Strict 门未闭环，不能改写这组发布证据。

## 3. 总体架构

```text
VS Code / JetBrains / Desktop / CI / custom host
        │                         │
        │ stream-json             │ stdio JSON-RPC
        ▼                         ▼
 AgentSession                 AppServerClient
        │                         │
        └──────── @chainlesschain/agent-sdk 0.2.4 ────────┐
                                                          │ generated types
packages/agent-protocol                                   │
  schema/cc-agent-protocol.schema.json                    │
  schema/baselines/v1.json                                │
  scripts/generate.mjs ──► TS / Python / Kotlin / Swift ──┘
                               │
                               ▼
                    CC App Server (`cc serve --app-server`)
                     ├─ initialize / capability negotiation
                     ├─ thread start / read / resume / fork
                     ├─ turn start / interrupt
                     ├─ item + approval notifications
                     ├─ bounded request/output queues
                     └─ JSONL rollout + capability-gated SQLite
                               │
                               ▼
                         Agent Kernel adapters
                               │
                               ▼
                         canonical Graph Kernel
                     ├─ typed/versioned Graph IR
                     ├─ durable event store + checkpoints
                     ├─ lease/fence/attempt scheduling
                     ├─ message + custody handoff
                     ├─ Effect/receipt/reconcile
                     ├─ HumanTask/quorum/SoD
                     └─ trace reducer / time travel / eval
```

## 4. Canonical Agent Protocol

协议所有权、版本身份、生成器不变量、兼容基线、跨语言 conformance 与发布流程已拆分到独立的 [107 单一协议 Schema 与自动代码生成](./107_单一协议Schema与自动代码生成.md)。本节只保留 Agent Platform 总体架构所需的摘要，避免 SDK、App Server 与各客户端分别维护协议规则。

Schema 位于 `packages/agent-protocol/schema/cc-agent-protocol.schema.json`，冻结的 v1 基线位于 `schema/baselines/v1.json`。生成器必须保持确定性；任何不兼容改动都要先通过 baseline 检查，不能由某个客户端单独扩写协议。

当前生成目标：

- TypeScript：`packages/agent-sdk/src/generated/app-protocol.ts`
- Python：`packages/agent-sdk-python/src/chainlesschain_agent_sdk/generated_app_protocol.py`
- Kotlin：`packages/agent-protocol/generated/kotlin/CcAgentProtocol.kt`
- Swift：`packages/agent-protocol/generated/swift/CcAgentProtocol.swift`

兼容规则：允许新增可选字段和客户端未知通知；禁止静默改变已发布字段类型、必填性、枚举语义或生命周期顺序。宿主必须保留未知事件的原始值，避免新 CLI 事件让旧客户端中断事件泵。

## 5. CC App Server

`cc serve --app-server` 默认通过 stdio 启动 JSON-RPC 服务。`--app-server-state-dir <path>` 指定 owner-controlled rollout 目录，`--app-server-queue-cap <n>` 控制服务端请求队列，默认 256。`--app-server-websocket` 可显式切到实验网络传输；它与旧 `cc serve` WebSocket Gateway 仍是不同协议面，不能混用客户端。

`AppServerClient` 负责：

- 启动并完成 `initialize` 能力协商；
- 对请求数、单行长度与超时做本地上限；
- 把通知映射为类型化事件；
- 对未配置 handler 的服务端审批请求默认拒绝；
- 在过载时返回稳定错误 `-32001`，而不是让队列无界增长。

Rollout 存储默认使用带 hash chain 的 JSONL；SQLite 只有在当前 Node 运行时能力满足时才启用，不能因可选能力缺失破坏默认启动。Thread fork 使用独立身份，避免父线程和分支误写到同一 rollout。

产品 pilot 使用 `AppServerPilotClient` 的固定 capability surface，只开放 `thread/start|resume|fork|read|list|archive` 与 `turn/start|interrupt`。VS Code 通过默认关闭的 `chainlesschain.appServer.pilot.enabled` 启用；Desktop 通过 `CHAINLESSCHAIN_CC_APP_SERVER_PILOT=1` 启用并经 Process Broker 启动。两者都不向 renderer/Webview 暴露 generic `request()`，未接入已评审审批 UI 时服务端审批请求失败闭合。

实验 WebSocket 固定路径 `/app-server` 与子协议 `chainlesschain.app-server.experimental.v1`。所有绑定要求至少 32 字节 token；非 loopback 还要求 `--allow-remote`、成对 TLS 证书/私钥与 TLS 1.2+。每连接独立持有 `CcAppServer`，连接数、单帧 payload、receive、服务请求、输出队列、底层 buffer 和清理 deadline 均有界，慢消费者以 1013 断路。

## 6. Graph Kernel

Graph Kernel 把执行和观测分成两层：运行时负责 Graph IR、调度、消息、Effect、HumanTask 与恢复；只读投影通过 `cc team graph` 暴露：

```bash
cc team graph inspect <run-id>
cc team graph inspect <run-id> --at-seq 120
cc team graph inspect <run-id> --blocked-root task-7
cc team graph diff <run-id> --from-seq 80 --to-seq 120
cc team graph eval <run-id> --thresholds '{"deadlocked":{"max":0}}'
```

默认事件目录为 `CHAINLESSCHAIN_HOME` 下的 `graph-runs`；也可用 `--state-dir` 指向隔离目录。投影默认隐藏 Message 与 HumanTask 内容，只有显式 `--include-content` 才输出，避免诊断命令无意扩散敏感上下文。

关键不变量：

- Graph definition 必须先编译并验证引用、环、端口、能力、预算、write scope 与循环边界，之后才允许 Effect；
- AssignmentAttempt、agent capacity、lease 与 fence 共同决定谁可以结算节点；
- Message 采用 at-least-once + 幂等消费，不宣称 exactly-once；
- Effect 在副作用前落账，未知结果进入 reconcile，取消后的迟到结果不能越过 fence；
- trace reducer 只从 append-only 事件生成投影，time travel 与 diff 不改写权威状态。

## 7. 安全边界

- App Server 默认使用 stdio；实验 WebSocket 固定 `/app-server` 与 `chainlesschain.app-server.experimental.v1` 子协议，所有绑定要求至少 32 字节 token，非 loopback 还要求 `--allow-remote` 与 TLS cert/key。它不是公网托管服务，也不与旧 `cc serve` Gateway 共用协议。
- 所有客户端审批默认失败闭合；没有 handler、超时、binding 不匹配或 handler 抛错都不能授权工具。
- Webhook 入口绑定 HMAC、时间窗、delivery replay、body cap 与 rate limit；可信来源由适配器赋值，不能相信请求体自报。
- Graph 的 `origin`、`trust`、`sensitivity` 与 `allowedSinks` 随 DataRef/ArtifactRef 传播，declassification 必须显式审计。
- `cc exec` 只是现有 governed Agent 入口的 facade，不建立第二套权限或工具执行权威。

## 8. 发布验证

精确提交 `40354eb432281c28ed266f2dc6d1458764eb536d` 已通过：

- Linux、Windows、macOS 的 CLI CI；
- Linux、Windows、macOS 的 CLI Strict Sandbox；
- Python 3.10、3.12、3.13 SDK conformance；
- npm CLI/TypeScript SDK Trusted Publishing、provenance 与公网回读；
- PyPI wheel/sdist 发布与独立安装 smoke。

仓库内定向覆盖包括协议 codegen/兼容性、App Server/rollout、Graph compiler/runtime/trace/eval/adapters、Codex adapter、Record & Replay 与 Webhook security。

## 9. 尚未关闭的迁移

- Desktop、IDE、CLI Team、Cowork 与 Scheduler 仍需完成 shadow-run/diff、回滚演练和 authoritative writer 切换；
- Graph loop/subgraph 的完整生产语义、逆依赖补偿与全部 durable cut-point 故障矩阵仍需补齐；
- 真实 child Agent 的 message ACK/handoff 长时恢复与 30 分钟 overload/fairness soak 尚未闭环；
- `graph-agent-real-journey.yml` 仍需真实 provider secret 下的 Linux/Windows/macOS 聚合全绿；
- Desktop/IDE 的 Graph topology、timeline 与 HumanTask 交互界面仍未接入；
- Agent Protocol 公开版必须绑定 npm 回读与不可变发布标签；仓库清单中的后续源码候选不得写成已经公开发布。

## 10. 关键文件

| 路径                                             | 说明                                          |
| ------------------------------------------------ | --------------------------------------------- |
| `packages/agent-protocol/`                       | Schema、baseline、codegen 与跨语言兼容性测试  |
| `packages/agent-sdk/src/app-server-client.ts`    | TypeScript 有界 stdio 客户端                  |
| `packages/cli/src/lib/app-server/`               | CC App Server、transport 与 rollout store     |
| `packages/cli/src/lib/graph-kernel/`             | Graph compiler、runtime、event、trace 与 eval |
| `packages/cli/src/commands/serve.js`             | `--app-server` 入口                           |
| `packages/cli/src/commands/graph.js`             | `cc team graph inspect                        | diff | eval` |
| `.github/workflows/graph-agent-real-journey.yml` | 真实 provider 三平台旅程门                    |

## 11. 相关文档

- [Agent SDK 用户指南](../../../docs-site/docs/chainlesschain/agent-sdk.md)
- [CC App Server / WebSocket 服务](../../../docs-site/docs/chainlesschain/cli-serve.md)
- [GraphRun 观测与评估](../../../docs-site/docs/chainlesschain/cli-team-graph.md)
- [CLI Runtime 当前实现](../cli-runtime-current.md)
- [Agent Protocol](../../../packages/agent-sdk/docs/PROTOCOL.md)
- [107 单一协议 Schema 与自动代码生成](./107_单一协议Schema与自动代码生成.md)
