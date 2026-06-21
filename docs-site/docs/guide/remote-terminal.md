# 远程终端（Android 操控桌面 PTY）

> 让已配对的 Android 手机在 ChainlessChain 桌面端**新开终端会话**，远程查看输出并输入指令。复用 #21 Remote Operate 的 signaling-relay + WebRTC 通道，零新基础设施。

## 1. 概述

ChainlessChain 桌面端通过 `node-pty` 托管新开的 shell（pwsh / cmd / bash / wsl），把 stdout 推送到已配对的 Android 设备；Android 端在 xterm.js WebView 里渲染并发送 stdin 回桌面。

- 启动入口：桌面 V6 壳 `/v6-preview` → "去中心化" 工具栏 → 远程终端；Web Shell `/terminal`；cc ui 同一份页面
- Android 入口：首页"已连接桌面"卡片 → "远程终端"
- 适用：日常开发命令、查日志、改配置、跑测试；**不适用**已经在跑的外部终端（cmd / Windows Terminal / VSCode 终端）—— 操作系统层不允许另一个进程读它们的 stdout

## 2. 核心特性

| 特性              | 说明                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| 托管 PTY          | 桌面端用 `node-pty` 自己 spawn 终端，session 表统一管理                                   |
| 跨壳一致          | V6 preview / Web Shell / cc ui 共享同一份 `<TerminalPanel>` Vue 组件 + xterm.js           |
| 韧性补帧          | 每 session 256KB ring buffer + `terminal.history` 按 `seq` 补帧；Android 断连重连自动续接 |
| 高危拦截          | 桌面端扫 stdin 关键字（`rm -rf` / `format` / `shutdown` / fork bomb），命中弹桌面端确认   |
| Shell 白名单      | `.chainlesschain/config.json` 配 `shellWhitelist`，不在表内的 shell 直接拒绝创建          |
| trusted-paired 闸 | 只接受 `paired_devices` 表中 `trustLevel >= "full"` 的设备 envelope                       |
| 24h 空闲 kill     | session 24h 内无 stdin/stdout 自动 kill，防遗忘                                           |
| 不落盘            | ring buffer 仅内存；进程重启等于清空（安全 > 韧性的取舍）                                 |

## 3. 系统架构

```
┌─────────────────────────────┐         ┌─────────────────────────────────┐
│ Android                     │         │ Desktop (Electron 主进程)        │
│                             │         │                                 │
│ TerminalSessionScreen       │         │ PtyManager（单例）              │
│   └─ WebView (xterm.js)     │         │   ├─ sessions: Map<id, ...>     │
│         ↓ stdin             │ envelope│   ├─ ring buffer 256KB/session  │
│ TerminalRpcClient           │ ───────>│   ├─ seq counter                │
│   ↓ 复用 #21 通道           │         │   └─ EventEmitter (stdout/exit) │
│ SignalingGate / DataChannel │         │   ↑                             │
│                             │ <───────│ terminal-handlers.js            │
│                             │         │   ├─ envelope dispatcher        │
│                             │         │   ├─ trusted-paired 闸          │
│                             │         │   └─ 高危关键字拦截             │
└─────────────────────────────┘         └─────────────────────────────────┘
              │                                          │
              │      复用 #21 已落传输：                  │
              ├──► LAN signaling (ws://lan:9001) ────────┤
              ├──► 中继 (wss://signaling.chainlesschain.com)
              └──► WebRTC DC (Plan A.1 后开启)
```

## 4. 系统定位

远程终端是 **#21 Remote Operate 体系下的高交互力子能力**：

- **Plan C** 走信令 forward，适合点按钮发单条命令
- **Plan A 远程终端**（本功能）走同一管道，但提供**持续会话 + 流式 stdout + 任意 stdin**
- **未来 Plan A.1** 把终端流量切到 WebRTC DataChannel，绕过中继带宽瓶颈

不替代桌面本地终端，是它在移动端的"远程显示器 + 键盘"。

