# Adapter: Alipay Bill — 支付宝账单 Adapter

> **状态**：v0.1 设计稿（2026-05-19）。Phase 6 待启（紧随 Phase 5 EmailAdapter）。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 6；姐妹文档 [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md)（Phase 5 前置）
>
> **目标 app**：`com.eg.android.AlipayGphone`（Redmi 24115RA8EC 真机已装确认 ✅）
>
> **为什么 Alipay 紧随 Email**：Email 已可拉到部分银行账单 + 订单确认，但**支付宝内部转账 / 余额宝 / 公积金缴费 / 共享单车 / 公交地铁 / 缴费记录**这些"封闭场景"邮箱看不到。Alipay 官方导出 CSV 是**唯一干净结构化全量源**。3 天工期，验证 UnifiedSchema 对结构化金融数据的拟合度。

---

## 1. 背景

### 1.1 支付宝在中国用户金融图谱的地位

| 场景 | 仅支付宝有 | 与其它源重叠 |
|---|---|---|
| 余额宝 / 理财收支 | ✅ | — |
| 公积金 / 社保 缴费记录 | ✅ | 个税 APP 有部分 |
| 公交 / 地铁 / 共享单车 | ✅ | 高德有部分（出行）|
| 信用卡还款 | 部分 | 银行账单邮件 / 银行 app |
| 转账给好友 | ✅ | 微信支付部分（人际不同） |
| 淘宝 / 天猫 支付 | ✅ | 电商 cookie 抓订单（金额对应） |
| 美团 / 饿了么 支付 | ✅ | 美团 cookie 抓订单 |
| 水电气 缴费 | ✅ | — |
| 医保 支付 | ✅ | — |
| 政务 缴费（停车 / 罚款） | ✅ | — |
| 红包 / 转账给陌生人 | ✅ | — |

**结论**：邮箱补**外部世界发给你的**账单 / 凭证；Alipay 补**你自己付款的**所有微观流水。两者拼起来 = 接近完整的"我在哪花了多少钱"档案。

### 1.2 为什么 CSV 导出比 cookie 抓更好

| 维度 | 官方 CSV 导出 | Cookie + web API |
|---|---|---|
| 完整性 | **服务器侧全量**（可选最长 1 年/月） | 受限于 cookie 范围 |
| 稳定性 | 协议不变 | API 频繁变动 |
| 风控 | 0 触发 | 频繁拉触发 |
| 工程 | 解析 CSV ~50 行 | 维护 cookie + 接口签名 |
| 自动化 | 半自动（用户每月点导出） | 全自动 |

**Trade-off**：CSV 需要用户手动触发导出（每月或每季度），但稳定 + 0 风险。**v1 选 CSV 模式**；v2 可选加 cookie 模式做"自动每周同步近期"。

---

## 2. 目标 & 非目标

### 2.1 目标 (v1 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | CSV 文件导入流程 + 自动检测 + 字段映射 | E2E：导入 1 个 12 月份账单 CSV → LocalVault |
| G2 | ZIP 加密附件解压（支付宝 CSV 默认 ZIP + 6 位密码） | 解压成功率 ≥ 99% |
| G3 | 字段完整映射到 UnifiedSchema Event | 单测 fixture ≥ 50 条 → 全部字段非空 |
| G4 | 交易对方实体识别（Person.subtype=merchant / contact） | 商家 / 个人 二分准确 ≥ 95% |
| G5 | 交易分类（消费/转账/理财/缴费/退款）→ Event.subtype | 准确 ≥ 90% |
| G6 | 商家 → Item 映射（淘宝订单 → Item with merchant） | 单测 |
| G7 | AI 分析接通："上个月总支出多少" / "在淘宝总支出" / "每月平均餐饮多少" | 答案准 |
| G8 | 与 EmailAdapter 跨源去重（信用卡还款同时出现在两源） | 自动识别 + 标 cross-source-link |
| G9 | 增量导入（同一账户多次导入不重） | originalId 去重 |

### 2.2 非目标 (defer)

