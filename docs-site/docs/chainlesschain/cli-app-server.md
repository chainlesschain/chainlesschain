# CC App Server 使用指南

> 适用版本：`chainlesschain@0.166.2`、`@chainlesschain/agent-sdk@0.2.1`、`@chainlesschain/agent-protocol@0.1.1`｜传输：stdio JSON-RPC v1｜适用对象：桌面端、IDE、CI 与自定义 Agent 宿主

## 概述

CC App Server 是完整产品集成入口。它在一个长期运行的 `cc` 子进程中提供：

- Thread 创建、读取、恢复、分支、列表与归档；
- Turn 启动与可验证中断；
- Item、Tool、Approval 的结构化事件；
- 带 hash chain 的持久 rollout；
- 协议版本与 feature 协商；
- 输入、输出和请求队列背压。

它与其他入口的选择关系：

| 需求                              | 推荐入口                                    |
| --------------------------------- | ------------------------------------------- |
| 单次脚本/CI 命令                  | `cc exec -p "..."` 或 `cc agent -p "..."`   |
| 轻量流式会话                      | Agent SDK `AgentSession`                    |
| 完整产品、持久线程、服务端审批    | Agent SDK `AppServerClient` + CC App Server |
| 浏览器 Web Panel / 既有 WS 客户端 | `cc serve` 或 `cc ui`                       |

## 核心特性

- **稳定的产品协议**：stdio JSON-RPC v1 通过 `initialize` 协商协议区间和 feature，不让宿主依赖 CLI 内部对象。
- **完整 Thread/Turn/Item 模型**：创建、恢复、分支、归档和增量读取使用同一组权威 ID 与事件序号。
- **结构化审批**：Server 以 `approval/decide` 请求宿主裁决；缺少处理器、未知请求或处理器异常时默认拒绝。
- **耐久恢复**：默认 JSONL rollout 带 hash chain，支持 checkpoint、compact、read/resume 和幂等 mutation 对账。
- **有界背压**：客户端 pending request、Server 请求队列、stdio 输出和单行 JSON 均有明确上限与稳定错误码。
- **可验证中断**：只有收到 `physicallySettled: true` 才能把 Turn 标记为已停止，晚到成功会被 fence。
- **SDK 优先**：TypeScript `AppServerClient` 负责进程启动、行缓冲、请求复用、通知和 Server request 回包。

## 系统架构

```text
桌面端 / IDE / CI / 自定义宿主
              │ AppServerClient
              ▼
      stdio JSON-RPC v1（NDJSON）
              │
┌─────────────▼──────────────────────────────┐
│ CC App Server                              │
│ initialize / bounded queue / request router│
├────────────────────────────────────────────┤
│ Thread / Turn / Item / Approval state      │
├───────────────────┬────────────────────────┤
│ CLI Agent Kernel  │ Rollout Store          │
│ 权限/沙箱/工具执行 │ JSONL hash chain       │
│                   │ 可选 SQLite capability │
└───────────────────┴────────────────────────┘
```

stdout 只承载协议帧，诊断写入 stderr。App Server 复用 CLI Agent Kernel 的权限、沙箱和 SecretStore；宿主负责 UI、审批交互、断线后的事件消费位置以及进程生命周期。

## 安装

```bash
npm install --global "chainlesschain@0.166.2"
npm install "@chainlesschain/agent-sdk@0.2.1"

cc --version
```

`@chainlesschain/agent-sdk` 需要 Node.js ≥ 22.12.0。Python SDK `0.2.0` 携带生成的 App Server 协议类型，但当前公开的进程客户端 `AppServerClient` 位于 TypeScript 包。

## 使用示例

### 快速开始（推荐）

