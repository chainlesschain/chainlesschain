# 个人数据中台 (Personal Data Hub)

> **版本: v5.0.3.80 (Phase 0–13 全部落地 + 14.1/14.2/14.3 + 10.3.6 CLI + 12.6.7-9 WeChat bootstrap + **v0.2 大爆发：11 个 placeholder 卡接通 + WeChat 12.10 4 sub-phase + QQ XOR-IMEI + A3 Android 端侧 LLM 骨架**, 2026-05-22) | 状态: ✅ 可用 — **22 个 Adapter ✅ v0.2 真接通** (Email IMAP × 4 + Alipay + Taobao + SystemData + WeChat v0.5 SQLCipher 真解密 + QQ v0.2 XOR-IMEI + 4 Travel × 2 (高德/携程 v0.2 + 百度地图/腾讯地图 v0.2) + 5 Shopping (京东/美团/拼多多/淘宝/支付宝 v0.2) + 6 Social (Bilibili/微博 v0.2/抖音 v0.2/小红书 v0.2/头条 v0.2/快手 v0.2) + 3 Messaging (QQ/Telegram/WhatsApp) + 9 AIChat 厂商 v0.2) + Mobile Extraction Layer + EntityResolver + 5 Analysis Skill | **29 IPC + 29 WS** + Phase 14.1 Android + Phase 14.2 iOS 全 `PersonalDataHubCommands` 22 method typed wrapper | **70+ 测试文件 / 1370+ 测试**（含 v0.2 一轮新 snapshot tests: weibo 8 + douyin 8 + xiaohongshu 8 + toutiao 8 + kuaishou 8 + jd 8 + meituan 8 + pinduoduo 8 + baidu-map 8 + tencent-map 8 + qq 13 = 93 新 snapshot tests + 27 QQ Android Kotlin unit tests）| 设计文档: 13-Phase 路线图 + 8 个 Adapter 专题 + EntityResolver + sjqz 借鉴比对 + Phase 14 移动端原生入口 + Phase 10.3 AIChat WebView 鉴权向导 + Phase 12.6.7-9 WeChat bootstrap + **Phase 12.10 WeChat in-app collector 4 sub-phase + Phase 13.5 QQ in-app collector**
>
> 让数据回归个人。各 App 的数据先落到你自己设备上，本地 LLM 才能用它帮你回答跨源问题。任何分析都不经云端 — 默认拒绝非本地 LLM，除非显式 opt-in。

## 概述

个人数据中台 (Personal Data Hub) 是 ChainlessChain 把"个人 AI 工具集"升级为**用户全数据本地中台 + AI 分析引擎**的核心基础设施。它解决一个长期存在的问题：用户的数据散落在数十个 App 里（微信 / 支付宝 / 淘宝 / 高德 / 各 AI 助手 / …），每个 App 是事实主人，用户只是访问者；跨源问题（"我妈生日那周买了啥送哪儿？"）任何单一 App 都答不了，而云端 AI 看不到也不该看到你的私域数据。

中台的工作方式：

1. **采集**：每个 App 一个 Adapter，把数据拉回本机
2. **统一**：5 类核心实体（Person / Event / Place / Item / Topic）跨源对齐
3. **存储**：SQLCipher LocalVault (AES-256) 加密落盘，主密钥绑定平台 Keystore，可选 U-Key / SIMKey 硬件加固
4. **理解**：派生进既有 KG（知识图谱）+ RAG (BM25) 索引，让数据可被自然语言查询
5. **分析**（核心）：本地 Ollama LLM 直接分析用户数据，敏感数据零外传；隐私 gate 默认拒非本地模型
6. **可携带**：JSON / SQLite 一键导出，可销毁，全过程审计可查

中台**不新增基础设施** — KG / RAG / SQLCipher / DID / Skill 系统 / Ollama 全部复用既有能力，新增的只是 UnifiedSchema 定义、EntityResolver、AdapterRegistry、每个 Adapter 实现，以及数据分析专用 prompt / skill。

