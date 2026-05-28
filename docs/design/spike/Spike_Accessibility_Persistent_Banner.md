# Spike 3 — AccessibilityService 持久横幅 + 反劫持

> **状态**：代码现状调研完成 / 真机回归待跑
> **关联**：AI 陪学 M3（静音旁观持久横幅）+ M4（AccessibilityService 实时拦截 + 反关无障碍）
> **撰写日期**：2026-05-27
> **预计工期**：核心实现 8d + 5 ROM 真机回归 3d = 11d

---

## 1. 调研结论一句话

ChainlessChain 当前**零 AccessibilityService 基础设施**，但前台服务通知模板（`LocationForegroundService`）和通知中心（`NotificationCenter` 含 PRIORITY_MAX）已成熟，可作起点。**最大不确定性在 MIUI / HyperOS 对系统覆盖窗口（`TYPE_APPLICATION_OVERLAY`）和持久通知（`ongoing=true`）的厂商劫持**，需真机验。

---

## 2. 现 codebase 痕迹

### 2.1 AccessibilityService：**0 找到**

- grep `extends AccessibilityService` / `onAccessibilityEvent` / `AccessibilityNodeInfo` → 全空
- AndroidManifest 无 `BIND_ACCESSIBILITY_SERVICE` 声明

→ **从零搭建**

### 2.2 前台服务通知（成熟，可作模板）

| 文件 | 行号 | 用途 |
|---|---|---|
| `capture/location/LocationForegroundService.kt` | 整个文件 | M3 D2 location 前台服务，含 NotificationChannel(IMPORTANCE_LOW) + setOngoing(true) + setSilent(true) + PendingIntent stop |
| `remote/notification/LocalNotificationManager.kt` | 整个文件 | PC 同步通知 + Workflow 进度条；两 channel（PC + Workflow）|
| `push/NotificationCenter.kt` | 整个文件 | FCM → 本地通知分发，4 channel（Marketplace / SystemAlert / Cowork / ShareInbox），SystemAlert 支持 PRIORITY_MAX |

**已有权限**（AndroidManifest）：
- ✅ `FOREGROUND_SERVICE`
- ✅ `FOREGROUND_SERVICE_DATA_SYNC`
- ✅ `FOREGROUND_SERVICE_LOCATION`
- ✅ `POST_NOTIFICATIONS`（Android 13+）
- ❌ `FOREGROUND_SERVICE_SPECIAL_USE`（API 34+ family/parental 适用，需补）
- ❌ `SYSTEM_ALERT_WINDOW`（需补）

### 2.3 系统覆盖窗口：**0 找到**

- grep `SYSTEM_ALERT_WINDOW` / `TYPE_APPLICATION_OVERLAY` / `WindowManager.LayoutParams` → 全空（除非相关 SocialCookieWebViewScreen 中的英文注释）

→ **从零搭建**；权限需 `Settings.canDrawOverlays` 检查 + `ACTION_MANAGE_OVERLAY_PERMISSION` 用户引导

### 2.4 MediaProjection：**0 找到**

- 没有 `MediaProjectionManager` / `createScreenCaptureIntent` 痕迹

→ M3 静音旁观推屏需新建

### 2.5 自启动 / Keep-alive：**0 找到**

- 无 JobScheduler / AlarmManager / WorkManager 启动相关代码
- WeChat Frida injector 不算（注入到目标 app 进程，不是自启动）

→ AccessibilityService 反被杀需新建机制

---

## 3. 持久横幅 + 反劫持的 4 个组件

### 3.1 组件 1：FamilyGuardForegroundService（前台服务）

**类比**：`LocationForegroundService` 直接派生模板

```kotlin
class FamilyGuardForegroundService : Service() {
    override fun onCreate() {
        super.onCreate()
        startForeground(
            NOTIFICATION_ID,
            buildNotification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE  // API 34+
        )
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_family_guard)
            .setContentTitle("家庭守护运行中")
            .setContentText(currentStatusText())  // 动态：监管中 / 旁观中 / 待机
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)  // 默认低，旁观时升 HIGH
            .setColor(Color.RED)  // 旁观时变红
            .setColorized(true)   // Android 8+ 整条变色
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }
}
```

