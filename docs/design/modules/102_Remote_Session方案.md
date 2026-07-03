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

#### Phase 4：推送通知（vendor push，已完成）

- `packages/cli/src/harness/remote-session-push.js`：`RemoteSessionPushDispatcher` 在 relay WebSocket 被系统挂起（后台应用）时唤醒已配对设备处理**审批请求**——前台本地通知覆盖不到的场景。实际投递（FCM / APNs / 小米 / 华为 / OPPO）是宿主注入的可插拔 `sender`，本层**零凭据**且完全可单测；无 sender 时降级为记录型 no-op。载荷**不含任何会话内容**，只带路由唤醒所需的形状（与审计日志的隐私优先一致）。30s 去重窗口按 `clientId:dedupeKey` 抑制重复唤醒；`isApprovalRequestEvent` 只匹配 approval/permission 请求，排除其 `resolved` 对应事件。
- Registry：`join` 接受 `pushToken`/`pushProvider` 并存于成员（无 token 则忽略 provider）；配对后设备可用 `registerPush` 自行注册/刷新/清空自己的 token（null 清空即退出唤醒目标）；`pushTargets` 列出携带 token 的非 host 成员；`listDevices` 暴露 `hasPush`/`pushProvider`。
- WS：`ws-server` 构造 `this.remoteSessionPush`（`fromEnv` + 注入 `remoteSessionPushSender`）；`_mirrorRemoteSessionEvent` 在镜像 approval 事件时，对**每个**带 push token 的观察成员 fire-and-forget 唤醒（独立于本地/relay 可达性——后台应用可能报「socket 活着」但进程已挂起，永远读不到镜像事件直到用户点推送），并记 `push.sent`/`push.failed`/`push.skipped` 审计。relay 配对握手的 `pair.join` 也透传 `pushToken`/`pushProvider`。新增 WS `remote-session-push-register`（设备只能注册自己的 token）。
- Desktop：Remote 面板设备列表对带推送的远端设备显示绿色「Push · <provider>」标签（悬浮说明后台可被唤醒）。
- Android：`RemoteSessionClient.setPushCredentials(token, provider)` 缝——设置后随加密 `pair.join` 上送；真实 token 取值走**多 provider 有序解析**（FCM→vivo→OPPO→Xiaomi→Huawei），见下方「Android FirebaseMessaging 集成」与「Android vivo push 集成」节（`FcmTokenProvider`/`VivoTokenProvider`/`OppoTokenProvider`/`XiaomiTokenProvider`/`HuaweiTokenProvider` 反射取值 + `RemoteSessionPushTokenResolver`）。
- 验证：`remote-session-push` 9 单测（isApprovalRequestEvent 匹配/无 sender 跳过/无 token 跳过/投递 sent/provider 覆盖/去重窗口 + 跨 client 不去重 + 过窗重发/sender 抛错不 throw 记 failed/fromEnv）+ registry 扩测 5（join 存 token、无 token 忽略 provider、register 注册刷新清空、非成员拒绝、pushTargets 排除 host 与指定 client）+ protocol 扩测 3（join 带 token + 审计、注册 + 审计、非成员拒绝）+ mirroring 扩测 2（approval 唤醒且记 push.sent、无 sender 不唤醒不记）。

#### Phase 4：真实 vendor push sender — FCM HTTP v1（已完成）

- `packages/cli/src/harness/remote-session-push-fcm.js`：`sender` 契约的**真实实现**，走 FCM **HTTP v1** API（legacy server-key API 已停用）。鉴权用 Google 服务账号：`GoogleServiceAccountTokenProvider` 用私钥 **RS256 签一个 JWT** 断言、到 `oauth2.googleapis.com/token` 换取短时 OAuth2 access token（本地缓存至到期前 60s skew），磁盘上不落长期 server key。`FcmV1PushSender.send` POST `messages:send`，body 为高优先级 `{notification, data, android.priority=high, apns-priority=10}`——`data` 只带路由字段（`type/sessionId/clientId`），**无会话内容**。
- 全链路**可注入**（`fetch`/时钟/签名器/`fs`），用生成的密钥对 + 假 transport 即可单测，无需真凭据或联网。`createFcmPushSender(env)` 从 `..._FCM_SERVICE_ACCOUNT`（JSON 路径）或 `..._FCM_SERVICE_ACCOUNT_JSON`（内联）+ 可选 `..._FCM_PROJECT_ID` 造 FCM sender；provider 分派由下方 senders dispatcher 负责。
- **死 token 剪除闭环**：FCM 对已卸载/轮换的 token 返回 404 或 `UNREGISTERED/NOT_FOUND` → sender 抛 `PushTokenUnregisteredError`（`code=PUSH_TOKEN_UNREGISTERED`）；dispatcher 把 `code` 透传到 outcome；`ws-server._dispatchApprovalPush` 收到即 `registerPush(...,{token:null})` 清掉该设备 token 并记 `push.unregistered` 审计——避免对死 token 无限重试。
- WS 接线：`RemoteSessionPushDispatcher.fromEnv` 的 sender 优先取注入的 `remoteSessionPushSender`（测试/自定义 transport），否则 `createRemoteSessionPushSender(process.env)` 按 env 造真 FCM sender；两者皆无则 null。
- 验证：`remote-session-push-fcm` 13 单测（token provider：缺字段抛错 / JWT 真 RS256 签名 + claims 校验 + 换 token / 缓存 + 过期刷新 / 端点失败或缺 token 抛错；FCM sender：选项校验 / 成功 POST 带 bearer + body 形状 + 返回 id / 缺 token / 404 + UNREGISTERED body → PushTokenUnregisteredError / 5xx 通用错；`createFcmPushSender`：未配置 → null / 畸形服务账号 → null / 内联 JSON 造 sender 端到端发送 / 文件路径经注入 fs 读 / project id 覆盖）+ dispatcher 扩测 1（code 透传）+ mirroring 扩测 1（unregistered 剪除 token + 记 push.unregistered）。