```ts
import { AppServerClient } from "@chainlesschain/agent-sdk";

const client = new AppServerClient({
  cwd: process.cwd(),
  stateDirectory: ".cc-app-server-state",
  maxPendingRequests: 128,
  requestTimeoutMs: 120_000,
  onServerRequest: async (request) => {
    if (request.method !== "approval/decide") {
      return { kind: "decline", reason: "Unsupported server request" };
    }

    // 实际产品应把 operation、risk、cwd 和 expiry 完整展示给用户。
    const approved = await showApprovalDialog(request.params);
    return approved
      ? { kind: "acceptOnce" }
      : { kind: "decline", reason: "User declined" };
  },
});

client.on("notification", (message) => {
  console.log(message.method, message.params);
});
client.on("stderr", (text) => process.stderr.write(text));

const initialized = await client.start();
console.log("negotiated", initialized);

const started = (await client.request("thread/start", {
  title: "登录回归修复",
  metadata: { host: "example-app" },
  agentOptions: { permissionMode: "default" },
})) as { thread: { id: string } };

const threadId = started.thread.id;
await client.request("turn/start", {
  threadId,
  input: "运行登录模块的聚焦测试并修复失败。",
  idempotencyKey: `turn-${Date.now()}`,
});

// turn/completed 通过 notification 异步到达。
// 退出前关闭 stdin，让服务端排空队列并正常收尾。
await client.close();
```

`start()` 会自动启动：

```bash
cc serve --app-server \
  --app-server-state-dir .cc-app-server-state \
  --app-server-queue-cap 256
```

并完成 `initialize`，通常不需要宿主自己拼命令或解析 NDJSON。

## 配置参考

```text
cc serve --app-server [options]

--app-server-state-dir <path>  rollout 存储目录
--app-server-queue-cap <n>     Server 待处理请求上限，默认 256
--project <path>               Agent 默认工作区
```

注意：

- `--app-server` 使用 stdio，不监听端口；
- `--port`、`--host`、`--token`、`--allow-remote` 属于旧 WebSocket 模式；
- state directory 应位于当前用户控制的私有目录，不要放进公开静态目录或多人可写共享目录；
- stdout 是协议通道，日志请从 stderr 读取。

## 5. Thread 生命周期

### 5.1 新建

```ts
const { thread } = (await client.request("thread/start", {
  threadId: "issue-1042", // 可选；不传由 Server 生成
  title: "Issue 1042",
  metadata: { repository: "example/app" },
  agentOptions: { provider: "openai" },
})) as { thread: { id: string } };
```

需要跨进程恢复时，应保存返回的 `thread.id`，不要根据 title 推断身份。

### 5.2 读取增量事件

```ts
const snapshot = await client.request("thread/read", {
  threadId,
  afterEventSeq: lastSeenSeq,
  limit: 1000,
});
```

客户端应在成功处理事件后保存最后的 `event_seq`。断线重连时从该位置补读，事件消费者必须幂等。

### 5.3 恢复

```ts
const resumed = await client.request("thread/resume", {
  threadId,
  afterEventSeq: lastSeenSeq,
});
```

`resume` 返回当前 Thread 投影和增量事件。它不会自动重放可能已发生但响应丢失的外部副作用；应根据 Tool/Effect/terminal evidence 对账。

### 5.4 分支

```ts
const forked = await client.request("thread/fork", {
  threadId,
  newThreadId: "issue-1042-alternative",
  title: "Alternative fix",
  idempotencyKey: "fork-alternative-v1",
});
```

父 Thread 与分支拥有独立存储身份。重试同一 fork 操作时复用 `idempotencyKey`，不要每次生成新 key。

### 5.5 列表和归档

```ts
await client.request("thread/list", { limit: 100 });
await client.request("thread/archive", { threadId });
```

活跃 Turn 存在时不能归档；归档后的 Thread 可以 read，但不能启动新 Turn。

## 6. Turn 与通知

### 6.1 启动 Turn

```ts
const { turn } = (await client.request("turn/start", {
  threadId,
  turnId: "turn-login-tests",
  input: "只修改 auth 模块并运行对应测试。",
  options: { permissionMode: "default" },
  idempotencyKey: "login-tests-v1",
})) as { turn: { id: string } };
```

