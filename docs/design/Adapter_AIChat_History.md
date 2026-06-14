# Adapter: AI Chat History — 8 厂商跨平台 AI 对话史合一

> **状态**：v0.1 设计稿（2026-05-19）。Phase 10 待启。Personal Data Hub 的**旗舰差异化 adapter** — 任何单厂商都做不到的独家价值。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 10；前置 [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md) (Phase 5) + [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md) (Phase 6)
>
> **目标 app**（Redmi 24115RA8EC 真机已装确认 ✅）：
> - `com.deepseek.chat` — DeepSeek
> - `com.moonshot.kimichat` — Kimi
> - `com.aliyun.tongyi` — 通义千问
> - `com.zhipuai.qingyan` — 智谱清言
> - `com.tencent.hunyuan.app.chat` — 腾讯混元/元宝
> - `com.baidu.qianfan.llmkitchat` — 百度千帆
> - `com.coze.space` — 字节扣子 (agent 平台)
> - `com.bytedance.dreamina` — Dreamina (AI 生图/视频)
>
> **为什么这是旗舰差异化**：用户跨 8 家厂商的 AI 对话史本身是**信息孤岛**，每家只看到自己份额。把它们合到本地 vault 后：
> 1. 本地 LLM 通过 RAG **看见用户过去问过任何 AI 的所有问题**——任何单厂商都做不到
> 2. 形成"AI 使用画像"——哪类问题倾向问哪家、用 AI 频次、问题主题演化
> 3. 用户摆脱厂商 lock-in——历史可携带，换厂商不丢上下文
> 4. 重新利用——旧对话可作为新提示词的 few-shot 例子
>
> **核心承诺**：ChainlessChain 是**唯一** AI 工具能告诉你"你 3 个月前问过 DeepSeek 怎么做 X，下面是当时的对话和后续 follow-up"。

---

## 1. 背景

### 1.1 AI 用户的"碎片化对话史"现状

典型 2026 重度 AI 用户的对话流场景：

| 场景 | 倾向用 |
|---|---|
| 写代码 / debug | DeepSeek (擅 reasoning + 中文好) |
| 长文档阅读 / 资料整理 | Kimi (200k 上下文) |
| 阿里云生态相关 | 通义 (生态绑定) |
| 国产学术 / 政企 | 智谱 (ChatGLM 系) |
| 微信生态搜索 | 混元/元宝 |
| 百度生态 | 千帆 |
| 复杂 agent 任务 | 扣子 |
| 海报 / 商品图 | Dreamina |

用户**在跨 8 家厂商之间脑内做路由决策**，但每次决策的上下文（"我之前问过类似的"）只存在于**某一家的服务器**，跨家不可见。

### 1.2 现有解决方案的缺陷

| 方案 | 缺陷 |
|---|---|
| 手动复制粘贴各家对话存 Markdown | 不增量 / 不结构化 / 无 RAG |
| 浏览器插件抓 (如 ChatGPT Exporter) | 单厂商插件碎片化，没人做国产全家桶 |
| 用某厂商的"导出"功能 | 多数国产厂商**没有官方导出**；有的只导单条 |
| 第三方 SaaS 聚合工具 | 数据上传第三方——与"数据回归个人"完全相反 |

**ChainlessChain 是第一个把"AI 对话史回归用户本地"做成核心能力的工具**。

### 1.3 与已有 ChainlessChain 能力的接口

| 既有能力 | 本 adapter 复用 |
|---|---|
| iOS Phase 5 AIChat skill | 既有 conversation/message 模型可参考，本 adapter 输出对齐 |
| KG 引擎 + RAG | 对话 ingest 进 KG → RAG 召回 |
| Skill 系统 | 每家厂商一个 adapter sub-skill |
| WebView (Electron 内嵌) | Cookie 鉴权流程 |
| Cowork 多代理 | 跨家分析 ("我跨家问过的同类问题对比") |

---

## 2. 目标 & 非目标

### 2.1 目标 (v1 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | 8 家厂商各 1 个 adapter 实现 | 每家 sub-skill 独立测试通过 |
| G2 | 鉴权 UX 统一：内嵌 WebView 登录 + Cookie 提取 | 用户在 ChainlessChain UI 完成 8 家登录 < 15 分钟 |
| G3 | 增量同步：每家会话列表 + 消息（cursor / since-id watermark） | 重跑 0 重复，新增对话即时同步 |
| G4 | 跨家 UnifiedSchema 统一映射（Conversation + Message + AIVendor） | KG 中可跨家查询 |
| G5 | 图像 / 代码块 / Markdown / 文件附件 保真 | 1k 消息样本 fidelity ≥ 95% |
| G6 | **RAG 接通 — 本地 LLM 看见所有跨厂商对话** | E2E："我之前问过 AI 怎么做 X" → 召回相关历史 |
| G7 | 隐私 SOP：对话明文加密本地存 + 不向任何厂商回传 | 抓包验证 |
| G8 | Cookie 过期检测 + 一键重登 | UI 通知 + WebView 续登 < 1 分钟 |
| G9 | **跨家分析 skill** — "用 AI 的画像 / 主题分布 / 频次趋势" | 月度报告 Workflow |

