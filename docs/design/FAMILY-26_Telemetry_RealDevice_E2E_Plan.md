# FAMILY-26 — Telemetry 端到端真机 E2E 测试计划

> **目标**: 验证 telemetry 全链路 — Android 孩子端采集前台 app → 权限/freeze/quiet-hours 闸
> → child_event 落库 → P2P 上行 → 桌面 `family_child_event` 镜像 → 家长仪表板（V5/native
> renderer IPC + web-shell/V6/web-panel WS 三入口）显示。
>
> **范围**: FAMILY-20（ForegroundAppTimer + Usage Access UI）/ FAMILY-21（CentralTelemetryDispatcher
> + RelationshipTelemetryUploadGate）/ FAMILY-24（Quiet Hours）/ FAMILY-26（SyncManagerTelemetryOutbox
> + desktop 接收器 + 家长仪表板 + cross-shell）。FAMILY-16 freeze 闸联动。
>
> **不能在 Windows dev box 跑** — 需 Android 真机（CHILD 角色）+ 已配对真桌面（Electron）+ USB adb。
> 本文档是可执行清单；执行需 Mac/Linux 或带真机的 Win + 真桌面实例。串行预计 ~2h。

---

## 0. 链路总览（被测对象）

```
[Android child]                                  [Desktop parent]
ForegroundAppTimer (60s poll, UsageStatsManager)
  → ChildIdentityProvider 闸 (role==CHILD + DID)
  → ForegroundAppQuery 闸 (Usage Access granted)
  → ForegroundAppTelemetrySource.submitSample
  → CentralTelemetryDispatcher.process
      ├ UpstreamFreezer.isFrozen?            (FAMILY-16)
      ├ RelationshipTelemetryUploadGate      (FAMILY-25 level + FAMILY-24 quiet hours)
      ├ ChildEventRepository.saveTelemetryEvent  → child_event (SQLCipher)
      └ SyncManagerTelemetryOutbox.enqueue   → SyncItem(TELEMETRY) → SyncManager.recordChange
                                              → P2P sync.push ───────►  handlePush → _applyItemLocal
                                                                         → _applyTelemetry
                                                                         → family_child_event 镜像表
                                                                         → family-guard:* IPC / WS topic
                                                                         → 家长仪表板 (V5 + web-panel)
```

---

## 1. 前置条件

### 硬件
- [ ] Android 真机 1 台（Android 8.0+ / API 26+，UsageStatsManager 需要；arm64）。
- [ ] USB 线（adb debug + APK install）。
- [ ] 真桌面 1 台（Electron 桌面 app 已装；Win/macOS/Linux 均可作家长端）。
- [ ] 同一局域网 / 信令可达（P2P sync 走 mobile-bridge）。

### 软件
- [ ] Android SDK platform-tools（`adb devices` 识别真机）。
- [ ] 桌面 Electron app 可启动（`cd desktop-app-vue && npm run dev` 或已打包安装版）。
- [ ] 已配对：child↔parent 走 Flow A/C QR 配对（见 `Android_W3_Pairing_E2E.md`），是 telemetry 上行前置。

### 仓库 / 构建状态
- [ ] Android release/debug APK 含 FAMILY-20→26（`a93f27b4e` / `533fb3e3c` / `c04b068d2` / `7e53a1820` …）。
- [ ] 桌面含 FAMILY-26 接收器 + 仪表板（`459a61901` / `7936235df` / `c6cd3c38f`）。
- [ ] web-panel dist 已 build（`cd packages/web-panel && npm run build`）— V6 shell / web-shell 读 dist。

---

## 2. Setup 步骤

### 2.1 安装 APK + 启动
```bash
adb devices                                    # 确认真机 authorized
adb install -r android-app/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.chainlesschain.android/.MainActivity
```

### 2.2 选 CHILD 角色 + 锁
- App 首启 → 角色选择 → 选「孩子」→ 确认。
- 验证：`RolePreferencesRepository` 状态进入 `LockPending(CHILD)`（24h 内可改）。CHILD 是 telemetry
  采集的硬闸（`RoleAwareChildIdentityProvider.childDidOrNull` 非 CHILD 返 null → 不采集）。