**用途**：
- 进程常驻不被系统杀（基础保命）
- 提供"低优先级"持久指示

**Channel 配置**（关键防劫持）：
- IMPORTANCE_LOW（普通模式，无声）
- IMPORTANCE_HIGH（旁观/紧急模式，强提示）
- `setBypassDnd(true)`：勿扰模式也显示（旁观/紧急时）
- `setShowBadge(true)`

### 3.2 组件 2：SilentObserveOverlay（系统覆盖窗口 + v0.2 配额）

**用途**：仅在静音旁观期间显示横幅 + LED 闪烁；**v0.2**：单次最长 30min（呼应 spike 2 Android 14+ MediaProjection 现实约束）+ 暂停 2min 按钮配额

```kotlin
class SilentObserveOverlay(private val ctx: Context) {
    private lateinit var wm: WindowManager
    private lateinit var bannerView: View
    private var sessionStartMs: Long = 0L
    private var pauseUsageThisSession: Int = 0
    private var pauseUsageToday: Int = 0  // v0.2: 24h 内 3 次配额

    fun show() {
        if (!Settings.canDrawOverlays(ctx)) { promptPermission(); return }
        sessionStartMs = SystemClock.elapsedRealtime()
        wm = ctx.getSystemService(WindowManager::class.java)
        bannerView = inflate(R.layout.silent_observe_banner)  
        // 横条内容：红色 + 倒计时（30:00 → 0:00 自动断）+ "暂停 2 分钟" 按钮（配额 X/3）
        val lp = WindowManager.LayoutParams(
            MATCH_PARENT, WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            FLAG_NOT_FOCUSABLE or FLAG_NOT_TOUCH_MODAL or FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP
            y = statusBarHeight()
        }
        wm.addView(bannerView, lp)
        startPulse()  // 红色闪烁 + 5min 复检弹窗
        scheduleAutoHangup(durationMs = 30 * 60 * 1000L)  // v0.2: 30min 上限
    }

    // v0.2: 暂停按钮配额（每天最多 3 次，每次 2 分钟）
    fun onPauseButtonClick() {
        if (pauseUsageToday >= 3) {
            showToast("今日暂停配额已用完（3/3）")
            return
        }
        pauseUsageToday++
        auditLog("silent_observe_paused", durationMs = 2 * 60 * 1000L)
        // 通知家长端"孩子暂停了 2 分钟旁观"
        notifyParentOfPause()
        // 暂停推屏 2 分钟（但持久横幅仍显示，倒计时切到 2:00）
        screenTrack.setEnabled(false)
        handler.postDelayed({ screenTrack.setEnabled(true) }, 2 * 60 * 1000L)
    }

    fun hide() {
        wm.removeView(bannerView)
        auditLog("silent_observe_ended", durationMs = SystemClock.elapsedRealtime() - sessionStartMs)
    }
}
```

**注意**（v0.2 修订）：
- 30min 自动断与 spike 2 MediaProjection 30min 上限对齐
- 配额持久化到 SharedPreferences，重启不丢
- 触发"暂停"立刻通知家长（透明化），避免家长误解"为什么屏幕黑了"
- 部分 ROM（MIUI / HyperOS）会"延迟显示"或"被自动取消"，需 5min 周期复显
- 不可触摸 / 不可拖移，防孩子无意挪开

**注意**：
- `TYPE_APPLICATION_OVERLAY`（API 26+，替代废弃的 `TYPE_SYSTEM_ALERT`）
- 部分 ROM（MIUI / HyperOS）会"延迟显示"或"被自动取消"，需 5min 周期复显
- 不可触摸 / 不可拖移，防孩子无意挪开

### 3.3 组件 3：FamilyGuardAccessibilityService（实时拦截 + v0.2 异步重构）

**v0.1 风险**（审查发现）：`onAccessibilityEvent` 在 Android 主流 app 上每分钟触发**几百到上千次**事件（每滚动、每点击、每聚焦）。即使 5s 降采样，规则引擎仍在 UI 线程读 `AccessibilityNodeInfo` 树并匹配 → MIUI 复杂界面（小红书 / 抖音）可触发 ANR + 中端机多耗电 15-30%/天

