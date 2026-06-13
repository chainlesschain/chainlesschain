# Adapter: Travel & LBS — 高德 / 百度地图 / 携程 / 12306 四件套

> **状态**：v0.1 设计稿（2026-05-20）。Phase 9 待启。Personal Data Hub 的"足迹 + 行程图谱"主力 adapter，紧随 Phase 8 EntityResolver。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 9；前置 [`Adapter_Shopping_Cookie.md`](./Adapter_Shopping_Cookie.md)（Phase 7，共享 cookie+WebView 基类）；姐妹 [`Adapter_AIChat_History.md`](./Adapter_AIChat_History.md)（Phase 10，同 cookie 范式）；隐式依赖 [`Personal_Data_Hub_EntityResolver.md`](./Personal_Data_Hub_EntityResolver.md)（Phase 8 提供 Place 消歧）
>
> **目标 app**（Redmi 24115RA8EC 真机已装确认 ✅）：
> - `com.autonavi.minimap` — 高德地图（足迹 + 搜索 + 导航 + 收藏地点）
> - `com.baidu.BaiduMap` — 百度地图（同类，部分用户偏好）
> - `ctrip.android.view` — 携程（机票 + 酒店 + 火车票 + 用车 + 度假）
> - `com.MobileTicket` — 铁路 12306（火车行程 + 候补 + 改签历史）
>
> **为什么 Phase 9 接在 Phase 8 之后**：(1) 出行数据 Place 实体爆炸（用户一年访问 1k+ 地点），强依赖 EntityResolver 消歧"金沙湾家乐福" vs "家乐福金沙湾店"；(2) 与 Phase 7 电商 / Phase 6 Alipay 形成"在哪里花了钱"完整故事；(3) 12306 / 携程的行程是**强结构化 + 时空 + 同行人**，KG 价值密度极高。

---

## 1. 背景

### 1.1 四家在出行图谱中的位置

| 维度 | 高德 | 百度地图 | 携程 | 12306 |
|---|---|---|---|---|
| 主数据 | 足迹时空轨迹 + 搜索 | 同高德（部分用户用） | 机+酒+车+度假订单 | 火车订单 + 候补 |
| 频次 | 日级被动采集 | 日级 | 月/季级 | 月/季级 |
| 时空精度 | 米级（GPS） | 米级 | 城市级 | 站到站 |
| 同行人 | 无（个人足迹） | 无 | ✅（订单含同行人姓名+身份证）| ✅（订单乘车人）|
| 跨源 link 字段 | 时间+坐标 | 同 | 订单号 ↔ Alipay 支付 | 12306 订单号 ↔ Alipay |
| 鉴权 | cookie + 手机号 | cookie | cookie | **滑块 + 短信验证码** |

**结论**：高德 + 百度 提供**"我在哪"**；携程 + 12306 提供**"我去哪 + 跟谁去"**。两类合一 = 用户**完整移动史**（含被动足迹 + 主动行程）。

### 1.2 12306 的特殊难点

- 反爬最严的国家级出行平台
- 滑块验证 + 行为指纹 + IP 风控全套
- 没有 h5 web API 可用（h5 端登录后部分接口走 PC web）
- **建议策略**：**完全不主动 API 拉取**，改走"用户主动操作时被动观察"路径 — 用户在 ChainlessChain 内嵌 WebView 登录后看自己订单时，adapter 通过 webRequest 拦截 response 缓存订单 JSON。即"用户在用 12306 网页 = 顺便 ingest 一次"，零额外触发风控。

### 1.3 与 Phase 7 共享基类

```
        CookieWebApiAdapter (Phase 7 抽出)
              │
   ┌──────────┼──────────┬──────────┬──────────┐
   ▼          ▼          ▼          ▼          ▼
 TaobaoAdapter  ...   AmapAdapter  BaiduMap  CtripAdapter
                                        Adapter

   PassiveWebViewAdapter (Phase 9 新基类，无主动拉取)
              │
              ▼
       Mobile12306Adapter
```

