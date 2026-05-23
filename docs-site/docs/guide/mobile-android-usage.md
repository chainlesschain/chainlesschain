# Android 用户操作手册（v5.0.3.64）

> **目标读者**：第一次拿到 ChainlessChain Android app 的普通用户 + 想搞清楚架构 / 配置 / 性能 / 安全细节的开发者。
>
> 架构 / 源码 / Phase 设计深入请看 [Android v1.0 GA 用户文档](/guide/mobile-android)。本页是用户视角的完整操作手册。

::: tip 适用版本
- App：Android **5.0.3.64**（versionCode `503064`，versionName `5.0.3.64`）
- 桌面：v5.0.3.64
- 桌面与移动同 tag 同步发布，从 release 页面下载时**两端版本号必须一致**
:::

## 概述

ChainlessChain Android 是桌面 ChainlessChain 在移动场景下的**三层延伸**：

| 层 | 定位 | 桌面替代不了的原因 |
|---|---|---|
| **L1** StrongBox DID 钱包 | 硬件级保管 W3C DID v2 私钥 | Android Keystore + StrongBox HSM 芯片级隔离，桌面 U-Key 需插着才能用 |
| **L2** 移动现场捕获 | 语音 / 拍照 OCR / GPS / 系统分享 / 推送 | 桌面没麦克风触手可及、没摄像头、没 GPS、不能接 Android 系统分享 |
| **L3** REMOTE 遥控器 | 调桌面 141 skill / 25 个 REMOTE command | 手机不重复跑大模型，但能在地铁里指挥桌面跑 |

设计原则：**手机不重复实现桌面**，只补桌面在移动场景做不到的事。对齐 Claude Desktop / Mobile 的二端分工。

## 核心特性

### L1 — 安全身份

- 🪪 **StrongBox 硬件 DID 钱包**：Android Keystore + StrongBox HSM 芯片级隔离，私钥永不导出
- 🔑 **BIP-39 助记词**：12/24 词标准 + 可选密语；旧明文密钥升级自动迁 StrongBox
- 👥 **多 DID 切换**：工作 / 个人 / 匿名 三身份独立，签名 / 配对 / 消息走当前活跃 DID
- 🔐 **PIN + 生物识别**：PBKDF2 256k 轮派生 DB key；Face / 指纹解锁 PIN，PIN 始终保留兜底

### L2 — 现场捕获

- 🎙️ **VoiceMode 连续语音**：麦克风 → SeedASR → LLM → TTS 全链路，VAD 静音检测自动切换
- 📷 **CameraOCR**：拍照 → 真 Tesseract OCR → 自动入笔记
- 📍 **LocationTagger**：笔记附 GPS 坐标 + Reverse geocoding 地址
- 🔔 **PushNotifier**：FCM / 自建 push 通道
- 📤 **SharePayloadFlusher**：接 Android 系统分享 Intent（图 / 文 / URL → 入笔记或转发到 PC）

### L3 — 远程操控

- 🖥️ **远程桌面终端**：xterm.js + WebRTC DataChannel 直连，触屏 softkey toolbar
- 📁 **远程文件**：浏览 PC 任意目录 + 上传 / 下载 + Snackbar「打开」拉系统 viewer
- 🖱️ **远程操控 4 skill**：Ping / 系统信息 / 剪贴板双向 / 截图
- 📬 **远程通知**：桌面 push → iPhone 锁屏 banner + tab badge

### 协议与同步

- ↔️ **双向社交数据同步**：5 ResourceType walker（note / conversation / did / community / channel）+ tombstones + Ed25519 真签真验
- 🛰️ **三段位远程操控**：Plan A WebRTC DC（高吞吐流式）/ Plan B STUN-TURN（NAT 兜底）/ Plan C signaling forward（低频命令）

## 系统架构

### 整体分层

```
┌────────────────────────────────────────────────┐
│ UI 层  Jetpack Compose + Material 3 + Hilt     │
├────────────────────────────────────────────────┤
│ 业务层 ViewModel + UseCase + Repository        │
├──────────────┬──────────────────┬──────────────┤
│ L1 安全      │ L2 捕获          │ L3 远程       │
│ Keystore     │ ASR / OCR / GPS  │ WebRTC P2P   │
│ BIP-39       │ Foreground svc   │ Signaling    │
│ DID v2       │ FCM              │ RPC client   │
├──────────────┴──────────────────┴──────────────┤
│ 存储 Room (sync cursor / tombstones / DAO)     │
├────────────────────────────────────────────────┤
│ 协议 libp2p / WebRTC / WS / mDNS               │
└────────────────────────────────────────────────┘
```