**v0.2 设计**：白名单过滤 + 异步 Channel 处理：

```kotlin
class FamilyGuardAccessibilityService : AccessibilityService() {
    // v0.2: event type 白名单——只接收必须的，其余全丢
    private val acceptedTypes = setOf(
        AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,  // 窗口切换（app 启动）
        AccessibilityEvent.TYPE_VIEW_CLICKED           // 点击（充值、按钮）
        // 显式不接收：SCROLLED / HOVER / FOCUSED / TEXT_CHANGED
    )

    // v0.2: 异步 Channel，主线程只做最小快照拷贝
    private val eventChannel = Channel<AccessibilityEventSnapshot>(
        capacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST  // 满了丢老的，绝不阻塞主线程
    )

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    init {
        scope.launch {
            for (snapshot in eventChannel) {
                runCatching {
                    ruleEngine.matchAsync(snapshot)
                }.onFailure { 
                    Log.w("FamilyGuard", "rule match failed", it)
                }
            }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType !in acceptedTypes) return  // v0.2: 白名单
        // v0.2: 立刻拷贝快照（仅 packageName + className + 简要 text），不在主线程读 NodeInfo tree
        val snapshot = AccessibilityEventSnapshot.fromMinimal(event)
        eventChannel.trySend(snapshot)  // 异步交付
    }

    override fun onInterrupt() {}
}

// 异步规则引擎
class RuleEngine(private val timeAuthority: TimeAuthority) {
    suspend fun matchAsync(snapshot: AccessibilityEventSnapshot) = withContext(Dispatchers.Default) {
        val now = timeAuthority.authoritativeNow()  // v0.2: 用权威时间，防孩子改时钟
        val rule = matchRule(snapshot.packageName, now) ?: return@withContext
        if (rule.shouldBlockNow(now)) {
            // 通过 Service handle 回主线程执行 globalAction
            mainHandler.post {
                accessibilityService.performGlobalAction(GLOBAL_ACTION_BACK)
            }
            showBlockedToast(snapshot.packageName, rule.reason)
            auditLog(snapshot, rule, "blocked")
        }
        if (snapshot.eventType == TYPE_VIEW_CLICKED) {
            detectPaymentIntent(snapshot)
        }
    }
}
```

**性能目标**（v0.2 新增预算）：
- onAccessibilityEvent 主线程时间 < 100μs / 次
- 规则匹配异步处理；ANR 阈值（5s）不可能命中
- 24h 累计耗电 < 5%

**配置 XML**（`res/xml/family_guard_accessibility_config.xml`）：

```xml
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeAllMask"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagDefault|flagRetrieveInteractiveWindows|flagRequestTouchExplorationMode"
    android:canRetrieveWindowContent="true"
    android:notificationTimeout="0"
    android:packageNames=""
    android:description="@string/family_guard_accessibility_description"
    android:settingsActivity=".family.SettingsActivity" />
```

### 3.4 组件 4：AccessibilityWatchdog（反关无障碍）

**核心**：监测 `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` 变化

```kotlin
class AccessibilityWatchdog(private val ctx: Context) {
    private val targetComponent = ComponentName(
        ctx, FamilyGuardAccessibilityService::class.java
    ).flattenToString()

    fun start() {
        ctx.contentResolver.registerContentObserver(
            Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
            false,
            object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean) {
                    val enabled = Settings.Secure.getString(
                        ctx.contentResolver,
                        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
                    ).orEmpty()
                    if (!enabled.contains(targetComponent)) {
                        // 被关了
                        onAccessibilityDisabled()
                    }
                }
            }
        )
    }

    private fun onAccessibilityDisabled() {
        // 1. 推家长（高优）
        notifyParent("孩子关闭了无障碍服务")
        auditLog("accessibility_disabled")

        // 2. UI 引导重新启用（持续弹）
        startEnableGuideActivity()

        // 3. 30min 后若仍未启用 → 通过 root 兜底 force-stop 黑名单 app
        scheduleEnforcement(30 * 60 * 1000L)
    }
}
```

