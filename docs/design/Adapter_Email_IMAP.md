# Adapter: Email IMAP — Personal Data Hub 首个真实 Adapter

> **状态**：v0.1 设计稿（2026-05-19）。Phase 5 待启。Personal Data Hub 中台的**首个 production adapter**。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 5；姐妹文档 [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md)（Phase 6 紧随其后）
>
> **为什么 Email 比 Alipay 优先**：邮箱是**银行账单 + 订单确认 + 注册凭证 + 行程通知 + 验证码**的元数据中枢。一个 IMAP adapter 一拍多得，覆盖度远高于单一 app（Alipay 只看支付宝内事务，邮箱看见所有第三方对你发的官方记录）。**IMAP 协议成熟稳定 + 零 cookie 反爬 + 零 root 依赖**，是 v1 验证中台架构的最低风险首选。
>
> **依赖**：Phase 0-4 已落（UnifiedSchema + LocalVault + AdapterRegistry + AI 分析骨架 + Sync 引擎）

---

## 1. 背景

### 1.1 邮箱在中国用户数据图谱中的真实地位

Redmi 24115RA8EC 真机 inventory 显示用户装了：
- `com.tencent.androidqqmail`（QQ 邮箱）
- `com.corp21cn.mail189`（189 邮箱）

**典型 2025 年中国用户邮箱里有什么**：

| 来源类型 | 示例 | 数据价值 |
|---|---|---|
| 银行 / 信用卡账单 | 招行 / 中行 / 民生 / 交行月度账单 PDF（含密码） | **完整工资 + 大额转账记录**，比支付宝/微信支付完整 |
| 电商订单确认 | 淘宝 / 京东 / 拼多多 发货 / 退款通知 | 与各电商 cookie API 互为校验源 |
| 行程通知 | 12306 / 携程 / 同程 出票 + 入住凭证 | 出行年表 |
| 政务回执 | 个税 APP / 社保 / 公积金 / 不动产登记 | 法定身份事件 |
| 注册凭证 | 各服务注册 / 密码重置 / 二次验证 | **所有用过的服务清单**（用户自己都记不清） |
| 工单 / 物业 / 缴费 | 水电气暖 / 物业费 / 高速 ETC | 居住地点的事实留痕 |
| 简历 / 求职 | LinkedIn / BOSS / 招聘 邮件 | 求职行为时间线 |
| 订阅类 | 各种 newsletter / 通知 | 兴趣画像旁证 |

**结论**：邮箱单源覆盖 ~60% 的"用户与外部世界打过交道"事实记录。

### 1.2 为什么 IMAP 比抓 app 强

| 维度 | IMAP | 抓 app（cookie / scrape） |
|---|---|---|
| 协议稳定性 | RFC 标准 30+ 年没变 | app 改版即失效 |
| 鉴权 | 授权码（一次性配） | cookie 频繁过期 |
| 反爬 | 无 | 频繁触发风控 |
| 历史范围 | **服务器侧全量**（5+ 年） | 多数 app 只缓存近期 |
| 跨设备 | 服务器侧 | app cookie 仅当前设备 |
| 失效成本 | 邮箱服务商不会下线 IMAP | app 厂商可随时砍 API |

---

## 2. 目标 & 非目标

### 2.1 目标 (v1 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | IMAP 连接 + 鉴权（QQ + 189） | E2E：能拉自己邮箱过去 1 年所有邮件 |
| G2 | 增量同步 watermark（UID-based）+ 去重 | 重跑同窗口 → 0 重复事件 |
| G3 | 邮件分类器（is_bill / is_order / is_travel / is_government / is_register / is_other） | 准确率 ≥ 90%（标注 200 条） |
| G4 | LLM 解析模板 6 类（账单/订单/行程/政务/注册/其它） | 每类抽取关键字段（金额/商家/时间/订单号）准确率 ≥ 85% |
| G5 | 附件处理（PDF 账单解密 + 文本提取） | E2E：招行 PDF 账单 → 交易明细表 |
| G6 | UnifiedSchema 映射（Event/Person/Place/Item） | KG 中可查"我在某商家的所有订单" |
| G7 | AI 自然语言查询接通 | E2E："上个月我有哪些银行账单" → 答案准 |
| G8 | 隐私 SOP：邮件正文加密本地存 + 用户可选"不存正文只存摘要" | UI 开关 + 单测 |
| G9 | 性能：拉 1k 邮件 < 5min（含 LLM 解析） | 性能测 |

