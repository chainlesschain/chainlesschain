# Adapter: Shopping (Cookie + Web API) — 淘宝 / 京东 / 美团 三件套

> **状态**：v0.1 设计稿（2026-05-20）。Phase 7 待启。Personal Data Hub 的"消费图谱"主力 adapter，紧随 Phase 6 AlipayBillAdapter。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 7；前置 [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md)（Phase 6）+ [`Adapter_AIChat_History.md`](./Adapter_AIChat_History.md)（同样 cookie+WebView 鉴权范式）；姐妹 [`Adapter_Travel_LBS.md`](./Adapter_Travel_LBS.md)（Phase 9）
>
> **目标 app**（Redmi 24115RA8EC 真机已装确认 ✅）：
> - `com.taobao.taobao` — 淘宝（含天猫订单）
> - `com.jingdong.app.mall` — 京东
> - `com.sankuai.meituan` — 美团（外卖 + 团购 + 酒店）
>
> **为什么 Phase 7 紧随 Phase 6**：(1) AlipayBill 已抓到**钱的去向**（金额 + 收款方），但**买了什么**只有商品名片段；(2) 三大电商订单结构化最完整（SKU + 数量 + 收货地址 + 物流 + 评价）；(3) 用 merchantOrderNumber 与 AlipayBill 跨源 link，验证 KG 跨源能力；(4) 三家鉴权范式同构（cookie + web API），一次工程多家收益。

---

## 1. 背景

### 1.1 三家在消费图谱中的位置

| 维度 | 淘宝/天猫 | 京东 | 美团 |
|---|---|---|---|
| 主品类 | 全品类长尾 + 服饰 | 数码 + 家电 + 自营 | 外卖 + 餐饮 + 本地生活 |
| 订单结构 | 商品 SKU + 规格 + 物流 | 同左 + 自营备注 | 餐厅 + 菜品 + 配送 |
| 用户场景 | 月级中频 | 月级低频高客单 | 日级高频低客单 |
| 收货地址 | 多个保存 | 多个保存 | 多个保存 + LBS |
| 评价 | 必给 / 可追评 | 必给 | 必给 + 商家回复 |
| 收藏 / 购物车 | ✅ | ✅ | 不强 |
| 浏览历史 | ✅ | ✅ | ✅ |
| 与 Phase 6 交叉 | merchantOrderNumber | 同 | 同 |

**结论**：三家拼起来 = 用户**几乎所有线上+本地生活消费**的"买了什么 / 谁送来 / 在哪用"完整故事线。

### 1.2 三家鉴权 / 反爬态度

| 厂商 | cookie 复杂度 | 反爬力度 | API 稳定性 | 风控触发风险 |
|---|---|---|---|---|
| 淘宝 | 高（_tb_token_ + cookie2 + 滑块校验） | 高 | 中（h5 API 偶变） | **高**——节奏不对易封 |
| 京东 | 中 | 中 | 较稳 | 中 |
| 美团 | 低（token+uuid） | 低 | 稳（h5/小程序 API） | 低 |

**策略**：(1) v1 优先美团 → 京东 → 淘宝；(2) 淘宝 rate-limit 极保守（≤ 1 req / 2s + 跟随用户浏览节奏，不批量回拉历史）；(3) 触发风控 → adapter 立即停 + UI 红色 banner 提示。

---

## 2. 目标 & 非目标

### 2.1 目标 (v1 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | 3 家 sub-adapter 共用 `ShoppingCookieAdapter` 基类 + cookie+WebView 鉴权 | 单测每家独立 fixture 跑通 |
| G2 | 内嵌 Electron WebView 登录 + cookie 自动提取 | 用户在 UI 完成 3 家登录 < 10 分钟 |
| G3 | 订单同步：列表 + 详情 + 物流 + 评价 增量 watermark | 重跑 0 重复 |
| G4 | 收藏 / 购物车 / 浏览历史（用户可逐项开关） | 默认关浏览历史（隐私） |
| G5 | UnifiedSchema 映射 Event(order) + Item(product) + Place(收货地址) | 单测 fixture ≥ 30 |
| G6 | 与 AlipayBill 跨源去重（同 merchantOrderNumber → `same-as` KG 边） | E2E："淘宝总消费" 不双计 |
| G7 | AI 分析接通："去年在京东买的电器" / "我在哪家点过外卖最多" | 答案准 |
| G8 | rate-limit + 风控感知：检测到滑块/封号 → halt + 通知用户 | 单测 mock 风控响应 |
| G9 | Cookie 过期检测 + WebView 续登 < 1 分钟 | UI 通知 |

