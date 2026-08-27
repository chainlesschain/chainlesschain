# 106 Agent Kernel 设计

> 状态：Agent Platform `0.166.6@f2a249bf3d` 是完整门禁的生产推荐与 npm `latest`，已公开 Agent IPC 有界化｜范围：CLI Agent 执行内核及跨传输资源边界｜更新：2026-08-27

## 1. 定位

Agent Kernel 是 ChainlessChain 的单 Agent 执行内核：把一轮用户输入转换为模型流、工具调用、审批、持久事件和可验证终态。它不负责宿主通信协议，也不负责多 Agent DAG 调度。

三层职责必须分开：

| 层            | 负责                                                          | 不负责                 |
| ------------- | ------------------------------------------------------------- | ---------------------- |
| CC App Server | Thread/Turn/Item 产品协议、stdio、审批转发、rollout           | 自行执行模型或工具     |
| Agent Kernel  | 模型循环、工具、权限、沙箱、预算、中断、清理                  | 跨 Agent DAG authority |
| Graph Kernel  | GraphRun、Task/Attempt、lease/fence、Effect/Handoff/HumanTask | 替代单 Agent 工具循环  |

## 2. 设计目标

1. `agent`、`chat`、headless、stream、WebSocket、UI 与 App Server 复用同一运行策略和核心循环。
2. 所有工具执行都经过权限、工作区、能力与 Process Broker 边界。
3. 审批、问题、模型事件、工具结果与终态使用结构化事件，不依赖终端文本。
4. 预算、背压、中断和 cleanup 失败闭合，不能把未知结果写成成功。
5. provider/model 差异收敛在 adapter，不污染上层生命周期。

非目标：公开一个独立 daemon、提供公网 RPC、替代 App Server 协议、或把所有 Team/Cowork 工作负载迁入 Graph Kernel。

## 3. 总体架构

```text
CLI / SDK / WS / UI / App Server
              │
              ▼
      AgentRuntimeFactory
              │ kind + policy
              ▼
         AgentRuntime
              │
      ┌───────┴────────┐
      ▼                ▼
headless-runner   headless-stream
      └───────┬────────┘
              ▼
          agent-core
 model adapter · tool loop · approvals
              │
 ┌────────────┼──────────────┐
 ▼            ▼              ▼
Permission  Process Broker  Session/Event Store
Sandbox     MCP/Hooks/PTY    Budget/Receipt
```

`runtime-factory.js` 根据入口生成 `agent`、`chat`、`server`、`ui` 四类 runtime policy。`AgentRuntime` 负责装配；`headless-runner` 提供单次执行，`headless-stream` 提供长连接双工事件；`agent-core` 负责模型与工具循环。

## 4. 入口与策略

| 入口                         | Kernel 路径                               | 主要特性                         |
| ---------------------------- | ----------------------------------------- | -------------------------------- |
| `cc agent` / `cc chat`       | `AgentRuntime.startAgentSession()`        | TTY、slash command、交互审批     |
| `cc exec -p` / `cc agent -p` | headless runner                           | 单次、结构化输出、CI 退出码      |
| Agent SDK `AgentSession`     | headless stream                           | NDJSON 双工、恢复、审批/问题事件 |
| `cc serve`                   | server runtime + WS gateway               | 既有浏览器/IDE 会话              |
| `cc serve --app-server`      | `CliAgentKernelAdapter` + headless stream | Thread/Turn/Item 产品协议        |
| `cc serve --app-server --app-server-websocket` | 同一 adapter + 实验 WS transport | 固定协议、强鉴权、逐连接隔离与慢消费者断路 |

入口只能收紧策略。Server/UI/App Server 不得用宿主参数绕过 Kernel 的工作区、权限、sandbox 或 SecretStore authority。

## 5. 一轮执行状态

```text
admit input
  → bind session/turn/workspace/policy
  → call model
  → emit deltas / tool request
  → permission + capability + sandbox admission
  → execute tool and persist result/receipt
  → continue model loop
  → result | budget exhausted | interrupted | error
  → bounded cleanup
```

终态必须来自实际运行结果。中断只有在模型流、工具进程和相关 cleanup 完成物理结算后才可报告 settled；输出背压、预算不明或外部副作用结果未知时必须保留错误或 reconciliation 语义。