- **Alipay 内置自动同步** — v1 用户手动每月导出导入；v2 考虑 cookie 模式自动
- **Alipay 健康步数 / 运动数据** — v2 接（CSV 不含此）
- **Alipay 蚂蚁森林 / 公益** — v3 趣味数据
- **Alipay 信用 / 芝麻分** — v3
- **跨境支付 / 多币种** — v2
- **修改 / 删除导入的交易** — 中台只追加，不改源数据；用户可"标记忽略"
- **Alipay 内嵌小程序数据** — 不接入（属于第三方）

---

## 3. Open Questions

### OQ-1：CSV 文件入口

**A**：用户手动拖文件到 ChainlessChain UI
**B**：监测下载目录自动检测 `alipay_record_*.zip`
**C**：UI 引导 + 二选一（A 和 B 共存）

**推荐 C**。理由：(1) A 100% 可控但麻烦；(2) B 自动检测体验好但隐私敏感（中台扫下载目录）；(3) C 让用户在 UI"添加账单"时选"拖入 / 从下载目录选 / 监控"三模式。监控模式必须用户**显式开启**且**仅监控特定目录**。

### OQ-2：ZIP 密码处理

**A**：每次导入弹窗输密码
**B**：用户首次配密码后 Keystore 存（支付宝密码通常是身份证后 6 位，多年不变）
**C**：A + B 共存（首次配置可选记住）

**推荐 C**。理由：(1) 密码与 vault 主密钥独立性弱（同设备一旦失窃都泄）；(2) 但每次输密码体验差；(3) C 让用户选；默认记住的话明文密码用 Keystore 加密。

### OQ-3：交易对方实体识别策略

**A**：纯字符串匹配（同名合并）
**B**：LLM 判定 + 用户确认（merchant vs contact 二分）
**C**：规则白名单（known merchants）+ 不在名单走 LLM
**D**：复用父文档 EntityResolver

**推荐 D**。理由：(1) 父文档 Phase 8 EntityResolver 已规划三段 pipeline；(2) Alipay 是 Phase 6 在 EntityResolver Phase 8 之前，**Phase 6 用 D 的简化版**：规则白名单（"美团"/"淘宝"/"携程"等已知商家直标 merchant）+ 默认其它走 contact + 标记 needs-resolve 字段，待 Phase 8 EntityResolver 上线后批量重算。

### OQ-4：交易子分类映射

**A**：直接用 Alipay 的 `类型` 字段（"即时到账"/"商品消费"等）
**B**：重新分类到 UnifiedSchema Event.subtype + Topic
**C**：A + B 双轨（保留源类型，加 hub 派生分类）

**推荐 C**。理由：(1) Alipay 的"类型"字段对中台 KG 不直观；(2) 但完全丢源信息后用户疑问"为啥被分这类"无法追溯；(3) C：Event.subtype 用 hub 标准（payment/transfer/refund/...），Event.extra.alipay_type 保留源。

### OQ-5：CSV 编码

**A**：固定按 GB2312 / GBK 读
**B**：先尝 UTF-8 失败降级 GB18030
**C**：用 chardet 检测

**推荐 B**。理由：(1) 支付宝 CSV 历史用 GBK，新版本部分用 UTF-8 BOM；(2) chardet 引依赖 + 对小文件不准；(3) 简单二段尝试覆盖 99% 情况。

---

## 4. 数据源分析

### 4.1 导出流程

```
支付宝 app → 我的 → 账单 → 右上角 ⋯ → 开具交易流水证明
  ↓
选择月份范围（最长 12 个月）→ 选择用途"个人对账"
  ↓
发送到邮箱（用户支付宝绑定邮箱）
  ↓
邮箱收附件 alipay_record_YYYYMMDD-YYYYMMDD.zip
  密码 = 用户身份证后 6 位（默认）
```

**注意**：支付宝有时给"PDF 流水"和"CSV 账单"两种导出。本 adapter **要 CSV**（结构化）。

### 4.2 CSV 格式样例

文件头（GBK 编码，CRLF）：