## 5. 核心功能

### 5.1 三种入口

| 壳         | 路由 / 入口                       | 说明                                               |
| ---------- | --------------------------------- | -------------------------------------------------- |
| V6 Preview | `/v6-preview` → 工具栏 "远程终端" | plugin widget，与 Knowledge / Memory 等同框架      |
| Web Shell  | `/terminal`                       | 桌面 Electron 内嵌 ws-server，BrowserWindow 直加载 |
| cc ui      | 同 `/terminal`                    | CLI 起一个本地 ws-server + 浏览器打开同份 SPA      |

V5 旧壳不补，opt-out 用户走 cc ui 兜底。

### 5.2 Session 操作

| 操作     | UI                                   | 协议 envelope                                  |
| -------- | ------------------------------------ | ---------------------------------------------- |
| 创建     | 顶栏 "+ 新会话" 按钮，选 shell + cwd | `terminal.create`                              |
| 列出     | 左侧 session 列表                    | `terminal.list`                                |
| 输入     | xterm.js 接管键盘                    | `terminal.stdin`（含特殊键如 Ctrl+C = `\x03`） |
| 输出     | xterm.js 渲染 ANSI                   | `terminal.stdout`（server push）               |
| 调整窗口 | 容器 resize 自动触发                 | `terminal.resize`                              |
| 关闭     | 标签 "×" 按钮                        | `terminal.close`                               |
| 历史补帧 | 重连后自动补                         | `terminal.history`                             |

### 5.3 Android 软键盘补键

底部 toolbar：`Ctrl` / `Tab` / `Esc` / `↑↓←→` / `Ctrl+C` / `Ctrl+D`。

Ctrl 是 sticky modifier（点亮后下一个字符自动组合发送）。

### 5.4 高危关键字拦截

桌面端默认拦截：

- `rm -rf`
- `format <drive>:`
- `shutdown`
- `del /s` / `del /q`
- `diskpart`
- bash fork bomb `:(){:|:&};:`

命中后桌面端 systray 弹气泡 "Android 设备请求执行：`<cmd>` —— 确认 / 拒绝 / 永久信任本设备"。**Android 端无法绕过**（手机被劫持也只能发请求，桌面是 trust anchor）。

## 6. 技术架构

| 层         | 技术                                                                             | 说明                                              |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| PTY native | `node-pty` (ConPTY on Windows)                                                   | 主进程单例，多 session 共享                       |
| 传输       | 复用 #21 signaling-relay (`wss://signaling.chainlesschain.com`) + 后续 WebRTC DC | LAN / WAN 同一根管道                              |
| Envelope   | 协议 v1.0（dot-case + `requestId`）                                              | 与 `coding-agent-envelope-roundtrip` 同模式       |
| WS 网关    | 桌面内嵌 + cc ui 各注册一份                                                      | 遵循 cross-shell 双登记                           |
| UI 渲染    | Vue 3.4 + xterm.js                                                               | V6 / web-shell / cc ui 共享 `<TerminalPanel>`     |
| Android UI | Compose + WebView（嵌 xterm.js）                                                 | 移动端 VT100 emulator 太重，用 WebView 性价比最高 |
| 序列化     | base64(UTF-8 bytes) over JSON                                                    | 避开控制字符在 JSON 中的转义陷阱                  |

## 7. 系统特点

- **零基础设施新增** — 完全复用 #21 已部署的 signaling-relay + coturn
- **trust anchor 在桌面** — Android 不可信（手机被劫持 / 投屏），高危确认必须在桌面端完成
- **ring buffer 不落盘** — 终端输出常含敏感信息（API key 回显、`git diff` 含密钥、密码错回显），刻意只在内存
- **跨壳一份代码** — 三壳共享同一个 Vue 组件，bug fix 一次三处生效
- **session 解耦设备** — Android 断连后桌面端 pty 继续跑（除非主动 close 或 24h 空闲）
- **失败显式** — 不在 stdin/stdout 中静默吞错；任何 envelope 拒绝都返 `error.code`（除 trusted-paired 闸 silent drop 防探测）