### 2.2 非目标 (defer)

- **海外厂商**（ChatGPT / Claude / Gemini / Perplexity）— v2，国内网络考虑独立；架构兼容
- **DeepSeek API 模式 / Kimi API 模式**（用户用自己的 API key 而非 web）— v2，配置成本更高
- **写回 / 修改 / 删除厂商侧对话** — adapter 只读
- **AI 主动调用（continue conversation）** — 那是 iOS Phase 5 既有 chat 功能，不是 history adapter
- **图像 / 视频 原文件下载** — v1 只存 URL + 缩略图，原文件按需下载
- **agent / workflow 复杂结构（扣子）** — v1 拍平为 message 序列；v2 加 agent topology
- **多账户每家** — v1 每家一个登录账户；v2 加多账户切换
- **企业版 / 团队对话** — v1 个人账户专用
- **OAuth2 / token 鉴权（厂商提供时）** — v1 全走 cookie+WebView；v2 升级
- **实时 stream**（边对话边 ingest）— v1 是 batch sync 模式

---

## 3. Open Questions

### OQ-1：鉴权方式

**A**：用户提供 cookie 字符串（高级用户从浏览器 devtools 拷）
**B**：ChainlessChain 内嵌 WebView 让用户登录 → 拦截 Cookie storage
**C**：QR 码扫码（部分厂商支持）
**D**：纯 API key（厂商提供时）

**推荐 B**。理由：(1) A 普通用户做不到；(2) B 一次性流程 + 用户掌控登录全程 + cookie 透明拦截；(3) C 仅部分厂商支持，覆盖度不全；(4) D 厂商多数不提供个人 API key 给 web chat 服务。备用：B 失败时 fallback 到 A。

### OQ-2：Cookie 存储

**A**：所有 8 家 cookie 存同一 vault 表
**B**：每家独立 vault namespace
**C**：每家独立 Keystore key

**推荐 B**。理由：(1) A 一家泄露全军覆没；(2) B 平衡 — 同 vault 但表分；(3) C 过度工程 — Keystore 8 个 key 增加运维复杂度。每家 vault row 含 `vendor / cookie_blob / extracted_at / last_validated / expires_estimate`。

### OQ-3：增量同步策略（每家差异）

**A**：每家用自己的 cursor/since-id（厂商 API 给啥用啥）
**B**：用 `updated_at > last_synced_at` 通用过滤
**C**：A + B 兜底

**推荐 C**。理由：(1) A 优先（厂商原生分页最稳）；(2) B 兜底（厂商 cursor 失效时按时间）；(3) 每家 adapter 在 sync_watermarks 表存 `(vendor, cursor, last_synced_at, last_message_id)` 四元组。

### OQ-4：消息粒度

**A**：每条消息一个 Event（细粒度，方便 RAG）
**B**：每对话一个 Event（粗粒度，content 是消息数组）
**C**：A 主 + B 派生 Conversation Topic

**推荐 C**。理由：(1) A 让 RAG 召回精准，每条消息可独立 cite；(2) B 让"对话级元数据"（标题 / 模型 / 耗时）有处放；(3) C 双层：Event[type=ai-message] 一条消息 + Topic[type=ai-conversation] 一对话元数据，通过 KG edge 关联。

### OQ-5：跨家用户身份合一

**A**：每家用户独立 Person 实体（self-deepseek / self-kimi ...）
**B**：所有 self-* 自动合并为 "person-self"
**C**：默认 B，用户可拆

**推荐 C**。理由：(1) 8 家都是同一个用户的不同账户；(2) 默认合一让分析层简单（"我所有 AI 对话"）；(3) 但保留 vendor-specific identifier 作为 Person.identifiers 子字段，允许用户万一需要拆开（如家庭共用账号场景）。

### OQ-6：图像/附件 v1 存储策略

**A**：只存 URL（厂商 CDN 链接，可能过期）
**B**：URL + 自动下载缩略图 + 按需下载原图
**C**：URL + 全量下载原图（爆磁盘）

**推荐 B**。理由：(1) A URL 失效后历史无法看图；(2) B 缩略图 50KB × 1k = 50MB 可接受 + 用户可在 UI 主动"下载原图"；(3) C 一张 4K 图 5MB × 大量历史 = 几十 GB。

### OQ-7：扣子 (Coze) agent 结构展平

**A**：每个 agent run 拍平为单 message
**B**：保留 agent / workflow / tool-call 子结构
**C**：A + B 双层

**推荐 A 起步，C 备份**。理由：(1) v1 简化为 message 序列，agent 元数据进 extra；(2) v2 用户提需求时升级到 C 含 tool-call topology；(3) 起步保持 schema 简单。

