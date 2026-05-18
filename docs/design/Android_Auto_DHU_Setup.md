# Android Auto DHU 测试指南 v1（v1.2 #20 P0.1 Phase 3）

> **状态**：v1.2 落地配套文档 / 2026-05-12  
> **范围**：DHU (Desktop Head Unit) emulator setup + 安全 disclaimer + Phase 0-2 测试验证  
> **代码**：`android-app/app/src/main/java/com/chainlesschain/android/auto/**`

## 1. DHU 是什么 + 为什么用它

[Desktop Head Unit](https://developer.android.com/training/cars/testing) 是 Google 官方 Android Auto 模拟器，跑在开发机上通过 ADB 把手机当 head unit 用。免买真车机即可开发 / 联调 / 截图 / 录屏。  
Phase 3 之前我们的 CarAppService 仅做了 unit-test 级别验证；DHU 是发版前**唯一可重复**的 Auto 行为 E2E 测试。

## 2. 一次性环境准备

### 2.1 安装 DHU

```bash
# Android Studio → SDK Manager → SDK Tools → "Android Auto API Simulators" + "Android Auto Desktop Head Unit Emulator"
# 也可命令行：
sdkmanager "extras;google;auto"
```

DHU 二进制位置：`$ANDROID_SDK_ROOT/extras/google/auto/desktop-head-unit`（macOS / Linux）或 `desktop-head-unit.exe`（Windows）。

### 2.2 手机端开关

1. 开发者选项 → 启用
2. 手机装 Android Auto 应用（Google Play）
3. Android Auto app → 设置 → 关于 → 连点版本号 10 次 → 进开发者模式
4. 开发者模式 → 勾选 **"Unknown sources"** 让侧载 APK (`./gradlew :app:installDebug` 出来的) 在 Auto 上可见
5. 开发者模式 → 选 **"Start head unit server"**

### 2.3 USB 调试 + ADB forward

```bash
adb forward tcp:5277 tcp:5277
desktop-head-unit  # 启 DHU；连上后会弹模拟 head unit 窗口
```

预期：DHU 主界面显示已安装的 Auto-compatible apps，看到 **ChainlessChain** icon = manifest 正确（`<meta-data com.google.android.gms.car.application>` + `automotive_app_desc.xml`）。

## 3. Phase 0-2 行为测试 checklist

### Phase 0 — 服务可被 Auto host 发现

- [ ] 装完 debug APK 后 DHU 主屏出现 ChainlessChain icon
- [ ] 点 icon 进入 Voice Mode 卡片
- [ ] 卡片标题 = "ChainlessChain Voice"
- [ ] 卡片正文出现 "按下 🎤 开始录音"
- [ ] 卡片有一个 "🎤 开始录音" action 按钮

预期 fail 模式：
- 不显示 icon → 检查 `AndroidManifest.xml` 是否有：
  - `<service android:name=".auto.CcCarAppService">` + 正确 intent-filter
  - 顶级 `<meta-data android:name="com.google.android.gms.car.application">`
  - `res/xml/automotive_app_desc.xml` 含 `<uses name="template"/>`
- 进 icon 后 DHU 报 "App is not allowed" → `CcCarAppService.createHostValidator()` 返 `ALLOW_ALL_HOSTS_VALIDATOR`（debug ok）；release polish 时改 Google's official HostValidator

### Phase 1 — Voice pipeline 接通

> 前置：手机端先在 Settings → AI → ASR engine 选了 Volcengine（或 SystemSpeech）+ 配置好 desktop chat bridge（v1.0 默认 mock）。
> Auto host 不需要单独配置；它复用 phone-side AsrEngineRouter / VoiceChatBridge / AudioPlayer 实例（@Singleton 注入）。

- [ ] 点 "🎤 开始录音" → 卡片切到 "🔴 正在听..."，actions 变成 "⏹ 停止" + "取消"
- [ ] 说一句话 → 点 "停止" → 卡片切 "识别中..." → "你说: <文字>，桌面正在思考..." → "回复: <桌面返回>"
- [ ] 同时手机扬声器播 TTS 音频
- [ ] 卡片显完 "回复" 后回 "Done"，actions 恢复 "🎤 开始录音"
- [ ] 任何环节按 "取消" → 立刻回 Idle (空白卡)

预期 fail 模式：
- "识别中..." 卡死 > 10s → ASR engine 配置问题，去 phone Settings 验
- "桌面正在思考..." 超时 → P2P / WebRTC desktop bridge 没连上；非 Auto 责任，去 phone-side LogCat 查 `VoiceChatBridge` 错误
- 录音后立刻 Failed(PERMISSION) → manifest `RECORD_AUDIO` 权限正常；Auto host 启动时手机系统层应已被授权过；如缺，到 phone 端 Settings 给授权一次

### Phase 2 — Push 审批模板

> 复现路径：让 phone-side 推送一条 Marketplace 大额审批通知（开发期可在 dev console 触发，或调 desktop API `marketplace.purchase` $1500）。

- [ ] DHU 屏幕（无论当前是 Idle 还是 Recording 状态）切到 Approval 卡
- [ ] 卡片标题 = "Marketplace 审批"
- [ ] 卡片正文显示 `订单 <orderId>` + `金额 <total> CNY` + `商品: <name>`（如有）
- [ ] 卡片显两个大按钮：绿色 "✅ 同意"、红色 "❌ 拒绝"
- [ ] 点 "同意" → 卡片回到 voice state（Approval 解除），`AutoPushBus.userDecision` emit 含 `approved=true`
- [ ] 点 "拒绝" → 同理，`approved=false`
- [ ] 手机端**同时**仍有系统通知（Auto 路由不抑制 phone-side notification，作为 Auto 断开 fallback）
- [ ] SystemAlert 类别同样进 Approval 卡，title="系统警报"
- [ ] Cowork / ShareInbox 类别 **不**进 Auto 卡（仅手机端通知）

## 4. 安全 disclaimer（行车场景合规）

**强制约束**（Android Auto template policy）：
- 禁止暴露 ChatPanel / 任意 Compose / WebView 等触摸密集 UI
- 禁止司机驾车时打字
- voice mode + 大按钮 binary 决策是最大允许交互

**风险与限制说明**（应在 Auto Phase 3 polish 时进 APP 设置页注明）：

1. **录音权限暴露**：开车环境噪声大，ASR 可能误识别。建议系统默认 **不**开 continuous 模式（每次手动按麦），减少错误命令。
2. **Voice → marketplace.purchase**：购买类高价值操作**始终要求显式 approval 卡**（不允许 voice 一键支付），与 §3 Phase 2 的大按钮路径一致。
3. **TTS 内容审查**：桌面 LLM 回复直接读出来，需 phone-side LLM 输出过滤（pre-existing `ContentFilterPolicy`）。Auto 不增任何过滤层。
4. **隐私模式**：DID / 私钥 / 助记词等敏感字段在 Auto 卡片**永不显示**，应在 phone-side filter 拦截（todo: v1.3 通知 payload schema 加 `autoSafe` flag）。
5. **HostValidator 切真名单**：v1.2 debug 用 `ALLOW_ALL_HOSTS_VALIDATOR`，发版 polish **必须**切回 Google 官方 host signature list（`CarAppService.HostValidator.Builder().addAllowedHost(...)`），防恶意 Auto host 接管 voice/审批通道。

## 5. 已知限制（不在 v1.2 #20 范围）

- **长按方向盘 voice 键支持**：目前仅卡片上的 "🎤 开始录音" 按钮触发录音；硬件方向盘按键集成留 v1.3
- **Continuous voice mode**：底层 `VoiceModeManager.continuousMode` 已实现，但 Auto template 暂无 toggle 入口；v1.3 加入
- **Voice approval 真语音确认**：当前 Approval 卡用大按钮，不接 ASR 二次确认（避免 "好的" 误触）；v1.3 评估
- **多 payload 堆积 UI**：同时多条 push 到达时仅显示最新一条（`pendingApproval` 单值）；多条排队列表待 v1.3 设计

## 6. 测试现状

单测：32 个 Auto 相关 unit tests 全 green（仓库内 `:app:testDebugUnitTest --tests "com.chainlesschain.android.auto.*" --tests "com.chainlesschain.android.push.NotificationCenterAutoRoutingTest"`）

| 文件 | 测试 |
|---|---|
| `CcCarAppServiceTest` | 2 |
| `CcCarSessionTest` | 1 |
| `VoiceModeScreenTest` | 17 (template type/title/body × state + approval × subtype) |
| `AutoModeTrackerTest` | 4 |
| `AutoPushBusTest` | 3 |
| `NotificationCenterAutoRoutingTest` | 5 |
| **小计** | **32** |

Issue #20 P0.1 验收门槛 "单测 ≥ 15" — **2.1x 满足**。

E2E（DHU + 真手机）属本文档 §3 checklist，发版前手工跑一遍。

## 7. 与其它文档的关系

- 设计文档 §10 v1.2 P0.1 「Android Auto 入口」=> 本文档 §3 checklist
- `Android_重新定位_设计文档.md` §10 子条 `单测 ≥ 15` => §6 已超过
- `Android_重新定位_设计文档.md` §10 子条 `集成测试：DHU emulator` => §3 + §4
- `Android_重新定位_设计文档.md` §10 子条 `文档：Auto-only 限制说明 / 安全 disclaimer` => §4

## 8. Phase 划分回顾

| Phase | commits | 范围 |
|---|---|---|
| 0 (`6b354fd3e`) | scaffold | CarAppService + Session + 占位 template + 5 测 |
| 1 (`737501fe1`) | voice intent | VoiceModeManager 接通 + state machine 渲染 + 14 测 |
| 2 (`2dd52f8b7`) | push routing | AutoModeTracker + AutoPushBus + ApprovalTemplate + 32 测 |
| 3 (本 commit) | docs + test pass | DHU setup + 安全 disclaimer + final test verify |

---

**附：DHU 调试 cheat sheet**

```bash
# 重启 DHU + adb forward
adb kill-server && adb start-server
adb forward tcp:5277 tcp:5277
desktop-head-unit -i &  # -i = interactive console; type 'help' for cmds

# 实时看 CarApp logs
adb logcat -s CarAppService:V VoiceModeScreen:V AutoPushBus:V NotificationCenter:V

# 装最新 debug APK
./gradlew :app:installDebug
adb shell am force-stop com.chainlesschain.android
```