### 2.2 非目标 (defer)

- **拼多多 / 苏宁 / 唯品会** — v2，三件套验证成熟后扩
- **下单 / 退款 / 改地址 / 写评价** — adapter 只读
- **优惠券 / 红包 / 积分余额** — v2（隐私 + 工程复杂度）
- **直播间互动 / 弹幕** — v3
- **店铺粉丝关注 / 商家私信** — v2
- **跨平台比价 / 推荐** — 分析层做（adapter 不做）
- **OAuth2 / 开放平台 SDK** — 三家个人用户不开放
- **海外站（速卖通 / 京东海外 / 美团香港）** — v3

---

## 3. Open Questions

### OQ-1：cookie 提取方式

**A**：内嵌 Electron WebView，登录后从 session 提取 cookie
**B**：用户从浏览器 devtools 手动复制 cookie 字符串
**C**：扫码登录（淘宝支持手机端 app 扫 PC 二维码）

**推荐 A（B fallback）**。理由：(1) A 与 Phase 10 AIChat 同构，框架复用；(2) B 高级用户 fallback；(3) C 淘宝/京东支持但流程不统一，作为 A 内可选路径。**复用 Phase 10 设计的 `CookieAuthSession` 基类**。

### OQ-2：增量同步水位

**A**：每家用 lastOrderId（订单 ID 单调递增）
**B**：每家用 lastCreatedAt 时间戳
**C**：A + B 双水位（B 兜底，A 主路径）

**推荐 C**。理由：(1) A 高效但偶有补单导致 ID 倒插；(2) B 安全但每次全扫；(3) C 主用 A 增量拉，每周一次 B 校验补丁。watermark 格式 `<vendor>:<lastOrderId>:<lastCreatedAt>`。

### OQ-3：商品（Item）粒度

**A**：每订单一个 Item（聚合 SKU）
**B**：每 SKU 一个 Item（拆开）
**C**：订单 = Event，每个 SKU = Item，Event 关联 Item[]

**推荐 C**。理由：(1) A 损失 SKU 维度（"我买过多少次同款洗发水"答不了）；(2) B 一对一映射但订单维度信息（运费 / 优惠）落不下；(3) C 准确：Event 持金额合计 + 配送 + 状态；Item 持 SKU 详情。

### OQ-4：浏览 / 收藏的优先级

**A**：v1 全做（订单 + 收藏 + 浏览 + 评价 + 购物车）
**B**：v1 只做订单；其它 v2
**C**：v1 订单 + 评价 + 收藏；浏览 v2（隐私敏感）

**推荐 C**。理由：(1) A 工期翻倍；(2) B 浪费 cookie 流量（一次登录只抓订单不划算）；(3) C 订单 + 评价（用户主动留痕）+ 收藏（明确意图）是高 ROI；浏览历史是"被动数据"，默认关。

### OQ-5：rate-limit 与风控

**A**：固定间隔（如每 2s 一请求）
**B**：随机抖动（1-3s） + 跟随用户行为节奏（用户不在 ChainlessChain 前台时不拉）
**C**：A + 每页 sleep + 检测 5xx/滑块就 backoff

**推荐 B+C 组合**。理由：淘宝风控对"机械节奏"敏感；B 模拟人类；C 检测异常即退。每家独立 ratelimit 配置；淘宝最严，美团最松。具体阈值（淘宝 `perDay:200, minIntervalMs:2500`；京东 `perDay:500, minIntervalMs:1500`；美团 `perDay:1000, minIntervalMs:800`）。