### OQ-8：Dreamina 形态不同

**A**：当作 AI chat 同处理（prompt + generated image 作为 message）
**B**：单独 ImageGenerationAdapter
**C**：A，但 message subtype = "image-generation"

**推荐 C**。理由：(1) 与其他 7 家 schema 兼容；(2) subtype 让 UI / 分析层可特殊渲染；(3) 不需独立 adapter，复用同框架。

---

## 4. 整体架构

### 4.1 分层

```
┌────────────────────────────────────────────────────┐
│ AIChatHistoryAdapter (framework)                   │
│  - 统一 sync 调度 / watermark / dedup / KG ingestor │
│  - 统一 UnifiedSchema 映射                          │
│  - 统一 WebView 鉴权 + cookie 提取                  │
├────────────────────────────────────────────────────┤
│ Vendor sub-adapters (8 个，实现 VendorAdapter 接口) │
│  ┌──────────┬──────────┬──────────┬──────────┐    │
│  │ DeepSeek │ Kimi     │ Tongyi   │ Zhipu    │    │
│  ├──────────┼──────────┼──────────┼──────────┤    │
│  │ Hunyuan  │ Qianfan  │ Coze     │ Dreamina │    │
│  └──────────┴──────────┴──────────┴──────────┘    │
│  每个负责：                                          │
│   - 该厂商登录 URL + cookie 域名                     │
│   - 该厂商会话列表 / 消息 API endpoint              │
│   - 该厂商响应 JSON → 通用 RawConversation/RawMessage│
│   - 该厂商分页 / cursor / rate-limit 处理            │
└────────────────────────────────────────────────────┘
```

### 4.2 VendorAdapter 接口

```typescript
interface VendorAdapter {
  readonly vendor: AIVendor;               // "deepseek" | "kimi" | ...
  readonly displayName: string;            // "DeepSeek" / "Kimi" / ...
  readonly androidPackage: string;         // 用于检测用户是否装

  // 登录配置
  readonly loginUrl: string;               // WebView 打开的页面
  readonly loggedInDetector: (page) => boolean;  // 检测登录态
  readonly cookieDomains: string[];        // 要提取的 cookie 域

  // 会话拉取
  listConversations(opts: SyncOptions): AsyncIterable<RawConversation>;
  listMessages(conversationId: string, opts: SyncOptions): AsyncIterable<RawMessage>;

  // 限流策略
  readonly rateLimits: { perMinute: number; minIntervalMs?: number };

  // 健康检查（cookie 是否有效）
  validateCookie(): Promise<{ ok: boolean; reason?: string }>;

  // 厂商特定 normalization（可选 override 父类默认）
  normalizeMessage?(raw: RawMessage): Message;
}
```

### 4.3 父 adapter 主循环

```
启动 sync
  ↓
1. 对每个已登录的 vendor：
   a. validateCookie() — 过期 → 标 AUTH_EXPIRED + 通知用户重登
   b. listConversations() yield → 取 cursor watermark
   c. 对每个新/更新的 conversation：
      - listMessages() yield 该会话内的所有消息
      - 每条消息 normalize → Event[type=ai-message]
      - 该会话 normalize → Topic[type=ai-conversation]
   d. 持久化 watermark
  ↓
2. KG ingestor:
   - Person-self ←→ Event(actor=self, vendor=X) 创建 sent-message edge
   - Topic[ai-conversation] ←→ Event(message) 创建 contains-message edge
  ↓
3. RAG ingestor:
   - 把消息 text 喂 embedding → personal-data-ai-history collection
```

---

## 5. UnifiedSchema 映射

### 5.1 RawConversation / RawMessage

```typescript
interface RawConversation {
  vendor: AIVendor;
  originalId: string;            // 厂商侧 conversation id
  title?: string;
  modelName?: string;            // 如 "deepseek-r1" / "kimi-1.5"
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  archived?: boolean;
  extra?: Record<string, any>;   // 厂商特定字段
}

interface RawMessage {
  vendor: AIVendor;
  originalId: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: MessageContent;
  createdAt: number;
  parentMessageId?: string;       // 多轮分支
  modelName?: string;             // 实际响应 model（每 message 可不同）
  extra?: Record<string, any>;
}

interface MessageContent {
  text?: string;                  // Markdown 字符串
  attachments?: Attachment[];
  toolCalls?: ToolCall[];         // 扣子 agent
  generatedImages?: GeneratedImage[];  // Dreamina
}

interface Attachment {
  type: "file" | "image";
  filename?: string;
  url: string;                    // 厂商 CDN
  localThumbnailPath?: string;
  size?: number;
  mimeType?: string;
}

interface GeneratedImage {
  url: string;
  localThumbnailPath?: string;
  prompt: string;
  model?: string;
  params?: Record<string, any>;
}
```

### 5.2 → UnifiedSchema

**每条 message → Event**：

