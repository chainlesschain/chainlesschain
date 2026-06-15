# FAMILY-67 — 孩子活动看板（Android 家长端）端到端真机 E2E 测试计划

> **目标**：验证 telemetry 全链路的 **Android 家长端**变体 —— 孩子机采集前台 app →
> 上行 → **Android 家长机**收件解码落 `child_event` 镜像表 → 「孩子活动」看板显示每个 app
> 用了多久 / 总屏幕时长。
>
> **与 [FAMILY-26](FAMILY-26_Telemetry_RealDevice_E2E_Plan.md) 的关系**：FAMILY-26 验证家长端
> 为**桌面**（Electron `family_child_event` 镜像 + 桌面仪表板）。本计划验证家长端为**另一台
> Android 手机**（`TelemetrySyncApplier` 收件 + `ChildActivityDashboard` 看板）。两者共用孩子端
> 采集 + 上行 + libp2p 传输（FAMILY-20/21/24/25/26），只在“家长侧接收 + 展示”分叉。
>
> **不能在 Windows dev box 跑** —— 需 **两台** Android 真机（一台 CHILD、一台 PARENT）
> + 已配对 + 同一局域网 / 可达的 libp2p 传输。串行预计 ~1h。

---

## 0. 链路总览（被测对象）

```
[Android child]                                   [Android parent]
ForegroundAppTimer (60s poll, UsageStatsManager)
  → ChildIdentityProvider 闸 (role==CHILD + DID)
  → ForegroundAppQuery 闸 (Usage Access granted)
  → CentralTelemetryDispatcher.process
      ├ RelationshipTelemetryUploadGate (level + quiet hours)
      ├ ChildEventRepository.saveTelemetryEvent → child_event (SQLCipher)
      └ SyncManagerTelemetryOutbox.enqueue
          → SyncItem(TELEMETRY) → SyncManager.recordChange
              → P2P sync.push ──────────────────►  handlePushRpc → applySyncItem
                                                     → DefaultSyncDataApplier.create(TELEMETRY)
                                                     → TelemetrySyncApplierImpl.saveTelemetryFromSync
                                                         → TelemetryIngest.decode
                                                         → ChildEventRepository.saveTelemetryEvent
                                                             → child_event 镜像表 (家长机)
                                                     → ChildActivityDashboardViewModel
                                                         (observeRecentAnyChild → fromEntity
                                                          → ChildActivityDashboard.summarize)
                                                     → 「孩子活动」看板 (家庭 tab)
```

被测新代码（本特性引入）：
- `core-p2p` `TelemetrySyncApplier`（端口）
- `feature-p2p` `DefaultSyncDataApplier` 的 `ResourceType.TELEMETRY` 路由
- `:app` `TelemetrySyncApplierImpl`（解码 + 落库）、`TelemetryIngest`、`ChildActivityDashboard`
- `:app` `ChildActivityDashboardViewModel` / `ChildActivityDashboardScreen`
- `feature-family-guard` `ChildEventDao.observeRecentAnyChild` + 仓接口/实现

---

## 1. 已自动覆盖（单进程 loopback，无需真机）

`app/src/test/.../telemetry/ChildToParentTelemetryE2eTest.kt`（Robolectric + 真 in-memory Room）
在**一个进程**里跑通：孩子端 `TelemetryEvent` → `TelemetrySyncData` wire 编码 → `TelemetrySyncApplierImpl`
解码 → 真 Room `child_event` → `observeRecentAnyChild` → `ChildActivityDashboard.summarize` →
断言家长可见摘要（每 app 时长 / 总屏幕时长 / 孩子 DID）== 孩子实际产生。

**覆盖**：encode→wire→decode→真持久→读回→聚合 全程保真 + 重放可解码。
**未覆盖（需真机）**：libp2p 真传输那一跳、UsageStats 真采集、Compose 渲染、配对、权限闸联动。
（编码↔解码字节保真另由 `TelemetryIngestTest` 经真实 `SyncManagerTelemetryOutbox` 往返证实；
inbound 路由 `TELEMETRY → applier` 由 `:app:assembleDebug` 的 Hilt 图校验 + `TelemetrySyncApplierImplTest` 覆盖。）