### OQ-6：移动端 vs 桌面端通道

**A**：仅桌面（Electron WebView）
**B**：仅移动（Android WebView in app）
**C**：A + B 共存（桌面登录 cookie 同步到移动端）

**推荐 A**。理由：(1) Phase 10 AIChat 同样桌面登录范式已定；(2) B 移动端 WebView 受 app 风控更紧；(3) C 跨设备同步 cookie 涉及 DID + P2P 复杂度，v2 再做。Android adapter Phase 7 不实现，仅留接口。

---

## 4. 数据源分析

### 4.1 淘宝 / 天猫

**鉴权关键 cookie**：`_tb_token_` / `cookie2` / `t` / `sgcookie` / `unb`（数字用户 ID）/ `cna`

**API endpoint 范式**（h5）：

```
https://h5api.m.taobao.com/h5/mtop.order.queryorderlist/4.0/
  ?jsv=2.6.1&appKey=12574478&t=<timestamp>&sign=<computed>
  &v=4.0&type=jsonp&dataType=jsonp
  &api=mtop.order.queryorderlist&data=<urlencoded JSON>
```

**`sign` 计算**：`md5(token + "&" + timestamp + "&" + appKey + "&" + data)`，token 取自 `_m_h5_tk` cookie 前段。

**订单字段**：`mainOrders[].orderInfo.{id, status, payTime, actualFee.totalFee}` + `mainOrders[].subOrders[].{title, skuText, quantity, price, sellerId, picUrl}` + `mainOrders[].logisticsInfo.{deliveryAddress, logisticsCompany, expressNo}` + `mainOrders[].rateInfo`.

**评价**：单独 `mtop.taobao.rate.list.get`，按 orderId 查。

**收藏**：`mtop.favorite.collect.listcollect`。

### 4.2 京东

**鉴权关键 cookie**：`pt_key` / `pt_pin` / `pinId` / `_jdc`

**API endpoint**：

```
https://wq.jd.com/order/orderlist_merge
  ?sceneval=2&deal_flag=1&page=<n>&page_size=20
  &order_status=1&t=<timestamp>
Headers: Referer: https://wqs.jd.com/order/orderlist_merge.shtml
```

返回 HTML 片段 + 嵌入 JSON（`window.__INITIAL_STATE__`）。**需要 HTML 解析**（cheerio）+ JSON 提取双路径。

**订单字段**：`orderId, orderStatus, orderTime, finalPrice, products[{skuId, name, price, num, image}], address, shipInfo`.

### 4.3 美团

**鉴权关键 cookie**：`token` / `uuid` / `_lxsdk_cuid` / `userId`

**API endpoint**（h5）：

```
GET https://i.meituan.com/api/v8/orders/history?offset=0&limit=20
Headers: Token: <token>, Uuid: <uuid>
```

**订单字段**：`orders[].{orderId, status, payTime, totalFee, dealList[{title, count, price, dealId}], poiInfo.{name, address, location.{lat,lng}}, riderInfo}`.

**美团特有**：POI（餐厅）含 LBS 坐标 → 直接派生 Place 实体，与 Phase 9 高德/百度地图相互验证。

### 4.4 三家统一抽象

```typescript
interface ShoppingOrder {
  vendor: "taobao" | "jd" | "meituan";
  orderId: string;          // → Event.source.originalId
  merchantOrderNumber: string;  // = orderId（与 Alipay link key）
  status: "pending" | "paid" | "shipping" | "completed" | "refunded" | "cancelled";
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  totalFee: { value: number; currency: "CNY" };
  items: ShoppingItem[];
  shippingAddress: ShoppingAddress | null;
  merchant: { id: string; name: string; type: "shop" | "restaurant" | "self_op" };
  poi: { name: string; address: string; lat: number; lng: number } | null;  // meituan
  rateInfo: { score?: number; content?: string; ratedAt?: string } | null;
}

interface ShoppingItem {
  itemId: string;       // SKU
  productId: string;    // 商品（多 SKU 共用）
  title: string;
  spec: string | null;  // "颜色：黑色 尺码：L"
  quantity: number;
  price: { value: number; currency: "CNY" };
  imageUrl: string;
}

interface ShoppingAddress {
  receiver: string;
  phone: string;       // 加密存储（OQ-7）
  province: string;
  city: string;
  district: string;
  street: string;
}
```