### 2.2 非目标 (defer)

- **SMTP 发送 / 回信** — 中台只采集不发信
- **Exchange / EWS 协议** — 中国主流邮箱都支持 IMAP，先 IMAP；v2 加企业 Exchange
- **Gmail / Outlook 海外** — v2（OAuth2 + 海外网络考虑）
- **完整全文 RAG**（每封邮件 embed 进向量库） — v1 只对分类为高价值的邮件做（账单/订单），v2 再全量
- **附件解密支持除 PDF 外的格式** — Word/Excel/Zip 留 v2
- **多账户聚合视图** — v1 各邮箱独立 vault；v2 加跨账户合并视图
- **垃圾邮件过滤** — 依赖邮箱服务商已有 spam folder，不重复造
- **邮件标签 / 文件夹同步** — v1 只读 inbox + 已发送两个，不管 label
- **删除 / 修改邮件状态** — 中台只读

---

## 3. Open Questions

### OQ-1：鉴权方式

**A**：仅支持邮箱"授权码"（QQ / 189 都要求用户去官网开通授权码后输入）
**B**：OAuth2（QQ / 189 国内邮箱**不提供**标准 OAuth2，仅授权码）
**C**：账号密码直登（已被多数邮箱在 IMAP 入口禁用）

**推荐 A**。理由：(1) C 早被禁；(2) OAuth2 在国内邮箱缺失，海外邮箱 v2 才接；(3) 授权码是国内邮箱事实标准，用户已熟悉（绑微信、绑客户端都要它）；(4) 授权码独立于登录密码 + 可随时撤销，安全模型清晰。UI 引导用户去 mail.qq.com / mail.189.cn 开通授权码（一次性配置，文档配截图）。

### OQ-2：邮件正文存储策略

**A**：明文存（加密 vault 已保护）
**B**：摘要存（LLM 抽 200 字 + 关键字段，原邮件不存）
**C**：双存（用户选）

**推荐 C，默认 A**。理由：(1) Vault 已 AES-256 加密，明文存就是磁盘多 1-2 GB 的代价；(2) 摘要丢失上下文（用户日后想搜"上次客服回复啥"找不到原文）；(3) 双存让用户根据机型存储 + 隐私偏好选；(4) 默认 A 保最大可用性。

### OQ-3：附件处理范围

**A**：所有附件落本地 + 索引
**B**：仅 PDF 类账单附件（关键场景）
**C**：按 MIME 白名单（PDF / Excel / CSV / 图片 OCR）

**推荐 B，v2 升级到 C**。理由：(1) 全量附件存储爆磁盘（一个用户邮箱年附件 5+ GB 常见）；(2) 90% 数据价值在 PDF 账单；(3) 图片附件用 LLM OCR 解析价值有限（多是 logo / 营销图），v2 再加；(4) 用户可主动标记"这封邮件附件保留"。

### OQ-4：LLM 解析模板存放

**A**：硬编码 6 类模板
**B**：每类一个 skill（用户可改）
**C**：YAML 模板 + UI 编辑

**推荐 B**。理由：(1) 与父文档 OQ-5 一致 — 分析 prompt 作为 skill；(2) 邮件分类边界模糊（"账单" vs "订单"），用户可调；(3) skill 系统现成。每类模板包名规划：`hub.email.parser.bill` / `.order` / `.travel` / `.government` / `.register` / `.other`。

### OQ-5：增量同步策略

**A**：UID-based（IMAP UID 单调递增，按 UID > last_seen_uid 拉）
**B**：日期 since-based（按 INTERNALDATE > last_synced_at）
**C**：UID + 日期双 watermark（防 UID 重置）