#### Phase 4：APNs sender（Apple 推送，已完成）

- `packages/cli/src/harness/remote-session-push-apns.js`：`sender` 契约的 iOS/macOS 实现，走 APNs **HTTP/2** provider API + **token 鉴权**：`ApnsTokenProvider` 用 `.p8` 授权密钥 **ES256（原始 R‖S）签 JWT**（header `{alg:ES256,kid}`、claims `{iss:teamId,iat}`），本地缓存 ~50min。`ApnsPushSender.send` POST `/3/device/{token}`，headers 带 `authorization: bearer <jwt>` + `apns-topic`（bundle id）+ `apns-push-type:alert` + `apns-priority:10`，body `{aps:{alert,sound}, "remote-session":{type,sessionId,clientId}}`——只带路由 id，**无会话内容**。
- APNs 强制 HTTP/2（`fetch`/undici 不支持），故网络 transport 是**可注入** `request`（默认 `node:http2`）；连同时钟/签名器/`fs` 全可注入，用生成的 EC P-256 密钥 + 假 transport 单测，无需真凭据或联网。`createApnsPushSender(env)` 从 `..._APNS_KEY`（.p8 路径）或 `..._APNS_KEY_P8`（内联）+ `..._APNS_KEY_ID` + `..._APNS_TEAM_ID` + `..._APNS_TOPIC` + `..._APNS_PRODUCTION`（true→生产 host，否则 sandbox）装配；缺任一必需项 → null。
- **死 token 剪除**复用同一 `PushTokenUnregisteredError`（提到共享 `remote-session-push-errors.js`）：APNs 410 `Unregistered` 或 400 `BadDeviceToken` → 抛该错 → dispatcher 透传 code → ws-server 清 token + 记 `push.unregistered`（与 FCM 同一闭环）。
- **Provider 分派**：新 `remote-session-push-senders.js` 的 `createRemoteSessionPushSender(env)` 按 `..._PUSH_PROVIDER`（默认 fcm）switch 到 `createFcmPushSender` / `createApnsPushSender` / `createWebPushSender` / `createXiaomiPushSender`（`xiaomi`|`mi`）/ `createHuaweiPushSender`（`huawei`|`hms`）/ `createOppoPushSender`（`oppo`|`heytap`）/ `createVivoPushSender`（`vivo`）；未知/未配置 → null。ws-server 改从此 dispatcher 取 sender（fcm 行为不变）。加新 provider = 一 import + 一 case。
- 验证：`remote-session-push-apns` 14 单测（token provider：缺字段抛错 / ES256 JWT header+claims+真签名验证 / 缓存 + TTL 刷新；APNs sender：选项校验 / HTTP/2 POST 带 bearer+APNs headers+body 形状+apns-id / 生产 host / 缺 token / 410+BadDeviceToken → PushTokenUnregisteredError / 5xx 通用错；`createApnsPushSender`：缺必需项 → null / 内联凭据端到端发送 / 生产 host / .p8 文件经注入 fs 读）+ `remote-session-push-senders`（默认 fcm / apns / web 路由 / 不跨 provider / 未知 provider → null / 空配置 → null）。

#### Phase 4：Web push（service worker，已完成）

