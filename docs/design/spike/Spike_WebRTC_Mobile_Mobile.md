# Spike 2 — WebRTC mobile↔mobile 改造

> **状态**：代码现状调研完成 / 改造 diff plan 已出 / 真机验证待跑
> **关联**：AI 陪学 M3（双向音视频通话 + 静音旁观）
> **撰写日期**：2026-05-27
> **预计工期**：核心改造 8d + 真机回归 2d = 10d

---

## 1. 调研结论一句话

Plan A.1（v5.0.3.54 已 land）已沉淀了完整 WebRTC + DC 直连 + 信令双路 + 去重的基础设施，**mobile↔mobile 主要是对称化改造**而非新建。最大变更点是 `WebRTCClient.connect(isInitiator: Boolean)` 角色分岔 + 信令服务端无需改（peer-id 路由本来就对称）。

---

## 2. 现状架构（Plan A.1 v5.0.3.54）

```
当前：单向 desktop→mobile
┌──────────────┐                           ┌──────────────┐
│ Desktop (主) │                           │ Mobile (从)  │
│              │                           │              │
│ mobile-bridge│ ── signaling forward ──▶ │ Signaling    │
│ .js          │   (signaling-relay 中继)   │ RpcClient    │
│              │ ◀── DC direct (Plan A.1)─▶│              │
│              │   (TURN coturn 中继)       │ WebRTC       │
│ - 始终 答 应    │                           │ - 始终 主叫    │
│ - 接 offer    │                           │ - createOffer│
│ - 回 answer   │                           │ - sendOffer   │
└──────────────┘                           └──────────────┘

目标：mobile A ↔ mobile B 对称
┌──────────────┐                           ┌──────────────┐
│ Mobile A     │                           │ Mobile B     │
│ (家长)        │                           │ (孩子)        │
│              │                           │              │
│ WebRTC       │ ── signaling 4-hop ──────▶│ WebRTC       │
│ + Family-    │ ◀── DC direct (TURN) ─────│ + Family-    │
│ AwareRouter  │                           │ AwareRouter  │
│              │                           │              │
│ - 角色协商动态  │                           │ - 同左         │
│ - createOffer│                           │ - createAnswer│
│   或          │                           │   或          │
│ - createAnswer│                           │ - createOffer │
└──────────────┘                           └──────────────┘
```

---

## 3. 关键硬编码点（6 处需改）

| # | 文件 : 行 | 当前 | 改造 |
|---|---|---|---|
| 1 | `WebRTCClient.kt:210-250` | `connect()` 总是 `createOffer()` | 加 `isInitiator: Boolean` 参数；true → createOffer，false → 等待 offer 进 onOffer 回调后 createAnswer |
| 2 | `WebRTCClient.kt:250` | `signalClient.sendOffer(pcPeerId, ...)` 字段名暗示 "desktop" | 重命名 `pcPeerId` → `targetPeerId`；语义改为"对方 peer-id（角色不限）" |
| 3 | `mobile-bridge.js:249-254` (desktop) | `handleOffer` / `handleAnswer` 硬假设方向 | mobile-mobile 时桌面端 mobile-bridge 不参与（peers 直连）；只需保证 signaling-relay 转发不挑 from-role |
| 4 | `WebRTCClient.kt:69-117` | ICE config 由 desktop 单向 push（`chainlesschain:ice:config` 消息） | 改为双端各自从本地 `IceServerConfig` 拉 + 双端通过 P2P 互推 ephemeral token（如未来支持）|
| 5 | `SignalingRpcClient.kt:88-90, 101-150` | `isDcReady()` 依赖单 WebRTCClient 实例 | 改为 transport-aware：按 targetPeerId 维护一个 `Map<PeerId, WebRTCClient>`；调 invoke 时按目标 peer 查 transport |
| 6 | `TurnServerPreferences.kt:76-91` | TURN 凭证现按"desktop"维度持久化 | 改按 peerId 维度持久化（一个孩子可能对接多个家长，TURN 凭证各异）|

---

## 4. 信令消息协议（无需新增）