**推荐 C**。理由：(1) IMAP UID 通常单调，但 UIDVALIDITY 变化时 UID 重置（移动 mailbox / 服务器迁移），罕见但发生；(2) C 双 watermark：UIDVALIDITY 不变时按 UID 高效拉；UIDVALIDITY 变化时降级到日期重拉最近 N 天；(3) per-folder 维护 (UIDVALIDITY, last_uid, last_internal_date) 三元组。

### OQ-6：邮件分类时机

**A**：拉回时同步分类（每封邮件即拉即分类）
**B**：先全拉后批量分类
**C**：双轨：metadata 阶段（subject + from）规则快分类，需要深度解析的邮件再 LLM

**推荐 C**。理由：(1) A 慢，1k 邮件 × LLM 推理 ~10min 不可接受；(2) B 中间状态不可用；(3) C 利用 subject/from 关键词 80% 邮件可直接分类（如 from 含 `noreply@bochk.cn` → 中行账单），剩 20% LLM 仲裁。

---

## 4. 数据源分析

### 4.1 QQ 邮箱 IMAP

| 项 | 值 |
|---|---|
| 服务器 | `imap.qq.com` |
| 端口 | 993（SSL/TLS） |
| 鉴权 | 用户名 + **授权码**（不是 QQ 密码） |
| 授权码获取 | 邮箱设置 → 账户 → 开启 IMAP/SMTP → 验证手机短信 → 获得 16 位授权码 |
| 历史范围 | 服务器侧通常永久保留（除非用户删除） |
| 协议限制 | 同一账户**不要超过 3 个并发 IMAP 连接**，否则触发限流 |
| 特殊 folder | `INBOX` / `Sent Messages` / `Drafts` / `Deleted Messages` / `Junk` |

### 4.2 189 邮箱 IMAP

| 项 | 值 |
|---|---|
| 服务器 | `imap.189.cn` |
| 端口 | 993（SSL/TLS） |
| 鉴权 | 用户名 + 授权码 |
| 授权码获取 | 邮箱网页设置 → 第三方客户端授权码 |
| 历史范围 | 服务器保留（用户可删） |
| 特殊 folder | `INBOX` / `已发送` / `草稿箱` / `已删除` / `垃圾邮件` |

### 4.3 公共邮箱（次优先级，v2）

预留接口供后续接 Gmail (OAuth2) / Outlook (OAuth2) / 163 / Sina / Foxmail 等，IMAP 框架已支持，差异只在鉴权方式。

---

## 5. Adapter 实现

### 5.1 类结构

```typescript
// packages/personal-data-hub/adapters/email-imap/
class EmailImapAdapter implements PersonalDataAdapter {
  name = "email-imap";
  version = "0.1.0";
  capabilities = ["sync:imap", "parse:bill", "parse:order", "parse:travel"];

  // 多账户：一个 adapter 实例服务一个邮箱账户
  constructor(private account: ImapAccount) {}

  async authenticate(ctx: AuthContext): Promise<AuthResult>;
  async *sync(opts: SyncOptions): AsyncIterable<RawEmail>;
  normalize(raw: RawEmail): NormalizedBatch;
  async healthCheck(): Promise<HealthStatus>;

  rateLimits = { perMinute: 60 }; // IMAP 服务器侧友好
  dataDisclosure = {
    fields: [
      "email:from,to,subject,date,messageId",
      "email:bodyText,bodyHtml (默认存)",
      "email:attachments:pdf (默认存索引+正文)",
    ],
    sensitivity: "high",
  };
}

interface ImapAccount {
  provider: "qq" | "189" | "gmail" | "outlook" | "custom";
  email: string;
  authCode: string;      // 授权码，Keystore 加密存储
  host: string;          // 自动从 provider 推导
  port: number;
  folders: string[];     // 默认 ["INBOX", "Sent"]
}
```

### 5.2 同步流程