- **服务端 sender**（`packages/cli/src/harness/remote-session-push-web.js`）：`sender` 契约的浏览器实现，走 **Web Push 协议**——**VAPID（RFC 8292）** ES256 JWT（按 push 端点 origin 缓存 12h）鉴权 + **RFC 8291（aes128gcm）** 载荷加密（ECDH-P256 + HKDF-SHA256 + AES-128-GCM，绑定订阅的 p256dh 公钥 + auth secret）。"token" 是浏览器 `PushSubscription`（endpoint + keys）的 JSON。Web Push 端点收普通 HTTPS，故网络 transport 是可注入 `fetch`（默认全局）；加解密用 node:crypto，测试里真做 encrypt→decrypt 往返，无需真凭据/联网。载荷只带路由 id。`createWebPushSender(env)` 从 `..._VAPID_PUBLIC_KEY`（base64url 65B）+ `..._VAPID_PRIVATE_KEY`（base64url 32B）+ `..._VAPID_SUBJECT` 装配；缺任一 → null。404/410 → `PushTokenUnregisteredError`（复用同一剪除闭环）。
- **浏览器 service worker**（`packages/web-panel/public/remote-session-sw.js`）：`push` 事件解密后的 JSON → `showNotification`（按 sessionId tag、requireInteraction）；`notificationclick` → 聚焦/打开面板。
- **web 客户端订阅**（`packages/web-panel/src/utils/webPush.js`）：`subscribeWebPush({vapidPublicKey})` 注册 SW + `pushManager.subscribe` + 序列化订阅为 pushToken；`serializeSubscription`/`urlBase64ToUint8Array` 为纯函数（可测）；不支持/拒权时返 null，配对照常无推送降级。`stores/remoteSession.js`：`connect(uri,{pushCredentials})` 把订阅带进加密 `pair.join`；`updatePushCredentials(token)` 配对后经 `push.register` 控制事件转发（与 Android 对齐）。
- 验证：`remote-session-push-web` 12 单测（RFC 8291 加密往返 + 每次新 ephemeral 密文不同；VAPID：缺字段抛错 / ES256 JWT 真签名验证 + aud/sub / 按 origin 缓存；sender：缺订阅 / POST 加密 body 订阅方可解密 + VAPID+aes128gcm headers / 410 → unregistered / 5xx 通用错；工厂：缺 VAPID → null / env 造 sender 端到端）+ `remote-session-push-senders` web 路由 1 + web-panel `web-push` 5（序列化 + base64url 解码 + 支持性）+ `remote-session-store` 扩测 3（pair.join 带订阅 / 无订阅省略 / `updatePushCredentials` → push.register）。CLI 远程会话全量 129 单测（14 文件）通过；web-panel 远程会话 12 单测通过。

#### Phase 4：小米 push sender（MIUI，已完成）

- `packages/cli/src/harness/remote-session-push-xiaomi.js`：`sender` 契约的 MIUI 实现，走小米推送服务端 API。与 FCM/APNs 不同**无 JWT**——鉴权是静态 AppSecret 放 `Authorization: key=<AppSecret>` header，故就是一次 form-encoded POST（普通 HTTPS，可注入 `fetch`）。`XiaomiPushSender.send` POST `/v3/message/regid`，form 带 `registration_id`（token）+ `restricted_package_name` + `pass_through=0`（弹通知）+ `title/description` + `payload`（只带路由 id JSON，**无会话内容**）。响应 `result==="ok" && code===0` → 成功（`data.id`）。
- `createXiaomiPushSender(env)` 从 `..._XIAOMI_APP_SECRET` + `..._XIAOMI_PACKAGE_NAME`（+ 可选 `..._XIAOMI_HOST` 切海外 host）装配；缺任一 → null。**死 token 剪除**复用同一 `PushTokenUnregisteredError`：小米无单一「未注册」码，故按 reason/description 文本匹配（invalid/not valid/unregist/不存在…）判失效 → 抛该错 → ws-server 清 token + 记 `push.unregistered`。dispatcher 加 `xiaomi`|`mi` 两 case。
- 验证：`remote-session-push-xiaomi` 8 单测（选项校验 / form POST 带 key= 头 + registration_id + package + payload 形状 / 自定义 host / 缺 token / 无效 regid → PushTokenUnregisteredError / 其它 error → 通用错 / 工厂缺配置 → null / env 造 sender 端到端）+ `remote-session-push-senders` xiaomi+mi 路由 1。

#### Phase 4：华为 HMS push sender（Push Kit，已完成）