## 6. 工具执行边界

工具调用至少绑定：session/turn、可信 cwd、permission mode、sandbox policy、工具 capability、参数摘要和结果状态。文件读写必须经过 workspace path guard；Shell、PTY、插件 bin、MCP、Hook 与后台任务不能通过 `shell: true` 或未钉住路径逃逸中央执行边界。

写入类工具还使用 freshness/hash/lineage 或幂等证据，避免模型根据过期内容覆盖新文件。高风险 Git、网络、凭据与远端 Shell 必须走对应审批或显式能力门。

## 7. 权限与沙箱

Kernel 支持 `default`、`manual`、`dontAsk`、`plan` 等权限模式，但具体入口可以限制允许集合。App Server adapter 默认启用 sandbox、禁用隐式网络，并要求平台能证明边界；不可用时 fail closed。

审批请求必须携带 operation、risk/reason、cwd、session/turn/item binding、策略/工作区摘要、nonce 与 expiry。宿主不响应、响应超时或 handler 抛错时不得自动批准。

## 8. 预算与资源治理

- Iteration budget 限制单轮模型/工具循环。
- Session budget 统一管理 turn、token、USD、tool time 与 wall time，并持久记录未知 usage。
- Cost budget 在 provider usage 可验证时累计；未知用量不能当成零。
- Host resource budget 对事件、缓存和队列先 admission，再执行工作。
- 输出 gate 默认最多排队 1 MiB，等待 drain 最长 30 秒；溢出或超时形成稳定失败。

这些上限是安全护栏，不是吞吐 SLO。入口可以在不扩大安全边界的前提下配置更严格的预算。

## 9. 事件与恢复

stream 模式使用 Agent Protocol v1 事件表达 init、内容增量、tool use/result、approval/question、plan、usage、compaction 与 result。未知事件透传，旧客户端不应崩溃。

会话恢复必须复用权威 session ID 和持久记录。response loss 后先查询 receipt/checkpoint/terminal evidence，再决定是否重试；Kernel 不承诺回滚已经提交到外部系统的副作用。

## 10. 背压、中断与清理

输出流遵守原生 `Writable.write(false)`，后续 chunk 进入有界队列并在事件边界等待 drain。队列超过 1 MiB、30 秒未 drain、EPIPE 或 stream error 都终止对应运行，不能降级为“部分成功”。

cleanup 使用有界 deadline 回收 MCP、后台 Shell、远程审批、交互与 Hook。主错误优先保留；若正常路径 cleanup 超时，则返回 cleanup failure 并携带 report。

CLI `0.166.6` 把这一原则扩到 Agent IPC：注册中与运行中的 child 共用 64-agent admission；pending interaction 默认全局 128 / 每 agent 16，agent request 默认全局 256 / 每 agent 32；stdout JSONL 与 stdin frame 各 1 MiB，stderr chunk 64 KiB，stdin 队列 128 条 / 4 MiB。初始化、心跳、交互和请求都受上限与 timeout 约束，过载返回结构化 `OVERLOADED` 和重试建议，并确定性清理受影响 child。

同一轮普查还覆盖旧 WS Gateway、Desktop MCP stdio/HTTP-SSE、Cowork message history、浏览器控制、P2P command/sync、媒体流、权限弹窗与 U-Key 合同签名。各路径现在先做数量/字节 admission，再启动副作用；超限不会通过无界 Promise、Map、数组或 socket buffer 吸收。CLI `0.166.6` 已进入 npm，但这不代表所有模块已迁入 canonical Agent Kernel，也不代表它完成了精确提交发布门。

## 11. App Server 适配

`CliAgentKernelAdapter` 为每个 App Server Thread 维护一个 headless stream session，同一 Thread 同时只允许一个 active Turn。它把 Agent Protocol 事件映射为 App Server Item/Tool/Approval 事件，把结构化审批决定再写回 Kernel 输入流。

adapter 只是协议桥，不复制模型循环、权限判断或工具实现。Thread fork、rollout 和宿主 request queue 仍由 App Server 层负责。

## 12. 与 Graph Kernel 的关系