## 8. 应用场景

| 场景                     | 用法                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| **出差路上看 CI**        | 远程开会话跑 `gh run watch <id>`，stdout 流到手机                  |
| **家里改服务器配置**     | 桌面端在公司，远程开 wsl 会话编辑配置 + 重启服务                   |
| **演示给同事看命令输出** | 桌面端开会话跑 demo，会议室同事手机 join 远程终端围观              |
| **凌晨被告警唤起**       | 不开电脑，手机直接 `kubectl get pods` / `docker logs`              |
| **培训学员**             | 讲师桌面端开教学会话，学员手机看实时输出（read-only 模式后续支持） |

## 9. 竞品对比

| 能力                                        | 远程终端 (Plan A) | Termius                 | JuiceSSH | Tailscale SSH        |
| ------------------------------------------- | ----------------- | ----------------------- | -------- | -------------------- |
| 远程控制本机已托管终端                      | ✅                | ❌（只能 SSH 远程主机） | ❌       | ❌                   |
| 零新基础设施（复用配对通道）                | ✅                | ❌ 自己装 SSH server    | ❌       | ❌ 需 Tailscale      |
| 与桌面信任链一体（U-Key / DID）             | ✅                | ❌ 独立密钥             | ❌       | ⚠️ 走 Tailscale 身份 |
| 高危关键字桌面端二次确认                    | ✅                | ❌                      | ❌       | ❌                   |
| stdin/stdout 完全 P2P（无中心服务器看明文） | 🚧 (Plan A.1)     | ❌ 中转走 SSH server    | ❌       | ⚠️                   |
| 软键盘补键 toolbar                          | ✅                | ✅                      | ✅       | —                    |
| 移动端 ANSI 渲染                            | ✅ (xterm.js)     | ✅                      | ✅       | —                    |

## 10. 配置参考

### 10.1 桌面端 `.chainlesschain/config.json`

```json
{
  "terminal": {
    "shellWhitelist": ["pwsh", "cmd", "wsl"],
    "defaultShell": "pwsh",
    "defaultCwd": "${HOME}",
    "maxConcurrentSessions": 8,
    "ringBufferBytes": 262144,
    "idleKillHours": 24,
    "dangerousPatterns": [
      "\\brm\\s+-rf\\b",
      "\\bformat\\s+[a-z]:",
      "\\bshutdown\\b"
    ],
    "permanentTrustedSources": []
  }
}
```

字段含义：

- `shellWhitelist` — 允许 `terminal.create` 传入的 shell 名
- `maxConcurrentSessions` — 同时存活的 session 上限（含 Android 断连后仍跑的）
- `ringBufferBytes` — 单 session 输出缓冲（不落盘）
- `idleKillHours` — 无 IO 多久后自动 kill
- `dangerousPatterns` — 正则数组，命中则桌面端弹确认
- `permanentTrustedSources` — 用户在确认弹窗里勾"永久信任本设备"后写进来的 deviceId 列表

### 10.2 Android 端

无新配置。复用 `PairedDesktopsStore`（见 [Plan C 设计文档](/design/Android_Remote_Operate_Plan_C)），首页"已连接桌面"卡片就有"远程终端"入口。

## 11. 性能指标

目标值（Phase 1 落地后实测回填）：

| 指标                                                          | 目标                                |
| ------------------------------------------------------------- | ----------------------------------- |
| `terminal.create` 端到端（Android 点 + 到第一个 prompt 渲染） | ≤ 1500 ms（LAN）/ ≤ 3000 ms（中继） |
| stdin 敲键到 stdout 回显 p50                                  | ≤ 200 ms（LAN）/ ≤ 500 ms（中继）   |
| stdin 敲键到 stdout 回显 p99                                  | ≤ 500 ms（LAN）/ ≤ 1500 ms（中继）  |
| 桌面 PtyManager spawn 单 session                              | ≤ 200 ms                            |
| ring buffer push 单条 4KB                                     | ≤ 0.1 ms                            |
| 重连 `terminal.history` 补 100KB                              | ≤ 800 ms（中继）                    |