---

## 2. 目标 & 非目标

### 2.1 目标 (v1 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | 高德 + 百度足迹（被动 LBS 轨迹） | 单测 fixture ≥ 100 trajectory points |
| G2 | 携程订单（机/酒/车/火车票/度假），增量 watermark | 重跑 0 重复 |
| G3 | 12306 订单（**被动观察模式**，用户登录 WebView 时拦截响应） | E2E：用户登录看订单 → adapter 默默 ingest |
| G4 | UnifiedSchema Event(trip/visit) + Place + Person(同行人) 映射 | 单测 fixture ≥ 40 |
| G5 | EntityResolver Phase 8 接通：Place 消歧 / 同行人识别 | 跨源去重准确 ≥ 90% |
| G6 | 与 Alipay 跨源（携程订单号 ↔ Alipay 付款 + 12306 同款） | "上次去厦门花多少钱"答案全口径 |
| G7 | AI 分析："今年去过哪些城市" / "和谁去过 X" / "通勤分布" | 答案准 |
| G8 | LBS 隐私 sanitize：分析层 prompt 默认不暴露精确坐标 | LLM 上下文检查器单测 |
| G9 | 12306 同行人脱敏：身份证号字段级加密 + 不进 LLM 上下文 | 抓包 + 单测 |

### 2.2 非目标 (defer)

- **滴滴 / 美团打车** — Phase 9 不接（美团打车走 Phase 7 MeituanAdapter，滴滴独立 v2）
- **Uber / Lyft** — v3 海外
- **去哪儿 / 同程 / 飞猪** — v2（与携程同范式）
- **公交卡 / 城市一卡通** — Alipay 已部分有；v3
- **共享单车** — Alipay 已有
- **自驾导航路线详情** — v2（采集量大）
- **修改 / 取消订单 / 改签** — adapter 只读
- **机场 / 火车站值机状态** — v3
- **航空公司 app（南航 / 国航 / ...）** — v2

---

## 3. Open Questions

### OQ-1：高德足迹采集方式

**A**：cookie + amap.com web API（轨迹 / 收藏 / 搜索）
**B**：Android adapter 直接读 app 内 SQLite（需 root 或 sdcard workaround）
**C**：A + B（A 收藏 / 搜索，B 轨迹）

**推荐 A（v1）**。理由：(1) A 桌面端无需 root；(2) B 受 Android 11+ scoped storage 限制，多数机型需 sdcard workaround；(3) C 工程复杂。高德轨迹 web API 现在可拉，覆盖度足。**B 留 Phase 4.5 sidecar 方案兜底**（用户允许时通过 Plan A 远程操控 adb pull）。

### OQ-2：百度地图

**A**：与高德同 cookie+web API，独立 sub-adapter
**B**：仅用其中一家（用户选一个）
**C**：v1 不做百度，仅高德；百度 v2

**推荐 A**。理由：(1) 部分用户重度百度（北方城市百度地图覆盖好）；(2) 两家数据互补（搜索词偏好不同）；(3) 工程边际成本低（同 cookie 范式）；(4) C 漏掉一半用户。**B 在 UI 内做去重提示**：若两家足迹重叠 ≥ 70%，建议关闭一家。

### OQ-3：12306 鉴权

**A**：主动 API 拉取（高风控风险）
**B**：被动 WebView 观察（用户在 ChainlessChain 内嵌浏览器看订单 → adapter 拦截）
**C**：用户每次手动导出（12306 PC 网页有"我的-导出"）

**推荐 B（C 兜底）**。理由：(1) A 风控严重，可能影响用户真实买票；(2) B 用户自然行为顺便采集，零额外触发；(3) C 用户主动但麻烦。**实现**：内嵌 WebView 加载 `kyfw.12306.cn/otn/queryOrder/queryMyOrderNoComplete`，用户点登录看订单时 adapter 通过 `session.webRequest.onCompleted` 拦截 JSON 响应并 ingest。

