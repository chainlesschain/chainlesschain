# PDH 推文承诺真接通 — Mac/Linux + 真机 hand-off

> **生成**：2026-05-22 Win session 终态。本 session 11 commits land UI 100%
> + 50% 真接通。剩 ~7-8d 全部需 Mac/Linux Android SDK/NDK + Xiaomi 24115RA8EC。
> **续接 session 必读**：本文档把剩余工作映射到具体文件 + 工时 + 验收，免去
> 重新研究 13d 计划 / A3 设计 / cc subcommand 状态。

## 1. 本 session 已 land 锚点 (11 commits)

```
6bb5eb826  feat(pdh): cmdAsk 加 CC_HUB_ALLOW_NON_LOCAL env fallback (拒云第二路径)
3a76ee5e4  feat(pdh): AI 给出处真接通 — cc hub event-detail + citation chip 跳详情
c2ed40942  feat(pdh): D7.1+D8.1+D10.1 — 支付/出行/AI 助手 sub-cards
fea063c8d  feat(pdh): D6.1 邮箱 4 provider sub-cards
1353103d5  feat(pdh): D11 一键带走 cc hub export 真接通
0fd45af15  feat(pdh): A3.10+D11+D12 — 三道锁 UI (拒云/销毁/导出)
ed768ffdf  feat(pdh): A3.1-A3.4 — Ktor LLM server + ModelManager + 引擎抽象
e14fc5106  feat(pdh): A3.8 — PersonalDataHubScreen tab 4 本机提问
f2705a73e  feat(pdh): A3.8 + D5 — HubLocalScreen 6 类 LazyColumn
f41f06441  feat(pdh): A3 askQuestion 全链路 skeleton (UI+VM+cc spawn)
fd6e08be2  docs(pdh): 13-day plan + A3 端侧 LLM 设计稿
```

range: `git log --oneline 9619e506d..6bb5eb826`

## 2. 剩余 ~7-8d 工作 — 全部 Mac/Linux + 真机

### 2.1 A3 真 LLM impl (~1.5d) — 推文 §大白话提问 / 给出处 / 无网

**当前态**：`LocalLlmServer` Ktor :18484 跑 NoOpLlmInferenceEngine，抛
"engine not wired"。

**任务**：
1. (Mac/Linux) `git clone https://github.com/ljcamargo/kotlinllamacpp`，
   `./gradlew publishToMavenLocal` 看真坐标。或验 JitPack URL
   `https://jitpack.io/com/github/ljcamargo/kotlinllamacpp/0.4.0`
2. 加 dep 到 `android-app/app/build.gradle.kts` (本 session 已留 TODO 在
   §A3 deps 段)
3. 新 `KotlinLlamaCppEngine.kt implements LlmInferenceEngine` 包 JNI
   loadModel/chat/freeContext。参考 `LlmInferenceEngine` 契约 + design doc
   `docs/design/PDH_A3_OnDevice_LLM.md` §3 架构图
4. `LlmModule.kt`: `@Provides` 改 `KotlinLlamaCppEngine` 替代
   `NoOpLlmInferenceEngine`，构造时取 `ModelManager.refresh().file`
5. CI 验绿 (`android-pr-check.yml`)

**验收**：装机后 HubLocalAskScreen 输入 "上周谁给我打过电话" → 真出答案 +
citations。`/api/tags` 返回真模型名。

### 2.2 A3.9 真机飞机模式 E2E (~1d) — 推文 §无网可用

**前置**：A3 真 LLM ship + vault 至少有 system-data-android 数据。

**5 场景** (推文 §"5 个生活场景")：
1. 飞机模式开，问"上周通讯录新增联系人" → 答 + citation
2. 飞机模式开，问"装了几个聊天 App" → 答 + citation
3. 切回 WiFi，问"我妈电话号码" → 同样答 (本地优先)
4. 飞机模式开，点 citation chip → bottom sheet 显事件原文
5. 飞机模式开，按销毁按钮 → 确认 → vault 真空 (重启验 0 events)