Graph Kernel 可以把某个 Task/Attempt 派发给 Agent Kernel 执行，但 Task lease/fence、跨 Agent Message、Handoff、HumanTask、Effect receipt 与 GraphRun 终态仍归 Graph authority。Agent Kernel 返回的“成功”必须由 Graph Kernel 结合 attempt identity 与 evidence 接纳，不能直接改写 GraphRun。

## 13. 安全不变量

1. 不可信 cwd、workspace metadata 或模型文本不能扩大本机权限。
2. 未证明的 sandbox 不静默降级。
3. plan 模式不能通过间接工具、插件或 MCP 写入逃逸。
4. 凭据通过 SecretStore/注入边界使用，不进入 prompt、事件正文或公开日志。
5. 输出阻塞、中断超时、预算未知和外部副作用未知都不能伪装成功。
6. 子进程必须按 POSIX process group 或 Windows process tree 结算。

## 14. 性能与容量

当前公开硬边界包括 1 MiB Kernel 输出等待队列和 30 秒 drain deadline。模型首 token、工具耗时与总 wall time 受 provider、项目、sandbox engine 和工具类型影响，不发布统一毫秒 SLO。

性能验收应记录 cold start、首事件时间、turn wall time、tool P50/P95、backpressure 次数/峰值排队字节、token/USD、RSS、cleanup duration 和未结算副作用数，并绑定 OS、Node、provider/model 与 commit。

## 15. 测试与发布门

源码静态清单中，`agent-core*`、`agent-runtime`、`agent-sandbox`、`headless-runner*`、`headless-stream*`、output/host/iteration/session budget 与 runtime factory 共 83 个聚焦测试文件、1,119 个 `it/test` 用例。覆盖工具权限、路径、写入 freshness、MCP、Hooks、后台 Shell、流恢复、审批、问题、图片、计划模式、预算、用量归因、背压与中断。

发行授权以 exact SHA 的 Linux、Windows、macOS CLI CI 与 Strict Sandbox 为准；静态用例数量和本地运行不能替代矩阵。App Server/Graph 的专项测试与真实 provider journey 分别记录。

## 16. 关键文件

| 文件                                                          | 职责                             |
| ------------------------------------------------------------- | -------------------------------- |
| `packages/cli/src/runtime/runtime-factory.js`                 | 入口到 runtime policy 的统一工厂 |
| `packages/cli/src/runtime/agent-runtime.js`                   | runtime 装配与生命周期           |
| `packages/cli/src/runtime/agent-core.js`                      | 模型/工具主循环                  |
| `packages/cli/src/runtime/headless-runner.js`                 | 单次 headless 执行               |
| `packages/cli/src/runtime/headless-stream.js`                 | 双工流式会话                     |
| `packages/cli/src/runtime/output-backpressure.js`             | 有界输出与 drain deadline        |
| `packages/cli/src/runtime/cleanup-deadline.js`                | 有界 cleanup 与报告              |
| `packages/cli/src/runtime/policies/agent-policy.js`           | agent/server/ui policy           |
| `packages/cli/src/lib/agent-sandbox.js`                       | sandbox 解析与能力验证           |
| `packages/cli/src/lib/app-server/cli-agent-kernel-adapter.js` | App Server 适配                  |

## 17. 迁移与边界

Agent Kernel 自 `0.166.0` 进入 npm CLI 的公开发行面，但它不是独立 npm 包或远程服务。`0.166.5` 引入的 Desktop/VS Code App Server pilot 只开放固定能力且默认关闭，不表示全量迁移；Team/Cowork 是否由 Graph Kernel authoritative 调度，以及 signed native 是否公开，仍需各自证据，不能由 Kernel 单元测试推导。`0.166.6` Agent IPC/backlog 有界化已在 `f2a249bf3d` 完成精确发布闭环。

## 18. 相关文档

- [103 Agent SDK 平台化方案](./103_Agent_SDK平台化方案.md)
- [104 CC App Server 设计](./104_CC_App_Server设计.md)
- [105 Graph Kernel 设计](./105_Graph_Kernel设计.md)
- [108 Context/Memory Kernel 设计](./108_Context_Memory_Kernel设计.md)
- [CLI Runtime 当前实现](../cli-runtime-current.md)