- `packages/cli/src/harness/remote-session-push-huawei.js`：`sender` 契约的华为/鸿蒙实现，走 HMS Push Kit。鉴权是 **OAuth2 client_credentials**（app id + secret 换短时 access token，比 FCM 的签名 JWT 简单）——`HuaweiTokenProvider` POST `oauth2/v3/token` 拿 token（缓存至到期前 60s skew），`HuaweiPushSender.send` 带 `Bearer` POST `/v1/{appId}/messages:send`，body `{message:{notification, android.urgency=HIGH, data, token:[<token>]}}`——`data` 只带路由 id JSON，**无会话内容**。响应 `code==="80000000"` → 成功（`requestId`）。
- `createHuaweiPushSender(env)` 从 `..._HUAWEI_APP_ID` + `..._HUAWEI_APP_SECRET` 装配；缺任一 → null。**死 token 剪除**复用同一 `PushTokenUnregisteredError`：`80300007`（全部 token 无效）/`80100000`（部分无效，单 token 即该 token 失效）或 msg 匹配 invalid/unregist → 抛该错 → ws-server 清 token + 记 `push.unregistered`。dispatcher 加 `huawei`|`hms` 两 case。
- 验证：`remote-session-push-huawei` 11 单测（token provider：缺字段抛错 / client_credentials 换 token + form 参数 / 缓存 + 过期刷新 / 端点失败或缺 token 抛错；sender：选项校验 / Bearer POST + body 形状 + token 数组 + requestId / 缺 token / 80300007+80100000 → PushTokenUnregisteredError / 其它 code → 通用错；工厂：缺配置 → null / env OAuth+send 端到端）+ `remote-session-push-senders` huawei+hms 路由 1。

#### Phase 4：OPPO push sender（HeyTap / ColorOS，已完成）

- `packages/cli/src/harness/remote-session-push-oppo.js`：`sender` 契约的 OPPO/OnePlus/realme 实现，走 OPPO Push（HeyTap）server API。鉴权是**两步握手**：`sign = SHA256(app_key + timestamp + master_secret)` 换短时 `auth_token`（有效 ~24h）——`OppoAuthProvider` POST `/server/v1/auth` 拿 token（缓存至到期前 5min skew），`OppoPushSender.send` 带 `auth_token`（header + form 双写）POST `/server/v1/message/notification/unicast`，`message` 为 `{target_type:2, target_value:<regid>, notification:{title, content, action_parameters}}`——`action_parameters` 只带路由 id JSON，**无会话内容**。响应 `code===0` → 成功（`data.messageId`）。
- `createOppoPushSender(env)` 从 `..._OPPO_APP_KEY` + `..._OPPO_MASTER_SECRET`（+ 可选 `..._OPPO_HOST`）装配；缺任一 → null。**死 token 剪除**复用同一 `PushTokenUnregisteredError`：OPPO 无单一「未注册」码，故按返回 message 文本匹配（invalid registration/token、unregist、not exist、无效/不存在…）判失效 → 抛该错 → ws-server 清 token + 记 `push.unregistered`。dispatcher 加 `oppo`|`heytap` 两 case。
- 验证：`remote-session-push-oppo` 10 单测（auth provider：缺字段抛错 / SHA256 sign + form 参数 + auth_token / 缓存 + 24h 后刷新 / 端点失败或缺 token 抛错；sender：缺 authProvider 抛错 / unicast POST + message 形状 + target_type=2 + messageId / 缺 regid / invalid message → PushTokenUnregisteredError / 其它 code → 通用错；工厂：缺配置 → null / env auth+send 端到端）+ `remote-session-push-senders` oppo+heytap 路由 1。

#### Phase 4：vivo push sender（vpush，已完成）

- `packages/cli/src/harness/remote-session-push-vivo.js`：`sender` 契约的 vivo/iQOO 实现，走 vivo Push（vpush）server API。鉴权同为**两步握手**但用 **MD5 sign + JSON body**（异于 OPPO 的 SHA256+form）：`sign = MD5(appId + appKey + timestamp + appSecret)` 换短时 `authToken`（有效 ~24h）——`VivoAuthProvider` POST `/message/auth`（JSON）拿 token（缓存至到期前 5min skew），`VivoPushSender.send` 带 `authToken` header JSON POST `/message/send`，body 为 `{regId, notifyType:1, title, content, skipType:1, requestId, clientCustomMap}`——`clientCustomMap` 只带路由 id，**无会话内容**。`requestId` 每条唯一（默认 `randomUUID`，可注入）。响应 `result===0` → 成功（`taskId`）。
- `createVivoPushSender(env)` 从 `..._VIVO_APP_ID` + `..._VIVO_APP_KEY` + `..._VIVO_APP_SECRET`（+ 可选 `..._VIVO_HOST`）装配；缺任一 → null。**死 token 剪除**复用同一 `PushTokenUnregisteredError`：`result` 码 10302/10303（regId 非法/不属本 app）或 desc 文本匹配（invalid reg/illegal/unregist/无效/不存在/非法…）判失效 → 抛该错 → ws-server 清 token + 记 `push.unregistered`。dispatcher 加 `vivo` 一 case。
- 验证：`remote-session-push-vivo` 11 单测（auth provider：缺三字段各自抛错 / MD5 sign + JSON body + authToken / 缓存 + 24h 后刷新 / 端点失败或坏 result 抛错；sender：缺 authProvider 抛错 / JSON POST + authToken 头 + body 形状 + requestId 注入 + taskId / 缺 regId / 码 10302 → PushTokenUnregisteredError / 其它码但 desc 命中文本 → 同错 / 其它失败 → 通用错；工厂：缺配置 → null / env auth+send 端到端）+ `remote-session-push-senders` vivo 路由 1。CLI 远程会话全量 175 单测（18 文件）通过。