### 远程操控三段位链路

| 层 | 何时用 | 延迟 | 链路 |
|---|---|---|---|
| **Plan A** WebRTC DC 直连 | 高吞吐流式（PTY stdout / 文件流） | 30-80ms LAN | P2P 加密 |
| **Plan B** STUN-TURN 中继 | NAT 穿透失败兜底 | 200-500ms | 公网中继 |
| **Plan C** Signaling forward | 单次低频命令（Ping / SysInfo） | 100-400ms | 复用配对 signaling 管道 |

WebRTC SDP 协商成功后自动切 Plan A；失败 fallback Plan B；Plan B 仍不通走 Plan C。状态 chip 实时显示当前路径。

### 配对架构（W3.7 Flow B）

```
Android app                       Desktop app
   │                                  │
   ├── 扫桌面 QR (包含 pcPeerId)──────►│
   │                                  │
   ◄── pairing-code:<code> 信令别名 ──┤
   │                                  │
   ├── DID 签字 +  pairing-ack ──────►│
   │                                  │
   ◄── In-memory ack (Signal e2ee) ──┤
   │                                  │
   ▼ 持久化已配对桌面                  ▼ 持久化已配对设备
```

兜底：手动输 6 位 code（不依赖相机权限）+ Flow A 桌面 webcam 扫 iPhone（高级路径，Signal e2ee 端到端）。

### 同步架构（Phase 3d）

```
Desktop walker (5 ResourceType) ───SyncCoordinator───► Android sync.* RPC
       ▲                                                       │
       │ DID Ed25519 真签真验 (gate 1-4)                       │
       ▼                                                       ▼
   notes / conversations / did /              Room: sync_cursor
   community / channel + tombstones           + Ed25519 verify gate
```

## 配置参考

### 应用配置（运行时可改）

```kotlin
// SettingsScreen → 同步设置
{
  "syncEnabled": true,              // 总开关
  "syncIntervalMinutes": 15,        // 后台 cursor 轮询周期
  "syncOnWifiOnly": false,          // 仅 WiFi 同步
  "syncBatchSize": 100,             // 每批拉 N 条
  "syncRetryMaxAttempts": 3,        // 失败重试
  "syncRetryBackoffMs": 5000        // 重试退避
}

// SettingsScreen → 通知设置
{
  "pushEnabled": true,              // 桌面推送总开关
  "pushQuietHoursStart": "22:00",   // 静默时段
  "pushQuietHoursEnd": "07:00",
  "pushCategoryFilter": ["message", "remote", "sync", "error"]
}

// SettingsScreen → 远程操控
{
  "remoteAutoConnect": true,        // 启动时自动 P2P 协商
  "preferP2PDirect": true,          // 优先 Plan A，否则 fallback B/C
  "turnServer": "turn.chainlesschain.com:3478",  // 默认中继
  "turnIceLifetime": 86400          // ICE creds 24h ephemeral
}
```

### 桌面端配置（影响 Android 体验）

`.chainlesschain/config.json`（桌面 unified-config-manager）：

```json
{
  "mobileBridge": {
    "enabled": true,
    "syncEnabled": true,
    "stunServers": ["stun:stun.l.google.com:19302"],
    "turnSecret": "<set via env CC_TURN_SECRET>"
  },
  "pairing": {
    "qrTtlSeconds": 300,
    "manualCodeTtl": 600
  }
}
```

环境变量优先级：`CC_TURN_SECRET` 必填、其它走默认。

## 性能指标

### 启动 / 响应时间

| 操作 | 目标 | 实际 | 状态 |
|---|---|---|---|
| 冷启动到 PIN 屏 | < 2s | ~1.5s | ✅ |
| PIN 解锁到主界面 | < 500ms | ~300ms | ✅ |
| 扫码识别 QR | < 2s | ~1.2s | ✅ |
| 配对协商（LAN） | < 3s | ~2s | ✅ |
| 配对协商（跨网中继） | < 10s | ~5-8s | ✅ |
| 远程终端 PTY 拉起 | < 800ms | ~500ms | ✅ |