现有协议（spike 报告 §3.1）已是**对称的**：

```
offer / answer / ice-candidate / ice-candidates / registered / peer-status
```

→ signaling-relay 服务端**无需任何改动**，from/to 已经按 peer-id 路由

→ **应用层协议**（`chainlesschain:command:request` / `chainlesschain:event` / `chainlesschain:ice:config`）只需新增 family 类 method：
```
family.call.invite         // 家长发起呼叫
family.call.accept         // 孩子接受
family.call.reject         // 孩子拒绝（普通通话才可拒）
family.call.silent_observe // 静音旁观请求
family.call.urgent_force   // 紧急强接通
family.call.hangup
```

---

## 5. 改造 diff plan（按文件）

### 5.1 `WebRTCClient.kt`

```kotlin
// before
suspend fun connect(targetPeerId: String): Result<Unit> {
    // 5 steps: signaling→register→createPC+DC→createOffer→waitForAnswer
}

// after
suspend fun connect(
    targetPeerId: String,
    isInitiator: Boolean,         // ← 新增
    callKind: CallKind = CallKind.AUDIO  // audio | video | silent_observe | urgent
): Result<Unit> {
    if (isInitiator) {
        // 现有路径
        val offer = peerConnection.createOffer()
        peerConnection.setLocalDescription(offer)
        signalClient.sendOffer(targetPeerId, offer)
        waitForAnswer()
    } else {
        // 新路径
        // 不主动 createOffer，等 onOffer 回调
        waitForOffer().let { offer ->
            peerConnection.setRemoteDescription(offer)
            val answer = peerConnection.createAnswer()
            peerConnection.setLocalDescription(answer)
            signalClient.sendAnswer(targetPeerId, answer)
        }
    }
    waitForIceConnected()
    setupCallKindTracks(callKind)  // 按 kind 决定加 audio/video/screen track
    return Result.success(Unit)
}
```

### 5.2 角色协商（新增）

mobile-mobile 时两端可能"同时"发起。需协商谁是 initiator：

**方案**：基于 peer-id 字典序
- localPeerId < targetPeerId → 本端 initiator
- localPeerId > targetPeerId → 本端 responder
- 发生罕见 collision（家长 + 孩子同 ms 调 connect）→ 字典序大的一方等 200ms 重试

更鲁棒方案是加 `family.call.invite` envelope 含 `proposedRole`，由收到方拍板。MVP 先用字典序。

### 5.3 `CallKind` 枚举与 track 配置（v0.2 修订：加 permission 校验 + MediaProjection 现实约束）

```kotlin
enum class CallKind { AUDIO, VIDEO, SILENT_OBSERVE, URGENT, SOS_BROADCAST }

private suspend fun setupCallKindTracks(kind: CallKind) {
    // v0.2 关键新增：每个 track 添加前必须校验 family_relationship.permissions
    // 防止孩子端被远程指令偷偷打开摄像头 / 麦克风
    val perm = familyPermissionChecker.checkFor(targetPeerId)

    when (kind) {
        AUDIO -> {
            require(perm.allowCall) { "Audio call not permitted" }
            peerConnection.addTrack(localAudioTrack())
        }
        VIDEO -> {
            require(perm.allowCall) { "Video call not permitted" }
            peerConnection.addTrack(localAudioTrack())
            peerConnection.addTrack(localVideoTrack(useFront = true))
        }
        SILENT_OBSERVE -> {
            require(perm.allowSilentObserve) { "Silent observe not permitted" }
            // v0.2 修正：Android 14+ MediaProjection 必须每次用户同意
            // 不再是"配对时一次性同意永久有效"
            val mpToken = requestMediaProjectionWithUserConsent()
                ?: throw CallRejectedException("用户拒绝授权屏幕共享")
            // 单次最长 30min，到期自动断
            scheduleAutoHangup(durationMs = 30 * 60 * 1000)
            peerConnection.addTrack(localScreenTrack(mpToken))
            // 不加 audio track 防偷听
            // 同时显示 SilentObserveOverlay 横幅（依赖 spike 3）
            silentObserveOverlay.show()
        }
        URGENT -> {
            require(perm.allowForcePickup) { "Force pickup not permitted" }
            require(checkUrgentQuota()) { "Urgent quota exhausted (3/24h)" }
            peerConnection.addTrack(localAudioTrack())
            peerConnection.addTrack(localVideoTrack(useFront = true))
            // 红色横幅 + 不可静音
            urgentBanner.show()
        }
        SOS_BROADCAST -> {
            // M7 SOS 触发后，孩子端向所有 guardian 同时发起
            // 不需要 perm 校验（SOS 总是允许）
            peerConnection.addTrack(localAudioTrack())
            peerConnection.addTrack(localVideoTrack(useFront = true))
        }
    }
}
```

