# Agent SDK — TypeScript 智能体接入套件（`@chainlesschain/agent-sdk`）

> **版本: 平台化第三阶段 · 2026-07-09 | 状态: ✅ 已落地（monorepo `packages/agent-sdk`，npm 发布随下次 CLI 发版） | 协议版本 Agent Protocol v1 | 36 测试（单元 + 真管道集成 + 真 CLI e2e）**
>
> Agent SDK 把 `cc agent` 的 stream-json 双工协议固化为**带类型的正式契约**：流式事件、审批回调、检查点、会话恢复不再靠各消费端手拼 argv、手写 NDJSON 解析，而是 `import` 即得。VS Code 扩展、web-panel 已迁移到 SDK；JetBrains 插件（Kotlin/Java）对齐同一份语言中立的协议文档。

## 概述

在 SDK 之前，每个想嵌入 ChainlessChain 智能体的宿主（VS Code 扩展、JetBrains 插件、web-panel、自建面板）都要各自完成四件事：

1. **拼协议 argv** — `cc agent --input-format stream-json --output-format stream-json --include-partial-messages …`，漏一个 flag 行为悄然不同；
2. **手写 NDJSON 行解析** — chunk 边界会把一行切成两半，没有 carry buffer 就丢内容（本仓库反复修过的 bug 类）；
3. **自行对齐事件词汇表** — `system/init`、`stream_event`、`approval_request`、`result` 等十余种事件的字段名靠读 CLI 源码；
4. **自行实现审批/恢复语义** — 审批超时 fail-closed、resume 何时真正回放历史，全是隐式约定。

Agent SDK 把这四件事收敛为一个带 `.d.ts` 类型、零运行时依赖的包 + 一份版本化协议文档。**协议即契约**（Agent Protocol v1）：TypeScript 消费端拿到的是类型，非 TypeScript 消费端（JetBrains）实现同一份 `PROTOCOL.md`——两者的兼容面完全一致。

## 核心特性

- 📡 **完整事件词汇表**：`protocol.ts` 单一来源定义全部流式输出事件（`system/init`、文本/思考增量、`tool_use`/`tool_result`、`approval_request/resolved`、`question_request/resolved`、`plan_update`、`token_usage`、`compaction`、`result` 等）与全部 stdin 输入事件（用户轮次/中断/压缩/审批/答题/计划控制），附 type guards；未知事件类型自动忽略（向前兼容）。
- ✅ **审批回调契约**：`onApproval: (req) => Promise<boolean>` —— 提供回调即自动加 `--interactive-approvals`；CONFIRM 级工具**阻塞等待**裁决；回调抛错 = 拒绝（fail-closed，与 CLI 自身 `CC_APPROVAL_TIMEOUT_MS` 超时语义一致）。
- 🔄 **会话恢复契约**：`sessionId`（新会话首启声明 id）/ `resume`（续既有会话）/ `forkSession`；`init` 事件回传 `session_id` 与 `resumed_messages`。
- 📸 **检查点契约**：`createCheckpoint / listCheckpoints / showCheckpoint / restoreCheckpoint` 包装 `cc checkpoint … --json`，进程边界隔离（绝不深 import CLI 内部）。
- 🧵 **NDJSON carry-buffer 解码器**：跨 chunk 切行重组 + close 时 `flush()` 冲洗最后一条无换行行（错误输出常缺尾换行）+ 单行 1 MiB 上限 + Uint8Array/多字节 UTF-8 安全。
- 🛡️ **Windows spawn 加固内置**：`cmd.exe /c` shim（npm `.cmd` 垫片）、`NoDefaultCurrentDirectoryInExePath=1`（阻断仓库内 `cc.bat` 劫持，两 IDE 插件同款 P0 修复）、`taskkill /T /F` 进程树回收（防孤儿子进程烧 token + 占 SQLite 锁）、`.js` 入口自动经 `process.execPath` 执行。
- 🔌 **后台会话接管**：`attachBackgroundSession` 讲 `cc attach` 同款 pipe 协议（Windows 命名管道 / POSIX domain socket，token 握手 5 秒超时），prompt / status / stop-turn / detach。
- 🌐 **浏览器安全入口**：`/browser` 子路径零 Node 依赖——协议类型 + NDJSON 解码器 + `bg-*` WebSocket 帧构造/判别（`bgRequest` / `isBgPushFrame`），web-panel 直接消费。
- 📦 **双构建 + 零依赖**：tsc 产 ESM + CJS 两份（`exports` 条件导出），CJS 全量 ~30 KB，运行时依赖为零——vendor 进 VS Code 扩展无包袱。