### 远程操控延迟

| 链路 | RTT p50 | RTT p99 |
|---|---|---|
| Plan A WebRTC DC 直连 LAN | 30ms | 80ms |
| Plan A WebRTC DC 直连 蜂窝 | 60ms | 200ms |
| Plan B TURN 中继 | 200ms | 500ms |
| Plan C signaling forward | 150ms | 400ms |

### 资源使用

| 指标 | 数值 |
|---|---|
| APK 大小 | 82 MB (arm64-v8a) / 59 MB (armeabi-v7a) / 124 MB (universal) |
| 安装后占用 | ~150 MB |
| 内存 (空闲) | < 50 MB |
| 内存 (远程终端会话) | ~80 MB |
| 内存 (VoiceMode) | ~120 MB |
| CPU (空闲) | < 3% |
| CPU (远程终端流式) | < 15% |
| 后台同步流量 | < 1 MB/h（增量 cursor） |

### 兼容范围

| 指标 | 范围 |
|---|---|
| Android API 范围 | 26 (8.0) — 35 (15) |
| 推荐版本 | Android 12+（StrongBox HSM 需 9+；强制 biometric 需 10+） |
| 同时活跃 PTY session | 8+ |
| 同时配对桌面数 | 5+ |

## 测试覆盖率

### 单元测试

| 模块 | 测试数 | 覆盖率 |
|---|---|---|
| 配对 ViewModel + DID 验签 | 57 | ~90% |
| 远程终端 TerminalRpcClient | 38 | ~85% |
| 远程文件 RemoteCommandClient | 34 | ~85% |
| 同步 walker + cursor | 52 | ~80% |
| StrongBox / DID Manager | 41 | ~92% |
| VoiceMode / OCR / Push | 89 | ~75% |
| 其它（utilities / repo / VM） | 72 | ~70% |
| **合计** | **383+** | **平均 ~80%** |

### 集成测试 / E2E

| 类型 | 范围 |
|---|---|
| Robolectric 集成 | sync 53 case / pairing 18 case |
| Android Instrumented | DID lifecycle / Room migration |
| 真机 E2E (Xiaomi 24115RA8EC × Win 桌面) | 配对 3 流 / 远程终端 PTY 完整链路 / 文件 8 场景 / 远程操控 4 skill / VoiceMode |

### CI 状态

- **Android CI Pipeline**：lint + unit + Robolectric，每个 PR 触发
- **Android E2E Tests**：每个 push 到 main 触发
- **Release pipeline**：tag push 触发 4 包构建 + signing + GitHub Release

## 安全考虑

### 私钥保管

1. **StrongBox HSM** — 芯片级隔离，私钥永不出 Secure Element
2. **不可导出 flag** — Keystore `setUserAuthenticationRequired(true) + setStrongBoxBacked(true)`
3. **生物识别 gate** — 解锁私钥 = 解锁 Face / 指纹 + PIN
4. **助记词加密存** — BIP-39 mnemonic AES-256-GCM with PIN-derived key，**仅在恢复时短暂在内存**

### 通信安全

1. **配对**：Signal e2ee 协议（Flow A）/ DID 签字校验（Flow B/manual）
2. **远程命令**：WebRTC DC = DTLS-SRTP 端到端加密；TURN 中继不解密 payload
3. **同步**：DID Ed25519 签名 + 4 道 verify gate（schema / actor / signature / timestamp）
4. **TURN ICE creds** — HMAC-SHA1 24h ephemeral，**不存桌面**，发版后强制 `CC_TURN_SECRET` 环境变量

### 数据安全

1. **SQLCipher** — 数据库 AES-256，密钥派生自 PIN
2. **生物识别只解 PIN** — 不直接解 DB key（fallback path 需 PIN）
3. **私钥不入备份** — Android Backup 排除 `keystore/` 与 mnemonic
4. **审计日志** — DID 操作 / 远程命令执行 / 文件上传下载 100% 审计

### 已知约束

