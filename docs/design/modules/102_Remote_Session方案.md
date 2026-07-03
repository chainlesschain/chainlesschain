# 102. Remote Session 方案

> 状态：Phase 0–2 完成，Phase 3 Desktop 第一片 + Android 第一片 + 第二片完成（2026-07-03）

## 1. 目标

让运行在用户本机的 Coding Agent 会话可以由 Desktop、IDE、Web 或移动端共同观察和控制。模型调用、文件、MCP、工具和审批状态仍留在本机；远端只是会话窗口。

## 2. 安全边界

- CLI runtime 是会话授权的唯一真相。
- signaling-server 仅负责寻址和密文/协议帧转发，peerId 不等于授权身份。
- 配对令牌使用 256-bit 随机值，本地仅保存 SHA-256 摘要，恒定时间比较。
- 配对令牌单次使用，默认 5 分钟失效。
- Remote Session 默认 12 小时失效；主机连接断开时立即关闭。
- 每个远端成员使用最小权限 Scope：`observe`、`prompt`、`approve`、`interrupt`。
- 非主机不能伪造 runtime/output 事件。

## 3. WebSocket 协议 v1.0

所有请求沿用 CLI WS 的 `{ id, type, ... }` 信封，并先通过服务器级 token 认证。

| 请求类型 | 用途 |
|---|---|
| `remote-session-create` | 主机为已有 Agent Session 创建远程入口 |
| `remote-session-pairing-token` | 主机为新设备签发一次性令牌 |
| `remote-session-join` | 远端设备消费令牌并加入 |
| `remote-session-publish` | 主机广播 runtime 事件，或远端发送受 Scope 约束的控制事件 |

服务端推送使用 `remote-session-event`，包含 `remoteSessionId`、`agentSessionId` 和原始 `event`。

## 4. 已落地代码

- `packages/cli/src/harness/remote-session-registry.js`：会话、成员、令牌和 Scope 授权。
- `packages/cli/src/gateways/ws/remote-session-protocol.js`：WS 请求处理和成员广播。
- `packages/cli/src/gateways/ws/message-dispatcher.js`：协议路由。
- `packages/cli/src/gateways/ws/ws-server.js`：生命周期接入，客户端断开时清理授权。

## 4.1 Phase 1：真实 Agent Session 接入

- CLI 发给主机的统一 Session 事件会按 `agentSessionId + hostClientId` 自动镜像到具备 `observe` Scope 的配对设备。
- `prompt` 复用现有 `handleSessionMessage`，进入同一个 Agent handler 和持久化链路。
- `approval.resolve` 复用现有 `handleSessionAnswer`，解析正在等待的交互请求。
- `interrupt` 复用现有 `handleSessionInterrupt`，中断同一个本地运行实例。
- 控制事件不会经 signaling 身份直接调用 runtime；必须先通过本地 Remote Session 成员和 Scope 校验。
- 远端包装事件不会被再次镜像，防止广播环路；无 `observe` Scope 的控制设备不接收会话内容。

## 5. 后续阶段

## 5.1 Phase 2：加密中继与二维码配对

- X25519 生成设备临时密钥并执行 ECDH。
- HKDF-SHA256 使用一次性配对令牌作为 salt，将共享秘密绑定到 Remote Session ID。
- AES-256-GCM 加密每个会话事件；协议版本、Session ID、发送设备和序号进入 AAD。
- 每个发送者使用单调序号，接收端拒绝重复或乱序信封；认证失败不会推进序号。
- 配对载荷使用 `chainlesschain://remote-session/pair#<base64url>`。敏感载荷位于 URI fragment，避免普通 HTTP 请求自动发送给服务器。
- signaling adapter 只发送 `remote-session.encrypted` 密文载荷，并兼容在线消息和服务器暂存的离线消息。
- CLI 配置 `remoteSessionRelayUrl` 与 `remoteSessionPeerId` 时，创建会话或重新签发令牌会返回可直接生成二维码的 URI。
- 私钥和派生会话密钥只驻留本地进程内存；主机会话关闭时清理。

相关实现：

- `packages/cli/src/harness/remote-session-crypto.js`
- `packages/cli/src/gateways/remote-session-relay.js`

## 5.2 后续阶段

### Phase 3 Desktop 第一片（已完成）

