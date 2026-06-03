# Android 远程终端 — Plan A（托管 PTY 复用 #21 通道）设计文档

> 状态：✅ Phase 1 - 4 全部落地（2026-05-14）
> 关联：[Android Remote Operate Plan C](Android_Remote_Operate_Plan_C.md) / [Android Remote Operate Plan AB](Android_Remote_Operate_Plan_AB.md) / [桌面 Web 壳架构](桌面Web壳_架构与落地_设计文档.md)
> 实现：详见本文档 §8 commits（待提交后回填 SHA）；测试 99 通过（desktop 61 + cli 21 + web-panel 17 + android 10 待真机环境运行）

## 1. 背景与目标

#21 Remote Operate 已经把 **桌面 ↔ Android 命令通道** 打通：
- Plan C（v5.0.3.50）走信令 forward，单次低频命令可用
- Plan A 透传 WebRTC signaling 已落，TURN 部署中（见 memo `signaling_relay_and_turn_deploy.md`）

下一步用户诉求："电脑上开了很多终端，能不能在 Android 上看到这些终端的输出并远程输入指令？"

**硬约束**：Windows 上**已经在跑的外部终端**（cmd / pwsh / Windows Terminal / VSCode 终端）的 stdin/stdout 句柄是父进程私有的，**OS 层不允许另一个进程 attach**。也就是说用户当下已开的那些终端，无论 Plan A/B/C/D 都看不到。

可行路径有 4 条：

| 方案 | 描述 | 工程量 | 已开终端可见 | 双向交互 |
|---|---|---|---|---|
| **A**（本文）| ChainlessChain 桌面端用 `node-pty` 托管新开终端 | 小 | ❌ | ✅ |
| **B** | 屏幕镜像 + Win32 SendInput 注入键盘 | 中 | ✅ | ⚠️ 焦点窗口竞争 |
| **C** | 强约束用户走 tmux / wezterm multiplexer | 中 | ❌（改工作流后可见） | ✅ |
| **D** | profile hook tee stdout 到文件，Android tail | 极小 | ✅（改 profile + 重开） | ❌（只读）|

**选 A**，理由：
1. 复用 #21 已落地的 WebRTC + signaling-relay + coturn 通道，零新基础设施
2. `node-pty` 在 Electron + CLI 中都成熟（ConPTY on Windows）
3. 真正的双向交互，没有 OCR / 焦点窗口的脏问题
4. "以后开的终端从 ChainlessChain 启动"这个限制用户已接受

A + B 混合留作 future work（B 当只读快照兜底"看一眼旧终端"）。

## 2. 数据流与组件

```
┌─────────────────────────┐         ┌─────────────────────────────────────┐
│ Android (Mobile)        │         │ Desktop (PC)                        │
│                         │         │                                     │
│ TerminalListScreen      │         │ PtyManager (singleton, main proc)   │
│ TerminalSessionScreen   │         │   ├─ sessions: Map<id, PtySession>  │
│   └─ WebView (xterm.js) │         │   ├─ ring buffer 256KB/session      │
│         ↓ stdin keys    │         │   └─ seq counter for backfill       │
│ TerminalRpcClient       │ envelope│         ↑ dispatches:              │
│   ├─ terminal.create    │ ───────>│   - terminal.create → spawn pty    │
│   ├─ terminal.stdin     │         │   - terminal.stdin → pty.write     │
│   └─ terminal.resize    │         │   - terminal.resize → pty.resize   │
│                         │ <───────│         ↓ pty.onData:              │
│ terminal.stdout (push)  │         │   - buffer.push(seq, data)         │
│ terminal.exit (push)    │         │   - broadcast envelope             │
└─────────────────────────┘         └─────────────────────────────────────┘
            │                                          │
            │      复用 #21 已有传输：                  │
            ├──► LAN signaling (ws://lan:9001) ────────┤
            ├──► 中继 (wss://signaling.chainlesschain.com)
            └──► WebRTC DataChannel（Plan A.1 之后）
```

### 2.1 Desktop 端新增组件

