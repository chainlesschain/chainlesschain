# 104. CC App Server 设计

> 状态：stdio MVP 首次随 `chainlesschain@0.166.0` 发布；固定能力 Desktop/VS Code pilot 与实验 WebSocket 随 `chainlesschain@0.166.5` / Agent SDK `0.2.4` 完成发布闭环（2026-08-27）｜协议版本：v1｜默认传输：stdio｜网络传输：experimental

## 1. 定位

CC App Server 是 ChainlessChain 面向桌面端、IDE、CI 与自定义宿主的统一产品集成边界。它把原本散落在 CLI 参数、NDJSON 流和各端私有状态里的会话语义收敛为 Thread / Turn / Item / Approval 模型，并通过版本化 JSON-RPC 协议提供能力协商、恢复、分支、背压与确定性终态证据。

它不替代：

- `cc agent -p` / `cc exec` 的一次性自动化入口；
- Agent SDK `AgentSession` 的轻量 stream-json 会话；
- `cc serve` 原有 WebSocket Gateway；
- Graph Kernel 的任务图运行时。

App Server 负责把宿主接入 Agent Kernel，并把权威生命周期持久化；Graph Kernel 负责多 Agent 图执行。两者通过 adapter 协作，不合并成一个状态机。

## 2. 目标与非目标

### 2.1 目标

- 用单一协议描述 initialize、Thread、Turn、Item、Tool、Approval 与终态；
- 允许宿主在进程重启后 read/resume/fork，不依赖内存中的客户端对象；
- 输入、输出、服务端请求和客户端 pending request 全部有界；
- 未初始化、过载、冲突、超时和未知结果使用稳定错误码；
- 复用真实 CLI Agent loop、权限门、沙箱与工具执行权威；
- 从 canonical Schema 生成 TypeScript、Python、Kotlin 与 Swift 类型。

### 2.2 非目标

- WebSocket 仍是 experimental，不升级为默认传输或公网托管服务；
- 不承诺外部副作用 exactly-once；
- 不允许 App Server 绕过 CLI 的审批、预算、sandbox 或 egress policy；
- 不声称 Desktop/IDE 已经全部迁移；
- 不把 npm 包已公开误写成 renderer/Webview 可以绕过宿主直接调用的通用 RPC 权限。

## 3. 分层架构

```text
Host application
  └─ @chainlesschain/agent-sdk AppServerClient / AppServerPilotClient
       ├─ bounded pending requests
       ├─ generated protocol validation
       └─ approval/decide handler (default decline)
             │
             ├─ stdio · one JSON-RPC object per line
             │    └─ 1 MiB line cap + bounded output queue
             └─ experimental WebSocket
                  └─ /app-server + fixed subprotocol + token/TLS + slow-consumer breaker
             ▼
       CcAppServer
       ├─ initialize + feature negotiation
       ├─ request idempotency cache
       ├─ Thread / Turn state machines
       ├─ Item / Tool / Approval notifications
       └─ interrupt physical-settlement gate
          │                         │
          ▼                         ▼
 CliAgentKernelAdapter        RolloutStore
 (real agent loop)            JSONL / capability-gated SQLite
```

## 4. 启动与传输

默认稳定入口：

```bash
cc serve --app-server \
  --app-server-state-dir <private-directory> \
  --app-server-queue-cap 256 \
  --project <workspace>
```

不带 `--app-server-websocket` 时，`--app-server` 不监听端口：stdin 接收 UTF-8 JSONL，stdout 只输出 JSON-RPC，stderr 只承载诊断信息。它不会启动旧 WebSocket Gateway。

实验 WebSocket 入口：

```bash
CHAINLESSCHAIN_APP_SERVER_TOKEN=<至少32字节随机值> \
cc serve --app-server --app-server-websocket \
  --host 127.0.0.1 --port 18800 \
  --app-server-state-dir <private-directory>
```

固定路径为 `/app-server`，固定子协议为 `chainlesschain.app-server.experimental.v1`。所有绑定均要求至少 32 字节 token；URL query token 不被采信。非 loopback 还必须同时提供 `--allow-remote`、`--app-server-tls-cert` 与 `--app-server-tls-key`。TLS 文件必须是 ≤1 MiB 的非符号链接普通文件；POSIX 私钥不得对 group/other 开放，证书与私钥需匹配并支持 TLS 1.2+。

Transport 默认约束：

| 约束             |         默认值 | 行为                                     |
| ---------------- | -------------: | ---------------------------------------- |
| 输入单行         |          1 MiB | 超限返回 `-32600`，不解析、不执行        |
| 输出队列         | 512 条 / 8 MiB | 超限终止 transport，防止慢消费者拖垮进程 |
| Server 请求队列  | 256 条 / 4 MiB | 返回 `-32001` 与 `retry_after_ms`        |
| SDK pending 请求 |            256 | 客户端本地返回 `-32001`                  |
| SDK 请求超时     |         120 秒 | 返回 `-32010`，不把超时解释为成功        |