```typescript
{
  id: "evt-uuid",
  type: "event",
  subtype: "ai-message",           // 或 "ai-image-generation" (Dreamina)
  occurredAt: raw.createdAt,
  actor: raw.role === "user" ? "person-self" : "person-ai-<vendor>",
  participants: ["person-self", "person-ai-<vendor>"],
  content: {
    title: undefined,
    text: raw.content.text,
    mediaRefs: raw.content.attachments?.map(a => a.url),
  },
  topics: ["topic-conv-<originalConversationId>"],
  source: {
    adapter: "ai-chat-history",
    adapterVersion: "0.1.0",
    originalId: raw.originalId,
    capturedAt: <now>,
    capturedBy: "api",
    capturedFrom: raw.vendor,
  },
  extra: {
    vendor: raw.vendor,
    conversationOriginalId: raw.conversationId,
    role: raw.role,
    modelName: raw.modelName,
    parentMessageId: raw.parentMessageId,
    toolCalls: raw.content.toolCalls,
    generatedImages: raw.content.generatedImages,
  },
}
```

**每对话 → Topic**：

```typescript
{
  id: "topic-conv-<originalConversationId>",
  type: "topic",
  name: raw.title || "(无标题对话)",
  derivedFromEvents: [...allMessageEventIds],
  extra: {
    vendor: raw.vendor,
    type: "ai-conversation",
    modelName: raw.modelName,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    messageCount: raw.messageCount,
  },
}
```

**Vendor → Person**（每家 AI 一个虚拟 Person）：

```typescript
{
  id: "person-ai-deepseek",
  type: "person",
  subtype: "ai-agent",              // 新增 subtype
  names: ["DeepSeek"],
  identifiers: { vendor: "deepseek" },
  notes: "DeepSeek (com.deepseek.chat) — 用户的 DeepSeek AI 助手账户",
}
```

### 5.3 KG triples 派生

```
Event(message) --by--> Person(self) or Person(ai-<vendor>)
Event(message) --in-conv--> Topic(ai-conversation)
Event(message) --vendor--> Vendor(<name>)         (新增 Vendor 实体或用 Topic 表达)
Topic(ai-conversation) --uses-model--> Model(<modelName>)
Topic(ai-conversation) --about--> [LLM-extracted topic from title + first 3 messages]
```

---

## 6. 各厂商关键技术细节

> v1 通过 reverse-engineering（用户自用，浏览器抓包学）+ 用户社区已知工具参考。所有 API 路径**写代码前必须重新抓包确认**（厂商频繁改）。

### 6.1 DeepSeek (`com.deepseek.chat`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://chat.deepseek.com/` |
| 主要 cookie | `userToken` / session cookie |
| 会话列表 API | `GET /api/v0/chat_session/fetch_page?count=N&before=<cursor>` |
| 消息 API | `GET /api/v0/chat/history_messages?chat_session_id=<id>` |
| 分页 | cursor `before` (前向时间) |
| 风控 | 中等；同 cookie 多机器并发会限 |
| 特别 | R1 reasoning 模型有 `thinking` 字段单独存（v1 拍进 message.extra.thinking） |

### 6.2 Kimi (`com.moonshot.kimichat`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://kimi.com/` (旧 kimi.moonshot.cn) |
| 主要 cookie | `access_token` / `refresh_token` |
| 会话列表 API | `POST /api/chat/list` |
| 消息 API | `GET /api/chat/<id>/segment/scroll?last_id=<msgId>` |
| 分页 | last_id |
| 特别 | 长文档对话有 `kimi_docs` 元数据 + 用户上传的文档（v1 存 URL，v2 下载原文件） |

### 6.3 通义 (`com.aliyun.tongyi`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://tongyi.aliyun.com/` (或 qianwen.aliyun.com) |
| 主要 cookie | 阿里通用账号 `_csrf` / `XSRF-TOKEN` |
| 会话列表 API | `POST /dialog/conversation/list` |
| 消息 API | `POST /dialog/conversation/messages` |
| 风控 | 强；阿里通用 anti-bot；需正常用户 UA + 节奏 |
| 特别 | 需 X-CSRF 头；多模态消息有 `image_list` / `file_list` |

### 6.4 智谱清言 (`com.zhipuai.qingyan`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://chatglm.cn/` |
| 主要 cookie | `chatglm_token` |
| 会话列表 API | `GET /chatglm/backend-api/v1/conversation/list` |
| 消息 API | `GET /chatglm/backend-api/v1/conversation/<id>` |
| 风控 | 中 |
| 特别 | GLM-4 系列模型；有 web search 调用注入消息 |

### 6.5 混元/元宝 (`com.tencent.hunyuan.app.chat`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://yuanbao.tencent.com/` (元宝品牌) |
| 主要 cookie | `hy_token` + 腾讯 `uin` 系列 |
| 会话列表 API | `POST /api/user/conv/list` |
| 消息 API | `POST /api/user/conv/<id>/message/list` |
| 风控 | 强；腾讯通用 anti-bot |
| 特别 | 微信生态联动消息可能引用微信链接 |