至少 3/5 通过为 A3.9 pass。失败 → 看 logcat `Timber LocalLlmServer/Engine`
+ `LocalCcRunner.ask: stdout` log。

### 2.3 D6.2 邮箱 4 家 IMAP 真接通 (~1d)

**UI 起点**：`EmailProvidersCard.kt` 4 张 disabled "v0.2 开放" 按钮，
onProviderLogin callback 等接通。

**任务**：
1. 新 `EmailCredentialsStore.kt` (EncryptedSharedPreferences AES-256-GCM)
   存 imapHost/port/user/password/provider (qq/gmail/netease163/outlook)
2. 新 `EmailCredentialsDialog.kt` Composable 表单 — IMAP host (自动填厂商
   默认 imap.qq.com:993 等) + user + password (or OAuth token)
3. 新 `EmailLocalCollector.kt` — OkHttp 反不行，IMAP 需 Jakarta Mail (java
   IMAP client)。`implementation("com.sun.mail:android-mail:1.6.7")` +
   `com.sun.mail:android-activation:1.6.7`。fetch INBOX → 解析 → 写
   snapshot.json
4. HubLocalViewModel 加 4 EmailCardState (qq/gmail/netease163/outlook 各
   独立 isLoggedIn/lastSyncAt 跟 BilibiliCardState 一样)
5. EmailProvidersCard 把 disabled 改成 onLogin → 弹 dialog → onSync → 调
   `LocalCcRunner.syncAdapter("email-imap", inputPath)`
6. testImpl `EmailLocalCollectorTest` mockwebserver IMAP fixtures

**坑警**：Gmail 走 OAuth XOAUTH2 不能直 IMAP user/pass — Gmail 列须特殊处理。
163 邮箱 IMAP 需用户先在 web 端启用 IMAP/SMTP + 客户端授权码。

### 2.4 D7.2 支付/购物 SAF 上传 (~0.8d)

**UI 起点**：`PaymentShoppingCard.kt` 2 张 disabled "导入 CSV/HTML" 按钮。

**任务**：
1. HubLocalScreen 加 `rememberLauncherForActivityResult(ActivityResultContracts
   .OpenDocument())` × 2 (一 CSV、一 HTML)
2. PaymentShoppingGroup onProviderImport callback 触发 launcher
3. 拿到 Uri → ContentResolver.openInputStream → 写到 filesDir/staging/
   `alipay-bill-<ts>.csv` → 调 LocalCcRunner.syncAdapter("alipay-bill",
   inputPath) / 同样 shopping-taobao

**支付宝 CSV 格式**：账单 → 右上 → 开具交易流水证明 → CSV 下载。
**淘宝 HTML 格式**：trade.taobao.com → 我的订单 → 保存网页 (mhtml or html)。

### 2.5 D8.2 出行 OAuth + 携程登录 (~1d)

**UI 起点**：`PaymentShoppingCard.kt` TravelGroup 2 张按钮。

**任务**：
1. 高德：注册 amap.com 开发者 → OAuth 应用 → redirect_uri → WebView 跳
   `https://lbs.amap.com/oauth/authorize?client_id=...` → 拦截 redirect
   → 拿 code → token endpoint → fetch /history-tracks API
2. 携程：cookie 路径同 bilibili — 复用 `SocialCookieWebViewScreen` +
   `CtripCredentialsStore` + `CtripLocalCollector`
3. JS adapter snapshot mode 在 packages/personal-data-hub/lib/adapters/
   travel-amap / travel-ctrip 已 ready，仅 in-APK cc bundle 验

### 2.6 D10.2 AI 助手 9 路 WebView (~1.5d)

**UI 起点**：`PaymentShoppingCard.kt` AiAssistantsGroup 9 张按钮。