**MediaProjection Android 14+ 现实约束**（v0.2 关键修正）：

- Android 14+ 系统在每次启动屏幕共享时**强制弹用户授权对话框**，应用层无法 bypass（这是 Google 出于安全考虑加的）
- → **"配对时一次性同意，长期有效"的设计不成立**
- v0.2 改为：
  1. 静音旁观启动时孩子端弹"X 想看您屏幕，是 / 否"系统对话框
  2. 同意后单次最长 30min，到期自动断
  3. 期间显示 SilentObserveOverlay 持久横幅（spike 3）+ 状态栏蓝色 LED
  4. 孩子可随时按"暂停 2 分钟"或"立刻结束"
- 之前 v0.1 主文档承诺的"长期 24h 后台旁观" **不可上线**，已在主文档 §3.3 修正

### 5.4 `:feature-family-guard` 新模块结构

```
:feature-family-guard
├── src/main/java/com/chainlesschain/android/family/
│   ├── call/
│   │   ├── FamilyCallManager.kt        // 上层调度（M3 入口）
│   │   ├── CallKind.kt
│   │   ├── CallNegotiator.kt           // 角色协商
│   │   └── SilentObserveBanner.kt      // 持久横幅（依赖 spike 3）
│   ├── permission/
│   │   └── CallPermissionChecker.kt    // 校验 family_relationship.permissions
│   └── ui/
│       ├── ParentCallScreen.kt          // 家长拨打 UI
│       └── ChildIncomingCallScreen.kt   // 孩子接听 UI
```

### 5.5 `IceServerConfig` 双向化

```kotlin
// before
fun getServersForPc(pcPeerId: String): List<IceServer>

// after
fun getServersForPeer(peerId: String): List<IceServer>
fun upsertForPeer(peerId: String, servers: List<IceServer>, expiry: Long)
```

存储 schema：`PairedDesktopsStore` 改名 `PairedPeersStore`，字段不变（`peerId, iceServersJson, iceExpiry`）

---

## 6. 可直接复用的 trap 防御

| Trap | 状态 | mobile-mobile 是否仍生效 |
|---|---|---|
| Trap 1（setOnForwardedMessageReceived 单 listener 互覆盖） | ✅ A.1 Phase 4 已修：双路 SharedFlow 订阅 | ✅ 直接复用 |
| Trap 2（DC vs signaling 入 message 分裂） | ✅ A.1 统一 `_messages` flow | ✅ 直接复用 |
| Trap 3（P2PClient.sendCommand 私有 envelope）| ✅ TerminalRpcClient 分岔 transport | ✅ 复用同模板（FamilyCallRpcClient）|
| currentPeerId 误改 echo loop | ✅ iOS 已有文档警告 | ⚠️ **需新增防御**：握手时 `assert localPeerId != targetPeerId`；ice-candidate 收发时 `assert from != self` |
| LRU 去重 | ✅ TerminalRpcClient 用 sessionId\|seq | ✅ FamilyCallRpcClient 用 callId\|seq |

---

## 7. 工程量