#### Phase 4：Android FirebaseMessaging 集成（app 侧取 token，已完成）

- `android-app/.../remote/session/FcmTokenProvider.kt`：**反射式**取设备 FCM 注册 token——沿用 `AppInitializer` 对 Crashlytics 的「google-services.json 可选」范式：`Class.forName("com.google.firebase.messaging.FirebaseMessaging")` + `getInstance().getToken()`（`kotlinx-coroutines-play-services` 的 `Task.await()`）。Firebase 不在 classpath / 无 google-services.json 时**返回 null 不崩**，宿主自动回退 relay + 本地通知；无硬依赖、无需 google-services.json 也能编译运行。可注入 `fetcher` 供测试。
- `RemoteSessionViewModel.pair(uri)`：改为协程，配对前**先** best-effort 取 token（`withTimeoutOrNull(3s)` 封顶，避免慢网阻塞配对）→ `client.setPushCredentials(token, "fcm")` → `connect(uri)`，使 token 随加密 `pair.join` 上送到宿主（relay 侧唯一注册路径）。
- `app/build.gradle.kts`：`hasGoogleServices` 守卫块内追加 `firebase-messaging-ktx`（仅当 google-services.json 存在才引入；CI 当前无该文件，构建不受影响）。
- 验证：`FcmTokenProviderTest` 4（注入 fetcher 取值 / 空白与 null 归一化 / 抛错降级 null / 默认反射路径无 Firebase → null）+ `RemoteSessionClientPushTest`（配对前设 token → 宿主解密 `pair.join` 得 pushToken+pushProvider / 无 token 则不带这两字段 / 清 token 后丢弃字段）——纯 JVM 框架无关，用真 X25519+AES-GCM 往返解密验证。

#### Phase 4：FirebaseMessagingService onNewToken + 配对后 token 刷新（已完成）

- **配对后刷新路径（宿主，纯逻辑可测）**：`handleRemoteSessionPublish` 新增 `push.register` 事件——已配对设备（含仅 relay 的手机）可自助刷新自己的 vendor token：`authorize` 证成员身份 + `registerPush` 以认证 `clientId` 为键（设备只能改自己的 token；不带 token 即清空），记 `push.registered`（`via:"relay"`）审计。这补上了配对后（一次性 `pair.join` 之外）唯一缺失的 token 更新通道。
- **Android 客户端**：`RemoteSessionClient.updatePushCredentials(token, provider)`——更新字段供下次 `pair.join`，且**已配对时**立即经加密 `push.register` 控制事件转发给宿主，使在途会话即刻改用新 token。
- **进程级桥**：`RemoteSessionPushBridge`（`@Volatile activeClient`，纯 Kotlin 无 Android/Firebase 类型）——让 `FirebaseMessagingService`（在 ViewModel 之外）把刷新 token 交给活跃客户端；无活跃会话则 no-op（下次配对反射取新 token）。`RemoteSessionViewModel` 在 init 注册 / onCleared 注销 `activeClient`。
- **`RemoteSessionFirebaseService`**（`app/src/firebase/java/`，**条件源集**）：`onNewToken` → `RemoteSessionPushBridge.onNewToken`；`onMessageReceived` → 前台/纯 data 的审批推送本地弹通知（data 只带路由字段）。因子类继承 firebase-messaging 类型，`build.gradle.kts` 仅在 `hasGoogleServices` 时把该源集加入 `main`——无 google-services.json 时整类不编译不进 APK；manifest 中 `<service>` 用 `tools:ignore="MissingClass"`（Firebase-less 构建下永不实例化）。
- 验证：`RemoteSessionClientPushTest` 扩测 2（配对前 update 只随下次 `pair.join` / 配对后 update 经解密 `push.register` 到宿主）+ `RemoteSessionPushBridgeTest` 3（无活跃客户端 no-op / 空白 token 忽略 / onNewToken 经桥入客户端并随 `pair.join` 上送）+ CLI `remote-session-protocol` 扩测 3（relay `push.register` 注册 + 审计 / 省略 token 即清空 / 非成员拒绝）。CLI 远程会话全量 90 单测通过；Android push 三类 JVM 测试全绿。`RemoteSessionFirebaseService` 因需 google-services.json 才编译，随真机接入验证（Win 不可跑）。

#### Phase 4：Android vivo push 集成（多 provider 取 token，已完成）

