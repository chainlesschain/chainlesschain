# PDH A3 — Android 端侧 LLM 设计

> **状态**：设计稿 v0.1 (2026-05-22)
> **依赖**：Plan A v0.1 已 ship（in-APK cc + SQLCipher vault + 1305 entities 真机 verified）
> **目标**：在 Android 端补齐 "大白话提问 + AI 给出处 + 飞机模式可用" 三项推文承诺
> **工程量**：6-7 man-days 到 v0.1 可演示

## 1. 推文承诺映射

推文 §"它都能干啥？8 件事说清楚"中的以下条目目前 **Android 端尚无实现**：

- §2 用大白话提问，不用学命令 — 桌面通，Android 缺
- §3 AI 回答必须"给出处" — 依赖端侧 LLM
- §4 无网也能用 — 数据采集层无网 OK，但 ask 流仍需联网走云
- §三道锁 · 第二把：默认不许"问云端" — 没端侧 LLM 时此承诺空转

A3 落地后这 4 条全部对齐推文。

## 2. 选型决策

### 2.1 调研结论（research agent 2026-05-22）

| 方案 | 描述 | 决策 |
|---|---|---|
| **A. kotlinllamacpp + Kotlin HTTP server** | Kotlin AAR 直 JNI llama.cpp；Kotlin 跑 Ollama-compat HTTP server；in-APK cc 复用 OllamaClient | ✅ **采纳** |
| B. llama.rn 剥 RN | 把 React Native 包 hack 成普通 Kotlin 用 | ❌ 工程量翻倍，违反 vendor 意图 |
| C. node-llama-cpp 在 in-APK Node | 在 Termux Node runtime 里跑 LLM | ❌ Termux 自定义 linker 让 prebuilt 全废；无 cmake/NDK 无法源码编译 |

### 2.2 模型选择

**Qwen2.5-1.5B-Instruct-Q4_K_M** (~1GB)

| 维度 | 0.5B | 1.5B | 7B |
|---|---|---|---|
| 文件大小 (Q4_K_M) | ~400MB | ~1GB | ~4.5GB |
| RAM 峰值 | ~600MB | ~1.5GB | ~5GB |
| 首 token 延迟 | <0.5s | <1s | 5-15s |
| Decode 速率 | 20-30 tok/s | 8-15 tok/s | 不可用 |
| 中文 RAG 归纳质量 | 边界 | 安全 | overkill |

**8GB RAM 米机基线**（Xiaomi 24115RA8EC, Dimensity 7025-Ultra）：1.5B 是中文 instruction following + 简单 RAG 拼 prompt 场景的安全位。

### 2.3 SELinux 验证

memory `android_runas_loopback_selinux_split.md` 显示 `adb run-as` 测 loopback 不可靠（runas_app vs untrusted_app SELinux type 拆开），但 **真生产路径走 cc subprocess 时不撞此问题**（ProcessBuilder.start() 继承父进程 untrusted_app context，与 server 同 type）。

因此 HTTP-Hybrid 架构生产可行，仅注意：调试期不要用 adb run-as 长测 loopback。

## 3. 架构

