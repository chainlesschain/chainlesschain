# 跨端远程控制 + 移动/Web 审批（`cc remote-control`）

> **版本: 第四阶段（跨端与长任务）#1+#2 · 2026-07-09 | 状态: ✅ 服务端/入口生产就绪（三端真机 UX 待验） | 统一远控入口 + 双模配对（relay E2EE / direct-LAN）+ 二维码 + 移动/Web 远程权限审批（fail-closed）| 36 测试（28 单元 + 8 真-WSServer 集成）**
>
> `cc remote-control` 把「从手机 / 浏览器安全接管本地 Agent 会话」收敛成一条命令：`start` 在进程内起 WebSocket 服务 + 常驻 HOST 会话，打印一个配对 URI / 二维码，配对设备即可观察、下发 prompt、审批工具调用、打断。配合 `cc agent --remote-control`，confirm 级权限审批可**路由到已配对的移动/Web 设备**远程批准，超时 **fail-closed**（默认拒绝）。

## 概述

远程控制解决的场景是：本地机器上跑着一个 Agent 会话（保留本地文件、MCP、工具、项目配置），但用户人在手机或另一台设备前，希望**安全地**接管这个会话——发指令、看进度、在 Agent 要做敏感操作时远程点「批准/拒绝」。

难点在于**不要求用户开放入站端口**、**凭证短期一次性**、**断网可重连不丢序**、**审批不能因为网络问题静默放行**。`cc remote-control` 在既有 `harness/remote-session-*`（E2EE 中继 + 注册表 + 幂等命令账本）底座上，补齐了三样此前缺失的东西：

1. **一条统一入口命令**——此前远控能力散落在 `cc serve --allow-remote` 的旗标里，没有「一键起会话 + 出配对码」的用户面。`cc remote-control start` 进程内起 WS 服务、建一个 loopback 的 **HOST 客户端**（host 连接断开即关闭会话，所以它常驻）、自动 `session-create → remote-session-create`，然后打印配对 URI/二维码。
2. **双模配对**——配了中继（relay）走端到端加密的 `remote-session` 配对；没配中继则退回**局域网直连**（direct-LAN）配对，把 `wsUrl` / 服务令牌 / 一次性配对令牌 / scopes / 过期时间编码进一个既能当深链又能当二维码载荷的 URI。
3. **远程权限审批**——`cc agent --remote-control` 把 confirm 级审批门（settings 规则 ask / 敏感文件 / 破坏性 git / 凭据 / PreToolUse 钩子 ask）路由到已配对设备，远端答复前 Agent 阻塞，超时按 **fail-closed** 拒绝。

## 核心特性

