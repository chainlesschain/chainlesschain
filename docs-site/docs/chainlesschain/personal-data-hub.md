# 个人数据中台 (Personal Data Hub)

> **版本: v5.0.3.72 (Phase 0–13 全部落地 + 集成/E2E 测试收口 + Phase 14 设计稿 + Phase 14.1 Android 数据层落地 + 3 新 adapter scaffold, 2026-05-20) | 状态: ✅ 可用 — 19 个 Adapter ✅ + 3 个 v0.1 scaffold (豆包 Doubao + 今日头条 Toutiao + 快手 Kuaishou) — 总计 22 (Email + Alipay + SystemData + WeChat v0.5 + 4 Travel + 3 Shopping + 6 Social + 3 Messaging + 9 AIChat 厂商) + Mobile Extraction Layer (Android ADB / iOS iTunes backup) + EntityResolver 跨源人物归并 + 5 内置 Analysis Skill (Spending / Relations / Footprint / Interests / Timeline) | 21 IPC 通道 + 21 WS 主题 + Phase 14.1 Android `PersonalDataHubCommands.kt` 21 method typed wrapper | **50 测试文件 / 952 测试（含 6 集成 + 3 E2E 场景 + 16 新 scaffold + 22 Android PDH 单测）** | 设计文档: 13-Phase 路线图 + 7 个 Adapter 专题 + EntityResolver + sjqz 借鉴比对 + Phase 14 移动端原生入口**
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

> 截至 2026-05-20，所有路线图 adapter (Phase 5/6/4.5/7.5/7/9/10/12/13) 已全部完成首版实现并合入主干；WeChat (12) 与 AIChatHistory UI (10.3) 还有 follow-up。

| Adapter | 状态 | 数据源 | 采集机制 | 验证 |
|---|---|---|---|---|
| **EmailAdapter** | ✅ 已上线 (Phase 5.1-5.7) | IMAP 邮箱（QQ / Gmail / 163 / …） | IMAP 授权码 + UID 水位 + PDF 解密 + 6 模板 | 单测 ≥390 / E2E 真账号 OK |
| **AlipayBillAdapter** | ✅ 已上线 (Phase 6.1-6.5) | 支付宝官方账单 ZIP | 用户在 App 内导出 → 拖入桌面 / Web → ZIP 解密 + CSV 解析 + 对手方归一化 | smoke test green |
| **SystemDataAdapter** | ✅ 已上线 (Phase 4.5) | Android 通讯录 / 通话 / 短信 / WiFi | Python sidecar (forensics-bridge) + adb pull | 单测 50+ |
| **Mobile Extraction Layer** | ✅ 已上线 (Phase 7.5) | Android ADB + iOS iTunes backup 提取层 | adb / pymobiledevice3 | 单测 + 真机 E2E |
| **EntityResolver** | ✅ 已上线 (Phase 8) | 跨源 Person / Place 消歧 | 三段 pipeline（规则 + embedding + LLM）+ ingest hook + UI 队列 | 单测全绿 |
| **5 Analysis Skills** | ✅ 已上线 (Phase 11) | spending / relations / footprint / interests / timeline | 内置 skill + Workflow | 单测全绿 |
| **TaobaoAdapter** | ✅ 已上线 (Phase 7) | 淘宝订单 / 收藏 / 评价 / 收货地址 | Cookie + web API（共享 `shopping-base`）| 单测全绿 |
| **JDAdapter** | ✅ 已上线 (Phase 7) | 京东订单 / 收藏 / 评价 | Cookie + web API | 单测全绿 |
| **MeituanAdapter** | ✅ 已上线 (Phase 7) | 美团订单 / 外卖 / 收藏 | Cookie + web API | 单测全绿 |
| **AmapAdapter** | ✅ 已上线 (Phase 9) | 高德足迹 / 收藏地点 | Cookie + my.amap.com API（共享 `travel-base`）| 单测全绿 |
| **BaiduMapAdapter** | ✅ 已上线 (Phase 9) | 百度地图足迹 / 收藏 | Cookie + map.baidu.com API | 单测全绿 |
| **CtripAdapter** | ✅ 已上线 (Phase 9) | 携程酒店 / 机票 / 火车票订单 | Cookie + my.ctrip.com API | 单测全绿 |
| **12306Adapter** | ✅ 已上线 (Phase 9) | 12306 行程 / 订单 | 被动 webRequest 拦 + JSON 解析 | 单测全绿 |
| **AIChatHistoryAdapter × 9** | ✅ 已上线 × 8 + 🚧 Doubao v0.1 scaffold | 9 家国产 AI（DeepSeek / Kimi / 通义千问 / 智谱清言 / 腾讯混元 / 百度千帆 / 字节扣子 / 即梦 Dreamina + **豆包 Doubao**(text AI, Phase 10.2 9th, scaffold)） | 共享 HttpClient (cookie + rate-limit + 指数退避) + 各家 h5 API | 79 单测 + Doubao 5 单测；剩 Phase 10.3 WebView 真账号 smoke + Phase 10.4 Doubao fixture pin |
| **Social × 6** (Bilibili / Weibo / Douyin / Xiaohongshu + **Toutiao + Kuaishou**) | ✅ × 4 + 🚧 v0.1 scaffold × 2 | Android 本机 SQLite (B 站 history / 微博 timeline / 抖音 watch / 小红书 收藏 / 今日头条 read_history / 快手 photo_history) | Mobile Extraction Layer pull + 借 sjqz parser 移植 | 单测全绿（含 Toutiao 6 + Kuaishou 5 scaffold 单测）；Toutiao/Kuaishou 真账号 fixture pin pending |
| **Messaging × 3** (QQ / Telegram / WhatsApp) | ✅ 已上线 (Phase 13.5-13.7) | Android 本机加密 SQLite（QQ msg.db / TG / WhatsApp msgstore.db crypt14）| MEL pull + key-provider 解密 + sjqz parser 移植 | 单测全绿 |
| **WechatAdapter** | 🚧 v0.5 已落地 (Phase 12 frida-indep slice) | 微信本地 SQLCipher DB（Android 7.x 路径 + PC WeChat Files）| content-parser + MD5(IMEI+UIN)[:7] 解密 + SQLCipher 三 pragma profile | 41 单测；剩 Phase 12.6+ frida-dep (Android 8.0+ libwcdb hook) + Phase 12.9 真机 E2E |