| 工作项 | 估时 |
|---|---|
| `WebRTCClient.connect` 加 isInitiator 分岔 | 1.5d |
| `CallKind` 枚举 + track 配置（audio/video/screen） | 1.5d |
| `:feature-family-guard` 模块 scaffold + 6 文件 | 1d |
| `CallNegotiator` 角色协商（字典序）| 0.5d |
| `family.call.*` 6 个 envelope method 接通 | 1d |
| `IceServerConfig` 双向化 + Store 字段重命名 | 0.5d |
| echo-loop 防御加固 | 0.5d |
| ParentCallScreen + ChildIncomingCallScreen UI | 2d |
| 单测（含 turn 心跳、ICE 失败 fallback）| 2d |
| 真机回归（参考 §8）| 2d |
| **合计** | **~12.5d** |

---

## 8. 真机验证 checklist

mobile-mobile 4G/5G 互通 ICE 建立：
- [ ] **TC1**：两台 Android 同 Wi-Fi，跑 createOffer→answer→ICE→媒体推送（基线，必通）
- [ ] **TC2**：两台 Android 跨运营商 4G，校园 NAT 不友好场景 → TURN 中继是否兜底
- [ ] **TC3**：家长 Wi-Fi + 孩子 4G 切换场景 → ICE restart 是否生效
- [ ] **TC4**：静音旁观：孩子端 MediaProjection 推屏 + 麦克风不开 → 家长端收到屏幕流
- [ ] **TC5**：强接通：孩子端 ringer 模式静音时仍能响 → 验证
- [ ] **TC6**：握手 collision（双方 0ms 同时 connect）→ 字典序回退到位
- [ ] **TC7**：iOS Phase 6.6 远程桌面是否需对齐改造（Mac 跑）

---

## 9. 风险（v0.2 修订）

| 风险 | 缓解 |
|---|---|
| signaling-relay 服务端假设只有 desktop 可注册为"被叫" | 检查代码确认 from/to 已对称；若有边界，发个 PR 改 |
| 字典序 collision 防御过弱（家长持续按拨号）| 增加 invite envelope 含 `callId` + 服务端去重 |
| **MediaProjection Android 14+ 每次同意（v0.2 改）**| ✅ 改成每次启动都弹系统对话框 + 单次 30min 上限；放弃"长期后台旁观"卖点 |
| 孩子端摄像头被劫持（其他 app 占用）| Android API 自动报错，UI 提示孩子结束其他应用 |
| TURN 凭证 24h 过期 + mobile-mobile 长会话 | 心跳 + 临近过期前刷新 + ICE restart |
| **远程指令偷开摄像头 / 麦克风（v0.2 新增）**| 每个 track 加 permission 校验 + 系统强制 UI 通知（红点 + 状态栏摄像头图标）+ 孩子端横幅 |
| **强接通配额耗尽后家长仍想呼（v0.2 新增）**| 改为普通呼叫 + 写审计 + UI 提示家长"3/3 强接通已用完，请等待重置" |

## 10. Android 14+ MediaProjection 实际验证（v0.2 新增）

**TC4** 需在以下设备上跑：

- [ ] Pixel 8 (Android 14) — 验证 MediaProjection 每次启动都弹系统对话框
- [ ] Pixel 8 (Android 15 preview) — 验证 Android 15 是否进一步限制（如要求"特定应用类型"才能用）
- [ ] MIUI 14 (Android 14 base) — 验证 MIUI 是否额外加层
- [ ] Pixel 6 (Android 12-13) — 旧 API 行为对照（确认旧版本仍支持持久授权）

**期望输出**：
- 报告：哪个 Android 版本起 MediaProjection 从"持久授权"变为"每次同意"
- 报告：MIUI / HyperOS 是否在系统弹窗前先弹一层"是否允许 ChainlessChain 录屏"
- 决策：v0.1 MVP 的"静音旁观"是否照本设计 ship，还是降级为"仅紧急时使用"

---

## 10. 与其他 spike 的依赖

- **Spike 3（持久横幅）**：M3 静音旁观 + 强接通必须有持久横幅，spike 3 不通则 M3 SILENT_OBSERVE / URGENT 不可上线
- **Spike 1（DPC）**：独立，不阻塞
- **iOS Phase 6.6**：iOS 端若也要支持 mobile-mobile，可参考此 spike，但本批次不在范围