- Relay 支持指数退避自动重连、有界离线发送队列、重连后自动 flush，以及显式关闭不重连。
- CLI `serve` 新增 `--remote-session-relay-url` / `--remote-session-peer-id`，并透传至 WS runtime。
- Desktop bridge、Session Service、IPC 与 preload 已支持创建、刷新配对令牌和关闭 Remote Session。
- AI Chat 的 Agent 工具栏新增 Remote 面板：二维码、过期时间、复制链接、刷新一次性令牌和主动关闭。
- Desktop 通过 `CHAINLESSCHAIN_REMOTE_SESSION_RELAY_URL` 和 `CHAINLESSCHAIN_REMOTE_SESSION_PEER_ID` 配置 relay。

### 仍待完成

#### Android 原生客户端第一片（已完成）

- 目标明确为 `android-app/` 原生 Kotlin/Compose，不走 uni-app。
- 已实现原生配对 URI 解析、`ws/wss` relay 校验和过期拒绝。
- 已实现 BouncyCastle X25519、HKDF-SHA256、AES-256-GCM、AAD、篡改检测及按发送者序号防重放。
- Android raw X25519 公钥与 Node SPKI 公钥互操作；CLI 同时接受两种编码。
- OkHttp WebSocket 完成 signaling 注册、加密 pair request、事件接收及 Prompt / approval / interrupt 控制。
- EncryptedSharedPreferences 使用 Android Keystore 保存待配对 URI；配对成功后仅保留非敏感元数据并删除一次性 token。
- Compose 控制页已接入 ZXing 原生扫码、事件列表、消息输入、审批和中断操作。
- Remote Control 首页新增不依赖既有 P2P 连接的“远程编码会话”入口，NavGraph 路由已接通。
- CLI relay 已完成 Android 配对握手：接收 raw X25519 公钥、解密一次性 token、加入成员并返回加密 `pair.accepted`。
- 验证：Android `:app:compileDebugKotlin` 成功（317 tasks）；`RemoteSessionCryptoTest` 定向 JVM 测试成功（393 tasks）；CLI relay/crypto/protocol/server 75 tests passed。

#### Phase 3 第二片（已完成）

- Registry 新增 `listDevices(sessionId, hostClientId)`（host-only 设备清单，含 host 标记）和 `revokeMember(sessionId, hostClientId, clientId)`（host 不能撤销自身）。
- WS 协议新增 `remote-session-devices` 与 `remote-session-revoke`；撤销时向被撤销设备推送通知——本地客户端收明文 `remote-session-revoked`，relay 配对的移动端收加密 `session.revoked` 控制事件以停止自动重连。
- Desktop bridge / session-service / IPC / preload 打通设备列表与撤销；AI Chat 的 Remote 面板新增「已配对设备」清单（scope 展示 + host 标记）和单设备撤销（二次确认）。
- Android `RemoteSessionClient` 增加指数退避自动重连：瞬断在同一进程内重新注册并复用已派生的共享密钥（不消耗一次性令牌），显式断开或收到 `session.revoked` 时停止重连并进入 `REVOKED` 状态。
- Android 新增自包含 `RemoteSessionNotifier`：审批事件到达时发系统高优先级通知（`remote_session_approvals` 渠道），点按打开 App；批准/拒绝后撤销通知。
- 验证：CLI `remote-session-registry` / `remote-session-protocol` 定向单测 18 通过（含 relay 撤销加密通知路径）+ ws-server/pair-token 集成 16 通过；Android 新增 `RemoteSessionClientReconnectTest`（退避 1s/2s/4s、显式断开不重连、重连次数上界）。

#### Phase 3 第三片：Web Remote Session 客户端（已完成）

- `packages/web-panel` 新增「远程会话」页：粘贴/扫码桌面端配对链接后，直接连信令 relay（不走本地 CLI WS），端到端加密接管会话。
- `src/utils/remote-session-crypto.js`：纯 JS `@noble`（X25519 + HKDF-SHA256 + AES-256-GCM）移植，与 Node host / Android 逐字节互通——刻意避开浏览器 WebCrypto 的 X25519 兼容性问题，同一份代码在 Vite bundle 与 Node 单测中运行。接受 host 的 SPKI 公钥与移动端 raw 32B 公钥两种编码。
- `src/stores/remoteSession.js`：relay 客户端 Pinia store，镜像 Android `RemoteSessionClient` 状态机——注册、加密配对、事件镜像、Scope 受限控制（prompt/approve/interrupt），指数退避自动重连（瞬断在同一 store 生命周期内复用已派生密钥不重配对），收到 host `session.revoked` 即停连并置 `revoked`。
- `RemoteSession.vue`：状态标签、事件流、审批「批准/拒绝」、提示输入、中断/断开；复用 `QrScannerModal` 摄像头扫码。路由 `remote-session` + 侧栏菜单项已接通。
- 验证：`remote-session-crypto` 5 单测（与真实 Node host 模块加解密互通 + URI 解析 + 重放拒绝）+ `remote-session-store` 4 单测（假 relay 跑真加密：配对→连接→事件镜像→受限控制→自动重连恢复→撤销）全通过；`vite build` 干净（RemoteSession chunk 47KB）。