## 系统架构

```
┌─────────────────────────── 消费端 ───────────────────────────┐
│  VS Code 扩展            web-panel (浏览器)      JetBrains 插件 │
│  vendored CJS            vite alias → TS 源      实现 PROTOCOL.md│
│  (sync-agent-sdk.mjs)    (@…/agent-sdk/browser)  (Java, 协议级) │
└──────────┬────────────────────┬──────────────────────┬────────┘
           ▼                    ▼                      ▼
┌──────────────────── @chainlesschain/agent-sdk ────────────────┐
│  protocol.ts   ← 契约单一来源 (PROTOCOL_VERSION=1, 类型+guards) │
│  agent-session.ts  AgentSession: spawn 双工客户端               │
│  background.ts     attachBackgroundSession: pipe 接管           │
│  cli-json.ts       session/checkpoint --json 包装               │
│  ndjson.ts         carry-buffer 解码器 (+flush)                 │
│  docs/PROTOCOL.md  ← 语言中立契约 (JetBrains 的兼容面)          │
└──────────┬─────────────────────────────────────────────────────┘
           ▼  spawn / pipe / WS
┌────────────────────────── cc CLI ──────────────────────────────┐
│  cc agent --input/output-format stream-json   (双工会话)        │
│  background-session-transport (cc attach 管道)                  │
│  gateways/ws background-agent-protocol (bg-* 帧, web-panel 中继)│
│  cc session / cc checkpoint --json            (一次性查询)      │
└─────────────────────────────────────────────────────────────────┘
```

三个包入口：

| 入口 | 环境 | 内容 |
| --- | --- | --- |
| `@chainlesschain/agent-sdk` | Node | `AgentSession`、`attachBackgroundSession`、session/checkpoint 包装、全部协议类型 |
| `@chainlesschain/agent-sdk/protocol` | 任意 | 纯类型 + type guards，零运行时 I/O |
| `@chainlesschain/agent-sdk/browser` | 浏览器 | 协议类型 + NDJSON 解码器 + `bg-*` 帧助手（零 Node import） |

## 使用示例

### 交互式会话（流式渲染 + 审批 + 恢复）

```ts
import { AgentSession } from "@chainlesschain/agent-sdk";

const session = new AgentSession({
  // ⚠️ 会话恢复契约：匿名流式会话不落盘 —— 要可恢复必须首启声明 id
  sessionId: `my-host-${Date.now()}`,
  permissionMode: "acceptEdits",
  cwd: workspaceRoot,
  // 审批回调契约：CONFIRM 级工具阻塞等待此回调；抛错 = 拒绝
  onApproval: async (req) =>
    ui.confirm(`${req.tool}: ${req.command ?? ""} (风险 ${req.risk})`),
  // ask_user_question 往返（自动设 CC_INTERACTIVE_QUESTIONS=1）
  onQuestion: async (q) => ui.quickPick(q.question, q.options),
});

session.on("init", (e) => persistSessionId(e.session_id));
session.on("text", (delta) => chatView.append(delta));
session.on("thinking", (delta) => chatView.appendDimmed(delta));
session.on("tool_use", (e) => chatView.toolStarted(e.tool));
session.on("stderr", (line) => outputChannel.append(line));

session.start();
session.send("跑通测试并修复失败", { images: ["/tmp/screenshot.png"] });
const result = await session.nextResult();
console.log(result.subtype, result.usage);

// 中断当前轮 / 手动压缩历史 / 优雅收尾
session.interrupt();
session.compact();
session.end();
```