```
┌──────────────────────────────────────────────────────────────┐
│ Android App (Kotlin / JVM, untrusted_app SELinux)            │
│                                                              │
│  ┌────────────────────┐    ┌─────────────────────────────┐   │
│  │ HubAskScreen       │    │ HubLocalScreen (existing)    │  │
│  │  (Compose UI)      │    │  9 张 adapter 卡 + sync 按钮 │  │
│  └─────────┬──────────┘    └──────────┬──────────────────┘   │
│            │ ask "上周谁打过电话"      │ sync                  │
│            ▼                          ▼                      │
│  ┌────────────────────────────────────────────────────┐      │
│  │ LocalCcRunner (existing)                           │      │
│  │   ProcessBuilder → cc hub ask --json               │      │
│  │   env: CC_HUB_OLLAMA_URL=http://127.0.0.1:11434    │      │
│  └─────────┬──────────────────────────────────────────┘      │
│            │ spawn (fork untrusted_app)                      │
│            ▼                                                 │
│  ┌────────────────────────────────────────────────────┐      │
│  │ in-APK cc (Node 26, untrusted_app)                 │      │
│  │   AnalysisEngine.ask(question)                     │      │
│  │   ├─ RAG: 检索 vault → 拼 context                  │      │
│  │   └─ OllamaClient.chat(messages) → HTTP 127.0.0.1  │      │
│  └─────────┬──────────────────────────────────────────┘      │
│            │ HTTP POST /api/chat (loopback)                  │
│            ▼ (同 SELinux type, MIUI 不拦)                   │
│  ┌────────────────────────────────────────────────────┐      │
│  │ LocalLlmServer (Kotlin, untrusted_app)             │      │
│  │   Ktor CIO embeddedServer:11434                    │      │
│  │   POST /api/chat → Ollama JSON 兼容                │      │
│  │   POST /api/tags → health check                    │      │
│  └─────────┬──────────────────────────────────────────┘      │
│            │ JNI                                             │
│            ▼                                                 │
│  ┌────────────────────────────────────────────────────┐      │
│  │ kotlinllamacpp (AAR + libllama.so)                 │      │
│  │   ggml/llama context @ filesDir/models/qwen2.5-… │      │
│  └────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

**关键点**：

1. **JS 零改** — `OllamaClient` 已经支持 `CC_HUB_OLLAMA_URL` env override
2. **AnalysisEngine.ask 零改** — 同一段 RAG + 引用回填代码，桌面/Android 共用
3. **Citation 自动 work** — `cc hub ask --json` 已经返回 `{ answer, citations: [{eventId,...}] }`
4. **拒云开关自动 work** — `AnalysisEngine.ask` 已有 `acceptNonLocal` flag，`OllamaClient.isLocal=true` 满足默认拒云

## 4. 工程拆解

### 4.1 子任务

| ID | 描述 | 工时 | 平台 |
|---|---|---|---|
| A3.1 | `kotlinllamacpp` AAR 接入 + `libllama.so` packaging (`useLegacyPackaging=true`) | 0.5d | Android |
| A3.2 | `LocalLlmServer.kt` — Ktor CIO embedded server，`/api/chat` + `/api/tags` | 1d | Android |
| A3.3 | `LocalLlmEngine.kt` — JNI wrapper，loadModel/chat/freeContext | 1d | Android |
| A3.4 | `ModelManager.kt` — 首次启动从 HF mirror 下到 `filesDir/models/`，SHA256 校验 | 0.5d | Android |
| A3.5 | `LocalCcRunner` 加 `CC_HUB_OLLAMA_URL` env wire | 0.2d | Android |
| A3.6 | `HubAskScreen.kt` Compose UI — 输入框 + 流式答案显示 + citations link 到 audit 详情 | 1d | Android |
| A3.7 | `HubLocalViewModel` 加 `askQuestion(text)` action 调 LocalCcRunner.ask | 0.5d | Android |
| A3.8 | RemoteOperateScreen 接 `HubAskScreen` 为新 tab "提问" | 0.3d | Android |
| A3.9 | 真机 E2E：飞机模式 + 1305 entities + "上周谁给我打过电话" 出真答案 + 引用 | 1d | Real device |
| A3.10 | 拒云开关 UI — Settings 加 "允许云端 AI 兜底" toggle，默认 OFF | 0.3d | Android |

**合计**: 6.3d Android 工程 + 真机验。研究 agent 估 6-7d 一致。

### 4.2 文件清单

**新增**：

- `android-app/app/src/main/java/com/chainlesschain/android/pdh/llm/LocalLlmServer.kt`
- `android-app/app/src/main/java/com/chainlesschain/android/pdh/llm/LocalLlmEngine.kt`
- `android-app/app/src/main/java/com/chainlesschain/android/pdh/llm/ModelManager.kt`
- `android-app/app/src/main/java/com/chainlesschain/android/remote/ui/personalDataHub/HubAskScreen.kt`
- `android-app/app/src/test/java/com/chainlesschain/android/pdh/llm/LocalLlmServerTest.kt`
- `android-app/app/src/test/java/com/chainlesschain/android/pdh/llm/ModelManagerTest.kt`

**修改**：

- `android-app/app/build.gradle.kts` — 加 `io.github.ljcamargo:llamacpp-kotlin:0.4.0` + `io.ktor:ktor-server-cio:2.3.x` + `useLegacyPackaging=true` if not already
- `android-app/app/src/main/java/com/chainlesschain/android/pdh/LocalCcRunner.kt` — `syncAdapter` 类似的 `askQuestion(question, timeoutMs)` method；env 加 `CC_HUB_OLLAMA_URL`
- `android-app/app/src/main/java/com/chainlesschain/android/remote/ui/personalDataHub/HubLocalViewModel.kt` — 加 askQuestion action + UiState 加 askResult / askInFlight
- `android-app/app/src/main/AndroidManifest.xml` — 确认 `INTERNET` 权限（仅 loopback 也需要）

### 4.3 模型分发策略

**选 sideload 不 bundle**：1GB 模型不进 APK assets（APK 体积 + Play Store 150MB 限制 + APK 更新流量）。

- 首次启动 `HubAskScreen` 检测 `filesDir/models/qwen2.5-1.5b-instruct-q4_k_m.gguf` 不存在 → 显示下载卡片
- 用户点"下载模型"→ OkHttp 从 huggingface.co 或国内镜像 (mirror.ghproxy.com / hf-mirror.com) 下到 `filesDir/models/`
- 下载完 SHA256 校验通过后 enable 提问按钮
- 失败/中断可恢复（HTTP range 请求 + 断点续传）

**URL 选择**：默认 `https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf`（中国可达）；fallback 至 huggingface.co；用户可在 settings 改 URL。

## 5. 前向 Traps（impl 期间必扫）

### Trap A3-1：AGP 8+ `useLegacyPackaging=true`

memory `android_native_lib_extract_w_x.md` 已记录：`.so` 走 ProcessBuilder.exec 路径需 `useLegacyPackaging=true`。kotlinllamacpp 的 `libllama.so` 是 JNI dlopen，不走 exec，但保险起见同样 enable。验法：装机后 `adb shell run-as <pkg> ls lib/arm64-v8a/libllama.so` 应能列出。

### Trap A3-2：模型 file 大小 + filesystem 可用空间

1GB GGUF 下载前必 check `Environment.getDataDirectory().usableSpace` ≥ 1.2GB（headroom 200MB），不足时友好提示让用户清空间。

### Trap A3-3：Ktor server 端口冲突

11434 是 Ollama 默认端口，但 Android 上可能被其他 app 占；改用 **127.0.0.1:18484**（Ollama 11434 的 hash mod 10000 + 8000），自动从 18484 起在 [18484, 18493] 找空闲端口。port 写到 `filesDir/.chainlesschain/llm-port.txt` 供 LocalCcRunner 读取拼 `CC_HUB_OLLAMA_URL`。

### Trap A3-4：kotlinllamacpp 上游 dependency

memory 已警：39 star 项目，bus factor 1。如 upstream 断更：
- fork 到 chainlesschain org 锁版本
- 备援：直接用 llama.cpp 官方源码 + 200 行自维护 JNI（kotlinllamacpp v0.4 源码本就 ~500 行）

### Trap A3-5：JNI HandleScope ABI（同 bs3mc trap 17）

`libllama.so` 升级时若链接的 ggml 版本变了，可能撞类似 V8 13.x HandleScope ctor 这种 ABI 漂移。memory `pdh_plan_a_android_standalone_design.md` trap 17 同套路：kotlinllamacpp 升级必先 sandbox build 试编 + 真机 smoke。

### Trap A3-6：首次 inference 冷启动延迟

首次 loadModel 耗时 3-5s（mmap + warm cache），UI 必显 "正在加载模型..." 进度，否则用户以为卡死。后续问答首 token <1s。

### Trap A3-7：上下文长度 vs 内存

Qwen2.5-1.5B 默认 32K context 但实际 RAM 不够；llama.cpp init 时设 `n_ctx=4096` 即可（RAG context 通常 2-3KB token，4K context 够用）。设过大直接 OOM 闪退。

### Trap A3-8：MIUI 后台被 kill

模型 mmap 大 + 推理高 CPU 让 MIUI scheduler 易 kill；HubAskScreen 推理期间应：
- foregroundService 提升进程优先级（带 notification）
- 推理完立即 stopForeground

### Trap A3-9：citation eventId 在 Android 端如何点击查看原文

`cc hub ask --json` 返回 `{ citations: [{ eventId: "evt_abc123" }] }`。Android UI 点 citation chip → 跳已有 audit screen (queryEvents API) → 显原文。需要 audit screen 支持 deeplink `eventId=xxx`。

### Trap A3-10：拒云开关默认状态 + 切换 UX

Settings 加 toggle：

```
[ ] 允许 AI 在本地数据不足时使用云端兜底
    （关闭=完全离线 / 默认）