#### Phase 4：审计日志（已完成）

- `packages/cli/src/harness/remote-session-audit.js`：有界（默认 1000 条环形缓冲）内存审计日志 `RemoteSessionAuditLog`，与远程会话「内存态 + 12h TTL」的短生命周期一致。`record/list/stats/clear` + 可插拔 `sink` 缝（供日后接 JSONL/SQLite 持久化，不改调用点）。
- 记录九类动作：`session.created` / `pairing-token.issued` / `device.joined`（direct + relay 两路）/ `device.revoked` / `device.disconnected` / `session.closed` / `control.prompt` / `control.approval` / `control.interrupt`。**隐私优先**：prompt 只记 `{chars}` 长度不记内容；approval 记 `{requestId, approved}`；符合「数据主权」不过度采集原则。
- WS `remote-session-audit` 查询（host-only：authorize 证明成员身份 + hostClientId 证明所有权）返回 `{entries, stats}`。ws-server 构造 `this.remoteSessionAudit`，并在断开清理（removeClient）与 relay 配对成功处补记。
- Desktop：bridge/service/IPC/preload 打通 `getRemoteSessionAudit`；Remote 面板新增「审计日志」时间线（动作彩色标签 + 操作者 + 时间 + 明细，创建/撤销时自动刷新）。
- 验证：`remote-session-audit` 6 单测（seq/时钟/detail 深拷贝/过滤/stats/环形缓冲上限/sink 容错）+ `remote-session-protocol` 扩测（生命周期与控制事件入账 + 断言 prompt 内容不入账 + host-only 查询）；registry/protocol/audit 三件 26 单测 + mirroring/ws-server/pair-token 集成 18 全通过。

#### Phase 4：组织策略（已完成）

- `RemoteSessionPolicy`（与 registry 同文件，规避循环依赖）：管理员可约束远程会话——`allowedScopes`（收窄 Scope 白名单）/ `maxDevices`（非 host 设备上限）/ `maxSessionTtlMs` + `maxTokenTtlMs`（会话/令牌时长上限）/ `allowRelayPairing`（是否允许 relay 配对）。默认全空 = 无约束 no-op。
- 单一执行点在 **registry**：`create` 封顶会话时长；`issuePairingToken` 按策略收窄 Scope（返回 `scopes` + `policyNarrowed`）并封顶令牌时长；`join` 校验设备上限 + relay 开关（direct/relay 两路都过同一检查，令牌验签**通过后**才判策略，避免向未授权探测泄露拒因）。host 本身始终保留全 Scope，只约束远端设备。
- `RemoteSessionPolicy.fromEnv`：从 `CHAINLESSCHAIN_REMOTE_SESSION_{ALLOWED_SCOPES,MAX_DEVICES,MAX_SESSION_TTL_MS,MAX_TOKEN_TTL_MS,ALLOW_RELAY}` 装配；ws-server 用它构造 registry。WS `remote-session-policy` 查询（任意已认证客户端可读，非敏感——便于配对前预检）。
- Desktop：bridge/service/IPC/preload `getRemoteSessionPolicy`；Remote 面板顶部展示生效策略摘要（收窄的 Scope / 设备上限 / 会话时长 / relay 是否禁用）。
- 验证：`remote-session-policy` 9 单测（applyScopes 收窄/不相交抛错/未知 Scope 拒绝、TTL 封顶、设备上限、relay 开关、fromEnv 解析）+ registry 扩测 4（issue 收窄 + host 不受限、TTL 封顶、设备上限、relay 禁用 direct 仍可）+ protocol 查询 1。远程会话全量 50 单测（8 文件）通过。

#### 仍待完成

1. Phase 3 第三片余项：跨端断线恢复真机/真 relay E2E（需 relay + host + 浏览器三方联调，Win 单机不可跑）。
2. Phase 4 余项：推送通知（vendor push）；审计日志的持久化 sink（JSONL/SQLite）实装；策略的运行时热更新与来源（config.json vs env）合并。
3. 进程冷启动后的重新配对（当前自动重连仅覆盖同进程内瞬断；进程被杀后内存态密钥丢失需重新扫码）。