同一 Thread 同时只能有一个 active Turn。`turn/start` 的返回表示已接纳并开始运行，不代表任务已经成功；最终结果以 `turn/completed` 和持久 terminal evidence 为准。

### 6.2 订阅通知

```ts
client.on("notification", ({ method, params }) => {
  switch (method) {
    case "item/delta":
      renderTextDelta(params);
      break;
    case "tool/requested":
      renderToolStart(params);
      break;
    case "tool/result":
      renderToolResult(params);
      break;
    case "turn/completed":
      persistTerminalState(params);
      break;
  }
});
```

常见通知：

- `thread/updated`
- `turn/started` / `turn/completed`
- `item/started` / `item/delta` / `item/completed`
- `tool/requested` / `tool/result`
- `approval/requested` / `approval/resolved`

### 6.3 中断

```ts
await client.request("turn/interrupt", {
  threadId,
  turnId: turn.id,
  idempotencyKey: `interrupt-${turn.id}`,
});
```

成功响应包含 `physicallySettled: true`。收到 `-32010` 时说明中断尚未物理结算，应稍后 read/resume 对账，不能在 UI 中提前显示“已停止”。

## 7. 审批处理

Server 会用 JSON-RPC request `approval/decide` 向客户端发起裁决。`request.params.request` 包含：

- `operation`：工具、命令、规则等；
- `risk` 与 `reason`；
- `binding.threadId/turnId/itemId`；
- `operationDigest`、`policyDigest`、`workspaceDigest`；
- `cwd`、`nonce`、`expiresAt`。

宿主应完整展示真实操作、风险、工作区和到期时间，只返回五种 decision：

```ts
{ kind: "acceptOnce" }
{ kind: "acceptForTurn" }
{ kind: "acceptForSession" }
{ kind: "decline", reason: "..." }
{ kind: "cancel", reason: "..." }
```

不要根据 tool name 自动批准高风险操作。未配置 `onServerRequest` 时，SDK 默认返回 `decline`；handler 抛错也不会转成批准。

## 8. 原始 stdio 接入

只有无法使用 TypeScript SDK 的宿主才建议直接实现。每行一个 UTF-8 JSON 对象，第一条请求必须 initialize：

```json
{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":1,"minimumProtocolVersion":1,"client":{"name":"raw-host","version":"1"},"features":["thread_turn_item","structured_approval"]}}
{"jsonrpc":"2.0","id":"2","method":"thread/start","params":{"title":"Raw integration"}}
```

实现要求：

- 保留跨 chunk 的行缓冲，不能对每个 stdout chunk 直接 `split("\n")`；
- 处理 Server request 和 notification，不能只等 request/response；
- 对未知 notification 做日志/透传，不能让事件泵崩溃；
- 对 request id 做并发关联；
- stdout 与 stderr 分开；
- 在退出前关闭 stdin 并等待子进程结束。

协议 Schema 位于 `packages/agent-protocol/schema/cc-agent-protocol.schema.json`；Kotlin/Swift/Python 生成绑定随仓库提供。

## 9. 背压与重试

| 位置                 |       默认上限 | 过载行为                           |
| -------------------- | -------------: | ---------------------------------- |
| SDK pending requests |            256 | 本地抛 `AppServerRpcError(-32001)` |
| Server request queue | 256 条 / 4 MiB | 返回 `-32001` + `retry_after_ms`   |
| stdio 输出队列       | 512 条 / 8 MiB | transport 失败并关闭               |
| 单行 JSON            |          1 MiB | 返回 invalid request               |

处理 `-32001` 时按 `error.data.retry_after_ms` 退避，并保持同一 `idempotencyKey`。不要无限并发重试，也不要为可能已执行的 mutation 生成新 key。

## 性能指标