### 6.6 千帆 (`com.baidu.qianfan.llmkitchat`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://yiyan.baidu.com/` (一言) 或 `https://qianfan.cloud.baidu.com/` |
| 主要 cookie | `BAIDUID` + `BDUSS` |
| 会话列表 API | `POST /aichat/conversation/list` |
| 消息 API | `POST /aichat/conversation/getMessages` |
| 风控 | 强；百度全链路 anti-bot |

### 6.7 扣子 (`com.coze.space`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://www.coze.cn/` |
| 主要 cookie | 字节通用 `s_v_web_id` |
| 会话列表 API | `GET /api/conversation/list` |
| 消息 API | `GET /api/conversation/<id>/message` |
| 特别 | agent 平台：每个对话绑某个 bot；tool calls 多；workflow 可能嵌套；v1 拍平，v2 保 topology |

### 6.8 Dreamina (`com.bytedance.dreamina`)

| 项 | 值 |
|---|---|
| 登录 URL | `https://dreamina.com/` 或 `https://jimeng.jianying.com/` |
| 主要 cookie | 字节通用 + creator workspace token |
| 会话列表 API | `POST /api/workspace/list` (作品集) |
| 消息 API | 实际是"作品列表"，每作品一个 prompt + N 张图 |
| schema | message.subtype = "ai-image-generation"，content.generatedImages 含 prompt + URLs |
| 特别 | 图像 CDN URL 有签名过期；v1 抓 URL，缩略图本地化 |

### 6.9 豆包 Doubao (`com.larus.nova`)

ByteDance 的旗舰文本 AI 助手，与 Dreamina（图像/视频）同源但 web 域名独立。作为第 9 家 vendor 接入。

| 项 | 值 |
|---|---|
| 登录 URL | `https://www.doubao.com/chat/` |
| 主要 cookie | `.doubao.com` + `www.doubao.com` |
| 用户校验 API | `POST /samantha/user/info`（响应 `data.user_id` / `data.uid`） |
| 会话列表 API | `POST /samantha/conversation/list`，body `{ cursor, count }`，响应 `data.conversation_list[]` + `cursor` + `has_more` |
| 消息列表 API | `POST /samantha/conversation/<id>/message/list`，body `{ conversation_id, cursor, count }`，响应 `data.message_list[]` + `cursor` + `has_more` |
| 分页机制 | opaque cursor + has_more（**不是** offset/page number）；hard cap 200 页 |
| 时间字段 | `create_time` / `last_message_time` / `update_time`（秒级 epoch，`_toMs` 检测 >1e12 不再 ×1000） |
| 角色字段 | `sender_type` 兼容数字（1=user / 2=assistant / 3=system）+ 字符串（`USER` / `ASSISTANT` / `SYSTEM` + 小写）|
| modelName 取舍 | 取 `bot_name`（豆包账号支持多 bot 角色），`extra.botId` 保留原 id 供 KG 分组 |
| 附件 | text + optional `attachments[]`（image / file），v1 scaffold 仅保 url + filename + size + mimeType |
| 节奏 | `rateLimits: { perMinute: 20, minIntervalMs: 2000 }` — 比标准 8 家略激进，因豆包 web 端响应快 |
| 已落地 | Phase 10.2(+) v0.1 scaffold（5 单测 + 一并接入 `DEFAULT_VENDOR_SPECS`），Phase 10.4 真账号 har 抓包 pin 字段名 |

**与 §6.8 Dreamina 的关系**：同字节出品但完全独立 — Dreamina 是图像/视频 workspace，豆包是文本对话。两者 cookie 不互通（不同子域），可同时接入；UnifiedSchema 通过 `vendor` 字段区分。

**SPEC 防御策略**：`_extractConvList` / `_extractMsgList` 同时识别 `conversation_list` / `conversations` / `list` 三种字段名（消息侧 `message_list` / `messages` / `list`），吸收 Phase 10.4 字段名 drift 不破 sync。

---

## 7. AI 分析价值

### 7.1 8 家接入后立即可问

| 问题 | 数据路径 |
|---|---|
| "我上周问 AI 最多的主题是什么？" | filter 时间窗 + group by topic + count |
| "我用 DeepSeek 比 Kimi 频率高吗？" | group by vendor + count |
| "我 3 个月前问过怎么做 X，给我看下当时的对话" | RAG 召回 + cross-vendor |
| "我跨家问过同样的问题吗？" (Cowork agent 跨家对比) | embedding 相似度 跨 vendor |
| "Kimi 帮我读过的所有 PDF 主题" | filter vendor=kimi + extra.kimi_docs |
| "我用 AI 生成过多少图？" | subtype=ai-image-generation count |
| "我用混元搜过什么微信公众号文章？" | filter vendor=hunyuan + content match |
| "我请扣子 agent 跑过哪些工作流？" | filter vendor=coze + extra.toolCalls |
| "我最长的一次 AI 对话？" | order by messageCount desc |

