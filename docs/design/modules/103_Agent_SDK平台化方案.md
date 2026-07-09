# 103. Agent SDK 平台化方案

> 状态：第三阶段（平台化）全落地（2026-07-09）——SDK 包 + 四端契约化 + 真 CLI e2e + 两 IDE 首会话持久化修复

## 1. 目标

把 `cc agent` 的 stream-json 双工协议从"各消费端读源码对齐的隐式约定"升级为**版本化的正式平台契约**：

1. 提供 **TypeScript Agent SDK**（`@chainlesschain/agent-sdk`）；
2. web-panel / IDE 改用 SDK，而不是各自拼 CLI argv、手写 NDJSON 解析；
3. **approval callback、stream event、checkpoint、session resume** 成为 SDK 契约。

## 2. 背景与动因

第一/二阶段（gap-analysis 批次）补齐了权限模式、attach transport、后台面板等能力后，消费端复杂度成为主要摩擦：

- VS Code `agent-session.js`、JetBrains `AgentChatSession.java`、web-panel 各自维护一份协议拼装 + 行解析，行为靠"孪生文件"纪律维持一致；
- chunk 边界切行、close 时冲洗最后一条无换行行等细节各端独立踩坑；
- CLI 包无 `exports` map、无 `.d.ts`、无 semver 契约面——嵌入方只能深 import 或读源码。

## 3. 架构

```
packages/agent-sdk (TypeScript, 双构建 ESM+CJS)
├── src/protocol.ts        # 契约单一来源: PROTOCOL_VERSION=1
│     · AgentStreamEvent 全词汇 (system/init·stream_event·tool_use/result·
│       approval_request/resolved·question·plan_update·token_usage·result…)
│     · AgentInputEvent (user/interrupt/compact/approval/answer/plan/…)
│     · Bg pipe 消息 + bg-* WS 帧 + type guards
├── src/agent-session.ts   # AgentSession spawn 双工客户端
├── src/background.ts      # attachBackgroundSession (cc attach 同款 pipe 协议)
├── src/cli-json.ts        # session/checkpoint `--json` 包装 (进程边界)
├── src/browser.ts         # 浏览器安全入口 (bgRequest/isBgPushFrame)
└── docs/PROTOCOL.md       # 语言中立契约 (Agent Protocol v1)
```

消费矩阵：

| 消费端 | 方式 | 原因 |
|---|---|---|
| VS Code | `scripts/sync-agent-sdk.mjs` vendor CJS 构建进 `src/vendor/agent-sdk/` | vsce `--no-dependencies` 打包、node_modules 不进包 |
| web-panel | vite/vitest alias 直指 SDK TS 源 | 非 workspace 成员，沿用 `@chainlesschain/locales` 先例；npm 发包时需同步 build-web-panel.mjs staging |
| JetBrains | 实现 `docs/PROTOCOL.md`（javadoc + README declared） | Kotlin/Java 不消费 TS；**协议文档即兼容面** |

## 4. 四大契约语义

| 契约 | 语义要点 |
|---|---|
| 流式事件 | NDJSON 一行一事件；解码必须 carry buffer；close 必须 flush 最后一条无换行行；未知 type 必须忽略（向前兼容） |
| 审批回调 | `onApproval` 隐含 `--interactive-approvals`；CONFIRM 级阻塞至裁决；回调异常 = deny（fail-closed，与 CLI `CC_APPROVAL_TIMEOUT_MS` 超时行为一致） |
| 检查点 | `cc checkpoint create/list/show/restore --json` 的 JSON 输出即稳定面 |
| 会话恢复 | ⚠️ 匿名流式会话**不落盘**（CLI 设计）：可恢复会话必须首启声明 `--session <id>`（SDK `sessionId` 选项）；`--resume <id>` 不存在则创建并持久化 |

## 5. e2e 验证与修复的缺陷

SDK 自带真 CLI e2e（fake ollama + `CHAINLESSCHAIN_HOME` 隔离，`AgentSession` 驱动仓库真 `cc`），断言全部四契约。落地当天抓出并修复：

1. **两 IDE 首会话持久化洞（HIGH）**：面板首会话匿名 spawn → 转录从未写盘 → IDE 重载后 `--resume <init 捕获的 id>` 静默空会话，重载前上下文全丢。修复 = 首启即声明 `panel-<ts>-<rand>` id（VS Code chat-view + JetBrains `SessionArgs.newPanelSessionId()`）。
2. **SDK `.js` 入口 spawn 失败**：`buildSpawnCommand` 把 `.js` cliPath 当可直接执行——改经 `process.execPath`。

## 6. 协议演进规则

任何 stream-json 事件增改 = 协议变更，须**同一提交**同步三处：`protocol.ts`（必要时 bump PROTOCOL_VERSION）+ `docs/PROTOCOL.md` + JetBrains `ChatEvents.java`。改 SDK 源后须重跑 VS Code vendor 同步脚本。

## 7. 验证记录（2026-07-09）

- agent-sdk：36/36（单元 + 真管道集成 + 真 CLI e2e）
- VS Code 扩展：58 文件 / 512 测试绿（CLI vitest 承载）
- web-panel：121 文件 / 2458 绿 + vite 生产构建干净
- JetBrains：compileJava 干净 + PureLogicSmokeMain 663/0

## 8. 未决项

- SDK npm 首发时机（随下次 CLI 发版拍板；批 1–3 已随 cli 0.162.155 仓内出货）
- VS Code `AgentChatSession` 类整体替换为 SDK `AgentSession`（当前为 argv+framing 委托，类壳保留以维持 456+ 测试面）
- `buildSessionArgs`（provider/baseUrl/apiKey/think 选项旗标）保留在扩展侧，喂 SDK `extraArgs`