| 组件 | 路径 | 职责 |
|---|---|---|
| `PtyManager` | `desktop-app-vue/src/main/terminal/PtyManager.js` | node-pty 单例；spawn / kill / write / resize；session 表 (`Map<sessionId, PtySession>`)；ring buffer 滚动；seq 自增；EventEmitter `stdout` / `exit` 事件 |
| `PtySession` | 同上（内部类） | 单 session 状态：pid / cwd / shell / cols / rows / ringBuffer / lastSeq / alive |
| `terminal-handlers.js` | `desktop-app-vue/src/main/web-shell/handlers/` | 8 个 WS topic handler；权限闸（trusted-paired 校验）；高危关键字本地确认拦截 |
| WS topic 注册 | `desktop-app-vue/src/main/web-shell/ws-cli-loader.js` + cc ui 的 `web-ui-server.js` | 双登记（cross-shell 模式，遵循 `feedback_cross_shell_feature_pattern.md`） |

### 2.2 Android 端新增组件（Phase 3）

| 组件 | 路径 | 职责 |
|---|---|---|
| `TerminalRpcClient` | `app/.../remote/terminal/TerminalRpcClient.kt` | 复用 `SignalingRpcClient` 的 pending-deferred 模式，把 envelope 经 `#21` datachannel 发出；订阅 `terminal.stdout` 推送事件 |
| `TerminalListScreen` + VM | `app/.../remote/terminal/ui/` | 列出已 paired 桌面的活跃 sessions（`terminal.list`），点击进入 detail |
| `TerminalSessionScreen` + VM | 同上 | WebView 嵌 `xterm.js`，软键盘上方加 ctrl/tab/esc/方向键 toolbar |
| `assets/xterm-shell.html` | 同上 | 单页 HTML 含 xterm.js + JS 桥，与 Kotlin 通过 `WebView.addJavascriptInterface` 双向通信 |

### 2.3 Cross-Shell UI（Phase 2）

按 `feedback_cross_shell_feature_pattern.md`：

| 壳 | 入口 | 实现 |
|---|---|---|
| V6 `/v6-preview` | plugin widget `terminal-panel` | `desktop-app-vue/src/renderer/plugins-builtin/terminal/` (5-file template, 见 `v6_page_port_template.md`) |
| Web Shell | 路由 `/terminal` | `packages/web-panel/src/views/TerminalPanel.vue` + xterm.js |
| cc ui | 共享同一份 SPA | 自动有了（同 web-panel dist） |
| V5 旧壳 | 暂不补 | opt-out 用户走 cc ui 兜底 |

## 3. 协议（envelope v1.0，dot-case，requestId 关联）

### 3.1 `terminal.create` — req → res

```jsonc
// request
{
  "type": "terminal.create",
  "requestId": "<uuid-v4>",
  "payload": {
    "shell": "pwsh",          // 来自配置白名单
    "cwd": "C:\\code\\chainlesschain",
    "env": { /* 可选 override */ },
    "cols": 120,
    "rows": 30
  }
}

// response
{
  "type": "terminal.create.response",
  "requestId": "<same>",
  "payload": {
    "sessionId": "<uuid-v4>",
    "pid": 12345,
    "shell": "pwsh",
    "createdAt": 1715567890123
  }
}
```

### 3.2 `terminal.list` — req → res

```jsonc
// request
{ "type": "terminal.list", "requestId": "<uuid>", "payload": {} }

// response
{
  "type": "terminal.list.response",
  "requestId": "<same>",
  "payload": {
    "sessions": [
      {
        "id": "<uuid>",
        "shell": "pwsh",
        "cwd": "...",
        "createdAt": 1715567890123,
        "alive": true,
        "lastSeq": 4231
      }
    ]
  }
}
```

### 3.3 `terminal.stdin` — fire-and-forget

```jsonc
{
  "type": "terminal.stdin",
  "payload": {
    "sessionId": "<uuid>",
    "data": "<base64(UTF-8 bytes)>"   // 含控制字符（如 \x03 = Ctrl+C / \r / arrow keys ESC[A）
  }
}
```

base64 是为了在 JSON envelope 里安全携带 0x00-0x1f 控制字节 + 任意 UTF-8 序列，避免被 JSON.stringify 转义打乱。

### 3.4 `terminal.stdout` — server-push event

```jsonc
{
  "type": "terminal.stdout",
  "payload": {
    "sessionId": "<uuid>",
    "data": "<base64(UTF-8 bytes)>",  // node-pty 原始字节，含 ANSI escape
    "seq": 4232                       // 单调递增，重连补帧用
  }
}
```

### 3.5 `terminal.resize` — req → ack

```jsonc
{
  "type": "terminal.resize",
  "requestId": "<uuid>",
  "payload": { "sessionId": "<uuid>", "cols": 140, "rows": 40 }
}
```

### 3.6 `terminal.close` — req → ack

