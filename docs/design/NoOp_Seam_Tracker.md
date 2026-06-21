# NoOp Seam Tracker — 已接线但空实现的 seam 清单

> 创建：2026-06-02 · 维护者：family-guard / android remote
> 目的：集中跟踪所有「接口已定义、DI 已接线、但生产绑定是 NoOp(或 stub)」的 seam，
> 避免「纯逻辑层单测全绿 → 标记完成」掩盖功能实际未通的事实。
>
> **扫描方法**：`grep -rn "class NoOp\|object NoOp" android-app --include="*.kt"` +
> 逐个核对 DI `@Binds` 目标实现。测试替身(`src/test/**`)不计入。
> 重新扫描后请更新本表的「上次核对」日期。

---

## 状态图例

| 状态 | 含义 |
|---|---|
| 🔴 DORMANT | 生产 DI 绑定的就是 NoOp，功能实际不工作 |
| 🟡 STUB | 非 DI 的 stub 方法，只打日志 / TODO，未调真实 SDK |
| 🟢 COVERED | NoOp 类仍在仓库，但生产已被真实实现覆盖(可作 fallback，不算债) |

---

## A. 🔴 真正休眠的生产 seam(7)

> 共同根因：`:app` 层的 P2P / PushVendor / SMS 接线未做。多数标注「真机/设备阻塞」，
> 但 **#7 / #1 与设备无关，纯 :app 接线即可启用**（见末尾「可立即处理」）。

| # | NoOp 实现 | 接口 | 绑定处 | 应做什么 / 阻塞点 | 风险 |
|---|---|---|---|---|---|
| ~~A1~~ | ~~`NoOpParentTimeSource`~~ → `P2PParentTimeSource` | `ParentTimeSource` | feature TimeModule(移除默认)→ `:app/di/ParentTimeModule.kt` | ✅ **2026-06-02 已接线(两半 armed)**。详见下方「A1 处理记录」。剩余:2-真机 E2E 验证真实同步 | 🟡→ 2-真机 E2E |
| A2 | `NoOpSosNotifier` | `SosNotifier` | `feature-family-guard/.../di/SosModule.kt` | SOS 广播 / 误触撤销 / 已接通 stand-down 通知。现全空。需 :app 接 P2P + PushVendor(FAMILY-43/46) | 🔒 安全(SOS 不达) |
| A3 | `NoOpEmergencyContactNotifier` | `EmergencyContactNotifier` | `feature-family-guard/.../di/SosModule.kt` | SOS 60s 兜底给 emergency_contacts 发短信(FAMILY-45)。现空。需接云厂商 SMS API | 🔒 安全(兜底不达) |
| A4 | `NoOpExternalContactNotifier` | `ExternalContactNotifier` | `feature-family-guard/.../di/FamilyGuardBindingsModule.kt:130` | 复活码紧急解绑时通知外部联系人(`EmergencyUnbindServiceImpl` 消费)。现空 | 中 |
| A5 | `NoOpGuardianAnomalyNotifier` | `GuardianAnomalyNotifier` | `feature-family-guard/.../di/AnomalyModule.kt` | `AnomalyDetector` 检出异常后推家长(高优上行)。现空。需 :app FAMILY-61 接 PushVendor | 中(异常静默) |
| A6 | `NoOpGroupChatNotifier` | `GroupChatNotifier` | `feature-family-guard/.../di/NegotiationModule.kt` | 多家长规则冲突推协商频道(FAMILY-62)。现空。需 :app 接 friend-chat group | 低 |
| ~~A7~~ | ~~`NoOpManifestVerifier`~~ → `LenientManifestVerifier` | `ManifestSignatureVerifier` | `app/.../remote/registry/RemoteSkillRegistry.kt`(默认字段) | ✅ **2026-06-02 已硬化(verify-if-present)**。详见下方「A7 处理记录」。剩余:完整强制验签 = marketplace M0(签名流水线 + 信任锚) | 🟢→ forward-compat |

---

## B. 🟡 非 DI stub:推送厂商(1 文件 / 4 厂商)

`android-app/app/.../push/vendor/OtherVendorStubs.kt`