- 🎬 **统一入口**: `cc remote-control start / status / stop`——一条命令起会话 + 出配对码；`status`/`stop` 跨进程（经状态文件）发现并操作正在跑的会话。
- 🔗 **双模配对**: 配 relay → E2EE `chainlesschain://remote-session/pair#…`；否则 direct-LAN `chainlesschain://remote-control/pair#<b64url json>`（内嵌 `wsUrl`/`serverToken`/一次性 `pairingToken`/`scopes`/`expiresAt`），同串既是深链又是二维码载荷。
- 📱 **二维码渐进增强**: 可选 `qrcode` 包**懒加载**——装了就在终端画二维码，没装则回退纯 URI（不硬依赖）。
- 🔐 **一次性配对令牌 + scopes**: 每设备一枚一次性 `pairingToken`（用过即失效），默认授予 `observe,prompt,approve,interrupt` 四个 scope。
- 🛂 **远程权限审批（fail-closed）**: `cc agent --remote-control` 把 confirm 级审批推给已配对设备；纯远端模式**超时即拒**，本地+远端并存时**赛跑**（谁先答用谁，另一端清理）。
- 📨 **client-hosted 会话控制转发**: 配对设备驱动 HOST 会话的控制事件（prompt / approval.resolve / interrupt）转发给 HOST 连接；HOST 不可达在幂等账本**之前**报错（不消耗 commandId）。
- 🛰️ **relay E2EE + push 唤醒**: HOST 发布事件的 fan-out 附带中继端到端加密投递；`permission.request` 事件额外触发移动端推送唤醒（vendor push）。
- 🔒 **仅出站 + 短期凭证 + 撤销**: 不要求开放入站端口；服务令牌/配对令牌短期有效；设备可经注册表撤销。
- 🗂️ **状态文件跨进程**: `~/.chainlesschain/remote-control/<port>.json`（`0600`，含服务令牌）；`status` 输出对令牌**脱敏**。

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                    cc remote-control start                    │
│                 (commands/remote-control.js)                  │
│  进程内起 WS server → 建 loopback HOST 客户端 → session-create │
│  → remote-session-create → 打印配对 URI / 二维码 → 写状态文件   │
└───────┬──────────────────────────────────────┬───────────────┘
        │                                      │
 ┌──────▼───────┐                     ┌─────────▼──────────┐
 │ WsRpcClient   │  requestId 优先     │  remote-control.js  │
 │(ws-rpc-client)│  匹配 envelope 回包  │  (lib) 配对 URI 编解码│
 │ auth/request/ │                     │  QR 渲染 / 状态文件   │
 │  onEvent      │                     │  pickLanAddress      │
 └──────┬────────┘                     └─────────────────────┘
        │
 ┌──────▼─────────────────────────────────────────────────────┐
 │            WSServer  +  remote-session-protocol             │
 │  serverHosted? ─ 否 → 转发控制事件给 HOST（remote-session-   │
 │  control 帧，判定在幂等账本之前）                             │
 │  host 发布 fan-out → relay E2EE 投递 + permission.request 推送│
 └──────┬───────────────────────────┬─────────────────────────┘
        │                           │
 ┌──────▼────────┐        ┌──────────▼───────────┐
 │ RemoteApproval │        │ remote-session-       │
 │ Bridge         │        │ registry / crypto /   │
 │(remote-approval│        │ command-ledger        │
 │ -bridge.js)    │        │ (X25519+HKDF+AES-GCM, │
 │ request/resolve│        │  幂等 commandId)       │
 └────────────────┘        └───────────────────────┘
```

**远程审批时序（`cc agent --remote-control`）：**

```
Agent 触到 confirm 级门（敏感文件 / 破坏性 git / 凭据 / ask 规则）
  ├─ RemoteApprovalBridge.publish(permission.request)  ── relay E2EE + push 唤醒
  ├─ 已配对设备收到 → 用户点 批准/拒绝
  ├─ 设备 publish(approval.resolve) → 转发给 HOST → bridge settle
  └─ 决议：
       纯远端 → 远端答复 or 超时(fail-closed 拒绝)
       本地+远端 → 赛跑，先答者胜，另一端清理
  → publish(permission.resolved) 回执