### 恢复上次会话

```ts
import { AgentSession, listSessions } from "@chainlesschain/agent-sdk";

const sessions = await listSessions();               // cc session list --json
const last = sessions[0];
const resumed = new AgentSession({ resume: last.id });
resumed.on("init", (e) => {
  if ((e.resumed_messages ?? 0) > 0) console.log(`回放了 ${e.resumed_messages} 条历史`);
});
resumed.start();
```

### 检查点（改动前快照 → 出错回滚）

```ts
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from "@chainlesschain/agent-sdk";

const cp = await createCheckpoint([]);               // 全工作区快照
try {
  await runRiskyAgentTask();
} catch {
  await restoreCheckpoint(String(cp.id));            // 文件级回滚
}
```

### 接管后台代理（`cc agent --bg` 起的任务）

```ts
import { attachBackgroundSession } from "@chainlesschain/agent-sdk";

const handle = await attachBackgroundSession({
  id: "bg-1719...",                                  // 读状态文件取 pipe+token
  onEvent: (e) => {
    if (e.type === "turn-ended") console.log(`第 ${e.turn} 轮完成`);
    if (e.type === "idle") handle.prompt("继续下一步");
  },
});
handle.prompt("补充：优先修 P0");
handle.stopTurn();                                   // 停当前轮（会话保留）
handle.detach();
```

### 浏览器端（web-panel 同款）

```ts
import { bgRequest, isBgPushFrame } from "@chainlesschain/agent-sdk/browser";

ws.send(JSON.stringify(bgRequest("bg-attach", { bgId, lines: 200 })));
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (!isBgPushFrame(msg)) return;
  if (msg.type === "bg-log") logView.append(msg.chunk);
  if (msg.type === "bg-event") handleWorkerEvent(msg.event);
};
```

## 配置参考

### AgentSession 选项

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `cliPath` | `string` | `"cc"` | CLI 可执行文件；`.js` 路径自动经 `process.execPath` 执行 |
| `cwd` / `env` | `string` / `object` | 继承 | 子进程工作目录 / 环境（在 `process.env` 之上合并） |
| `sessionId` | `string` | — | **新**会话声明 id（`--session`）；可恢复会话必填 |
| `resume` | `string` | — | 续既有会话（`--resume`）；与 `sessionId` 同给时 `resume` 优先 |
| `forkSession` | `boolean` | `false` | 分叉而非追加（`--fork-session`） |
| `permissionMode` | `"default" \| "plan" \| "acceptEdits" \| "bypassPermissions" \| "auto"` | `"default"` | `default` 不加 flag |
| `model` / `provider` | `string` | CLI 自解析 | 显式钉死模型/提供商 |
| `includePartialMessages` | `boolean` | `true` | 关闭则无文本/思考增量事件 |
| `onApproval` | `(req) => Promise<boolean>` | — | 提供即隐含 `--interactive-approvals` |
| `onQuestion` | `(q) => Promise<string \| string[] \| null>` | — | 提供即设 `CC_INTERACTIVE_QUESTIONS=1`；返回 `null` 取消 |
| `extraArgs` | `string[]` | `[]` | 追加在 SDK 所有 flag 之后（如 `--base-url`、`--think`） |
| `spawn` | `typeof spawn` | node | 测试注入缝 |

### 相关环境变量（CLI 侧语义，SDK 透传）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CC_APPROVAL_TIMEOUT_MS` | `120000` | 审批无人应答的 fail-closed 超时 |
| `CC_QUESTION_TIMEOUT_MS` | `180000` | ask_user_question 超时（取消，模型自主继续） |
| `CC_INTERACTIVE_QUESTIONS` | 关 | `onQuestion` 自动置 `1` |
| `CC_STREAM_COALESCE_MS` | `50` | CLI 侧增量合帧窗口 |
| `CC_AUTO_IMAGE` | 开 | `0` 关闭消息内图片路径自动附带 |

## 性能指标

实测（Windows 10 Workstations，Node 22，2026-07-09）：