- StrongBox HSM 仅 Android 9+ 设备（Pixel / Samsung Knox / 部分 OEM）；旧设备 fallback 软件 Keystore
- 生物识别强制要求 BiometricManager.BIOMETRIC_STRONG（Class 3）；Class 2 设备只能用 PIN
- 远程文件下载到公共 Download/ 目录（MediaStore），其它 app 可见 — 敏感文件请放 app 私有目录

## 故障排查

### 配对问题

**Q: 扫码识别不出 QR**

1. 相机权限给了吗？（设置 → 应用 → ChainlessChain → 权限 → 相机）
2. 屏幕反光？换姿势 / 离屏幕 30cm 左右
3. QR 已过期？桌面端默认 5min TTL，超时重新生成
4. 兜底：用「手动输入 6 位码」

**Q: 配对协商 30s 超时**

1. 手机 PC 在同 WiFi？或跨网走中继？
2. 桌面端 STUN/TURN 配置？打开桌面设置 → 「移动设备配对」→ 测试 ICE
3. 手机网络限制了 P2P？（部分企业 WiFi / 运营商内网）— 配置 STUN/TURN 走中继

**Q: 「DID 不匹配」错**

桌面端切换过 DID 后 QR 已变。重新生成 QR 重新扫码。

### 远程终端问题

**Q: 黑屏 / 转圈**

1. 桌面端 ChainlessChain 还在跑吗？（任务栏托盘有图标？）
2. 桌面 mobile-bridge service 启动了吗？查桌面端「设置 → 移动设备配对 → 状态」

**Q: stdout 中断**

1. 信令路径不稳定，回到列表重建会话（DataChannel 自动重连 ≤ 3s）
2. 状态 chip 颜色变化：蓝=P2P / 黄=relay，黄色下输入延迟 200-500ms 是预期

**Q: 输入无响应**

1. xterm-shell.html 是否加载完成（首次 ~500ms）
2. 按 Ctrl+C 测试响应

### 同步问题

**Q: 同步开关打开但没拉到数据**

1. 桌面 mobile-bridge-sync service 在跑吗？查桌面 `cc status sync`
2. DID 签字验证失败？看桌面 audit log（设置 → 审计）
3. 时钟漂移？手机/桌面时钟差 > 60s 会被 gate 4 拒（同步前对时）

**Q: 增量同步停在某一条**

1. 该条消息含损坏 payload — 桌面 log 会写 `[sync-walker] skip: invalid`，手动从 cursor advance

### 远程文件问题

**Q: 下载到了哪里？**

`手机存储/Download/` 公共目录（跟浏览器下载位置一致）。

**Q: Snackbar「打开」无响应**

文件类型没有对应 viewer app 装着（如 `.psd` 没 Photoshop Mobile）。手动用文件管理打开。

### 调试模式

```kotlin
// 在 SettingsScreen → 高级 → 启用 verbose log
prefs.setBoolean("debug.verbose", true)

// 日志位置: app 私有目录 logs/chainlesschain-<date>.log
// adb pull: adb pull /data/data/com.chainlesschain.android/files/logs/

// 远程命令链路诊断
// SignalingRpc.metric path=dc|signaling 上线
adb logcat -s SignalingRpc -s WebRTCClient -s TerminalRpcClient
```

## 关键文件

| 文件 | 职责 | 行数 |
|---|---|---|
| `android-app/app/src/main/java/.../auth/AuthViewModel.kt` | PIN / 生物识别 / DID 登录 | ~480 |
| `android-app/app/src/main/java/.../did/DIDManager.kt` | StrongBox DID 钱包 + BIP-39 | ~720 |
| `android-app/app/src/main/java/.../p2p/P2PClient.kt` | libp2p + WebRTC 协调 | ~890 |
| `android-app/app/src/main/java/.../p2p/WebRTCClient.kt` | Plan A DC 直连 | ~1,100 |
| `android-app/app/src/main/java/.../p2p/SignalingRpcClient.kt` | Plan C signaling forward | ~530 |
| `android-app/app/src/main/java/.../p2p/RemoteCommandClient.kt` | 4 skill RPC 客户端 | ~640 |
| `android-app/app/src/main/java/.../remote/FileCommands.kt` | 文件 11 action handler | ~1,116 |
| `android-app/app/src/main/java/.../remote/ClipboardCommands.kt` | 剪贴板双向 | ~229 |
| `android-app/app/src/main/java/.../remote/DisplayCommands.kt` | 截图 skill | ~298 |
| `android-app/app/src/main/java/.../remote/SystemInfoCommands.kt` | 系统信息 4 cards + 5s polling | ~1,129 |
| `android-app/app/src/main/java/.../terminal/TerminalRpcClient.kt` | xterm.js bridge | ~580 |
| `android-app/app/src/main/java/.../sync/SyncCoordinator.kt` | Phase 3d 双向同步 | ~920 |
| `android-app/app/src/main/java/.../voice/VoiceModeManager.kt` | SeedASR + VAD + TTS | ~1,260 |
| `desktop-app-vue/src/main/mobile-bridge.js` | 桌面侧配对 + sync gateway | ~1,400 |
| `desktop-app-vue/src/main/p2p/mobile-bridge-sync.js` | 5 ResourceType walker | ~2,100 |
| `desktop-app-vue/src/main/p2p/android-file-handler.js` | 11 action 桌面 handler | ~890 |