| 厂商 | 类 | 状态 | 备注 |
|---|---|---|---|
| 华为 HMS | `HuaweiPushService` | 🟡 stub | `initialize()` 仅 `Timber.w`，真实 `HmsInstanceId` 调用 `// TODO v1.2` |
| OPPO | `OppoPushService` | 🟡 stub | `HeytapPushManager` `// TODO v1.2` |
| Vivo | `VivoPushService` | 🟡 stub | `PushClient` `// TODO v1.2` |
| FCM | (同文件) | 🟡 stub | `FirebaseMessaging.getToken` `// TODO v1.2` |
| 小米 | `XiaomiPushService.kt`(独立文件) | 参考实现 | 唯一非 stub；需真机确认是否真通 |

> **叠加风险**：A2/A3/A5/A6 的告警最终都走推送通道，而推送本身 4/5 厂商是 stub。
> **先接通推送厂商 SDK，A 组的 notifier 才有落点。**
> - 接入步骤（怎么改代码）：[`docs/guides/Vendor_Push_Setup.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/guides/Vendor_Push_Setup.md)
> - **可执行清单**（前置账号/凭证阻塞项 + checkbox + 验收口径）：[`docs/guides/Vendor_Push_Integration_Checklist.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/guides/Vendor_Push_Integration_Checklist.md)

---

## C. 🟢 已覆盖(NoOp 类保留作 fallback，非债)

> grep 会命中，**勿误报为债**。

| NoOp 类 | 生产实际绑定 | 绑定处 |
|---|---|---|
| `NoOpTelemetryOutbox` | `SyncManagerTelemetryOutbox` | `app/.../di/TelemetryModule.kt` |
| `NoOpDataLifecycleAuditLogger` | `AuditLogDataLifecycleLogger` | `feature-family-guard/.../di/LifecycleModule.kt` |
| `NoOpLlmInferenceEngine` | `MediaPipeLlmEngine`(真机有 .so；JVM test 故意 fail-fast) | `app/.../di/LlmModule.kt` |

---

## D. 排除项(不是 seam)

- `core-p2p/src/test/.../SyncManagerTest.kt` 的 `NoOpSyncOutbound/Walker/DataApplier/RemoteCursorDao` — 合法测试替身。
- 桌面 / JS 侧无生产 NoOp 类(仅 `mobile-bridge.test.js` 命中)。

---

## A7 处理记录(2026-06-02)

> **纠正**：A7 最初被标为「安全漏洞、纯接线即可启用」，**此判断夸大了**。核对后发现：
> 1. 当前 100% 的 skill 未签名（SeedRegistry 0 签名 / 桌面无签名生产代码 / `signature` 默认 null）；
> 2. `Ed25519ManifestVerifier.verify(null)` 直接 `Rejected("NO_SIGNATURE")` —— 直接接它会**拒掉所有现有更新**，破坏桌面下发；
> 3. 设计本就把强制验签**刻意推迟到 marketplace M0**（push 来源=已配对桌面=可信信道）；
> 4. `RemoteSkillRegistry` 在生产代码里**根本没有被任何地方注入/调用**，连「init 站点」都不存在，无处挂 `setManifestVerifier`。

**已落地(verify-if-present 宽容迁移验签器)**：
- 新建 `LenientManifestVerifier`：`signature==null` → 放行(零回归)；`signature!=null` → 委托 `Ed25519ManifestVerifier` 必须验过否则拒。
- 把 `RemoteSkillRegistry` 默认验签器从 `NoOpManifestVerifier` 换成 `LenientManifestVerifier.withoutTrustAnchor()`(无信任锚：签名但未知发布者 → `UNKNOWN_PUBLISHER` 拒，安全默认)。
- **效果**：严格强于 NoOp(伪造签名不再被盲接受)、严格弱于直接 Ed25519(不破坏未签名 push)。今日无签名 skill → 无运行时影响，但路径已武装，桌面一旦开始签名当天即生效。
- 测试：`LenientManifestVerifierTest`(6 例)+ 更新 `ManifestSignatureVerifierTest`(默认行为变更 + 回归守卫)；`:app:testDebugUnitTest` 四类全绿。
- **剩(marketplace M0)**：桌面 manifest 签名流水线 + 公钥分发 + 把 `withoutTrustAnchor()` 换成带真实 resolver 的验签器 + 全员签名后把 null 分支翻成拒。

