# Personal Data Hub Architecture — 个人数据中台（让数据回归个人）

> **状态**：v0.7（2026-06-18，随 v5.0.3.119 ship）。采集面再扩 **61 → 89 个 adapter 真接通**（+ 多个同形平台共享 base 工厂 `_bank-base` / `_reading-base` / `_python-sidecar-base` / `_local-im-db-reader` / `_local-im-pc-adapter` 等）；PDH 测试 ~139 → **184 文件 / 2876 测试**；pdh npm 包 0.4.18 → **0.4.28**。本轮两条主线：
>
> 1. **Root 设备端侧取证采集（核心新能力）**——绕开 cookie/签名风控，直取已登录加密 app 的本地库。**方法 B**：免密钥 `/proc/<pid>/mem` 内存扫描（引擎无关、扛反调试、无需登录口令，rooted 设备首选）；**方法 C**：frida `sqlcipher_export` 在线解密加密 IM（可复现脚本 + runbook）；SQLite 叶子页 **salvager**（+`--unaligned` 扫描，从损坏 mem dump 救出明文页）→ PDH ingest glue；**D1/D2 root 采集**（WCDB2/抖音叶子页命中 + 扫描生命周期硬化）；多 app 并采 + 来源归属。运维 runbook 见 [`../internal/pdh-db-decryption-runbook.md`](https://github.com/chainlesschain/chainlesschain/blob/main/docs/internal/pdh-db-decryption-runbook.md)。证据驱动收口：抖音/头条 ByteDance 栈 WCDB2·IM 经真机确认 salvage 不支持，已诚实标注状态表。
> 2. **AI 分析增强**：analysis 管线去噪（话题名分组 / 兴趣过滤 / timeline inventory 排除）+ `analysis.overview` 跨 app 统一快照（决策支持），`ask({crossApp})` 把跨 app 概览注入 AnalysisEngine prompt；schema 字典升级到设备级精确（微信 sjqz 258 表 + 抖音/头条 ByteDance IM 库字段字典 + 解密状态）。
>
> **v0.6（2026-06-14，随 v5.0.3.110 ship）**：Phase 0–13 + 多平台采集 + Phase 13+ 长尾扩面均已落地，**61 个 adapter 真接通（+2 平台族 base）/ ~139 测试文件 / 2236 测试**，pdh npm 包 0.4.18。v0.6 一轮 `/loop` 补齐完成阶段所有 ≥⭐⭐⭐ 平台 + 可行长尾，新增 13 个采集 adapter（同程旅行 / 滴滴企业版 / 大众点评 / 知乎 / CSDN / WPS 云文档 / 腾讯文档 / 百度网盘 / 酷狗音乐 / 爱奇艺 / 腾讯视频 / BOSS 直聘，每个 snapshot + cookie-api 双模），并抽出 3 个同形平台共享工厂 `_document-base`（文档/云盘）、`_video-base`（视频观看史）。核心目标 = 把 ChainlessChain 从"个人 AI 工具集"升级为**用户全数据的本地中台 + AI 分析引擎**，兑现"数据回归个人"承诺。
>
> **v0.5 (2026-06-08)**：**采集大更新 + 真机生效**（随 v5.0.3.99）。引入 adapter **readiness** 概念——从宽松的 `healthCheck` sync 闸门分离出真正的「就绪」判定（`registry.readiness()` 返回 `ready / needs_setup / unavailable` + 一行中文原因），解决「配置看起来正常却采不到」的长期死角；配套 `adapter-guide.js`（category-driven 导入指引单源，web-shell / 桌面 / CLI / Android 四壳共用）+ 桌面/移动端「一键采集 / 导入引导」UI。新接通本地直读源：抖音 / 微信（电脑版）/ QQ（电脑版 NT）/ 钉钉（电脑版）/ 飞书（电脑版）honest best-effort 本地 IM 采集 + 微信读书 weread cookie + Apple 健康 + 网易云音乐。email 账单 **LLM gap-fill（Phase 5.5）**——结构化字段缺失时由 LLM 补齐金额/商户/时间；**iOS 加密备份解密（Phase 7.5b）**。版本面：pdh 0.4.0 + CLI 0.162.29 已发 npm；Android binariesVersion 20260608 + USR_VERSION 19 强制真机重抽（trap #27/#28：改 pdh/lib 必 bump version + npm publish + USR_VERSION）。
>
> **v0.4 (2026-05-24)**：**Phase 17 桌面本机数据五件套** land — `browser-history-chrome` + `browser-history-edge`（Chromium 子类复用）+ `vscode`（workspace + 全局终端 history.entries）+ `win-recent`（.lnk 跨应用时间线）+ `system-data-android v0.3.0` 加媒体清单（5 类 /sdcard 目录元数据）。全部 desktop-local file-import 模式（零 ADB、零网络、零账号）；新增 76 单测 + 4-adapter pipeline 整合测试 + CLI E2E spawn 测试（bs3mc 本地 ABI 不匹配时 skip，CI Linux 真跑）；wiring 跨 3 入口（desktop IPC、CLI 单跑、web-shell WS）+ 2 categories.js 全同步。
>
> **v0.3 (2026-05-20)**：引入 **Python sidecar (forensics-bridge)** 作为采集前端，fork 自 [`sjqz`](file://C:/code/sjqz) (17 parser + Android/iOS extraction + WeChat 解密)，避免重写 1.7w 行成熟代码。新增 §4.1 sidecar 子层、§9.4 PythonSidecarAdapter 接口、§12 Phase 4.5 系统数据 adapter（通讯录/通话/短信/WiFi 作 EntityResolver 种子）、Phase 12 WeChat 引用 sjqz 解密方案（T3 风险 高→中）、T13 新增（sidecar 跨平台部署）。配套新文档：[`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md)、[`Adapter_System_Data.md`](./Adapter_System_Data.md)。
>
> **v0.2 (2026-05-19)**：§12 Phase 拆分基于 Redmi 24115RA8EC 真机 inventory（175 个第三方 app）重排，replace 原 hypothetical 顺序。新增 §12.1 真机 inventory × Phase 映射。EmailAdapter 提前为首个 adapter（IMAP 一拍多得），AIChatHistoryAdapter 提升为 Phase 10 旗舰差异化（用户装了 8 家国产 AI），WeChat 压轴 Phase 12。
>
> **v0.1 (2026-05-19)**：首版设计稿。
>
> **关联文档**：`Adapter_Alipay_Bill.md`（首个 adapter 切片，验证端到端）、既有 `01_知识库管理模块.md`（KG/RAG 引擎复用）、`安全机制设计.md`（U-Key/SIMKey + SQLCipher）、`数据同步方案.md`（既有 P2P 同步基础设施）
>
> **依赖**：既有 KG 引擎、RAG 流水线、SQLCipher LocalVault、DID 身份层、Skill 系统、Ollama 本地 LLM；不新增基础设施，全部复用。
>
> **核心定位**：**AI 分析处理自己的数据**是首要目标，采集只是手段。架构所有决策围绕"让本地 LLM 能高质量回答关于用户自己的问题"展开。

---

## 1. 背景 & 愿景

### 1.1 问题陈述

用户的个人数据散落在数十个 app 里：

- 微信里 5 年的聊天 + 朋友圈
- 支付宝里完整消费史
- 淘宝/京东/拼多多里每一笔订单
- 高德/百度里每天的足迹
- 抖音/小红书里看过的、点赞的、收藏的
- 银行 / 信用卡 / 12306 / 携程 / 美团 / 大众点评 / ……

每个 app 是数据的**事实主人**，用户只是访问者：

- 看不到全貌（每个 app 只给自己那一块的视图）
- 跨源问不出答案（"我妈生日那周买了啥送哪儿"——任何单一 app 都答不了）
- 不能离开 app 用自己的数据（导出能力残缺）
- AI 助手帮不上忙（云端 AI 看不到你的私域数据，看到了你也不敢给）
- 删号 / 封号 / 倒闭 = 数据一夜清零

### 1.2 愿景

> **你的每一条数据，都先落在你自己设备上，然后 AI 才能用它帮你。**

ChainlessChain 作为**个人数据中台**：

1. **采集**：通过 Adapter 把各 app 的数据拉回本机
2. **统一**：5 类核心实体（Person / Event / Place / Item / Topic）跨源对齐
3. **存储**：SQLCipher LocalVault + Keystore，密钥绑定 U-Key/SIMKey
4. **理解**：KG + RAG 让数据可被自然语言查询
5. **分析**（核心）：本地 Ollama LLM 直接分析用户数据，敏感数据零外传
6. **可携带**：JSON-LD / SQLite 一键导出，可销毁，可审计

### 1.3 与既有架构的关系

| 既有能力             | 中台用法                                            |
| -------------------- | --------------------------------------------------- |
| KG 引擎              | 跨源实体图谱的存储后端                              |
| RAG 流水线           | 检索增强：让 LLM 看到相关历史数据                   |
| SQLCipher LocalVault | 原始 adapter 数据落地 + 派生 KG 持久化              |
| DID 身份             | 跨设备同步时 adapter 数据的归属凭证                 |
| U-Key/SIMKey         | LocalVault 主密钥的硬件保护                         |
| Skill 系统           | 每个 adapter = 一个 skill，自然接入既有 marketplace |
| Ollama 本地 LLM      | 数据分析引擎（默认本地，不外传）                    |
| Cowork 多代理        | 复杂分析任务的并行编排                              |
| Workflow 引擎        | 周期性数据采集 / 报告生成                           |

**新增的只有**：UnifiedSchema 定义 + EntityResolver + AdapterRegistry + 每个 adapter 实现 + 数据分析专用 prompt/skill。

---

## 2. 目标 & 非目标

### 2.1 目标 (v1 in scope)

| #   | 项                                                          | 验收                                                                 |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| G1  | UnifiedSchema 定义 5 类实体 + JSON Schema                   | schema 文档完成 + 校验器单测 ≥ 20                                    |
| G2  | AdapterRegistry + Adapter 接口规范                          | 接口文档 + reference impl (Alipay) 通过                              |
| G3  | EntityResolver 跨源 Person/Place 消歧                       | 召回 ≥ 80% / 准确 ≥ 90%（标注集 ≥ 200 条）                           |
| G4  | LocalVault 加密落地 + Keystore 主密钥                       | 单测：密钥旋转、损坏恢复；密钥不落明文盘                             |
| G5  | KG ingestion pipeline（Adapter → UnifiedEvent → KG triple） | 单测：1k 事件 ingest < 30s；KG 完整性校验                            |
| G6  | **AI 分析层**：自然语言 Q&A on 个人数据                     | E2E：用户问 "上个月在淘宝买了啥总共花了多少" → 本地 LLM 给出准确答复 |
| G7  | 增量同步：每 adapter watermark + 去重                       | 重复 ingest 相同窗口 → 0 重复事件                                    |
| G8  | 隐私 SOP：数据流向可审计 + 一键擦除                         | 审计日志记录每条数据来源；擦除验收 0 残留                            |
| G9  | 首个 adapter（Alipay）端到端打通                            | 见 `Adapter_Alipay_Bill.md`                                          |

### 2.2 非目标 (defer)

- **多用户共享数据** — 中台只服务"我"，不做家庭共享 / 团队（v2+）
- **实时流式分析** — v1 按需触发分析；v2 加 Workflow 定时报告
- **对外发布数据** — 不做"个人数据 API"对外暴露（隐私保护原则）
- **训练个人专属模型** — v1 用现有 LLM + RAG；v3+ 考虑 LoRA / 微调
- **图像/音视频深度内容理解** — v1 只抓元数据（拍摄时间/地点/同框人）；v2 再加图像理解
- **Adapter marketplace 第三方贡献** — v1 全自营 adapter；v2 开 SDK
- **跨平台 adapter 共享** — Android adapter 和 desktop adapter 各自实现；不强求一份代码（数据源 SDK 不一样）
- **取证 / 法律存证** — 不为司法证据设计；用户自用场景

---

## 3. Open Questions

### OQ-1：UnifiedSchema 粒度

**A**：粗粒度 5 类实体 + JSON `extra` 字段挂源特定属性（schemaless 兼容）
**B**：细粒度按子类型分（Person→Contact/Merchant/Self、Event→Message/Order/Visit/Post...）每个有强 schema
**C**：分层：核心 5 类强 schema + 子类型 view（按需 derive）

**推荐 C**。理由：(1) 粗粒度（A）让 KG 查询时 type 含混，LLM 难写有效检索；(2) 完全细粒度（B）让 adapter 写起来繁琐 + schema 演化痛苦；(3) 分层（C）核心固定能保跨源对齐，子类型 view 让 LLM/UI 有强类型可用，又留 schemaless 兜底。

### OQ-2：EntityResolver 算法

**A**：规则引擎（手写匹配规则，按字段）
**B**：Embedding 相似度 + 阈值（用户名/地址/电话 embed 后比对）
**C**：LLM 判定（每对疑似实体喂 LLM 判 same/different）
**D**：A + B 召回 + C 仲裁

**推荐 D**。理由：(1) 纯规则（A）召回低（"妈"/"妈妈"/"老妈"全是同一人 LLM 才懂）；(2) 纯 embedding（B）大批量便宜但易把同名不同人混；(3) 纯 LLM（C）准确但贵又慢；(4) D 三段式：规则先剪枝 → embedding 召回候选 → LLM 仲裁难例，性能/准确双优。LLM 走本地 Ollama 不外传。

### OQ-3：本地 LLM 性能 — 分析场景

**A**：默认 Ollama 7B / 8B 本地（如 Qwen2.5-7B / Llama-3.1-8B）
**B**：默认更大模型（32B+），要求用户配 GPU
**C**：本地小模型快路径 + 用户选配云端大模型慢路径
**D**：本地 8B 默认 + 用户可选 70B（Ollama 支持）/ 自托管 vLLM

**推荐 D**。理由：(1) 严守"敏感数据零外传"= 不允许 C 的云端路径作默认；(2) 8B 在消费机能跑能用 + 复杂分析用户可主动切大模型；(3) Ollama 多模型预下载 = 用户体验"无缝 escalate"；(4) 自托管 vLLM 是为有 GPU 服务器的高级用户预留。

### OQ-4：Adapter 调度模型

**A**：用户手动触发（点"立即同步"按钮）
**B**：后台 Workflow 定时跑（如每天凌晨）
**C**：事件驱动（如 app 通知到达时触发对应 adapter）
**D**：A + B 混合

**推荐 D**。理由：(1) 初次接入必须用户手动（要授权、扫码、输密码）；(2) 增量同步走定时 Workflow（已有引擎，复用 Phase 5+ 调度）；(3) 事件驱动（C）耦合 Accessibility，限制 Android only + 太底层易出问题，留 v2；(4) D 给用户"手动按需 + 自动后台"双重控制。

### OQ-5：分析 prompt 模板存放

**A**：硬编码进 hub 主进程
**B**：作为 skill（用户可改、可分享）
**C**：YAML / JSON 模板文件 + UI 可视化编辑

**推荐 B**。理由：(1) 硬编码（A）阻断个性化；(2) 用户对"分析自己数据"的需求高度个人化（每个人在意的维度不同），必须开放；(3) skill 系统已支持版本/分享/marketplace，零新基础设施；(4) UI 模板编辑（C）是 skill 系统的子能力，可后续加。

---

## 4. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 用户查询层（自然语言）                                          │
│  - 桌面 ChatPanel / iOS AIChat / Android Chat                  │
│  - "上个月我妈生日那周买了啥送哪儿？"                            │
└─────────────────┬───────────────────────────────────────────┘
                  ↓ 自然语言
┌─────────────────────────────────────────────────────────────┐
│ 分析层 (Analysis Layer)                                       │
│  - PersonalAnalysisAgent (Cowork agent，复用 Phase F)         │
│  - 内置分析 skill：消费分析 / 关系分析 / 足迹分析 / 兴趣分析     │
│  - 本地 LLM 推理 (Ollama 默认 8B，可切 70B / vLLM)             │
│  - RAG 召回：UnifiedSchema → KG 查询 → 相关事件作上下文          │
└─────────────────┬───────────────────────────────────────────┘
                  ↓ 结构化查询
┌─────────────────────────────────────────────────────────────┐
│ 中台核心 (Hub Core)                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │UnifiedSchema│  │EntityResolver│  │ KG Ingestor │         │
│  │ Person/Event│  │ 跨源人/地点  │  │ 事件→triple │         │
│  │ Place/Item/ │  │ 消歧/聚合    │  │             │         │
│  │ Topic       │  │             │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ LocalVault (SQLCipher AES-256)                       │   │
│  │  - raw_events (adapter 原始数据)                       │   │
│  │  - unified_events (UnifiedSchema)                     │   │
│  │  - entities (Person/Place/Item/Topic 实例)            │   │
│  │  - kg_triples (KG)                                    │   │
│  │  - sync_watermarks                                    │   │
│  │  - audit_log                                          │   │
│  │ 主密钥：Android Keystore / Win DPAPI / Mac Keychain    │   │
│  │      + 可选 U-Key/SIMKey 加强                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────┬───────────────────────────────────────────┘
                  ↓ Adapter 接口
┌─────────────────────────────────────────────────────────────┐
│ 同步层 (Sync Layer)                                          │
│  - AdapterRegistry                                          │
│  - SyncEngine (Workflow 调度 + watermark + 增量)            │
│  - DeduplicationFilter                                      │
└─────────────────┬───────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────────────────────────┐
│ Adapter 层（每个 app 一个，复用 skill 系统）                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Alipay   │ │ Taobao   │ │ WeChat   │ │ Amap     │      │
│  │ Bill     │ │ Order    │ │ Chat+SNS │ │ Footprint│      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│  采集机制（按 ROI 排序）：                                     │
│    1. 官方 export 解析（最稳）                                 │
│    2. Cookie + web API                                       │
│    3. Root + SQLite 直读（Android, 走 sidecar）              │
│    4. Accessibility + 自动滑动（Android）                    │
│    5. Screenshot + LLM OCR（兜底，复用既有能力）              │
└──────────────┬──────────────────────────────────────────────┘
               ↓ JSON-lines / IPC
┌─────────────────────────────────────────────────────────────┐
│ Forensics Bridge (Python sidecar, fork sjqz)                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Android Ext. │ │  iOS Ext.    │ │ WeChat Decr. │        │
│  │ ADB / Root   │ │ Backup / AFC │ │ IMEI+UIN MD5 │        │
│  │ APK 降级     │ │ 加密备份解密  │ │ SQLCipher    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│  17 parsers: WeChat/QQ/淘宝/支付宝/京东/拼多多/美团/小红书/    │
│   高德/百度/12306/携程/滴滴/抖音/微博/B站 + 系统(通讯录/通话/  │
│   短信/WiFi)                                                │
│  打包：PyInstaller 单文件 / Win Mac Linux 三平台              │
│  详见：Personal_Data_Hub_Python_Sidecar.md                  │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 Python Sidecar 子层定位

> 为什么引入 Python sidecar 而不是纯 JS 实现：

| 维度         | 纯 JS 重写                                           | Python sidecar（采纳）                                  |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------- |
| 工期         | 每 adapter +2-3 天 reverse-engineering               | sjqz 已有 17 parser 现成可用                            |
| WeChat 解密  | 自研 SQLCipher 密钥派生（高风险）                    | sjqz `wechat_decrypt.py` 437 行成熟代码                 |
| Android 提取 | 自研 ADB / Root / APK 降级 4 种方法                  | sjqz `android/extractor.py` 已覆盖                      |
| iOS 提取     | 自研 iTunes backup + AFC + 加密解密                  | sjqz `ios/extractor.py` 已覆盖                          |
| 部署         | 单一 Node 进程                                       | 多一个 Python runtime（已有 `backend/ai-service` 先例） |
| 进程隔离     | 同 hub 进程                                          | 独立 sandbox，崩溃不拖垮 hub                            |
| 工具链生态   | 部分（如 SQLCipher Node binding）缺乏 prebuilt wheel | Python `pysqlcipher3` / `pymobiledevice3` 等更成熟      |

**进程隔离原则**：

- `forensics-bridge`（数据采集）与 `ai-service`（AI 推理）**独立 Python 进程**，各自资源/崩溃域隔离
- hub 主进程（Node）作 supervisor，按需 spawn / health-check / 重启 sidecar
- IPC 走 stdio JSON-lines（不开网络端口，零外网暴露面）

详见：[`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md)

---

## 5. UnifiedSchema 设计

### 5.1 5 类核心实体

```typescript
// 所有实体共有
interface BaseEntity {
  id: string; // UUID v7（含时间序）
  source: SourceRef; // 来源（adapter + 原始 id）
  ingestedAt: number; // 入库时间戳 ms
  confidence: number; // 0-1，源数据可信度（如 OCR < 1.0）
  extra?: Record<string, any>; // schemaless 兜底
}

interface SourceRef {
  adapter: string; // "alipay" / "wechat" / ...
  adapterVersion: string; // "0.1.0"
  originalId?: string; // 源 app 内的 id（如订单号）
  capturedAt: number; // 源 app 中的时间戳（可早于 ingestedAt）
  capturedBy: "export" | "api" | "sqlite" | "accessibility" | "ocr";
}

// === 1. Person ===
interface Person extends BaseEntity {
  type: "person";
  subtype: "self" | "contact" | "merchant" | "unknown";
  names: string[]; // ["妈妈", "老妈", "陈女士"] 多别名
  identifiers?: {
    phone?: string[];
    email?: string[];
    wechatId?: string;
    alipayUid?: string;
    didId?: string;
  };
  relation?: string; // "母亲" / "前同事" / "客户" (用户 / LLM 标注)
  notes?: string;
}

// === 2. Event ===
interface Event extends BaseEntity {
  type: "event";
  subtype:
    | "message"
    | "post"
    | "order"
    | "payment"
    | "visit"
    | "browse"
    | "like"
    | "trip"
    | "call"
    | "media"
    | "other";
  occurredAt: number; // 事件发生时间
  durationMs?: number; // 跨时段事件
  // 参与方
  actor?: string; // Person.id（发起者）
  participants?: string[]; // Person.id[]
  // 位置
  place?: string; // Place.id
  // 关联物
  items?: string[]; // Item.id[]
  // 主题
  topics?: string[]; // Topic.id[]
  // 内容（结构化）
  content: {
    text?: string;
    title?: string;
    amount?: { value: number; currency: string; direction: "in" | "out" };
    mediaRefs?: string[]; // 本地文件路径 or 占位符
  };
}

// === 3. Place ===
interface Place extends BaseEntity {
  type: "place";
  name: string;
  coordinates?: { lat: number; lng: number };
  address?: string;
  category?: string; // "home" / "office" / "restaurant" / "store"
  // 别名（不同 app 称呼可能不同）
  aliases: string[];
}

// === 4. Item ===
interface Item extends BaseEntity {
  type: "item";
  subtype: "product" | "media" | "link" | "document" | "other";
  name: string;
  category?: string; // "电子" / "图书" / "餐饮" / ...
  price?: { value: number; currency: string };
  merchant?: string; // Person.id (subtype=merchant)
  externalUrl?: string;
  thumbnailLocalPath?: string;
}

// === 5. Topic ===
interface Topic extends BaseEntity {
  type: "topic";
  name: string; // "母亲健康" / "Python 学习" / "厦门旅行"
  parentTopic?: string; // Topic.id（层级）
  // 由 LLM 抽出 / 用户标注
  derivedFromEvents?: string[]; // Event.id[]
}
```

### 5.2 设计原则

1. **核心字段强 schema**：跨源对齐必备字段（id/type/occurredAt/place/...）必须有，便于 KG 查询稳定
2. **`extra` schemaless 兜底**：源特定字段（如 alipay 的 `交易分类`、wechat 的 `talker_id`）原样存，不丢源信息
3. **id 用 UUID v7**：含时间序，方便分页 / 按时间窗扫描
4. **跨源关联通过 id 引用**：Person/Place/Item 是顶级实体，Event 通过 id 引用——这是 EntityResolver 的工作产物
5. **不二次失真**：原始 raw_events 表保留 adapter 抓回的完整 JSON，UnifiedSchema 是派生表，可重建

### 5.3 与 KG 的映射

每个 UnifiedEvent 生成 N 条 KG triple：

```
Event(<id>) --occurred-at--> Time(<ts>)
Event(<id>) --happened-at--> Place(<id>)
Event(<id>) --involves--> Person(<id>)
Event(<id>) --about--> Item(<id>)
Event(<id>) --topic--> Topic(<id>)
Event(<id>) --type--> "order"
Event(<id>) --source--> "alipay"
```

KG 复用既有引擎，新增的是 "ingest UnifiedEvent → triples" 这一层。

---

## 6. EntityResolver 设计

### 6.1 三段式 pipeline（per OQ-2 推荐 D）

```
新实体 X 进来
  ↓
1. 规则剪枝（fast path）
   - 完全相同 identifier（phone/email/uid/wechatId）→ 直接合并
   - 完全相同 name + 同 source → 同实体
   - 完全不重叠（无任何重合字段）→ 新建
  ↓ 剩下"疑似但不确定"
2. Embedding 召回
   - X.name + X.context → embedding
   - 与候选集 top-K（已建实体的 embedding）算 cosine
   - 阈值 > 0.85 直接合并；< 0.55 直接拒；中间送 LLM
  ↓ 剩下"模糊地带"
3. LLM 仲裁（本地 Ollama）
   - prompt：give X and Y profiles → same person? (yes/no/maybe + reason)
   - "maybe" 标记为待用户确认，UI 出 review 队列
```

### 6.2 工作示例

```
源 1: 微信 contact "妈" + phone=13800001111
源 2: 支付宝 转账对方 "陈XX" + phone=13800001111
→ 规则匹配 phone 一致 → 合并为同一 Person

源 3: 高德搜索 "回家" 经常导航到 "厦门思明区 XX 路 88 号"
源 4: 淘宝收货地址 "陈XX 13800001111 厦门思明区 XX 路 88 号"
→ phone 同 → Person 合并
→ 地址同 → Place "妈妈家" alias 合并
```

### 6.3 用户参与

- **review 队列**：模糊判定的 pair UI 列表，用户一键 same/different/skip
- **手动合并 / 拆分**：UI 提供"这两个其实是同一人"按钮
- **学习反馈**：用户的合并/拆分作为 future 标注集

---

## 7. LocalVault 安全模型

### 7.1 加密层级

```
明文数据
  ↓ AES-256 (SQLCipher, per-DB key)
LocalVault.db
  ↓ DB 主密钥（48 bytes random）
存放在：
  - Win: DPAPI (user scope)
  - Mac: Keychain (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
  - Android: Keystore (TEE / StrongBox)
  - iOS: Keychain (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
  ↓ 可选 second-layer：U-Key / SIMKey
启用时：DB 主密钥再被 hardware-derived key 包一层
丢 U-Key/SIMKey = 数据无法解（用户接受 trade-off）
```

### 7.2 密钥旋转

```
用户触发 rotate
  ↓
1. 派生新主密钥（从 Keystore 重新生成）
2. SQLCipher PRAGMA rekey
3. 旧密钥从 Keystore 删除
4. 审计日志记录
```

### 7.3 跨设备同步密钥分发

- 用户在设备 A 已配置 vault
- 设备 B 配对后通过既有 P2P + DID 通道交换主密钥（用 DID 公钥加密传输）
- 设备 B 把收到的主密钥存自己 Keystore

### 7.4 销毁

- "擦除所有数据"按钮：删除 LocalVault.db + 删除 Keystore 主密钥 + 审计日志记录 + 触发其他设备同步 destroy 信号

---

## 8. AI 分析层（核心）

> 这是整个中台的**最终用户价值**所在。所有数据采集 / 统一 / 存储 都是为这一层服务的。

### 8.1 分析三态

| 态                     | 触发                      | 用例                                                     |
| ---------------------- | ------------------------- | -------------------------------------------------------- |
| **Q&A 态**（按需问答） | 用户在 ChatPanel 输入问题 | "我妈生日那周买了啥送哪儿？"                             |
| **报告态**（定期主动） | Workflow 调度             | 月度消费分析报告 / 季度足迹回顾                          |
| **告警态**（异常检测） | 后台监控                  | "本月外卖支出比上月翻倍" / "你妈妈最近 3 周没主动联系你" |

### 8.2 内置分析 skill（v1）

| Skill                | 输入                                | 输出                                                |
| -------------------- | ----------------------------------- | --------------------------------------------------- |
| `analysis.spending`  | 时间范围 + 维度（商家/类别/收款人） | 消费明细 + 趋势 + 异常                              |
| `analysis.relations` | Person 或 "所有联系人"              | 互动频率 / 主动方占比 / 情感倾向（基于聊天 LLM 抽） |
| `analysis.footprint` | 时间范围                            | 常去地点 / 出行模式 / 异常足迹                      |
| `analysis.interests` | （无）                              | 从浏览/点赞/购买中抽兴趣画像                        |
| `analysis.timeline`  | 时间范围 + 主题                     | 跨源时间线（聊天 + 购买 + 出行 串成故事）           |
| `analysis.ask`       | 自然语言问题                        | RAG 召回 + LLM 推理，开放 Q&A                       |

每个 skill = 一个 prompt 模板 + 一组 KG 查询 + LLM 推理 chain。

### 8.3 RAG 流程（per 自然语言问题）

> **意图分类 + 按需检索路由** — 4 个 intent (`count` / `latest` / `list+entity` /
> `sum-amount`) 在 `_gatherFacts` 走不同检索路径。详见
> [PDH_Analysis_Engine_Intent_Routing.md](PDH_Analysis_Engine_Intent_Routing.md)。
> 总结：count 走 `TOTALS` 旁路（vault.stats 给真数）；latest 无 timeWindow
> 时硬限 3 条；list 抽到实体名时 FTS5 追加补召回；sum-amount 只拉 4 类
> amount-bearing subtype。Android 小模型 prompt 预算紧时尤其受益。

```
用户问 "上个月我妈生日那周买了啥送哪儿？"
  ↓
1. Query Parser (LLM 小模型)
   - 提取时间窗：上个月 + "我妈生日那周" → 需要先查"我妈生日"
   - 提取实体：我妈 → Person(subtype=self.relation=母亲)
   - 提取动作：买 → Event.subtype=order
   - 提取目标：送哪儿 → Event.place
  ↓
2. KG 查询（结构化）
   - 找 Person where subtype=contact AND relation="母亲" → mom.id
   - 找 mom 的生日 → 从历史聊天/朋友圈/通讯录抽（如果未确认 prompt 用户确认）
   - 时间窗确定：[生日-3, 生日+3] in 上个月
   - 查 Event where actor=self AND subtype=order AND occurredAt in window
  ↓
3. RAG 召回相关历史
   - top-K 相关 Event 全文 → 喂 LLM
   - 包含订单明细 / 收货地址 / 物流信息
  ↓
4. LLM 推理 (Ollama 8B)
   - 输入：结构化查询结果 + 上下文事件
   - 输出："上个月 12 日是您母亲生日，您在 9-15 日间在淘宝下了 3 单：
            - 蛋白粉 ¥288，寄到 妈妈家（厦门 XX 路 88 号）
            - 按摩仪 ¥459，同上
            - 鲜花订单 ¥199，配送时间 12 日上午
            共 ¥946。"
```

### 8.4 LLM 选型默认（per OQ-3 推荐 D）

- **默认**：Ollama + Qwen2.5-7B-Instruct（中文好 + 推理够用 + 消费机能跑）
- **复杂分析**：用户可切 Qwen2.5-32B 或 Llama-3.1-70B（带 GPU 机器）
- **隐私优先**：永远不外传到云端 LLM；用户主动启用云端 = 弹窗二次确认 + audit log 记录

### 8.5 prompt 工程要点

- **永远不放原始隐私数据进系统 prompt**：避免缓存泄漏 / 模型行为污染
- **召回的事件作 user-role context，不放 system-role**
- **明确告诉模型 "这是用户自己的数据，回答时直呼用户"**
- **数字 / 金额必须给原始证据链**（让 LLM 引 Event.id，UI 渲染时回链到原始记录）
- **不让 LLM 编造**：检索为空时返回 "未找到相关数据"，禁止幻觉

---

## 9. Adapter 接口规范

### 9.1 接口定义

```typescript
interface PersonalDataAdapter {
  readonly name: string; // "alipay" / "wechat" / ...
  readonly version: string; // semver
  readonly capabilities: string[]; // ["import:csv", "sync:cookie", ...]

  // 鉴权（一次性 / cookie 刷新 / 文件导入路径 / Accessibility 启用）
  authenticate(ctx: AuthContext): Promise<AuthResult>;

  // 增量同步（必须支持 watermark）
  sync(opts: SyncOptions): AsyncIterable<RawEvent>;

  // 把 RawEvent 转成 UnifiedEvent + 相关 Person/Place/Item/Topic
  normalize(raw: RawEvent): NormalizedBatch;

  // 健康检查（cookie 是否过期、文件是否可读等）
  healthCheck(): Promise<HealthStatus>;

  // 配额 / 限流（避免触发风控）
  readonly rateLimits: { perMinute?: number; perDay?: number };

  // 元数据声明：用户应知的数据采集范围
  readonly dataDisclosure: {
    fields: string[]; // ["order:title,amount,address", ...]
    sensitivity: "low" | "med" | "high"; // 决定 UI 警示等级
    retentionDays?: number; // 默认无限期，用户可设
  };
}

interface SyncOptions {
  sinceWatermark?: string;
  maxEvents?: number;
  dryRun?: boolean;
  cookie?: string; // 单次临时凭据，不持久化、不写入报告
  accountId?: string; // 仅用于生成隐私哈希 account scope
  beforeSourceRequest?: (detail: {
    operation?: string;
    page?: number;
  }) => Promise<void>;
}

interface NormalizedBatch {
  events: Event[];
  persons: Person[];
  places: Place[];
  items: Item[];
  topics?: Topic[];
}
```

### 9.2 Adapter 生命周期

```
注册（开发者侧）
  ↓ 实现接口 + manifest 声明
打包成 skill (.cc-pack)
  ↓
用户在 skill marketplace 安装
  ↓ 弹窗显示 dataDisclosure，用户确认
authenticate（首次）
  ↓ 走 adapter 特定流程（扫码 / 输密码 / 选文件 / 开 Accessibility）
sync（增量循环）
  ↓ 每条 raw → normalize → ingest 进 LocalVault → 触发 KG ingestor
分析可用
```

### 9.3 Adapter 隔离 & 安全

- 每个 adapter 运行在独立的 skill sandbox（已有能力）
- 只允许 adapter 访问自己的 raw_events 表（adapter_name 过滤）
- 不允许 adapter 直接读 unified_events / kg_triples（防 adapter 越权关联）
- adapter 写入走 hub 主进程 IPC，hub 做 schema 校验后才落库

### 9.4 PythonSidecarAdapter 变种

> 高难度提取 / 已被 sjqz 解决的源走此变种。JS 一侧只做薄壳，重活全在 sidecar。

```typescript
interface PythonSidecarAdapter extends PersonalDataAdapter {
  readonly transport: "python-sidecar";
  readonly sidecarMethod: string; // sidecar 内 method 名，如 "wechat.parse" / "android.extract"

  // JS 一侧 sync() 实现 = 通过 IPC 调 sidecar，把返回流式 yield
  // 不需要重写 sjqz 解析逻辑，只做 NormalizedBatch 字段映射
}
```

**IPC 协议（JSON-lines envelope）**：

```json
// hub → sidecar (stdin, 一行一 JSON)
{"id":"req-001","method":"wechat.parse","params":{"db_path":"...","key":"abc1234"}}

// sidecar → hub (stdout, 一行一 JSON)
{"id":"req-001","type":"progress","data":{"processed":120,"total":5000}}
{"id":"req-001","type":"chunk","data":{"events":[...],"persons":[...]}}
{"id":"req-001","type":"result","data":{"status":"ok","totalEvents":5000}}
// 或失败
{"id":"req-001","type":"error","error":{"code":"WECHAT_KEY_INVALID","msg":"..."}}
```

完整协议、错误码、17 parser 调用清单见 [`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md)。

---

## 10. Sync 引擎

### 10.1 调度（per OQ-4 推荐 D）

- **手动触发**：UI "立即同步" / CLI `cc adapter sync alipay`
- **定时触发**：复用既有 Workflow 引擎，每 adapter 独立 cron（如每天凌晨 3 点）
- **失败重试**：指数退避，最多 3 次
- **限流尊重**：adapter 声明的 rateLimits 强制执行

实现约束：

- Registry 只重试可判定为瞬时的网络、超时、HTTP 429/5xx 故障；认证、权限、参数、
  schema、原始归档和本地落库错误立即失败。adapter 可用
  `isRetryableSyncError(error)` 覆盖分类。
- 重试期间已成功写入 `raw_events` 的批次保留并依赖来源唯一键幂等重放；只有某次
  完整成功后才提交 watermark。默认退避为 500ms 起、30s 封顶，最多重试 3 次。
- `perMinute`、`perDay`、`minIntervalMs` 按 `(adapter, scope)` 在
  `sync_rate_limit_state` 中事务性计数，因此重启或多进程不能绕过限额。这里约束的是
  Sync 尝试次数。
- Registry 同时向 SyncOptions 注入 `beforeSourceRequest()`；分页 adapter 必须在每次
  实际访问来源前调用。请求窗口独立持久化在
  `source_request_rate_limit_state`，避免与触发次数互相消耗配额，并保证重启、多
  Registry/进程共享同一账号配额。
- 请求节奏取显式 `minIntervalMs` 与 `ceil(60000 / perMinute)` 的较大值，避免固定分钟
  窗口开头的突发流量。分钟/最小间隔门槛会等待后继续当前页；日配额耗尽会返回
  `rate_limited` 且不提交部分扫描 watermark。已有独立请求客户端限流器（如 AI
  Chat vendor client）的 adapter 不重复领取 Registry 页配额。
- 声明 `watermarkRequiresCompleteScan=true` 的分页 adapter 必须遵守 Registry 注入的
  `maxPages`。预算耗尽只结束本轮并保留旧 watermark；仅在空页、短页或已越过旧
  watermark 时调用 `markWatermarkComplete()`。同一 adapter 含多个列表（如美团业务线、
  闲鱼买卖双侧）时共享总页预算，不能按列表倍增来源请求。
- 临时 Cookie 直采通过主进程 `createJsonSourceFetch()` 执行：只允许无 URL 凭据的
  HTTPS，重定向只跟随有上限的同源 GET/HEAD；统一设置超时、Cookie 头上限和流式响应
  字节上限，支持 JSON body 与 `application/x-www-form-urlencoded` 表单 POST，并把
  HTTP、空响应、非 JSON 明确记为失败。Cookie 不持久化；`accountId` 先规范化、哈希为
  account scope，确保不同账号不共享 watermark。
- `travel-12306` 的临时 Cookie 路径复用该 transport 访问已完成/待支付订单接口；两个
  列表共享 `maxPages` 和来源请求限流预算，只有两个响应结构均被识别且完整扫描时才推进
  watermark。临时调用必须提供 `accountId`，避免不同铁路账号共享游标。
- `social-zhihu` 的临时 Cookie 路径把 `accountId` 解释为个人主页 `url_token`，分页
  读取回答、关注和收藏夹。三条流共享 `maxPages`；未知 JSON 结构、HTTP 鉴权失败或预算
  耗尽均不推进 watermark。可选签名提供器返回的 `x-zse-96` 只进入请求头，不得作为 URL
  查询参数或持久化字段。

### 10.2 增量 watermark

```sql
-- LocalVault.sync_watermarks
adapter TEXT PRIMARY KEY,
last_watermark TEXT,       -- adapter 自定义（时间戳 / 游标 / hash）
last_synced_at INTEGER,
last_status TEXT,          -- "ok" / "auth_expired" / "rate_limited" / ...
last_error TEXT
```

### 10.3 去重

- adapter 必须保证 `(adapter, originalId)` 唯一
- ingestor 检测 `(source.adapter, source.originalId)` 已存在 → 跳过 / 升级（视 adapter 的 idempotency 声明）
- 无 originalId 的源（如 OCR 兜底）走 content hash 去重

---

## 11. 隐私 & 合规 SOP

### 11.1 用户控制（必须 UI 暴露）

1. **每个 adapter 启用 / 禁用 toggle**
2. **数据范围选择**：在 dataDisclosure.fields 里挑子集（如"只同步金额，不同步备注"）
3. **保留期限**：默认无限期，可改为 N 天自动删
4. **审计日志查看**：每条数据来源 + 入库时间 + 用过它的 LLM 调用
5. **一键导出**：JSON-LD / SQLite dump
6. **一键擦除**：见 §7.4

### 11.2 数据出端控制

- **默认 100% 本地** — LLM 走 Ollama，没有任何对外网络
- **用户主动启用云端 LLM**：每次调用弹窗确认（可选"30 天内不再问"）+ audit log
- **跨设备同步走 P2P + E2EE**：复用既有基础设施
- **没有上报、没有遥测、没有 anonymous analytics**：从源头禁止

### 11.3 法律边界

- 自用 / 用户本人完全掌控数据流向 / 不二次分发 → 《个保法》个人或家庭事务豁免
- 处理含他人信息的数据（聊天对方、朋友圈他人内容）：本地分析 OK，禁止外传到任何第三方
- UI 文案 + 用户协议明示
- 不为司法证据 / 取证场景背书

---

## 12. Phase 拆分

> **本节基于 2026-05-19 真机 inventory 重排**：Redmi 24115RA8EC / Android 16 / SDK 36 上 175 个第三方 app 的实际分布，决定了 adapter 顺序与优先级。原 hypothetical 顺序（"先 Alipay 后 Taobao 后 WeChat"）已被以下基于 ROI × 风险评估的真实路线替代。
>
> **关键决策**：
>
> 1. **Foundation 5 phase（0-4）尽量薄**，把 AI 分析骨架快速搭起来，让每个新 adapter 接入立即产生用户价值
> 2. **EmailAdapter 提前到 Phase 5**——首个真实 adapter 不再选 Alipay，而是 IMAP。因为邮箱是**银行账单 + 订单确认 + 注册凭证 + 行程通知**的元数据中枢，一拍多得，ROI 远高于 Alipay 单一源
> 3. **EntityResolver 推迟到 Phase 8**——需要 2-3 个 adapter 的真实跨源数据来训练 / 标注，pre-data 阶段做是空对空
> 4. **AIChatHistoryAdapter（Phase 10）作为旗舰差异化** — 用户装了 8 家 AI（DeepSeek/Kimi/智谱/通义/混元/千帆/扣子/Dreamina），跨厂商对话史合一是任何单厂商做不到的独家价值
> 5. **WeChat 压轴（Phase 12）** — 难度最高 + 价值最高，放最后给团队最长准备期处理 Frida hook 与 SQLCipher 密钥提取的工程不确定性

| Phase                            | 内容                                                                                                                                                                                                                                                                                | 工期                          | 验收                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0**                      | UnifiedSchema 定义 + JSON Schema 校验器 + 文档                                                                                                                                                                                                                                      | 3d                            | schema 文档 + 单测 ≥ 20                                                                                                                                                                                                                                                                                              |
| **Phase 1**                      | LocalVault 表结构 + Keystore 主密钥 + SQLCipher 加密读写                                                                                                                                                                                                                            | 5d                            | 单测密钥旋转 / 损坏恢复 / 跨设备同步                                                                                                                                                                                                                                                                                 |
| **Phase 2**                      | AdapterRegistry + Adapter 接口规范 + KG ingestor + RAG 适配（mock adapter 验证管道）                                                                                                                                                                                                | 5d                            | mock adapter ingest 1k 事件 < 30s + RAG E2E                                                                                                                                                                                                                                                                          |
| **Phase 3**                      | **AI 分析层骨架** — `analysis.ask` 自然语言 Q&A + LLM prompt 工程（Ollama Qwen2.5-7B 默认）                                                                                                                                                                                         | 5d                            | mock 数据集 5 类典型问题答案准                                                                                                                                                                                                                                                                                       |
| **Phase 4**                      | 隐私 SOP UI（toggle / 范围 / 期限 / 审计 / 导出 / 擦除）+ Sync 引擎（手动 + Workflow 定时）                                                                                                                                                                                         | 5d                            | UI 全 + Workflow 定时跑 7 天稳定                                                                                                                                                                                                                                                                                     |
| **Phase 4.5**                    | **Python sidecar 基础设施 + 系统数据 adapter**（通讯录 / 通话记录 / 短信 / WiFi，作 EntityResolver 种子）                                                                                                                                                                           | 4d                            | PyInstaller 单文件 sidecar 启动 ≤ 1s；Android 通讯录 200+ 条灌入 LocalVault；通讯录电话号成为后续 Phase 5-12 Person 实体的权威 `identifiers.phone` 主键；详见 [`Adapter_System_Data.md`](./Adapter_System_Data.md)                                                                                                   |
| **Phase 5**                      | **EmailAdapter (IMAP)** — 首个真实 adapter，一拍多得                                                                                                                                                                                                                                | 7d                            | QQ 邮箱 (`com.tencent.androidqqmail`) + 189 邮箱 (`com.corp21cn.mail189`) 3 年邮件 → LocalVault → 自然语言查 "上个月有哪些银行账单到"                                                                                                                                                                                |
| **Phase 6**                      | **AlipayAdapter** (官方 CSV 导出 + 字段映射，详见 `Adapter_Alipay_Bill.md`)                                                                                                                                                                                                         | 3d                            | 12 个月账单 CSV → 完整消费 timeline，可问 "上月在外卖花了多少"                                                                                                                                                                                                                                                       |
| **Phase 7**                      | **Shopping 三件套**：TaobaoAdapter + JdAdapter + MeituanAdapter（Cookie + web API 框架可复用）                                                                                                                                                                                      | 7d                            | `com.taobao.taobao` + `com.jingdong.app.mall` + `com.sankuai.meituan` 订单 + 评价 + 收货地址 全接入                                                                                                                                                                                                                  |
| **Phase 8**                      | **EntityResolver 三段 pipeline**（规则剪枝 + embedding 召回 + LLM 仲裁，本地 Ollama）                                                                                                                                                                                               | 5d                            | 基于 Phase 5-7 真实跨源数据标 200 条 → 召回 ≥ 80% / 准确 ≥ 90%；UI review 队列上线                                                                                                                                                                                                                                   |
| **Phase 9**                      | **Travel 四件套**：AmapAdapter + BaiduMapAdapter + CtripAdapter + Train12306Adapter                                                                                                                                                                                                 | 7d                            | `com.autonavi.minimap` + `com.baidu.BaiduMap` + `ctrip.android.view` + `com.MobileTicket` 足迹 + 行程合并 E2E                                                                                                                                                                                                        |
| **Phase 10**                     | **AIChatHistoryAdapter（旗舰差异化）** — 跨 8 家 AI 厂商对话史合一                                                                                                                                                                                                                  | 7d                            | DeepSeek (`com.deepseek.chat`) + Kimi (`com.moonshot.kimichat`) + 通义 (`com.aliyun.tongyi`) + 智谱清言 (`com.zhipuai.qingyan`) + 混元 (`com.tencent.hunyuan.app.chat`) + 千帆 (`com.baidu.qianfan.llmkitchat`) + 扣子 (`com.coze.space`) + Dreamina (`com.bytedance.dreamina`) — 本地 LLM 能引用所有跨厂商历史问答  |
| **Phase 11**                     | **内置分析 skill 5 个** — spending / relations / footprint / interests / timeline + 月度报告 Workflow                                                                                                                                                                               | 7d                            | 每个 skill UI 卡片 + 单测 + 真机典型问题验收                                                                                                                                                                                                                                                                         |
| **Phase 12**                     | **WeChatAdapter（压轴）** — 微信聊天 + 朋友圈 + 公众号收藏（root + SQLCipher EnMicroMsg.db/SnsMicroMsg.db；密钥优先走 sjqz `wechat_decrypt.py` 的 IMEI+UIN MD5[:7] 方案，8.0+ 走 Frida hook libwechatmm.so 兜底）                                                                   | 7d（原 10d，sjqz 降险后 −3d） | `com.tencent.mm` Redmi 24115RA8EC 真机 5 年消息全量；sidecar `wechat.decrypt` + `wechat.parse` 两 method 复用；密钥提取脚本 + 文档可复用其它机器                                                                                                                                                                     |
| **Phase 13+**                    | **Long-tail 渐进**（按用户实际需求触发，非 v1 必选）：知乎 / 小红书 / 抖音 / 微博 / BOSS / 银行 PDF 邮件解析 / 个税 APP / i 厦门 / WPS + 腾讯文档 / 百度网盘 / 飞书 + 钉钉 + 企微 / 携程同程互补 / 滴滴 / 美柚 / 12123 / 网易云音乐 / 酷狗 / 爱奇艺 / 腾讯视频 / 头条 / 西瓜 / CSDN | ongoing                       | 每加一个不破现有；adapter 模板成熟后单 adapter 平均 2-3 天                                                                                                                                                                                                                                                           |
| **Phase 17 v0.1.0 (2026-05-24)** | **桌面本机数据五件套**：`browser-history-chrome` + `browser-history-edge`（Chromium 子类） + `vscode`（workspace + 全局终端历史） + `win-recent`（跨应用 .lnk 时间线） + `system-data-android v0.3.0`（媒体清单 5 类 /sdcard）                                                      | 1d                            | 全部 desktop-local 文件直读（零扩展、零网络、零账号）；4 adapter 真机实测：14689 visits + 27 bookmarks (Chrome) / 2022 visits (Edge) / 22 workspace + 32 命令 + 13 路径 (VSCode) / 52 .lnk (Win Recent) / 3751 media files (Android v0.3)；76 新单测 + 整合 + e2e 测试（bs3mc ABI 不匹配时本地 skip，CI Linux 真跑） |

**总工期估**：Phase 0-12 ≈ 77 天 ≈ **11 周（单人）**。

- v0.3 调整：+Phase 4.5 (4d) − Phase 12 (3d, sjqz 降险) = 净 +1d；不显著拖长 v1 工期
  **可并行压缩**：Phase 0-1（基础设施）+ Phase 2-4（管道）+ Phase 4.5（sidecar + 系统数据）+ Phase 5（首 adapter）三段可三人并行 → 8-9 周完成 v1。
  **已落地里程碑**（建议）：
- **M1 = Phase 4.5 结束**（基础设施 + sidecar + 系统数据 ready，EntityResolver 种子集到位）— 4-5 周
- **M2 = Phase 7 结束**（购物 + 邮箱 + 支付宝合一，覆盖 70% 消费场景）— 6 周
- **M3 = Phase 10 结束**（出行 + AI 对话合一，旗舰功能展示）— 9 周
- **M4 = Phase 12 结束**（微信打通，完整 v1）— 11 周

### 12.1 真实手机 inventory × Phase 映射

下表把 Redmi 24115RA8EC 上 175 个第三方 app 中**有数据采集价值的**全部列入，每个标对应 Phase 和 ROI 评级（⭐⭐⭐⭐⭐ = 必须 / ⭐⭐⭐ = v1 内含 / ⭐ = long-tail）：

| Phase | App 包名                                 | ROI        | 主要数据                            |
| ----- | ---------------------------------------- | ---------- | ----------------------------------- |
| 5     | `com.tencent.androidqqmail` (QQ 邮箱)    | ⭐⭐⭐⭐⭐ | 银行账单 / 订单确认 / 注册凭证      |
| 5     | `com.corp21cn.mail189` (189 邮箱)        | ⭐⭐⭐⭐   | 同上                                |
| 6     | `com.eg.android.AlipayGphone` (支付宝)   | ⭐⭐⭐⭐⭐ | 账单 + 出行 + 健康 + 缴费           |
| 7     | `com.taobao.taobao` (淘宝)               | ⭐⭐⭐⭐⭐ | 订单 + 评价 + 收货地址 + 浏览       |
| 7     | `com.jingdong.app.mall` (京东)           | ⭐⭐⭐⭐   | 同上 + 京豆 + 白条                  |
| 7     | `com.sankuai.meituan` (美团)             | ⭐⭐⭐⭐⭐ | 外卖 + 团购 + 酒店 + 打车           |
| 7     | `com.xunmeng.pinduoduo` (拼多多)         | ⭐⭐⭐     | 订单 + 砍价社交                     |
| 7     | `com.dianping.v1` (大众点评)             | ⭐⭐⭐⭐   | 浏览 + 收藏 + 评价                  |
| 9     | `com.autonavi.minimap` (高德地图)        | ⭐⭐⭐⭐⭐ | 足迹 + 搜索 + 导航 + 收藏地点       |
| 9     | `com.baidu.BaiduMap` (百度地图)          | ⭐⭐⭐⭐   | 同上                                |
| 9     | `com.MobileTicket` (12306)               | ⭐⭐⭐⭐   | 火车行程历史                        |
| 9     | `ctrip.android.view` (携程)              | ⭐⭐⭐⭐   | 机票 + 酒店 + 火车                  |
| 9     | `com.tongcheng.android` (同程)           | ⭐⭐⭐     | 与携程互补                          |
| 9     | `com.didi.es.psngr` (滴滴企业版)         | ⭐⭐       | 出差打车                            |
| 10    | `com.deepseek.chat` (DeepSeek)           | ⭐⭐⭐⭐   | AI 对话史                           |
| 10    | `com.moonshot.kimichat` (Kimi)           | ⭐⭐⭐⭐   | AI 对话史                           |
| 10    | `com.aliyun.tongyi` (通义千问)           | ⭐⭐⭐⭐   | AI 对话史                           |
| 10    | `com.zhipuai.qingyan` (智谱清言)         | ⭐⭐⭐⭐   | AI 对话史                           |
| 10    | `com.tencent.hunyuan.app.chat` (混元)    | ⭐⭐⭐     | AI 对话史                           |
| 10    | `com.baidu.qianfan.llmkitchat` (千帆)    | ⭐⭐⭐     | AI 对话史                           |
| 10    | `com.coze.space` (扣子)                  | ⭐⭐⭐     | AI agent 对话                       |
| 10    | `com.bytedance.dreamina` (Dreamina)      | ⭐⭐⭐     | AI 生图历史                         |
| 12    | `com.tencent.mm` (微信)                  | ⭐⭐⭐⭐⭐ | 聊天 5+ 年 + 朋友圈 + 公众号 + 支付 |
| 13+   | `com.zhihu.android` (知乎)               | ⭐⭐⭐     | 收藏 + 关注 + 自己回答              |
| 13+   | `com.xingin.xhs` (小红书)                | ⭐⭐⭐⭐   | 浏览 + 收藏 + 笔记                  |
| 13+   | `com.ss.android.ugc.aweme` (抖音)        | ⭐⭐⭐     | 点赞 + 关注 + 浏览                  |
| 13+   | `com.sina.weibo` (微博)                  | ⭐⭐       | 关注 + 发布                         |
| 13+   | `com.hpbr.bosszhipin` (BOSS 直聘)        | ⭐⭐⭐     | 沟通职位 + 简历                     |
| 13+   | `cn.gov.tax.its` (个税 APP)              | ⭐⭐⭐⭐   | 收入 + 雇主 + 申报                  |
| 13+   | `com.com.cmbc.newmbank` (民生银行)       | ⭐⭐⭐     | 交易明细 + 信用卡                   |
| 13+   | `com.chinamworld.bocmbci` (中国银行)     | ⭐⭐⭐     | 同上                                |
| 13+   | `com.bankcomm.maidanba` (交通银行)       | ⭐⭐⭐     | 同上                                |
| 13+   | `cn.gov.pbc.dcep` (数字人民币)           | ⭐⭐⭐     | DCEP 交易                           |
| 13+   | `com.tmri.app.main` (交管 12123)         | ⭐⭐       | 驾驶证 + 违章                       |
| 13+   | `com.xmgov.xmapp` (i 厦门)               | ⭐⭐       | 本地政务                            |
| 13+   | `cn.wps.moffice_eng` (WPS)               | ⭐⭐⭐     | 自创文档列表                        |
| 13+   | `com.tencent.docs` (腾讯文档)            | ⭐⭐⭐     | 同上                                |
| 13+   | `com.baidu.netdisk` (百度网盘)           | ⭐⭐⭐     | 文件 + 外链                         |
| 13+   | `com.alibaba.android.rimet` (钉钉)       | ⭐⭐⭐     | 工作消息 + 文档 + 审批              |
| 13+   | `com.ss.android.lark` (飞书)             | ⭐⭐⭐     | 同上（API 最开放）                  |
| 13+   | `com.tencent.wework` (企微)              | ⭐⭐⭐     | 同上                                |
| 13+   | `com.lingan.seeyou` (美柚)               | ⭐⭐       | 周期健康                            |
| 13+   | `com.intsig.camscanner` (扫描全能王)     | ⭐⭐       | 扫描文档归档                        |
| 13+   | `com.tianyancha.skyeye` (天眼查)         | ⭐⭐       | 自查公司关联                        |
| 13+   | `com.kugou.android` (酷狗)               | ⭐⭐       | 听歌历史                            |
| 13+   | `com.ss.android.article.news` (今日头条) | ⭐⭐       | 阅读偏好                            |
| 13+   | `net.csdn.csdnplus` (CSDN)               | ⭐⭐⭐     | 技术阅读 + 收藏                     |
| 13+   | `com.ss.android.auto` (懂车帝)           | ⭐⭐       | 汽车关注                            |
| 13+   | `com.qiyi.video` (爱奇艺)                | ⭐         | 观看历史                            |
| 13+   | `com.tencent.qqlive` (腾讯视频)          | ⭐         | 观看历史                            |
| 13+   | `com.tencent.mobileqq` (QQ)              | ⭐⭐       | 与微信重叠，老人脉补全              |
| 13+   | `com.smile.gifmaker` (快手)              | ⭐⭐       | 与抖音互补                          |

**显式跳过**（v1 + v2 不接入）：

- 厂商预装：所有 `com.miui.*` / `com.xiaomi.*`（除 `com.miui.notes` 用户笔记 v3+ 可考虑）
- 输入法：搜狗 / 讯飞 / 百度 / QQ 输入法 — 隐私敏感 + 提取难
- IoT / 摄像头：萤石 / IPC360 / 优视 / 蓝牙工具 / DroidCam
- 游戏：英雄联盟手游 / 小米云游戏
- 厂商 SDK / uniapp 包装应用：4 个 `uni.UNI*` / 爱奇艺 SDK
- ChainlessChain 自家：`com.chainlesschain.android` + debug + localterminal.test（中台本身）

---

## 13. 与现有系统集成

| 系统                 | 集成点                                       | 改动量                                         |
| -------------------- | -------------------------------------------- | ---------------------------------------------- |
| KG 引擎              | KG ingestor 调既有 triple 写入 API           | 新增 ingest 适配器，引擎不改                   |
| RAG 流水线           | `analysis.ask` 走 RAG 检索 UnifiedEvent      | 新增 collection "personal-data"，复用 pipeline |
| Skill 系统           | 每个 adapter / 每个分析模板 = skill          | 走既有 manifest + sandbox，零改动              |
| SQLCipher LocalVault | 新增 hub 专用 db（与既有 chat/note db 并列） | 仅加表 + 主密钥派生分支                        |
| Cowork 多代理        | `PersonalAnalysisAgent` 走 Cowork 复杂分析   | 新增 agent 定义，引擎不改                      |
| Workflow 引擎        | Adapter 定时同步 + 报告生成                  | 新增 workflow 模板                             |
| Ollama 集成          | LLM 推理走既有 client                        | 零改动                                         |
| DID + U-Key          | 主密钥派生 / 跨设备分发                      | 复用既有密钥派生 chain                         |
| P2P 同步             | 跨设备 vault 同步                            | 复用既有 sync feature（Phase 3b/3c/3d）        |

---

## 14. Traps & 风险

| #   | Trap                                                                | 描述                                                                | 缓解                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | EntityResolver 误合并                                               | "我爸"和"老板"都被 LLM 判为"老男人"误合                             | 三段 pipeline + review 队列 + 用户可拆分                                                                                                                                                                                               |
| T2  | adapter 触发 app 风控                                               | 频繁调淘宝 web API → 账号被风控                                     | 限流 + adapter 实现尊重 robots/正常用户节奏                                                                                                                                                                                            |
| T3  | 微信 SQLCipher 密钥提取失败（风险 高→**中**, v0.3 sjqz 引入后降级） | 微信 8.0+ 密钥从 IMEI 派生**部分**失效（仍适用 7.x + 8.0 早期版本） | (1) sjqz `wechat_decrypt.py` IMEI+UIN MD5[:7] 方案作主路径，覆盖大量历史版本；(2) Frida hook libwechatmm.so 拿运行时密钥作 fallback；(3) "用户自己提供密钥"作最终兜底；(4) 验证脚本 `verify_sqlcipher_key()` 已现成                    |
| T4  | KG ingest 过载                                                      | 历史 5 年数据初次 ingest → 几百万事件卡死                           | 分批 ingest + 进度条 + 后台慢跑                                                                                                                                                                                                        |
| T5  | LLM 幻觉                                                            | 数据稀疏时 LLM 编造金额/地点                                        | prompt 强制引 Event.id + UI 渲染回链 + RAG 空时显式 fallback                                                                                                                                                                           |
| T6  | Keystore 不可用                                                     | 部分设备 Keystore broken / TEE 故障                                 | fallback 到 DPAPI/file-based with PIN（明确告知用户安全降级）                                                                                                                                                                          |
| T7  | adapter ABI breaking                                                | adapter 升级 schema 不兼容旧数据                                    | adapter manifest 强制 semver + migration script                                                                                                                                                                                        |
| T8  | 用户期待"零配置全自动"                                              | 实际首次接入要扫码 / 输密码 / 开 root                               | 文案 + 渐进引导 + 完成感反馈                                                                                                                                                                                                           |
| T9  | 数据导出后用户上传到云端                                            | "数据回归个人"承诺被用户自己破坏                                    | UI 警示 + 默认导出格式带"勿外传"提示；产品边界                                                                                                                                                                                         |
| T10 | OCR 失真致 Event 错误                                               | 截图 OCR 把 "¥38.00" 读成 "¥3800"                                   | source.confidence < 1.0；UI 标记"低置信"badge；分析层加权                                                                                                                                                                              |
| T11 | RAG 召回不准                                                        | 用户问"上次跟妈妈聊去医院"召回与"医院"无关                          | 多路召回（关键词 + embedding + KG 实体）+ rerank                                                                                                                                                                                       |
| T12 | 跨设备同步冲突                                                      | 两台设备同时改同一 Person 的别名                                    | LWW + 审计 + UI 冲突视图                                                                                                                                                                                                               |
| T13 | Python sidecar 跨平台部署（v0.3 新增）                              | Win/Mac/Linux 三平台需各自打包；Android/iOS 端无法跑 Python sidecar | (1) PyInstaller 单文件三平台分别 build + 加入 release asset；(2) 移动端（Android/iOS）走 native adapter 直接读手机本地数据，不调 sidecar；(3) sidecar 仅 desktop 侧用，作"远程提取手机数据"通道（手机配对后 USB ADB / AFC 走 sidecar） |

---

## 15. 验收

### 15.1 端到端验收场景（v1 必须全通）

1. **基础 Q&A**："上个月我在淘宝总共花了多少钱？" → 准确金额 ± 0
2. **跨源关联**："我妈生日那周买了啥送哪儿？" → 跨 wechat + alipay + taobao 拼出答案
3. **时间线**："2024 年我去过厦门几次都做了啥？" → 时间线视图含订单/聊天/足迹
4. **隐私保证**：拔网线 → 上述所有 Q&A 仍正常工作（验证零外传）
5. **数据可携带**：导出 → 重装 → 导入 → 所有数据 + KG 完整恢复
6. **数据可销毁**：擦除 → 磁盘扫描 → 0 LocalVault 残留 + 0 Keystore 残留
7. **审计可追溯**：UI 点任意分析结果 → 看到引用的原始 Event + adapter source

### 15.2 性能验收

- 1k 事件 ingest < 30s
- 自然语言 Q&A 端到端 < 8s（含 LLM 推理）
- LocalVault 启动 < 1s（10 万事件规模）

### 15.3 隐私验收

- 抓包工具监听 → adapter 同步期间无外网流量（除 adapter 必需的源 app API）
- LLM 推理期间无外网流量
- audit log 完整记录每次数据访问

---

## 16. 后续演进 (v2+)

- **个性化 LoRA 微调**：基于用户自己的语料训练专属"懂你"模型
- **跨用户隐私计算**：家庭场景 N 人各持自己 vault，做 MPC 联合分析
- **物理世界数据接入**：智能手表 / 智能家居 / 车机数据
- **被动数据采集**：手机 Accessibility 全局抓取（含其他未集成 adapter 的 app）
- **数据 NFT / DID claim**：用户主动 attest 某段数据（如运动里程）到链上

---

## 17. 参考

- [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md) — 首个 adapter 切片（验证端到端）
- [`Personal_Data_Hub_Python_Sidecar.md`](./Personal_Data_Hub_Python_Sidecar.md) — Python sidecar (forensics-bridge) 设计 + IPC 协议 + 17 parser 映射 (v0.3)
- [`Adapter_System_Data.md`](./Adapter_System_Data.md) — Phase 4.5 系统数据 adapter 设计（通讯录/通话/短信/WiFi）(v0.3)
- 既有 `01_知识库管理模块.md` — KG / RAG 引擎
- 既有 `安全机制设计.md` — U-Key/SIMKey + SQLCipher
- 既有 `数据同步方案.md` — P2P + DID 同步
- 既有 `13_多代理系统.md` — Cowork agent 框架（PersonalAnalysisAgent 基础）
- 上游 fork 源：[`sjqz`](file://C:/code/sjqz) — Python mobile-forensics toolkit，17 parser + Android/iOS extraction + WeChat 解密（MIT License）

## 附录：规范章节补全（v5.0.3.108）

> 本文为个人数据中台主架构文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 背景 & 愿景」。Personal Data Hub（个人数据中台）把 ChainlessChain 从"个人 AI 工具集"升级为"用户全数据的本地中台 + AI 分析引擎"，兑现"数据回归个人"。v0.6：Phase 0–13 + 多平台采集 + Phase 13+ 长尾扩面均已落地，61 adapter（+2 平台族 base）/ ~139 测试文件 / 2236 测试，pdh npm 0.4.18。

### 2. 核心特性

UnifiedSchema 统一数据模型；EntityResolver 跨源实体消歧；LocalVault（SQLCipher）安全存储；61 adapter 多源采集；AI 分析引擎（hub.ask）。

### 3. 系统架构

见正文「4. 整体架构」（adapter → UnifiedSchema → EntityResolver → LocalVault → AnalysisEngine）。

### 4. 系统定位

ChainlessChain 的**个人全数据本地中台 + AI 分析引擎**。

### 5. 核心功能

见正文 5–7：UnifiedSchema / EntityResolver / LocalVault；多平台 adapter（邮件 / 支付宝 / 电商 / 出行 / 社交 / 微信 等）。

### 6. 技术架构

Node + better-sqlite3-multiple-ciphers（SQLCipher）；Python sidecar（forensics-bridge）；Ollama 本地 LLM + RAG；上游 fork sjqz（17 parser）。

### 7. 系统特点

本地优先 + 加密；adapter 可插拔（AdapterRegistry）；跨源 KG（EntityResolver）；端侧 / 远程混合分析。

### 8. 应用场景

跨源个人数据问答（"上个月在哪花了钱"）、消费 / 足迹 / 社交图谱、数据主权回归。

### 9. 竞品对比

vs 各 app 封闭生态：本地中台把分散数据取回统一 KG（见正文愿景 + `Personal_Data_Hub_sjqz_Comparison.md`）。

### 10. 配置参考

LocalVault SQLCipher 密钥；adapter cookie / 账号配置；Ollama / sidecar 依赖（见 `Personal_Data_Hub_Python_Sidecar.md`）。

### 11. 性能指标

2236 测试；同步 / 查询性能见 `Personal_Data_Hub_E2E_Runbook.md` 性能基准。

### 12. 测试覆盖

~139 测试文件 / 2236 测试（pdh npm 0.4.18）；真机 E2E 见各 Runbook。

### 13. 安全考虑

见正文「7. LocalVault 安全模型」：SQLCipher（AES-256）+ U-Key/SIMKey；高敏感数据本地不外发；隐私 Gate（见 `Personal_Data_Hub_Analysis_Skills.md` §4）。

### 14. 故障排除

adapter cookie / 端点漂移、SQLCipher 解密、sidecar 依赖缺失 → 见各 adapter / sidecar 文档。

### 15. 关键文件

`packages/personal-data-hub/lib/**`（adapters / analysis-skills / vault）；UnifiedSchema；EntityResolver；上游 sjqz。

### 16. 使用示例

见正文各 adapter 与 `hub.ask` 自然语言查询示例（§7.1 5 类问题）。

### 17. 相关文档

见正文末尾关联：各 `Adapter_*.md`、`Personal_Data_Hub_EntityResolver.md`、`Personal_Data_Hub_Python_Sidecar.md`、`Personal_Data_Hub_Analysis_Skills.md`、`Personal_Data_Hub_E2E_Runbook.md`、`Personal_Data_Hub_sjqz_Comparison.md`。