```
支付宝交易记录明细查询
账号:[email@example.com / 13800001111]
起始日期:[2024-04-01 00:00:00]    终止日期:[2024-05-01 00:00:00]
---------------------------------交易记录明细列表------------------------------
交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态
2024040122001112345678,T20240401XXXX,2024-04-01 09:23:11,2024-04-01 09:23:13,2024-04-01 09:23:13,支付宝网站,即时到账交易,美团,美团外卖订单,38.50,支出,交易成功,0.00,0.00,,已支出
...
```

### 4.3 字段语义

| CSV 字段 | 含义 | UnifiedSchema 目标 |
|---|---|---|
| 交易号 | Alipay 唯一交易号 | `source.originalId` |
| 商家订单号 | 商家侧订单号（淘宝订单 / 美团订单等） | `extra.merchantOrderNumber`，与电商 adapter 跨源 link |
| 交易创建时间 | 创建时间 | `extra.createdAt` |
| 付款时间 | 实际付款 | `Event.occurredAt` |
| 最近修改时间 | 状态变化 | `extra.lastModifiedAt` |
| 交易来源地 | "支付宝网站" / "手机网站" / "客户端" / 小程序名 | `extra.sourceChannel` |
| 类型 | "即时到账"/"商品消费"/"在线支付"/"红包"/"转账"... | `extra.alipayType` + 映射 `Event.subtype` |
| 交易对方 | 商家名 / 用户名 | `Event.actor` or `Event.participants[]` 派生为 Person |
| 商品名称 | 商品 / 描述 | `Item.name`（若有）or `Event.content.title` |
| 金额（元） | 金额 | `Event.content.amount.value` |
| 收/支 | "收入"/"支出"/"其它" | `Event.content.amount.direction` |
| 交易状态 | "交易成功"/"交易关闭"/"退款成功"/"等待付款" | `extra.txStatus` + 过滤未完成 |
| 服务费（元） | 服务费 | `extra.serviceFee` |
| 成功退款（元） | 已退款 | `extra.refundedAmount` |
| 备注 | 用户填的备注 | `Event.content.text` |
| 资金状态 | "已支出"/"已收入"/"冻结"/"解冻" | `extra.fundStatus` |

### 4.4 子类型映射

```typescript
function mapAlipayTypeToSubtype(alipayType: string, direction: string): EventSubtype {
  if (alipayType.includes("转账")) return "transfer";
  if (alipayType.includes("退款")) return "refund";
  if (alipayType.includes("理财") || alipayType.includes("余额宝")) return "investment";
  if (alipayType.includes("红包")) return "redenvelope";
  if (alipayType.includes("缴费")) return "utility";
  if (alipayType.includes("交易关闭") || alipayType.includes("交易失败")) return "cancelled";
  // 默认按方向
  return direction === "收入" ? "income" : "payment";
}
```

---

## 5. Adapter 实现

### 5.1 类结构

```typescript
class AlipayBillAdapter implements PersonalDataAdapter {
  name = "alipay-bill";
  version = "0.1.0";
  capabilities = ["import:csv-zip", "parse:transactions"];

  constructor(private account: AlipayAccount) {}

  // 鉴权 = 提供 zip 解压密码（用户身份证后 6 位等）
  async authenticate(ctx: AuthContext): Promise<AuthResult>;

  // 不是 IMAP 那种 server pull，而是接收用户提供的文件路径
  async *sync(opts: SyncOptions & { csvPath: string }): AsyncIterable<RawTransaction>;

  normalize(raw: RawTransaction): NormalizedBatch;
  async healthCheck(): Promise<HealthStatus>;

  rateLimits = {};  // 本地文件，无限流
  dataDisclosure = {
    fields: [
      "alipay:txId,createdAt,paidAt,counterparty,itemName,amount,direction,status,note",
    ],
    sensitivity: "high",
  };
}

interface AlipayAccount {
  email: string;          // 支付宝绑定邮箱（用于识别多账户）
  zipPassword?: string;   // Keystore 加密存储，OQ-2 推荐 C
}
```

### 5.2 导入流程