```
开始 sync
  ↓
1. 连接 IMAP server (TLS 1.3, 5s timeout)
  ↓
2. LOGIN <email> <authCode>
   失败 → AUTH_EXPIRED，UI 提示重新输授权码
  ↓
3. 对每个 folder：
   a. SELECT <folder>
   b. 取 UIDVALIDITY
   c. 比对 watermark：
      - UIDVALIDITY 变 → 降级到日期 since 全文件夹重扫
      - UIDVALIDITY 未变 → SEARCH UID <last_uid>:*
   d. 对每个新 UID：
      - FETCH UID <uid> BODY.PEEK[] HEADER ENVELOPE INTERNALDATE FLAGS
      - parseRawEmail() → RawEmail
      - yield RawEmail
  ↓
4. 更新 watermark：(UIDVALIDITY, last_uid, last_internal_date)
  ↓
5. LOGOUT + 关连接
```

### 5.3 RawEmail 结构

```typescript
interface RawEmail {
  // 元信息
  messageId: string;          // RFC 822 Message-ID（去重 key）
  uid: number;
  folder: string;
  internalDate: number;
  flags: string[];            // \Seen \Answered \Flagged ...

  // 头
  from: { name?: string; address: string };
  to: Array<{ name?: string; address: string }>;
  cc?: Array<{ name?: string; address: string }>;
  subject: string;
  date: number;

  // 内容
  bodyText?: string;
  bodyHtml?: string;

  // 附件
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    contentHash: string;      // SHA-256
    localPath?: string;       // 若策略允许落地
  }>;
}
```

---

## 6. 邮件解析（核心）

### 6.1 双层分类器

```
RawEmail
  ↓
Layer 1: 规则快分（80% 邮件）
  - from 匹配已知白名单（如 cmbchina.com → bill_bank）
  - subject 关键词匹配（如 "账单"+"对账单" → bill）
  - 结果置信度 ≥ 0.85 → 直接落 category
  - 否则进 Layer 2
  ↓
Layer 2: LLM 分类（20% 邮件）
  - prompt: "这封邮件属于哪类: bill_bank/bill_credit/order/travel/government/register/notify/other?"
  - 输入：subject + from + body 前 500 字
  - 输出：category + 置信度
  ↓
category 决定后续解析模板
```

### 6.2 6 类解析模板

#### 6.2.1 `bill` 模板（银行 / 信用卡 / 缴费）

LLM prompt 抽取：
- `amount.value` / `amount.currency`
- `accountIdentifier`（卡号尾 4 位 / 账户）
- `merchantOrInstitution`
- `billingPeriod.start` / `billingPeriod.end`
- `dueDate` / `dueAmount`
- `transactions[]`（若邮件正文含明细表）

PDF 附件特殊处理：
- 检测 PDF 是否加密（多数银行账单加密，密码=身份证后 6 位 / 手机号 / 卡号尾 6 位）
- 用户初次配置时设置"附件密码默认尝试列表"（用户输入候选）
- pdf-parse 提取文本 + LLM 二次抽 transactions

#### 6.2.2 `order` 模板（电商订单确认 / 物流）

- `orderNumber`
- `merchantPlatform`（淘宝 / 京东 / 拼多多 / 美团 / ...）
- `items[]`（每项含 name / quantity / price）
- `totalAmount`
- `shippingAddress`
- `recipient`（收件人，可能是 Person.id 非 self）
- `trackingNumber`

#### 6.2.3 `travel` 模板（机票 / 火车票 / 酒店）

- `vehicleType`: "flight" | "train" | "hotel" | "bus"
- `from` / `to`（Place）
- `departureTime` / `arrivalTime` / `checkInDate` / `checkOutDate`
- `traveler`（同行人是另一个 Person）
- `confirmationNumber`
- `totalCost`

#### 6.2.4 `government` 模板（税务 / 社保 / 公积金 / 不动产）

- `agencyName`
- `documentType`: "tax_declaration" | "social_security" | "housing_fund" | "...
- `period`
- `amount`
- `referenceNumber`

#### 6.2.5 `register` 模板（账号注册 / 密码重置 / 验证码）

- `serviceName`
- `actionType`: "register" | "password_reset" | "2fa_code" | "consent"
- `accountIdentifier`（用户名 / 手机 / email）

**特殊处理**：验证码邮件**只存元数据**，不存正文（验证码本身敏感）。

