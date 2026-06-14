# Android v1.0 — M4 D2 跨端审批真机 E2E 验收清单

> **版本**: v1.0 (2026-05-11) | **关联**: [Android 重新定位设计文档](Android_重新定位_设计文档.md) §6 M4 / §7.1 demo 路径 5+6
> **状态**: 🟡 待真机验收（桌面侧 JVM-integration 已绿，10 scenarios，`m4-d2-cross-end-approval.test.js`）

## 1. 范围

完整链路：

```
desktop business code
   ↓ context.source='mobile' 入向命令
desktop CommandRouter
   ↓ MobileSkillWhitelist.requiresApproval(method) === true
MobileApprovalChannel.requestApproval({peerId, method, params, ...})
   ↓ onRequest callback (wired by MobileApprovalTransport.wire)
MobileApprovalTransport
   ↓ JSON-RPC 2.0 envelope { method: "approval.request", params: <payload> }
mobile-bridge.sendReverseRpcRequest(peerId, request, 60000ms)
   ↓ WebRTC DataChannel
─────────────────────────────────────────
Android RemoteCommandClient
   ↓ method.startsWith("approval.")
CompositeCommandRouter
   ↓ namespace="approval"
ApprovalCommandRouter
   ↓ requestId / description / hash / requireBiometric
AndroidApprovalGate.requestApproval
   ↓ Compose ApprovalDialogHost 弹窗
🟢 用户点 "批准" + 触发 BiometricPrompt (requireBiometric=true)
   ↓
返回 { requestId, approved=true, deniedReason=null }
─────────────────────────────────────────
   ↓ JSON-RPC response 经 DataChannel → desktop
mobile-bridge.bridgeToLibp2p 拦截 (id 匹配 pendingReverseRpc)
   ↓ resolve sendReverseRpcRequest Promise
MobileApprovalTransport.then callback
   ↓ approvalChannel.resolveApproval(requestId, result)
MobileApprovalChannel
   ↓ resolve requestApproval Promise
desktop CommandRouter
   ↓ context.mobileApproval = {requestId, signature}
handler.handle(action, params, context)
   ↓ command 真执行 (marketplace.purchase / did.delegate / cowork.spawnTeam)
business response 回 mobile peer
```

## 2. 测试环境

| 组件          | 版本                                                              |
| ------------- | ----------------------------------------------------------------- |
| Desktop       | v5.0.3.47+ (含 M4 D2 桌面胶水 commit)                             |
| Android       | v0.37+ (含 `eba16a1d8` `ApprovalCommandRouter` + `eb7489bc4` UI) |
| 信令服务器     | localhost:9001 (signaling-server)                                |
| WebRTC ICE    | stun:stun.l.google.com:19302                                      |
| 网络           | 同 LAN / 跨 NAT 两套都走（看 §7.2 NAT p50 预算）                  |

## 3. 准备步骤

```bash
# Terminal 1 — 信令服务器
cd signaling-server && npm start

# Terminal 2 — desktop
cd desktop-app-vue && npm run dev
# 等待 "[Main] ✓ MobileApprovalChannel ↔ MobileBridge 已接通 (M4 D2 桌面胶水)"

# Android — 安装最新 debug APK + 完成首启 DID + 配对桌面
# 在 KeyManagementScreen 触发 "Debug Approval" (ef55a0fbf) 确认 ApprovalDialog 可弹
```

`config.json` 关键字段 (`.chainlesschain/`):

```json
{
  "mobileBridge": {
    "enabled": true,
    "exposeRemoteSkills": [
      "marketplace.*",
      "did.delegate",
      "cowork.spawnTeam",
      "ai.chat"
    ],
    "approvalChannelsForMobile": [
      "marketplace.purchase",
      "did.delegate",
      "cowork.spawnTeam"
    ],
    "approvalTimeoutMs": 60000
  }
}
```

## 4. 七大 demo 场景验收