> 完整设计与 13-Phase 路线图见设计文档：[`Personal_Data_Hub_Architecture.md`](https://design.chainlesschain.com/Personal_Data_Hub_Architecture.html)（"个人数据中台 专题"）。

## 核心特性

- 🔐 **本地优先加密落盘**：SQLCipher AES-256 LocalVault，单文件即可备份/迁移；FileKeyProvider 默认 0600 权限存放主密钥，Phase 4 升级为 Windows DPAPI / macOS Keychain / Linux libsecret
- 🧬 **UnifiedSchema 5 类核心实体**：Person / Event / Place / Item / Topic，所有 Adapter 输出统一形状，KG / RAG / 分析层只看一种 schema
- 🆔 **UUID v7 时间序 ID**：RFC 9562 手写实现（~30 LOC, 零依赖），事件天然按时间排序，索引友好
- 🪪 **Adapter 契约**：`PersonalDataAdapter` 接口 + `assertAdapter` 校验，每个 Adapter = 一个 Skill，自然接入既有 marketplace 与权限模型
- 📧 **EmailAdapter (IMAP) 已上线**：QQ / Gmail / 163 等主流邮箱授权码登录，UID 增量水位，正文 + 附件元数据解析，PDF 自动解密 + 字段提取，6 套模板（账单 / 政务 / 订单 / 注册 / 出行 / 其他），分类器双层（规则 + LLM 兜底）
- 💸 **AlipayBillAdapter (CSV-import) 已上线**：支付宝官方账单 ZIP 文件直接导入，自动 ZIP 解密（用户提供密码）、CSV 解析、对手方归一化、订单事件持久化
- 🧠 **AnalysisEngine 自然语言 Q&A**：query-parser 提取时间窗口 / 实体 / 意图 → vault 取相关事实 → RAG 召回扩展上下文 → prompt-builder 构造（system 不放事实 / 用户角色才挂事实并标记 untrusted）→ LLM 推理 → citation 校验 → 写入审计
- 🛡️ **隐私 Gate (硬约束)**：`AnalysisEngine` 检测到 LLM 非本地 (provider 不在白名单) 时直接拒绝 `ask`，调用方必须显式传 `acceptNonLocal: true` 才允许；Ollama / 自托管 vLLM 始终视为本地
- 📚 **citation 强制校验**：LLM 必须给出引用 eventId，回答经 `validateCitations` 比对 vault 真实事件 → 防幻觉
- 🪢 **KG 派生 (CcKgSink)**：UnifiedSchema → `rdf:type` / `by` / `involves` / `happened-at` 三元组，对接既有 `cc knowledge-graph` 引擎（`addEntity` + `addRelation`）
- 🔍 **RAG 派生 (CcRagSink + BM25)**：events 转 RagDoc 写入既有 BM25 索引；Qdrant 向量检索预留 Phase 4
- 🌉 **CcLLMAdapter (LLM 桥)**：依赖注入复用桌面端已配好的 LLM Manager (Ollama / Volcengine / Anthropic / Gemini / DeepSeek)；Hub 包本身**不**依赖 cc 模块，bridge 在 desktop / cli 入口分别注入，Hub 自身可独立单元测
- 🔁 **AdapterRegistry 全流水线**：health → sync → archive raw → normalize → partition valid/invalid → vault → KG sink → RAG sink → watermark → audit，单段失败不阻塞整体（坏数据进 invalid 队列），sink 故障容忍
- ⏬ **增量同步 watermark**：每个 (adapter, partition) 一个水位，重跑同窗口 0 重复事件；`findBySource(adapter, originalId)` 提供去重原语
- 🌊 **流式同步进度 (Phase 5.7)**：`sync-adapter-stream` / `sync-all-stream` 主题推送 connecting / fetching / normalizing / done / error 事件，UI 实时进度条
- 🔄 **重试退避 (Phase 5.7)**：网络瞬断自动 3 次指数退避，IMAP 连接 / Alipay 解压都受益
- 🧾 **审计日志**：每一次 ingest / query / ask / register / unregister 都落 `audit_log` 表，含来源 adapter / 事件 id / 时间戳 / action / 操作者，支持 `queryAudit` 反查
- 🧊 **冷启动延迟懒加载**：`getHub()` 首次 IPC 才初始化 vault + LLM + 桥；不用 hub 功能的用户零开销
- 🪟 **跨壳一致接口**：同一组主题在 Electron IPC (colon style `personal-data-hub:ask`) 与 cc ui WS (dot style `personal-data-hub.ask`) 双登记 — SPA 切换 shell 行为不变（per `feedback_cross_shell_feature_pattern`）
- 💣 **可销毁 (vault.destroy)**：单调用即可彻底清理 vault.db + WAL + 关联密钥，符合"数据可走"承诺
- 🔁 **WAL 安全的主密钥旋转**：`vault.rotateKey(newKeyHex)` 在 WAL 模式下也能透明换密钥，旧密钥保留为 `vault:<id>:prev` 应急回滚
- 🧪 **Validator 永不抛**：所有校验器返回 `{ valid, errors }`，单条坏数据不会拉垮整窗 ingest，可定向回看
- 🧰 **MockAdapter / OllamaClient 自带**：测试用 deterministic MockAdapter (seeded)、单机 fallback OllamaClient (`http://localhost:11434` 可改 env)

## 系统架构

### 分层视图

```
┌─────────────────────────────────────────────────────────────┐
│ 用户查询层（自然语言）                                          │
│  桌面 PersonalDataHub.vue (Electron / V6)                     │
│  Web-Shell PersonalDataHub.vue (cc ui via WS)                 │
│  移动端 Phase 14 路线图（远程操控 RPC，hub.ask 走 P2P DC）     │
│  Q: "上个月我妈生日那周买了啥送哪儿？"                          │
└─────────────────┬───────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────────────┐
│ 分析层 (AnalysisEngine)                                       │
│  query-parser → vault facts → RAG retriever (BM25 topK=10)   │
│   → prompt-builder → llm.chat → citation parser/validator    │
│   → audit                                                     │
│  本地 LLM (Ollama 默认 qwen2.5:7b-instruct, 可切 70B / vLLM)  │
│  隐私 Gate: 非本地 LLM 默认拒绝                               │
└─────────────────┬───────────────────────────────────────────┘
                  ↓ structured query
┌─────────────────────────────────────────────────────────────┐
│ 中台核心 (Hub Core)                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ UnifiedSchema│  │ KG Derivation│  │ RAG Derivation│      │
│  │ Person/Event │  │ → triples    │  │ → RagDoc      │      │
│  │ Place/Item   │  │              │  │               │      │
│  │ Topic        │  │              │  │               │      │
│  └──────────────┘  └──────┬───────┘  └──────┬────────┘      │
│  ┌────────────────────────┼────────────────────┼─────────┐  │
│  │ LocalVault (SQLCipher AES-256)              │         │  │
│  │  events / persons / places / items / topics │  →  CcKgSink │
│  │  raw_events / sync_watermarks / audit_log   │     CcRagSink │
│  │  主密钥: FileKeyProvider (Phase 3.5b)        │              │
│  │       → DPAPI / Keychain / libsecret (P4)   │              │
│  └────────────────────────┬────────────────────┴─────────────┘
└─────────────────────────────┼────────────────────────────────┘
                              ↓ Adapter contract
┌─────────────────────────────────────────────────────────────┐
│ 同步层 (AdapterRegistry)                                      │
│  health → sync → archive raw → normalize → partition →       │
│  vault.putBatch → kgSink.write → ragSink.write → watermark   │
│  → audit                                                      │
│  流式进度 (Phase 5.7) + 指数退避重试 (Phase 5.7)              │
└─────────────────────────┬───────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Adapter 层 (16 个，每个 App 一个 Skill)                       │
│                                                              │
│  Web API / Cookie 类：                                       │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐           │
│  │ EmailIMAP ✅│ │ AlipayBill ✅│ │ AIChat × 8 ✅│           │
│  │  (P5.1-5.7) │ │  (P6.1-6.5) │ │ (P10.2 8/8)  │           │
│  └─────────────┘ └─────────────┘ └──────────────┘           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Taobao ✅    │ │ JD ✅        │ │ Meituan ✅   │         │
│  │  (P7 Cookie) │ │  (P7 Cookie) │ │  (P7 Cookie) │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Amap ✅      │ │ Baidu Map ✅ │ │ Ctrip ✅     │         │
│  │  (P9 Cookie) │ │  (P9 Cookie) │ │  (P9 Cookie) │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐                                            │
│  │ 12306 ✅     │                                            │
│  │  (P9 web)    │                                            │
│  └──────────────┘                                            │
│                                                              │
│  本机 / 移动端 SQLite 类（借 sjqz parser 复用）：           │
│  ┌──────────────┐ ┌─────────────┐ ┌──────────────┐          │
│  │ SystemData ✅│ │ Mobile Ext ✅│ │ WeChat 🚧0.5 │          │
│  │  (P4.5 sidecar)│(P7.5 ADB/iOS)│ │ (P12 frida-  │          │
│  │              │ │              │ │  indep slice)│          │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Bilibili ✅  │ │ Weibo ✅     │ │ Douyin ✅    │         │
│  │  (P13.1)     │ │  (P13.2)     │ │  (P13.3)     │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ Xiaohongshu ✅│ │ QQ ✅        │ │ Telegram ✅  │        │
│  │  (P13.4)     │ │  (P13.5)     │ │  (P13.6)     │         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐                                            │
│  │ WhatsApp ✅  │                                            │
│  │  (P13.7)     │                                            │
│  └──────────────┘                                            │
└─────────────────────────────────────────────────────────────┘

  ✅ 已上线  🚧 部分实现（v0.5 frida-indep 路径已通，frida-dep 路径与真机 E2E 待）
```

### 5 类核心实体

所有 Adapter 把原始数据 normalize 成下面 5 类。每类继承 `BaseEntity`（`id` / `source` / `ingestedAt` / `confidence?` / `extra?`）。

| 类型 | 子类 (subtype) | 示例 |
|---|---|---|
| **Person** | self / contact / merchant / ai-agent / unknown | 自己 / 妈妈 / 京东商家 / DeepSeek 助手 |
| **Event** | message / order / payment / visit / post / browse / like / trip / call / media / ai-message / ai-image-generation / other | 微信聊天 / 淘宝订单 / 支付宝交易 / 餐厅消费 / 朋友圈 / 短视频点赞 / AI 对话 |
| **Place** | home / restaurant / office / merchant-physical / generic | 家 / 海底捞中山公园店 / 妈妈家 |
| **Item** | product / link / media / document / generic | 蛋白粉 / 微信链接 / 图片 / PDF 账单 |
| **Topic** | (free-form 标签) | "妈妈生日" / "Python 学习" / "和 GPT 聊编程" |

> 设计原则：核心 5 类强 schema (跨源对齐用)，子类型只是约束 `extra` 字段语义；新数据源不在 5 类里的字段全挂 `extra: Record<string, any>` 兜底，schema 演化不破坏既有数据。

### 已落地 vs 路线图

> 截至 2026-05-22 v5.0.3.80：所有路线图 adapter (Phase 5/6/4.5/7.5/7/9/10/12/13) **全部从 placeholder/v0.1 scaffold 升级到 v0.2 真接通**。微信 (12.10) 4 sub-phase 全 land — SQLCipher 真解密 + frida-inject 真注入 + 16.5.9 binary vendored + APK 真 ship；QQ (13.5) v0.2 XOR-IMEI 算法 byte-identical sjqz 移植 — 无 SQLCipher + 无 frida + 仅 root + IMEI 输入；A3 Android 端侧 LLM 全链路 skeleton — Ktor LLM server + ModelManager + cc spawn。剩余 v0.2 → v1.0 部分 (WeChat 12.10.6 真机 E2E + QQ HubLocal UI wire 第二批 + A3 Maven deps + JNI + 真机) 需 root 设备 + Mac/Linux + Android NDK，约 ~5-7d。

| Adapter | 状态 | 数据源 | 采集机制 | 验证 |
|---|---|---|---|---|
| **EmailAdapter** | ✅ 已上线 (Phase 5.1-5.7) | IMAP 邮箱（QQ / Gmail / 163 / …） | IMAP 授权码 + UID 水位 + PDF 解密 + 6 模板 | 单测 ≥390 / E2E 真账号 OK |
| **AlipayBillAdapter** | ✅ 已上线 (Phase 6.1-6.5) | 支付宝官方账单 ZIP | 用户在 App 内导出 → 拖入桌面 / Web → ZIP 解密 + CSV 解析 + 对手方归一化 | smoke test green |
| **SystemDataAdapter** | ✅ 已上线 (Phase 4.5) | Android 通讯录 / 通话 / 短信 / WiFi | Python sidecar (forensics-bridge) + adb pull | 单测 50+ |
| **Mobile Extraction Layer** | ✅ 已上线 (Phase 7.5) | Android ADB + iOS iTunes backup 提取层 | adb / pymobiledevice3 | 单测 + 真机 E2E |
| **EntityResolver** | ✅ 已上线 (Phase 8) | 跨源 Person / Place 消歧 | 三段 pipeline（规则 + embedding + LLM）+ ingest hook + UI 队列 | 单测全绿 |
| **5 Analysis Skills** | ✅ 已上线 (Phase 11) | spending / relations / footprint / interests / timeline | 内置 skill + Workflow | 单测全绿 |
| **TaobaoAdapter** | ✅ 已上线 (Phase 7) | 淘宝订单 / 收藏 / 评价 / 收货地址 | Cookie + web API（共享 `shopping-base`）| 单测全绿 |
| **JDAdapter** | ✅ v0.2 dual-mode (snapshot + cookie) (`f3bd0693`) | 京东订单 / 收藏 / 评价 | Android in-app snapshot 或桌面 Cookie + web API | 单测全绿（snapshot 8 + 既有）|
| **MeituanAdapter** | ✅ v0.2 dual-mode (`f3bd0693`) | 美团订单 / 外卖 / 收藏 | Android in-app snapshot 或桌面 Cookie + web API | 单测全绿 |
| **PinduoduoAdapter** | ✅ v0.2 (`78695c25e`) | 拼多多订单 / 收藏 | Android in-app SAF JSON import | snapshot 8 单测 |
| **AmapAdapter** | ✅ v0.2 cookie-scrape WebView (`0fe572f2`) | 高德足迹 / 收藏地点 | Android in-app WebView cookie scrape 或桌面 Cookie | 单测全绿 |
| **BaiduMapAdapter** | ✅ v0.2 (`3d1cf9481`) | 百度地图足迹 / 收藏 | Android in-app WebView 或桌面 Cookie + map.baidu.com API | snapshot 8 单测 |
| **TencentMapAdapter** | ✅ v0.2 (`3d1cf9481`) | 腾讯地图足迹 / 收藏 | Android in-app WebView cookie scrape | snapshot 8 单测 |
| **CtripAdapter** | ✅ v0.2 cookie-scrape (`0fe572f2`) | 携程酒店 / 机票 / 火车票订单 | Android in-app WebView 或桌面 Cookie | 单测全绿 |
| **12306Adapter** | ✅ 已上线 (Phase 9) | 12306 行程 / 订单 | 被动 webRequest 拦 + JSON 解析 | 单测全绿 |
| **AIChatHistoryAdapter × 9** | ✅ v0.2 全 9 路（豆包 Doubao 已 v0.2 接通）| DeepSeek / Kimi / 通义千问 / 智谱清言 / 腾讯混元 / 百度千帆 (合并 wenxin/qianfan) / 字节扣子 / 即梦 Dreamina / **豆包 Doubao** | Android in-app WebView cookie scrape + cc sync wire (`1e7725552`) 或桌面 HttpClient (cookie + rate-limit + 指数退避) | 全绿 |
| **Social × 6** (Bilibili / Weibo / Douyin / Xiaohongshu / Toutiao / Kuaishou) | ✅ × 6 **全 v0.2 真接通** | Android 本机 SQLite (dual-mode snapshot + sqlite) 或桌面 cookie web API：B 站 history / 微博 timeline (`c087c36eb`) / 抖音 watch (`20f9b2188`) / 小红书 收藏 (`20f9b2188`) / 头条 read_history (`e1155b1d7`) / 快手 photo_history (`e1155b1d7`) | Mobile Extraction Layer pull / Android in-app collector / sjqz parser 移植 | weibo 8 + douyin 8 + xiaohongshu 8 + toutiao 8 + kuaishou 8 = 40 新 snapshot 单测 + Android Kotlin DouyinApiClientHelpersTest / XhsApiClientHelpersTest / WeiboApiClientHelpersTest |
| **Messaging × 3** (QQ / Telegram / WhatsApp) | ✅ v0.2 三家 Android in-app real | QQ Android **普通 SQLite + msgData XOR(IMEI) 加密** (`a07731b46`) — 无 SQLCipher / 无 frida / 仅 root + IMEI 输入；Telegram + WhatsApp 既有 | sjqz `qq.py:90-112` 算法 byte-identical 移植；4 Kotlin (QQXorDecryptor / QQCredentialsStore / QQDbExtractor / QQLocalCollector) + JS messaging-qq adapter dual-mode | QQ Kotlin 27 unit + JS snapshot 13 + longtail 6 |
| **WechatAdapter** | ✅ **v0.2 Phase 12.10 4 sub-phase 全 land** (8081f8a0d / 37a4e465d / cdfe1048e) | Android in-app SQLCipher 真解密：7.x MD5(IMEI+UIN)[:7] 路径 + 8.x frida hook libwcdb 拿真 64-hex 路径双通路；WAL+SHM cohort copy；vendored frida-inject 16.5.9 arm64+armeabi-v7a APK ship | content-parser + KNOWN_PRAGMA_PROFILES 3 fallback + sjqz wechat_decrypt.py 算法 byte-identical 移植 + 5-symbol frida hook (sqlite3_key/v2/wcdb_setkey/WCDBKeyDerive/mangled C++) | 89 既有 + Phase 12.10 51 新（CredentialsStore 14 + DbExtractor 17 + FridaInjector 15 + LocalCollector 10）+ APK ship 真机已上 Xiaomi 24115RA8EC；剩 Phase 12.10.6 真机 E2E (需 root 机子) + Phase 12.10.7 anti-detection |

> Phase 13 七个 adapter 借 sjqz 已有 Python parser 移植到 Node.js — 详见 [`Adapter_Social_Messaging.md`](https://design.chainlesschain.com/Adapter_Social_Messaging.html)（本批最新加入）。Toutiao §11 + Kuaishou §12 已从 v0.1 scaffold 升 v0.2 dual-mode (`e1155b1d7`, 2026-05-22)；Doubao AIChat 9th vendor §6.9 也接通；微博 §13 v0.2 镜像 Bilibili pattern (`c087c36eb`, 27 新单测)。

> **v0.2 升级路径**：所有 v0.2 adapter 都是 dual-mode — 既支持桌面侧既有 cookie + web API 通路（解决用户不在 Android 端的场景），也支持 Android in-app collector 直接采本机 SQLite (绕开网络 / 反爬 / 频控)。Android 路径见 §A8（社交内容）/§2.4-§2.6（购物/出行/AI 助手）的 in-app 卡 UI，桌面路径见各 adapter 的 cookie-scrape WebView。

### Phase 历史

| Phase | 主题 | 关键产出 | 测试基线 |
|---|---|---|---|
| 0 | UnifiedSchema | 5 类实体 + validators + UUID v7 + batch helpers | 53 |
| 1 | LocalVault | SQLCipher + 8 张表 migrations + FileKeyProvider | 101 |
| 2 | AdapterRegistry | 全流水线 + KG/RAG derivation + MockAdapter | 157（1k events @ 600ms） |
| 3 | AnalysisEngine | NL Q&A + 隐私 gate + citation 校验 | 220 |
| 3.5 | 桥接生产 | CcLLMAdapter + CcKgSink + CcRagSink (DI) | 268 |
| 3.5b | 跨壳接线 | 21 IPC 通道 + 21 WS 主题 | — |
| 4.5 | SystemDataAdapter | Python sidecar + 通讯录 / 通话 / 短信 / WiFi | 累计中 |
| 5.1 | EmailAdapter | IMAP + 授权码 + UID 水位 | 317 |
| 5.2 | Email parse | 正文解析 + 附件元数据 | 345 |
| 5.3 | Email classifier | 规则 (Layer 1) + LLM (Layer 2) 兜底 | 390 |
| 5.4 | Field extractors | 6 套模板（账单/政务/订单/注册/出行/其他） | 累计中 |
| 5.5 | PDF 解密 + 提取 | 自动解密含密 PDF + 交易抽取 | 累计中 |
| 5.6 | Email 配置向导 | 测试授权 + 注册 + 事件详情 deep-link | 累计中 |
| 5.7 | 流式同步 | 进度推送 + 指数退避重试 + E2E Runbook | 累计中 |
| 6.1+6.2 | AlipayBillAdapter | CSV 解析 + ZIP 解密 + 对手方归一化 | 累计中 |
| 6.3-6.5 | Alipay wiring | WS / IPC + Web-Panel UI + smoke | 累计中 |
| 7 | Shopping three-pack | Taobao / JD / Meituan + 共享 `shopping-base` Cookie 客户端 | 累计中 |
| 7.5 | Mobile Extraction Layer | Android ADB + iOS iTunes backup | 累计中 |
| 8 | EntityResolver | 规则 + embedding + LLM 三段 pipeline + ingest hook + UI 队列 + eval gate | 累计中 |
| 9 | Travel four-pack | Amap / Baidu Map / Ctrip / 12306 + 共享 `travel-base` | 累计中 |
| 10.1 | AIChatHistoryAdapter skeleton | 8 vendor stub + cookie-auth + schema-map + contract | +27 |
| 10.2 | AIChatHistoryAdapter wiring | DeepSeek / Kimi / 通义 / 智谱 / 混元 / 千帆 / 扣子 / Dreamina 全 8 厂商接 h5 API + 共享 HttpClient | 累计 +52 |
| 10.2 (+) | **AIChatHistoryAdapter 9th: 豆包 Doubao** (v0.1 scaffold) | ByteDance 旗舰文本 AI（与 Dreamina 图生独立）；cursor 分页 + has_more；endpoint 蓝图待 Phase 10.4 fixture pin | +5 scaffold |
| 11 | Analysis Skills | spending / relations / footprint / interests / timeline | 累计中 |
| 12 v0.5 | WechatAdapter (frida-indep) | content-parser + key-extractor (MD5(IMEI+UIN)[:7]) + db-reader + normalize | +41 |
| 13.1-13.4 | Social four-pack | Bilibili / Weibo / Douyin / Xiaohongshu (借 sjqz Python parser 移植) | 累计中 |
| 13.5-13.7 | Messaging three-pack | QQ / Telegram / WhatsApp (借 sjqz parser + 加密 DB 解密) | 累计中 |
| 13.8 (+) | **Social Toutiao (今日头条)** (v0.1 scaffold) | 新闻/feed reader Android SQLite — read_history / collection_article / search_history；schema 待 fixture pin | +6 scaffold |
| 13.9 (+) | **Social Kuaishou (快手)** (v0.1 scaffold) | 短视频 Android SQLite — photo_history / user_collect / search_record；schema 待 fixture pin | +5 scaffold |
| 12.6 §18.1-6 | KeyProvider DI + Frida agent + env-probe + Setup runbook | wechat/key-providers/{base,md5,frida} + frida-agent/{loader,wechat-key-hook} + env-probe；FridaKeyProvider lazy-load 容忍 frida binding 缺 | +43 scaffold |
| 10.3.1 (+) | **AIChat WebView 鉴权向导 — cookie-capture-spec** | `cookie-capture-spec.js`：9 vendor matrix (loginUrl/cookieDomains/requiredCookies/postLoginPathHints/maxAgeHintDays/notes) + `classifyProbedCookies` 三态输入容忍 (object/Cookie[]/raw 串) + 自检 `validateCookieCaptureSpec` 启动期断言；设计稿 `Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.md` 13 章 4 IPC + 10 forward-looking traps | +21 scaffold |
| 10.3.2 (+) | **AIChat WebView 鉴权向导 — wizard-controller** | `packages/personal-data-hub/lib/adapters/ai-chat-history/wizard-controller.js`（hub package 内，桌面 + cli 共享）：5 入口 (openVendorLogin / probeCookies / registerVendor / rotateLoginPartition / cleanupOrphanPartitions) + `_deps` 注入 (sessionFactory / accountsStore / clock / logger) + `fallbackMode:"paste"` 分支（cc ui 端） + 防御性 cookie 投影（spec 白名单外的 cookie 不出 wizard 边界） + 7 类典型错误码 (UNKNOWN_VENDOR / SESSION_INIT_FAILED / PASTE_REQUIRED / REQUIRED_COOKIES_MISSING / VALIDATE_COOKIE_FAILED / ADAPTER_THREW / ACCOUNTS_LIST_FAILED) | +31 单测 |
| 10.3.3 (+) | **AIChat WebView 鉴权向导 — 桌面 IPC + factory** | `desktop-app-vue/src/main/personal-data-hub/aichat-wizard-factory.js`：JSON-file accountsStore (0600, 写链串行化, ENOENT 容忍, 损坏 JSON 静默 fallback) + DEFAULT_VENDOR_SPECS → registerVendor 桥 (validateCookie 调度, HttpClient + CookieAuthSession 包装) + hubDir 维度 wizard singleton；`personal-data-hub-ipc.js` 注册 4 通道 (aichat-open-login / aichat-probe-cookies / aichat-register-vendor / aichat-rotate-login) | +20 单测 |
| 10.3.4 (+) | **AIChat WebView 鉴权向导 — cc ui WS mirror** | `packages/cli/src/lib/personal-data-hub-aichat-wizard.js`（ESM）：cli 端镜像 wizard wiring，`fallbackMode:"paste"` 硬编码（无 BrowserView） + 同一 JSON 文件 schema；`gateways/ws/personal-data-hub-protocol.js` 注册 4 个 `personal-data-hub.aichat-*` WS 主题 | +17 单测 |
| 10.3.5 (+) | **AIChat WebView 鉴权向导 — HealthChecker** | `packages/personal-data-hub/lib/adapters/ai-chat-history/health-checker.js`：每 6h 自动巡检 (首次延迟 30s) + 4 类结果分类 (ok / failed / SPEC_VERSION_MISMATCH / ADAPTER_THREW) + 写回 entry.lastHealth + 同名 runOnce 防重入 + 注入式 timer seam (setInterval/setTimeout/clock) | +13 单测 |
| 10.3.6 CLI (+) | **AIChat WebView 鉴权向导 — cc hub aichat 子命令** | `packages/cli/src/commands/hub.js`：`cc hub aichat list / login / probe / register / health / unregister` 6 个 verb 镜像 4 WS 主题 + HealthChecker；`--cookies "<paste>"` 走 paste-fallback；`--json` 全 verb 可机读；脚本/Plan A 手机内嵌终端可用，无需 Vue UI | +15 单测 |
| 10.3 E2E (+) | **AIChat WebView 鉴权向导 — 全链路集成测试** | `__tests__/integration/aichat-wizard-end-to-end.test.js`：4 场景串 cookie-capture-spec → wizard-controller → accountsStore (real fs) → vendor-bridge → health-checker 整链；A 走通 (probe → register → health=ok) / B 过期 (cookie 失效后 health=failed) / C spec version mismatch / D orphan partition cleanup；无 Electron / 无网络 | +4 单测 |
| 12.6.7 (+) | **WeChat adapter bootstrap 编排层** | `packages/personal-data-hub/lib/adapters/wechat/bootstrap.js`：把 §18.7 的 6 sub-phase 零件（env-probe / KeyProvider / WechatAdapter ctor）拼成一次性可注册入口；决策矩阵 md5/frida/unsupported + override + 全注入式测试 seam (`_probe`/`_md5Provider`/`_fridaProvider`/`_WechatAdapter`)；T26-T28 trap 登记进设计稿 §18.10；89 WeChat tests 全绿 (75 既有 + 14 bootstrap) | +14 单测 |
| 12.6.8 (+) | **WeChat register-wechat IPC + WS + privileged whitelist** | 4 IPC 通道 (`wechat-env-probe` / `register-wechat` / `unregister-wechat` / `list-wechat-accounts`) + WS 镜像；hub 暴露 `probeWechatEnv` / `registerWechatAdapter` / `unregisterWechatAdapter` / `listWechatAccounts` 四 method（desktop + cli 双 wiring 对称）；`wechat-accounts.json` 0600 + idempotent re-register + scrubbed list；register/unregister-wechat 加入 `approvalChannelsForMobile` 防 mobile peer 注入恶意 dbPath；whitelist 单测同步拓展 | +15 单测 |
| 12.6.9 (+) | **WeChat cc hub wechat CLI** | `cc hub wechat env-probe / register --uin --db --wechat-data-path [--force-provider] / list / unregister <uin>` 4 个 verb 镜像 4 WS 主题；`--json` 全 verb 可机读；脚本/Plan A 手机内嵌终端可用，无需 Vue UI（同 `cc hub aichat` 模式） | +14 单测 |
| 12.6.10 (+) | **WeChat Vue UI 鉴权向导 (web-panel)** | `WechatWizard.vue` 3-step drawer：Step 1 env-probe checklist（adb/root/frida/wechat 5 行）→ Step 2 uin + dbPath + wechatDataPath + forceProvider 表单 → Step 3 result + reasons 反馈；`usePersonalDataHub.js` 加 `probeWechatEnv` / `registerWechat` / `listWechatAccounts` / `unregisterWechat` 4 method 镜像 WS topics；`PersonalDataHub.vue` 顶部加「添加 WeChat」按钮 + `WechatOutlined` 图标 | +6 composable 单测 |
| 当前合计 | — | — | **67 文件 / 1223 测试**（含 Phase 10.2 集成 + E2E 6 + 3 场景；doubao scaffold + toutiao/kuaishou scaffold + analysis-skills backfill + WeChat Phase 12.6 §18.1-10 全套：KeyProvider + Frida agent + env-probe + Setup + 12.6.7 bootstrap + 12.6.8 IPC/WS wiring + 12.6.9 CLI + 12.6.10 Vue UI + 2026-05-21 Phase 10.3.1-10.3.6 全 land）|

> 全部路线图 phase 已实施完成。剩余 follow-up：Phase 10.3+ (9 厂商 AIChat WebView UI 鉴权向导 + 真账号 smoke) — 全 land，剩真账号 smoke (blocked on accounts)；Phase 12.6+ (WeChat 8.0+ Android frida-dep libwcdb hook 路径) **§18.1-10 已全 land** (含 12.6.7 bootstrap + 12.6.8 IPC/WS + 12.6.9 CLI + 12.6.10 Vue UI)，剩 Phase 12.9 (rooted device 真机 E2E — 需真 Android 设备)。

## IPC / WS 接口完整列表

中台所有功能通过 21 个对称接口暴露，**Electron IPC** 与 **cc ui / web-shell WS** 同时可用。命名约定：IPC 用 `personal-data-hub:<action>` (colon)，WS 用 `personal-data-hub.<action>` (dot)。

### 核心查询 / 健康 / 销毁（11 通道）

| 通道 | 入参 | 出参 |
|---|---|---|
| `ask` | `{ question, options?: { acceptNonLocal?, useRag? } }` | `AskResult { answer, citations[], llmName, isLocal }` 或 `{ error }` |
| `stats` | () | `{ vault: { events, persons, places, items, topics }, adapters[], hubDir, llm }` |
| `health` | () | `{ vault: { ok, schemaVersion }, llm: { ok, isLocal, name }, kgSink: { ok }, ragSink: { ok } }` |
| `list-adapters` | () | `Array<{ name, version, capabilities, sensitivity }>` |
| `sync-adapter` | `{ name, options? }` | `SyncReport { ingested, kgTriples, ragDocs, durationMs }` |
| `sync-all` | `{ options? }` | `Array<SyncReport>` |
| `register-mock` | `{ name?, count?, seed? }` | `{ name, version }` — 仅开发/烟测用 |
| `unregister` | `{ name }` | `{ ok }` |
| `query-events` | `{ subtype?, since?, until?, actor?, adapter?, limit? }` | `Array<Event>` |
| `recent-audit` | `{ since?, action?, limit? }` | `Array<AuditRow>` |
| `destroy` (v5.0.3.72) | `{ confirm: true, alsoWipeAccounts?, alsoWipeMasterKey? }` | `{ ok, removed: string[] }` — UI 必须二次确认 |

### Phase 5.6 — Email 配置向导（5 通道）

| 通道 | 入参 | 出参 |
|---|---|---|
| `test-email-auth` | `{ account: { provider, email, authCode, … } }` | `{ ok, reason?, error? }` — 不注册，只验证 |
| `register-email` | `{ account, opts? }` | `{ name, version, capabilities, sensitivity }` |
| `unregister-email` | `{ email }` | `{ ok, removed }` — vault 数据保留可查 |
| `list-email-accounts` | () | `Array<{ email, provider, folders, registeredAt, pdfPasswordHints[] }>` |
| `event-detail` | `{ eventId }` | `{ event, classification, extraction: { template, confidence, fields, warnings, pdfExtraction } }` |

### Phase 5.7 — 流式同步（2 通道）

| 通道 | 入参 | 出参 |
|---|---|---|
| `sync-adapter-stream` | IPC: `{ name, options?, progressChannel }` / WS: `{ name, options? }` + `sender(payload)` 推流 | 同步进度事件 (`connecting` / `fetching` / `normalizing` / `done` / `error`) + 最终 `SyncReport` |
| `sync-all-stream` | 同上 | `Array<SyncReport>` |

### Phase 6 — Alipay 账单导入（4 通道）

| 通道 | 入参 | 出参 |
|---|---|---|
| `register-alipay` | `{ account: { email, zipPassword? }, opts? }` | `{ name, version, capabilities, sensitivity }` |
| `unregister-alipay` | `{ email }` | `{ ok, removed }` |
| `list-alipay-accounts` | () | `Array<{ email, hasZipPassword, registeredAt }>` |
| `import-alipay-bill` | `{ zipPath?, csvPath?, zipPassword? }` | `SyncReport` |

> 全部通道在 [`desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js`](https://github.com/chainlesschain/chainlesschain) 与 [`packages/cli/src/gateways/ws/personal-data-hub-protocol.js`](https://github.com/chainlesschain/chainlesschain) 双登记；任何 SPA 代码切换桌面 / web-shell 行为一致。

## 前端集成

### Electron 渲染进程

```js
// 自然语言问答
const result = await window.electron.invoke("personal-data-hub:ask", {
  question: "上个月我在淘宝买了啥总共花了多少？",
  options: { useRag: true },
});
// → { answer: "...", citations: [{ eventId, ... }], llmName, isLocal }
if (result.error) { /* 显示 */ }

// 健康状态
const health = await window.electron.invoke("personal-data-hub:health");
// → { vault: { ok, schemaVersion }, llm: { ok, isLocal, name }, kgSink, ragSink }

// 流式同步（监听进度通道）
const progressChannel = `pdh-sync-${crypto.randomUUID()}`;
window.electron.on(progressChannel, (_e, evt) => updateProgress(evt));
const report = await window.electron.invoke("personal-data-hub:sync-adapter-stream", {
  name: "email-imap",
  options: { since: Date.now() - 7 * 86400 * 1000 },
  progressChannel,
});
```

### cc ui / web-shell (WS)

```js
const ws = useShellMode().wsClient;

// Q&A
const { result, error } = await ws.executeJson({
  type: "personal-data-hub.ask",
  question: "上周和妈妈的对话提到她身体怎么样？",
});

// 流式同步（onMessage 侧监听 type 后缀 .event 的中间消息）
ws.onMessage((msg) => {
  if (msg.type === "personal-data-hub.sync-adapter-stream.event") {
    updateProgress(msg.event);
  }
});
await ws.executeJson({ type: "personal-data-hub.sync-adapter-stream", name: "alipay-bill" });
```

### Web-Panel UI

`packages/web-panel/src/views/PersonalDataHub.vue` 已有完整 UI：

- **4 个健康卡片**：Vault schema 版本 + LLM provider 与本地标记 + KG sink 状态 + RAG sink 状态
- **Ask box**：自然语言提问输入 + Markdown 回答 + 引用 chip（点击跳事件详情）
- **Adapter 列表**：每行有 sync / unregister 操作 + 上次同步时间 + 敏感度标签
- **Audit drawer**：滚动审计日志 (since / action / limit 过滤)
- **配置抽屉**（Email / Alipay 分两 tab）：测试授权 → 注册 → 自动同步

桌面端 (Electron) 通过 `useShellMode().isEmbedded === true` 自动走 IPC，cc ui 走 WS — 同一份 SPA 代码。

## 跨端入口

中台核心是**桌面进程**（Electron 主进程）：vault.db / 主密钥 / LLM Manager / KG / RAG 都落桌面。其它 shell 通过 IPC / WS 把请求转给桌面进程。

### 桌面 Electron（默认）

打开桌面应用 → 顶部菜单 `个人数据中台` → 进入 `PersonalDataHub.vue`（V6 shell 一级页面）。所有 IPC 通道 (`personal-data-hub:*`) 直连主进程 wiring，**零网络跳转**。

### Web-Shell (`cc ui`)

在任意机器装好 CLI（`npm i -g chainlesschain`）后：

```bash
cc ui                # 起本地 web-shell（默认 http://localhost:7331）
# 浏览器自动打开 → 左侧导航点「个人数据中台」
```

幕后：

1. `cc ui` 启动 `packages/cli/src/lib/personal-data-hub-wiring.js` — 镜像桌面 wiring（同 `.chainlesschain/hub/` 目录、`OllamaClient` 作为默认 LLM）
2. WS gateway 注册 21 个 `personal-data-hub.*` 主题 (`packages/cli/src/gateways/ws/personal-data-hub-protocol.js`)
3. 浏览器加载 `packages/web-panel/dist/`（与桌面 V6 同一 SPA）→ `useShellMode().wsClient` 路由所有调用到 WS 网关

**和桌面 Electron 等价性**：UI / IPC 形状 / 数据目录全相同；唯一差别是 LLM provider — `cc ui` 不复用桌面 LLMManager（无 IPC 通道），默认用本地 Ollama；如需切其它 provider 走 `cc llm provider <name>` 后重启。

> 同一台机器同时跑桌面 + `cc ui` 会**共享 vault.db**（同 `.chainlesschain/hub/`），WAL 锁会自然串行化；推荐**二选一**避免并行 ingest 数据竞争。Phase 14+ 计划加 file-lock 协调。

### CLI 直连 (`cc hub`)

无 UI 场景（脚本 / SSH / Plan A 手机内嵌终端）下，**`cc hub <verb>`** 把同一组 IPC/WS 主题直接暴露为 11 个 verb，全部 `--json` 可机读：

| Verb | 用途 | 关键 flag |
|---|---|---|
| `ask <question>` | 自然语言问答 | `--no-use-rag` / `--accept-non-local` / `--json` |
| `stats` | vault 行数 + adapter list + 路径 | `--json` |
| `health` | vault / llm / kgSink / ragSink 4 件套（彩色 [local]/[remote] 标签） | `--json` |
| `list-adapters` | 已注册 adapter 列表 | `--json` |
| `sync-adapter <name>` | 触发单 adapter ingest | `--since` / `--until` / `--limit` |
| `sync-all` | 顺序跑全部 adapter | 同上 |
| `query-events` | 事件查询 | `--subtype` / `--since` / `--until` / `--actor` / `--adapter` / `--limit` |
| `recent-audit` | 审计日志 | `--since` / `--action` / `--limit` |
| `register-mock` | 注册 MockAdapter（dev/smoke 用） | `--name` / `--count` / `--seed` |
| `run-skill <name>` | 5 内置分析 skill（spending/relations/footprint/interests/timeline） | `--since` / `--until` / `--json` |
| `aichat list / login <v> / probe <v> --cookies / register <v> --cookies / health / unregister <v>` (v5.0.3.73) | AIChat WebView 鉴权向导 — 列 9 vendor / 拿 loginUrl / 校验 cookie / 注册 / 一次性 health / 注销 | `--cookies "<paste>"` / `--json` |
| `wechat env-probe / register --uin --db --wechat-data-path / list / unregister <uin>` (v5.0.3.75) | WeChat adapter — adb 设备 + frida-server + WeChat 版本探测 / 按 env-probe 自动选 md5\|frida provider 注册 / 列已注册 / 注销；`--force-provider md5\|frida` 旁路 env-probe 建议 | `--json` 全 verb 可机读 |
| `destroy --confirm` | 销毁 vault.db + WAL（不动 adapter 配置） | `--confirm`（必填，缺即拒） |

示例：

```bash
# 健康检查（人类可读，含色标）
cc hub health
# ✓ vault    schema=2
# ✓ llm      ollama:qwen2.5:7b-instruct [local]
# ✓ kgSink
# ✓ ragSink

# 跑分析 skill 拿 JSON 给后续脚本用
cc hub run-skill analysis.spending --since 1746028800000 --json | jq '.summary.totalSpend'

# Plan A — Android 在 app 内嵌终端里直接跑（cc 已 bundle 进 APK）
$ cc hub ask "上个月跟妈妈消息多少？"

# 销毁（脚本场景必须显式 --confirm）
cc hub destroy --confirm
```

**实现**：`packages/cli/src/commands/hub.js`（496 LOC）→ `getHub()` 复用 `personal-data-hub-wiring.js` 与 `cc ui` 同一份 LocalVault / OllamaClient / AdapterRegistry。Plan A 手机内嵌终端验证 (Xiaomi 24115RA8EC, 2026-05-20 T1/T2/T3 PASS)。

### 移动端访问

#### 当前状态（v5.0.3.72）

| 端 | 入口 | 状态 |
|---|---|---|
| Android | `SeedRegistry` 元数据 (`namespace=personal-data-hub`, 21 method) + UI scaffold | 🚧 v0.1 — 元数据已注册（24 个远程 skill 之一），数据层 `PersonalDataHubCommands.kt` ✅、UI 9 文件 scaffold 落地于 `:app/remote/ui/personalDataHub/` ✅、`RemoteOperateScreen` 第 14 tab 接通待 Phase 14.1 收口 |
| iOS | `RemoteOperateView` 第 16 tab "数据中台" + `Features/RemoteOperate/Views/PersonalDataHubViews.swift` (650 LOC, 3-tab) + `Modules/CoreP2P/Sources/RemoteSkills/PersonalDataHub/` (4 文件：Commands / Models / ViewModels / SyncEventDispatcher) + RemoteDependencies wired (含 fan-out 第 4 子流 hubSyncEventsStream buffer 256) | ✅ Phase 14.2 UI 完整落地 (`3db7b5a73` + `1d0c473a3`) — 22 method typed wrapper + 3 ViewModel (HubAsk / HubAdapters / HubAudit) 含隐私 gate sheet + citation chip + Phase 14.3.3.b eventId deep-link + race-guarded requestId；1491 LOC of tests (PersonalDataHubCommandsTests 628 + HubViewModelsTests 640 + HubSyncEventDispatcherTests 223)。docs-site 之前的 "scaffold lost to race / needs redo" 注释为 stale，2026-05-21 已修正 |

#### 推荐路径（已有基础设施，落地工作小）

移动端走**远程操控**链路（无需 Hub 在手机本地复刻 vault）：

```
iPhone / Android → P2P DC RPC (`hub.ask` 走 RemoteCommandClient)
                   → 桌面 mobile-bridge 主进程
                   → 桌面 personal-data-hub:ask IPC
                   → AskResult 回流到手机
```

这套链路 framework 全 reuse 既有：

- **Android**：iOS Phase 6 已有 `RemoteCommandClient.invoke()` 池 + `SeedRegistry` 23 skill。新加 `hub.ask` / `hub.stats` / `hub.health` / `hub.syncAdapter` 4 个 method 即可，工作量 ≈ 0.5 天 + UI（chat bubble 复用 Phase 5 AI Chat skill）≈ 1 天。
- **iOS**：同理，复用 Phase 5 `RemoteAIChatViewModel` 模式，约 1.5 天。

#### 数据流隐私约束

无论手机端走哪条路径，**所有 LLM 推理仍在桌面进程执行**，敏感数据不离开桌面：

1. 手机发送 NL question（带时间窗口 hint 即可，不附事实）
2. 桌面 `AnalysisEngine.ask()` 跑全套（query-parse → vault facts → RAG → prompt-build → 隐私 gate → LLM）
3. 仅 `AskResult { answer, citations, llmName, isLocal }` 回流手机
4. 引用 chip 在手机端点击 → 走 `hub.eventDetail` RPC 拉单条事件

> 隐私 Gate 在桌面侧执行：若桌面当前 LLM 非本地，手机端调用 `ask` 同样会被拒，UX 需把 `acceptNonLocal` 选项以"开关"暴露到手机端设置页。

#### 路线图

- ✅ Phase 14.0（Android 元数据）：`SeedRegistry` 已加 `personal-data-hub` namespace + 21 method metadata（commit 在 v5.0.3.72 一同 land），含 risk 分级（ask/stats/query/audit = Safe；syncAdapter/register* = Mutating；unregister* = Privileged 强 ApprovalUI）。
- 🚧 **Phase 14 完整设计稿已落**：[`docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](https://design.chainlesschain.com/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.html) — 6 sub-phase 拆分 / 21 method UI 暴露矩阵 / 5 OQ 含推荐 / 12 forward-looking traps / 8 真机 E2E 场景。Phase 14.1 已启动（数据层 + 桌面白名单测试已落）。
- 🚧 Phase 14.1（Android 接线 + UI）：
  1. ✅ 桌面 `mobile-skill-whitelist` 测试增强 — `personal-data-hub.*` namespace 通配验证 + 5 Privileged ApprovalUI 路由测试（23 单测，[`desktop-app-vue/src/main/remote/__tests__/mobile-skill-whitelist.test.js`](https://github.com/chainlesschain/chainlesschain)）
  2. ✅ 数据层 — `PersonalDataHubCommands.kt` 22 method typed wrapper（21 数据 + `runSkill` 分析）+ 27 模型 + 22 单测（[`android-app/app/src/main/java/com/chainlesschain/android/remote/commands/PersonalDataHubCommands.kt`](https://github.com/chainlesschain/chainlesschain)）。预发版静态审计发现所有多词 method 用了 camelCase（`listAdapters` / `syncAdapter` …），但桌面 `personal-data-hub-protocol.js` 注册的是 kebab-case（`list-adapters` / `sync-adapter` …）—— 17/22 method 跨端不匹配将在真机首调时 404。一次性 sed 修齐（生产 + 单测 + 桌面 whitelist 测试三处）；iOS Phase 14.2 自始即用 kebab-case，无需调整。
  3. ✅ **UI scaffold 已落** — 落地于 `:app/remote/ui/personalDataHub/`（与其它 remote skill UI 同 module，**未走原计划独立 feature module**，因 Hilt graph + RemoteCommandClient 注入路径都根植 `:app`）：
     - `HubAskScreen` + `HubAskViewModel`（核心 NL Q&A，含隐私 gate 弹窗 + citation chip + bottom sheet 详情拉取）✅
     - `HubAdaptersScreen` + `HubAdaptersViewModel`（adapter 列表 + 同步触发）✅
     - `HubAuditScreen` + `HubAuditViewModel`（审计日志 + action filter chip）✅
     - `HubHealthCard`（vault / llm / kgSink / ragSink 四件套）✅
     - `AcceptNonLocalDialog`（非本地 LLM 二次确认）✅
     - `PersonalDataHubScreen`（3 tab container — 提问 / Adapter / 审计）✅
     - 6 个 `HubAskViewModel` 单测覆盖隐私 gate 三态路径（本地直通 / 非本地 dialog / 确认重发 / dismiss 不污染 / 普通错误 toast / health init）✅
  4. ✅ **NavGraph 接通** — `RemoteOperateScreen` 加「个人数据中台」按钮 → 跳新路由 `Screen.PersonalDataHub`（`personal_data_hub`）→ 渲染 `PersonalDataHubScreen` 3-tab 容器。同时修了 9 个 UI scaffold + 1 个测试文件遗留的 `</content></invoke>` XML wrapper bug 与缺失的 class 闭合 brace（早前 Write tool 序列化吃掉了文件尾部）。
  5. ✅ Phase 5 AI Chat ChatBubble 模式已 land — `HubAskScreen` 替换 flat `Surface` 为 `HubChatBubble`（左下 4dp / 右下 4dp 不对称圆角 = bubble tail；assistant `secondaryContainer` 左对齐、user `primaryContainer` 右对齐；max width 320dp 防止长答案撑爆屏宽）+ `HubBlinkingCursor`（500ms reverse-fade，"▎"）填充 in-flight 状态。`HubAskUiState` 加 `submittedQuestion` field 把 "用户输入框实时内容" 与 "已提交问题快照" 解耦，允许用户在答案 bubble 显示时继续编辑下一题。streaming token-by-token wire-up 仍 defer — 当前 ViewModel 单射 ask；待 hub.ask 支持流式后改为 chunked emit + `HubBlinkingCursor` 续接尾部。
- ✅ **Phase 14.2 完整 (iOS — 数据层 + UI scaffold + ViewModels 全 land)**：(1) **数据层** (`Modules/CoreP2P/Sources/RemoteSkills/PersonalDataHub/PersonalDataHubCommands.swift` actor + **22 method wrapper** 完整对齐 Android Phase 14.1 + `PersonalDataHubModels.swift` **16 Codable struct** + 双 path JSON shape fallback + `HubClassification` / `HubExtraction` eventDetail join；每个 method 单测都断言 wire `method` 名是 kebab-case，回归保护 Android Phase 14.1 真踩过的 camelCase / kebab-case mismatch（[hidden-risk-traps.md #17](https://github.com/chainlesschain/chainlesschain/blob/main/docs/internal/hidden-risk-traps.md))；(2) **ViewModels** (`HubViewModels.swift`) — `HubAskViewModel` 隐私 gate sheet + acceptNonLocal 重发 + citation chip eventDetail / `HubAdaptersViewModel` list+sync+syncStream + dispatcher 三 sink mirror progress/completedReports/errors / `HubAuditViewModel` filter chip + Phase 14.3.3.b eventId deep-link with race-guarded requestId；(3) **UI scaffold** (`Features/RemoteOperate/Views/PersonalDataHubViews.swift`, 650 LOC) — 3-tab segmented (提问 / Adapter / 审计) Inner View + StateObject 模式 (per [`ios_inner_view_stateobject_pattern`](https://github.com/chainlesschain/chainlesschain) memory)；(4) **RemoteDependencies** wired (`self.hub = PersonalDataHubCommands(client:)` + `self.hubSyncDispatcher` + fan-out 第 4 子流 `hubSyncEventsStream` buffer 256)；(5) **RemoteOperateView** 第 16 tab `.personalDataHub` 接入 `PersonalDataHubView(pcPeerId:)`。**1491 LOC tests** (PersonalDataHubCommandsTests 628 + HubViewModelsTests 640 + HubSyncEventDispatcherTests 223)，CI 编绿 (`3db7b5a73` UI + `1d0c473a3` Phase 14.3.3.b deep-link)。先前 "scaffold lost to untracked-file race / 待重做" 注释为 stale (2026-05-21 audit 修正)。
- ✅ Phase 14.3（双端）：审计回查 + 同步进度推送 — 桌面 `personal-data-hub/route-mobile.js` 已注 `sendEventToPeer` 把 `sync-adapter-stream`/`sync-all-stream` 的 `personal-data-hub.sync.progress` 事件转发回手机；Android `HubSyncEventDispatcher.kt` + iOS `HubSyncEventDispatcher.swift` 第 4 子流（buffer 256）已 wire 进 RemoteDependencies；Phase 14.3.3.b eventId 审计 deep-link 双端 UI 全通（Android `HubAuditScreen.kt` clickable + ModalBottomSheet / iOS `HubAuditEventDetailSheet` 3-state sheet）
- ⏳ Phase 14.4（真机 E2E）：Mac + iPhone + Xiaomi 24115RA8EC + 真桌面，8 场景矩阵（详见设计文档 §8.3）

## A8 — Android 完全独立路径（不依赖桌面）

> **状态**：v0.1 (2026-05-22) — Bilibili 端到端 ✅ + 微博 / 抖音 / 小红书 占位卡片 ✅；端到端用例待真机执行（见 [`docs/design/A8_Bilibili_E2E_Plan.md`](https://design.chainlesschain.com/A8_Bilibili_E2E_Plan.html)）。

A8 与 Phase 14 远程操控是**两条独立路径**，回答不同的用户问题：

| 路径 | UI 入口 | 数据落地 | 桌面在线要求 |
|---|---|---|---|
| Phase 14（远程操控）| 个人数据中台 → 提问 / Adapter / 审计 | 桌面 vault | ✅ 需要在线 |
| **A8（Android 独立）** | 个人数据中台 → **本机数据** | **APK 内** SQLCipher LocalVault | ❌ 完全离线 |

### 工作原理

A8 路径**不**经过桌面 hub — Android 端独立完成全部步骤：

```
WebView 内用户登录 → CookieManager.getCookie() 提取
                   ↓
              本机加密存储 (EncryptedSharedPreferences AES-256-GCM)
                   ↓
              OkHttp × 4 端点 (history / favourite / dynamic / follow)
                   ↓
              拼装 snapshot.json 写 filesDir/.chainlesschain/staging/
                   ↓
              LocalCcRunner spawn in-APK cc 子进程 (mksh + Termux Node)
                   ↓
              cc hub sync-adapter --input <path> --json
                   ↓
              adapter._syncViaSnapshot → registry → 本机 SQLCipher LocalVault
                   ↓
              UI 显示 "已同步 N 条" + 上次同步时间
```

### 5 张卡片（v0.1）

进 **本机数据** tab 看到：

1. **本机数据** (system-data-android) ✅ — ContentResolver 通讯录 + PackageManager 已装应用，Plan A v0.1 已 ship
2. **Bilibili** (social-bilibili) ✅ — A8 v0.1 端到端 — 4 类事件（观看历史 / 收藏 / 动态 / 关注）
3. **微博** (social-weibo) 🚧 占位 — v0.2 开放（框架已就绪，API 未接通）
4. **抖音** (social-douyin) 🚧 占位 — v0.2 需 msToken/X-Bogus 签名
5. **小红书** (social-xiaohongshu) 🚧 占位 — v0.2 需 X-s 签名

### Bilibili 同步细节

| 数据 | API endpoint | 入 vault 类型 |
|---|---|---|
| 观看历史 | `/x/v2/history/cursor` | event (subtype=browse) + item (video) |
| 收藏 | `/x/v3/fav/folder/created/list-all` + 每文件夹 `/x/v3/fav/resource/list` | event (subtype=like) + item (video) |
| 动态 | `/x/polymer/web-dynamic/v1/feed/all` | event (subtype=browse) |
| 关注 | `/x/relation/followings` | person (subtype=contact) |

凭据存储：`pdh_social_bilibili` EncryptedSharedPreferences (AES-256-GCM + AndroidKeyStore master)，键名 `cookie / uid / displayName / lastSyncAtMs / lastSyncCount`。退出登录走 `prefs.edit().clear().apply()`。

### Plan A v0.1 引擎（A8 复用）

- in-APK cc 子进程：`LocalCcRunner` → mksh symlink execve (W^X + SELinux 兼容)
- 本机 vault：`@chainlesschain/personal-data-hub` LocalVault SQLCipher + bs3mc native binding
- snapshot mode：JS adapter `_syncViaSnapshot(opts.inputPath)`（A8 v0.1 新增）+ 保留 `_syncViaSqlite` 旧模式
- cli wiring 注册：`packages/cli/src/lib/personal-data-hub-wiring.js` 自动注册 `BilibiliAdapter` 在 boot 阶段

### v0.2 路线图

- 微博：WebView 抓 `SUB` JWT 解码 UID + `/api/container/getIndex` ~1.5d
- 抖音：需 hook `window.byted_acrawler.sign` 计算 msToken/X-Bogus ~2d
- 小红书：需 X-s 签名（同样 WebView JS evaluate）~2d
- Bilibili WBI 签名：如官方收紧 wbi-*  endpoint 强制启用，~0.5d 补

详见设计文档：[`Adapter_Social_Cookie.md`](https://design.chainlesschain.com/Adapter_Social_Cookie.html)。

## 配置参考

### 数据目录

所有 hub 状态落在用户数据目录下统一根 `.chainlesschain/hub/`：

| 平台 | 完整路径 |
|---|---|
| Windows | `%APPDATA%\chainlesschain-desktop-vue\.chainlesschain\hub\` |
| macOS | `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/hub/` |
| Linux | `~/.config/chainlesschain-desktop-vue/.chainlesschain/hub/` |

文件清单：

| 文件 | 用途 | 权限 |
|---|---|---|
| `vault.db` | SQLCipher AES-256 主库（events / persons / places / items / topics / kg_triples / raw_events / sync_watermarks / audit_log） | 由 SQLCipher 加密保护 |
| `vault.db-wal`, `vault.db-shm` | SQLite WAL 日志 | 同上 |
| `keys/vault.key` | FileKeyProvider 主密钥文件（hex） | **0600**（owner-only） |
| `email-accounts.json` | 已注册邮箱配置（含 authCode） | **0600** |
| `alipay-accounts.json` | 已注册支付宝账号（含 zipPassword） | **0600** |

> ⚠️ Phase 3.5b 的 FileKeyProvider 是**临时方案**。Phase 4 将引入 Windows DPAPI / macOS Keychain / Linux libsecret 桥，主密钥与配置文件双重托管。设计稿 `Personal_Data_Hub_Architecture.md §7.1`。

### 环境变量

cli / web-shell 端用 `OllamaClient` 作为默认 fallback LLM（桌面 Electron 端走 `LLMManager` singleton）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `CC_HUB_OLLAMA_URL` | `http://localhost:11434` | Ollama HTTP 端点 |
| `CC_HUB_OLLAMA_MODEL` | `qwen2.5:7b-instruct` | 模型 tag（先 `ollama pull` 拉好） |

桌面端 LLM provider 切换走既有 `cc llm` / 设置面板，hub 通过 `CcLLMAdapter` 直接读 `LLMManager.provider` 与 `.client.model`。

### 隐私 Gate 选项

调用 `ask` 时控制行为：

| 选项 | 默认 | 说明 |
|---|---|---|
| `options.acceptNonLocal` | `false` | 若 LLM 非本地（Anthropic / Volcengine / Gemini / DeepSeek 等），默认拒绝。**显式 `true` 才放行** — UI 应警告并请求确认 |
| `options.useRag` | `true` | 是否做 BM25 召回扩展上下文。关闭可加速但牺牲跨时段召回 |
| `options.timeWindow` | （从 question 解析）| 显式覆盖时间窗口 |
| `options.topK` | `10` | RAG 召回条数 |

### Adapter 注册参数

**Email**（详见 [`Adapter_Email_IMAP`](https://design.chainlesschain.com/Adapter_Email_IMAP.html)）：

```js
{
  account: {
    provider: "qq" | "gmail" | "163" | "custom",
    email: "you@example.com",
    authCode: "...",          // 授权码（非密码 — IMAP 专用）
    folders: ["INBOX"],       // 可选，默认 INBOX
    imapHost?: "...",         // custom provider 必填
    imapPort?: 993,
  },
  opts: {
    pdfPasswordHints: { "10位身份证后6位": "...", "手机号": "..." }, // PDF 解密候选
    sinceUid?: "0",           // 强制水位（调试用）
  }
}
```

**Alipay**（详见 [`Adapter_Alipay_Bill`](https://design.chainlesschain.com/Adapter_Alipay_Bill.html)）：

```js
{
  account: {
    email: "you@example.com",  // 仅作唯一标识；不连支付宝
    zipPassword: "...",        // 支付宝邮件附带的 ZIP 解压密码
  },
  opts: { /* reserved */ }
}
// 导入时：
hub.importAlipayBill({ zipPath: "C:/Users/.../alipay_bill_2026Q1.zip" });
// 或解压后单 CSV：
hub.importAlipayBill({ csvPath: "C:/Users/.../alipay_record.csv" });
```

## 性能指标

| 场景 | 指标 | 测试基线 |
|---|---|---|
| 1k events 全流水线 ingest（normalize → vault.putBatch → kgSink → ragSink → watermark → audit） | < 30s 目标 / **实测 ~600ms** | Phase 2 |
| LocalVault 单事件 put | < 5ms | Phase 1 |
| `vault.queryEvents` 含 subtype + 时间窗口 | < 50ms / 10k 库 | Phase 1 |
| `vault.findBySource(adapter, originalId)` 去重 | < 1ms（索引命中） | Phase 1 |
| `vault.rotateKey` 5MB 库 | < 2s（WAL-safe） | Phase 1 |
| EmailAdapter sync 100 封新邮件（QQ IMAP） | ~20-40s（受网络） | Phase 5.7 真账号 |
| AlipayBillAdapter import 1 季度账单（~500 行 CSV） | < 5s | Phase 6 smoke |
| AnalysisEngine `ask` 单次（Ollama qwen2.5:7b, RAG topK=10） | ~3-8s（受 GPU/CPU） | Phase 3 |
| Hub 冷启动 (`getHub()` 首次) | ~100-200ms（vault open + migrations + bridge wire） | 测量 |
| 全部 IPC 通道注册 | < 5ms | 测量 |

> Phase 4 计划 partition 索引 + 异步 KG/RAG sink，进一步把 1k events 推到 < 200ms。

## 测试覆盖率

- **总单测**：55 个测试文件 / **1007 单元测试**（最新基线 v5.0.3.73 含 Phase 10.2 集成 + E2E 9 新测 + AIChat registry-contract bug fix + 2026-05-21 doubao/toutiao/kuaishou scaffold + analysis-skills backfill + WeChat Phase 12.6 §18.1-6 全套，`npx vitest run` 全绿，~38s）
- **覆盖矩阵**：
  - `__tests__/ids.test.js` — UUID v7 唯一性 / 时间序性
  - `__tests__/schemas.test.js` — 5 类实体所有 subtype + 边界字段
  - `__tests__/batch.test.js` — empty / merge / validate / partition
  - `__tests__/key-providers.test.js` — InMemory + File 双实现 + 旋转
  - `__tests__/vault.test.js` — open / migrations / putBatch transactional / rollback / queryEvents / watermarks / rotateKey WAL-safe / destroy
  - `__tests__/registry.test.js` — health-gating / mid-sync failure recovery / sink failure tolerance / 1k events perf gate
  - `__tests__/kg-derive.test.js` + `rag-derive.test.js` — 三元组 / RagDoc 生成
  - `__tests__/query-parser.test.js` — 时间窗口 + 意图提取
  - `__tests__/prompt-builder.test.js` — system 不漏事实 + 用户角色挂事实 + citation 解析
  - `__tests__/analysis.test.js` — 全 E2E ask 路径 + 隐私 gate 拒绝 + citation 校验
  - `__tests__/bridges-cc-*.test.js` — CcLLMAdapter / CcKgSink / CcRagSink DI 单测
  - `__tests__/entity-resolver*.test.js` — Phase 8 三段 pipeline + ingest hook + vault schema
  - `__tests__/analysis-skills.test.js` — Phase 11 5 个内置分析 skill (spending / relations / footprint / interests / timeline)
  - `__tests__/shopping-adapters.test.js` — Phase 7 Taobao + JD + Meituan
  - `__tests__/travel-adapters.test.js` — Phase 9 Amap + Baidu Map + Ctrip + 12306
  - `__tests__/adapters/email-imap/*` — IMAP session + parser + classifier + transactions + pdf-extractor + 6 templates
  - `__tests__/adapters/alipay-bill/*` — csv-parser + zip-decryptor + counterparty + adapter
  - `__tests__/adapters/ai-chat-history*.test.js` — Phase 10.1 contract / schema-map / 8 vendor-spec + Phase 10.2 HttpClient + 各厂商响应解析
  - `__tests__/social-adapters.test.js` + `longtail-adapters.test.js` — Phase 13 social/messaging adapter (Bilibili / Weibo / Douyin / Xiaohongshu / QQ / Telegram)
  - `__tests__/whatsapp-adapter.test.js` — Phase 13.7 WhatsApp crypt14 stub + sqlite parse
  - `__tests__/wechat-adapter.test.js` — Phase 12 v0.5 frida-indep slice
  - `__tests__/mobile-extractor.test.js` — Phase 7.5 ADB + iTunes backup
  - `__tests__/sidecar-supervisor.test.js` + `sidecar-contacts-cross-validate.test.js` — Phase 4.5 Python sidecar 生命周期
- **未覆盖**：真账号 IMAP / 真 Alipay ZIP / 真 8 厂商 cookie / 真 Android rooted 微信 DB 端到端 — 走 `Personal_Data_Hub_E2E_Runbook.md` 手工跑

跑测：

```bash
cd packages/personal-data-hub
npm test                                  # 全部 (47 file / 927 test)
npx vitest run __tests__/vault.test.js    # 单文件
```

## 安全考虑

1. **本地优先存储**：vault.db 由 SQLCipher AES-256 加密；主密钥不入仓、不入云、不打包进 release。
2. **0600 文件权限**：`keys/vault.key`、`email-accounts.json`、`alipay-accounts.json` 全部 owner-only — 同机其它用户也读不到。
3. **临时 FileKeyProvider 已知风险**：当前主密钥与 IMAP authCode / ZIP 密码同目录文件落盘，威胁模型一致（同机有 root 即全失守）。Phase 4 升级为 DPAPI / Keychain 解决。
4. **隐私 Gate 默认拒非本地 LLM**：`AnalysisEngine` 通过 `llm.isLocal` 判定；Ollama / 自托管 vLLM = 本地；Anthropic / Volcengine / Gemini / DeepSeek = 非本地，必须显式 `acceptNonLocal: true` 才放行。
5. **Prompt 隔离**：所有 vault 事实放在 user role 消息 + 显式 `untrusted-data:` 标记，**system prompt 不含**任何用户数据 — 防 prompt injection 直接污染 system 指令。
6. **Citation 强校验**：LLM 必须用 vault 真实 eventId 作 cite，`validateCitations` 比对找不到的会标 `citation-invalid` — 防幻觉 + 用户可点回查证。
7. **全过程审计**：每一次 ingest / ask / register / unregister / sync 落 `audit_log`，含 actor / adapter / eventId / action / timestamp / context。任何 LLM 给出的答案都能反查到底是哪些事件、哪个 adapter、什么时间入库。
8. **Validator 永不抛**：脏数据进 invalid 队列而非 crash，单条坏记录不会让攻击者通过制造畸形数据触发拒绝服务。
9. **WAL-safe 密钥旋转**：`vault.rotateKey(newHex)` 内部接管 WAL 模式切换，旧密钥保留为 `vault:<id>:prev` 24h 回滚窗口；定期旋转可降低密钥泄露后果。
10. **可销毁 (vault.destroy)**：单调用清理 vault.db + WAL + 关联密钥 — 兑现"数据走得了"承诺。
11. **跨壳一致权限模型**：Hub 通过 Skill 系统挂载，自然继承 Skill marketplace permission whitelist（per `v6_plugin_ipc_permission_model`）。
12. **adapter 上限敏感度声明**：每个 Adapter 必须实现 `dataDisclosure.sensitivity ∈ {low, medium, high, critical}`，UI 据此着色 + 高敏感 adapter 操作弹二次确认。

> ⚠️ **未做的**：(a) U-Key/SIMKey 加固主密钥 — 设计中走 Phase 4 / 7；(b) 多用户共享 vault — 中台只服务"我"，不做家庭 / 团队共享；(c) 对外发布数据 API — 设计明确不做。

## 故障排查

### `ask` 返回 `error: "Analysis engine unavailable — LLM manager not initialized"`

- **检查**：`personal-data-hub:health` 返回 `llm.ok === false`
- **原因**：桌面端 LLM Manager 尚未初始化，或 cli 端 Ollama 没起
- **修复**：
  - 桌面：打开 设置 → AI 模型，选并测一个 provider
  - cli：`ollama serve` 起来 + `ollama pull qwen2.5:7b-instruct`；如果改了端口 `export CC_HUB_OLLAMA_URL=http://localhost:你的端口`

### `ask` 返回 `error: "Non-local LLM blocked — pass options.acceptNonLocal=true to override"`

- **原因**：隐私 Gate 拒绝。当前 active provider 不在本地白名单（Ollama / vLLM）
- **修复**（按推荐顺序）：
  1. 切回 Ollama（设置 → AI 模型 → Ollama）
  2. 或前端给用户一个明确的"我接受把数据发到 X"提示，确认后传 `{ acceptNonLocal: true }`

### EmailAdapter 注册抛 `IMAP authentication failed`

- **原因**：用了**登录密码**而不是**授权码**
- **修复**：QQ 邮箱 / 163 / Gmail 等都需到邮箱"安全 → IMAP/SMTP → 生成授权码"，把那串 16 位的字符填进去
- **诊断**：先用 `test-email-auth` 通道（不持久化）单独验证

### Alipay 导入抛 `Wrong password or corrupted zip`

- **原因**：(a) `zipPassword` 拼错；(b) 从 App 导出时勾错了；(c) 邮件转发污染了 ZIP
- **修复**：
  1. 重新登录支付宝 App → 我的 → 账单 → 导出账单 → **明文记下密码** → 邮件正文应直接附 ZIP
  2. 解压一次测试，能解开再传给 `import-alipay-bill`
  3. 单独的 CSV 也支持：解压后 `importAlipayBill({ csvPath: "..." })`

### LocalVault 抛 `SQLITE_NOTADB: file is not a database`

- **原因**：(a) `vault.key` 被覆盖或换了；(b) vault.db 文件部分损坏
- **修复**：
  1. **不要删 vault.db**，先备份整目录
  2. 检查 `keys/vault.key` 是否还在且 64 hex 字符
  3. 如 `vault:default:prev` 还存在，临时改 key name 试旧密钥
  4. 最后手段：`vault.destroy()` + 重 ingest（数据可重新从 adapter 拉）

### Hub 冷启动卡 / `getHub()` 长时间不返回

- **原因**：通常是 LocalVault migrations 在跑首次大量 schema 演化，或 SQLCipher 在初始化加密块
- **修复**：等。100-200ms 是正常上限；如果 >10s 看 `hub.log` 是否有 "Vault opened at … (schema vN)" — 没有就 vault 文件损坏，按上一条处理

### 端口 11434 冲突 / cc ui 启不来

- **诊断**：`curl http://localhost:11434/api/tags` 应回 Ollama 模型列表
- **修复**：换端口 `OLLAMA_HOST=0.0.0.0:11435 ollama serve` + `CC_HUB_OLLAMA_URL=http://localhost:11435`

### Web-Panel 看不到 hub 卡片

- **原因**：(a) WS gateway 没注册 hub protocol；(b) 走的是旧 build 的 web-panel
- **修复**：升级到 v5.0.3.39+；确认 `packages/cli/src/gateways/ws/message-dispatcher.js` 引入了 `PERSONAL_DATA_HUB_HANDLERS` + `PERSONAL_DATA_HUB_STREAMING_HANDLERS`

## 关键文件

### Hub 核心（`packages/personal-data-hub/lib/`）

| 文件 | 职责 |
|---|---|
| `constants.js` | enum 值（entity types / subtypes / capturedBy / …） |
| `ids.js` | UUID v7 时间序 ID（RFC 9562, 零依赖） |
| `schemas.js` | 5 类实体校验器（`validatePerson` / `validateEvent` / …） |
| `batch.js` | NormalizedBatch helpers（empty / merge / validate / partition） |
| `migrations.js` | 8 张表 + 版本演化 |
| `vault.js` | LocalVault — SQLCipher AES-256 / 事务 / 查询 / 水位 / 审计 / 密钥旋转 |
| `key-providers.js` | InMemory + File + KeyProvider 契约 |
| `adapter-spec.js` | `PersonalDataAdapter` 接口 + `assertAdapter` |
| `kg-derive.js` | UnifiedSchema → KG 三元组 |
| `rag-derive.js` | UnifiedSchema → RagDoc |
| `registry.js` | AdapterRegistry 全流水线 |
| `mock-adapter.js` | deterministic MockAdapter（测试 + smoke） |
| `query-parser.js` | NL question → 时间窗口 + 意图 |
| `prompt-builder.js` | 事实摘要 + system/user 提示构造 + citation 解析 / 校验 |
| `llm-client.js` | MockLLMClient + OllamaClient |
| `analysis.js` | AnalysisEngine — `ask` 编排 + 隐私 gate |
| `bridges/cc-llm-adapter.js` | 桌面 LLMManager 注入 |
| `bridges/cc-kg-sink.js` | cc knowledge-graph addEntity / addRelation 桥 |
| `bridges/cc-rag-sink.js` | cc BM25 写入桥 |
| `adapters/email-imap/*.js` | EmailAdapter（IMAP / parser / classifier / templates / pdf / transactions） |
| `adapters/alipay-bill/*.js` | AlipayBillAdapter（csv-parser / zip-decryptor / counterparty） |
| `adapters/system-data/*.js` | SystemDataAdapter（Python sidecar 桥 / 通讯录 / 通话 / 短信 / WiFi） |
| `adapters/_python-sidecar-base.js` | Python forensics-bridge 子进程生命周期管理（spawn / heartbeat / restart） |
| `adapters/shopping-base/*` | Phase 7 共享 Cookie 客户端 + rate-limit |
| `adapters/shopping-taobao/` + `shopping-jd/` + `shopping-meituan/` | Phase 7 三家电商 adapter |
| `adapters/travel-base/*` | Phase 9 共享 LBS Cookie 客户端 |
| `adapters/travel-amap/` + `travel-baidu-map/` + `travel-ctrip/` + `travel-12306/` | Phase 9 四家旅行 / 地图 adapter |
| `adapters/ai-chat-history/{http-client,cookie-auth,schema-map,vendors/*}.js` | Phase 10 共享 HttpClient（cookie + rate-limit + 退避）+ 8 厂商 vendor-spec |
| `adapters/social-{bilibili,weibo,douyin,xiaohongshu}/index.js` | Phase 13 四 social adapter（借 sjqz parser 移植） |
| `adapters/messaging-{qq,telegram,whatsapp}/index.js` | Phase 13 三 messaging adapter（含 WhatsApp crypt14） |
| `adapters/wechat/{content-parser,key-extractor,db-reader,normalize,wechat-adapter}.js` | Phase 12 v0.5 WeChat frida-indep slice |

### 桌面端接线（`desktop-app-vue/src/main/`）

- `personal-data-hub/wiring.js` — 懒单例 + LLMManager 注入 + 邮箱/支付宝账号持久化
- `ipc/personal-data-hub-ipc.js` — 全部 hub IPC 通道注册（v5.0.3.72 含 destroy / EntityResolver / 分析 skill / 流式同步）

### CLI / Web-Shell 接线（`packages/cli/`）

- `src/lib/personal-data-hub-wiring.js` — 镜像桌面 wiring（OllamaClient + 同 vault 目录）
- `src/gateways/ws/personal-data-hub-protocol.js` — 全部 WS 主题镜像 IPC + `.event` 流式 + destroy

### Web-Panel UI（`packages/web-panel/src/`）

- `views/PersonalDataHub.vue` — 桌面 + cc ui 共用页
- `composables/usePersonalDataHub.js` — shell-agnostic 调用层

### 测试（`packages/personal-data-hub/__tests__/`）

26 个 `*.test.js` 文件，~400+ 单测

### 设计文档（`docs/design/`）

- `Personal_Data_Hub_Architecture.md` — 主架构 + 13-Phase 路线图
- `Personal_Data_Hub_E2E_Runbook.md` — 真账号 E2E 手工验收脚本
- `Personal_Data_Hub_EntityResolver.md` — 跨源人物/地点消歧设计
- `Adapter_Email_IMAP.md` — 邮箱 adapter 细节
- `Adapter_Alipay_Bill.md` — 支付宝 adapter 细节
- `Adapter_AIChat_History.md` — 8 家国产 AI + ChatGPT/Claude 历史抓取设计
- `Adapter_WeChat_SQLCipher.md` — 微信 SQLCipher 直读设计

## 使用示例

### 1. 注册邮箱并增量同步

```js
// 1) 测试授权（不持久化）
const probe = await window.electron.invoke("personal-data-hub:test-email-auth", {
  account: {
    provider: "qq",
    email: "me@qq.com",
    authCode: "xxxxxxxxxxxxxxxx", // 邮箱设置里生成的 16 位授权码
  },
});
if (!probe.ok) {
  console.error("auth failed:", probe.reason || probe.error);
  return;
}

// 2) 正式注册（持久化到 email-accounts.json）
await window.electron.invoke("personal-data-hub:register-email", {
  account: { provider: "qq", email: "me@qq.com", authCode: "..." },
  opts: { pdfPasswordHints: { "身份证后6位": "123456" } },
});

// 3) 流式同步带进度
const ch = `pdh-${Date.now()}`;
window.electron.on(ch, (_e, evt) => {
  console.log(evt.kind, evt.adapter, evt.partition, evt.detail);
});
const report = await window.electron.invoke(
  "personal-data-hub:sync-adapter-stream",
  {
    name: "email-imap",
    options: { since: Date.now() - 30 * 86400 * 1000 }, // 最近 30 天
    progressChannel: ch,
  },
);
console.log("ingested", report.ingested, "events");
```

### 2. 导入支付宝账单（ZIP）

```js
// 用户在桌面 PersonalDataHub 页面拖入 ZIP 文件 → 自动调下面
// 从支付宝邮件正文复制下来的解压密码：
const zipPassword = "..."; // ← 替换为真实密码
await window.electron.invoke("personal-data-hub:register-alipay", {
  account: { email: "me@anything.com", zipPassword },
});
const report = await window.electron.invoke(
  "personal-data-hub:import-alipay-bill",
  { zipPath: "C:/Users/me/Downloads/alipay_bill_2026Q1.zip" },
);
console.log(`ingested ${report.ingested} payment events`);
```

### 3. 自然语言问问题

```js
const { answer, citations, llmName, isLocal } = await window.electron.invoke(
  "personal-data-hub:ask",
  {
    question: "上个月我在淘宝买了啥总共花了多少？给个清单。",
    options: { useRag: true },
  },
);
console.log(answer);
console.log("依据:", citations.map((c) => c.eventId));
// 点击 citation → event-detail 查原始事件
```

cli 同等命令（走 WS）：

```bash
cc ui            # 起本地 web-shell
# 在 SPA 内或通过 WS 直接发：
# { "type": "personal-data-hub.ask", "id": "1", "question": "..." }
```

### 4. 手动注册 MockAdapter 跑 smoke

开发时验证流水线（vault + KG + RAG + audit 一条龙）通畅：

```js
await window.electron.invoke("personal-data-hub:register-mock", {
  name: "mock",
  count: 100,
  seed: 42,
});
const stats = await window.electron.invoke("personal-data-hub:stats");
console.log("vault has", stats.vault.events, "events after mock sync");
```

### 5. 审计回查

```js
const audit = await window.electron.invoke("personal-data-hub:recent-audit", {
  action: "ingest",
  since: Date.now() - 86400 * 1000,
  limit: 50,
});
for (const row of audit) {
  console.log(row.action, row.adapter, row.eventId, new Date(row.at));
}
```

### 6. 数据销毁（一键 wipe）

> ✅ v5.0.3.72 起暴露专门 IPC + WS 主题 `destroy`（双端对称登记）。要求显式 `confirm: true` 防意外调用；可选 `alsoWipeAccounts` / `alsoWipeMasterKey` 进一步扩大清理范围。UI 调用前必须二次确认。

```js
// 桌面 Electron
const r = await window.electron.invoke("personal-data-hub:destroy", {
  confirm: true,              // 必须；缺省直接返回 error
  alsoWipeAccounts: true,     // 可选：清 email-accounts.json + alipay-accounts.json
  alsoWipeMasterKey: false,   // 可选：清 keys/vault.key（**会让残留 -wal/-shm 永远打不开，谨慎用**）
});
// → { ok: true, removed: ["C:/.../vault.db", "C:/.../vault.db-wal", ...] } 或 { error }

// cc ui / web-shell
await ws.executeJson({
  type: "personal-data-hub.destroy",
  confirm: true,
  alsoWipeAccounts: true,
});
```

幕后：调 `hub.vault.destroy()` 删 vault.db + WAL + SHM，按 flag 清账号配置 / 主密钥，最后 `close()` 释放单例 — 下一次 `getHub()` 会从空白重建。

## 相关文档

### 同类核心功能

- [知识库管理](/chainlesschain/knowledge-base) — 中台派生的 KG / RAG 写入目标
- [数据加密](/chainlesschain/encryption) — SQLCipher / FileKeyProvider / Phase 4 升级到平台 Keystore
- [U盾集成](/chainlesschain/ukey) / [SIMKey集成](/chainlesschain/simkey) / [蓝牙U-Key](/chainlesschain/ble-ukey) — 硬件加固主密钥（Phase 4 + Phase 7 路线）
- [AI模型配置](/chainlesschain/ai-models) — Ollama / 各 provider 切换；隐私 Gate 直接读这里
- [永久记忆系统](/chainlesschain/permanent-memory) — 中台 vault 与既有记忆系统的关系

### 多智能体 / 数据消费

- [Cowork 多智能体协作](/chainlesschain/cowork) — 分析复杂跨源问题时由 Cowork 编排
- [日常任务协作](/chainlesschain/web-cowork) — Web 端 cowork
- [上下文工程](/chainlesschain/context-engineering) — Hub 数据如何注入 LLM 上下文

### 同步 / 部署

- [移动端同步](/chainlesschain/mobile-sync) — Hub 数据跨设备的 P2P 同步路径
- [Git同步](/chainlesschain/git-sync) — 备份 vault 的外部选项

### 设计文档（design.chainlesschain.com）

- [个人数据中台 主架构](https://design.chainlesschain.com/Personal_Data_Hub_Architecture.html) — 13-Phase 路线图、OQ 决策、整体架构图
- [Phase 11 Analysis Skills](https://design.chainlesschain.com/Personal_Data_Hub_Analysis_Skills.html) — 5 内置 skill (spending/relations/footprint/interests/timeline) 输入输出契约 + Trap + 新 skill checklist
- [EntityResolver 设计](https://design.chainlesschain.com/Personal_Data_Hub_EntityResolver.html) — 跨源 Person / Place 消歧（A+B+C+D 四段式）
- [E2E Runbook](https://design.chainlesschain.com/Personal_Data_Hub_E2E_Runbook.html) — 真账号端到端手工验收脚本
- [Adapter — Email (IMAP)](https://design.chainlesschain.com/Adapter_Email_IMAP.html)
- [Adapter — 支付宝账单](https://design.chainlesschain.com/Adapter_Alipay_Bill.html)
- [Adapter — AI 对话历史 (8 家国产 + ChatGPT/Claude)](https://design.chainlesschain.com/Adapter_AIChat_History.html)
- [Phase 10.3 AIChat WebView 鉴权向导](https://design.chainlesschain.com/Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.html) — 9 家国产 AI 统一 cookie 抓取向导：桌面 Electron BrowserView A 级 / cc ui 粘贴 fallback C 级 / 移动端经由 Phase 14 远程；4 新 IPC + 9 vendor cookie matrix + 10 forward-looking traps + 4 天工期估
- [Adapter — 微信 SQLCipher](https://design.chainlesschain.com/Adapter_WeChat_SQLCipher.html)
- [Phase 12.9 WeChat 真机 E2E Runbook (frida-dep path)](https://design.chainlesschain.com/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.html) — 11 场景验收 (首次 ingest / 解密 spot-check / ask Q&A / citation 反查 / 大库性能 / 增量 / hook resilience / 反检测 / 失败恢复 / 隐私 gate / 24h 长稳)；与 `Adapter_WeChat_SQLCipher_Frida_Setup.md`（setup-only）和 `Personal_Data_Hub_E2E_Runbook.md §11`（注册流程）三件套组成 WeChat 12.6 完整验收链
- [Adapter — 系统数据 (Android 通讯录 / 通话 / 短信 / WiFi)](https://design.chainlesschain.com/Adapter_System_Data.html)
- [Adapter — 电商 Cookie (Taobao / JD / Meituan)](https://design.chainlesschain.com/Adapter_Shopping_Cookie.html)
- [Adapter — 出行 / LBS (Amap / Baidu / Ctrip / 12306)](https://design.chainlesschain.com/Adapter_Travel_LBS.html)
- [Adapter — Social + Messaging (Bilibili / Weibo / Douyin / 小红书 / QQ / Telegram / WhatsApp)](https://design.chainlesschain.com/Adapter_Social_Messaging.html)
- [Python Sidecar 架构 (forensics-bridge fork from sjqz)](https://design.chainlesschain.com/Personal_Data_Hub_Python_Sidecar.html)
- [PDH vs sjqz 借鉴方案对比](https://design.chainlesschain.com/Personal_Data_Hub_sjqz_Comparison.html)
- [Phase 14 移动端原生入口（Android + iOS）](https://design.chainlesschain.com/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.html) — Plan B 远程操控模式：Mobile-bridge → typed RPC → SwiftUI/Compose UI；21 method 全 wire；6 sub-phase + 8 真机 E2E 场景
- [Phase 14.3 双端流式同步进度 + 审计回查](https://design.chainlesschain.com/Personal_Data_Hub_Phase_14_3_Sync_Audit_Streaming.html) — 14.3 详细设计：wire schema (`personal-data-hub.sync.progress` 4+1 状态机) + Android/iOS HubSyncEventDispatcher 模板 + fan-out 第 4 子流 + 双端 UI 模式 + 24+ 新单测目标
- [v0.1 Scaffold → v1 Fixture Pin Protocol](https://design.chainlesschain.com/Personal_Data_Hub_Fixture_Pin_Protocol.html) — 通用方法论：HAR/DB capture → field-rename-map → fixture-driven test → 真账号 smoke → v1 sign-off gate；覆盖 Doubao (Phase 10.4) + Toutiao/Kuaishou (Phase 13.10) + 任意未来 scaffold
- [Plan A — Android 本机独立 PDH via in-APK cc CLI](https://design.chainlesschain.com/Personal_Data_Hub_Android_Standalone_Cc.html) — 不依赖桌面：vault / Ollama 兜替（llama.rn 端侧）/ adapter pipeline 全部在手机本地跑；APK 已 bundled cc 验证 (Phase 2.5)；跨 app sandbox 5 路径分级；~10-16d 工时
- [Cc CLI 自然语言驱动 — 管理手机其他 App + 数据](https://design.chainlesschain.com/Cc_NL_Phone_App_Manager.html) — `cc nl "<NL>"` 顶层命令；4 类 intent (query/ingest/control/action) + 端侧 1.5-3B LLM + 规则 fast-path + 隐私 gate + 高敏 confirm；~5d 工时

---

> **反馈与跟进**：中台是 ChainlessChain 兑现"数据回归个人"承诺的支柱。所有 13-Phase 路线图 adapter 已落地（v5.0.3.72），下一步主攻方向：Phase 10.3 AIChat 8 厂商 WebView 真账号 smoke + Phase 12.6+ WeChat 8.0+ frida-dep 路径 + Phase 14 移动端原生入口。欢迎在 GitHub issues 中标注 `area:personal-data-hub` 提需求 / bug / 新 Adapter 提议。