#### 6.2.6 `other` 模板

- LLM 抽 `topic` + 200 字 `summary`
- 不强制结构化字段

### 6.3 → UnifiedSchema 映射

每封邮件 → 1 个 Event + N 个 Person/Place/Item：

```typescript
// 银行账单邮件示例
RawEmail {
  from: { name: "招商银行", address: "ebank@cmbchina.com" },
  subject: "您的招行信用卡 11 月对账单",
  ...
}
  ↓ normalize()
{
  events: [{
    id: "evt-uuid",
    type: "event",
    subtype: "payment",  // 或新增 "bill"
    occurredAt: 1731312000000,
    actor: "person-self",
    content: {
      title: "招行信用卡 11 月对账单",
      amount: { value: 8432.50, currency: "CNY", direction: "out" },
    },
    source: {
      adapter: "email-imap",
      adapterVersion: "0.1.0",
      originalId: "messageId-rfc822",
      capturedAt: 1731312000000,
      capturedBy: "api",
    },
    extra: {
      category: "bill_bank",
      institution: "招商银行",
      cardLast4: "1234",
      transactionCount: 28,
      // 子交易另作为 N 个 Event 入库，extra.parent = evt-uuid
    },
  }],
  persons: [
    { id: "person-cmb", subtype: "merchant", names: ["招商银行"],
      identifiers: { email: ["ebank@cmbchina.com"] } }
  ],
  places: [],
  items: [],
}
```

---

## 7. AI 分析价值

### 7.1 立即可问的问题（仅 Email 一个 adapter 接入后）

| 问题 | 数据路径 |
|---|---|
| "上个月有哪些银行账单？" | category=bill_bank + 时间窗 |
| "我在淘宝今年总共下了多少单？" | category=order + extra.merchantPlatform=淘宝 |
| "我所有用过的招聘网站？" | category=register + serviceName 含 "招聘"/"BOSS"/"前程" |
| "我妈手机号是多少？" | 收件人 == 妈妈相关地址 → 同 phone 历史邮件 |
| "上次去厦门是什么时候？" | category=travel + to.name 含 "厦门" |
| "信用卡这个月还款金额？" | category=bill + 最近一封 + dueAmount |
| "我有多少个未使用的注册账号？" | category=register + LLM 二次判断"是否还活跃" |

### 7.2 跨源（与其他 adapter 合并后）

- Email + Alipay：信用卡账单 vs 实际支出，找差异
- Email + Taobao：邮件订单确认 vs Taobao API 订单，互为校验（防 cookie 漏抓）
- Email + 12306：旅行邮件 + 火车票 + 高德足迹 = 完整出行档案

---

## 8. UI/UX

### 8.1 配置流程（首次接入）

```
1. 设置 → 个人数据中台 → 添加邮箱账户
2. 选服务商（QQ / 189 / 其它）
3. 输邮箱地址
4. 跳转引导："去 mail.qq.com 开通 IMAP/SMTP 服务，获取授权码"（含截图）
5. 输授权码 → 测试连接 → 成功 → 弹窗显示 dataDisclosure，用户确认
6. 选历史范围：默认"最近 1 年"，可选"全部历史"
7. 启动首次全量同步（后台跑 + 进度条）
```

### 8.2 同步状态视图

```
─────────────────────────────────────────
邮箱账户：xxx@qq.com
  状态：● 正常同步中
  最近同步：3 分钟前
  总邮件：12,438（INBOX 9,201 / Sent 3,237）
  分类分布：
    账单类     1,823 (15%)
    订单类     2,109 (17%)
    行程类       342 ( 3%)
    政务类        81 ( 1%)
    注册类     2,955 (24%)
    其它      5,128 (41%)
  [立即同步] [暂停] [移除账户]
─────────────────────────────────────────
```

### 8.3 邮件详情视图

KG 来源回链：用户在分析结果里点某条 Event 引用 → 跳转邮件原文（解密渲染）。

---

## 9. 安全 & 隐私

### 9.1 授权码存储

- Keystore 加密（与 LocalVault 主密钥隔离）
- 邮箱授权码丢失/泄漏 → 用户去邮箱后台撤销即可，不影响 vault 中已存的数据