| # | 场景 | 触发 | 预期 |
|---|------|------|------|
| 1 | **happy path · marketplace.purchase** | Android 端调 `marketplace.purchase {itemId, amount}` | 桌面 router gate → 弹 Android ApprovalDialog (含描述、hash 简显) → 用户 batch + BioPrompt 成功 → 桌面拿到 sig → handler 执行 → response 回 Android |
| 2 | **deny · 用户点 "拒绝"** | 同上，但 dialog 上点拒绝 | 桌面返回 PERMISSION_DENIED + `deniedReason="user-declined"`，handler **未调** |
| 3 | **biometric fail** | 同上，BioPrompt 用错指纹 3 次 | 桌面收 `deniedReason="biometric-failed"`，handler 未调 |
| 4 | **timeout · 用户晾着不动** | 同上，dialog 出后超过 60s 不操作 | desktop channel 内置 60s timeout 先 fire → `deniedReason="timeout"`；ApprovalDialog 在 Android 上变 disabled 或 dismiss |
| 5 | **transport 中途断** | dialog 弹出后 kill Android app | desktop sendReverseRpcRequest 60s 后 reject → `deniedReason` 含 `transport:` 前缀 |
| 6 | **non-approval whitelist · marketplace.browse** | Android 调 `marketplace.browse` | 桌面 router 不弹 dialog，直接执行 handler。验证：Android 端 **不应** 收 approval.request RPC |
| 7 | **白名单外 · system.shutdown** | Android 调 `system.shutdown` | 桌面 router 立刻 PERMISSION_DENIED + `method not allowed for mobile peers`；不发 RPC |

## 5. 跨端协议契约（断言点）

桌面发到 Android 的 `approval.request` JSON-RPC：

```json
{
  "jsonrpc": "2.0",
  "id": "apr-<uuid>",
  "method": "approval.request",
  "params": {
    "requestId": "apr-<uuid>",
    "peerId": "android-<deviceId>",
    "method": "marketplace.purchase",
    "params": { "itemId": "X", "amount": 25 },
    "requestedAt": 1700000000000,
    "payloadHash": "<sha256-hex 64-char>",
    "payloadDescription": "Marketplace · Purchase",
    "requireBiometric": true
  }
}
```

Android 经 `ApprovalCommandRouter` 返回的 JSON-RPC response：

```json
{
  "jsonrpc": "2.0",
  "id": "apr-<uuid>",
  "result": {
    "requestId": "apr-<uuid>",
    "approved": true,
    "deniedReason": null
  }
}
```

**关键不变量**:
- `request.id === request.params.requestId === response.result.requestId`
- `payloadHash` 长度 64，全 hex（验证：Android 侧可读取并展示后 4 位作"指纹"防钓鱼）
- `payloadDescription` 默认 `"<Namespace> · <Action>"`，业务侧可覆写显式中文描述
- `requireBiometric=false` 时 Android 跳 BioPrompt（仅用户确认）

## 6. 已知边角

- **deniedReason 透传**：Android `AndroidApprovalGate` 7 种 reason
  (`no-active-did` / `no-strongbox` / `user-declined` / `biometric-failed`
  / `invalid-payload-hash` / `sign-failed` / `cancelled`) 经 RPC response → desktop
  `transport:` / `rpc-error:` 前缀仅在 transport 层失败时出现
- **重复 requestId 拒绝**：mobile-bridge `pendingReverseRpc.has(id)` → 拒绝
  (实际不可能，UUID 冲突概率忽略)
- **多对设备并发**：desktop 当前 v1.0 单 paired Android（§8.2 限制）
- **桌面 routeMobileCommand 路径未走 CommandRouter**：当前 `desktop-app-vue/src/main/index.js
  ::routeMobileCommand` 是简化 switch，不经 CommandRouter。即 **Android → desktop 入向命令**
  目前不会触发 approval 闸。本 E2E 验的是 **desktop business → mobile approve** 的反向方向
  (e.g. 桌面 marketplace 调单子要 mobile 用户批准 — M5 ADR-6 的 sign 路径已在 d6ae3e3f8 接通)。
  Android → desktop 入向 approval 整合到 CommandRouter 列入 v1.1 (issue TBD)。

## 7. 失败 troubleshoot

