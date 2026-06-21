# 移动端推送通知（cc notification）

> **版本: v1.3+ #21 | 状态: ✅ 生产可用 | 10 单元测试全绿**
>
> `cc notification`（别名 `cc notif`）从命令行向**已配对的 iPhone / Android 设备**推送通知。CLI 不直接连手机：它通过桌面 app 的 ws-bridge 把请求交给桌面进程，由桌面经 P2P DataChannel 推送到配对设备。该命令最初为 iOS 真机 E2E 计划（`iOS_Phase_6_0_RealDevice_E2E_Plan.md` §6 D2/D3/D6 复现器）落地。

## 概述

桌面 Electron app 以 `--web-shell` 模式运行时会启动一个 ws-bridge（操作系统分配端口），并把绑定的 URL 写入 `~/.chainlesschain/desktop.port`。`cc notification send` 读取该文件、打开 WebSocket、调用 `notification.send-mobile` topic——它路由到桌面进程内的 `remoteGateway.handlers.notification.sendToMobile`，再经 P2P DC 推到配对的手机。

整条链路对 CLI 而言是一次带超时的 RPC：发送帧、按 `id` 匹配响应帧、根据 `ok` 字段判定成败，并以**区分性退出码**返回，方便脚本与 E2E 编排。

## 核心特性

- 📲 **推送到配对手机**：按目标设备 DID（`--target`）推送标题 + 正文
- 🔇 **静默投递（`--silenced`）**：只投递信封不响铃，用于勿扰时段（quiet hours）测试
- 🏷️ **通知类型（`--type`）**：语义类型随帧的 `notificationType` 字段传递，默认 `app`
- ⏱️ **可配 RPC 超时**：`--timeout <ms>`，默认 10000，强制夹取在 1000–120000ms
- 🧟 **残留文件检测（stale-pid）**：port 文件存在但写入进程已退出时明确报错，而非挂死
- 🧹 **帧过滤**：按 `requestId`（`crypto.randomUUID()`）匹配响应，无关帧（ws-bridge 的其它订阅者）直接忽略
- 🤖 **`--json` 机器可读输出** + 区分性退出码（0/2/3/4），适合 CI / E2E 脚本

### 退出码

| 退出码 | 含义                                                              |
| ------ | ----------------------------------------------------------------- |
| `0`    | 推送成功                                                          |
| `2`    | 桌面 port 文件缺失 / 不可读 / 格式错误 / pid 已退出（桌面未运行） |
| `3`    | 桌面返回 `ok:false` / handler 不可用 / 网络或协议错误 / RPC 超时  |
| `4`    | 参数非法                                                          |

## 系统架构

```
┌────────────────────────────┐
│ cc notification send       │
│  --target <did> --title …  │
└──────────────┬─────────────┘
               │ ① 读 ~/.chainlesschain/desktop.port（wsUrl + pid 活性检查）
               ▼
┌────────────────────────────┐   ② WebSocket 帧
│ 桌面 app ws-bridge          │   type: notification.send-mobile
│ （--web-shell 启动时写入     │   { id, title, body, target,
│   desktop.port）            │     silent, notificationType }
└──────────────┬─────────────┘
               │ ③ 路由到 remoteGateway.handlers
               │    .notification.sendToMobile
               ▼
┌────────────────────────────┐   ④ P2P DataChannel
│ 已配对 iPhone / Android     │◄──  推送通知（响铃或静默）
└────────────────────────────┘
   ⑤ 结果帧 notification.send-mobile.result（按 id 匹配）原路返回
```

## 命令参考

```bash
cc notification send --target <did> --title <title> [选项]
cc notif send --target <did> --title <title>          # 别名
```

| 选项              | 必填 | 默认    | 说明                                              |
| ----------------- | ---- | ------- | ------------------------------------------------- |
| `--target <did>`  | ✅   | —       | 目标设备 DID（已配对的 iPhone/Android）           |
| `--title <title>` | ✅   | —       | 通知标题                                          |
| `--body <body>`   |      | `""`    | 通知正文                                          |
| `--silenced`      |      | 关      | 只投递不响铃（勿扰时段测试）                      |
| `--type <type>`   |      | `app`   | 通知语义类型（随帧 `notificationType` 传递）      |
| `--timeout <ms>`  |      | `10000` | RPC 超时，强制夹取在 1000–120000ms                |
| `--json`          |      | 关      | 输出机器可读 JSON（成功走 stdout，失败走 stderr） |

## 配置参考

