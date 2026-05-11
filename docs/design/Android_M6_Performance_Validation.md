# Android v1.0 — M6 性能 / 续航 / 弱网压测验收

> **版本**: v1.0 (2026-05-11) | **关联**: [Android 重新定位设计文档](Android_重新定位_设计文档.md) §7.2 性能预算
> **状态**: 🟡 方法学就位；实测值待真机回填

本文档既是 M6 验收的"怎么测"，也是 release notes 的"测了什么"。每行测量结果回填后即可作为 v1.0 性能背书。

## 1. 8 项预算 + 测量方法

| # | 指标                       | 目标          | 测量工具 / 方法                                                            | v1.0 实测  | 备注                                       |
| - | -------------------------- | ------------- | -------------------------------------------------------------------------- | --------- | ------------------------------------------ |
| 1 | 冷启动 → DID 解锁          | < 1500ms      | §2.1 Macrobenchmark + Trace.beginSection("did_unlock")                     | 待回填    | 含 StrongBoxKeyManager 首次 unwrap 时间    |
| 2 | 暖启动                     | < 400ms       | §2.1 Macrobenchmark, mode=WARM                                              | 待回填    | Process keep-alive，重启 activity         |
| 3 | 24h 后台耗电               | < 3%          | §2.2 Battery Historian + 真机 24h 静置                                      | 待回填    | 配对 desktop 但不主动操作                  |
| 4 | 包体大小                   | < 30MB        | `./gradlew :app:assembleRelease` 后 `apk-analyzer file size`               | 待回填    | release 含 SLH-DSA + libp2p + ECharts      |
| 5 | 同 LAN REMOTE p50          | < 200ms       | §2.3 50 次 `system.info.getCpu` 端到端计时（Android 发请求 → response 到手） | 待回填    | 桌面 desktop + Android 同 WiFi             |
| 6 | 跨 NAT REMOTE p50          | < 800ms       | §2.3 同上但 desktop 与 Android 在不同 NAT (4G hotspot vs 家 WiFi)            | 待回填    | TURN 不参与 — 全靠 STUN 直连              |
| 7 | StrongBox 签名             | < 30ms        | §2.4 SignAsServiceBenchmark — 100 次 `nacl.sign` (硬件 unwrap + Ed25519)   | 待回填    | 不含 BiometricPrompt 等待 + dialog 时间    |
| 8 | ASR 首字延迟               | < 500ms       | §2.5 Voice Mode 真人语音 10 次平均 — 说出第一个字到 partial text 出现       | 待回填    | 依设备 SpeechRecognizer 实现差异较大       |

## 2. 测量方法详情

### 2.1 Macrobenchmark — 冷启动 / 暖启动

```kotlin
// android-app/benchmark/src/main/java/.../StartupBenchmark.kt
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test fun coldStartupToDidUnlock() = rule.measureRepeated(
        packageName = "com.chainlesschain.android",
        metrics = listOf(StartupTimingMetric()),
        iterations = 10,
        startupMode = StartupMode.COLD,
        setupBlock = { pressHome() }
    ) {
        startActivityAndWait()
        // 等 DID 解锁完成的 trace section
        device.wait(Until.hasObject(By.res("did_unlocked_marker")), 5_000)
    }

    @Test fun warmStartup() = rule.measureRepeated(
        ...
        startupMode = StartupMode.WARM,
        iterations = 10
    ) { startActivityAndWait() }
}
```

在 source 里加 trace section：

```kotlin
// DIDManager.kt 解锁完成处
Trace.beginSection("did_unlock")
val identity = unwrapActiveIdentity()
Trace.endSection()
```

执行: `./gradlew :benchmark:connectedBenchmarkAndroidTest`

### 2.2 Battery Historian — 24h 后台耗电

1. 设备完全充电 → 拔线
2. 启 app + 完成 DID 解锁 + 配对桌面 + 进入 ChatPanel 进行 1 次对话（建模"日常使用余热"）
3. 退到后台、灭屏静置
4. 24h 后 `adb bugreport > bugreport.zip`
5. 上传到 https://bathist.ef.lc/ → 看 ChainlessChain 进程 % battery use
6. **核查项**: 是否有 WakeLock 漏释 / 长连接耗电 / FCM 心跳过频

替代方案（无法等 24h 时）: `adb shell dumpsys batterystats --reset` → 6h 后取 ratio × 4 外推（误差 ±30%）

### 2.3 REMOTE LAN/NAT p50 — 50 次端到端计时

```kotlin
// android-app/app/src/androidTest/.../RemoteLatencyTest.kt
@Test fun remoteLAN_p50_under_200ms() = runBlocking {
    val client = remoteClient // injected
    val samples = (1..50).map {
        val t0 = SystemClock.elapsedRealtime()
        client.invoke("system.info.getCpu", emptyMap())
        SystemClock.elapsedRealtime() - t0
    }.sorted()
    val p50 = samples[25]
    val p95 = samples[47]
    Log.i("LatencyBenchmark", "p50=${p50}ms p95=${p95}ms range=${samples.first()}-${samples.last()}ms")
    assertThat(p50).isLessThan(200L)
}
```