Plan A.1 把流量切到 DataChannel 后中继路径应降到接近 LAN。

## 12. 测试覆盖

| 层                            | 文件                                                           | 用例 | 状态       |
| ----------------------------- | -------------------------------------------------------------- | ---- | ---------- |
| 主进程 — PtyManager           | `tests/unit/main/terminal/PtyManager.test.js`                  | 17   | 🚧 Phase 1 |
| 主进程 — handlers             | `tests/unit/main/web-shell/handlers/terminal-handlers.test.js` | 8    | 🚧 Phase 1 |
| WS smoke                      | DevTools console 手敲                                          | 1    | 🚧 Phase 1 |
| Web Panel — TerminalPanel.vue | `packages/web-panel/src/views/__tests__/TerminalPanel.test.ts` | TBD  | 📝 Phase 2 |
| V6 Plugin Widget              | `tests/unit/renderer/plugins-builtin/terminal/*.test.ts`       | TBD  | 📝 Phase 2 |
| Android — TerminalRpcClient   | `app/.../remote/terminal/TerminalRpcClientTest.kt`             | TBD  | 📝 Phase 3 |
| 真机 e2e                      | Xiaomi 24115RA8EC + 桌面 + 中继                                | 烟雾 | 📝 Phase 4 |

## 13. 安全考虑

| 威胁                              | 缓解                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **未配对设备发命令**              | trusted-paired 闸：deviceId 必须在 `paired_devices` 表中且 `trustLevel >= "full"`                           |
| **Android 端被劫持远程 `rm -rf`** | 桌面端高危关键字拦截，必须本机用户确认                                                                      |
| **shell 任意路径**                | shellWhitelist，未列入直接 `error.code = "shell_not_allowed"`                                               |
| **中继看到明文 stdin/stdout**     | 当前 wss TLS 但中继可见 payload；Plan A.1 切 DC 后端到端 P2P；进一步可挂 Signal session（与 Plan C 同状态） |
| **敏感输出磁盘泄漏**              | ring buffer 仅内存，进程重启清空                                                                            |
| **session 永生**                  | 24h 空闲自动 kill + 桌面 systray 红点提示活跃数                                                             |
| **WS envelope 探测**              | trusted-paired 闸 silent drop 而非返 error，避免暴露认证状态                                                |
| **stdin 注入控制序列**            | base64 编码 + xterm.js 由 PTY 端真实回显校验，不在传输层解析                                                |

## 14. 故障排除

### 14.1 Android 点 "+ 新会话" 没反应

- 桌面端 systray 看 ChainlessChain 图标是否变红点；如有，是高危关键字弹窗未确认 → 点桌面图标处理
- 桌面端 DevTools 看主进程日志搜 `PtyManager.create`；如报 `shell_not_allowed`，改 `.chainlesschain/config.json` 的 `shellWhitelist`
- 检查设备配对状态：`cc p2p devices --type mobile` 看 `trustLevel`

### 14.2 stdout 卡住不动

- Android 端右上拉刷新 → 触发 `terminal.history` 补帧
- 看 session 在桌面端是否还活着：`cc terminal list`（Phase 4 后提供）
- 中继宕机：切 LAN signaling（同 Plan C fallback 路径）

### 14.3 输出乱码

- 桌面端确认 chcp 65001 已生效（编码 rules 已自动跑）
- xterm.js 渲染特定 TUI（vim / btm）糊：移动端窄屏排版限制，建议改用宽屏

### 14.4 重连后历史丢了

- ring buffer 256KB 限：超过这个量的更早输出无法补，Android 端会显示 "更早输出已丢失"
- 想保留长会话历史 → 后续 opt-in 加密落盘（roadmap，未实现）