```

切到 ON 时弹 modal："你的提问可能会发送到外部 AI 服务。每次都会再次询问吗？"
- "记住选择"
- "每次询问"

## 6. 验收标准

A3 v0.1 可演示 = 全部以下满足：

1. ✅ 首次启动 HubAskScreen，1GB 模型下载（断点续传）+ SHA256 校验通过
2. ✅ 输入"上周谁给我打过电话"，出真答案（不是 mock，真 LLM 输出）
3. ✅ 答案下方显引用 chip，点击跳 audit screen 显原文（eventId 匹配）
4. ✅ **飞机模式开**，关闭 WiFi + 蜂窝，问答仍 work（首 token <1s，整答 <5s）
5. ✅ 拒云开关默认 OFF，开关后切云端兜底真生效
6. ✅ Audit 表里记录 ask 事件（who/when/what 问题/用哪个 LLM/local-or-remote）
7. ✅ 推理期间 RAM <2GB，不闪退；推理后 RAM 回落

## 7. 后续 v0.2 路线

- 流式输出（token-by-token，Ktor SSE + Ollama `stream: true`）
- 模型多选（Qwen2.5-0.5B / 1.5B / 3B 切换）
- 性能 dashboard（tok/s 实时显示）
- Memory pressure 自动卸模型 + 重 mmap

## §"路由策略调整 2026-05-24" — 4 档 LLM 路由 + 三屏 selector

> 真机验 MediaPipe 端侧效果不佳后，2026-05-24 决策：把 LLM 路由从单一端侧改为 4 档可选，
> 用户在首页对话框 (HubAskCard / HubAskScreen) 直接选目标推理源。MediaPipe 不删，作端侧
> 路径之一保留。详见 memory `pdh_4tier_llm_route_card_selector` (7 trap)。

### 4 档路由

| LlmRoute | 数据源 | LLM 端点 | 触发条件 |
|---|---|---|---|
| `LOCAL_DEVICE` | tab 3/4: phone vault (cc + RAG) / tab 0: phone in-VM | tab 3/4: on-device LocalLlmServer / tab 0: MediaPipe direct chat (无 RAG) | tab 3/4: `llmEngine.nativeReady` / tab 0: 同 |
| `CLOUD_ANDROID` | tab 0: desktop retrieveContext / tab 3/4: 无 RAG | Android adapter (豆包/DeepSeek/Claude/通义/Qwen...10 家) | SecurePreferences 配过任一云厂商 API key |
| `PC_LOCAL` | desktop vault (REMOTE RPC) | 桌面 Ollama / LM Studio | `remoteHub.health().llm.ok && isLocal == true` |
| `LAN_OLLAMA` | phone vault (cc + RAG) | 用户填的 LAN host (CC_HUB_OLLAMA_URL env) | `llmPreferences.lanLlmBaseUrl != null` |

### UI 三屏统一

- **tab 0 "提问"** (`HubAskScreen` + `HubAskViewModel`): REMOTE / desktop hub
- **tab 3 "本机数据"** (`HubLocalScreen` + `HubLocalViewModel` 的 `HubAskCard`)
- **tab 4 "本机提问"** (`HubLocalAskScreen`，同 `HubLocalViewModel` 实例)

三屏共享同款选择器形态：
- 0 路可用 → `errorContainer` banner 引导用户去 Settings 配置
- 1 路可用 → 单行只读 label 显当前路由
- ≥2 路可用 → 4 `RadioButton` 行，不可用项灰显

### LAN baseUrl 配置入口

Settings → AI 后端 → "局域网 Ollama URL" `OutlinedTextField`:
- 规范化: 去尾斜杠 + blank=clear
- 校验: `^https?://[A-Za-z0-9.\-]+(:\d{1,5})?(/.*)?$`
- 持久: `LlmPreferences` (EncryptedSharedPreferences) — 不 sync 到 cc config (LAN URL 仅 in-APK ask 消费)
- 实时同步: `StateFlow<String?>` → 三屏 ViewModel `onEach` 订阅