---

## 5. Adapter 实现

### 5.1 类结构（共享基类 + 3 sub-adapter）

```javascript
// lib/adapters/shopping/_cookie-base.js
class CookieWebApiAdapter {
  constructor(opts) {
    this.account = opts.account;       // { vendor, cookieBlob, userId }
    this.cookieJar = opts.cookieJar;   // tough-cookie instance
    this.rateLimits = opts.rateLimits || { perDay: 200, minIntervalMs: 2000 };
    this.dataDisclosure = { ... };
  }

  async authenticate(ctx) { /* WebView ctx → extract cookie → validate */ }
  async healthCheck()     { /* GET userinfo endpoint */ }
  async *sync(opts)       { yield* this._syncOrders(opts);
                            yield* this._syncFavorites(opts);
                            yield* this._syncReviews(opts); }
  normalize(raw)          { /* dispatch by raw.kind */ }
}

// lib/adapters/shopping/taobao-adapter.js
class TaobaoAdapter extends CookieWebApiAdapter {
  name = "taobao";
  version = "0.1.0";
  capabilities = ["sync:cookie-h5api", "parse:orders"];
  extractMode = "web-api";

  async _syncOrders(opts) { /* mtop.order.queryorderlist 翻页 */ }
  _signMtop(token, ts, appKey, data) { /* md5 */ }
}

// 京东、美团类似
```

### 5.2 sync 流程

```
WebView 登录 → cookieBlob 存 vault（OQ-7 加密）
  ↓
sync(opts):
  1. 加载 cookieJar from vault
  2. healthCheck() → cookie 还有效？无效 → throw COOKIE_EXPIRED
  3. _syncOrders(opts.since):
     - 翻页拉 lastOrderId 以来订单列表
     - 每页 sleep minIntervalMs
     - 检测 5xx / 滑块 → backoff 60s → 第 3 次失败 throw RATE_LIMITED
  4. 每订单 yield RawShoppingOrder
  5. _syncReviews(orderIds) → yield RawShoppingReview
  6. _syncFavorites() → yield RawShoppingFavorite
```

### 5.3 normalize 映射

```javascript
normalize(raw) {
  if (raw.kind === "order") {
    const event = {
      id: newId(),
      type: "event",
      subtype: EVENT_SUBTYPES.ORDER,
      occurredAt: parseDateTime(raw.paidAt || raw.createdAt),
      actor: SELF_PERSON_ID,
      participants: [SELF_PERSON_ID, merchantPersonId],
      content: {
        title: raw.items.map((i) => i.title).join(" / ").slice(0, 80),
        amount: { value: raw.totalFee.value, currency: "CNY", direction: "out" },
      },
      source: {
        adapter: this.name,
        adapterVersion: this.version,
        originalId: raw.orderId,
        capturedAt: parseDateTime(raw.createdAt),
        capturedBy: CAPTURED_BY.API,
      },
      extra: {
        vendor: raw.vendor,
        merchantOrderNumber: raw.orderId,  // Alipay cross-link key
        status: raw.status,
        skuCount: raw.items.length,
      },
    };
    const persons = [{ id: merchantPersonId, type: "person", subtype: PERSON_SUBTYPES.MERCHANT, names: [raw.merchant.name] }];
    const items = raw.items.map((i) => ({
      id: newId(), type: "item", subtype: ITEM_SUBTYPES.PRODUCT,
      name: i.title, price: i.price, merchant: merchantPersonId,
      extra: { sku: i.itemId, productId: i.productId, spec: i.spec, qty: i.quantity, imageUrl: i.imageUrl },
    }));
    const places = raw.poi
      ? [{ id: newId(), type: "place", name: raw.poi.name,
           address: raw.poi.address, location: { lat: raw.poi.lat, lng: raw.poi.lng } }]
      : [];
    return { events: [event], persons, places, items };
  }
  if (raw.kind === "review") { /* Event(post, subtype=review) + edge to order Event */ }
  if (raw.kind === "favorite") { /* Item with marker extra.favorited=true */ }
}
```

