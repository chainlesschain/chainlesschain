# Agent Kernel 使用与运维指南

> 适用版本：生产推荐与 npm `latest` 均为 `chainlesschain@0.166.6`（精确发布 SHA `f2a249bf3d`）｜性质：CLI 内置执行内核，不是独立 daemon 或独立安装包｜适用对象：CLI 用户、SDK/App Server 集成方与运维人员

## 概述

Agent Kernel 是每次 ChainlessChain Agent 执行真正经过的运行内核。它负责模型流、工具循环、权限、工作区、沙箱、预算、持久事件、中断和资源清理。用户通常不会直接启动一个名为 “kernel” 的命令，而是通过 `cc agent`、`cc exec`、Agent SDK、WebSocket Gateway 或 CC App Server 使用它。

如果把 Agent Platform 看成三层：App Server 是产品接入层，Agent Kernel 是单 Agent 执行层，Graph Kernel 是多 Agent 图编排层。三者共用协议与证据，但不能互相代替。

## 核心特性

- **统一执行路径**：TTY、headless、stream、server、UI 与 App Server 复用 `AgentRuntime` 和 `agent-core`。
- **模型与工具循环**：流式处理模型输出，校验并执行工具，再把结构化结果送回模型直到终态。
- **权限与沙箱**：工具在 permission mode、可信 cwd、workspace path、capability 和 Process Broker 边界内执行。
- **耐久会话**：session ID、事件、checkpoint、receipt 和 usage 支持恢复与 response-loss 对账。
- **多维预算**：限制 turn、token、USD、tool time、wall time 与 host resource，未知 usage 不当成零。
- **有界背压**：输出队列、drain 等待和清理都有上限，慢消费者不会导致无限内存增长。
- **可验证中断**：只有模型流、工具进程和清理完成物理结算后才报告停止。
- **Provider 中立事件**：上层消费 Agent Protocol v1，不需要按 provider 解析私有 chunk。

## 系统架构

```text
cc agent / cc exec / SDK / WS / App Server
                    │
                    ▼
            AgentRuntimeFactory
                    ▼
               AgentRuntime
            ┌───────┴────────┐
            ▼                ▼
      headless-runner   headless-stream
            └───────┬────────┘
                    ▼
                agent-core
     model stream ⇄ tool loop ⇄ approvals
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
 permission      sandbox       session/event
 Process Broker  workspace     budget/receipt
```

`AgentRuntimeFactory` 为 agent/chat/server/ui 选择策略；`AgentRuntime` 装配依赖；runner 或 stream 管理入口生命周期；`agent-core` 只在所有 admission 通过后执行工具。

## 配置参考

最常用的 Kernel 配置从 CLI 参数或 Agent SDK options 进入：

| 配置           | 示例                             | 作用                                                                   |
| -------------- | -------------------------------- | ---------------------------------------------------------------------- |
| 工作区         | 进程 `cwd` / SDK `cwd`           | 绑定文件与命令 authority；额外目录用 `--add-dir` 显式加入              |
| 权限模式       | `--permission-mode default`      | `default` / `manual` / `dontAsk` / `plan`，入口可进一步限制            |
| 沙箱           | `--sandbox-mode workspace-write` | `off` / `workspace-write` / `strict`；容器沙箱另用 `--sandbox [image]` |
| Provider/Model | `--provider` / `--model`         | 覆盖当前会话模型适配器                                                 |
| 轮次预算       | `--max-turns <n>`                | 限制单轮模型/工具迭代                                                  |
| 成本预算       | `--max-budget-usd <n>`           | 可验证 usage 达到上限后停止                                            |
| 审批超时       | `CC_APPROVAL_TIMEOUT_MS`         | stream 交互审批等待，默认 120 秒                                       |
| 问题超时       | `CC_QUESTION_TIMEOUT_MS`         | 用户问题等待，默认 180 秒                                              |

具体命令支持的选项以 `cc <command> --help` 为准。App Server 默认强制 workspace-write sandbox、禁用隐式网络并在边界不可证明时拒绝启动；宿主参数不能扩大这个 ceiling。

## 使用示例

### 单次自动化