### 14.5 高危关键字误拦

- 临时绕过：从桌面端本地终端跑这条命令
- 永久放行：弹窗里勾"永久信任本设备 + 此命令"（仍有 audit log）
- 或修改 `.chainlesschain/config.json` 的 `dangerousPatterns` 正则

## 15. 关键文件

### 15.1 桌面主进程

```
desktop-app-vue/src/main/terminal/
  PtyManager.js               # node-pty 单例 + session 表 + ring buffer
  RingBuffer.js               # ring buffer 实现（独立可测）

desktop-app-vue/src/main/web-shell/handlers/
  terminal-handlers.js        # 8 个 WS topic handler + trusted-paired 闸
```

### 15.2 Web Panel（三壳共享）

```
packages/web-panel/src/views/
  TerminalPanel.vue           # 主组件，xterm.js 嵌入

packages/web-panel/src/components/terminal/
  TerminalTabs.vue            # 多 session 标签
  SessionItem.vue             # 单 session 标签项
  NewSessionDialog.vue        # "+ 新会话" 弹窗
```

### 15.3 V6 Plugin

```
desktop-app-vue/src/renderer/plugins-builtin/terminal/
  plugin.json                 # builtin: firstParty
  Widget.vue                  # 内嵌 TerminalPanel.vue
  widgets/index.ts            # 注册到 widget-registry
```

### 15.4 Android

```
mobile-app-android/app/src/main/java/.../remote/terminal/
  TerminalRpcClient.kt        # envelope 收发 + pending deferred
  TerminalListScreen.kt       # session 列表
  TerminalSessionScreen.kt    # 单 session 全屏 WebView
  WebViewBridge.kt            # JS ↔ Kotlin 双向
  assets/xterm-shell.html     # 嵌 xterm.js + JS 桥
```

## 16. 使用示例

### 16.1 第一次使用（Phase 4 完工后）

1. 桌面端打开 ChainlessChain，确认右下角 systray 图标
2. Android 端首页"已连接桌面"卡片 → 点 PC 名 → "远程终端"
3. 顶栏 "+ 新会话" → 选 `pwsh` + 默认 cwd → 确认
4. xterm.js 显示 PowerShell prompt → 软键盘输入 `Get-Date` + 回车
5. 桌面端时间显示在手机上

### 16.2 跑长时间任务并断连

1. Android 端开会话 → 输入 `npm run build`
2. 手机切到别的 app（或熄屏 30 分钟）
3. 回到 ChainlessChain → 自动重连 → `terminal.history` 补帧 → 看到完整构建日志
4. 如超过 256KB 上限会顶部显示 "更早输出已丢失"

### 16.3 高危确认实战

1. Android 不小心粘了 `rm -rf .git`
2. 桌面 systray 红点闪烁 → 点开弹窗"Android 设备请求执行 `rm -rf .git`"
3. 桌面端按 "拒绝" → Android 端 toast "命令被桌面端拒绝"
4. Android 端 stdin 缓冲不变（不消费），可以编辑后重发

## 17. 相关文档

- [设计文档 · Android 远程终端 Plan A](/design/Android_Remote_Terminal_Plan_A) — 协议 / 数据流 / 测试 / 路线图
- [设计文档 · Android Remote Operate Plan C](/design/Android_Remote_Operate_Plan_C) — 信令 forward 命令通道，Plan A 复用其传输
- [设计文档 · 桌面 Web 壳架构](/design/desktop-web-shell-architecture) — 三壳共享 web-panel 的整体策略
- [桌面版 V6 对话壳](/guide/desktop-v6-shell) — V6 / web-shell 路由背景

---

**版本历史**

| 版本 | 日期       | 说明                                 |
| ---- | ---------- | ------------------------------------ |
| v0.1 | 2026-05-14 | 设计与用户文档初稿，Phase 1 即将开工 |