```
用户拖入 alipay_record_*.zip
  ↓
1. 检测文件名格式 → 提取日期范围
2. 解压：
   - 输 password（用户配或弹窗）
   - 失败 → 提示重试 / 切换 password
3. 找内部 .csv 文件
4. 读取 + 编码降级（OQ-5：UTF-8 → GBK fallback）
5. 解析头部 metadata（账号 / 起止日期）
6. 跳过文件头注释行，定位到 "交易号,商家订单号,..." header 行
7. 逐行 parse RawTransaction
8. yield RawTransaction
  ↓
ingestor 调 normalize() → NormalizedBatch → LocalVault → KG ingestor
```

### 5.3 RawTransaction 结构

```typescript
interface RawTransaction {
  txId: string;
  merchantOrderNumber?: string;
  createdAt: string;       // 原 string，normalize 时 parse
  paidAt: string;
  lastModifiedAt: string;
  sourceChannel: string;
  alipayType: string;
  counterparty: string;
  itemName: string;
  amount: string;          // "38.50"
  direction: "收入" | "支出" | "其它";
  status: string;
  serviceFee: string;
  refundedAmount: string;
  note: string;
  fundStatus: string;
}
```

### 5.4 normalize() 映射

```typescript
function normalize(raw: RawTransaction): NormalizedBatch {
  const eventId = uuidv7();
  const counterpartyPersonId = lookupOrCreatePerson(raw.counterparty);

  const event: Event = {
    id: eventId,
    type: "event",
    subtype: mapAlipayTypeToSubtype(raw.alipayType, raw.direction),
    occurredAt: parseDateTime(raw.paidAt || raw.createdAt),
    actor: raw.direction === "支出" ? "person-self" : counterpartyPersonId,
    participants: [counterpartyPersonId, "person-self"],
    content: {
      title: raw.itemName || raw.alipayType,
      text: raw.note || undefined,
      amount: {
        value: parseFloat(raw.amount),
        currency: "CNY",
        direction: raw.direction === "收入" ? "in" : "out",
      },
    },
    source: {
      adapter: "alipay-bill",
      adapterVersion: "0.1.0",
      originalId: raw.txId,
      capturedAt: parseDateTime(raw.paidAt || raw.createdAt),
      capturedBy: "export",
    },
    extra: {
      alipayType: raw.alipayType,
      sourceChannel: raw.sourceChannel,
      merchantOrderNumber: raw.merchantOrderNumber,
      txStatus: raw.status,
      serviceFee: parseFloat(raw.serviceFee || "0"),
      refundedAmount: parseFloat(raw.refundedAmount || "0"),
      fundStatus: raw.fundStatus,
    },
  };

  const persons: Person[] = [{
    id: counterpartyPersonId,
    type: "person",
    subtype: classifyCounterparty(raw.counterparty),  // "merchant" or "contact"
    names: [raw.counterparty],
    // EntityResolver Phase 8 后回填 identifiers
  }];

  // 若有 itemName → 派生 Item
  const items: Item[] = raw.itemName ? [{
    id: uuidv7(),
    type: "item",
    subtype: "product",
    name: raw.itemName,
    price: { value: parseFloat(raw.amount), currency: "CNY" },
    merchant: counterpartyPersonId,
  }] : [];

  return { events: [event], persons, places: [], items };
}
```

### 5.5 已知商家白名单（Phase 6 简化 resolver）

```typescript
const KNOWN_MERCHANTS = new Set([
  // 电商
  "淘宝", "天猫", "京东", "拼多多", "苏宁易购", "唯品会", "蘑菇街",
  // 外卖 / 团购
  "美团", "饿了么", "大众点评", "肯德基", "麦当劳", "星巴克",
  // 出行
  "滴滴", "高德", "百度地图", "12306", "携程", "去哪儿", "同程",
  // 视频音乐
  "爱奇艺", "腾讯视频", "优酷", "网易云音乐", "QQ 音乐", "酷狗",
  // 缴费
  "国家电网", "中国移动", "中国联通", "中国电信", "燃气公司", "水务局",
  // 平台
  "支付宝", "蚂蚁财富", "余额宝",
  // ... 维护增长清单（v1 ~200 项已足覆盖 80%）
]);

function classifyCounterparty(name: string): "merchant" | "contact" | "unknown" {
  for (const m of KNOWN_MERCHANTS) {
    if (name.includes(m)) return "merchant";
  }
  // 含 "公司" / "店" / "服务" → merchant
  if (/公司|店|服务|超市|餐厅|药房|医院|银行/.test(name)) return "merchant";
  // 看起来像人名（2-4 中文字符） → contact
  if (/^[一-龥]{2,4}$/.test(name)) return "contact";
  return "unknown";
}
```