- **provider 抽象**：新 `RemoteSessionPushTokenProvider` 接口（`val provider` 标签 + `suspend fun getToken()`）——`FcmTokenProvider` 与新 `VivoTokenProvider` 均实现之。配对不再写死 FCM，而是走**有序解析**。
- `android-app/.../remote/session/VivoTokenProvider.kt`：**反射式**取设备 vivo regId，与 `FcmTokenProvider` 同范式——`Class.forName("com.vivo.push.PushClient")` + `getInstance(context).getRegId()`。vivo Push SDK 是**手动 AAR（不在 Maven）**，不在 classpath / push 未 turnOn（`getRegId()` 返 ""）时**返回 null 不崩**；宿主回退 relay + 本地通知。异于 FCM 静态单例，vivo `PushClient` 需 `Context`，故构造带 context。可注入 `fetcher` 供测试。
- `android-app/.../remote/session/OppoTokenProvider.kt`：**反射式**取设备 OPPO（HeyTap）regId——`Class.forName("com.heytap.msp.push.HeytapPushManager")` + 静态 `getRegisterID()`。OPPO Push SDK 是 **OPPO-Maven 依赖**（`com.heytap.msp:push`）；不在 classpath / 未注册（返 ""）时**返回 null 不崩**。异于 vivo，OPPO 的 `getRegisterID()` 是**静态**方法，故 provider **无需 Context**（与 FCM 同）。可注入 `fetcher` 供测试。
- `android-app/.../remote/session/XiaomiTokenProvider.kt`：**反射式**取设备 Xiaomi（MIUI）regId——`Class.forName("com.xiaomi.mipush.sdk.MiPushClient")` + 静态 `getRegId(Context)`。MiPush SDK 是**手动 AAR**；不在 classpath / 未注册（返 null）时**返回 null 不崩**。同 vivo，`getRegId` 是带 Context 的静态方法，故 provider **需 Context**。可注入 `fetcher` 供测试。
- `android-app/.../remote/session/HuaweiTokenProvider.kt`：**反射式**取设备 Huawei（HMS）token——`AGConnectServicesConfig.fromContext(ctx).getString("client/app_id")`（appId 来自 agconnect-services.json，缺则 null）+ `HmsInstanceId.getInstance(ctx).getToken(appId, "HCM")`。HMS 独特处：`getToken` 是**阻塞网络调用**，故反射路径 **offload 到 `Dispatchers.IO`**（不阻塞主线程）；SDK/配置不在 / getToken 抛 ApiException 时**返回 null 不崩**。需 Context。可注入 `fetcher` 供测试（fetcher 路径直跑，跳过 IO offload）。
- `RemoteSessionPushTokenResolver`：按**有序** provider 列表解析首个可用 token（FCM 先——海外/Pixel/三星国际；vivo、OPPO、Xiaomi、Huawei 后——国内 ROM；Huawei 因阻塞 getToken 排最后）；某 provider 抛错/返 null/空白即跳过，**一个缺 SDK 不阻塞其余**；全不可用才返 null。纯 Kotlin 无 Android 类型，全可测。
- `RemoteSessionViewModel.pair(uri)`：`fcmTokenProvider.getToken()` 换为 `pushTokenResolver.resolve()`（列表 `[FcmTokenProvider(), VivoTokenProvider(application), OppoTokenProvider(), XiaomiTokenProvider(application), HuaweiTokenProvider(application)]`，仍 `withTimeoutOrNull(3s)` 封顶——阻塞的 Huawei getToken 也受此约束），命中即 `client.setPushCredentials(resolved.token, resolved.provider)`。
- **桥泛化**：`RemoteSessionPushBridge.onNewToken(token, provider = FcmTokenProvider.PROVIDER)`——加 provider 参数（默认 fcm 保持 `RemoteSessionFirebaseService` 调用不变），vivo 接收器可传 `VivoTokenProvider.PROVIDER` 把刷新的 regId 路由进活跃客户端。
- 验证：`VivoTokenProviderTest` 5 + `OppoTokenProviderTest` 5 + `XiaomiTokenProviderTest` 5 + `HuaweiTokenProviderTest` 5（注入 fetcher 取值 / provider 标签 / 空白与 null 归一化 / 抛错降级 null / 默认反射路径无 SDK → null；Huawei 额外覆盖 IO offload 路径）+ `RemoteSessionPushTokenResolverTest` 6（首个命中 / 前者不可用则下沉 / 抛错跳过 / 空白视为不可用 / 全不可用 → null / 空列表 → null）+ `RemoteSessionPushBridgeTest` 扩测 1（onNewToken 带非默认 provider 标签经解密 `pair.join` 得 vivo）+ `FcmTokenProviderTest` 4（实现接口后不回归）。Android remote-session 七类 JVM 测试全绿（5+5+5+5+6+4+4=34，`gradlew :app:testDebugUnitTest`）。**至此 resolver 五 provider（FCM/vivo/OPPO/Xiaomi/Huawei）全接。**

