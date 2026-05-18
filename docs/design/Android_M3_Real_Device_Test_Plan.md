# Android v1.0 — M3 L2 捕获层真机测试计划

> **版本**: v1.0 (2026-05-11) | **关联**: [Android 重新定位设计文档](Android_重新定位_设计文档.md) §6 M3
> **状态**: 🟡 Manifest 已就位、JVM 单测 31 绿；待真机验收 D-voice / D-camera / D-push；D-loc 真 Play Services 实现推 M3.1 / v1.1

## 1. M3 子项与现状

| 子项 | JVM 单测 | Manifest | 真机实现 | 备注 |
|------|---------|---------|---------|------|
| **D-share** ShareReceiverActivity + IntentPayloadParser | ✅ 22 单测 | ✅ ACTION_SEND + ACTION_SEND_MULTIPLE intent-filter (3 mime) | ⏳ 真机验 | 见 §3 |
| **D-loc** LocationTagger + LocationProvider 抽象 | ✅ 9 单测 + FakeLocationProvider | ✅ ACCESS_FINE / ACCESS_COARSE / hardware.location[.gps] | ⏳ **AndroidFusedLocationProvider 未实现 — 推 M3.1 / v1.1** | 见 §4 |
| **D-voice** Continuous Voice Mode | ⏳ ASR/TTS 端点已存在 | ✅ RECORD_AUDIO + SpeechRecognizer queries | ⏳ 串联多轮对话 + 中断恢复 | 见 §5 |
| **D-camera** Camera OCR pipeline | ⏳ — | ✅ CAMERA + hardware.camera[.autofocus] feature | ⏳ 端到端拍照 → OCR → KB | 见 §6 |
| **D-push** FCM 集成 + 本地兜底 | ⏳ — | ✅ POST_NOTIFICATIONS / FOREGROUND_SERVICE_DATA_SYNC | ❌ **缺 google-services.json + FirebaseMessagingService + service declaration**；需真机推 | 见 §7 |

## 2. 通用真机准备

```bash
# 1. 真机准备 (推荐 Pixel 6 / 6a 或 实体 Android 10+ 设备 API 33 主测)
adb devices
# 应 list 至少一台

# 2. 安装 debug APK
cd android-app && ./gradlew :app:installDebug

# 3. 完成首启 DID + 桌面配对 (Phase 3d sync 工作前提)
#    桌面端运行: cd desktop-app-vue && npm run dev
#    Android: 扫桌面 QR (Settings → Mobile Bridge)

# 4. 启动 logcat 监控
adb logcat -s "ChainlessChain:*" "AndroidRuntime:E" -v threadtime
```

## 3. D-share 真机验收

**前提**: ShareReceiverActivity 已注册 (Manifest line 102-120)。

### Test 1 — 从相册分享单图

1. 打开 Google Photos → 选 1 张 → 分享 → 列表里应见 "ChainlessChain"
2. 点 ChainlessChain → activity 不显示 UI，立即 finish (NoDisplay theme)
3. **预期**: `logcat | grep IntentPayloadParser` 输出 `single-image / mime=image/png`
4. **预期**: SharedInboxRepository 加 1 条 (queue size +1)
5. **预期**: 下次 SyncCoordinator 30s 循环把这条 push 到桌面 KB

### Test 2 — 多图 ACTION_SEND_MULTIPLE

1. Photos → 长按多选 3 张 → 分享 → ChainlessChain
2. **预期**: 1 个 payload (multi-images list)，桌面收到 3 张

### Test 3 — 从浏览器分享 URL/text

1. Chrome → 长按页面 → 分享 → ChainlessChain
2. **预期**: payload type=text，桌面 KB 见到 URL + 页面标题

### Test 4 — 从文件管理器分享 PDF

1. Files app → PDF → 分享 → ChainlessChain
2. **预期**: payload mime=application/pdf，桌面收到 binary URI

## 4. D-loc 真机验收（M3 v1.0 scope = 仅权限弹窗 + Manifest 合规；真 Play Services 集成 M3.1）

**当前 v1.0 限制**: `AndroidFusedLocationProvider` 真实现 **未落** — DI 绑定到 `FakeLocationProvider`
返回 hard-coded 测试坐标。真机走完仅验证：

1. **首次启动权限弹窗**: app 首启 → 第一次进入"位置打卡笔记"功能 → 弹两阶段权限（COARSE → FINE 或一步合并）
2. **Settings → App info → Permissions**: 应可见 Location 项（Granted / Denied / While in use 三态）
3. **Manifest 合规**: `adb shell dumpsys package com.chainlesschain.android | grep permission` 应看
   `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` + `hardware.location[.gps]` features

**v1.1 / M3.1**: Play Services `FusedLocationProviderClient` 接入 + 真 GPS 实时坐标 + LocationTag
write 进 note 元数据。

## 5. D-voice 真机验收

### Test 1 — ASR isRecognitionAvailable

1. 进 Voice Mode 入口 → 应见 "Voice 可用" 提示
2. **预期**: logcat `SpeechRecognizer.isRecognitionAvailable(context) == true`
3. 若 false → 检查 `<queries>` 块 (Manifest 65-72) — 安卓 11+ 包可见性

### Test 2 — 多轮对话 (3-turn)

1. 长按麦克风按钮 → 说 "你好" → 松手
2. **预期**: 实时 ASR 文本气泡 + 完成后 TTS 回应（端到端 <3s）
3. 立即长按再问 "今天天气" → 应保持对话上下文
4. 第三轮 "记下来" → 应触发 note.create 落 KB
5. **预期**: 桌面 KB 见到 3 条 conversation_turns + 1 个新 note

