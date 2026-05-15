# C.1 watch face → VoiceMode — spike v0.2

> **Issue**: [#21](https://github.com/chainlesschain/chainlesschain/issues/21) C.1（GA 后续 scope · P1）
> **状态**: 🟢 PR1 ✅ + PR2 ✅ landed (2026-05-15) — phone-side wear-forward 链路完整
> **作者**: 2026-05-15
> **关联**: [Android 重新定位 §10 C.1](Android_重新定位_设计文档.md) / [三端 UI Consistency §3.1 + §3.4](三端_UI_Consistency_设计文档.md)
> **下一步**: PR3 Wear UI 加 Voice entry point (complication+tile+watch-face) + wear-side `WearVoiceSender.send()` via `MessageClient.sendMessage("/cc/voice/start", json)`

---

## 1. 准入条件重评（2026-05-15）

**Android 重新定位 §10 C.1 原 framing**：
> v1.2 wear 端用 ApprovalCard tap 进决策路径，watch face 直达 voice 还需 phone Auto Phase 1 voice intent 抽出 generic `cc.voice.start` IPC（v1.2 是 Auto 私有），wear 复用同一 intent。

**重评后真实情况**（2026-05-15 audit）：

| 原 framing | 真实状况 |
|---|---|
| Auto Phase 1 有 voice intent 但是 Auto 私有 | **没有 voice intent** — `cc.voice.start` 在仓库内 0 匹配；Auto VoiceMode 通过 `androidx.car.app` Screen API 接入（CarApp 内部 Screen 切换，不是 Android Intent），Auto host 启动时自动到 VoiceModeScreen |
| 抽 generic 化即可 | **不存在的 IPC 不能"抽象"** — C.1 真工作是**从零定义**一条 generic intent + 两个 launch surfaces (phone + wear) |
| Wear 复用同一 intent | Wear 现状：`PendingApprovalsComplicationService.buildTapIntent` 只构造回 `WearMainActivity` 的 PendingIntent；无任何 phone-side launch path；wear→phone 走 `MessageClient` Data Layer (`/cc/decision` 已落，需要新 `/cc/voice/start` path) |
| Phone VoiceMode 现成 | `presentation/screens/voice/VoiceModeScreen.kt` 存在但**完全孤儿** — NavGraph 中无注册，BottomNavigationBar 中无入口，仅 `feature-ai` 模块的 ViewModel 引用。事实上 phone 用户今天无法到达这个屏 |

**结论**：C.1 准入条件不是"抽象 IPC"，是**从零建立** phone-side 入口 + wear→phone 跨设备桥。Spike doc 据此重写。

---

## 2. 三 PR 拆分

| PR | 状态 | 文件 | 描述 |
|---|---|---|---|
| 1 | ✅ landed (2026-05-15) | `android-app/app/src/main/.../voice/VoiceLaunchActions.kt` (新) + `navigation/NavGraph.kt` + `MainActivity.kt` + `AndroidManifest.xml` + tests | **Phone-side intent + NavGraph 注册** — 定义 `ACTION_START_VOICE_MODE` (`com.chainlesschain.android.action.START_VOICE_MODE`) Android Intent constant + Source enum (PHONE_SHORTCUT / AUTO_BUTTON / WEAR_FORWARD / EXTERNAL) + `EXTRA_TRIGGER_SOURCE` extra；NavGraph 加 `Screen.VoiceMode` + 路由 composable 接 phone-side `VoiceModeScreen`；MainActivity onCreate / onNewIntent 处理 intent action → 若匹配则 navigate；manifest exported 的 `<intent-filter>` |
| 2 | ✅ landed (2026-05-15) | `android-app/app/src/main/.../wear/CcPhoneVoiceListener.kt` (新) + manifest service entry + 11 Robolectric tests | **Phone-side Data Layer listener** — `WearableListenerService` `@AndroidEntryPoint` (Hilt) 监听**精确路径** `/cc/voice/start`（manifest `android:path` 而非 `pathPrefix`，与现 `CcPhoneDecisionListener` `/cc/` prefix 不互扰）→ parse `VoiceForwardWire` JSON (`trigger_source` / `wear_node_id` / `client_request_id` / `issued_at_ms`) → `startVoiceActivity` helper 调 `VoiceLaunchActions.buildIntent(WEAR_FORWARD, clientRequestId)` + `FLAG_ACTIVITY_NEW_TASK` + `FLAG_ACTIVITY_RESET_TASK_IF_NEEDED` + `setPackage(this.packageName)` → `startActivity`。**安全锁**：payload `trigger_source` field 忽略，固定 source=WEAR_FORWARD（wear-side 攻击者不能伪 AUTO_BUTTON / PHONE_SHORTCUT）。11 Robolectric tests cover path constant lock / wire 序列化往返+缺字段+未知字段 (forward-compat) / Intent action+extras+flags+package+null-safety / 攻击者 forge 防御 / full JSON→Intent→extract pipeline |
| 3 | ⏳ pending | `android-app/wear-app/.../tile/PendingApprovalsComplicationService.kt` + 新 `VoiceShortcutTileService.kt` + wear `WearVoiceSender.kt` (新) | **Wear UI entry point** — (a) complication tap 加 long-press fallback action 触发 wear→phone voice forward (b) 新 standalone Voice tile（"对话"图标 + tap 立刻 forward）(c) watch face complication slot 可设此 tile (d) `WearVoiceSender.send()` 通过 `MessageClient.sendMessage("/cc/voice/start", json)` 发往 phone listener (PR2) |

---

## 3. PR1 设计要点

### 3.1 Intent action 命名

`com.chainlesschain.android.action.START_VOICE_MODE`
- 走 reverse-DNS 包名约定避免与 Android 系统 / 第三方 action 冲突
- `START_VOICE_MODE` 不用 `START_VOICE` —— 避免与 Google Voice / Wearable Voice Search 等 carrier intent 撞名

### 3.2 Trigger source 枚举

```kotlin
enum class VoiceTriggerSource(val wireValue: String) {
    PHONE_SHORTCUT("phone_shortcut"),  // app 图标长按 / 快捷方式
    AUTO_BUTTON("auto_button"),        // Auto VoiceModeScreen 内 "切回手机继续" 按钮 (将来)
    WEAR_FORWARD("wear_forward"),      // wear complication/tile tap → Data Layer forward
    EXTERNAL("external"),              // 第三方 app 通过 Intent 启动 (Tasker / Shortcuts 等)
}
```

extra key: `EXTRA_TRIGGER_SOURCE`；缺省 fall back `EXTERNAL`。

### 3.3 MainActivity 路由策略

Phone 启动可能处于 4 个状态：
1. cold start + 未 setup → 走 SetupPin
2. cold start + 未登录 → 走 Login
3. cold start + 已登录 → 走 Home
4. 已运行 → onNewIntent

Voice intent 处理：
- 未 setup / 未登录 时收 voice intent：保持原导航流 (走 SetupPin / Login)，**不**记忆 voice 意图（防 setup 中途被 voice 弹屏）— 用户 setup/login 后再发起 voice
- 已登录 cold start 收 voice intent：startDestination 维持 Splash 不变（避免 splash 抖动），但 splash 结束后 navigate(Voice.route) 而非 navigate(Home)
- 已运行 (onNewIntent) 收 voice intent：直接 navController.navigate(Voice.route)（追加进 back stack；back-press 回上一屏）

不在 PR1 落地：deep-link query 参数 (e.g. `cc://voice/start?session=xxx`)；保留给 future PRs。

### 3.4 Why NavGraph route + 同一 phone VoiceModeScreen

可选方案对比：

| 方案 | 优 | 劣 | PR1 选 |
|---|---|---|---|
| 加 NavGraph route 复用 phone VoiceModeScreen | 复用 hilt 注入 / Compose theme / back-stack | 受 NavController 生命周期约束 | ✅ |
| 新 VoiceModeActivity (独立 Activity) | 完全独立生命周期；可作 trampoline | 与现 phone 主体 NavGraph 不共 ViewModel scope；BottomNav 状态不同步 | ✗ |
| 直接调 phone VoiceModeManager (no UI) | 后台跑 ASR | 用户没视觉反馈 + 无法停止 | ✗ |

NavGraph route 是更符合 phone-side architecture 的选择，wear forward 也通过 phone MainActivity 走同一路由。

### 3.5 与三端 UI Consistency 文档关系

[A.2 §3.1 Wear 专属](三端_UI_Consistency_设计文档.md)：wear 用 vibration 替代警告色 + 大按钮单列。PR3 wear voice tile 必须遵守：单按钮（"对话"图标 + 大字 "语音"）≤ 48dp 高度，单纵列，tap 短 vibration (50ms) 反馈 forward 发起。

[A.2 §3.4 Auto 专属](三端_UI_Consistency_设计文档.md)：Auto 语音 only — Auto-side 不通过 phone intent (Auto VoiceModeScreen 自己已是 voice surface)，所以 `VoiceTriggerSource.AUTO_BUTTON` 保留给"用户在 Auto 内手动切回手机继续 voice"，并非 Auto 主入口。

---

## 4. PR1 测试覆盖

- `VoiceLaunchActions` 常量值不变（防误改）
- `VoiceTriggerSource.fromWireValue("phone_shortcut") = PHONE_SHORTCUT` 等 4 个 + null → EXTERNAL fallback
- `VoiceTriggerSource.toIntentExtra()` round-trip
- NavGraph 注册了 `Screen.VoiceMode` (smoke test via `assertEquals(Screen.VoiceMode.route, "voice_mode")`)
- MainActivity logic: helper function `extractVoiceTriggerSource(intent: Intent?) → VoiceTriggerSource?` 测试纯函数行为

Instrumented test (`MainActivity` 收到 intent 后真启动 voice screen) **不在 PR1** — 留 PR3 wear-forward 测试时一并 instrumented test。

---

## 5. 后续 PR2/PR3 关键设计点（先期约定避 PR1 接口锁死）

### PR2 — phone-side `/cc/voice/start` listener

Data Layer message payload shape:
```json
{
  "trigger_source": "wear_forward",
  "wear_node_id": "<wear-device-node>",
  "client_request_id": "voice-<timestamp>-<rand>",
  "issued_at_ms": 1715750000000
}
```

Listener 路由：构造 ACTION_START_VOICE_MODE Intent，加 EXTRA_TRIGGER_SOURCE="wear_forward" + EXTRA_CLIENT_REQUEST_ID + EXTRA_FLAG_ACTIVITY_NEW_TASK → startActivity。

### PR3 — wear-side `WearVoiceSender.send()`

`MessageClient.sendMessage("/cc/voice/start", json)` + 50ms vibration 反馈。tile / complication 两个 surface 都通过此 helper。

错误处理：phone 不在线 (no connected node) → wear 端 toast "请打开手机 ChainlessChain"；超时 (3s) → toast "发送失败"。

---

## 6. 风险 & 决策点

| 风险 | 缓解 | 决策点 |
|---|---|---|
| Phone VoiceModeScreen 是孤儿屏，未在产品 UI 暴露 → 加 entry 后用户访问会不会引发"我没想看到这个"反应 | PR1 只加 intent + NavGraph route，不在 BottomNav / Home 加入口；正常用户看不到，只有 wear forward / 外部触发能到 | 是否在 phone home 加 Voice 快捷入口属 PR4 follow-up，等 GA 反馈 |
| Voice intent 暴露给第三方 app → 滥用风险 (Tasker 跑 ASR 偷录音) | manifest filter `android:exported="true"` 但默认 PHONE_SHORTCUT / EXTERNAL 仍需用户在 voice screen 上 tap mic 才录音 — 自动录音留 wear forward 专属 fast-path | 决策 PR3 之前定 wear forward 行为：auto-start-recording 还是要 user tap mic |
| Wear→phone 跨设备 forward 在 phone 锁屏时是否能起 activity | Android 12+ 锁屏起 activity 需要 `FLAG_ACTIVITY_NEW_TASK` + `FLAG_ACTIVITY_RESET_TASK_IF_NEEDED` + phone 端可能弹 "wake screen" prompt | PR2 落地后真机验证；不行则改 trusted notification 路径 |
| 与现 Auto VoiceMode 重复 | Auto 走 `androidx.car.app` 自己的 lifecycle；phone-side intent 不影响 Auto | 无冲突；PR1 不改 Auto 任何代码 |

---

## 变更记录

- 2026-05-15 v0.2：**PR2 landed** — `CcPhoneVoiceListener` WearableListenerService 接收 wear→phone `/cc/voice/start` Data Layer messages → `VoiceForwardWire` 解析 → `startVoiceActivity` 走 PR1 的 VoiceLaunchActions.buildIntent → `startActivity`。manifest exact-path 与现 decision listener prefix `/cc/` 共存不互扰；payload trigger_source field 不可信，源固定 WEAR_FORWARD 防 forge。11 Robolectric tests。phone-side 链路收口；PR3 wear UI 是下一步。
- 2026-05-15 v0.1：C.1 准入条件 audit + 重新拆 3 PR + PR1 phone-side intent 同 commit 落地。`cc.voice.start` framing 不准确（实际是从零建立），spike doc 记录真实状态。