### OQ-4：携程订单粒度

**A**：每订单一个 Event（机票 + 同行人合一）
**B**：每订单 + 每同行人 一对 Event（每人一次出行）
**C**：A + 派生 Person 实体（同行人）+ Event.participants 关联

**推荐 C**。理由：(1) A 损失"和谁出过差"的图谱；(2) B 一对多展开 Event 数爆炸；(3) C 准确 + 紧凑。同行人作 Person 实体 + Event.participants = [self, 同行人 ID]。

### OQ-5：LBS 精度（隐私 vs 分析能力）

**A**：原精度（米级 GPS）
**B**：百米级量化（reverse geocode 到 POI 名）
**C**：A 存原始 + 默认 B 进 KG / 进 LLM 上下文

**推荐 C**。理由：(1) A 精度高但分析价值溢出（不需要知道用户站在哪一棵树下）；(2) B 损失原始信息（用户想自己看精确轨迹做不到）；(3) C 双轨：vault.events.extra.gps_lat/gps_lng 存原始，KG/RAG 仅注入"在 XX 商场附近"。

### OQ-6：同行人身份证字段

**A**：明文存
**B**：字段级加密（同 Phase 7 OQ-7 phoneEncrypted 范式）
**C**：脱敏（前 6 + 后 4）

**推荐 B**。理由：(1) A 设备失窃即泄；(2) C 损失分析（"我妈和我去过几次"答不了若 ID 脱敏匹配不上）；(3) B 加密字段 `passengerIdEncrypted`，分析层 unwrap 时记录审计日志。

### OQ-7：地点（Place）消歧依赖 EntityResolver Phase 8

**A**：Phase 9 独立做（朴素字符串归一化）
**B**：依赖 Phase 8 完工
**C**：Phase 9 内置 fallback（字符串归一化 + 距离阈值 200m）+ Phase 8 上线后批量重算

**推荐 C**。理由：(1) A 重复造轮子；(2) B 强串行（Phase 9 必须等）；(3) C 立即可用 + 长期收敛。父文档 §12 Phase 8 → Phase 9 顺序已锁定 C 路径。

---

## 4. 数据源分析

### 4.1 高德地图

**鉴权 cookie**：`amap_uid` / `passport_login` / `tid`

**API endpoints**：
- 足迹：`https://restapi.amap.com/v3/user/track` （需要 access_token，从 cookie 派生）
- 搜索历史：`https://restapi.amap.com/ws/mapapi/searchhistory/searchHistory/list`
- 收藏点：`https://restapi.amap.com/ws/mapapi/favorite/queryFavorite`
- 导航历史：`https://restapi.amap.com/ws/mapapi/navi/queryNaviHistory`

**关键字段**：
```typescript
interface AmapTrackPoint {
  timestamp: number;
  lat: number;
  lng: number;
  accuracy: number;     // m
  speed: number;        // m/s
  poiName?: string;     // 反向地理编码（amap 自带）
  city?: string;
}

interface AmapSearchHistoryItem {
  keyword: string;
  searchedAt: number;
  resultPoi?: { name: string; address: string; lat: number; lng: number };
}
```

### 4.2 百度地图

**鉴权 cookie**：`BAIDUID` / `BDUSS` / `PTOKEN`

**API**：
- 足迹：`https://map.baidu.com/?qt=footprint` (隐式接口)
- 收藏：`https://map.baidu.com/?qt=fav_query`

**字段**：与高德同构，字段名映射表见 §5.4。

### 4.3 携程

**鉴权 cookie**：`_bfa` / `cticket` / `Union`

**API**：
```
GET https://m.ctrip.com/restapi/myctrip/api/orderlist
   ?orderType=all&pageIndex=1&pageSize=20
Headers: cticket
```

**订单类型 + 字段**：