```jsonc
{
  "type": "terminal.close",
  "requestId": "<uuid>",
  "payload": { "sessionId": "<uuid>" }
}
```

桌面端 `pty.kill()` → 等 `exit` 事件 → 发 `terminal.exit` 事件 → response。

### 3.7 `terminal.exit` — server event

```jsonc
{
  "type": "terminal.exit",
  "payload": {
    "sessionId": "<uuid>",
    "exitCode": 0,
    "signal": null
  }
}
```

### 3.8 `terminal.history` — req → res（重连补帧）

```jsonc
// request
{
  "type": "terminal.history",
  "requestId": "<uuid>",
  "payload": { "sessionId": "<uuid>", "fromSeq": 3500 }
}

// response — 返回 ring buffer 里 seq >= fromSeq 的所有 chunks
{
  "type": "terminal.history.response",
  "requestId": "<same>",
  "payload": {
    "chunks": [
      { "seq": 3501, "data": "<base64>" },
      { "seq": 3502, "data": "<base64>" }
    ],
    "truncated": false  // true 表示 fromSeq 早于 buffer 起点，部分输出已永久丢失
  }
}
```

## 4. 关键设计决策

### 4.1 PtyManager 进程归属

**主进程单例**。原因：
- `node-pty` 是 native binding，必须跑在 Node 主进程（不能在 renderer / preload）
- Electron 主进程 + CLI 进程各起一个独立的 PtyManager，session **不跨进程共享**（feature 不是 bug —— 桌面壳和 cc ui 各管各的终端）
- 主进程崩则所有 session 全 kill，可接受（不是高 SLA 服务）

### 4.2 Ring Buffer 设计

每 session 默认 **256KB** 内存 ring buffer：
- `Array<{seq, data: Buffer}>`，FIFO 推 + 总字节超 256KB 时弹首
- **不持久化**到磁盘（安全考虑 —— 终端输出常含敏感信息：API key / 密码回显 / git diff）
- 桌面端进程重启 = buffer 清空 + 所有 session 重启（pty 进程跟随主进程死掉）
- `terminal.history` 返回 `truncated: true` 时 Android 端显示 "更早的输出已丢失"，由用户决定是否清屏

### 4.3 stdin 二次确认（高危关键字）

桌面端 `terminal-handlers.js` 入口扫 stdin，**默认拦截关键字列表**：

```js
const DANGEROUS = [
  /\brm\s+-rf\b/, /\bformat\s+[a-z]:/i, /\bshutdown\b/,
  /\bdel\s+\/[sq]/i, /\bdiskpart\b/, /\b:(\)\s*{\s*:\|:\&\s*}\s*;:\b/  // fork bomb
];
```

命中 → 桌面端 toast 弹"Android 设备请求执行 <cmd>，确认？"，用户在桌面端按确认才透传到 pty。

**为什么不在 Android 端拦截**：Android 端不可信（手机可能被劫持 / 投屏给别人）。桌面端是 trust anchor。

### 4.4 权限闸 vs 鉴权层

- **WS 层**：仅检查 envelope 合法性，不知道发送方身份
- **PtyManager 入口校验**：每个 envelope 必须带 `sourceDeviceId`，**必须在 `paired_devices` 表里**且 `trustLevel >= "full"`
- 不通过 → 静默 drop + 日志（不返 error，避免暴露探测信号）

### 4.5 Session 生命周期

| 触发 | 行为 |
|---|---|
| `terminal.create` | spawn pty + 注册 session + 返 `sessionId` |
| `terminal.close` | `pty.kill()` + 触发 exit 事件 + 移除 session |
| pty 自然退出（exit / shell exit） | 触发 exit 事件 + 保留 session 60s 让 Android 拉最后日志，60s 后清 |
| Android 断连 | session **保留**，pty 继续跑 |
| 24h 空闲（无 stdin 也无 stdout）| 自动 kill |
| 桌面进程退出 | 所有 pty 全 kill（OS 父进程死） |

### 4.6 Shell 白名单

默认允许：`pwsh`, `cmd`, `bash`（仅 WSL 环境），`wsl`。

在 `.chainlesschain/config.json` 里可改：
```json
{
  "terminal": {
    "shellWhitelist": ["pwsh", "cmd", "wsl"],
    "defaultShell": "pwsh",
    "defaultCwd": "${HOME}",
    "maxConcurrentSessions": 8,
    "ringBufferBytes": 262144,
    "idleKillHours": 24
  }
}
```