WebSocket 额外默认约束：单帧 1 MiB、每连接输出 256 条 / 4 MiB、底层 buffered 2 MiB、慢消费者 5 秒、待处理 receive 512、连接清理 10 秒。输入过载返回 `-32001` 与 `retry_after_ms`；输出过载或慢消费者使用 1013 关闭连接。正式 1,800 秒 soak 共回收 2,427,887 个请求，意外错误和遗留请求均为 0，warm-up 后 RSS 增长 0.762%，低于 10% 门槛。

## 4.1 Desktop / VS Code 固定能力 pilot

`AppServerPilotClient` 刻意不暴露 generic `request()`，只提供：

- `thread/start|resume|fork|read|list|archive`
- `turn/start|interrupt`

VS Code pilot 默认关闭，通过 `chainlesschain.appServer.pilot.enabled` 开启；Desktop 通过 `CHAINLESSCHAIN_CC_APP_SERVER_PILOT=1` 开启。Desktop preload 只暴露固定 lifecycle/Thread/Turn IPC，单次参数必须是普通 JSON object 且不超过 256 KiB，子进程强制经过 Desktop Process Broker。两端在接入已评审审批 UI 前都对服务端审批请求返回 canonical decline。

## 5. 协议协商

第一条有效请求必须是 `initialize`：

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "minimumProtocolVersion": 1,
    "client": { "name": "example-host", "version": "1.0.0" },
    "features": ["thread_turn_item", "structured_approval"]
  }
}
```

Server 选择双方版本区间的最高交集，只返回双方都支持的 feature，并用 `downgraded` 指示降级。版本区间无交集时返回 `-32602`；initialize 前的其他请求返回 `-32002`；同一连接重复 initialize 返回 `-32009`。

v1 feature：`thread_turn_item`、`structured_approval`、`typed_graph`、`causal_messages`、`durable_human_task`、`bounded_transport`、`graph_effect_receipts`、`deterministic_trace`。

## 6. 请求、通知与服务端请求

### 6.1 客户端请求

| Method           | 作用                   | 关键约束                                         |
| ---------------- | ---------------------- | ------------------------------------------------ |
| `thread/start`   | 新建线程               | 可声明 `threadId`、title、metadata、agentOptions |
| `thread/read`    | 只读线程和事件         | 支持 `afterEventSeq` 与有界 `limit`              |
| `thread/resume`  | 恢复线程并返回增量事件 | archived 线程不可开始新 Turn                     |
| `thread/fork`    | 从既有线程分支         | 新线程必须有独立身份；支持 idempotency key       |
| `thread/list`    | 列出线程               | archived 默认隐藏                                |
| `thread/archive` | 归档线程               | 活跃 Turn 存在时拒绝                             |
| `turn/start`     | 提交文本输入并异步执行 | 同一 Thread 同时只允许一个 active Turn           |
| `turn/interrupt` | 请求中断并等待物理结算 | 未物理停止时返回 `-32010`，不能冒充已取消        |

### 6.2 Server 通知

生命周期通知包括 `thread/updated`、`turn/started`、`turn/completed`、`item/started`、`item/delta`、`item/completed`、`tool/requested`、`tool/result`、`approval/requested` 与 `approval/resolved`。

通知同时写入 rollout；终态通知只有在 terminal event 与 evidence 已落账后才发送。客户端断线后可以用 `thread/read` 或 `thread/resume` 从 `afterEventSeq` 补读，而不是相信内存中最后一帧。

### 6.3 服务端请求

工具需要审批时，Server 向客户端发送 `approval/decide` 请求。binding 包含 thread、turn、item、operation digest、policy digest、workspace digest、nonce 与 expiry。客户端只能返回：

- `acceptOnce`
- `acceptForTurn`
- `acceptForSession`
- `decline`
- `cancel`

缺少 handler、handler 抛错、响应超时、binding 过期或 decision 非法均失败闭合。

## 7. 状态机

### 7.1 Thread

```text
active ── archive ──► archived
   │
   ├─ resume/read ──► active projection
   └─ fork ─────────► new active thread (independent identity)
```

### 7.2 Turn

```text
queued → running ⇄ waiting_approval
             │
             ├─ completed
             ├─ failed
             └─ interrupted