| orderType | 字段 |
|---|---|
| flight | flightNo / depAirport / arrAirport / depTime / arrTime / passengers[] / amount |
| hotel | hotelName / hotelAddress / checkIn / checkOut / guests[] / amount |
| train | trainNo / depStation / arrStation / depTime / passengers[] / amount |
| car | carType / pickupAddr / returnAddr / startTime / endTime / amount |
| vacation | productName / depCity / arrCity / travelDates / travelers[] / amount |

### 4.4 12306

**端口**：被动 webRequest 拦截 `https://kyfw.12306.cn/otn/queryOrder/queryMyOrderNoComplete` + `queryMyOrderHistory` 响应。

**字段**：
```typescript
interface TrainOrder {
  sequence_no: string;        // 订单号 → Alipay link
  order_date: string;
  pay_status: string;
  ticket_total_price: string;
  start_train_date_page: string;
  train_code_page: string;    // G7501
  from_station_name_page: string;
  to_station_name_page: string;
  tickets: TrainTicket[];     // 乘车人数组
}
interface TrainTicket {
  ticket_no: string;
  passenger_name: string;
  passenger_id_no: string;    // 身份证（OQ-6 加密）
  seat_type_name: string;     // 二等座 / 一等座 / ...
  coach_no: string;
  seat_no: string;
}
```

### 4.5 字段映射统一

```typescript
function normalizeTravel(raw: { kind: "track" | "search" | "favorite" | "trip"; ... }) {
  switch (raw.kind) {
    case "track":
      // → Event(visit) + Place
      // occurredAt = timestamp
      // place.location = { lat, lng, accuracy }
      // place.name = poiName || reverseGeocode(lat, lng)
      return { events: [visitEvent], places: [place] };
    case "search":
      // → Event(interaction, subtype=search)
      // content.text = keyword
      // 若 resultPoi → Place
      return { events: [searchEvent], places: poi ? [poi] : [] };
    case "favorite":
      // → Place + Topic("favorited")
      return { events: [], places: [place], topics: [favTopic] };
    case "trip":
      // 携程 / 12306 订单 → Event(trip) + Place(出发/到达) + Person(同行人) + Item(机票)
      return { events: [tripEvent], places: [depPlace, arrPlace], persons: passengers, items: [ticketItem] };
  }
}
```

---

## 5. Adapter 实现

### 5.1 类结构

```javascript
// lib/adapters/travel/_passive-webview-base.js
class PassiveWebViewAdapter {
  // No active sync. Hub registers webRequest listener; when target URL hit, parse + ingest.
  constructor(opts) {
    this.targetUrlPatterns = opts.targetUrlPatterns;   // RegExp[]
    this.account = opts.account;
    this.dataDisclosure = { ... };
  }

  async authenticate(ctx)   { /* check cookie validity */ }
  async healthCheck()       { /* ping a low-impact endpoint */ }
  async *sync(_opts)        { /* yield queued raws from webRequest cache; empty if none */ }
  normalize(raw)            { /* dispatch */ }

  // Called by Hub WebView host on webRequest.onCompleted
  ingestResponse(url, body) {
    if (!this.targetUrlPatterns.some((p) => p.test(url))) return;
    const raws = this._parseResponse(url, body);
    this._queue.push(...raws);
  }
}

// lib/adapters/travel/amap-adapter.js
class AmapAdapter extends CookieWebApiAdapter {  // 复用 Phase 7 cookie 基类
  name = "amap"; version = "0.1.0";
  capabilities = ["sync:cookie-h5api", "parse:lbs"];
  extractMode = "web-api";
  async _syncTracks(opts)    { /* 翻页拉 since=lastTrackTimestamp */ }
  async _syncSearches(opts)  { /* ... */ }
  async _syncFavorites(opts) { /* ... */ }
}

// lib/adapters/travel/baidu-map-adapter.js
class BaiduMapAdapter extends CookieWebApiAdapter { /* 同 amap */ }

// lib/adapters/travel/ctrip-adapter.js
class CtripAdapter extends CookieWebApiAdapter { /* orders.list 翻页 */ }

// lib/adapters/travel/mobile-12306-adapter.js
class Mobile12306Adapter extends PassiveWebViewAdapter {
  name = "12306"; version = "0.1.0";
  capabilities = ["passive:webrequest-intercept", "parse:train"];
  extractMode = "web-api";
  // targetUrlPatterns = [/queryMyOrderNoComplete/, /queryMyOrderHistory/]
}
```