### 5.4 跨源 link 算法（与 Alipay）

```
KG ingestor 后处理：
  ALL events where extra.merchantOrderNumber EXISTS AND adapter IN ("taobao", "jd", "meituan", "alipay-bill")
  GROUP BY extra.merchantOrderNumber
  FOR EACH group size >= 2:
    ADD edge: (taobao-event) --same-as--> (alipay-event)  AND symmetric
    SET cross_source_link = true
```

---

## 6. 隐私 / 风险

| ID | 风险 | 缓解 |
|---|---|---|
| R1 | cookie 落本地，盗设备即冒充用户 | vault 加密 + Keystore 主密钥 + 用户每月一次"会话审计"UI |
| R2 | 触发淘宝风控导致主账号被封 | rate-limit 极保守 + 滑块检测立即 halt + UI 红条 + 不模拟人机交互（不投毒）|
| R3 | 浏览历史隐私敏感（看过 X 暴露兴趣） | 默认关；用户显式打开有二次确认 |
| R4 | 收货地址含他人电话 | 加密存（OQ-7）+ 不上传 LLM 上下文（除非用户问"我妈地址"明确需要）|
| R5 | 商家 / 餐厅 LBS 暴露用户活动半径 | adapter 只存数据；分析层 prompt 加私域 gate |
| R6 | 三家协议同时被换（API breakage） | 单元测试 + provider 表 + 每月健康检查 cron + UI 通知 |

### OQ-7：手机号加密策略

**A**：明文存（用户自己设备，不外传）
**B**：vault 字段级加密（额外 Keystore key）
**C**：脱敏存（仅保留前 3 / 后 4 位）

**推荐 B**。理由：(1) A 设备被盗即暴露；(2) C 损失分析能力（"我妈的电话是哪个"答不了）；(3) B 用 vault 字段级加密 wrapper，分析层显式 unwrap。`ShoppingAddress.phoneEncrypted = encrypt(phone, vaultKey)`。

---

## 7. AI 分析价值

### 7.1 接入后可问

| 问题 | 路径 |
|---|---|
| "去年在京东总共买了多少？" | sum(totalFee) where vendor=jd + 时间窗 |
| "我在美团点过多少次外卖？" | count(events) where vendor=meituan + subtype=order |
| "外卖花最多的那个月是几月？" | groupBy(month) of meituan orders |
| "我去年买过哪些电器？" | items where category=电器（Topic 推断）|
| "我家附近最常点的店？" | meituan POI 聚类 + 距离 |
| "送给妈妈的快递最近一次什么时候？" | shippingAddress.receiver=妈 + EntityResolver |
| "我买过相同款的洗发水几次？" | items where productId=X 计数 |
| "评价都是好评吗？" | rateInfo.score 分布 |
| "我退过哪几个东西？" | status=refunded |

### 7.2 跨源价值

- 与 Alipay：**真实总开销**（避免双计）+ **支付方式分布**（信用卡 vs 余额宝）
- 与 Email：电商订单确认邮件 → 物流状态补全
- 与 Phase 9 高德：美团 POI ↔ 高德搜索过的餐厅 → "去过的店 vs 点过外卖的店" 维恩图
- 与 Phase 10 AIChat：用户问 AI "送什么礼物给我妈"——RAG 可召回最近一次淘宝订单的"妈"收货地址 + 历史送过的同类礼物

---

## 8. UI/UX

### 8.1 配置流程