```

## 命令参考

### `cc remote-control start`

在进程内起一个可远程接管的 HOST 会话并打印配对码。

```bash
cc remote-control start                       # direct-LAN 配对（无中继）
cc remote-control start --relay-url wss://relay.example/ws   # E2EE 中继配对
cc remote-control start --port 8790 --qr      # 指定端口 + 画二维码
```

| 旗标                     | 说明                                                  | 默认                       |
| ------------------------ | ----------------------------------------------------- | -------------------------- |
| `--port <n>`             | WS 服务监听端口                                        | 自动                       |
| `--relay-url <url>`      | 中继 URL（配了走 E2EE `remote-session` 配对）         | 无（→ direct-LAN）         |
| `--scopes <list>`        | 授予设备的 scope（逗号分隔）                          | `observe,prompt,approve,interrupt` |
| `--qr`                   | 在终端渲染二维码（需可选 `qrcode` 包）                | 关（仅打印 URI）           |
| `--expires <seconds>`    | 配对令牌有效期                                         | 短期                       |
| `--json`                 | 机器可读输出（含 `pairingUri`）                       | 关                         |

> 中继 URL 也可经环境变量 `CC_REMOTE_SESSION_RELAY_URL` 或配置文件提供。

### `cc remote-control status`

列出本机正在跑的远控会话（跨进程，经状态文件发现）。服务令牌在输出中**脱敏**。

```bash
cc remote-control status
cc remote-control status --json
```

### `cc remote-control stop`

停止一个正在跑的远控会话。

```bash
cc remote-control stop --port 8790
cc remote-control stop --all
```

### `cc agent --remote-control`

无头 / 交互 Agent 运行时把 confirm 级审批路由到已配对设备。

```bash
cc agent -p "重构 auth 模块" --remote-control
cc agent -p "..." --remote-control --permission-prompt-tool <tool>   # 显式 routing 优先
```

`--remote-control` 把远程审批桥挂到 `approvalGate.setConfirmer`（headless 与 stream 双路一致）；显式 `--permission-prompt-tool` 优先于远程桥；会话结束在 `finally` 中拆桥。

## 配置参考

| 项           | 机制                                             | 默认                                | 备注                                          |
| ------------ | ------------------------------------------------ | ----------------------------------- | --------------------------------------------- |
| 中继 URL     | `--relay-url` / `CC_REMOTE_SESSION_RELAY_URL`    | 无                                  | 配了走 E2EE，否则 direct-LAN                  |
| scopes       | `--scopes`                                        | `observe,prompt,approve,interrupt`  | 授予配对设备的能力集                          |
| 状态目录     | `~/.chainlesschain/remote-control/<port>.json`   | —                                   | `0600`，含服务令牌；`status` 脱敏             |
| 审批超时     | 远程审批桥内置                                    | fail-closed（超时拒绝）             | 纯远端模式无本地兜底时超时即拒                |
| 二维码       | 可选 `qrcode` 包                                  | 未装则回退纯 URI                    | 懒加载渐进增强                                |

## 性能指标

| 维度       | 特性                                                            |
| ---------- | --------------------------------------------------------------- |
| 入站要求   | 零——仅出站连接（中继模式）/ 局域网直连，不要求开放入站端口     |
| 响应匹配   | `WsRpcClient` 按 `requestId` **优先于** `id` 匹配（envelope 回包关联键在 `requestId`）|
| 幂等       | 控制事件带 commandId → 断线重发**至多一次**执行；无 commandId 逐字节不变 |
| 审批安全界 | 纯远端超时 **fail-closed**（拒绝），绝不因网络问题静默放行     |
| host 可达性 | HOST 不可达在幂等账本**之前**报错，不消耗 commandId 槽         |

> 真机 smoke：`cc remote-control start`（免 `--session`，走 envelope 关联）→ 跨进程 `status`（running）→ `stop` → `status`（空）全通；`cc agent -p --remote-control` 打印 direct 配对 URI → turn 正常完成 → 干净退出。

## 测试覆盖

共 **36 测试**（28 单元 + 8 真-WSServer 集成），全绿。

| 测试文件                             | 数量 | 覆盖                                                                                     |
| ------------------------------------ | ---- | ---------------------------------------------------------------------------------------- |
| `remote-control-lib.test.js`         | 22   | 配对 URI 编解码 / LAN 地址选取 / 状态文件读写(0600) / QR 渐进增强 / 默认 scopes           |
| `remote-control-start.test.js`（集成）| 2    | 真 WSServer 全链路：起 host → 设备仅凭 URI 载荷真 join → 一次性 token 二次 join 拒 → status 不泄 token → stop |
| `remote-session-client-hosted.test.js` | 6  | 控制事件转发 / 审计 / host 不可达不耗 commandId + 重连重试 / server-hosted 字节不变 / relay 加密投递 / push 只醒 request |
| `remote-approval-bridge.test.js`（集成）| 6  | 真 WSServer 设备扫 URI 配对 → gate ask → approve/deny → 幂等 replay → 本地 fallback 赛跑清远端 → 超时 fail-closed → approverCount |

## 安全考虑

- **会话协议是 envelope**：`session-create` 回包是一个信封，其 `id` 被重用为随机 eventId，真正的关联键是 `requestId`——`WsRpcClient` 因此按 `requestId` 优先匹配。误用 `id` 匹配会导致响应永远超时。
- **direct-LAN 模式的信任域**：direct-LAN 配对 URI 内嵌了 `serverToken`，这意味着**能读到该 URI/二维码的人 = 局域网信任域内的人**。仅在可信局域网内展示配对码；跨网络接管应用中继（E2EE）模式。
- **一次性配对令牌**：每个 `pairingToken` 用过即失效，二次 join 被拒——每台新设备需要重新出码。
- **审批 fail-closed**：远程审批在网络中断/超时时**默认拒绝**，绝不静默放行敏感操作。本地+远端并存时先答者胜，避免双重决议。
- **状态文件权限**：状态文件以 `0600` 落盘（仅属主可读），`status` 输出对服务令牌脱敏。
- **幂等前置的可达性检查**：HOST 不可达在幂等账本之前报错，确保失败不会白白消耗一个 commandId 序号。

## 故障排除

| 现象                              | 原因                                   | 处理                                                        |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| 配对后请求一直超时                | 客户端按 `id` 而非 `requestId` 匹配    | 用内置 `WsRpcClient`（已按 requestId 优先匹配）             |
| 终端没画二维码只有 URI            | 未安装可选 `qrcode` 包                 | `npm i -g qrcode` 后重试，或直接用打印的配对 URI           |
| 设备第二次扫码 join 被拒          | 一次性配对令牌已用过                   | 预期行为——重新 `start` 或为新设备出新码                     |
| `cc serve --remote-session-relay-url` 中继没启用 | （已修）此前 `resolveServerPolicy` 漏白名单键 | 升级到含修复的版本（`remoteSessionRelayUrl`/`PeerId` 已入白名单）|
| 远程审批一直不批就卡住            | 纯远端模式等待远端答复                 | 远端点批准/拒绝；或超时后 fail-closed 自动拒绝              |
| `status` 看不到刚起的会话         | 跨进程状态文件未写或端口不符           | 确认 `start` 成功、检查 `~/.chainlesschain/remote-control/` |

## 关键文件

| 文件                                                     | 职责                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/cli/src/commands/remote-control.js`            | `cc remote-control start/status/stop` CLI 编排（进程内起 host）  |
| `packages/cli/src/lib/remote-control.js`                 | 配对 URI 编解码、LAN 地址选取、状态文件读写、二维码渲染、默认 scopes |
| `packages/cli/src/lib/ws-rpc-client.js`                  | `WsRpcClient`——按 requestId 优先匹配 envelope 回包               |
| `packages/cli/src/lib/remote-approval-bridge.js`         | `RemoteApprovalBridge`——远程权限审批（request/resolve/fail-closed）|
| `packages/cli/src/gateways/ws/remote-session-protocol.js` | client-hosted 会话控制转发 + host 发布 fan-out（relay + push）   |
| `packages/cli/src/harness/remote-session-registry.js`    | 设备注册 / 撤销                                                  |
| `packages/cli/src/harness/remote-session-crypto.js`      | E2EE（X25519 + HKDF + AES-GCM）                                  |
| `packages/cli/src/harness/remote-command-ledger.js`      | 幂等 commandId 至多一次执行账本                                  |
| `packages/cli/src/runtime/policies/agent-policy.js`      | `resolveServerPolicy`（含 `remoteSessionRelayUrl`/`PeerId` 白名单）|