---

## 6. 与 EmailAdapter 跨源去重

### 6.1 重叠场景

| Alipay 看到 | Email 同时看到 | 处理 |
|---|---|---|
| 信用卡还款（如"招行信用卡还款"） | 招行月度账单邮件 | 两边都存；KG 加 `same-as` 边 |
| 淘宝订单付款 | 淘宝订单确认邮件 | 同上；merchantOrderNumber 是 link key |
| 12306 车票 | 12306 出票邮件 | 同上 |

### 6.2 实现

```typescript
// AlipayBill normalize 时，extra.merchantOrderNumber 写入
// Email normalize 时，category=order 的邮件 extra.orderNumber 写入
// KG ingestor 后处理：
//   FIND events WHERE extra.merchantOrderNumber EXISTS
//   FOR EACH (alipayEvt, emailEvt) WHERE
//     alipayEvt.extra.merchantOrderNumber == emailEvt.extra.orderNumber
//   → ADD KG edge: (alipayEvt) --same-as--> (emailEvt)
//   → 标记 cross_source_link = true
```

**分析层用法**：用户问"我在淘宝今年总共下了多少单" — Cowork agent 检测到 Email + Alipay 双源后用 union，避免双计。

---

## 7. AI 分析价值

### 7.1 Alipay 接入后立即可问

| 问题 | 数据路径 |
|---|---|
| "上个月总支出多少？" | sum(amount) where direction=out, 时间窗 |
| "上个月外卖花了多少？" | counterparty includes 美团/饿了么 |
| "今年在淘宝总共下了多少单？" | counterparty=淘宝 + 与 Email 跨源 |
| "我每月共享单车花多少？" | counterparty includes 哈啰/青桔/美团单车 |
| "上个月给我妈转了多少钱？" | EntityResolver 后 counterparty=mom |
| "我余额宝总收益？" | alipayType includes 余额宝 + direction=in |
| "公积金这个月扣多少？" | counterparty=公积金 + 缴费 |
| "我每月平均餐饮支出？" | classify 商家 → 餐饮类 → 月均 |
| "最大一笔支出？" | sort amount desc |
| "退过哪些款？" | subtype=refund |

### 7.2 跨源（Alipay + Email + 其它）

- **完整消费档案**：Alipay 流水 + 信用卡账单 + 现金（无法采集，仅注入估算）= 月度真实开销
- **送礼追踪**：Alipay "转账给某某" + Taobao "收件人某某" + Email 物流到某某 = 送给同一人的整条故事线
- **出行账本**：Alipay 出行支出 + 高德足迹 + 12306 车票 + 携程订单 = 一次旅行的所有钱去哪了

---

## 8. UI/UX

### 8.1 配置 / 导入流程

```
1. 设置 → 个人数据中台 → 添加支付宝账户
2. 输支付宝绑定邮箱（标识账户）+ ZIP 密码（OQ-2：选记住）
3. UI 引导：
   "去支付宝 → 我的 → 账单 → 右上角 ⋯ → 开具交易流水证明"
   "选月份范围 → 选'个人对账'用途 → 发送到邮箱"
   "下载 ZIP 后拖入这里"
4. 用户拖文件 → 解压 → 解析 → 进度条
5. 解析完成报告：
   - 共 N 笔
   - 支出 ¥X / 收入 ¥Y
   - Top 5 商家
   - 跨源 link 数：M
   - [确认导入 / 取消]
```

### 8.2 周期性提醒

可选开关："每月 1 号提醒导出上月账单"。Workflow 定时任务发本机通知。