### effectiveRoute fallback 链

```kotlin
val effectiveRoute: LlmRoute get() = when {
    selectedRoute == X && xAvailable -> X  // 4 × selected-route 命中分支
    cloudAvailable -> CLOUD_ANDROID         // 否则按 cloud→pc→lan→local 找第一个可用
    pcLocalAvailable -> PC_LOCAL
    lanAvailable -> LAN_OLLAMA
    localDeviceAvailable -> LOCAL_DEVICE
    else -> selectedRoute                   // 都不可用：UI 已显 banner，submit 兜底报错
}
```

### MediaPipe 端侧路径定位

- tab 0 `LOCAL_DEVICE` = MediaPipe 直答（无 RAG），因为 tab 0 数据源在 desktop，phone 端 vault 通常空
- tab 3/4 `LOCAL_DEVICE` = on-device LocalLlmServer + cc subprocess + 本机 vault RAG（既有默认行为）
- 用户实测 MediaPipe Qwen2.5-1.5B 答非数据问题质量不佳；数据问题靠 RAG 拉准上下文

### 测试覆盖

- `LlmPreferencesTest` — 4 LAN URL 用例 (默认 null / 规范化尾斜杠 / blank-clear / 幂等)
- `HubAskViewModelTest` — 3 路由用例 (LOCAL_DEVICE / LAN_OLLAMA happy / LAN no-url banner)
- `HubLocalViewModelTest` — 3 路由用例 (默认 LOCAL_DEVICE dispatch / LAN_OLLAMA dispatch / setAskRoute persistence)
- `HubAskRouteSelectorTest` — 8 Compose UI 集成测试 (stateless content + RadioButton click + disabled state)
- `LlmRouteSelectorE2ETest` — 8 `@Ignore`'d 真机 E2E placeholder (需配对桌面 / 真机 API key / LAN Ollama)

