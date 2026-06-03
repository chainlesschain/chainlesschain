# Personal Data Hub — Android Standalone via in-APK cc CLI

> **状态**：v0.1 设计稿（2026-05-20）。这是 Phase 14 的**姊妹方向 Plan A**——与已落地的 [`Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](./Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md)（Plan B "手机 RPC 桌面"）并行存在、互补不互斥。Plan A 让 Android **完全脱离桌面进程**也能用 PDH：vault / Ollama / adapter pipeline 全部在手机本地跑，由 APK 内 bundled 的 `cc` CLI 驱动。
>
> **关联文档**：
> - 父：[`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md)（13-Phase 主架构 — `cc ui` 镜像桌面 wiring 的事实在此）
> - 姊妹：[`Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](./Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md)（Plan B 远程操控；Hub.ask 走 P2P DC）
> - 自然语言驱动：[`Cc_NL_Phone_App_Manager.md`](./Cc_NL_Phone_App_Manager.md)（本文档配套；NL → cc command → 数据/动作）
> - 依赖事实：APK bundled cc CLI 已 Xiaomi 24115RA8EC 真机验证（memory `android_local_terminal_phase_2_5.md`，`cc -v → 0.162.2` ✅）
>
> **要解决的问题**：用户问"安卓端可以不依赖桌面端实现 PDH 么？"答**可以**——但路径与已有 Phase 14 Plan B 完全不同，且未在任何现存设计稿覆盖。本文档系**首次为 Android 独立 PDH 模式**建立完整设计。

---

## 1. 背景

### 1.1 三种 PDH 部署形态

| 形态 | vault / LLM 位置 | 同步层 | 隐私 gate | 离线可用 |
|---|---|---|---|---|
| **桌面 Electron**（既有） | 桌面 SQLCipher / LLMManager singleton | 桌面 ipcMain handle | 桌面 `AnalysisEngine.isLocal` | ✅ 完全本机 |
| **`cc ui` 浏览器**（既有） | 桌面同目录 vault + OllamaClient | WS gateway | 同上 | ✅ 完全本机 |
| **手机 Plan B 远程操控**（Phase 14 已落） | 仍在桌面 | P2P DC RPC | 桌面 gate（手机被动继承） | ❌ 必须桌面在线 |
| **手机 Plan A 本机独立**（本文档） | Android filesDir 内置 vault.db + 端侧 LLM | Android 本机 ingest（cc android *） | Android 本机 gate | ✅ 完全本机 |

> 三种形态可**同机共存**（同 vault 文件 + WAL 锁串行化），用户可在桌面 ↔ 手机间无缝切换。Plan A 解决场景：用户在外 / 桌面没开机 / 完全不想买桌面 → 还能用 PDH。

### 1.2 为什么以前没做？三件事变了

1. **Android APK 已 bundle Node 25 + cc CLI npm pack**（Phase 2.5, 2026-05-19, `cc -v → 0.162.2` 真机验证）。在此之前手机端跑 Node.js 是"理论上可行 / 工程上 hack"。现在 hack 全收口（per memory 8 trap + 4 元 trap 已解）。
2. **personal-data-hub 包**本身**零桌面依赖** —— bridges 全 DI 注入（docs-site/personal-data-hub.md §架构 明文："Hub 包本身**不**依赖 cc 模块"）。换言之 `packages/personal-data-hub/lib/` 可以直接被手机端 cc 的 wiring 加载。
3. **端侧 LLM 选项成熟**：qwen2.5:1.5B-instruct (~1GB Q4_K_M) / phi-3.5-mini (~2GB) 等 1.5-3B 模型在 8GB RAM Android 上能 ~5-15 tok/s 跑，覆盖"问昨天我妈打了几个电话"这类摘要 query 够用。重型分析（Phase 11 月度报告）走 opt-in 远程 API key（OpenRouter / DeepSeek）路径。

### 1.3 Plan A vs Plan B 不是替代，是组合

| 用户场景 | 推荐路径 |
|---|---|
| 桌面在线 + 手机轻量 query | Plan B（手机发问 → 桌面推理 → 答案回手机，敏感数据零离开桌面） |
| 桌面离线 / 户外 / 通勤 / 旅行 | Plan A（手机自给自足；端侧 LLM 处理摘要类） |
| 大型跨源分析（"今年消费总览"） | Plan B + 桌面 Ollama 70B / 远程 vLLM |
| 想完全脱离桌面（手机即全部） | Plan A 单跑 |
| 桌面 + 手机 vault 双副本（极端隐私偏好） | Plan A 跑手机 vault + 走 [[Phase 3d Mobile Sync]] 路径反向同步回桌面（v0.3 范围） |

---

## 2. 目标 & 非目标

### 2.1 目标（Plan A v0.1 in scope）

| # | 项 | 验收 |
|---|---|---|
| G1 | Android 端 cc 可加载 personal-data-hub 包并起 hub（不需桌面进程） | `cc hub health` 在 Android 终端跑返回 `{ vault.ok: true, llm.ok: true (端侧或远程 API), kgSink.ok, ragSink.ok }` |
| G2 | vault.db 落在 Android filesDir `.chainlesschain/hub/`，0600 权限（owner-only，App sandbox 自然保证） | `ls -la $PREFIX/../files/.chainlesschain/hub/` 见 vault.db / vault.key |
| G3 | 端侧 LLM 集成 — 优先嵌 llama.rn / mlc-llm 本地推理；fallback 用户 API key（OpenRouter 兼容 OpenAI API） | `cc llm provider llama-rn` + `cc llm test "你好"` 返回中文应答 ≤ 30s |
| G4 | 至少 6 个 Adapter 可在手机本地跑 — SystemData（手机自己的通讯录/通话/短信，**ContentResolver 直读**而非 ADB pull）+ Email IMAP + Alipay ZIP import + 3 个 Social Adapter（Bilibili / Weibo / Douyin 借 sjqz parser，Android 路径） | `cc android contacts pull && cc hub ingest system-data` → vault.events += 通讯录条数 |
| G5 | Adapter 注册流程 — IMAP 授权码 / Alipay ZIP 密码 / Cookie 用 Android Intent + Activity 输入（避免长串 base64 在终端输） | `cc android intent input-text "authCode"` ↔ Activity callback → `email-accounts.json` 落盘 |
| G6 | 隐私 gate 移植 — 手机本地 LLM 始终视为 local；远程 API key 路径 default `acceptNonLocal=false`；显式 opt-in 走 `cc config llm.acceptNonLocal true` 或 ask 时传 flag | 远程 API key 下 `cc hub ask "..."` 返回 `error: Non-local LLM blocked` |
| G7 | 跨 app sandbox 读取分级机制 — 不强制 root，分 5 路径（见 §5），用户自选 | 非 root 设备至少能拉 ContentResolver + SAF 三类（通讯录/短信/通话 + 用户授权目录） |
| G8 | NL 入口（自然语言驱动）— 整合 [`Cc_NL_Phone_App_Manager.md`](./Cc_NL_Phone_App_Manager.md) — 用户在 Android in-app terminal 说"把昨天的微信记录拉到 hub 里" → 端侧小 LLM 解析 intent → 触发 `cc android root exec wechat-pull` 或 `cc hub ingest wechat`（视设备 root 状态自动选路径） | 真机：rooted Xiaomi 24115RA8EC 跑 "把抖音上周点赞的拉到 hub" → 自动 ingest → `cc hub ask "上周我在抖音点赞了哪些视频"` 返回列表 |
| G9 | cc ui 在 Android 内 BrowserView 加载 web-panel SPA — 复用既有 `cc ui` → http://localhost:7331/ 走桌面已有 web-panel，不再需要 BrowserActivity 自己写 Vue UI | 真机：`cc ui` 起 server，Android WebView intent 自动开 `localhost:7331` → 见完整 PDH 4 卡片 + ask box |

### 2.2 非目标（defer 到 Plan A v0.2+）

- **iOS 本机独立** — iOS 没 in-app terminal / 没 Node bundle 路径；继续走 Phase 14 Plan B。Plan A v0.1 **仅 Android**。
- **手机端跑 Ollama HTTP server** — 太重；llama.rn 直接 process-internal call。需要 HTTP 兼容时再加 reverse proxy。
- **手机端运行 Python sidecar**（Phase 4.5 forensics-bridge） — Termux Python 可装，但子进程权限受 W^X 限制；Plan A v0.1 把 SystemData adapter 改走 Java ContentResolver 直读（手机自己的通讯录不需要 sidecar 法医级解析）。
- **跨 app sandbox 非 root 全访问** — 无解；非 root 设备只能 ContentResolver + SAF + Accessibility 三路径，其它 app 内部 SQLite 不可达。
- **真正的 vault 多副本 P2P 同步**（手机 vault ↔ 桌面 vault 双向 sync） — 复杂，需 vector clock 或 CRDT；v0.3 范围，复用 [[Phase 3d Mobile Sync]] 13 sync.* topic 范式。
- **Frida 注入** — root 设备走 `cc android root exec` shell 路径 + `magisk` / `frida-server` 可 opt-in，但不 bundle frida-server 到 APK。
- **APK 体积膨胀** — 当前 244MB universal 已含 Node 25 (~80MB)；加 1.5B 量化模型 (~1GB) 走 **on-demand download from CDN**（首次 `cc llm pull qwen2.5:1.5b` 拉到 filesDir）而非 APK 内置。

### 2.3 假设（Assumption — 若不成立，重新设计）

- **A1**：APK bundled cc 真能加载 npm-installed `@chainlesschain/personal-data-hub` 包。验证：`cc -e "require('@chainlesschain/personal-data-hub').LocalVault"` 在 Android 终端不报 ERR_MODULE_NOT_FOUND。
- **A2**：better-sqlite3-multiple-ciphers 在 Android arm64 prebuild 存在或可现场编译。验证：`cc hub init` 能 open vault.db 加密。
- **A3**：llama.rn 在 8GB RAM Android 跑 1.5B 模型不 OOM、首 token ≤ 5s。
- **A4**：ContentResolver 跨进程读自己设备通讯录 / 短信 / 通话需要 runtime permission，**用户必须在 app 设置里授权**。

---

## 3. Open Questions

### OQ-1: LLM 部署形态

**A.** llama.rn embedded（推荐）— APK 内集成 React Native 桥的 llama.cpp，process-internal 调用。优点：零额外端口 / 启动快 / 离线绝对可用。缺：APK ~+20MB（库），模型走 CDN 拉。

**B.** Termux Ollama — 在 Android 内 ollama binary，HTTP 服务 localhost:11434。优点：和桌面 OllamaClient 协议 100% 一致，零 cli 改动。缺：内存压力大 + 启动慢 (~30s 加载模型)。

**C.** 远程 API only — 不端侧 LLM，所有 ask 走用户自带 OpenRouter/DeepSeek key（acceptNonLocal=true）。优点：APK 小 + 算力外移。缺：完全违背"数据回归个人"哲学，仅做 fallback。

**推荐：A 起步 + C fallback**。B 留作 v0.2 power user 路径。

### OQ-2: 跨 app 数据访问授权模型

**A.** 强制 root — 简化，要求用户 Magisk + frida-server；非 root 设备直接拒绝运行 cross-app adapter。优：实现简单。缺：用户基数小。

**B.** 渐进式分级（推荐）— 启动检测设备状态：root / Shizuku / Accessibility / 仅 ContentResolver，UI 显示可用 adapter 子集。优：覆盖全用户。缺：5 路径都得测，工时 ×3。

**C.** 强制 Shizuku — 要求用户装 Shizuku app。优：比 root 友好。缺：仍需用户配置 + Shizuku 不是所有 ROM 都装得上。

**推荐：B**。把"哪些 adapter 在你设备能用"作为首屏体验。

### OQ-3: NL 解析层放哪

**A.** 端侧 LLM 解析 intent（推荐）— 用户说"拉昨天微信" → 1.5B 模型输出 `{intent: 'ingest', adapter: 'wechat', since: 'yesterday'}` → cc 执行。

**B.** 规则正则匹配 — 写一套中文短语 → cc 命令 grammar。优：零 LLM 依赖。缺：用户用错词就匹配不到。

**C.** 混合 — A 兜底 + B 快速路径（"健康检查" / "停止同步"这类高频短语直接走 B 跳 LLM）。

**推荐：C**。详见 [`Cc_NL_Phone_App_Manager.md`](./Cc_NL_Phone_App_Manager.md) §4。

### OQ-4: vault 主密钥 Android 平台 keystore 集成

**A.** FileKeyProvider（沿用桌面 Phase 3.5b）— `keys/vault.key` 0600 文件，App sandbox 自然隔离同机其它 app。优：复用桌面代码 0 改。缺：root 设备同机有 root 即全失守。

**B.** Android Keystore + StrongBox（推荐 v0.2）— 主密钥用 AES-GCM 包裹在 Android Keystore，要求生物认证 unwrap。优：硬件级安全。缺：cc CLI 跨进程读 keystore 需要 Java JNI 桥，工程量大。

**C.** SIMKey 集成 — 既有 SIMKey adapter 加固主密钥。优：终极防护。缺：APK 体积 + 大多用户没 SIMKey。

**推荐：A v0.1 起步 + B v0.2 升级**。SIMKey 仍是 v1 路线。

### OQ-5: web-panel UI 在 Android 端怎么呈现

**A.** `cc ui` 起 localhost:7331 + Android WebView intent 打开（推荐）— 复用 packages/web-panel/dist 整套 SPA 零改动。优：UI 一致。缺：WebView 性能 / Android 9+ cleartext localhost 需 networkSecurityConfig 白名单。

**B.** 写一套原生 Compose UI 镜像 web-panel — 复用 PersonalDataHubScreen 等既有 Android UI scaffold（Phase 14.1 已落）。优：原生体验。缺：双套 UI 维护。

**C.** Termux:GUI / 第三方 web 浏览器打开 localhost — 用户自选浏览器。优：零集成。缺：UX 差。

**推荐：A 主路径 + B 已有的 Phase 14.1 scaffold 保留作为终端外快捷入口**。

---

## 4. 架构

### 4.1 分层视图

```
┌─────────────────────────────────────────────────────────────┐
│ 用户层（Android in-app terminal / WebView / Compose UI）     │
│  - Termux-style PTY: cc 命令 + NL 输入                       │
│  - WebView: localhost:7331 (cc ui)                           │
│  - Compose: PersonalDataHubScreen (Phase 14.1 既有)         │
└─────────────────┬───────────────────────────────────────────┘
                  ↓ (NL → cc command resolution by Cc_NL_Phone_App_Manager.md)
┌─────────────────────────────────────────────────────────────┐
│ cc CLI (Android in-APK bundle, Node 25 / Termux $PREFIX)    │
│  - cc hub ask/health/stats/ingest/...                       │
│  - cc android contacts/sms/calls/app/fs/a11y/root           │
│  - cc llm pull/test/provider                                │
│  - cc ui (起 localhost:7331)                                │
└─────────────────┬───────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────────────┐
│ Hub Core (require('@chainlesschain/personal-data-hub'))     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ LocalVault (better-sqlite3-multiple-ciphers Android │   │
│  │   prebuild → filesDir/.chainlesschain/hub/vault.db) │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ AnalysisEngine│ │ AdapterRegistry│ │ EntityResolver│     │
│  │  LLM = LlamaRnAdapter (新) │ │（既有，零改动） │（既有，零改动） │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────┬───────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────────────┐
│ Adapter 层（Android-aware variants）                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ SystemData ✨│ │ Email IMAP ✅│ │ Alipay ZIP ✅│         │
│  │ (改 sidecar →│ │  (Node net   │ │  (Node fs +  │         │
│  │  ContentResolv│ │   socket，原 │ │   sqlcipher，│         │
│  │   via JNI)   │ │   样)        │ │   原样)     │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Bilibili ✨  │ │ Weibo ✨    │ │ Douyin ✨    │         │
│  │ (path: Android│ │              │ │              │         │
│  │  /sdcard/Android│ │              │ │              │         │
│  │  /data/<pkg>)│ │              │ │              │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐                          │
│  │ WeChat 🔒    │ │ QQ 🔒       │  (rooted 设备：su read +   │
│  │ (rooted 才能 │ │              │   既有 sqlcipher parser) │
│  │   读 /data/  │ │              │                          │
│  │  data/<pkg>) │ │              │                          │
│  └──────────────┘ └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘

  ✨ = 路径与桌面不同（Android-specific），代码复用桌面 parser
  🔒 = 需要 root
  ✅ = 桌面 adapter 0 改动复用
```

### 4.2 关键模块改动

| 模块 | 改动 | 工作量 |
|---|---|---|
| `packages/personal-data-hub/lib/llm-client.js` | 新增 `LlamaRnAdapter` class — 通过 cc 内 JNI bridge 调 llama.rn so，实现 LLMClient 契约（`chat({messages, options}) → {content, model, isLocal: true}`） | 0.5d + JNI 桥 1d |
| `packages/personal-data-hub/lib/adapters/system-data-android.js` | 新 adapter — ContentResolver 路径，不走 Python sidecar；Android-only `os.platform() === 'android'` 时优先 | 1d |
| `packages/cli/src/lib/personal-data-hub-wiring.js` | Android 分支：检测 `process.env.PREFIX === '/data/data/.../files/usr'` → 自动选 LlamaRnAdapter；vault 目录从 `os.homedir()` 改 `process.env.HOME` (Termux 已设) | 0.5d |
| `packages/cli/src/commands/android.js` | **新文件** — `cc android contacts pull/sms pull/calls pull/app list/app launch/fs read/a11y query/root exec` 8 子命令；通过 cc-android-bridge.so JNI 调 Java API | 3d |
| `android-app/app/src/main/java/com/chainlesschain/android/ccbridge/CcAndroidBridge.kt` | **新文件** — JNI native lib 暴露 Java API 给 cc Node 端 (ContentResolver / PackageManager / AccessibilityService client / Runtime.exec) | 2d |
| `android-app/app/src/main/java/com/chainlesschain/android/llamarn/LlamaRnBridge.kt` | **新文件** — llama.rn 包装 (load gguf model / generate tokens / streaming callback) | 2d |
| `packages/cli/src/commands/llm.js` | 加 `cc llm pull <model>` — 从 CDN 拉 gguf 到 filesDir；progress bar | 0.5d |

总工时估：**~10-12d**（含 JNI 桥 + native lib 集成）。

### 4.3 数据目录（Android filesDir 完整布局）

```
/data/data/com.chainlesschain.android/files/usr/      ← Termux $PREFIX (cc CLI 已在此)
                                          ../        ← Android filesDir
                                          .chainlesschain/
                                            hub/
                                              vault.db                    SQLCipher AES-256
                                              vault.db-wal, vault.db-shm
                                              keys/
                                                vault.key                 0600 (App sandbox 自然保证)
                                              email-accounts.json         0600
                                              alipay-accounts.json        0600
                                              cookies/                    Cookie adapter 凭据
                                                taobao.json
                                                ...
                                              models/                     llama.rn gguf 缓存
                                                qwen2.5-1.5b-instruct-q4_k_m.gguf
                                              audit.jsonl                 (vault 内部表，此处仅作 export 目标)
                                          .chainlesschain/
                                            config.json                   (cc config)
```

### 4.4 同机存在多个 vault？

**v0.1 不支持双 vault 同机**。

理由：手机 cc 与桌面 cc 不会共享 vault 文件（不同机器）；同台 Android 上 in-app cc 与 Termux 外部 cc（如果用户装了 Termux 应用）会**共享 Android filesDir 路径** — 但 Android App sandbox 默认隔离 `/data/data/<pkg>/files/`，外部 Termux 读不到 ChainlessChain App filesDir。

**v0.2 跨 vault sync**走 [[phase-3d-mobile-sync]] 范式。

---

## 5. 跨 App 数据访问 5 路径矩阵

> 这是 Plan A 的核心难点 — 非 root Android 跨 app sandbox 限制让"用 cc 拉其它 app 数据"变成 5 条互不重叠路径。

| 路径 | 适用数据 | 权限 | 实现 | 用户摩擦 |
|---|---|---|---|---|
| **P1. ContentResolver** | 用户自己的通讯录 / 短信 / 通话 / 日历 / 媒体库 | runtime permission（READ_CONTACTS / READ_SMS / READ_CALL_LOG / 等） | `cc android contacts pull` → JNI 调 `getContentResolver().query()` → JSON → ingest | 低（首次弹系统授权 dialog） |
| **P2. Storage Access Framework (SAF)** | 用户主动授权的目录（"我授权你读 /sdcard/Download/alipay_bill_xxx.zip"） | 用户 picker 选 directory tree URI | `cc android fs read --tree <uri>` → 任意 zip / csv → 走既有 alipay-bill adapter | 中（每个目录用户 picker 选一次） |
| **P3. Accessibility Service** | 屏幕上**可见**的文本 / 节点 / 按钮 — 几乎所有 app 的 UI 可读 | 用户开 Accessibility Service 授权 | `cc android a11y query` → 屏幕节点树 JSON；`cc android a11y click <node>` 模拟点击 | 高（Accessibility 授权用户警惕，必须明示用途） |
| **P4. Shizuku ADB-like 权限** | 部分 system API（包括读 logcat / 启动隐藏 Activity / pm install） | 用户装 Shizuku app + ADB 启动或 root | `cc android shizuku exec <cmd>` | 高（用户需另装 Shizuku） |
| **P5. Root + su exec** | 跨 app sandbox 全访问（/data/data/<pkg>/） | Magisk root | `cc android root exec "cp /data/data/com.tencent.mm/MicroMsg/.../EnMicroMsg.db /sdcard/cc-staging/"` → 走既有 wechat adapter | 极高（root 设备占比小） |

### 5.1 启动时设备能力探测

`cc android caps` 命令首启执行：

```
┌─ 设备能力探测 ─────────────────────────────────┐
│ ✅ ContentResolver        - 已授权: contacts, sms │
│ ⚠️  ContentResolver        - 未授权: call_log    │
│ ✅ SAF                    - 已授权 2 个目录       │
│ ❌ Accessibility Service  - 未启用                │
│ ❌ Shizuku                - 未安装                │
│ ❌ Root (su)              - 不可用                │
│                                                  │
│ 可用 Adapter (6/22):                            │
│   ✓ system-data-android (P1)                    │
│   ✓ alipay-bill (P2 拖 zip)                    │
│   ✓ email-imap (网络，不需本机授权)             │
│   ✓ ai-chat-history-* (cookie，需先在 WebView   │
│                        登录拦截 cookie，复用桌面 │
│                        Phase 10.3 模式)         │
│   ✓ social-bilibili (P2 SAF 选 app 数据目录)    │
│   ✗ wechat (需 P5 root)                         │
└──────────────────────────────────────────────────┘
```

### 5.2 每个 adapter 的路径选择映射

| Adapter | 非 root 路径 | rooted 路径 |
|---|---|---|
| SystemData | P1 ContentResolver ✅ | P1（root 无优势） |
| Email IMAP | 网络，免 | 网络，免 |
| Alipay ZIP | P2 SAF（用户拖 zip 进 cc） | P2 |
| Shopping (Taobao/JD/Meituan) | WebView 登录 + cookie 拦截（Plan B 现有 Phase 10.3 模式移植到 Android in-app WebView） | 同 |
| Travel (Amap/Baidu Map/Ctrip/12306) | 同 shopping 路径 | 同 |
| AIChat × 9 厂商 | 同 shopping 路径 | 同 |
| Bilibili / Weibo / Douyin / Xiaohongshu | P2 SAF — 用户授权 `/sdcard/Android/data/<pkg>/` | P5 — `/data/data/<pkg>/` 直读（含未登录设备 cache） |
| QQ / Telegram | P5 必需（加密 SQLite + 密钥派生需 frida 或 hook） | P5 root exec |
| WhatsApp | P2 — `/sdcard/WhatsApp/Databases/msgstore.db.crypt14`（用户可见目录） | P5 |
| WeChat | ❌ 不可用（Android 8.0+ libwcdb hook 需 frida） | P5 + frida-dep 路径（v0.2） |

---

## 6. cc 命令矩阵（Android-specific 新增）

> 详细 NL 触发逻辑与命令组合见 [`Cc_NL_Phone_App_Manager.md`](./Cc_NL_Phone_App_Manager.md)。本节列**命令本身的 contract**。

### 6.1 `cc android` 子命令（新文件 `packages/cli/src/commands/android.js`）

| 命令 | 入参 | 出参 | 权限 |
|---|---|---|---|
| `cc android caps` | — | YAML 设备能力报告（§5.1） | 免 |
| `cc android contacts pull [--since <ms>]` | `--since` 增量水位 | `{ ingested: N, events: [...] }` | runtime READ_CONTACTS |
| `cc android sms pull [--since <ms>]` | 同上 | 同上 | READ_SMS |
| `cc android calls pull [--since <ms>]` | 同上 | 同上 | READ_CALL_LOG |
| `cc android app list [--system]` | `--system` 含系统 app | `[ { pkg, label, version, installedAt } ]` | 免 |
| `cc android app launch <pkg>` | pkg | `{ ok }` | 免 |
| `cc android app intent <pkg> <action> [--extras k=v]` | pkg + action + extras | `{ ok }` | 免 |
| `cc android fs read <path-or-uri>` | SAF tree URI 或绝对路径（仅 sandbox 内可用绝对路径） | 文件内容 bytes | SAF 用户授权 |
| `cc android fs list <path-or-uri>` | 同上 | `[ { name, isDir, size, mtime } ]` | 同 |
| `cc android a11y query [--filter <css-like>]` | filter | 节点树 JSON | Accessibility Service 启用 |
| `cc android a11y click <node-id>` | node id | `{ ok }` | 同 |
| `cc android a11y type <text>` | text | `{ ok }` | 同 |
| `cc android shizuku exec <cmd>` | shell command | stdout/stderr | Shizuku 启动 |
| `cc android root exec <cmd>` | shell command | stdout/stderr | su 可用 |
| `cc android perms <perm>` | permission name | `{ granted: bool }` — granted=false 时自动弹 runtime dialog | — |

### 6.2 `cc hub` 在 Android 下的语义（既有命令 zero-change）

既有 `cc hub ask` / `cc hub stats` / `cc hub health` / `cc hub ingest <adapter>` / `cc hub list-adapters` 等命令**零改动复用** — wiring 在 §4.2 改了 LLM/vault 路径，命令层看不出 Android vs 桌面区别。

### 6.3 `cc llm` 在 Android 下的扩展（既有命令加 Android-aware）

| 命令 | Android 行为 |
|---|---|
| `cc llm provider llama-rn` | 切到端侧（默认） |
| `cc llm provider openrouter --key sk-...` | 切到远程 API（acceptNonLocal 隐式 false，调 hub.ask 仍会被 gate 拒；用户必须显式 `cc config llm.acceptNonLocal true` 或单次 `--accept-non-local`） |
| `cc llm pull <model>` | 从 CDN（`https://models.chainlesschain.com/<model>.gguf`）拉到 `$FILES/.chainlesschain/hub/models/` |
| `cc llm test "<prompt>"` | 跑一次推理 + 显 tok/s |

### 6.4 NL 入口 `cc nl <natural-language>`

新顶层命令（详见配套设计稿）：

```bash
cc nl "把昨天的微信记录拉到 hub 里"
cc nl "上周抖音点赞了哪些视频"
cc nl "停掉同步"
cc nl "我妈生日那周买了啥送哪儿"
```

---

## 7. Sub-Phase 拆分

> **2026-05-20 校准**：原 §7 工时估值基于"自编 Android arm64 prebuild"的假设。2026-05-20 验证（参见本文档同日 update + memory `pdh_plan_a_android_standalone_design`）发现 **两件事让 A2 大幅简化**：
> 1. **Termux 有 `nodejs-lts` 兄弟包，当前 v24.15.0** — 与 `nodejs`(v26.1.0) 并行存在；切包名即可锁 Node ABI 24
> 2. **better-sqlite3-multiple-ciphers v12.9.0 上游已发 Node 24 ABI (v137) `linuxmusl-arm64` + `linux-arm64` prebuild** — 直接 `gh release download` 即可，无需自编 NDK 工程
>
> 据此修订：A2 从 ~1d 自编升到 **~1.5-2d** 接现成 prebuild + patchelf；总工时 ~16d 降到 **~6-9d**（串行）。

| Sub-Phase | 主题 | 关键产出 | 测试 | 工时 |
|---|---|---|---|---|
| **A1** | Android cc 加载 PDH 包 (validate A1 假设) | 在 Android 终端 `cc -e "const {LocalVault} = require('@chainlesschain/personal-data-hub'); console.log(LocalVault)"` 不报错 — A1 验证已落 2026-05-20（vault.js loadDriver 显式 lazy require，顶层不触发 native binding，pure CJS） | A1 桌面端验证 ✅ done | 0d（已验） |
| **A2.0** | Termux Node 包名 pin nodejs-lts (v24.x) | `node-runtime-bundle.yml` `PKGS=` `nodejs` → `nodejs-lts` 切换 + commit message 同步 | CI workflow_dispatch run 通过 + nodejs-lts .deb 实际拉到 + libnode.so strings 见 v24.x | **0.5h ✅ 落** (2026-05-20 commit) |
| **A2.1** | ~~上游 prebuild 注入~~ (dry-run 证伪, 见 trap 2) | 已落但被验出不可用 — 上游 musl/glibc 两个 prebuild 的 DT_NEEDED 全 Bionic 不兼容；留作 v2 候选（上游加 android-arm64 prebuild 时回归）| dry-run on Win desk 验失败 ❌ | 0d（设计纠正） |
| **A2.2** | **NDK self-compile bs3mc Android arm64 from source** | (1) CI 装 NDK r26+；(2) `cd /tmp/cc-cli-hydrate/package/node_modules/better-sqlite3-multiple-ciphers && node-gyp configure --target_arch=arm64 --target_platform=android` + 设 ANDROID_NDK / CXX = ndk arm64 clang；(3) `node-gyp build`；(4) patchelf rename `libc++_shared.so` → `libtermux_cxx.so`；(5) Termux Docker / 真机 dlopen test | (a) NDK build 出 .node；(b) DT_NEEDED 仅 `libc.so` + `libtermux_cxx.so`；(c) 真机 `require('better-sqlite3-multiple-ciphers')` 不炸；(d) 真机 `new LocalVault({...}).open()` 成功 | **2-3d** |
| **A3** | LlamaRnBridge.kt + JNI native lib | `cc llm test "你好"` 在 Android 终端返回 ≤ 30s | 单测 + 真机 1 prompt 跑通 | 2-3d |
| **A4** | LlamaRnAdapter（lib/llm-client.js 加 class） | hub.ask 在 Android 端走端侧推理 | 单测 + 真机 ask 一句 | 0.5d |
| **A5** | personal-data-hub-wiring Android 分支 | Android 进程起 hub 不需桌面 LLMManager | 单测 mock + 真机 init | 0.5d |
| **A6** | CcAndroidBridge.kt JNI 桥（ContentResolver + PackageManager + Runtime.exec） | `cc android contacts pull` 返 N 条 event | JNI 单元测 + 真机 | 2d |
| **A7** | `cc android` 子命令文件 (8 命令) | 全 8 命令 happy path 走通 | unit ≥ 16 (1 happy + 1 error per cmd) | 1.5d |
| **A8** | SystemData Android variant (ContentResolver path) | adapter 接入 registry，sync 时自动选 ContentResolver vs sidecar | 单测 + 真机 ingest 通讯录 | 1d |
| **A9** | 4 个 cookie/SAF adapter Android 变种 (Bilibili / Weibo / Douyin / Xiaohongshu — SAF 路径) | 用户授权后 ingest 真实数据 | 真机 4 adapter smoke | 1.5d |
| **A10** | `cc android caps` + 启动设备探测 | 首启 yaml 报告 | 单测 mock 5 设备状态 | 0.5d |
| **A11** | `cc android a11y` + Accessibility Service stub | a11y query 屏幕 root 节点 | 真机 | 1d |
| **A12** | `cc android root exec` + Magisk 检测 | rooted 设备能跑 su | 真机 rooted Xiaomi | 0.5d |
| **A13** | WebView intent 集成 `cc ui` localhost:7331 | Android App 内置 BrowserActivity 自动开 localhost | 真机 | 0.5d |
| **A14** | 真机 E2E（8 场景）— 见 §8.1 | 8 场景全跑通 | 真机 Xiaomi 24115RA8EC + 1 非 root 设备 | 1.5d |

**Plan A v0.1 总工时**（2026-05-20 二次校准 — dry-run 后）：
- 串行总：~15-16d
- critical-path (A2.2 NDK → A3 LlamaRn → A4 → A5)：~6-7d
- A6-A14 大量可并行 → wall clock **~7-10d**（前提 LlamaRn 与 JNI 桥并行）

**Critical-path 重排**（2026-05-20 二次校准）：
- ✅ **A1 已验**：personal-data-hub 包对 Android Node 加载零障碍
- ✅ **A2.0 已落**：nodejs-lts 切换 commit
- ❌ **A2.1 被 dry-run 证伪**：上游 prebuild 不可用，原设计 trap 2.6 假设错
- 🔓 **A2.2 是真 single point of failure**（2-3d）— NDK self-compile bs3mc from source；落地后 vault 在手机可 open
- 🔓 **A3 (LlamaRn)** 才是后续大头（2-3d）— 端侧 LLM
- 之后 A6-A14 大量可并行，单人 ~5d 串行收口

---

## 8. 真机 E2E 8 场景

### 8.1 验收矩阵

| # | 场景 | 设备 | 验收 |
|---|---|---|---|
| E1 | 通讯录拉取 + ask | Xiaomi 24115RA8EC（rooted）+ 1 台 Android 14 非 root | `cc android contacts pull` → ingested ≥ 100 → `cc hub ask "我有几个联系人"` 返回正确数字 |
| E2 | 短信全文搜索 | 同 | `cc android sms pull --since <ms>` → `cc hub ask "上个月谁给我发过验证码"` 返回 < 5s |
| E3 | 端侧 LLM 推理 | 同 | `cc llm test "用一句话总结今天天气"` ≤ 30s 出中文文本 |
| E4 | Alipay ZIP 导入（SAF） | 同 | 用户在 SAF picker 选 `/sdcard/Download/alipay_bill_2026Q1.zip` → `cc hub ingest alipay-bill` → SyncReport |
| E5 | Bilibili 历史（SAF + sjqz parser） | 同 | SAF 授权 `/sdcard/Android/data/tv.danmaku.bili/` → `cc hub ingest social-bilibili` → 见 ingested |
| E6 | 微信 SQLCipher 读（rooted） | 仅 Xiaomi | `cc android root exec "cat /data/data/com.tencent.mm/.../EnMicroMsg.db" > stage` → 既有 wechat adapter parse → ingested |
| E7 | Accessibility "我点的是哪个微信好友" | Xiaomi | 用户在微信打开聊天 → `cc android a11y query` 返回节点树含好友名 |
| E8 | NL 触发 ingest | Xiaomi | `cc nl "把今天的通讯录改动同步到 hub"` → cc 端侧 LLM 解析 intent → 触发 `cc hub ingest system-data` → 见 SyncReport |

### 8.2 已知不可验收（v0.1 范围外）

- iOS Plan A — 不存在，iOS 走 Plan B
- 跨手机 vault 同步 — v0.3
- 端侧 70B / 14B LLM — 算力不足
- 自动注册 Adapter 向导（手机端输 IMAP 授权码 8 位串太痛） — v0.2 加复制粘贴 + QR 扫码

---

## 9. Forward-looking Traps

1. **A1 假设若不成立** — Android cc 加载 personal-data-hub 包失败（commonjs 解析路径 vs ESM / asar-like 困局）。**2026-05-20 已验 ✅** — `package.json` `"type": "commonjs"`，lib/index.js 全 `require()`，vault.js 显式 `loadDriver()` lazy require（line 47-61）顶层 require 不触发 native binding。Plan A 第一道闸门已绿。

2. **better-sqlite3 Android arm64 prebuild — 上游 prebuild 不可直接用 (2026-05-20 dry-run 验出)** —
   原计划：用上游 GH release `node-v137-linuxmusl-arm64.tar.gz` (musl) 或 `linux-arm64.tar.gz` (glibc) prebuild + patchelf 适配 Bionic。
   **dry-run 实测真相**（DT_NEEDED 扫描）：
   - **musl prebuild**：依赖 `libc.musl-aarch64.so.1` + `libstdc++.so.6` — 两个 SONAME 在 Android Bionic / Termux `$PREFIX/lib` 都不存在；patchelf rename 不能修 C++ exception ABI（libstdc++ vs libc++） + Bionic 不同的 pthread/TLS 函数签名。
   - **glibc prebuild**：依赖 `libc.so.6` + `libm.so.6` + `libpthread.so.0` + `libstdc++.so.6` — 同样全 Bionic 不兼容。
   - Termux apt **没有 libstdc++ 包**（只有 LLVM libc++ = `libtermux_cxx.so`），所以即便手 ship libstdc++ 也不可持续维护。
   **真实 B.1 = NDK self-compile from source in CI** (~2-3d)：
   1. CI 装 Android NDK r26+；
   2. `node-gyp configure --target_arch=arm64 --target_platform=android --nodedir=<termux Node header dir>`；
   3. 提供 Bionic `libc.so` + LLVM `libc++_shared.so` 作 link target；
   4. 输出 .node DT_NEEDED 仅含 `libc.so` + `libc++_shared.so`；
   5. patchelf rename `libc++_shared.so` → `libtermux_cxx.so`（与 Phase 2.5 libnode.so 同套路）。
   `node-runtime-bundle.yml` 当前 commit (2026-05-20) 已落"试用上游 musl prebuild"分支但被 dry-run 证伪 — 留作 v2 候选（当上游加 `android-arm64` prebuild 矩阵时直接生效，那时不再需 NDK 自编）。

2.5. **Termux nodejs 包默认 v26 不在 better-sqlite3 engines.node 白名单内**（`"20.x || 22.x || 23.x || 24.x"`，无 25/26）。Mitigation: workflow `PKGS="nodejs ..."` 改 `PKGS="nodejs-lts ..."` 锁定 Node 24.15.0；这是 Termux 平行 LTS 兄弟包，currently tracks Node 24 LTS。**Trap 锁警**：若未来 Node 26 进 LTS，Termux 会把 nodejs-lts 升 26 — 那时再换为 `nodejs-current` 的 24.x 钉版本 / 或手动钉 deb URL。这条改动已落 (2026-05-20)。

2.6. **dry-run 前先扫 prebuild SONAME** — 任何外部 prebuild 注入流程，第一步必须 `strings | grep '\.so' | sort -u`（或 readelf -d，Win 无 readelf 用 PowerShell regex 扫 binary 字串）确认 DT_NEEDED 在目标平台 lib 集合内。Plan A 本次 dry-run 在 15 分钟内省了 2d CI 翻车（先在 Win 桌面验，比起 commit→push→workflow run→真机测的 round-trip 短 100×）。把这个工作模式编进 Plan A v0.2 workflow ops checklist。

3. **llama.rn JNI 桥 token streaming → cc stdout 缓冲死锁** — 已在 [[android_remote_terminal_plan_a_diagnosis]] 见过 stdio JSON-lines 缓冲坑。Mitigation: 桥层用 chunk-flush 协议，每 token 一次 flush；cc 端按 LF 分流。

4. **ContentResolver 跨进程序列化大量数据 OOM** — 用户 10k 联系人 + media 一次性 query 会 ANR。Mitigation: paginate query (limit/offset)；JNI 桥分批 emit。

5. **Accessibility Service 启用后 Google Play 警告** — Google 对 Accessibility Service 用途审查越来越严，App 可能被警告或下架。Mitigation: 文档明示用途；APK 内 Accessibility Service 只在用户主动 enable 时启动；Play Console 提交时单独写用途说明。

6. **Root + frida 检测被 banking app block** — 部分国产 app 会探测 root 并拒绝启动（中国银行 / 支付宝 / 等）。Mitigation: 用户在 cc 内启 Magisk DenyList；cc 不主动启 frida-server。

7. **手机端 vault 体积膨胀 → 占满 filesDir** — 用户 ingest 5 年微信记录 vault 可能 >5GB。Mitigation: `cc hub vacuum` + `cc hub archive --older-than 6m` （未来）；UI 显占用 + 提示。

8. **端侧 LLM 量化损失导致 NL intent 误判** — 1.5B Q4 模型把"拉昨天的微信" 错 parse 为 `wechat` adapter 但 since=now（误读"昨天"）。Mitigation: NL 解析层用规则 fast-path 处理时间词（"昨天" / "上周" / "今天"），LLM 只解析 adapter + intent。详见配套设计稿 §4。

9. **APK 升级覆盖 filesDir vault 数据丢失** — 用户卸载重装 APK 会清 filesDir → vault 丢。Mitigation: 用户操作前 `cc hub export --format sqlite --out /sdcard/Download/`；Plan A v0.2 加自动 `/sdcard/ChainlessChain/backups/` 自动备份。

10. **多 cc 实例同时 open vault → SQLCipher WAL 锁竞争** — 用户在 Android in-app terminal 和 Termux app 两路同时跑 cc → vault.db locked。Mitigation: cc startup 检测 lock file (.cc-hub.lock)，二进程拒启 + 提示。

11. **OpenRouter API key 写进 cc config 明文 → root 设备同机 app 偷读** — 主密钥风险扩散。Mitigation: API key 走 Android EncryptedSharedPreferences（per [[android_local_terminal_phase_2_5]] follow-up "app LLM key → cc CLI 环境变量桥"）；cc 启动时从 EncryptedSharedPreferences 读 + 塞 envp，不落盘。

12. **APK 体积 244MB → 250MB++ 后 Play Store 限制** — Google Play APK 上限 200MB（AAB Dynamic Delivery 没限，但用户走 GitHub release apk）。Mitigation: Plan A 启动 LLM 模型走 on-demand download（首次 `cc llm pull qwen2.5:1.5b`），APK 不内置 → 体积可控；APK 内只 +20MB llama.rn 库。

13. **`build:web-panel` 重生成 `packages/web-panel/dist/index.html` 让 git pull --rebase 拒绝** — `node-runtime-bundle.yml` step 14 跑 `npm run build:web-panel` 重生成 dist 下 git-tracked 文件。这是 expected behavior（用于让 `cc ui` SPA 跟 cc CLI 版本同步），但其残留为 unstaged change，下一步 pull --rebase 拒 `cannot pull with rebase: You have unstaged changes`。**Mitigation 已落 acf5c1d21**: `git pull --rebase --autostash origin main`。`--autostash` stash unstaged → rebase → restore，对 auto-managed 路径完全等价 since rebuild deterministic。Run 26147569387 verified.

14. **Node 24+ `common.gypi` 要求 `android_ndk_path` GYP_DEFINES 变量** — Node 24/25/26 的 `common.gypi` 在 `OS == "android"` 条件块用 `'-I<(android_ndk_path)/sources/android/cpufeatures'` cflag。如果没设此变量，gyp 报 `Undefined variable android_ndk_path in binding.gyp while trying to load binding.gyp`。Run 26147834392 verified；**Mitigation 已落 acf5c1d21**: `bs3mc-android-prebuild.yml` 设 `GYP_DEFINES="OS=android target_arch=arm64 host_os=linux android_ndk_path=$ANDROID_NDK_HOME"`。注：NDK r27 已无 `sources/android/cpufeatures` 目录，但 gyp 只展开变量不验证路径存在性，所以不影响 build（除非 bs3mc 真的 #include cpufeatures.h，bs3mc 不用 cpufeatures）。

---

## 10. 与 Phase 14 Plan B 的协同

| 特性 | Plan B（远程） | Plan A（本机） | 用户选择 |
|---|---|---|---|
| vault 单一权威源 | 桌面 | 手机 | 选 B：桌面是 SoT；选 A：手机是 SoT；不可同时双 SoT |
| LLM 推理位置 | 桌面 Ollama / 远程 | 手机 llama.rn / 远程 | 同上 |
| 离线可用 | ❌ | ✅ | A 完胜 |
| 重型分析（Phase 11 月度报告） | ✅ 桌面 70B | ⚠️ 远程 API only | B 完胜 |
| 跨 app 数据访问 | 桌面侧 ADB pull（需 USB / Wi-Fi ADB） | 手机本机 ContentResolver / SAF / root | A 完胜（无需 USB） |
| 首次设置成本 | 低（已 Phase 14.1 落地） | 高（LLM pull + 设备能力探测 + 5 路径授权） | B 完胜 |
| 用户群 | 重度桌面用户 | 移动优先用户 / 户外用户 | 互补 |

**推荐用户路径**：v0.1 默认 Plan B（已落地）；Plan A 作为高级选项 in `cc android setup` 引导流程，让用户决定要不要切换到手机为 SoT。

---

## 11. 落地优先级建议

**已落（2026-05-20）**：A1 桌面端验证 ✅（vault.js loadDriver lazy 模式确认）。下个 single point of failure 是 **A2**。

如果只能做 1 步：**Sub-Phase A2**（Termux Node 24 pin + 上游 prebuild 注入）— 1.5-2d 投入，落地后 Android cc 可 open vault.db；底层基础设施全部 unblocked。

如果只能做 1 周：**A2 → A6 → A7 → A8**（A2 后 + ContentResolver 路径 + 5 个 cc android 命令 + SystemData adapter）。最小可演示价值：用户在 Android 终端跑 `cc android contacts pull && cc hub ask "我有几个联系人"` → 端侧 ingest + 端侧 ask 流水线打通（ask 部分仍走 OpenRouter API 远程 LLM until A3 落地）。

如果只能做 2 周：上述 + **A3 LlamaRn + A4 + A13 cc ui WebView**。能真正脱离桌面 + 离线跑 PDH。

---

## 12. 决策结论

**问题**："安卓端可以不依赖桌面端实现 PDH 么？"

**答**：**可以**。技术路径名为 **Plan A**，与已落地的 Plan B 互补不互斥。

**核心条件**：
1. ✅ Android APK 已 bundle cc CLI（Phase 2.5 2026-05-19 真机验证）
2. ✅ personal-data-hub 包零桌面依赖（DI bridges）—— **A1 已 verify 2026-05-20**
3. ✅ Termux nodejs-lts (Node 24.15.0) + 上游 prebuild v137-linuxmusl-arm64 已存在 —— **B.1 路径 verify 2026-05-20**
4. ⏳ 需新增 LlamaRn LLM client + ContentResolver JNI 桥 + 5 个 cc android 命令
5. ⏳ 需在 `node-runtime-bundle.yml` 落 A2 prebuild 注入 + patchelf 步（1.5-2d）

**总工程**（2026-05-20 校准）：**~6-9d wall clock**（Plan A v0.1 全套，A6-A14 大量可并行），critical-path 串行 ~5d (A2→A3→A4→A5)。原稿 ~10-16d 估值已纠正。

**强约束**：
- iOS 不在 Plan A 范围（继续走 Plan B）
- 跨 app sandbox 5 路径分级（非 root 设备能用的 adapter 子集 ~6/22，rooted 设备 ~18/22）
- 端侧 LLM 仅适合 1.5-3B 模型（摘要 query）；重型分析仍需远程 API 或回 Plan B
- **Node 版本锁定 24.x** — better-sqlite3-multiple-ciphers engines.node max 24；未来 Termux nodejs-lts 升 26 时需要重审 prebuild 矩阵

---

> **下一步**：(1) A1 ✅ done；(2) B.1 路径 ✅ verify；(3) 启 Sub-Phase A2 落 workflow 改动（task #7）。