```bash
cd ./my-project
cc exec -p "检查登录模块，只修改必要文件并运行聚焦测试" \
  --sandbox-mode workspace-write \
  --max-turns 12 \
  --max-budget-usd 1.50
```

### 交互式 Agent

```bash
cd ./my-project
cc agent --permission-mode default
```

### TypeScript 流式宿主

```ts
import { AgentSession } from "@chainlesschain/agent-sdk";

const session = new AgentSession({
  cwd: process.cwd(),
  permissionMode: "default",
  sandbox: "workspace-write",
  maxTurns: 12,
});

for await (const event of session.run("运行测试并解释失败原因")) {
  if (event.type === "tool_use") console.log("tool", event.name);
  if (event.type === "result") console.log(event);
}
```

### 完整产品入口

```bash
cc serve --app-server --app-server-state-dir .cc-app-server-state
```

这仍复用 Agent Kernel；Thread/Turn/Item、审批转发和 rollout 由 App Server 管理。不要同时另起一个绕过权限/沙箱的自定义工具执行器。

需要试验网络传输时可额外启用 `--app-server-websocket`。它固定使用 `/app-server` 与 `chainlesschain.app-server.experimental.v1` 子协议；所有绑定都要求至少 32 字节 token，非 loopback 还要求显式 `--allow-remote` 与 TLS。该入口仍是 experimental，不替代默认 stdio。

## 性能指标

当前公开版明确的是容量护栏与运行观测字段，不发布脱离 provider/项目/OS 的统一延迟 SLO：

| 指标                          | 0.166.0 口径                 | 运维意义                                  |
| ----------------------------- | ---------------------------- | ----------------------------------------- |
| Kernel 输出等待队列           | 默认最多 1 MiB               | 慢 stdout/SDK 消费者的内存上限            |
| 输出 drain deadline           | 最长 30 秒                   | 超时返回 `CC_OUTPUT_BACKPRESSURE_TIMEOUT` |
| 模型请求 timeout              | 默认通常 30 秒，可按入口配置 | 区分 provider stall 与工具耗时            |
| approval timeout              | 默认 120 秒                  | 到期不自动批准                            |
| question timeout              | 默认 180 秒                  | 到期形成 `user_timeout`，不伪装用户回答   |
| iteration/session/cost budget | 按运行配置                   | 限制循环、token、USD、tool/wall time      |

生产基线建议采集 cold start、首事件时间、turn wall time、各工具 P50/P95、token/USD、backpressure 次数与峰值排队字节、RSS、cleanup duration 及未结算副作用数，并连同 Node、OS、provider/model、sandbox engine 和 commit 保存。

## 测试覆盖

0.166.0 源码静态清单中，与 Agent Kernel 直接相关的 83 个聚焦测试文件包含 1,119 个 `it/test` 用例。范围包括：

- `agent-core*`：模型流、工具 admission、权限规则、路径、写入 freshness/hash、Git、MCP、Hooks、后台 Shell、缓存与 usage；
- `headless-runner*`：单次执行、恢复角色、成本/会话预算、MCP ledger、OTLP、turn binding 与 cleanup；
- `headless-stream*`：审批、问题、中断、resume、图片、JSON Schema、计划模式、副作用与流式合并；
- `agent-runtime` / `runtime-factory` / `agent-sandbox`：入口策略与装配；
- `output-backpressure` / host/iteration/session budget：容量、超时和失败闭合。

测试数量来自上述聚焦文件的源码清单，不是全仓库测试总数。发布仍以 exact SHA 的 Linux、Windows、macOS CLI CI 与 Strict Sandbox 全矩阵为权威；真实 provider、App Server journey 与 Graph journey 另行验收。

## 安全考虑

- 始终在明确、可信且最小的工作区 `cwd` 中启动；只通过 `--add-dir` 增加必要目录。
- 不因“自动化方便”关闭 sandbox 或把 permission mode 放宽为无条件批准。
- plan 模式只用于计划，不应允许写入、Shell、插件或 MCP 间接产生副作用。
- 审批界面必须显示真实 operation、风险、cwd、绑定与过期时间；未知或超时默认拒绝。
- API key 进入 SecretStore 或受控环境注入，不写入 prompt、参数、rollout、日志或 Git。
- response loss 后先查 session/receipt/checkpoint；外部副作用结果未知时不要盲目重跑。
- 输出背压、budget unknown、cleanup timeout 和 interrupt unsettled 都应视为失败或待对账，而非成功。