NAT 场景: 同测试，把 Android 切到 4G hotspot（脱离与桌面同子网），跑 NAT 版本。

### 2.4 StrongBox 签名 — 100 次硬件签名

```kotlin
@Test fun strongboxSign_p50_under_30ms() = runBlocking {
    val gate = androidApprovalGate
    val payloadHash = sha256("benchmark-payload")
    // 关掉 BioPrompt（requireBiometric=false）只测 sign 自身
    val samples = (1..100).map {
        val t0 = SystemClock.elapsedRealtime()
        signAsService.sign(payloadHash, requireBiometric = false)
        SystemClock.elapsedRealtime() - t0
    }
    val p50 = samples.sorted()[50]
    assertThat(p50).isLessThan(30L)
}
```

不同 KeyTier 应分别记录（NATIVE_STRONGBOX / NATIVE_TEE / SOFTWARE）。

### 2.5 ASR 首字延迟 — 真人语音

> Macrobenchmark 不能自动测真人语音；需 stopwatch。

1. 真机进 Voice Mode
2. 准备 10 句中文短语（"今天天气怎么样" 等）
3. 长按麦克 → 立即说第一字 → 同步开始秒表
4. ASR partial text 第一个字出现 → 停秒表
5. 取 10 次平均、p50、p95

如果有 stopwatch ms 精度问题，用屏幕录制 60fps + 帧分析。

## 3. 弱网 / 不稳定网络（§7.3 测试矩阵 L2 列要求 "3G/200ms RTT/5% loss"）

### 3.1 模拟弱网

Linux 桌面 + iptables / Android 7+ Quick Settings 都不行（精度差）。**推荐**:

- **Charles Proxy** (mac/Win) 的 "Throttle" — 3G 预设、可调 RTT/jitter/loss
- **Network Link Conditioner** (mac) — 系统级，对 emulator 友好
- **TC + IFB** (Linux 桌面) — `tc qdisc add dev eth0 root netem delay 200ms loss 5%`

### 3.2 弱网下 sync / approval 关键场景

| 场景 | 预期 |
|------|------|
| 弱网 sync 30s 循环 | 不应超时；可降速但不丢消息 |
| 弱网下 approval.request | 60s 超时内能完成；若失败 deniedReason 应是 `transport:*` |
| 弱网下 marketplace.purchase reverse sign | 90s 内完成；用户看 progress hint 不卡死 |

### 3.3 真机长时间弱网（4h）跑 sync — 漏消息率

```
脚本: 桌面每 60s 创建 1 个 note (240 个)
弱网: TC 加 RTT 300ms / loss 3% / bandwidth 1Mbps
4h 后: Android 收到 note 总数 / 240 ≥ 99.5%
```

## 4. 回填模板

发版前在本文档表 §1 直接填上实测值。例：

| # | 指标 | 目标 | v1.0 实测 |
| - | ---- | ---- | -------- |
| 1 | 冷启动 → DID 解锁 | < 1500ms | **1180ms** (p50, Pixel 6, NATIVE_STRONGBOX) |
| ... | | | |

若某项不达标，必须给"原因 + 推 vN.M+1 修复"，例：

> #5 同 LAN REMOTE p50 实测 380ms（目标 200ms） — node-datachannel ICE 初次握手占 280ms，
> 后续命令 p50 仅 110ms。**结论**: 单次延迟达标，握手摊销在长连接生命周期内可接受。
> v1.1 计划预热 ICE 跳过首次握手。

## 5. release-time 必跑的命令

```bash
# 包体（必跑）
cd android-app && ./gradlew :app:assembleRelease
~/Android/Sdk/cmdline-tools/latest/bin/apkanalyzer apk file-size app/build/outputs/apk/release/app-release.apk
# 期望: < 30MB（含 SLH-DSA + libp2p ≈ 8MB 三方 + ECharts ≈ 2MB）

# Macrobenchmark（必跑，需真机）
./gradlew :benchmark:connectedBenchmarkAndroidTest

# Lint / detekt / 单测（已在 CI；release tag 前 local 再跑一次）
./gradlew :app:detekt :app:lint :app:testDebugUnitTest
```

## 6. CI 集成（v1.1 计划，v1.0 暂不强求）

CI 跑 Macrobenchmark 需要 Firebase Test Lab 或自维护 emulator runner，v1.0 仍人工跑。
v1.1 加 baseline-profile 自动生成 + benchmark trend dashboard。

## 7. 已知会偏离预算的项

- **#3 后台耗电** — 如果用户配对的桌面长时间在线 + frequent sync，每小时 ~1% 是合理上限。
  超 3% 通常是 WakeLock 漏（重点查 P2PClient 的 WebRTC keep-alive）。
- **#6 跨 NAT p50** — 对称 NAT 下 STUN 直连失败 → 走 signaling-server 中继，p50 可能 1500ms+。
  v1.0 暂可接受，v1.1 加 TURN 解决。
- **#8 ASR 首字** — 系统输入法实现差异 100-800ms 不等。Google Speech 通常 <400ms；
  搜狗 / 讯飞 ~500-700ms；离线模型 1s+。文档预算针对 Google Speech；其它实现单独标注。