### 7.2 与其他 adapter 跨源

- **AI 对话 × 邮箱**：用户用 AI 起草的邮件 → 实际发送的邮件（对话与 Email 关联）
- **AI 对话 × 网盘**：AI 帮分析的 PDF 落在百度网盘 / 腾讯文档
- **AI 对话 × 工作 IM**：用户问 AI 然后转贴给同事（钉钉/飞书消息）
- **AI 对话 × 购物**：用 AI 选购买决策 → 实际下单（Taobao/JD）

### 7.3 旗舰 use case："我的 AI 副驾驶记忆"

本地 Ollama LLM 启动时**自动 RAG load 用户最近 7 天 AI 对话**作 context：

> 用户：写一个 React hook 防 debounce 输入
> Ollama (with RAG context)：你上周二在 DeepSeek 问过类似的（hook useDebounce），当时给的方案是 X，今天要不要在那基础上 +Y？

这是任何单厂商无法做到的——**跨厂商连续记忆**。

---

## 8. UI/UX

### 8.1 8 家厂商总览页

```
┌─ AI 对话史 (跨 8 家)──────────────────────────┐
│                                                │
│  ✅ DeepSeek      已连 │ 1,234 条 │ 5min 前    │
│  ✅ Kimi          已连 │   823 条 │ 5min 前    │
│  ⚠️ 通义           cookie 过期，[重新登录]      │
│  ⚪ 智谱清言       未连接 [登录]                │
│  ⚪ 混元           未连接 [登录]                │
│  ⚪ 千帆           未连接 [登录]                │
│  ⚪ 扣子           未连接 [登录]                │
│  ⚪ Dreamina       未连接 [登录]                │
│                                                │
│  总消息：2,057  总对话：143                     │
│  [立即同步全部]                                 │
└────────────────────────────────────────────────┘
```

### 8.2 添加厂商流程

```
点 [登录] →
WebView 弹窗打开厂商登录页 →
用户用账号 / 手机短信 / 扫码 / 微信扫码 等正常方式登录 →
ChainlessChain 检测到 loggedInDetector 触发 →
后台静默抓取 cookies →
保存到 vault →
WebView 关闭 →
首次全量同步开始（后台 + 进度条）
```

### 8.3 跨家搜索界面

ChatPanel 加入跨家历史搜索框：

```
搜索框：[ 我之前怎么 implement 的 useDebounce ]

结果：
─ DeepSeek · 2026-03-15 · "React Hook 防抖" ────
   我：写一个 React hook 防 debounce 输入
   AI：你可以用 useEffect + setTimeout...
   [打开完整对话]

─ Kimi · 2026-04-02 · "防抖最佳实践对比" ────
   我：useDebounce hook 和 lodash.debounce 有什么区别
   AI：useDebounce 是 React 生命周期适配...
   [打开完整对话]
```

### 8.4 对话详情视图

镜像 iOS Phase 5 AIChat 的 bubble UI：
- 左气泡 = AI 回复（顶部小标签：DeepSeek-R1 / Kimi-1.5 / ...）
- 右气泡 = 用户
- 流式 thinking（DeepSeek-R1）折叠显示
- 附件 / 图片 inline 渲染
- 长按消息 → "在 ChainlessChain 中跟进"（把这条对话作为 system prompt 起新对话）

### 8.5 跨家分析报告（v1 Workflow 自动月度）

```
┌─ 2026 年 5 月 AI 使用报告 ─────────────────┐
│ 总对话：43 │ 总消息：512 │ 总 token est: 2.3M │
│                                              │
│ 频次分布:                                     │
│   DeepSeek ████████████ 60%                  │
│   Kimi     ████ 20%                          │
│   通义     ██ 10%                            │
│   其它    █ 10%                              │
│                                              │
│ 主题 TOP 5（LLM 抽）:                         │
│   1. 代码 / debug 207 条                      │
│   2. 资料阅读 84 条                           │
│   3. 写作 / 邮件起草 51 条                    │
│   4. 文档总结 47 条                           │
│   5. 图像生成 26 条                           │
│                                              │
│ 异常洞察：                                    │
│   - 周三晚 23 点你密集问了 AI 35 分钟（不健康）│
│   - 你跨家重复问过相同问题 7 次（可整合 prompt）│
└──────────────────────────────────────────────┘
```

---

## 9. 安全 & 隐私

### 9.1 Cookie 高敏

**cookie 等于厂商账户**，泄漏 = 用户被人冒充。

- Keystore 加密，每家独立 namespace
- 不显式暴露给 skill sandbox（adapter 主进程独占）
- audit log 记录每次 cookie 使用（包括同步 / 重试）
- 用户可一键"撤销并删除"某家 cookie

### 9.2 数据出端控制