### 9.2 正文存储默认明文（OQ-2 推荐 A），但：

- vault 已 AES-256，磁盘明文不可读
- 用户可选"只存摘要"开关（隐私敏感场景，如公用电脑）
- 验证码 / 2FA 邮件**永不存正文**（硬编码白名单）
- 用户可标记任意邮件"敏感"，立即转摘要并删原文

### 9.3 网络

- IMAP 走 TLS 1.3，证书校验严格
- 不走代理（除非用户显式配，避免 cookie 旁路）
- 不上传任何邮件元数据到外部（LLM 推理本地 Ollama）

### 9.4 审计

- 每次同步：开始时间 / 结束时间 / 拉取数 / 失败数 → audit_log
- 每次分析查询：query / 召回的 Event ID 列表 → audit_log

---

## 10. 测试计划

### 10.1 单测

- IMAP 连接：mock IMAP server，覆盖 LOGIN 成功/失败/超时/限流
- UID watermark：UIDVALIDITY 变化降级路径
- 分类器 Layer 1：白名单 + 关键词 100 条测试
- 解析模板 6 类：每类 ≥ 20 条 fixture，golden output 对比
- PDF 加密附件：测试 3 种密码尝试策略
- UnifiedSchema 映射：每个解析结果 → JSON Schema 校验

### 10.2 集成测试

- 真 IMAP 拉测试邮箱（团队预备）100 封 → 端到端 → KG 完整
- Sync 引擎重复触发 → 0 重复事件
- 大量邮件性能：1k 邮件 < 5min（含 LLM）

### 10.3 真机 E2E

| 场景 | 验收 |
|---|---|
| QQ 邮箱授权码配置 | 引导文档可读 + 配成功 |
| 189 邮箱授权码配置 | 同上 |
| 拉过去 1 年邮件 | 完整 + 分类准确 + 错误时进度条不卡死 |
| 银行 PDF 加密附件 | 解密成功 + transactions 抽取 |
| 自然语言查询 | 父文档 §7.1 5 类问题全通 |
| 增量同步 | 隔天再跑只拉新邮件 |
| 网络中断恢复 | 自动续传不丢不重 |
| 撤销授权码 | UI 显示 AUTH_EXPIRED + 引导重输 |

---

## 11. Phase 拆分（adapter 内部）

| Sub-phase | 内容 | 工期 |
|---|---|---|
| 5.1 | IMAP 客户端 + 鉴权 + folder 选择 + UID 同步 | 1.5d |
| 5.2 | RawEmail 解析（multipart / 编码 / 附件） | 1d |
| 5.3 | 分类器 Layer 1（规则） + Layer 2（LLM） | 1d |
| 5.4 | 解析模板 6 类 + UnifiedSchema 映射 | 2d |
| 5.5 | PDF 加密附件解密 + transactions 抽取 | 1d |
| 5.6 | UI 配置流程 + 状态视图 + 邮件详情回链 | 1d |
| 5.7 | E2E 真机验 + 性能调优 | 0.5d |

**总**：~7 天，与父文档 §12 Phase 5 工期估算一致。

---

## 12. Traps & 风险