| 指标 | 数值 | 口径 |
| --- | --- | --- |
| NDJSON 解码吞吐 | **~14.7 万事件/秒（17.8 MB/s）** | 20 万条真实形状 `stream_event` 增量，50 行/chunk |
| 跨 chunk 切行路径 | **~16.1 万事件/秒** | 每行强制切成两个 chunk 的最坏情况 |
| 单行上限 | 1 MiB | 超限丢弃并报 `onError`（防恶意/失控行撑爆内存） |
| 真 CLI e2e 全程 | **~7 秒** | 2 次冷 spawn + 3 个 agent 轮次 + 审批往返 + resume（fake LLM） |
| CJS 构建体积 | **~30 KB / 零运行时依赖** | vendor 进 VS Code 扩展的全部增量 |
| 审批阻塞开销 | 0（事件驱动） | 无轮询；挂起数 = 未决审批数 |

## 测试覆盖

| 层 | 套件 | 数量 | 覆盖点 |
| --- | --- | --- | --- |
| 单元 | `__tests__/ndjson.test.ts` | 9 | 切行重组 / CRLF / 坏行不拖累后行 / 1 MiB 上限 / 多字节 UTF-8 跨 chunk / flush 幂等 |
| 单元 | `__tests__/protocol.test.ts` | 4 | type guards 全走查 |
| 单元 | `__tests__/agent-session.test.ts` | 12 | argv 契约 / 事件分发 / 审批回调 fail-closed / 问题回调取消 / nextResult / exit 单发 / 未知事件不炸泵 |
| 单元 | `__tests__/cli-json.test.ts` | 5 | JSON 解析 / 失败注上下文 / 裸数组与包裹对象两形态 |
| 集成 | `__tests__/background.test.ts` | 3 | **真 net 服务器 + 真命名管道**：token 握手 / 错 token 拒绝 / 静默服务器超时 |
| e2e | `__tests__/e2e-agent-session.test.ts` | 1（3 会话） | **真 `cc` CLI**：init/session_id → 文本流 → 审批放行后文件真实写盘 → resume 回放（`resumed_messages > 0`） |

合计 **36 测试全绿**；消费端回归：VS Code 58 文件/512 绿（含 SDK 委托契约 4 测 + 首会话持久化回归 1 测）、web-panel 121 文件/2458 绿、JetBrains PureLogicSmokeMain 663/0。

## 安全考虑

1. **审批 fail-closed 三重兜底**：回调抛错 → SDK 答 `deny`；回调不响应 → CLI `CC_APPROVAL_TIMEOUT_MS` 超时拒绝；stdin 断开 → CLI 拒绝。任何路径都不会"无人裁决默认放行"。
2. **cmd.exe 劫持防护**：Windows spawn 一律注入 `NoDefaultCurrentDirectoryInExePath=1`，阻断打开恶意仓库时 cwd 内 `cc.bat` 先于 PATH 被执行（两 IDE 插件的 P0 修复，SDK 内置化）。
3. **进程树回收**：`kill()` 走 `taskkill /PID <pid> /T /F` —— 裸 `child.kill()` 只杀 cmd.exe 包装层，真正的 cc/node 孙进程会变孤儿继续烧 token 并持有 better_sqlite3 锁。
4. **后台管道 = 本机能力模型**：pipe token 存于 0600 状态文件，**持有文件即持有能力**；`bg-*` WS 中继绝不外发 token（网关自己完成管道握手，远端只见 `interactive: true/false`）。
5. **解码器抗失控输入**：单行超 1 MiB 即丢弃 + 报错，恶意长行不能撑爆宿主内存；坏 JSON 行隔离上报，不拖垮后续事件。
6. **凭据不进 argv**：SDK 自身不发明凭据旗标；宿主应经 `env`（如 `CC_API_KEY`）传密钥——argv 对同用户所有进程可见。

## 故障排除