### 5.2 sync 流程对比

| 模式 | 触发 | 数据流 |
|---|---|---|
| Active (amap/baidu/ctrip) | hub scheduler 定时 / 用户点"立即同步" | adapter._syncX → API → yield raws → registry.normalize → vault |
| Passive (12306) | 用户在 ChainlessChain WebView 内访问 12306 | webRequest.onCompleted → ingestResponse(body) → queue → 下次 sync() yield queue |

### 5.3 Active sync 关键代码

```javascript
async *sync(opts) {
  const since = opts.since || this.account.watermark || 0;
  // 1. tracks
  const tracks = await this._fetchTracks({ since, limit: 1000 });
  for (const t of tracks) yield { kind: "track", payload: t };
  // 2. searches
  const searches = await this._fetchSearches({ since });
  for (const s of searches) yield { kind: "search", payload: s };
  // 3. favorites (全量 reload, count 小)
  const favs = await this._fetchFavorites();
  for (const f of favs) yield { kind: "favorite", payload: f };
  // watermark advance handled by registry post-sync
}
```

### 5.4 Place 字符串归一化（Phase 9 内置 fallback）

```javascript
function normalizePlaceName(name) {
  return name
    .replace(/[（(].*?[)）]/g, "")     // 去括号注释 "（北门）"
    .replace(/[\s\-_·•]+/g, "")        // 去分隔符
    .replace(/(店|分店|分公司|大酒店|酒店|宾馆|餐厅|商场|店铺)$/, "")  // 去通用后缀
    .toLowerCase();
}

// 距离阈值合并（Phase 8 EntityResolver 上线前）
function maybeMerge(p1, p2) {
  if (normalizePlaceName(p1.name) === normalizePlaceName(p2.name)) {
    const dist = haversine(p1.location, p2.location);
    if (dist < 200) return true;  // 200m 内同名 → 同一地点
  }
  return false;
}
```

---

## 6. 隐私 / 风险

| ID | 风险 | 缓解 |
|---|---|---|
| R1 | GPS 轨迹 = 用户全天住址工作地暴露 | LLM 上下文 sanitize（OQ-5 C）+ vault 加密 + 用户每月足迹审计 UI |
| R2 | 同行人身份证 / 手机号外泄 | OQ-6 字段级加密 + 默认不进 LLM |
| R3 | 12306 主动拉触发风控影响真实购票 | OQ-3 被动模式 + 不模拟登录 |
| R4 | 高德 cookie 被盗 → 读他人轨迹？ | cookie 域限制 + vault 加密 + 一旦发现异常 sync 立即撤销 |
| R5 | 4 家协议同时变 | provider 表 + monthly health-check + UI 通知 |
| R6 | Place 实体爆炸（用户一年 1k+ 地点）影响 KG 性能 | EntityResolver 合并 + 长期未访问 Place 归档 |
| R7 | 携程同行人字段含 minor（儿童）| 法律 gate + 用户首次同意"包含他人数据"勾选 |

---

## 7. AI 分析价值

### 7.1 接入后可问

| 问题 | 路径 |
|---|---|
| "今年去过哪些城市？" | distinct(place.city) from events where subtype=trip + 时间窗 |
| "我和我妈一起去过哪些地方？" | events where participants ∋ self ∧ mom-id |
| "上班通勤平均多久？" | trajectory 起止聚类（家 → 公司）+ 时长 |
| "我最常去的餐厅？" | groupBy place where category=restaurant + count |
| "去年坐火车多少次 / 哪些城市？" | 12306 trips count + distinct station |
| "上次去厦门花多少钱？" | trip event + 跨源 Alipay 同行程时间窗 sum |
| "我搜过哪些日料？" | search keywords containing 日料/寿司/和食 |
| "最近一年去过的咖啡馆？" | places where category=cafe + visit count |
| "周末和工作日的活动范围差异？" | trajectory 聚类 weekday vs weekend |