### 2.3 授予 Usage Access
- 进「家庭」tab → 顶部出现红色「开启『使用情况访问』」引导卡（`UsageAccessCard`，仅 CHILD + 未授权时显）。
- 点「前往授权」→ 系统设置「使用情况访问」→ 找到本 app → 开启 → 返回。
- 验证：返回后（onResume）卡**自动消失**（`UsageAccessViewModel.recheck` → state 翻 `Granted`）。

### 2.4 确认前台服务 + 调度器启动
```bash
adb logcat -s FamilyGuardForegroundService CentralTelemetryDispatcher
# 期望:
#   FamilyGuardForegroundService.onCreate
#   CentralTelemetryDispatcher started; N source(s)
```
- 持久通知「家庭守护」应常驻。`ForegroundAppTimer` 已 start（每 60s poll）。

### 2.5 桌面启动 + 配对确认
```bash
cd desktop-app-vue && npm run dev          # 或启动打包版
```
- 完成 child↔parent 配对（Flow A）。验证 mobile-bridge 就绪 + 设备列表含孩子设备。

---

## 3. 测试场景

> 采集是 60s 轮询 + 同 app 连续合段（30min 强制切）。每个使用场景后**等 ≥2 个 poll 周期**（~2-3min）
> 再切包，确保 aggregator finalize 一段。

### Scenario 1 — Happy Path（采集 → 上行 → 仪表板）
**Child 步骤**:
1. 打开 app A（如游戏）用 ~2min → 切到 app B（如聊天）用 ~2min → 回桌面。
2. `adb logcat -s SyncManagerTelemetryOutbox` 期望见 `Telemetry → sync queue: telemetry|<did>|foreground_app|run|<ts> (source=foreground_app guardians=N)`。

**Desktop 步骤**:
3. 等 sync 周期（SyncCoordinator ~30s push）。
4. **V5/native renderer**: 进 `/family-guard` → 选孩子 → 见「应用使用排行」含 app A/B + 时长；「最近事件」含 run 行。
5. **web-panel / V6 shell**: 切到 web-shell 模式（或 `cc ui`→ 实为 desktop 内嵌）→ 「家庭守护」侧栏 → 同样数据。

**预期**: 两端仪表板都显示 app A/B 的使用时长聚合 + 事件列表；时长与实际使用接近（±1 poll 周期）。

### Scenario 2 — Telemetry level gate（FAMILY-25）
- 家长端把对该孩子的 `permissions.telemetryLevel` 设为 `L0`（仅聚合）。
- Child 继续用 app。**预期**: L1 run 事件被 `RelationshipTelemetryUploadGate` 挡下（`check(ReadTelemetryL1)` Deny）→ 不落库不上行 → 仪表板无新增 L1 事件。
- 改回 `L1` → 恢复上行。

### Scenario 3 — Quiet hours（FAMILY-24）
- 家长端配私有时段覆盖当前时刻（如 `00:00-23:59`）。
- Child 用 app。**预期**: 事件发生时刻落私有时段 → `QuietHoursEngine.isActive` true → 该 guardian 被排除 → 不上行。退出私有时段后恢复。
- 注：按**事件 timestampMs**（采集时刻）判，非"现在"。

### Scenario 4 — Emergency freeze（FAMILY-16）
- 触发紧急解绑 freeze（孩子端复活码路径）→ `UpstreamFreezer.isFrozen` = true。
- **预期**: `CentralTelemetryDispatcher` 收到 freeze → pause 所有 source（真停采集）；`process()` 二重保险也丢。仪表板无新数据。unfreeze 后恢复。

### Scenario 5 — Usage Access 未授予
- 撤销 Usage Access（系统设置关闭）。
- **预期**: `UsageAccessCard` 重现；`ForegroundAppQuery.isAccessGranted` false → `pollOnce` 早返 → 不采集。仪表板无新数据。

### Scenario 6 — 非 CHILD 端不采集
- 另一台设备选 PARENT 角色。
- **预期**: `ForegroundAppTimer.pollOnce` 经 `childDidOrNull()` 返 null → 早返，零采集（家长端不监控自己）。

### Scenario 7 — 三入口 parity
- 同一份 `family_child_event` 数据，在 (a) V5/native renderer `/family-guard`（IPC `family-guard:*`）、(b) web-shell/V6（WS topic `family-guard.*`）、(c) web-panel 独立页，显示一致（孩子列表 / app 排行 / 事件 / 时窗 24h/7d）。