- **port 文件**：`~/.chainlesschain/desktop.port`——由桌面 app（`--web-shell` 模式）写入的 JSON 描述符，必须包含字符串字段 `wsUrl`；可选 `pid` 用于活性检查。
- **wire 协议**：请求帧 `type` 即 topic 名（`notification.send-mobile`），通知语义类型走 `frame.notificationType`；响应帧 `type` 为 `notification.send-mobile.result`，按 `id` 与请求配对。
- **pid 活性检查**：`process.kill(pid, 0)` 只探测进程存在性、不发送任何信号；`ESRCH` 判定为残留文件（退出码 2），`EPERM`（进程存在但无权限）视为存活、继续连接。
- **无独立配置文件**：本命令不读 `config.json`，所有行为由 flag 控制。

## 性能指标

- **RPC 超时**：默认 **10000ms**，下限 **1000ms**、上限 **120000ms**（代码内 `Math.max(1000, Math.min(120000, …))` 强制夹取，非法值回落默认）。
- **超时处置**：到时 `socket.terminate()` 强断，返回 `rpc_timeout`（退出码 3）。
- **单帧单响应**：一次调用只发一帧、等一帧匹配响应，无重试逻辑；重试由调用方脚本决定。
- 端到端投递延迟取决于 P2P DC 链路，基准数据待补。

## 测试覆盖

`packages/cli/__tests__/unit/notification-send.test.js` —— **10** 个测试（`it(` 计数），覆盖 port 文件缺失/格式错误/stale-pid、帧构造、超时、无关帧忽略、ok:false、JSON 输出等路径（经 `_deps` 注入 fake fs / fake WebSocket，无需真桌面）：

```bash
cd packages/cli
npx vitest run __tests__/unit/notification-send.test.js
```

## 安全考虑

- **不绕过配对**：CLI 只能向**已配对**设备推送——目标由 DID 标识，实际投递经桌面 remoteGateway 的 P2P 加密通道完成，CLI 拿不到设备密钥。
- **本机回环信任**：ws-bridge 地址来自本机 `~/.chainlesschain/desktop.port`，连接的是本机桌面进程；命令本身不引入新的网络监听面。
- **stale-pid 防误连**：写入进程已退出时拒绝连接残留端口，避免连到后续被其它进程复用的端口。
- **请求 ID 匹配**：响应按 `crypto.randomUUID()` 生成的 `requestId` 严格匹配，无关/伪造帧被忽略。
- **信号 0 探测**：pid 检查使用 signal 0，不会误杀任何进程。

## 故障排除

| 现象                                           | 可能原因                                | 处理                                                                                |
| ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `desktop_not_running`（退出码 2）              | 找不到 `~/.chainlesschain/desktop.port` | 先启动桌面 app：`cd desktop-app-vue && npm run dev`（需 ws-bridge / `--web-shell`） |
| `desktop_stale_pid`（退出码 2）                | port 文件存在但写入进程已退出           | 手动 `rm ~/.chainlesschain/desktop.port` 或重启桌面 app                             |
| `port_file_malformed`（退出码 2）              | port 文件不是含 `wsUrl` 字符串的 JSON   | 删除残留文件，让桌面重写                                                            |
| `rpc_timeout`（退出码 3）                      | 桌面忙 / handler 慢 / 手机离线          | 加大 `--timeout`（上限 120000）；确认手机在线已配对                                 |
| `ws_error` / `ws_construct_failed`（退出码 3） | wsUrl 失效或桥已关闭                    | 重启桌面 app 刷新 port 文件                                                         |
| 推送返回 `ok:false`（退出码 3）                | 桌面侧 handler 不可用 / 目标 DID 未配对 | 检查 `--target` DID 与桌面端配对状态                                                |

## 关键文件

| 文件                                                    | 说明                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/cli/src/commands/notification.js`             | 命令注册 + `runSendNotification`（port 文件解析、stale-pid 检查、WS RPC、退出码） |
| `packages/cli/__tests__/unit/notification-send.test.js` | 10 单元测试（`_deps` 注入 fake fs / WebSocket）                                   |
| `~/.chainlesschain/desktop.port`                        | 桌面 ws-bridge 描述符（`wsUrl` + `pid`），桌面运行时生成                          |

## 使用示例

```bash
# 1) 基本推送（响铃）
cc notification send --target did:example:iphone-01 --title "构建完成" --body "release v5.0.3 全绿"

# 2) 静默投递（勿扰时段测试，只投递不响铃）
cc notif send --target did:example:iphone-01 --title "quiet-hours probe" --silenced

# 3) 指定类型 + 更长超时
cc notification send --target did:example:android-02 \
  --title "告警" --body "磁盘 90%" --type alert --timeout 30000

# 4) 脚本消费：JSON 输出 + 退出码分流
cc notification send --target "$DID" --title "ping" --json
case $? in
  0) echo "delivered" ;;
  2) echo "desktop not running" ;;
  3) echo "push failed" ;;
esac
```

## 相关文档

- [移动端同步](./mobile-sync.md)
- [远程控制](./remote-control.md)
- [DID 身份](./cli-did.md)
- [总览](./overview.md)