### 7.2 跨源价值

- 与 Alipay：**完整旅行账单**（机票 + 酒店 + 当地餐饮）
- 与 Phase 7 美团 POI：餐厅访问 ↔ 美团点外卖 → "去过但没点外卖" vs "点了外卖没去过"
- 与 Email：航班变动 / 取消邮件 ↔ 携程订单
- 与 Phase 10 AIChat：用户问 AI "明天厦门下雨吗"——RAG 召回最近一次厦门行程 → 推断"用户在厦门"
- 与 Phase 4.5 系统通讯录：同行人姓名 → 通讯录 → 真实关系

---

## 8. UI/UX

### 8.1 配置流程

```
设置 → 数据中台 → 添加来源 → 选"高德/百度/携程/12306"
  ↓
高德/百度/携程：cookie+WebView 登录（同 Phase 7）
12306：弹"特殊说明"
  - "12306 反爬严格，本工具不会主动 API 调用"
  - "请正常使用 ChainlessChain 内嵌浏览器查看您的 12306 订单"
  - "查看时数据将自动入库"
  → 用户确认 → 内嵌浏览器加载 12306 PC 网页
  ↓
[ 隐私分级勾选 ]
  ▣ 行程订单（必选）
  ▢ 足迹轨迹（默认关，明确隐私警示）
  ▣ 搜索历史 / 收藏地点
  ▢ 同行人姓名（默认关，他人数据法律 gate）
  ▢ 同行人身份证 / 手机号（默认关，二次警示）
```

### 8.2 数据展示

- **足迹热图**：UI 显示用户去过的所有 Place 在地图上，密度热图
- **行程时间线**：携程 + 12306 订单按时间排序，可点入详情
- **跨源故事线**：选一次旅行 → 一页显示机票（携程） + 酒店（携程） + 餐饮（美团 + Alipay） + 足迹（高德）

---

## 9. 工程量估算

| sub-task | 工时 |
|---|---|
| 复用 Phase 7 `CookieWebApiAdapter` 基类（已有） | 0d |
| 新基类 `PassiveWebViewAdapter`（webRequest 拦截 + queue） | 1d |
| `AmapAdapter` tracks + searches + favorites | 1.5d |
| `BaiduMapAdapter`（字段映射不同，结构同） | 1d |
| `CtripAdapter` 5 种订单类型 | 2d |
| `Mobile12306Adapter` 被动模式 + 字段解析 | 1.5d |
| normalize + Place 归一化 fallback + 跨源 link | 1d |
| WebView 主进程 webRequest 集成（Electron） | 0.5d |
| 集成 + E2E 真机 | 1.5d |
| **合计** | **10d**（父文档 §12 Phase 9 7d 是 budget，本估 + 3d，需 review 是否压缩或扩 phase） |

**Trade-off**：若 7d 严格 → 砍 BaiduMap 到 v2，先做 高德 + 携程 + 12306。

---

## 10. 文档 / 测试矩阵

| 类别 | 目标 |
|---|---|
| 单测 fixture | 高德 100 trajectory + 50 search；百度 同；携程 5×10 订单；12306 20 单 |
| 集成 | Mock 4 家 API 跑完整 sync |
| Place 合并 | 200 标注地点 → 合并率 ≥ 80% / 误合 ≤ 5% |
| 跨源 | 携程订单 ↔ Alipay payment + 12306 ↔ Alipay |
| 隐私 | trajectory 不进 LLM context（除非用户明问）单测 |
| 12306 被动 | 真实登录后查订单 → adapter 拦截 ≥ 1 单成功 ingest |
| E2E | Redmi 24115RA8EC 90 天足迹 + 5 次旅行全 KG 可查 |

---