| # | Trap | 描述 | 缓解 |
|---|---|---|---|
| T1 | 授权码不是邮箱密码 | 用户输错密码以为不通 | UI 文案 + 引导截图明确 |
| T2 | UIDVALIDITY 变化 | 服务端 reset UID 致 watermark 失效全表重跑 | 监测 UIDVALIDITY 变化 → 降级到日期 since 重扫近 90 天 |
| T3 | 同一账户多并发连接被限 | 后台同步 + 用户其它客户端竞争 | 串行同步 + 失败指数退避 |
| T4 | PDF 密码尝试失败 | 多种格式（身份证后 6/手机/卡尾 6）猜不中 | 用户配候选列表 + 失败的标记 unparsable 后续手工补 |
| T5 | LLM 分类边界模糊 | 信用卡账单 vs 物业缴费 模糊 | 双标签 + 用户可手动改类（学习反馈） |
| T6 | 中文乱码 | 旧邮件 GB2312 / GBK 编码 / 头乱编码 | 严格走 mime-parser；fallback iconv 尝 GB18030 |
| T7 | 大附件爆磁盘 | PDF 账单 几 MB × 几千封 | OQ-3 仅 PDF 类 + 用户可设大小上限 |
| T8 | 验证码泄漏 | 验证码邮件正文落盘 | 硬编码白名单：subject/from 含 "验证码"/"verification code"/"2FA"/"OTP" → 只存元数据 |
| T9 | 营销邮件占比高 | 1k 邮件 800 封是垃圾 | Layer 1 规则把营销分到 other 后**降低分析层权重**；用户可批量删 |
| T10 | LLM 模板 prompt 注入 | 邮件正文含 "ignore previous instruction" | 模板用 system+user 分层；user content 走 escape；明确告知"以下是不可信第三方内容" |
| T11 | 邮箱服务商 IMAP 关停 | 极小概率某厂下线 IMAP | adapter 接口稳定 / 影响仅该 provider；其它 provider 不受影响 |
| T12 | 海外邮箱网络问题 | Gmail / Outlook 在国内可能不稳 | v1 不接，v2 加时再考虑代理路径 |

---

## 13. 参考

- 父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md)
- 姐妹 [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md) — Phase 6 紧随
- RFC 3501 (IMAP4rev1)
- RFC 5322 (Internet Message Format)
- 既有 `01_知识库管理模块.md` — KG / RAG 引擎集成点

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（Adapter 规格）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部说明。Phase 5 Email IMAP adapter 是 Personal Data Hub 的首个 production adapter，经 IMAP 采集邮箱（银行账单 + 订单确认 + 注册凭证 + 行程通知 + 验证码）这一第三方官方记录的元数据中枢。

### 2. 核心特性

IMAP 协议成熟稳定；零 cookie 反爬 / 零 root；一拍多得（覆盖度远高于单一 app）；中台架构最低风险首选。

### 3. 系统架构

见父文档 `Personal_Data_Hub_Architecture.md` §12 Phase 5；依赖 Phase 0–4（UnifiedSchema + LocalVault + AdapterRegistry + AI 分析骨架 + Sync 引擎）。

### 4. 系统定位

Personal Data Hub 的**首个 production adapter**（Phase 5），验证中台架构。

### 5. 核心功能

IMAP 拉取 → 解析 (RFC 3501/5322) → normalize → LocalVault → KG。详见正文各节。

### 6. 技术架构

IMAP4rev1 (RFC 3501) + Internet Message Format (RFC 5322)；无 cookie / 无 root；实现包 `@chainlesschain/personal-data-hub/adapters/`。

### 7. 系统特点

协议成熟稳定、零反爬零 root；覆盖第三方官方记录广度高。

### 8. 应用场景

银行账单 / 订单 / 行程 / 验证码等官方记录归集，作为 KG 元数据中枢。

### 9. 竞品对比

相较单一 app（如仅看 Alipay 内事务），邮箱可见所有第三方对你发的官方记录。

### 10. 配置参考

IMAP 服务器 / 账号 / 应用专用密码配置见正文 adapter 配置节。

### 11. 性能指标

随邮箱体量线性；增量按 UID 拉取（见正文）。

### 12. 测试覆盖

IMAP 解析单测 + 样本邮件 fixture（见正文测试节）。

### 13. 安全考虑

邮箱凭证高敏感（建议应用专用密码）；落盘经 LocalVault 加密，仅本机。

### 14. 故障排除

IMAP 登录失败 / 限速 → 用应用专用密码、降低并发（见正文）。

### 15. 关键文件

`@chainlesschain/personal-data-hub/adapters/`（email IMAP adapter）；KG 集成点见 `01_知识库管理模块.md`。

### 16. 使用示例

见正文 IMAP adapter 调用示例。

### 17. 相关文档

见正文「13. 参考」：`Personal_Data_Hub_Architecture.md`、`Adapter_Alipay_Bill.md`、RFC 3501 / 5322、`01_知识库管理模块.md`。