当前公开版提供的是容量护栏与可观测指标，不把本机微基准冒充跨平台服务等级。接入验收至少记录以下值：

| 指标                 | 0.166.0 基线 / 口径    | 用途                                                     |
| -------------------- | ---------------------- | -------------------------------------------------------- |
| SDK pending requests | 默认最多 256           | 限制宿主同时等待的 RPC 数                                |
| Server request queue | 默认 256 条、4 MiB     | 慢消费者时返回 `-32001`，不无限吃内存                    |
| stdio output queue   | 512 条、8 MiB          | 输出阻塞时失败闭合                                       |
| 单行 JSON            | 最大 1 MiB             | 限制异常或恶意 frame                                     |
| `thread/read` 批量   | 示例建议 `limit: 1000` | 通过 `afterEventSeq` 分页，避免一次加载完整历史          |
| 端到端延迟           | 未发布统一 SLO         | 应在目标 OS、真实 provider、真实项目与宿主 UI 上单独测量 |

容量调优应同时采集 pending 数、`-32001` 次数、`retry_after_ms`、通知消费延迟、rollout 大小、进程 RSS 与关闭耗时。当前 30 分钟 overload/RSS soak 仍是发布后的独立门，不应填写未经实测的“实际延迟”。

## 10. 错误码

|     Code | 含义                     | 处理建议                       |
| -------: | ------------------------ | ------------------------------ |
| `-32700` | JSON 解析失败            | 修复 framing/编码              |
| `-32600` | 请求 envelope 非法或超限 | 校验生成的消息                 |
| `-32601` | method 不存在            | 核对协议版本/feature           |
| `-32602` | 参数或版本区间不合法     | 不要原样重试                   |
| `-32603` | 内部错误                 | 记录 stderr，read/resume 对账  |
| `-32001` | 过载                     | 按 `retry_after_ms` 有界退避   |
| `-32002` | 未 initialize            | 重建连接并先握手               |
| `-32004` | Thread/Turn 不存在       | 核对权威 id 与 state directory |
| `-32009` | 生命周期冲突             | 读取当前状态后决定下一步       |
| `-32010` | 超时/中断未结算          | 稍后 read/resume，禁止冒充成功 |

## 11. 持久化与恢复

默认存储是带 hash chain 的 JSONL rollout，位于 `--app-server-state-dir` 或 CLI 默认运行目录。它记录 Thread/Turn/Item/Tool/Approval 事件与 terminal evidence。

恢复建议：

1. 持久保存 `threadId` 和最后处理的事件序号；
2. 新进程启动后先 initialize；
3. 调 `thread/resume` 并传 `afterEventSeq`；
4. 幂等应用事件；
5. 对没有收到 response 的 mutation，先 read/reconcile，再决定是否重试；
6. 归档已结束 Thread，避免长期列表无限增长。

SQLite rollout 是运行时能力门控的可选实现。不要假定所有 Node 22 环境都启用 `node:sqlite`；默认 JSONL 是兼容基线。

## 测试覆盖

0.166.0 源码包含 15 个 App Server 聚焦测试，覆盖四个测试文件：