#### Phase 4：Android vivo push 真机集成（AAR 门控 + 接收器 + 反射 turnOn，已完成骨架）

- **构建门控**（`app/build.gradle.kts`，镜像 Firebase `google-services.json` 范式）：`hasVivoPush = !fileTree("libs"){include("vivo*push*.aar"…)}.isEmpty`——AAR 一落进 `app/libs/` 就自动 (a) `src/vivo/java` 加进 `main` 源集、(b) `implementation(vivoPushAars)`。**无 AAR 时源集排除，默认构建行为不变**（`RemoteSessionVivoReceiver` 不编译不进 APK；`VivoTokenProvider` 仍反射降级）。
- **`RemoteSessionVivoReceiver`**（`src/vivo/java`，**条件源集**，vivo 的 `RemoteSessionFirebaseService` 对位）：继承 `com.vivo.push.sdk.OpenClientPushMessageReceiver`；`onReceiveRegId` → `RemoteSessionPushBridge.onNewToken(regId, VivoTokenProvider.PROVIDER)`（首注册/轮换即推给活跃会话）；`onNotificationMessageClicked` → 本地弹审批通知（`params` 只带路由 id）。
- **AndroidManifest**：`<receiver ... RemoteSessionVivoReceiver android:exported="true">` + `com.vivo.pushclient.action.RECEIVE` intent-filter + `com.vivo.push.app_id`/`api_key` meta-data（值走 `manifestPlaceholders`，空默认保证无凭证也 merge；`-PvivoPushAppId=… -PvivoPushApiKey=…` 注入）。`tools:ignore="MissingClass"`（无 AAR 构建下类不存在但永不实例化）。
- **`VivoPushService` 反射真集成**（`push/vendor/OtherVendorStubs.kt`，脱 stub）：`initialize()` 反射 `PushClient.getInstance(ctx).initialize()` + `turnOnPush(动态代理 IPushActionListener)`；`currentToken()` 反射 `getRegId()`；`isIntegrated()` 探 `Class.forName`——**全 runCatching 兜底**，无 SDK 即返 false/null 不崩，无编译期硬依赖。
- **启动触发**（`AppInitializer` 异步块 #10）：按 `Build.MANUFACTURER` 自动选 vendor 并 `initialize()`——vivo 设备启动即 turnOn 铸 regId 供唤醒（FCM 设备 route 到 no-op；小米/华为 仍 stub 返 false；OPPO 见下）。
- 验证：`VivoPushServiceTest` 5（vendor 标签 / 无 SDK isIntegrated=false / initialize 降级 false 且幂等 / currentToken=null / shutdown 安全 no-op）+ `AppInitializerTest` 2（新增 `pushVendorRegistry` 依赖后不回归）；`gradlew :app:kspDebugKotlin`（主 Hilt DI 图含新依赖编译通过）+ `:app:processDebugMainManifest`（vivo receiver + meta-data 成功 merge 进 `merged_manifest`）+ `:app:testDebugUnitTest` 过。**门控日志确认无 AAR 时 vivo 源集排除**。剩真机项（Win 不可跑）：接入者放 AAR + 传凭证（`docs/guides/Vendor_Push_Setup.md` §3.4 三步）+ 真机上架 vivo 市场端到端验证。

#### Phase 4：Android OPPO push 真机集成（Maven 门控 + 回调 register，已完成骨架）