**绝对不允许**任何形式的对话数据外传到非用户控制的端：

- 同步走厂商原生 API + 用户自己的 cookie，不经过 ChainlessChain 后端
- LLM 推理走本地 Ollama
- 跨设备同步走 P2P + DID + E2EE
- 抓包工具验证：adapter 期间网络流量目的地仅厂商自己 + 内 LAN

### 9.3 厂商风控规避（伦理边界）

- 严格尊重 rateLimits（厂商真实限流）
- 用真实浏览器 UA + 默认 timing 间隔（不堆并发）
- WebView 而非 raw HTTP（cookie 链路与真实浏览器一致）
- 不调任何"破解 / 绕过"工具
- **若厂商 ToS 明确禁止程序化访问，UI 弹窗显式提示用户阅读 + 同意**（v1 默认所有 8 家用户自负）

### 9.4 用户被封号风险

- 用户登录的是自己账户，自承风险
- 文案明示："adapter 模拟正常浏览器访问。极小概率厂商可能识别非标行为限号。建议保持节奏不过于频繁，避免短时间同步全部历史。"
- 同步默认"增量"（首次只拉最近 30 天，由用户在 UI 决定是否拉全量）

---

## 10. 测试计划

### 10.1 单测

- 每个 vendor adapter：mock HTTP responses，覆盖 list/message/分页/错误（cookie 过期 / rate limit / 5xx）
- 通用 framework：sync 调度 / watermark / dedup / KG ingest
- UnifiedSchema 映射：每家 fixture ≥ 10 条，覆盖文本/代码块/Markdown/附件/图像/工具调用
- WebView cookie 提取：mock cookie storage，验证抽取正确

### 10.2 集成测试

- 端到端：fixture vendor server → adapter → LocalVault → KG → RAG → Q&A
- 多 vendor 并行：8 家同时 sync，无 cookie 串通 / 无表锁
- 跨 vendor RAG："同样问题问过吗" 在 mixed fixture 上召回

### 10.3 真机 E2E（用户自己账号）

| 场景 | 验收 |
|---|---|
| 8 家全部登录 | WebView 流程 < 15 分钟完成 |
| 全量历史同步 | 各家近 6 个月对话 + 消息齐 |
| 跨家自然语言搜 | §7.1 9 类问题全通 |
| Cookie 过期 | UI 提示 + 重登 < 1 分钟 |
| 厂商 API 变更 | adapter manifest 版本 + 兼容老 fallback |
| 大量历史性能 | 5k 消息 ingest < 60s + RAG embed 后台慢跑 |
| Dreamina 图像 | 缩略图本地化 + 原图按需下载 |
| 扣子 tool calls | message.extra 含 toolCalls 数组 |
| 月度报告 Workflow | 月初 1 号自动生成 + 通知 |

---

## 11. Phase 拆分

| Sub-phase | 内容 | 工期 |
|---|---|---|
| 10.1 | 框架：VendorAdapter 接口 + 父 adapter 主循环 + UnifiedSchema 映射 + WebView 鉴权流程 | 1.5d |
| 10.2 | DeepSeek + Kimi 两家（最简单 API，先验证框架） | 1.5d |
| 10.2(+) | 豆包 Doubao scaffold（第 9 家，字节文本 AI；validateCookie + listConversations + listMessages + _extractList 防御 + 5 单测，字段名待 10.4 har pin） | 0.5d |
| 10.3 | 通义 + 智谱 + 混元 + 千帆 四家（中文厂商批量） | 2d |
| 10.4 | 扣子 (agent 结构) + Dreamina (图像生成) + 豆包 har 字段 pin | 1d |
| 10.5 | 跨家分析 skill + 月度报告 Workflow + UI 概览页 | 1d |

**总**：~7.5 天，与父文档 §12 Phase 10 工期一致（豆包 scaffold 半天插入 10.2 与 10.3 之间）。

---

## 12. Traps & 风险