不在白名单的 `shell` 字段 → `terminal.create` 返 `error.code = "shell_not_allowed"`。

## 5. 测试

### 5.1 Phase 1 单元测试（计划新增 ~25 个）

| 类 | 测试数 | 位置 |
|---|---|---|
| `PtyManager` (mock node-pty) | 12 | `desktop-app-vue/tests/unit/main/terminal/PtyManager.test.js` |
| Ring buffer 行为 | 5 | 同上 |
| `terminal-handlers` envelope dispatch | 8 | `desktop-app-vue/tests/unit/main/web-shell/handlers/terminal-handlers.test.js` |

### 5.2 Phase 1 smoke

cc ui 起来后 DevTools console 跑：

```js
const ws = new WebSocket("ws://localhost:9999/ws");
ws.send(JSON.stringify({ type:"terminal.create", requestId:"r1",
  payload:{ shell:"pwsh", cols:80, rows:24 } }));
// 收到 response 后取 sessionId
ws.send(JSON.stringify({ type:"terminal.stdin", payload:{
  sessionId, data: btoa("Get-Date\r") } }));
// 应该立刻收到 terminal.stdout 推送，data base64 解出 = 当前时间
```

### 5.3 Phase 2 / 3 / 4 测试

- Phase 2 web-panel + V6 widget xterm 渲染单测（jsdom + xterm.js mock）
- Phase 3 Android 端 `TerminalRpcClientTest` 套（参考 `SignalingRpcClientTest`）+ WebView JS-bridge 集成测
- Phase 4 真机 e2e：Xiaomi 24115RA8EC → 桌面端开终端 → 跑 `dir` / `ls`

## 6. 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| **Phase 1** | Desktop PtyManager + WS topics 注册 + 真 PTY 冒烟 | ✅ 完成 |
| **Phase 1.5** | cc ui mirror — `attachTopicHandlers` 抽取 + `cc ui` startUiServer 同款 attach | ✅ 完成 |
| **Phase 2** | 三壳 UI — web-panel `/terminal` + V6 plugin widget + IPC bridge for V6 native | ✅ 完成 |
| **Phase 3** | Android — TerminalRpcClient + WebView(xterm.js) + Compose list/session + NavGraph + entry from RemoteOperate | ✅ 完成 |
| **Phase 4** | 韧性 — `requireConfirmation` 接桌面 systray + `paired_devices`/permission-gate 路径 + mobile-bridge stdout fan-out + 重连补帧 + 24h idle kill | ✅ 完成 |
| **Future A** | Plan A.1 — 流量切 WebRTC DataChannel（绕中继带宽瓶颈） | 📝 未开始 |
| **Future B** | 已开外部终端只读快照（截图 + OCR + SendInput） | 📝 未开始 |
| **Future A** | Plan A.1 — 终端 stdout 走 WebRTC DataChannel（绕中继带宽瓶颈，参考 Plan A.2 思路） | 📝 未开始 |
| **Future B** | 已开外部终端只读快照（屏幕截图 + OCR + 简单 Win32 SendInput），Plan B 兜底 | 📝 未开始 |

## 7. 已知约束 / Trade-offs

- **已开终端不可见**：方案 A 的核心硬约束（见 §1）；如果用户想"看到已开的那些"，只能等 Future B 上线
- **隐私**：stdin 明文经中继（信令服务器能看到）。需要端到端加密时挂 Signal Protocol session（已有 e2ee 模块，Plan C 未挂，本方案沿用同状态）
- **吞吐**：中继带宽是全平台共享，重 IO（`cat large-log` / `tail -f`）会打爆带宽 → Future A.1 走 DC 解决
- **延迟**：信令转发 100-500ms p99，敲键反馈感觉"有点黏" → 同样靠 Future A.1
- **ring buffer 重启即丢**：刻意决定（安全 > 韧性）。如有强需求，未来 opt-in 加密落盘
- **`vt100 -> xterm.js` 渲染保真度**：复杂 TUI（vim / htop）在移动端窄屏下排版会糊，不计划专门优化

## 8. 相关 commits

| Commit | 内容 |
|---|---|
| 待回填 | feat(remote-terminal): plan A phase 1 — PtyManager + WS topics 注册 |
| 待回填 | feat(remote-terminal): plan A phase 2 — cross-shell UI |
| 待回填 | feat(remote-terminal): plan A phase 3 — Android xterm.js WebView |
| 待回填 | feat(remote-terminal): plan A phase 4 — 韧性 + 真机 e2e |