**任务**：mechanical 复制 BilibiliCookieWebView pattern × 9。每平台：
- cookie 域名 (.doubao.com / .baidu.com / .moonshot.cn / dashscope.aliyun.com /
  chat.deepseek.com / chatglm.cn / yuanbao.tencent.com / qianfan.cloud.baidu.com /
  bots.bytedance.com)
- isLoginSuccess URL pattern 判断 (各厂商各异)
- 拿 cookie → AiChatCredentialsStore (复用 EncryptedSharedPreferences)
- LocalCcRunner.syncAdapter("ai-chat-history") 透传 vendor + cookie

PDH Phase 10.2 已 ship 8/9 厂商真接通 (DeepSeek/Kimi/通义/智谱/混元/千帆/扣子/
Dreamina)。豆包 + 文心 推文 promised but PDH 尚未；要么 D10.2 同步加 ai-chat-
history vendor wiring 8→10，要么坦诚改推文。

### 2.7 D11 SAF picker polish (~0.5d)

**当前**：导出走 `context.getExternalFilesDir(null)/exports/...`，用户用 File
Manager 拿走。

**任务**：升级为 `ActivityResultContracts.CreateDocument("application/x-sqlite3")`，
让用户选保存位置 + 文件名。HubLocalViewModel.requestExportVault 加 Uri 参数 →
exportToTemp → ContentResolver.openOutputStream(uri) 复制 → 删 temp。

### 2.8 真机 reimport 闭环验 (~0.3d)

把 Android 导出文件 `chainlesschain-vault-<ts>.db` 拷到桌面 → 桌面跑 `cc hub import-vault <path>`（`<path>` 是 .db 文件路径）→ 验证 events 数 + audit 历史 + 能 ask 出原 vault 中事件。

### 2.9 本机 audit screen (~0.5d, Win-startable)

**已有**：`LocalCcRunner.queryRecentAudit` API 设计 (Win session 写到一半被
中断，参考前文 §2 中 Edit 内容 — `AuditRow` + `RecentAuditResult` 已在
LocalCcRunner.kt 草稿中可重新 land)。

**任务**：
1. LocalCcRunner.queryRecentAudit (Win-doable, ~30 min)
2. HubLocalViewModel.AuditState (loading/rows/error) + refreshAudit
3. 新 `HubAuditCard.kt` (LazyColumn 简单卡，复用 SystemDataCard pattern)
4. HubLocalScreen 加 "操作账本" section + AuditCard

## 3. 文件清单 — Mac/Linux 续接所有改动点

```
android-app/app/build.gradle.kts                       # 加 kotlinllamacpp dep
android-app/app/src/main/java/com/chainlesschain/android/
├── di/LlmModule.kt                                    # Swap NoOp → 真 engine
├── pdh/llm/KotlinLlamaCppEngine.kt                    # 新 (A3.3 真 impl)
├── pdh/llm/EmailCredentialsStore.kt                   # 新 (D6.2)
├── pdh/llm/EmailLocalCollector.kt                     # 新 (D6.2)
├── pdh/llm/CtripCredentialsStore.kt                   # 新 (D8.2 携程)
├── pdh/llm/CtripLocalCollector.kt                     # 新 (D8.2 携程)
├── pdh/llm/AmapOAuthHelper.kt                         # 新 (D8.2 高德)
├── pdh/llm/AmapLocalCollector.kt                      # 新 (D8.2 高德)
├── pdh/llm/AiChatCredentialsStore.kt                  # 新 (D10.2)
├── pdh/llm/AiChatLocalCollector.kt                    # 新 (D10.2, 9 vendor 共享)
└── remote/ui/personalDataHub/
    ├── EmailCredentialsDialog.kt                      # 新 (D6.2)
    ├── HubLocalScreen.kt                              # 各 onProviderLogin 真接通
    ├── HubLocalViewModel.kt                           # 加 12+ provider card states
    ├── ThreeLocksCard.kt                              # D11 SAF picker wire
    └── HubAuditCard.kt                                # 新 (本机 audit, Win 可起)
```

## 4. 决策依据 — 不要重做