| 症状 | 原因 | 处置 |
| --- | --- | --- |
| `resume` 后历史为空（`resumed_messages: 0`） | 首次会话没传 `sessionId` —— **匿名流式会话不落盘**（CLI 设计如此） | 首启就给 `sessionId`；`resume` 一个不存在的 id 会静默新建 |
| Windows 下 spawn 报 ENOENT | `cliPath` 指向 `.cmd`/裸名但环境缺 PATH 项 | SDK 已走 `cmd.exe /c`；确认 `cc --version` 在同环境可跑，或 `cliPath` 给绝对路径 |
| 审批卡 120 秒后自动拒绝 | `onApproval` 回调挂起未决议 | 回调内加自己的 UI 超时；或调 `CC_APPROVAL_TIMEOUT_MS` |
| `question_request` 从不出现 | 宿主没提供 `onQuestion`（未设 `CC_INTERACTIVE_QUESTIONS`） | 提供回调即可；旧版 CLI 忽略该 env → 优雅降级为模型自主继续 |
| 事件流"丢了半行" | 绕过 SDK 直接 `split("\n")` 解析 stdout | 用 `createNdjsonDecoder`（carry buffer + close flush） |
| 杀掉会话后临时目录删不掉（EBUSY） | 刚被 kill 的 cc 子进程短暂持有 SQLite 锁 | 等退出事件再清理；清理加重试（SDK e2e 即此写法） |
| `attachBackgroundSession` 握手超时 | worker 已退出但状态文件残留 / token 轮换 | 重读状态文件（每次心跳会重写 `transport`）；确认 `status: "running"` |
| vendored SDK 与 `packages/agent-sdk` 行为不一致 | 改了 SDK 源没重跑同步脚本 | `node scripts/sync-agent-sdk.mjs`（vendor 目录禁止手改） |

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `packages/agent-sdk/src/protocol.ts` | **契约单一来源**：全事件/输入/帧类型 + guards + `PROTOCOL_VERSION` |
| `packages/agent-sdk/src/agent-session.ts` | `AgentSession` spawn 双工客户端（argv 构造 + 事件分发 + 审批/问题自动应答） |
| `packages/agent-sdk/src/ndjson.ts` | carry-buffer NDJSON 解码器（含 `flush()`） |
| `packages/agent-sdk/src/background.ts` | 后台会话 pipe 客户端 + 状态文件读取 |
| `packages/agent-sdk/src/cli-json.ts` | session/checkpoint `--json` 一次性包装 |
| `packages/agent-sdk/src/browser.ts` | 浏览器安全入口（`bgRequest` / `isBgPushFrame`） |
| `packages/agent-sdk/docs/PROTOCOL.md` | **语言中立契约文档**（JetBrains 的兼容面） |
| `packages/agent-sdk/scripts/build.mjs` | tsc 双构建（ESM + CJS） |
| `packages/vscode-extension/scripts/sync-agent-sdk.mjs` | vendor 同步脚本（改 SDK 后必跑） |
| `packages/vscode-extension/src/vendor/agent-sdk/` | vendored CJS（生成物，禁手改） |
| `packages/cli/src/runtime/headless-stream.js` | 协议的 CLI 侧真源（stream-json 双工实现） |
| `packages/cli/src/lib/background-session-transport.js` | 后台管道协议的 CLI 侧真源 |

## 协议演进规则

任何对 stream-json 事件的增改都是协议变更，必须**同一提交**内完成三处同步：

1. `packages/agent-sdk/src/protocol.ts`（必要时 bump `PROTOCOL_VERSION`）
2. `packages/agent-sdk/docs/PROTOCOL.md`
3. JetBrains `ChatEvents.java` / VS Code 消费点（改 SDK 源后重跑 vendor 同步）

## 相关文档

- [CLI 命令行工具](./cli.md) — `cc agent` 全旗标
- [检查点](./checkpoint.md) — checkpoint 子命令详解
- [Agent Team — 任务图团队编排](./cli-team.md)
- [可靠性评测 + 趋势门](./cli-eval.md)
- [语义代码智能 — LSP](./cli-code-intel.md)
- [Cowork 多智能体协作](./cowork.md)
- 设计文档：`docs/design/modules/103_Agent_SDK平台化方案.md`（设计站同步）