## A1 处理记录(2026-06-02)

> **纠正**：A1 最初被标为「纯 :app 接线」，**此判断低估了**。它需要**请求-响应式 P2P + 桌面 responder + 2 真机**，端到端无法在 Win 开发机验证（与 A7 的纯逻辑自包含不同）。user 选「建两半 armed 代码 + 单测，留 2-真机 E2E」。

**已落地(两半 armed，单测 + Hilt 全图编译全绿)**：
- **桌面 parent 侧**（`p2p/mobile-bridge.js`）：`handleP2PMessage` 加 `family.time.request` responder → 回 `{parentEpochMs: Date.now()}`（桌面=可信授时源）。+3 vitest。
- **Android child 侧**：
  - `remote/webrtc/FamilyTimeRpcClient`（请求-响应 over `SignalClient`，requestId 关联 + 5s 超时，FamilyCallRpcClient 模板派生）。
  - `familyguard/time/P2PParentTimeSource`（实现 `ParentTimeSource`，从 `PairedPeersStore` 取第一个对端 pcPeerId 委托 RPC）。
  - `di/ParentTimeModule`（:app 绑 `ParentTimeSource` → `P2PParentTimeSource`）；feature `TimeModule` **移除** NoOp 默认绑定（照 TelemetryOutbox 成例，避 Hilt 重复绑定）。`NoOpParentTimeSource` 类保留作 fallback。
  - `data/time/TimeSyncTimer`（30min 周期调 `TimeAuthority.sync()`，FamilyGuardForegroundService 托管，同 AnomalyScanTimer 模式）。
  - +FamilyTimeRpcClientTest（5 例）+ P2PParentTimeSourceTest（3 例）+ TimeSyncTimerTest（3 例）。
- **效果**：链路全通 —— 30min timer → TimeAuthority.sync() → P2PParentTimeSource → FamilyTimeRpcClient →（P2P）→ 桌面 responder → 回 epoch → Cristian 锚定单调钟。**今日**：只要孩子端配对了桌面并联网，防改钟即真生效（不再恒 NEVER_SYNCED）。
- **剩(2-真机 E2E)**：真实 child↔desktop 同步 + RTT 估算 + skew 锁触发，需 Android 真机 + 真桌面 + 配对，Win 不可跑。mobile↔mobile 家长选择（非桌面 parent）留后续细化。

## 处理优先级建议

**可立即处理(与真机无关，纯 :app 接线)**
- [x] **A7** 验签：已换 `LenientManifestVerifier` 默认(verify-if-present)。完整强制验签待 marketplace M0
- [x] **A1** 防改钟：两半 armed（桌面 responder + Android RPC/适配器/绑定/30min 触发）已落 + 单测 + Hilt 全图绿。剩 2-真机 E2E 验真实同步

**需先做前置基建**
- [ ] **B** 推送厂商：接通华为/OPPO/Vivo/FCM SDK(解锁 A2/A3/A5/A6 的告警落点)
- [ ] **A2–A6** notifier 真实实装：依赖 B(推送) + SMS 厂商 + 真机 E2E

**验收口径**：每个 seam 接通后，绑定从 `NoOp*` 切到真实实现，并补一条真机 E2E(对应
`docs/design/FAMILY-26_Telemetry_RealDevice_E2E_Plan.md` 风格)，再把本表状态改为 🟢。

---

## 维护记录

| 日期 | 操作 | 上次全量核对 commit |
|---|---|---|
| 2026-06-02 | 初版，10 NoOp 类 + 推送 stub 盘点 | `47b6993e7` |
| 2026-06-02 | A7 硬化：NoOp→LenientManifestVerifier(verify-if-present)默认 + 测试全绿；纠正 A7 风险定性 | `47b6993e7` |
| 2026-06-02 | A1 两半 armed：桌面 family.time responder + Android FamilyTimeRpcClient/P2PParentTimeSource/绑定迁移/30min TimeSyncTimer + 11 单测 + Hilt 全图绿；纠正 A1 为 2-真机阻塞 | `eb94d2f15` |

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。NoOp Seam Tracker：已接线但空实现（NoOp）的 seam 清单。

### 2. 核心特性
NoOp seam 清单 / 待实装跟踪。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「NoOp Seam Tracker」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