- **架构差异**：OPPO（HeyTap）push 与 vivo 形态不同——(1) SDK 是 **OPPO-Maven 依赖**（`com.heytap.msp:push`）非手动 AAR；(2) regId **不走 manifest 广播 receiver**，而是 `HeytapPushManager.register(ctx, appKey, appSecret, ICallBackResultService)` 的回调 `onRegister` 递送。故 OPPO 真机集成**无 conditional 源集、无 manifest receiver**，纯反射即可。
- **构建门控**（`app/build.gradle.kts` + `settings.gradle.kts`）：`-PoppoPush=true` 一开即 (a) settings 加 HeyTap Maven repo（`exclusiveContent` 限定 `com.heytap.msp` group）、(b) `implementation("com.heytap.msp:push:3.5.3")`。默认（无 flag）构建 **CI byte-identical**（门控日志实测 "OPPO Push disabled"）。因 Maven 依赖无本地文件可探，故用显式 opt-in flag 而非 vivo 的 AAR 探测。
- **`OppoPushService` 反射真集成**（`push/vendor/OtherVendorStubs.kt`，脱 stub）：`initialize()` 反射 `HeytapPushManager.init(ctx, DEBUG)` + `register(…, 动态代理 ICallBackResultService)`；回调 `onRegister`（跨版本 arg 数不定，取首个非空 String 作 regId）→ `RemoteSessionPushBridge.onNewToken(regId, "oppo")` 直接路由进活跃会话。`currentToken()` 反射 `getRegisterID()`；`isIntegrated()` 探 `Class.forName`——全 runCatching 兜底。
- **凭证**：`appKey`/`appSecret` 走 `BuildConfig.OPPO_PUSH_APP_KEY`/`_APP_SECRET`（`-PoppoPushAppKey/Secret`，空则 `initialize()` 跳过）——异于 vivo 走 manifest meta-data，因 OPPO register() 以参数收。
- 启动触发同 vivo（`AppInitializer` 按 manufacturer 自动 `initialize()`；OPPO/OnePlus/realme 命中）。
- 验证：`OppoPushServiceTest` 5（vendor 标签 / 无 SDK isIntegrated=false / 无凭证+SDK initialize 降级 false 且幂等 / currentToken=null / shutdown 安全 no-op）；`gradlew :app:kspDebugKotlin`（主 Hilt DI + `BuildConfig.OPPO_PUSH_*` 字段 + vendor→remote.session import 编译通过）+ `:app:testDebugUnitTest` 过；门控日志确认默认无 OPPO 依赖。剩真机项（Win 不可跑）：接入者传 `-PoppoPush=true` + 凭证（`docs/guides/Vendor_Push_Setup.md` §3.3 三步）+ 真机上架 OPPO 商店端到端验证；through/data 静默消息（`CompatibleDataMessageCallbackService`）defer（本期通知消息够唤醒审批）。

#### Phase 4：审计日志持久化 sink（JSONL，已完成）

- `packages/cli/src/harness/remote-session-audit-sink.js`：`RemoteSessionAuditFileSink` 接到审计日志的 `sink` 缝，把（已隐私脱敏的）审计流持久化为**换行分隔 JSON（JSONL）**文件，让取证记录跨宿主重启存活。每条一行；文件按大小上限**滚动**（`audit.jsonl` → `audit.jsonl.1` → …，`backups` 可配，默认保 1 份；`backups=0` 即到顶截断），永不无界增长。读取容忍**撕裂的末行**（崩溃时半截 append）——解析失败的行直接跳过。零依赖（仅 node:fs）且可注入 `fs`，日后换 SQLite 后端只需实现同样的 `{ handler, readAll }` 形状，不动审计日志与调用点。
- 审计日志 hydration：`RemoteSessionAuditLog` 新增 `initialEntries` 构造项——从持久化 sink 预填内存环并**沿用 seq 高水位**（新条目严格单调递增），且**不把已持久化条目回写 sink**（它们已在文件里）。重启后 `list`/`stats` 查询即含历史。
- WS：`ws-server` 用 `RemoteSessionAuditFileSink.fromEnv`（`CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_FILE` 启用 + `CHAINLESSCHAIN_REMOTE_SESSION_AUDIT_MAX_BYTES` 调滚动上限）构造 sink，注入审计日志并用 `readAll({limit:1000})` hydrate。未配置文件时 sink 为 null，审计日志保持纯内存（现有行为不变）。
- `REMOTE_SESSION_AUDIT_ACTIONS` 补齐 push 四类动作（`push.registered/sent/failed/skipped`）。
- 验证：`remote-session-audit-sink` 8 单测（缺 path 抛错、JSONL 追加 + 懒建父目录、撕裂行跳过、readAll limit、滚动跨 backup 读回、backups=0 截断、fromEnv、经审计日志 persist→hydrate 往返）+ `remote-session-audit` 扩测 2（hydration 沿用 seq 不回写 sink + malformed 行跳过、hydration 封顶 maxEntries 留最新）+ ws-server 集成 2（注入 sink 持久化 + 新 server hydrate、无 sink 保持纯内存）。远程会话全量 71 单测（7 文件）通过。

#### 仍待完成

1. Phase 3 第三片余项：跨端断线恢复真机/真 relay E2E（需 relay + host + 浏览器三方联调，Win 单机不可跑）。
2. Phase 4 余项：**FCM + APNs + Web push 三 sender 服务端、Android 取 token、`FirebaseMessagingService` onNewToken、web SW + 订阅、配对后 relay `push.register` 刷新路径均已完成**；仍缺：真实 `google-services.json`/APNs `.p8`/VAPID 密钥接入 + 真机·真浏览器端到端验证（`RemoteSessionFirebaseService` 条件源集需 google-services.json 才编译，Win 不可跑）；国内 provider（小米、华为 HMS、OPPO、vivo）sender 均已完成；SQLite 审计后端（当前 JSONL 已足够，按需再上）；策略的运行时热更新与来源（config.json vs env）合并。
3. 进程冷启动后的重新配对（当前自动重连仅覆盖同进程内瞬断；进程被杀后内存态密钥丢失需重新扫码）。