```
设置 → 数据中台 → 添加来源 → 选"淘宝/京东/美团"
  ↓
[ 内嵌 WebView 弹窗 ]
  - URL: https://login.taobao.com / 京东 / 美团
  - 用户扫码 / 输密码登录
  - 主进程监听 webContents.session.cookies → 检测目标 cookie 全到位
  - "已检测到登录信息，是否保存？" → 是 → cookie 写 vault
  ↓
选同步范围：
  ▢ 订单（必选，默认开）
  ▢ 评价
  ▢ 收藏
  ▢ 购物车
  ▢ 浏览历史（隐私警示）
  ↓
"首次同步将拉取最近 90 天数据，预计 3-8 分钟"
  ↓
[ 进度条 + 实时计数 ]
```

### 8.2 失败 / 风控提示

| 场景 | UI |
|---|---|
| Cookie 过期 | 红色 banner + "重新登录" 按钮 → 重启 WebView |
| 触发滑块 | 黄色 banner + "暂停同步 30 分钟，请稍后再试" + 不自动重试 |
| API breakage | 红色 banner + "数据源协议变化，等待 ChainlessChain 更新" + 上报 telemetry |
| 限流 backoff | 灰色 inline + "已达今日同步上限，明天继续" |

---

## 9. 工程量估算

| sub-task | 工时 |
|---|---|
| `_cookie-base.js` 基类（鉴权 + cookieJar 持久化 + ratelimit + healthCheck） | 1d |
| `TaobaoAdapter` orders + reviews + favorites + mtop sign | 2d |
| `JdAdapter` orders + reviews + HTML 解析 | 1.5d |
| `MeituanAdapter` orders + POI 派生 | 1d |
| normalize + 跨源 link 钩子 + 单测 fixture 60 条 | 1d |
| WebView UI（Electron BrowserView） + cookie 拦截 | 0.5d |
| 集成测试 + AlipayBill 跨源 link E2E | 1d |
| **合计** | **8d**（与父文档 §12 Phase 7 7d 一致，+ 0.5d 缓冲） |

---

## 10. 文档 / 测试矩阵

| 类别 | 目标 |
|---|---|
| 单测 fixture | 三家各 ≥ 20 条订单 + 5 条评价 + 5 条收藏 |
| 集成 | Mock h5api server 跑完整 sync 流程 |
| E2E（真机） | Redmi 24115RA8EC + 真实 cookie，三家各拉 30 天 ≤ 5 分钟 |
| 跨源 | merchantOrderNumber + AlipayBill same-as 边构建正确 |
| 隐私 | 抓包验证无任何外部上传（含 LLM 上下文 sanitize） |
| 风控 | mock 滑块响应 → adapter 立即 halt 且 cookie 不损坏 |

---

## 11. 后续工作（v2+）

- **拼多多 + 唯品会**：同 cookie+WebView 范式扩展
- **多账户**：每家可多个登录（个人 + 家庭账户）
- **关注的店铺 / 主播**：派生 Topic
- **优惠券利用率**：每月 / 每年节省金额报告 Workflow
- **比价**：跨家相同 SKU 检测 + 历史价格曲线（与浏览历史合用）
- **Android adapter**：直接读 app 内 db / 通过 Plan A 远程操控触发 webview cookie 抽取
- **OAuth2 升级**：等三家开放个人 API（多年观望）

---

## 12. 兼容性矩阵

| 项 | v0.1 | 后续 |
|---|---|---|
| 桌面（Electron） | ✅ | — |
| Web shell / cc ui | 仅查看，不登录（WebView 桌面专属） | v2 加 web-shell 链路 |
| Android | ❌（Phase 7 不实现 Kotlin handler） | v2 mobile adapter |
| iOS | ❌ | v3 |

**Phase 7 完工标志**：三家在真实 Redmi 24115RA8EC 上跑通 30 天 sync，KG 内可查"上个月在淘宝 + 京东 + 美团总消费 = X" 数字与 Alipay 总流水**一致 ± 5%**。