```

终态不可逆。`turn/interrupt` 只在 Agent Kernel 真正停止后返回 `physicallySettled: true`；超时返回可重试错误，不提前写“已取消”。

## 8. Rollout 与恢复

默认 `JsonlRolloutStore` 为每个 Thread 保存 append-only 事件，事件包含单调序号、前序 hash、当前 hash、时间、trace/parent/idempotency 标识与 payload。它支持：

- start / append / read / list；
- checkpoint；
- compact（summary 必填）；
- resume / fork / archive；
- migration 与 terminal evidence。

SQLite store 使用 `node:sqlite`，只有运行时能力存在时才能选择；能力缺失时默认 JSONL 仍须可启动。存储切换不得改变协议层 Thread/Turn/Item 语义。

## 9. 幂等、恢复与未知结果

- 带 `idempotencyKey` 的完成请求进入有界结果缓存，重试返回同一逻辑结果；
- fork 的 source thread 与 destination thread 分离，分支不能复用父线程存储身份；
- Item/Tool/Approval 通知使用稳定幂等键，重放不能重复结算工具；
- 断线、客户端超时或 response loss 不代表请求未执行，宿主必须 read/resume 后对账；
- 外部副作用使用 Effect/receipt/reconcile 语义，不能以 JSON-RPC 返回丢失为由盲目重放。

## 10. 错误模型

|     Code | 名称             | 典型含义                               |
| -------: | ---------------- | -------------------------------------- |
| `-32700` | Parse error      | 非法 JSON                              |
| `-32600` | Invalid request  | envelope/line 大小不合法               |
| `-32601` | Method not found | 未知 method                            |
| `-32602` | Invalid params   | 参数或协议区间不合法                   |
| `-32603` | Internal error   | 对外隐藏内部细节                       |
| `-32001` | Overloaded       | 队列已满，读取 `retry_after_ms`        |
| `-32002` | Not initialized  | 未先 initialize                        |
| `-32004` | Not found        | Thread/Turn 不存在                     |
| `-32009` | Conflict         | active Turn、重复 initialize、归档冲突 |
| `-32010` | Interrupted      | 请求超时或中断尚未物理结算             |

## 11. 安全设计

- v1 仅 stdio，避免在尚无 TLS/auth 设计时暴露网络监听；
- state directory 由宿主显式控制，必须使用当前用户私有权限；
- stdout 只输出协议，日志和模型诊断必须走 stderr；
- Schema validator 在 dispatch 前拒绝非法 envelope；
- approval binding 与工作区、策略和操作摘要绑定，客户端显示的信息必须来自该 binding；
- App Server 复用 CLI Process Broker、sandbox、SecretStore、MCP egress 与审计策略；
- response/error message 有长度上限，内部异常统一映射，不回显秘密或堆栈。

## 12. 迁移计划

1. 自定义宿主先通过 `AppServerClient` 试点，不直接手写 transport；
2. IDE/Desktop 以 feature flag 双读 App Server 与现有会话投影；
3. 对 frozen fixture 做事件、终态、Artifact 与审批 shadow diff；
4. 以已完成的 30 分钟 overload/RSS 门为容量基线，继续补断线恢复、crash cut-point 与回滚演练；
5. 每个产品单独切换 writer，旧路径清零后才宣称 authoritative；
6. 网络传输如需加入，另立协议与威胁模型，不复用旧 WS 的安全假设。

## 13. 验证与未决边界

已完成：协议 codegen/兼容性、App Server lifecycle、rollout hash chain/恢复/分支、客户端 bounded pending、队列过载、Codex adapter、实验 WebSocket、Desktop/VS Code 固定能力 pilot、三平台 CLI/Strict 发布矩阵，以及 `0.166.5@2f5b0f263a` 的 1,800.21 秒 overload/RSS soak（2,427,887 requests、0 unexpected、0 drain leftovers、RSS +0.762%）。

未完成：Desktop/IDE 全量迁移、WebSocket 稳定化、真实 provider 三平台 Graph Agent journey、全产品 crash/recovery conformance 与签名 native 发行。实验网络入口和局部 pilot 不能冒充全量 cutover。

## 14. 关键文件

| 路径                                                           | 说明                             |
| -------------------------------------------------------------- | -------------------------------- |
| `packages/agent-protocol/schema/cc-agent-protocol.schema.json` | canonical v1 Schema              |
| `packages/cli/src/lib/app-server/protocol.js`                  | 协商、validator 与错误模型       |
| `packages/cli/src/lib/app-server/server.js`                    | Thread/Turn/Item/Approval 状态机 |
| `packages/cli/src/lib/app-server/stdio-transport.js`           | JSONL framing 与输出背压         |
| `packages/cli/src/lib/app-server/rollout-store.js`             | JSONL/SQLite rollout             |
| `packages/cli/src/lib/app-server/cli-agent-kernel-adapter.js`  | 真实 CLI Agent loop 适配器       |
| `packages/agent-sdk/src/app-server-client.ts`                  | TypeScript 宿主客户端            |

## 15. 相关文档

- [CC App Server 用户指南](../../../docs-site/docs/chainlesschain/cli-app-server.md)
- [Agent 平台化方案](./103_Agent_SDK平台化方案.md)
- [Agent SDK 用户指南](../../../docs-site/docs/chainlesschain/agent-sdk.md)
- [GraphRun 观测与评估](../../../docs-site/docs/chainlesschain/cli-team-graph.md)