### 8.3 多账户视图

支持用户多个 Alipay 账户（个人 + 家人 ?），每个独立 vault tag，分析查询可选 scope。

---

## 9. 安全 & 隐私

### 9.1 ZIP 密码存储

- Keystore 加密（与 LocalVault 独立 key namespace）
- 用户可选"每次输"模式（不记住）

### 9.2 CSV 文件处理

- 解析后 CSV 文件本身**默认删除**（用户可选"保留到归档目录")
- ZIP 文件同上
- 减少未加密的源文件暴露面

### 9.3 备注字段敏感

- 用户备注可能含个人信息（"借给阿姨"/"过年给爸妈"）
- 默认存 vault（已加密）
- 用户可设"备注脱敏"开关：导入时 LLM 抽象化（"给亲属生活费" 替代原文）

### 9.4 审计

- 每次导入：文件 hash + 导入时间 + 行数 + 错误数 → audit_log

---

## 10. 测试计划

### 10.1 单测

- CSV 解析：50 条 fixture（含中文/特殊字符/空字段/转义）
- 编码降级（UTF-8 → GBK）
- ZIP 解压（正确密码 / 错误密码 / 损坏文件）
- alipayType → subtype 映射 30 条
- classifyCounterparty 100 条（含 known 商家 / 含"公司"等关键词 / 中文人名 / 模糊）
- normalize() 输出 schema 校验
- 跨源 merchantOrderNumber link 后处理 10 条

### 10.2 集成测试

- 端到端：fixture ZIP → 解压 → 解析 → ingest LocalVault → KG triple 完整
- 重复导入同 ZIP → 0 重复事件（originalId 去重）
- 与 EmailAdapter 同时跑：cross_source_link 标记正确

### 10.3 真机 E2E

| 场景 | 验收 |
|---|---|
| 真实账单 12 个月 ZIP 导入 | ≥ 99% 行解析成功；错误行进 review 队列 |
| 不同年份 CSV 编码差异 | UTF-8 / GBK 都能处理 |
| 密码错误 | 友好提示重试 |
| 大量交易性能 | 10k 笔交易 < 30s 入库 |
| 自然语言查询 | §7.1 10 类问题全通 |
| 跨源验证 | "我在淘宝今年总共下了多少单"答案与 Email 单算 / Alipay 单算 一致 |

---

## 11. Phase 拆分（adapter 内部）

| Sub-phase | 内容 | 工期 |
|---|---|---|
| 6.1 | ZIP 解压 + 密码处理 + CSV 编码降级 | 0.5d |
| 6.2 | CSV 解析 + RawTransaction + 头部 metadata | 0.5d |
| 6.3 | normalize() + classifyCounterparty + 商家白名单 | 1d |
| 6.4 | 跨源 merchantOrderNumber link 后处理 | 0.5d |
| 6.5 | UI 导入流程 + 进度条 + 报告 | 0.5d |
| 6.6 | E2E 真机验 + 性能 | 0d（与父文档 Phase 6 工期 3d 一致） |

**总**：~3 天。

---

## 12. Traps & 风险