| # | Trap | 描述 | 缓解 |
|---|---|---|---|
| T1 | 厂商 API 频繁变 | 抓包写的代码 1 周失效 | adapter manifest semver + 版本兼容回退表 + 用户社区贡献 patch |
| T2 | Cookie 过期触发率高 | 部分厂商每周需重登 | 后台 health check + 提前 3 天预警 + 一键重登流程 |
| T3 | 厂商风控误判 | adapter 节奏被识别非正常 → 账号风控 | 默认节奏温和（每分钟 < 10 请求）+ 用户可设更慢 + 失败立即停止 |
| T4 | 跨厂商消息时间戳冲突 | 服务器时区 / 客户端时区混 | 一律转换为 UTC ms + 保留 raw |
| T5 | WebView 上抓 cookie 失败 | 第三方 cookie storage / SameSite=Strict | 使用 Electron session.cookies.get + 必要时拦截 set-cookie header |
| T6 | DeepSeek R1 thinking 内容超长 | 一条消息 thinking 字段 50KB+ | 存 vault 时压缩 (gzip) extra.thinking |
| T7 | 用户在 ChainlessChain 外登录新厂商账号 | adapter 看不到 | UI 提供"刷新连接"按钮 → WebView 重启拿新 cookie |
| T8 | Dreamina 图片 URL 签名过期 | 1-7 天后过期 | 即时下载缩略图 + 失效图标示 |
| T9 | 扣子 agent 嵌套深 | 一对话有 agent A 调 agent B 调 tool C | v1 拍平 + extra.tool_call_chain；v2 升 KG sub-graph |
| T10 | 多设备同步冲突 | 设备 A 和 B 都 sync 同一家 → 重复 | originalId 去重 + 设备级 watermark |
| T11 | 跨家用户名不同 | DeepSeek 用手机 / Kimi 用邮箱 / 通义用阿里云账号 | OQ-5 默认合一 + 用户可拆视图 |
| T12 | 数据出端被滥用 | 用户自己把导出对话上传到第三方 | UI 警示 + 默认导出附"勿外传"提示 |
| T13 | 厂商 ToS 法律风险 | 部分厂商 ToS 禁止程序化访问 | 用户登录前明示 + 同意 + 用户自担；ChainlessChain 不主动绕过任何反爬 |
| T14 | 模型版本变更影响分析 | "我去年用 GLM-3 vs 今年 GLM-4" 分析需保留 modelName | 每 message 存 modelName + 分析层提供 model 维度 group by |

---

## 13. 演进路线

### v1（本设计稿）

- 8 家国产 AI 全打通
- 跨家自然语言查询 + 月度报告
- 本地 LLM RAG 见所有历史

### v2

- 海外厂商（ChatGPT / Claude / Gemini / Perplexity / Grok）
- API token 鉴权（用户提供自己的 API key）
- 实时 stream（chat 时即时落本地）
- 扣子 agent topology 保真（KG sub-graph）

### v3

- AI 对话 LoRA 微调（基于用户自己的对话语料）
- 跨厂商"统一前端"——用户在 ChainlessChain 一个 UI 同时问多家
- AI 使用画像可视化 dashboard

---

## 14. 参考

- 父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md)
- 姐妹 [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md) (Phase 5)
- 姐妹 [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md) (Phase 6)
- iOS Phase 5 [`iOS_Phase_5_AI_Chat_Skill.md`](./iOS_Phase_5_AI_Chat_Skill.md) — 既有 conversation/message 模型可对齐
- 各厂商官方 API 文档（多数无公开 spec，须真机抓包；写代码前必须重新验证）

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（Adapter 规格）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部说明。Phase 10 AI Chat History adapter 把 8 个厂商的跨平台 AI 对话史合一采集到本地 vault，是 Personal Data Hub 的旗舰差异化能力（任何单厂商都做不到）。

### 2. 核心特性

8 厂商对话史（DeepSeek / Kimi / 通义千问 等）；统一 conversation/message 模型；cookie + 真机抓包采集。

### 3. 系统架构

见父文档 `Personal_Data_Hub_Architecture.md` §12 Phase 10；复用 cookie + WebView 鉴权范式；对齐 iOS Phase 5 既有 conversation/message 模型。

### 4. 系统定位

Personal Data Hub 的**跨厂商 AI 对话史采集 adapter**（Phase 10）。

### 5. 核心功能

各厂商对话拉取 → 统一 schema → LocalVault → KG。详见正文各节。

### 6. 技术架构

cookie + 抓包（多数厂商无公开 spec）；实现包 `@chainlesschain/personal-data-hub/adapters/aichat-*`。

### 7. 系统特点

旗舰差异化（独家价值）；厂商端点多无公开 spec，写代码前必真机重验。

### 8. 应用场景

把分散在多个 AI app 的对话史归集，构建个人 AI 交互全景与 KG。

### 9. 竞品对比

任何单厂商无法跨厂商合一——本 adapter 的独家价值（见正文头部）。

### 10. 配置参考

各厂商 cookie / 账号配置见正文 adapter 配置节。

### 11. 性能指标

采集随对话量线性增长；端点漂移需重抓包（见正文）。

### 12. 测试覆盖

各厂商抓包样本 + adapter 单测（见正文测试节）。

### 13. 安全考虑

AI 对话含高敏感个人内容；cookie 高敏感；落盘经 LocalVault 加密，仅本机。

### 14. 故障排除

厂商端点 / 鉴权漂移 → 重新真机抓包并更新常量。

### 15. 关键文件

`@chainlesschain/personal-data-hub/adapters/aichat-*`。

### 16. 使用示例

见正文各厂商 adapter 调用示例。

### 17. 相关文档

见正文「14. 参考」：`Personal_Data_Hub_Architecture.md`、`Adapter_Email_IMAP.md`、`Adapter_Alipay_Bill.md`、`iOS_Phase_5_AI_Chat_Skill.md`。
