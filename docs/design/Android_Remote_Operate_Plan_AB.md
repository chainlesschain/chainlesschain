# Android Remote Operate — Plan A + B（WebRTC P2P + STUN/TURN）设计文档

> 状态: 🟡 基础设施落地 v5.0.3.51 (2026-05-14)，WebRTC 端到端实测待补
> 关联: [Plan C — Signaling Forward](Android_Remote_Operate_Plan_C.md)（前置）
> 实现 commits: `e9f9d6275` (signaling-relay-service) + `af11daa6e` (RelayClient WebRTC dispatch + iceServers push)

## 1. Plan C 之后

[Plan C](Android_Remote_Operate_Plan_C.md) 让低频命令（Ping / 系统状态 / 一次性查询）跨 LAN+WAN 跑通。命令走信令转发，p99 延迟 100-400ms 实测。但有两个硬约束：

- **吞吐**：中继带宽全平台共享 — 流式 token / 文件 / 视频不能走
- **隐私**：公网 wss 之外，中继服务器仍看到 payload 明文（已 TLS 但中间人可见）

为这两个场景，需要 **真 WebRTC P2P DataChannel**（端到端加密 + 直连带宽）。

## 2. 三段位完整图景

```
                      ┌─── Plan C (signaling forward) ───┐
                      │  低频命令 / 短消息             │
                      ├─── Plan A (WebRTC DC)─────────────┤
                      │  高吞吐 / 流式 token / 文件     │
                      ├─── Plan B (STUN/TURN)─────────────┤
                      │  NAT 穿透兜底                    │
                      └───────────────────────────────────┘
                                  ↓
                  根据场景在客户端 fall-through:
                  优先尝试 DataChannel → 失败 fallback 信令 forward
```

## 3. Plan A — WebRTC Signaling 透传中继

**问题**：WebRTC 建连依赖三种 signaling 消息（offer / answer / ice-candidate），在 LAN 由 desktop `SignalingServer` 转发，**WAN 下没人转发**。

**改动**:

### 3.1 中继 server (`backend/signaling-relay-service/server.js`)

```js
// before: 只转发 type === "message"
case "message": handleMessage(ws, msg); break;

// after: WebRTC 三件套也走 forward 路径，与 LAN signaling-server 对齐
case "message":
case "offer":
case "answer":
case "ice-candidate":
case "ice-candidates":
case "peer-status":
  handleMessage(ws, msg);
  break;
```

`handleMessage` 注入 `from` 字段（取 ws 已 register 的 peerId），与 LAN signaling-handlers 行为一致 — 桌面 `handleOffer` 内部用 `socket.peerId || message.from` 取对端，relay 路径必须显式补 from。

### 3.2 桌面 main (`desktop-app-vue/src/main/index.js`)

`startRelayClient.onMessage` 简化为统一 dispatch — 不再按 type 自己 case：

```js
onMessage: (msg) => {
  // pair-ack 还是单独路由（写 sessionState）
  if (msg.payload?.type === "pair-ack" || msg.type === "pair-ack") {
    recordPairAck(msg.payload || msg);
  }
  // 其余（command:request / offer / answer / ice）交给 mobile-bridge 同款 dispatcher
  this.mobileBridge?.handleSignalingMessage?.(msg);
}
```

`mobileBridge.handleSignalingMessage(msg)` 本来就按 `msg.type` 分发到 `handleOffer / handleAnswer / handleICECandidate / handleP2PMessage` — LAN 路径与 relay 路径完全等价。

### 3.3 验证

| 场景 | 路径 | 状态 |
|---|---|---|
| Mobile 发 offer 到中继 → desktop 收 | ✅ relay forward → handleOffer 触发 `setRemoteDescription / createAnswer` | 协议通了，端到端 P2P DC 建连未实测 |
| Mobile 发 ICE candidate → desktop | ✅ relay forward → handleICECandidate `peerConnection.addIceCandidate` | 同上 |
| Desktop 发 answer → mobile | ✅ 桌面 `sendToMobile` 不可达 LAN dataChannel 时双发 (LAN + relay) | Plan C 同款，已实测 |

实际 P2P DataChannel 是否真打通**依赖 Plan B 的 STUN/TURN**（家用 NAT 直接 hairpin / symmetric NAT 没有 STUN/TURN 通常不通）。

## 4. Plan B — STUN/TURN 部署