| 测试文件                                                       | 重点覆盖                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/cli/__tests__/unit/app-server.test.js`               | 协商、真实 kernel 形状 Turn、审批、背压、协议错误、中断物理结算                                    |
| `packages/cli/__tests__/unit/app-server-rollout-store.test.js` | start/append/read/resume/fork/checkpoint/compact/archive、幂等漂移、hash-chain 篡改、SQLite 能力门 |
| `packages/agent-sdk/__tests__/app-server-client.test.ts`       | 子进程启动、response/notification 复用、审批 fail-closed、pending 上限与结构化 RPC 错误            |
| `packages/cli/__tests__/unit/codex-app-server-adapter.test.js` | provider 兼容矩阵、feature gate、降级与中立事件映射                                                |

发布门还要求同一精确提交的 Linux、Windows、macOS CLI CI 与 Strict Sandbox 全矩阵成功。本地聚焦测试只能补充，不能替代发行证据；真实 provider 三平台 journey、长时 overload/RSS soak 和全产品 crash/recovery conformance 仍在当前边界之外。

## 安全考虑

- [ ] state directory 仅当前用户可读写；
- [ ] 不把 prompt、tool result 或 rollout 上传到公开日志；
- [ ] 审批 UI 显示 operation、risk、cwd、binding 与 expiresAt；
- [ ] 未识别的 Server request 默认拒绝；
- [ ] 不把 App Server stdout 和普通日志混写；
- [ ] 不通过外层 HTTP/WebSocket 远程转发 stdio，除非另有认证、TLS、来源与速率设计；
- [ ] 复用 CLI sandbox、权限与 SecretStore，不在宿主实现“绕过版”工具调用；
- [ ] response loss 先恢复对账，外部副作用不盲目重放。

## 故障排除

### `initialize must be called first`

连接建立后发送了其他 method。使用 `AppServerClient.start()`，或让原始客户端第一条请求严格为 initialize。

### `thread already has an active turn`

同一 Thread 已在运行。等待 `turn/completed`，或明确中断并确认 `physicallySettled: true` 后再启动下一 Turn。

### 重启后找不到 Thread

检查新进程是否使用了同一 `--app-server-state-dir`，以及保存的是否为返回的权威 `thread.id`。

### 收到通知但没有最终结果

`turn/start` 是异步的。监听 `turn/completed`；连接中断时用 `thread/read` / `thread/resume` 补读持久事件。

### `-32001` 频繁出现

减少客户端并发、提高消费通知速度，必要时在容量评估后调整 `serverQueueCap` / `--app-server-queue-cap`。不要通过无限提高上限掩盖慢消费者。

### 关闭后仍有子进程

确保调用并等待 `client.close()`。异常宿主退出时还应对 App Server 子进程做进程树回收。

## 关键文件

| 文件                                                           | 作用                                            |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `packages/cli/src/commands/serve.js`                           | `--app-server` 启动入口、参数互斥与依赖装配     |
| `packages/cli/src/lib/app-server/server.js`                    | JSON-RPC 路由、Thread/Turn/Item/Approval 状态机 |
| `packages/cli/src/lib/app-server/stdio-transport.js`           | NDJSON framing、输入/输出上限与背压             |
| `packages/cli/src/lib/app-server/bounded-queue.js`             | 有界异步队列                                    |
| `packages/cli/src/lib/app-server/rollout-store.js`             | JSONL rollout、hash chain、恢复与 compact       |
| `packages/cli/src/lib/app-server/sqlite-rollout-store.js`      | capability-gated SQLite 适配器                  |
| `packages/cli/src/lib/app-server/cli-agent-kernel-adapter.js`  | App Server 到 CLI Agent Kernel 的适配           |
| `packages/agent-sdk/src/app-server-client.ts`                  | TypeScript 产品集成客户端                       |
| `packages/agent-protocol/schema/cc-agent-protocol.schema.json` | canonical 协议 Schema                           |

## 当前边界

- 已发布的是 stdio MVP，不是公网服务；
- Desktop/IDE 尚未全部切换到 App Server；
- WebSocket transport 仍未作为 CC App Server 的公开稳定入口；
- 30 分钟 overload/RSS soak、真实 provider 三平台 journey 与全产品 crash/recovery conformance 仍需完成；
- App Server 发布不等于 Graph Kernel 已成为所有产品的唯一 writer。

## 相关文档

- [Agent SDK](./agent-sdk.md)
- [WebSocket 服务（serve）](./cli-serve.md)
- [GraphRun 观测与评估](./cli-team-graph.md)
- [CLI Runtime 当前实现](./cli-runtime-current.md)
- [设计文档：CC App Server](/design/modules/104-cc-app-server)
- [设计文档：Agent 平台化](/design/modules/103-agent-sdk-platform)
