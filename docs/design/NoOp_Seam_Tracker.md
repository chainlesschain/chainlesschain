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
| A1 | `NoOpParentTimeSource` | `ParentTimeSource` | `feature-family-guard/.../di/TimeModule.kt` | 从家长端 P2P 拉权威时间锚 `CristianTimeAuthority`。现永远 `NEVER_SYNCED` → 退化设备墙钟，**防改钟机制失效**。需 :app 接 `family.time.*` P2P responder + 2 真机 | 🔒 安全(可被改钟绕过监管) |
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
> **先接通推送厂商 SDK，A 组的 notifier 才有落点。** 文档：`docs/guides/Vendor_Push_Setup.md`

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

## 处理优先级建议

**可立即处理(与真机无关，纯 :app 接线)**
- [x] **A7** 验签：已换 `LenientManifestVerifier` 默认(verify-if-present)。完整强制验签待 marketplace M0
- [ ] **A1** 防改钟：:app 实现 `family.time.*` P2P responder + 覆盖 `ParentTimeSource` 绑定(安全；需对端 desktop responder，但逻辑层已就绪)

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