### Test 3 — 中断恢复

1. 在对话过程中按 home → app 退后台
2. 接电话 / 切音乐 → 抢音频焦点
3. 回到 app → Voice Mode 应保留 conversation 状态，可继续
4. **预期**: AudioFocus IDLE 后自动 release，不持续占麦克风

### Test 4 — 国内输入法兜底

1. 卸 / disable Google Speech → 启搜狗 / 讯飞 SpeechRecognizer
2. **预期**: queries action `android.speech.RecognitionService` 让 isRecognitionAvailable 仍返 true

## 6. D-camera 真机验收

### Test 1 — 拍发票 OCR → KB（demo 路径 3）

1. KB 入口 → 拍照按钮 → CAMERA 权限弹窗（首次）→ 同意
2. 对准发票 → 拍照
3. **预期**: 立即 preview + "OCR 识别中" 进度条 (≤2s)
4. **预期**: 识别完成 → 字段抽取 (金额 / 日期 / 商家) → 入 note metadata
5. **预期**: 桌面 KB 30s 内同步到该 note，含 OCR 文本 + 原图缩略图

### Test 2 — 横竖屏自适应

1. 拍照模式 → 旋屏到 landscape → preview 应正确旋转
2. **预期**: viewport orientation 锁 sensor，不出现拉伸

### Test 3 — 低光环境

1. 弱光下拍 → OCR 信心值应输出在 metadata
2. **预期**: 若信心 < 0.5 → UI 提示用户重拍

### Test 4 — 权限拒绝路径

1. 首次拒 CAMERA → 再次进 → 应见 "已禁用，去设置" 提示，不崩
2. Settings 开 CAMERA → 回 app → 自动恢复可拍

## 7. D-push 真机验收（**v1.0 GA 前还需补**）

### 缺失工作

1. **google-services.json**：项目根 `app/google-services.json`，从 Firebase Console 下载
2. **依赖**: `app/build.gradle.kts` `implementation("com.google.firebase:firebase-messaging:24.x")`
3. **plugin**: `id("com.google.gms.google-services") version "4.4.2" apply false`
4. **FirebaseMessagingService 子类**: handle onMessageReceived + onNewToken
5. **Manifest service declaration**:
   ```xml
   <service android:name=".push.ChainlessChainFCMService" android:exported="false">
       <intent-filter>
           <action android:name="com.google.firebase.MESSAGING_EVENT" />
       </intent-filter>
   </service>
   ```
6. **本地兜底 channel**: NotificationChannel "cowork-approval" / "sync-result" 等 5 个 channel
7. **token 上报**: onNewToken → P2P 推到桌面 → 桌面存到 device registry 用于 spawnTeam 类 server-push

### Test 1 — Cowork spawnTeam 推送（demo 路径 5）

1. 桌面发起 `cowork.spawnTeam` → Android 应弹通知
2. 点通知 → 跳进 ApprovalDialog → 用户点同意
3. **预期**: 桌面 5s 内收到 approval 结果 → 任务继续

### Test 2 — 国内可达性

- v1.0 仅 FCM + 本地兜底（即 FCM 不通也走本地通知，但无法做 server-push）
- v1.1 计划接 OPPO / 小米 / 华为 push SDK 统一封装

### Test 3 — 应用被杀场景

1. 应用被 force-stop → 桌面发推
2. **预期**: FCM 唤起 service → 系统通知栏可见
3. 点通知 → 应用启动 + 跳目标 screen（deep link）

## 8. v1.0 真机最终验收清单

> 完成本清单 = v1.0 demo 7 条路径 §7.1 #1-#7 走完。

- [ ] Test 3.1 / 3.2 / 3.3 / 3.4 (D-share, 4 项)
- [ ] Test 4.1 (D-loc 权限弹窗，真 GPS 推 M3.1)
- [ ] Test 5.1 / 5.2 / 5.3 / 5.4 (D-voice, 4 项)
- [ ] Test 6.1 / 6.2 / 6.3 / 6.4 (D-camera, 4 项)
- [ ] **D-push** §7 缺失工作全部补齐 (google-services.json + FCM service + 7 步)，再走 Test 7.1 / 7.2 / 7.3
- [ ] M4 D2 cross-end approval — 走完 [Android_M4_D2_E2E.md](Android_M4_D2_E2E.md) §4 7 个场景
- [ ] M5 sign.request — 桌面 marketplace.purchase > $10 → 手机 ApprovalDialog → StrongBox 签名 → 桌面提交（demo #6）
- [ ] M6 性能预算 — 见 §7.2 表 8 个指标真测 + 回填
- [ ] M7 — `README.md` versionName v0.32.0 → v1.0.0、CHANGELOG release notes、docs-site 同步

## 9. logcat 标签速查

```bash
# D-share
adb logcat -s "ShareReceiverActivity:*" "IntentPayloadParser:*" "SharedInboxRepository:*"

# D-loc
adb logcat -s "LocationTagger:*" "LocationProvider:*"

# D-voice (existing tags)
adb logcat -s "SpeechRecognizer:*" "TTSManager:*" "VoiceMode:*"

# D-camera (existing tags)
adb logcat -s "Camera:*" "OCRPipeline:*"

# D-push (待加)
adb logcat -s "ChainlessChainFCMService:*" "PushNotifier:*"

# 跨端协议 (M4 D2)
adb logcat -s "RemoteCommandClient:*" "ApprovalCommandRouter:*" "AndroidApprovalGate:*"
```