| 症状                                                           | 根因                                             | 修复                                                |
| -------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| 桌面 log: `bindMobileBridge 调用早于 initializeCommandRouter` | RemoteGateway 还没 ready                          | 等 RemoteGateway 初始化完再调 — 检查 social-initializer 顺序 |
| Android dialog 不弹                                              | `ApprovalCommandRouter` 未在 `CompositeCommandRouter` 注册 | `git show eba16a1d8` 确认 `RemoteModule.kt` binding |
| 桌面发不出去 RPC                                                  | mobileBridge.sendReverseRpcRequest 在 `bridge.connect()` 前调  | 确认 `[Main] ✓ MobileApprovalChannel ↔ MobileBridge 已接通` log 出现 |
| 超时但 Android 已点同意                                          | response.id 不匹配 (Android 包错 id)            | 检查 Android `ApprovalCommandRouter` 返回 map 的 `requestId` 字段 |
| `deniedReason` 显示 `rpc-empty-response`                       | Android `P2PClient` 没把 router 结果包成 CommandResponse | 检查 Android 侧 transport encoding (memory 记 method+result+id 字段) |

## 8. 桌面侧 JVM 集成测试

`desktop-app-vue/src/main/remote/__tests__/m4-d2-cross-end-approval.test.js`
（10 scenarios，~250 行）覆盖桌面侧每个组件 + 跨边界协议。**不能** 替代真机
E2E：

- ✅ 覆盖：command-router gate、channel 状态机、transport JSON-RPC envelope、Android response shape 模拟、timeout / error 路径
- ❌ 不覆盖：真 WebRTC DataChannel transport、真 Android Compose Dialog、真 BiometricPrompt、真 StrongBox 签名

`m4-d2-cross-end-approval.test.js` 10/10 绿可以视为 **"差最后一公里"** —
本文档的真机验收是该最后一公里。

## 附录：规范章节补全（v5.0.3.108）

> 本文为真机 E2E 验收清单。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文场景。

### 1. 概述

见正文头部。Android v1.0 M4 D2 跨端审批真机 E2E 验收清单，关联 `Android_重新定位_设计文档` §6 M4 / §7.1 demo 路径 5+6，桌面侧 JVM 集成已绿（10 scenarios）。

### 2. 核心特性

7 大 demo 场景；跨端协议契约断言；ApprovalUI 跨端审批；失败 troubleshoot。

### 3. 系统架构

见正文「5. 跨端协议契约」：RemoteCommandClient → ApprovalCommandRouter → AndroidApprovalGate。

### 4. 系统定位

Android v1.0 M4 D2 **跨端审批的真机 E2E 验收**。

### 5. 核心功能

见正文 1–8：范围 / 环境 / 准备 / 7 demo 场景 / 协议契约 / 边角 / troubleshoot / JVM 集成。

### 6. 技术架构

command-router gate + channel 状态机 + transport JSON-RPC envelope；真 WebRTC DC / Compose Dialog / BiometricPrompt / StrongBox 由真机覆盖。

### 7. 系统特点

JVM 集成 10/10 绿 = 差最后一公里；本文真机验收即最后一公里。

### 8. 应用场景

跨端（Android↔桌面）审批 demo 真机验收。

### 9. 竞品对比

JVM 集成覆盖 vs 真机覆盖差异见正文 E2E 覆盖 / 不覆盖列表。

### 10. 配置参考

见正文 2「测试环境」与 3「准备步骤」。

### 11. 性能指标

审批往返时延（真机回填）；跨 NAT 见 `Android_M6_Performance_Validation.md`。

### 12. 测试覆盖

桌面侧 `m4-d2-cross-end-approval.test.js` 10/10 绿；真机 7 场景待验（见正文 8）。

### 13. 安全考虑

审批经 AndroidApprovalGate + BiometricPrompt + StrongBox 签名（真机）。

### 14. 故障排除

见正文 7「失败 troubleshoot」。

### 15. 关键文件

`m4-d2-cross-end-approval.test.js`；RemoteCommandClient / ApprovalCommandRouter / AndroidApprovalGate。

### 16. 使用示例

见正文 4「七大 demo 场景验收」与 adb logcat 监控命令。

### 17. 相关文档

`Android_重新定位_设计文档.md` §6 M4 / §7.1。