### Scenario 8 — cc ui standalone 降级
- 纯 `cc ui`（非 desktop Electron，无 desktop DB）打开「家庭守护」页。
- **预期**: 优雅显空（"还没有收到任何孩子端的使用数据"），不崩。family-guard topic 仅注册于 web-shell Gateway 1（desktop-only 数据），standalone 无 handler → composable reject → store 兜底空。

### Scenario 9 — 幂等（重复 sync 不重复行）
- 触发重复 sync push（断网重连 / 手动重推）。
- **预期**: 同 `resource_id`（`telemetry|childDid|source|kind|startMs`）在 desktop `_applyItemLocal` conflict 预检判 "local" 跳过 → `family_child_event` 不出现重复行。

---

## 4. 验收标准（总）
- [ ] S1 端到端：child 采集的 app 使用时长在两端（V5 + web-panel）仪表板可见且数值合理。
- [ ] S2/S3/S4/S5/S6 五个闸（level / quiet hours / freeze / usage-access / role）各自正确拦截。
- [ ] S7 三入口数据一致。
- [ ] S8 cc ui standalone 优雅降级不崩。
- [ ] S9 重复 sync 无重复行。
- [ ] 全程无 ANR / crash（`adb logcat *:E` 无 family-guard FATAL；主线程无 keystore ANR，见 [[android_main_thread_keystore_anr_and_dagger_default_param]]）。

---

## 5. 验证手段速查
| 目标 | 手段 |
|---|---|
| timer/dispatcher 启动 | `adb logcat -s FamilyGuardForegroundService CentralTelemetryDispatcher` |
| 上行入队 | `adb logcat -s SyncManagerTelemetryOutbox`（`Telemetry → sync queue: …`）|
| child_event 落库 | family-guard DB 是 SQLCipher，**不直接 adb dump**；以「上行入队日志 + 桌面镜像到达」作端到端证据 |
| 桌面镜像 | 家长仪表板（V5 `/family-guard` + web-panel）；或桌面 DevTools 看 `family-guard:*` IPC 返回 |
| sync 推送 | 桌面 mobile-bridge / SyncCoordinator 日志 |

---

## 6. 已知限制（本计划不解决）
| 限制 | 影响 | 后续 |
|---|---|---|
| Windows dev box 不能跑 | 需 Android 真机 + 真桌面 + 配对 | Mac/Linux 或带真机环境执行 |
| family-guard DB SQLCipher | 无法直接 adb dump child_event 核对 | 以端到端（桌面镜像到达）为证；或后续加 in-app debug dump（仿 VaultPreviewSheet）|
| 采集 60s 轮询 + 30min 合段 | 短时使用可能未 finalize；需等 ≥2 poll | 测试时显式等待或缩短 poll（debug build 可调 `ForegroundAppTimer.POLL_INTERVAL_MS`）|
| 后台关屏未切包时长累计依赖"沿用上次包" | 关屏期间可能过/欠计 | 真机标定后调 query 窗口逻辑 |
| `cc ui` standalone 无数据 | 设计如此（desktop-only 镜像） | 不修；UI 已优雅降级 |

---

## 7. 执行记录（填表）
| Scenario | 设备 | 日期 | 结果 | 备注 |
|---|---|---|---|---|
| S1 Happy Path | | | ⬜ | |
| S2 Level gate | | | ⬜ | |
| S3 Quiet hours | | | ⬜ | |
| S4 Freeze | | | ⬜ | |
| S5 No usage access | | | ⬜ | |
| S6 Non-child | | | ⬜ | |
| S7 三入口 parity | | | ⬜ | |
| S8 cc ui standalone | | | ⬜ | |
| S9 幂等 | | | ⬜ | |

---

## 8. 相关
- 配对前置：`Android_W3_Pairing_E2E.md`（Flow A QR 配对）。
- 设计主文档：`AI陪学_主文档.md`（§3.2 telemetry 数据源 / §3.1 freeze / §3.4 时间裁决）。
- 上行接收实装：`desktop-app-vue/src/main/sync/mobile-bridge-sync.js`（`_applyTelemetry`）。
- 采集链：`android-app/feature-family-guard/.../data/telemetry/`（Timer / Source / Dispatcher / Outbox / Gate）。