## 使用示例

### 1. 首次安装 → 配对 → 跑通 Ping

```bash
# 桌面端：启动 ChainlessChain，确认 mobile-bridge service 状态
cc status sync   # 应看到 "mobile-bridge: running"

# 桌面端：打开配对 QR（V6 默认壳 → 头像 → 我的二维码）
# 手机端：
#   1. 安装 app-arm64-v8a-release.apk
#   2. 首次启动 → 设置 PIN 6 位（如 123456）
#   3. 开启生物识别（可选）
#   4. 主界面 → 桌面配对 → 扫描桌面 QR
#   5. 扫到 → 自动协商 → 「配对成功」
#   6. 远程 tab → Ping → 看 RTT
```

### 2. 远程终端跑 `cc` CLI

```bash
# 手机端 → 远程终端 tab → 选已配对桌面 → 新建会话
# 终端拉起后输入：
$ cc --version              # 看桌面 CLI 版本
$ cc skill list             # 列 141 个 desktop skills
$ cc ask "explain merkle tree"  # 调桌面 LLM 跑 ask
$ cc note search merkle     # 搜桌面知识库
```

### 3. 手机拍照 OCR → 入桌面笔记

```
手机端 → L2 CameraOCR → 拍照菜单
  ↓
  Tesseract 真 OCR → 文字识别
  ↓
  入手机笔记 → 后台同步 walker → 桌面笔记同步
  ↓
  桌面端 KnowledgePage 看到同步过来的笔记
```

### 4. 桌面截图 → 手机相册

```
手机端 → 远程 tab → 截图 skill → 点「截屏」
  ↓
  桌面 1-2s 弹截图结果 → 手机预览
  ↓
  点「保存到相册」→ 首次问 PHPhotoLibrary 授权
  ↓
  手机相册可见
```

### 5. 手机文件上传到桌面

```
手机端 → 文件 tab → ☁️↑ 上传
  ↓
  Android SAF 选文件
  ↓
  上传到桌面 ~/Downloads/
  ↓
  同名自动加 (1)(2) 后缀避免覆盖
```

### 6. 验证安装的真版本

```
手机端 → 设置 → 关于 →

  版本：v5.0.3.64                       ← 必须 4 段制
  Bundle ID：com.chainlesschain.android  ← 必须正确 bundle

  如果版本只显示 5.0.3 或 0.32.0，说明装的是旧版本，重新下载最新 APK。
```

## 相关文档

- [Android v1.0 GA 用户文档（架构 / 同步 / 故障排查全集）](/guide/mobile-android)
- [iOS 用户操作手册](/guide/mobile-ios-usage)
- [远程终端 Plan A 设计文档](/guide/remote-terminal)
- [远程文件 skill 设计文档](/guide/remote-file)
- [Cowork 多智能体](/chainlesschain/cowork)
- [系统概述](/chainlesschain/overview)
- [DID 身份管理](/chainlesschain/did-management)
- [更新日志](/changelog)

---

> 本文档为 Android 用户操作完整手册。更多移动端定位与架构请参阅：
>
> - [移动端定位与三层架构](/chainlesschain/mobile-positioning)
> - [桌面 ↔ Android 双向同步 Phase 3d](/design/phase3d-mobile-sync)