### 关联

- memory `pdh_4tier_llm_route_card_selector` — 7 trap + 完整文件清单
- memory `pdh_a3_3tier_llm_routing` — 2026-05-24 上午 3 档版本（被本节扩到 4 档）
- memory `cc_ask_android_local_routing` — `cc ask` CLI 端的 6 级 baseUrl 优先链

## 8. 关联

- [[pdh-plan-a-android-standalone-design]] — Plan A v0.1 主架构，本 A3 是 feature 层扩展
- [[android-runas-loopback-selinux-split]] — SELinux 验证依据（cc subprocess 路径 OK）
- [[android-native-lib-extract-w-x]] — useLegacyPackaging trap
- [[android-cc-subprocess-execve-via-mksh]] — LocalCcRunner spawn pattern
- `docs/marketing/pdh-公众号推文-厦门场景.md` — 推文承诺源（§大白话提问/无网/拒云）

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部。PDH A3 Android 端侧 LLM 设计：兑现推文承诺（大白话提问 + 给出处 / 无网可用 / 拒云），是 Plan A（Android Standalone）的 feature 层扩展。

### 2. 核心特性

端侧 LLM 推理；无网可用；拒云（数据不出端）；大白话提问 + 给出处（RAG）。

### 3. 系统架构

见正文架构；`Personal_Data_Hub_Android_Standalone_Cc.md`（Plan A 主架构）+ 端侧 LLM（MediaPipe / 1.5–3B）。

### 4. 系统定位

PDH Plan A 的**Android 端侧 LLM feature 层**（A3）。

### 5. 核心功能

见正文：端侧推理 / RAG 给出处 / 无网模式。

### 6. 技术架构

端侧 LLM（1.5–3B，摘要 query）；LocalCcRunner spawn（mksh symlink）；useLegacyPackaging（W^X）。

### 7. 系统特点

端侧仅适合 1.5–3B（重型回 Plan B / 云）；SELinux cc subprocess 路径 OK。

### 8. 应用场景

无网 / 拒云场景下本机 AI 问答（推文厦门场景）。

### 9. 竞品对比

端侧（隐私 / 无网）vs 云 LLM（能力强但出端）。

### 10. 配置参考

端侧模型选型；useLegacyPackaging；LocalCcRunner。

### 11. 性能指标

端侧 1.5–3B 推理时延 / 内存（受设备限制）。

### 12. 测试覆盖

SELinux 验证（android-runas-loopback-selinux-split）；native lib W^X。

### 13. 安全考虑

拒云（数据不出端）；端侧加密；W^X / SELinux 约束。

### 14. 故障排除

native lib W^X execve 失败 → useLegacyPackaging（见 memory android-native-lib-extract-w-x）。

### 15. 关键文件

端侧 LLM 引擎；LocalCcRunner；`Personal_Data_Hub_Android_Standalone_Cc.md`。

### 16. 使用示例

见正文端侧问答流程（推文厦门场景）。

### 17. 相关文档

见正文「8. 关联」：`Personal_Data_Hub_Android_Standalone_Cc.md`、memory android-runas-loopback-selinux-split / android-native-lib-extract-w-x / android-cc-subprocess-execve-via-mksh、推文源。