## 使用示例

### 1. 局域网直连接管（无中继）

```bash
cc remote-control start --qr
#   Remote control session started on ws://192.168.1.20:8790
#   Pairing URI: chainlesschain://remote-control/pair#eyJ2Ijox...
#   [二维码]
# 手机扫码即可观察 / 下发 prompt / 审批 / 打断
```

### 2. 经中继端到端加密接管（跨网络）

```bash
cc remote-control start --relay-url wss://relay.example/ws --qr
#   Pairing URI: chainlesschain://remote-session/pair#...
```

### 3. 查看并停止会话

```bash
cc remote-control status          # 列出运行中的会话（令牌脱敏）
cc remote-control stop --all      # 停掉全部
```

### 4. 让 Agent 的敏感操作走远程审批

```bash
cc agent -p "把 dist/ 部署到预发布并清理旧构建" --remote-control
# Agent 要删文件 / 跑破坏性 git 命令时，审批请求推送到已配对设备，
# 远端点「批准」才继续；超时则 fail-closed 拒绝。
```

## 相关文档

- [CLI Agent 模式](./cli-agent.md) — `cc agent -p` 无头执行（`--remote-control` 挂载点）
- [`cc serve` 服务模式](./cli-serve.md) — WS 服务 / `--allow-remote` 底座
- [长任务调度 `cc agenda`](./cli-agenda.md) — Monitor/Cron/Push 长任务调度（第四阶段姊妹能力）
- [权限系统](./permissions.md) — confirm 级审批门与权限模式
- [远程控制系统设计](./remote-control.md) — 模块 10 远程控制架构设计
- [CLI 对标 Claude Code 优化计划](/design/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN) Phase 5（Remote Control）