注意：**Android root 也无法防止用户去 Settings 关闭无障碍**（这是 OS 强制保护）；唯一手段是事后惩罚 + 用户教育。

---

## 4. 5 ROM 已知劫持模式

| ROM | 持久通知劫持 | TYPE_APPLICATION_OVERLAY 限制 | 自启动 | Accessibility 被杀 | 备注 |
|---|---|---|---|---|---|
| **AOSP / 像素** | 无 | 仅需 `canDrawOverlays` 授权 | 标准 | Doze 模式可能杀，但前台服务可活 | 基线 |
| **MIUI 14 / 15** | ⚠️ 部分版本"应用清理"会将 setOngoing 通知按"最近使用"分类，仍可滑掉 | ⚠️ "悬浮窗权限"需用户手动开启；MIUI 自带"悬浮通知"会盖住自定义 overlay | ⚠️ 需 MIUI 自启动权限 + 后台运行权限 | ⚠️ "省电策略" Doze 杀；需用户加白名单 | 高度需要 ROM 适配 |
| **HyperOS** | ⚠️ 同 MIUI 但更严 | ⚠️ 同 MIUI | ⚠️ "智能省电"更激进 | ⚠️ 同 MIUI | 与 MIUI 共底层 |
| **EMUI 13 / HarmonyOS 4** | ⚠️ 通知中心可批量清除 ongoing | ✅ 标准 API 可用 | ⚠️ 华为后台限制最严，需"启动管理"逐项允许 | ⚠️ 后台被冻结概率最高 | 唯一稳路：前台服务 + 设备策略管理（但 EMUI 几乎不支持 DPC） |
| **OriginOS 4 (vivo)** | ⚠️ "i 管家"自动清理通知 | ⚠️ 悬浮窗权限分级（普通 / 完整）| ⚠️ "后台高耗电管控"杀 | ⚠️ 同 | 中等 |
| **ColorOS 14 (OPPO)** | ⚠️ 类似 vivo | ⚠️ 类似 | ⚠️ "后台冻结" | ⚠️ 同 | 中等 |

→ **结论**：MIUI / HyperOS 是首要适配对象（孩子高占比），EMUI 兼容性最差，但可通过教育用户加白名单 + 前台服务多重保活弥补

---

## 5. 反劫持工程化建议

### 5.1 多重保活栈

```
Layer 1: FamilyGuardForegroundService（基础常驻）
Layer 2: AlarmManager 周期 wakeup（每 10 min 自检）
Layer 3: WorkManager 兜底（被 kill 后 OS 重新调度）
Layer 4: BootReceiver 开机自启（android.intent.action.BOOT_COMPLETED）
Layer 5: SilentObserveOverlay 5min 周期复显（防 ROM 自动清除）
Layer 6: AccessibilityWatchdog ContentObserver
Layer 7: 家长端心跳（mobile↔mobile 每 5 min 一次 ping，掉线超 6h 触发紧急寻找）
```

### 5.2 ROM 适配引导（首次设置）

启动后检测当前 ROM，弹出对应 ROM 的"设置引导"：

| ROM | 引导项 |
|---|---|
| MIUI / HyperOS | (1) 自启动权限 (2) 悬浮窗权限 (3) 通知权限 (4) 后台运行不受限 (5) 关闭 MIUI 优化（仅 MIUI 适用）|
| EMUI / Harmony | (1) 启动管理→允许自启动+后台活动+关联启动 (2) 受保护应用 (3) 电池→应用启动管理→手动管理 (4) 锁屏清理白名单 |
| OriginOS | (1) 后台高耗电→允许 (2) 锁屏后清理白名单 (3) 通知 (4) 悬浮窗 |
| ColorOS | (1) 自启动 (2) 应用冻结→关 (3) 锁屏不清理 (4) 悬浮窗 |

UI 模板：每项引导提供"立即设置"按钮直接跳系统 Settings；每项设置后用户回 ChainlessChain 自动验证 + 标 ✅

---

## 6. 工程量