部署文档另见 [signaling-relay-and-turn-deploy](../../../memory/...)。要点：

### 4.1 coturn 容器（`/opt/cc-turn/` on VPS 47.111.5.128）

- 镜像 `coturn/coturn:4.6`，host network（UDP relay 端口范围 49152-65535）
- 监听 `0.0.0.0:3478` UDP+TCP + `5349` TLS
- 域名 `turn.chainlesschain.com`（A 记录 → 47.111.5.128，Let's Encrypt 证书 acme.sh 续）
- 鉴权 `use-auth-secret`（time-limited credentials，HMAC-SHA1）

### 4.2 凭证签发（桌面端）

`desktop-pair-handlers.js` 加 `signIceCredentials(userId)`：

```js
const username = `${expiry}:${userId}`;        // <expiry-ts>:<user-id>
const credential = HMAC-SHA1(TURN_SECRET, username).toBase64();
return {
  iceServers: [
    { urls: [`stun:turn.chainlesschain.com:3478`] },
    {
      urls: [
        `turn:turn.chainlesschain.com:3478?transport=udp`,
        `turn:turn.chainlesschain.com:3478?transport=tcp`,
        `turns:turn.chainlesschain.com:5349`,
      ],
      username,
      credential,
    },
  ],
  expiry,
};
```

- TTL = 24h（足够单设备使用，过期前用户多半已重新配对）
- env `CC_TURN_SECRET` 强制必填 — **源码里没有 fallback，绝不硬编码 secret**（任何 fork 也无法签出生效凭证）
- 缺 env 时降级 STUN-only（LAN + 双 NAT 友好场景仍能 WebRTC，跨 NAT 不可用）

### 4.3 客户端接入（Android）

**iceServers 不塞 QR**（QR payload 650+ 字符 + 高纠错 → 280px 扫描识别率暴跌实测，2026-05-14 阻塞 30s 扫不出）。改成扫码后异步推送：

- 桌面 `pair-ack matched` 后 `pushIceServersToMobile(ackPayload)` —— LAN signaling + 公网中继**双发** `{type:"chainlesschain:ice:config", payload:{pcPeerId, iceServers, iceExpiry}}`
- 手机 `WebRTCClient.setOnForwardedMessageReceived` 拦截该 type → 持久化到 `PairedDesktopsStore.iceServersJson / iceExpiry`
- 同步加 `SignalingRpcClient` 监听备份（race-tolerant — 两侧 listener 都 upsert 同一 store）

WebRTCClient 创建 PeerConnection 时按 pcPeerId 从 store 查 iceServers，过期/缺失 fallback Google STUN：

```kotlin
private fun resolveIceServersFor(pcPeerId: String): List<PeerConnection.IceServer> {
    val desktop = pairedDesktopsStore.devices.value.firstOrNull { it.pcPeerId == pcPeerId }
    val json = desktop?.iceServersJson ?: return fallbackIceServers
    val now = System.currentTimeMillis() / 1000
    if (desktop.iceExpiry > 0 && now > desktop.iceExpiry) return fallbackIceServers
    return parseIceServersJson(json).ifEmpty { fallbackIceServers }
}
```

## 5. 数据流（Plan A+B 配合）

```
┌──── 配对阶段 ────────────────────────────────────────┐
│ 1. Phone scans desktop QR (含 signalingUrl + relayUrl)
│ 2. Phone sends pair-ack via signaling
│ 3. Desktop matches → persist SQLite + push iceServers
│ 4. Phone receives ice:config → PairedDesktopsStore upsert
└──────────────────────────────────────────────────────┘

┌──── WebRTC 建连阶段 ─────────────────────────────────┐
│ 5. Phone opens RemoteControl → WebRTCClient.connect(pcPeerId)
│ 6. WebRTCClient.createPeerConnection 用 stored iceServers (含 TURN)
│ 7. createOffer → signaling forward (LAN or relay) → desktop
│ 8. Desktop handleOffer → setRemoteDescription → createAnswer → forward back
│ 9. ICE candidate exchange via forward
│ 10. STUN/TURN 打通 → DataChannel "open"
└──────────────────────────────────────────────────────┘

┌──── 命令路径 ────────────────────────────────────────┐
│ Low-freq: SignalingRpcClient → relay forward (Plan C)
│ Hi-throughput: DataChannel direct (Plan A)
│ NAT-hard: TURN relay (Plan B; DataChannel through relay)
└──────────────────────────────────────────────────────┘
```