## 11. 后续工作（v2+）

- **滴滴 / 美团打车 / 出行 SDK**
- **去哪儿 / 同程 / 飞猪**（携程同范式）
- **航司 app**（南航 / 国航 / 东航 / 海航）
- **Android adapter 直接读 amap SQLite**（Plan A 远程 adb pull）
- **足迹推断行程**：纯轨迹聚类生成 "未登记的旅行"（如自驾游无订单）
- **天气 / 空气质量 关联**：行程时段天气数据补全
- **国际航班 / 海外旅行** 支持
- **公交卡 + 城市一卡通**（Alipay 已部分）
- **Workflow 周报**：每周自动生成"本周足迹 + 旅行"

---

## 12. 兼容性矩阵

| 项 | v0.1 | 后续 |
|---|---|---|
| 桌面（Electron） | ✅ | — |
| Web shell / cc ui | 仅查看 | v2 |
| Android | ❌（v1 全走桌面 cookie） | v2 amap SQLite 通过 sidecar |
| iOS | ❌ | v3 |

**Phase 9 完工标志**：四家在真实 Redmi 24115RA8EC 上跑通 90 天 sync，KG 内可查 "今年和妈妈一起去过 N 个城市，其中 X 次坐火车"，答案与用户记忆 / 12306 历史 / 携程历史**全部一致**。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（Adapter 规格）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文头部说明。Phase 9 Travel & LBS adapter 经 cookie 采集高德 / 百度地图 / 携程 / 12306 的足迹与行程，是 Personal Data Hub「足迹 + 行程图谱」主力 adapter，紧随 Phase 8 EntityResolver。

### 2. 核心特性

四家（autonavi / baidu / ctrip / 12306）；足迹 + 搜索 + 行程 + 同行人；强时空结构化；强依赖 EntityResolver 做 Place 消歧。

### 3. 系统架构

见父文档 `Personal_Data_Hub_Architecture.md` §12 Phase 9；与 Phase 7 Shopping 共享 cookie + WebView 基类；隐式依赖 Phase 8 EntityResolver。

### 4. 系统定位

Personal Data Hub 的**出行 / LBS 足迹采集 adapter**（Phase 9）。

### 5. 核心功能

四家行程 / 足迹抓取 → Place 消歧 → normalize → KG。详见正文各节。

### 6. 技术架构

cookie + WebView 桌面登录；Place 实体经 EntityResolver 消歧；v0.1 全走桌面 cookie。

### 7. 系统特点

Place 实体爆炸（年 1k+ 地点）依赖消歧；行程强时空 + 同行人，KG 价值密度高。

### 8. 应用场景

与 Phase 7 电商 / Phase 6 Alipay 形成「在哪里花了钱」完整故事；行程 / 同行人查询。

### 9. 竞品对比

见正文「12. 兼容性矩阵」（桌面 / Web shell / Android / iOS 支持差异）。

### 10. 配置参考

各家 cookie / 账号配置见正文 adapter 配置节。

### 11. 性能指标

见正文「完工标志」：90 天 sync 后行程 / 同行人查询与 12306 / 携程历史全部一致。

### 12. 测试覆盖

真机 Redmi 24115RA8EC 90 天 sync 验收（见正文「完工标志」）。

### 13. 安全考虑

cookie + 位置数据高敏感；落盘经 LocalVault 加密；仅本机使用。

### 14. 故障排除

cookie 失效 / Place 消歧错误 → 重新登录 / 校正 EntityResolver 别名。

### 15. 关键文件

`@chainlesschain/personal-data-hub/adapters/`（travel cookie adapters）。

### 16. 使用示例

见正文 adapter 调用示例。

### 17. 相关文档

见正文头部关联：`Personal_Data_Hub_Architecture.md` §12、`Adapter_Shopping_Cookie.md`（Phase 7 共享基类）、`Personal_Data_Hub_EntityResolver.md`（Phase 8 依赖）、`Adapter_AIChat_History.md`（同 cookie 范式）。