---

## 2. 前置条件（真机）

### 硬件
- 设备 A（CHILD）：Android 真机，装本 debug APK（`app-arm64-v8a-debug.apk`）。
- 设备 B（PARENT）：Android 真机，装同一 APK。
- 两机同一局域网（或 libp2p 可达），用于 P2P 同步。

### 软件 / 状态
- 两机各自创建身份（KeyManagement / 配对时自动补建 DID）。
- 设备 A 角色 = **孩子**，授予「使用情况访问」(Usage Access) 权限。
- 设备 B 角色 = **家长**。
- A、B 已配对（家长生成邀请二维码 + 接受码，孩子扫码绑定）。

---

## 3. 测试场景

### S1 — 孩子端采集落库（设备 A）
1. 设备 A 设角色为孩子 + 授 Usage Access。
2. 正常使用几个 app（如游戏 ≥2 分钟、视频 ≥1 分钟），等 ≥1 个 60s 轮询周期。
3. **预期**：设备 A 本地 `child_event` 有 `source='foreground_app'` 行（可经 logcat
   `ForegroundAppTimer` / `CentralTelemetryDispatcher` 确认；或设备 A 自身「孩子活动」卡
   即显示本机用量——单机自测路径）。

### S2 — 上行 + 家长端收件落库（A → B）
1. 保持 A、B 配对且同步运行。
2. 等 P2P 同步周期（或触发一次手动同步）。
3. **预期**：设备 B `child_event` 出现来自 A 的 `child_did`=A.DID 的前台 app 行
   （logcat 过滤 `TelemetrySyncApplierImpl` 应见 `Telemetry sync stored: telemetry|...`）。
   坏/未知来源应见 `Telemetry sync rejected (...)` 且不落库（不阻断同步）。

### S3 — 家长看板显示（设备 B）
1. 设备 B → 家庭 tab → 「孩子活动」卡。
2. **预期**：看到「孩子 <A.DID 缩写>」一段，含：
   - 总屏幕时长 ≈ S1 实际使用时长（分钟级，60s 轮询粒度内）。
   - top app 列表：使用最多的 app 在最前，时长条按比例，显示「Xh Ym · N 次」。
   - 粒度行显示 `L1×n`（家长当前可见级别透明展示）。
3. 多个孩子配对时，每个孩子一段，按总屏幕时长降序。

### S4 — 空态 / 权限未授（设备 B 或新配对）
1. 家长端无任何孩子数据时打开「孩子活动」。
2. **预期**：显示引导文案“暂无孩子活动数据。孩子端授予使用情况访问权限并配对同步后…”。

### S5 — 隐私边界
1. 检查看板与 logcat。
2. **预期**：只出现 app 包名 + 时长（L1），**绝不**出现聊天内容 / 订单详情等 L2 原文；
   `eventsByLevel` 多为 L1。

---

## 4. 已知限制 / follow-up（真机阶段补）
- **真实应用名**：看板当前显示包名末段（如 `sgame`）；真名需 `PackageManager.getApplicationLabel`，
  在设备侧的 VM/Screen 层补（包名→应用名映射）。
- **行级内容去重**：当前依赖 sync 层 resourceId 去重 + 收件冲突检测；`child_event` 行内容去重
  （同 childDid+source+kind+timestamp）是 follow-up（需加列/查询）。
- **真应用名 + 图标**、**按 app 分类（游戏/视频/学习）**、**与 M4 限额对照**（用了 X / 限 Y）
  均为后续增强。
- **窗口可选**：当前固定近 24h；可加“今天/本周”切换。

---

## 5. 执行记录

| 日期 | 设备 A | 设备 B | S1 | S2 | S3 | S4 | S5 | 备注 |
|---|---|---|---|---|---|---|---|---|
| _待填_ | | | | | | | | |