## 6. 阿里云安全组要求

| 协议 | 端口 | 用途 |
|---|---|---|
| UDP | 3478 | STUN/TURN UDP（首选） |
| TCP | 3478 | STUN/TURN TCP fallback |
| TCP | 5349 | TURNS over TLS |
| UDP | 49152-65535 | TURN relay 范围 |

未开端口 → coturn 容器跑但外部不可达 → WebRTC ICE 收集失败 → DC 建不起来。

## 7. 已知限制 / 待办

| 项 | 现状 | 后续 |
|---|---|---|
| iceServers TTL 过期 | 24h，过期后 fallback Google STUN，跨 NAT 不通 | 后台 refresh：mobile 检测 expiry 临近 → 经信令请求新凭证 |
| WebRTC P2P 端到端真机实测 | infra 已通，未跨 NAT 真测 | v1.4 GA 前做一次：phone 4G + desktop home WiFi 完整 file-transfer 流 |
| Signal Protocol E2EE | Plan C 当前明文经中继；e2ee 模块独立但未挂 | 等 Plan A DC 通了再考虑（DC 已是直连，TLS 之外加 Signal 收益边际） |
| Coturn 凭证管理 API | 当前 secret 直接签；TTL 短 ok | 长期需 backend HMAC 签发 API（鉴权用户身份后才签） |

## 8. 实现 commits

| Commit | 内容 |
|---|---|
| `e9f9d6275` | feat(signaling-relay): public WebSocket signaling relay (#21 plan A+C infra) |
| `af11daa6e` | feat(remote-operate): plan A+B — RelayClient WebRTC dispatch + iceServers push |

## 9. 部署位置

- 中继: `/opt/cc-signaling-relay/` on 47.111.5.128 → wss://signaling.chainlesschain.com
- coturn: `/opt/cc-turn/` on 47.111.5.128 → turn.chainlesschain.com（3478 UDP/TCP + 5349 TLS）
- nginx vhost + cert via acme.sh @gitee（GitHub 大陆访问受限）

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. Plan C 之后」。Plan A+B 在 Plan C 信令转发之上加 WebRTC P2P 直连（Plan A signaling 透传中继）+ STUN/TURN 部署（Plan B coturn），构成远程操控三段位。

### 2. 核心特性

WebRTC signaling 透传中继；coturn STUN/TURN；iceServers 凭证签发；三段位（LAN / 中继 / P2P）完整图景。

### 3. 系统架构

见正文「2. 三段位完整图景」+「3. Plan A 中继」+「4. Plan B STUN/TURN」。

### 4. 系统定位

Android 远程操控的**WebRTC P2P + STUN/TURN 基础设施层**（Plan A+B）。

### 5. 核心功能

见正文：中继 server（signaling-relay）、桌面 main iceServers push、coturn 凭证签发、Android 客户端接入。

### 6. 技术架构

`backend/signaling-relay-service`；coturn（`/opt/cc-turn/`）；WebRTC ICE；nginx + acme.sh 证书。

### 7. 系统特点

基础设施落地 v5.0.3.51，WebRTC 端到端实测待补；证书走 gitee（GitHub 大陆访问受限）。

### 8. 应用场景

跨网络（非同 LAN）远程操控经 TURN 中继 / P2P 直连。

### 9. 竞品对比

见 `Android_Remote_Operate_Plan_C.md`（signaling-forward 前置，无 WebRTC）。

### 10. 配置参考

见正文「9. 部署位置」：signaling-relay `/opt/cc-signaling-relay/`、coturn `/opt/cc-turn/`（3478/5349）。

### 11. 性能指标

P2P 直连 < 中继延迟；TURN relay 兜底跨 NAT。

### 12. 测试覆盖

见正文「3.3 验证」；WebRTC 端到端实测待补。

### 13. 安全考虑

TURN 凭证短期签发（桌面端）；5349 TLS；信道基于配对信任。

### 14. 故障排除

ICE 失败 / TURN 连不上 → 检查 coturn 凭证与端口（见正文 §4）。

### 15. 关键文件

`backend/signaling-relay-service/server.js`；`desktop-app-vue/src/main/index.js`（iceServers push）；coturn 配置。

### 16. 使用示例

见正文 §3.3 验证步骤与 §4.3 Android 接入。

### 17. 相关文档

见正文头部关联：`Android_Remote_Operate_Plan_C.md`（前置）。