> Phase 13 七个 adapter 借 sjqz 已有 Python parser 移植到 Node.js — 详见 [`Adapter_Social_Messaging.md`](https://design.chainlesschain.com/Adapter_Social_Messaging.html)（本批最新加入）。Toutiao §11 + Kuaishou §12 v0.1 scaffold 设计章节已补 (2026-05-20)；Doubao AIChat 9th vendor §6.9 详设亦补完。

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
| 当前合计 | — | — | **50 文件 / 954 测试**（含 Phase 10.2 集成 + E2E 6 + 3 场景；doubao scaffold + toutiao/kuaishou scaffold 已 land 2026-05-21）|

> 全部路线图 phase 已实施完成。剩余 follow-up：Phase 10.3+ (8 厂商 AIChat WebView UI cookie 拦截 + 真账号 smoke) ≈ 4 天；Phase 12.6+ (WeChat 8.0+ Android frida-dep libwcdb hook 路径) ≈ 3 天；Phase 12.9 (WeChat rooted device 真机 E2E) ≈ 1 天。

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

### 移动端访问

#### 当前状态（v5.0.3.72）

| 端 | 入口 | 状态 |
|---|---|---|
| Android | `SeedRegistry` 元数据 (`namespace=personal-data-hub`, 21 method) + UI scaffold | 🚧 v0.1 — 元数据已注册（24 个远程 skill 之一），数据层 `PersonalDataHubCommands.kt` ✅、UI 9 文件 scaffold 落地于 `:app/remote/ui/personalDataHub/` ✅、`RemoteOperateScreen` 第 14 tab 接通待 Phase 14.1 收口 |
| iOS | `RemoteOperateView` 第 16 tab "数据中台" + `Features/PersonalDataHub/` + `Modules/CoreP2P/Sources/RemoteSkills/PersonalDataHub/` (3 文件) | 🚧 v0.1 scaffold — 8 method typed wrapper（ask / health / stats / listAdapters / syncAdapter / queryEvents / recentAudit / runSkill）+ SwiftUI 3-tab 容器 + 隐私 gate alert + Inner View StateObject 注入；剩 13 method (Email/Alipay 配置 + 流式同步 + destroy 等) 待 UI 接入再加 wrapper |

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
  5. ⏳ 复用 Phase 5 AI Chat ChatBubble / streaming dispatcher 模式做长答案渲染（目前 v0.1 用 Surface + plain text，待大答案场景再升级）
- ✅ **Phase 14.2 数据层完整 (iOS — 22/22 method wrapper + 28 tests, CI green)**：(1) `Modules/CoreP2P/Sources/RemoteSkills/PersonalDataHub/PersonalDataHubCommands.swift` actor + **22 method wrapper** 完整对齐 Android Phase 14.1（ask / health / stats / list-adapters / sync-adapter / sync-all / sync-adapter-stream / sync-all-stream / query-events / recent-audit / event-detail / register-email / unregister-email / test-email-auth / list-email-accounts / register-alipay / unregister-alipay / import-alipay-bill / list-alipay-accounts / register-mock / unregister / run-skill）；(2) `PersonalDataHubModels.swift` **16 Codable struct** + 双 path JSON shape fallback + `HubClassification` / `HubExtraction` eventDetail join；(3) `Tests/CoreP2PTests/PersonalDataHubCommandsTests.swift` **28 tests**（22 happy-path + 6 input-guard）— 每个 method 单测都断言 wire `method` 名是 kebab-case，回归保护 Android Phase 14.1 真踩过的 camelCase / kebab-case mismatch（[hidden-risk-traps.md #17](https://github.com/chainlesschain/chainlesschain/blob/main/docs/internal/hidden-risk-traps.md)）；CI 编绿验证 `ios-build.yml` run 26150064237 — `Build & Test (SPM)` job 72s 通过含 28 新单测全跑过。**剩**：UI 接通（SwiftUI 3-tab View + ViewModel + RemoteDependencies 注册 + RemoteOperateView 新增 tab）— scaffold 文件历经一次 untracked-file race 丢失（[handbook #10](https://github.com/chainlesschain/chainlesschain/blob/main/docs/internal/hidden-risk-traps.md)），待下一轮 iOS UI iteration 重做。
- ⏳ Phase 14.3（双端）：审计回查 + 同步进度推送（reuse `personal-data-hub.sync.progress` 事件流 + 既有 fan-out task 加第 4 子流 buffer 256）
- ⏳ Phase 14.4（真机 E2E）：Mac + iPhone + Xiaomi 24115RA8EC + 真桌面，8 场景矩阵（详见设计文档 §8.3）

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

- **总单测**：50 个测试文件 / **954 单元测试**（最新基线 v5.0.3.73 含 Phase 10.2 集成 + E2E 9 新测 + AIChat registry-contract bug fix + 2026-05-21 doubao/toutiao/kuaishou scaffold land，`npx vitest run` 全绿，~21s）
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
- [Adapter — 微信 SQLCipher](https://design.chainlesschain.com/Adapter_WeChat_SQLCipher.html)
- [Adapter — 系统数据 (Android 通讯录 / 通话 / 短信 / WiFi)](https://design.chainlesschain.com/Adapter_System_Data.html)
- [Adapter — 电商 Cookie (Taobao / JD / Meituan)](https://design.chainlesschain.com/Adapter_Shopping_Cookie.html)
- [Adapter — 出行 / LBS (Amap / Baidu / Ctrip / 12306)](https://design.chainlesschain.com/Adapter_Travel_LBS.html)
- [Adapter — Social + Messaging (Bilibili / Weibo / Douyin / 小红书 / QQ / Telegram / WhatsApp)](https://design.chainlesschain.com/Adapter_Social_Messaging.html)
- [Python Sidecar 架构 (forensics-bridge fork from sjqz)](https://design.chainlesschain.com/Personal_Data_Hub_Python_Sidecar.html)
- [PDH vs sjqz 借鉴方案对比](https://design.chainlesschain.com/Personal_Data_Hub_sjqz_Comparison.html)
- [Phase 14 移动端原生入口（Android + iOS）](https://design.chainlesschain.com/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.html) — Plan B 远程操控模式：Mobile-bridge → typed RPC → SwiftUI/Compose UI；21 method 全 wire；6 sub-phase + 8 真机 E2E 场景
- [Plan A — Android 本机独立 PDH via in-APK cc CLI](https://design.chainlesschain.com/Personal_Data_Hub_Android_Standalone_Cc.html) — 不依赖桌面：vault / Ollama 兜替（llama.rn 端侧）/ adapter pipeline 全部在手机本地跑；APK 已 bundled cc 验证 (Phase 2.5)；跨 app sandbox 5 路径分级；~10-16d 工时
- [Cc CLI 自然语言驱动 — 管理手机其他 App + 数据](https://design.chainlesschain.com/Cc_NL_Phone_App_Manager.html) — `cc nl "<NL>"` 顶层命令；4 类 intent (query/ingest/control/action) + 端侧 1.5-3B LLM + 规则 fast-path + 隐私 gate + 高敏 confirm；~5d 工时

---

> **反馈与跟进**：中台是 ChainlessChain 兑现"数据回归个人"承诺的支柱。所有 13-Phase 路线图 adapter 已落地（v5.0.3.72），下一步主攻方向：Phase 10.3 AIChat 8 厂商 WebView 真账号 smoke + Phase 12.6+ WeChat 8.0+ frida-dep 路径 + Phase 14 移动端原生入口。欢迎在 GitHub issues 中标注 `area:personal-data-hub` 提需求 / bug / 新 Adapter 提议。