| 工作项 | 估时 |
|---|---|
| `:feature-family-guard` 模块挂 Accessibility 子目录 | 0d（spike 1 已建）|
| `FamilyGuardForegroundService` 前台服务（参考 LocationForegroundService）| 1d |
| `FamilyGuardAccessibilityService` + 拦截规则引擎 | 2d |
| `AccessibilityWatchdog` 反关守护 | 1d |
| `SilentObserveOverlay` + 5min 复显机制 | 1.5d |
| `MediaProjection` 屏幕推送（M3 静音旁观推屏）| 2d |
| `BootReceiver` + `AlarmManager` + `WorkManager` 多重保活 | 1d |
| ROM 适配引导 UI（5 ROM 5 步骤）| 1.5d |
| 单测 + Hilt 集成 | 1.5d |
| **合计** | **~11.5d** |

加 真机回归 3d → **~14.5d**

---

## 7. 真机验证 checklist（5 ROM 各跑）

- [ ] **TC1**：FamilyGuardForegroundService 持久通知开屏 24h 仍在
- [ ] **TC2**：清理后台 / 手动滑掉 → 5s 内自动重启
- [ ] **TC3**：SilentObserveOverlay 显示后 30min 仍在，未被 ROM 清除
- [ ] **TC4**：用户在 Settings 关闭无障碍 → AccessibilityWatchdog 5s 内推家长 + 自动弹引导
- [ ] **TC5**：开机后 BootReceiver 拉起服务 < 60s
- [ ] **TC6**：MediaProjection 推屏 720p@15fps 持续 30min CPU < 10%、电量 < 8%/h
- [ ] **TC7**：家长心跳超时 6h → 推送 + 紧急寻找模式触发
- [ ] **TC8**：MIUI / HyperOS 用户跳过 ROM 引导后是否退化为档 1 + 提示
- [ ] **TC9（v0.2 新增）**：AccessibilityService 异步规则引擎 24h 连续运行电量损耗 / CPU 占用 / RAM 峰值，确认符合 §12.1 预算（CPU < 2% 平均；RAM < 50MB；电量 < 5%/天）。测试方式：纯净 Pixel 6 跑 24h 持续刷小红书 + 抖音 + 微信，记录 `dumpsys batterystats` 和 `top` 输出
- [ ] **TC10（v0.2 新增）**：暂停 2 分钟配额（每天 3 次）跨日重置正确性；用 ADB 改时间到次日凌晨 0:01 验证

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| MIUI / HyperOS 对 setOngoing 仍可滑掉 | IMPORTANCE_HIGH + setBypassDnd + 滑掉时立即自我恢复 + 推家长 |
| 用户拒绝悬浮窗权限 | UI 强提示 + 降级为持久通知（红色横条退到状态栏内）|
| Android 14+ 前台服务 SPECIAL_USE 类型审核（Play Store） | 提交申请 + 说明用途；国内商店不影响 |
| Accessibility 被电池优化杀 | 前台服务（依赖 §5.1 多重保活）+ 用户引导加白名单 |
| OEM 自动取消"高频闪烁通知"（防 spam） | 改为低频闪烁（10s 一次）+ LED 长亮 |
| `MediaProjection` 启动需用户授权弹窗（每次启动）| Android 14+ 持续录屏 token + 持久授权模式（CallNotificationIntent）|

---

## 9. 与其他 spike 的依赖

- **Spike 1（DPC）**：互补关系。EMUI 不支持 DPC，则本 spike 的 Accessibility + Overlay + 前台服务变成 EMUI 的唯一管控手段
- **Spike 2（WebRTC）**：M3 SILENT_OBSERVE call kind 必须依赖本 spike 的 `SilentObserveOverlay` 显示横幅 + `MediaProjection` 推屏

---

## 10. 已知 trap 关联

- [[android_wechat_collector_phase_12_10]] — WeChat Frida 自启动模板，可借鉴 BootReceiver
- [[miui_query_all_packages_silently_blocked]] — MIUI 厂商限制范式
- [[android_native_lib_extract_w_x]] — 若 MediaProjection 用 native helper，注意 W^X
- [[mobile_bridge_approval_kebab_drift]] — 家长审批 WS 消息名约定（M4 支付审批复用）