## 故障排除

### Sandbox unavailable / denied

确认目标平台已安装并允许所选 sandbox engine，工作区真实存在且归当前用户控制。生产入口不会在无法证明边界时静默转为 unsandboxed；不要用关闭安全门作为常规修复。

### 工具提示 permission denied

核对 permission mode、工作区、工具 capability 和审批结果。`plan` 模式、远端 metadata、过期审批或 cwd 越界都会收紧权限。

### 输出停止并出现 backpressure 错误

宿主没有及时读取 stdout/SDK 事件。提高消费速度、减少渲染阻塞或降低生产并发；不要仅把队列无限调大。`EPIPE` 通常说明宿主提前关闭了管道。

### 中断后任务仍显示运行

等待 settled/terminal event，并检查工具子进程是否已按进程树回收。超时意味着状态未知，不能在 UI 中先写“已停止”；通过 session/App Server read/resume 对账。

### 已达到 max turns / cost budget

这是硬预算终止。查看 usage 与 budget reason，缩小任务或显式调整预算；usage 不可验证时先恢复账本，不要把未知消费当作零。

### 重启后无法恢复

确保使用相同的 `CHAINLESSCHAIN_HOME`、工作区和权威 session/thread ID。SDK 流会话与 App Server Thread 的恢复入口不同：前者使用 session resume，后者使用 `thread/resume`。

## 关键文件

| 文件                                                          | 作用                              |
| ------------------------------------------------------------- | --------------------------------- |
| `packages/cli/src/runtime/runtime-factory.js`                 | agent/chat/server/ui runtime 工厂 |
| `packages/cli/src/runtime/agent-runtime.js`                   | 运行时装配与入口生命周期          |
| `packages/cli/src/runtime/agent-core.js`                      | 模型与工具主循环                  |
| `packages/cli/src/runtime/headless-runner.js`                 | 单次 headless 执行                |
| `packages/cli/src/runtime/headless-stream.js`                 | 双工流式执行与交互                |
| `packages/cli/src/runtime/output-backpressure.js`             | 输出有界队列与 drain deadline     |
| `packages/cli/src/runtime/cleanup-deadline.js`                | 资源回收 deadline/report          |
| `packages/cli/src/runtime/policies/agent-policy.js`           | 各入口策略                        |
| `packages/cli/src/lib/agent-sandbox.js`                       | sandbox 解析、验证与 fail-closed  |
| `packages/cli/src/lib/app-server/cli-agent-kernel-adapter.js` | CC App Server 适配                |

## 当前边界

- Agent Kernel 首次随 `chainlesschain@0.166.0` 发布，当前公开稳定基线为 `0.166.6`；它不是独立 npm 包或公网服务。
- Desktop/VS Code 已有默认关闭、固定 Thread/Turn 方法的 App Server pilot，但并未因此自动全部迁移；审批 UI 未接入时仍拒绝。
- CLI `0.166.6` 为 Agent 数量、pending interaction/request、stdio frame/queue 和 timeout 增加全局及 per-agent 上限；精确发布 SHA `f2a249bf3d` 的三平台 CLI CI、Strict Sandbox 与独立 npm 制品/provenance 回读均已成功，可按完整门禁生产版承诺。
- Graph Kernel 发布不代表 Team/Cowork/Scheduler 都已完成 authoritative cutover。
- 本地测试不替代 exact-SHA 三平台发布门，npm 发布也不等于签名 native 已发行。

## 相关文档

- [CC App Server 使用指南](./cli-app-server.md)
- [Graph Kernel 使用与运维](./cli-graph-kernel.md)
- [GraphRun 观测与评估](./cli-team-graph.md)
- [Agent SDK](./agent-sdk.md)
- [Agent 模式](./cli-agent.md)
- [CLI Runtime 当前实现](./cli-runtime-current.md)
- [设计文档：Agent Kernel](/design/modules/106-agent-kernel)
- [设计文档：Agent 平台化](/design/modules/103-agent-sdk-platform)