- **HTTP-Hybrid 架构**：Kotlin Ktor :18484 ↔ in-APK cc OllamaClient。已 verified
  SELinux 跨 cc subprocess 同 untrusted_app context loopback OK
- **Qwen2.5-1.5B-Q4_K_M (~1GB)**：米机 (Dimensity 7025-Ultra, 8GB) 安全位 8-15
  tok/s，0.5B 中文 RAG 边界，7B OOM
- **LlmInferenceEngine 接口抽象**：让 CI 编译不依赖 kotlinllamacpp JitPack 解
- **导出走 external-files-dir**：v0.1 简化 — D11.2 polish 升 SAF
- **24 张 provider 卡走 stateless Composable**：UI 端硬编码 provider list (匹配
  推文文字)，VM state 仅在 D6.2-D10.2 真接通时加

## 5. CI / 真机验路径

每个 Mac/Linux commit 后：
1. 等 `android-pr-check.yml` CI 绿 (≈ 12 min)
2. 真机：`gh run download <run_id> -n debug-apk` → `adb install -r app-
   debug.apk` → 开 ChainlessChain → 主屏点"本机数据" → 切到 tab 4 "本机提问"
3. logcat 跟 `adb logcat -s ChainlessChain LocalCcRunner LocalLlmServer
   HubLocalViewModel` 观察

## 6. 关联

- `docs/design/PDH_Article_Implementation_Plan.md` — 13d 总计划 (本 session
  ship 的 5.7d / 14d)
- `docs/design/PDH_A3_OnDevice_LLM.md` — A3 子设计 (HTTP-Hybrid 架构详图 + 10
  forward-looking traps)
- `docs/marketing/pdh-公众号推文-厦门场景.md` — 推文承诺源 (需求规格)
- memory `pdh_article_alignment_session.md` — 本 session 完整状态 snapshot
- memory `pdh_a3_skeleton_landed.md` — A3 skeleton ship 节点 + 工时表
- memory `pdh_plan_a_android_standalone_design.md` — Plan A v0.1 真机 verified
  主架构 (Xiaomi 24115RA8EC)
- memory `android_runas_loopback_selinux_split.md` — SELinux loopback OK 依据
- memory `android_cc_subprocess_execve_via_mksh.md` — LocalCcRunner spawn pattern

## 7. 推文承诺 final scorecard

| 推文段 | UI | Win-doable wire | 真机验 |
|---|---|---|---|
| 30 秒 1305 条 | ✅ | ✅ | ✅ 已 verified Plan A v0.1 |
| 加密金库 / 销毁 / 账本 | ✅ | ✅ | ⏳ E2E in §2.2 |
| 拒云开关 | ✅ | ✅ env + flag 双路径 | ⏳ §2.2 |
| 一键带走 | ✅ | ✅ external-files-dir | ⏳ §2.7 SAF polish + §2.8 reimport |
| 6 大类 / 19+ App UI | ✅ 24 卡全摆 | (per-类) | — |
| §邮箱 4 家真接通 | ✅ UI | ❌ (§2.3) | — |
| §支付/购物 真接通 | ✅ UI | ❌ (§2.4) | — |
| §出行 真接通 | ✅ UI | ❌ (§2.5) | — |
| §AI 助手 9 家真接通 | ✅ UI | ❌ (§2.6) | — |
| 大白话提问 + 给出处 | ✅ 全链路 | ❌ (§2.1 真 LLM) | ⏳ §2.2 |
| 无网可用 | ✅ 数据/加密/销毁 | (依赖 §2.1) | ⏳ §2.2 |
| iPhone 暂不可用 | ✅ (推文已坦诚) | ✅ | ✅ |
| root 完整版 | (并行 session WeChat WIP) | ❌ Phase 12.6 frida-dep | ⏳ |

剩 ~7-8d → Mac/Linux + 真机方能交付。本文档是续接 session 唯一入口，先读本文
+ memory 两份 → 再读 13d Plan + A3 Design → 然后逐 §推进。