| # | Trap | 描述 | 缓解 |
|---|---|---|---|
| T1 | CSV 表头随版本变化 | 字段顺序 / 命名 微调 | parser 按字段名（不按下标）+ 兼容旧名映射表 |
| T2 | 备注字段含逗号 | 破坏 CSV 解析 | 使用真正 CSV parser（papaparse / csv-parse）不要手切 split |
| T3 | 多种 ZIP 密码（身份证 / 手机 / 老密码） | 用户记不清 | OQ-2 候选列表轮询尝试 |
| T4 | 类型字段不在白名单 | 新型交易（数字人民币?）→ subtype=unknown | unknown 计数 → UI alert → 人工补映射 |
| T5 | 同一交易号 update（最近修改时间变） | 重复导入旧 ZIP 看到已 refund 的交易 | originalId 去重时检查 lastModifiedAt → 更新现有 event |
| T6 | 商家名拼写不一致 | "美团外卖" vs "美团点评" vs "Meituan" | KNOWN_MERCHANTS 用 includes + alias map；Phase 8 EntityResolver 后端规范化 |
| T7 | 退款占比异常 | 用户淘宝大量退货 → spending 统计偏高 | normalize 时计 effectiveAmount = amount - refundedAmount，分析层用 effective |
| T8 | 交易关闭 / 失败状态 | 包进 spending 总额错 | status filter：分析层默认排除"交易关闭" |
| T9 | 跨年导入边界 | 12 月底 ZIP 含跨年事件 | 按 occurredAt 真实时间分桶，与 ZIP 文件名无关 |
| T10 | 用户多账户 collision | 两个支付宝账户都用同一商家 | account 字段 + originalId 复合 key 去重 |
| T11 | EntityResolver 不在时商家漏识 | 白名单不全 → unknown 太多 | Phase 8 EntityResolver 上线后批量 reprocess |
| T12 | 用户身份证后 6 位泄漏 | 中台明文存（Keystore 已加密但仍存） | UI 警示 + 不写日志 + 仅密码尝试时解密临时使用 |
| T13 | 备注里有他人 PII | 用户备注"借给王二妈手机 138-xxxx" → 二人手机号泄漏 | OQ：备注脱敏开关；audit log 记录所有读备注的查询 |

---

## 13. 演进路线

### v1（本设计稿）

- CSV 导出导入
- 商家白名单分类
- 跨 Email 去重

### v2

- Cookie 模式自动同步（接 Alipay web）
- 蚂蚁财富 / 余额宝 收益曲线
- 健康步数

### v3

- 蚂蚁森林（趣味）
- 芝麻信用
- 跨境（多币种）

---

## 14. 参考

- 父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md)
- 姐妹 [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md) — Phase 5 前置
- 支付宝官方"开具交易流水证明"帮助页（用户引导文案参考）

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（Adapter 规格）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部说明。Phase 6 Alipay Bill adapter 经支付宝官方导出 CSV 采集账单全量（转账 / 余额宝 / 公积金 / 共享单车 / 公交地铁 / 缴费），覆盖邮箱看不到的封闭金融场景。

### 2. 核心特性

官方 CSV 导出（唯一干净全量源）；结构化金融数据；与电商 / 邮箱跨源 link。

### 3. 系统架构

见父文档 `Personal_Data_Hub_Architecture.md` §12 Phase 6；紧随 Phase 5 EmailAdapter，验证 UnifiedSchema 对金融数据拟合度。

### 4. 系统定位

Personal Data Hub 的**支付宝账单采集 adapter**（Phase 6）。

### 5. 核心功能

CSV 解析 → normalize → LocalVault → KG。详见正文各节。

### 6. 技术架构

官方导出 CSV 解析；目标 app `com.eg.android.AlipayGphone`；实现包 `@chainlesschain/personal-data-hub/adapters/`。

### 7. 系统特点

CSV 源干净结构化（非反爬）；约 3 天工期验证 schema 拟合度。

### 8. 应用场景

「钱去哪了」金融流水归集，与电商「买了什么」互补。

### 9. 竞品对比

邮箱 / app 内抓取看不到的封闭金融场景，CSV 是唯一全量源（见正文头部）。

### 10. 配置参考

CSV 导出引导见正文（参考支付宝官方"开具交易流水证明"帮助页）。

### 11. 性能指标

CSV 解析随账单条数线性；本地处理无网络。

### 12. 测试覆盖

CSV 样本解析单测（见正文测试节）。

### 13. 安全考虑

账单含高敏感金融数据；落盘经 LocalVault 加密，仅本机使用。

### 14. 故障排除

CSV 格式 / 字段变更 → 更新解析映射（见正文）。

### 15. 关键文件

`@chainlesschain/personal-data-hub/adapters/`（alipay bill adapter）。

### 16. 使用示例

见正文 CSV 导入 / 解析示例。

### 17. 相关文档

见正文「14. 参考」：`Personal_Data_Hub_Architecture.md`、`Adapter_Email_IMAP.md`（Phase 5 前置）。
