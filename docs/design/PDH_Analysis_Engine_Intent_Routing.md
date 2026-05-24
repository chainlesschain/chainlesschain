# PDH AnalysisEngine 意图分类 + 按需检索路由

**Status**: Implemented (4/4 intent branches land, 2026-05-24)
**File**: `packages/personal-data-hub/lib/analysis.js` `_gatherFacts()`
**Memory**: `pdh_analysis_engine_intent_routing.md`
**Related**: §8 of [Personal_Data_Hub_Architecture.md](Personal_Data_Hub_Architecture.md)

## 背景

PDH `AnalysisEngine._gatherFacts` 原始版本：拉 `adapter+timeWindow` 范围内 `maxFacts`(80) 条 events，prompt-builder 排序去重塞 LLM。问题是 query-parser 已经从问题里抽出 `intent` 和 `subtype`（12 类），但 `_gatherFacts` 故意丢弃 — 关键词分类器假阴性率高（"在淘宝花了多少" parser 标 payment，但 taobao 是 order 事件，filter 进去 0 行）。

副作用：

- **小模型 prompt 撑爆**：Android 端侧 Qwen2.5-1.5B 有效指令窗 ~2-4K token，80 facts × 平均 25 token = 2K，已经卡极限。
- **答案不精准**：count 问题数 FACTS 数组长度而非真实 vault stats；sum 问题混入 message/visit 让 LLM 错算；最新问题塞 80 条让模型挑反不如直接给 3 条。

## 4 个 intent 路由

| intent | parser 触发词 | _gatherFacts 行为 | commit |
|---|---|---|---|
| `count` | 几个/多少个/几次/几条/how many | 默认 path + 在 prompt 头加 `TOTALS` 块（vault.stats 真数） | `19c11920e` |
| `latest` | 最近/最新/latest/recent | **!timeWindow** → narrow 3 events + skip persons/items；**有 timeWindow** → 默认 path | `9a00c0d95` |
| `list+entity` | 默认（list）+ 抽到实体名 | 默认 path 之后 FTS5 追加 `vault.searchEvents({q: entity})` 去重 | `a1fd5ffca` |
| `sum-amount` | 总共+花了/金额 | 4 个 amount-bearing subtype `[order,payment,transfer,income]` 各拉 `max(20, effMaxQueryLimit/4)` 条 + 去重 + occurredAt DESC | `c0fe34933` |

### intent=count（TOTALS 旁路）

不改 `_gatherFacts` 检索行为 — count intent 走默认 path 拉 events + persons + items。**关键修法在 prompt-builder**：

```
SYSTEM:
... Rule 6: TOTALS is authoritative ground truth, FACTS is a representative
sample capped at ~80 items — do NOT infer counts from FACTS length. ...

USER:
TOTALS:
  events: 12, persons: 512, places: 3, items: 89, topics: 0

FACTS:
  [evt-abc] 2026-04-12 order from taobao: 蛋白粉 ¥288.5 ...
  ...
QUESTION: 我有几个联系人？
```

LLM 看到 `TOTALS.persons: 512` 直接答 "你有 512 个联系人"，不去数 FACTS 截断后的 5 条样本。

### intent=latest（narrow 3-event 路径）

```js
if (parsed.intent === "latest" && !parsed.timeWindow) {
  const latestQ = { limit: min(LATEST_INTENT_FACT_LIMIT, effMaxFacts) }; // 3
  if (adapter) latestQ.adapter = adapter;
  const events = vault.queryEvents(latestQ);  // DESC by occurredAt
  if (events.length > 0) return events;
  // 0 → fall through to default broader path
}
```

**关键 caveat**：必须 `!parsed.timeWindow` 才走 narrow。"最近 30 天的消费" 同时命中 `parseTimeWindow` 和 `intent=latest`，但语义是 list-with-window 不是"最新 3 条"。fall through 默认路径才对。

skip persons/items — 用户问"最近的订单"不需要联系人/装机列表来回答。

0-result fallback：narrow 拉到 0 时回退默认（拉 persons+items 给模型一些上下文，让"最近订单"在订单为 0 时仍能说"你最近没下订单，但有这些其他活动..."）。

### intent=list + 实体名（FTS5 追加）

`extractEntityTerm(raw)` 用 stop-pattern 黑名单（时间/intent/subtype/adapter/list-trigger/虚词/标点/数字）清洗后取最长 2-10 字符段为候选：

```
"提到王老板的微信消息" → 移 "提到/的/消息" + adapter "微信" → "王老板"
"上个月在淘宝总共花了多少？" → 全 stop word → null
"我妈最近发的微信" → 移 "最近/微信/的" + "我"/"发" 单字 → null
                                              (单字中文名不抽，已知限制)
```

抽到实体名后**追加** FTS5 命中到默认 path 的 events 数组：

```js
if (parsed.intent === "list" && vault.searchEvents) {
  const entityTerm = extractEntityTerm(parsed.raw);
  if (entityTerm) {
    const headroom = effMaxFacts - events.length;
    if (headroom > 0) {
      const ftsResult = vault.searchEvents({
        q: entityTerm,
        adapter: parsed.filters.adapter,
        since: parsed.timeWindow?.since,
        until: parsed.timeWindow?.until,
        limit: min(headroom, LIST_INTENT_FTS_LIMIT),  // 10
      });
      // 去重 by id 追加到 events
    }
  }
}
```

**严格 additive**：抽词错最多浪费 10 条 budget，**不丢现有 events**；FTS 抛错 try/catch 吞，主路径完整返回；老 vault 无 `searchEvents` 方法 graceful skip。

### intent=sum-amount（4-subtype narrow）

```js
if (parsed.intent === "sum-amount") {
  const perSubtype = max(20, effMaxQueryLimit / 4);  // default 50
  const seen = new Set();
  const amountEvents = [];
  for (const sub of ["order", "payment", "transfer", "income"]) {
    const rows = vault.queryEvents({
      subtype: sub, adapter?, since?, until?, limit: perSubtype
    });
    for (const e of rows) if (!seen.has(e.id)) { seen.add(e.id); amountEvents.push(e); }
  }
  amountEvents.sort((a, b) => b.occurredAt - a.occurredAt);
  return amountEvents.slice(0, effMaxFacts);
  // ⚠️ 0 → return [] (NOT fall through)
}
```

**0-result 行为与 latest 不对称**：sum-amount narrow 拉到 0 → 直接返回 `[]` 触发 `warning="no-facts"`。原因：若 fall through 默认 path 拉出 messages/visits/browsing 等不带金额事件给 LLM 算 sum，模型可能尝试从 message 内容拼一个数。empty FACTS + TOTALS preamble 让模型说"找不到相关花费记录"更安全。

skip persons/items — 联系人/装机不带金额。

per-subtype budget `max(20, effMaxQueryLimit/4)`：默认 200 → 50/sub；Android 50 small-model budget → max(20, 12) = 20/sub。防 popular `payment` 把 `transfer`/`income` 挤掉。

## 决策表

```
parsed.intent           timeWindow?   adapter?   entity?    路由分支
─────────────────────────────────────────────────────────────────────────────
latest                  null          *          *          narrow 3 events
latest                  set           *          *          default path
sum-amount              *             *          *          4-subtype narrow
count                   *             *          *          default path + TOTALS
list                    *             *          抽到       default + FTS5 追加
list                    *             *          null       default path
```

## telemetry

`AnalysisEngine.ask` 写 stderr：

```
[PDH-ASK] ask effMaxFacts=80 effMaxQueryLimit=200 gathered=3 (events=3 persons=0 items=0) adapter=* intent=latest
[PDH-ASK] prompt factCount=3 truncated=0 messages=2 promptChars=1813
```

Android 端 `LocalCcRunner.askQuestion` 过滤 stderr `[PDH-ASK]` 行写 logcat。`adb logcat | grep PDH-ASK` 可见 routing 命中。

## 限制 & follow-up

1. **单字中文名不抽**（"妈"/"爸"）— stop-pattern 后单字残留太多 false-positive（"说"/"看"/"买"），filter 取 ≥2 字符段。
2. **emoji 可能漏成实体名候选** — `string.length` 计 UTF-16 code unit，emoji 通常 length=2 通过 filter。FTS5 trigram 搜 emoji 命中数极低，基本无害。
3. **sum-amount Phase 2 (follow-up)** — 加 `vault.sumEventAmount(filter)` 返回 `{total, currency, count, byDirection}`（SQL `SUM(json_extract(content,'$.amount.value'))`），prompt-builder 加 `AMOUNT_SUM` block + Rule 7「权威值不要从 FACTS 求和」。模仿 count TOTALS 旁路。按真机效果决定优先级。
4. **intent=count 走默认 path 拉 events 仍浪费 prompt** — count 真正需要的只是 TOTALS 数字；FACTS 几乎不被引用。可优化为 count 路径只返回少量代表性样本。Phase 3 follow-up。

## 测试覆盖

- `packages/personal-data-hub/__tests__/analysis.test.js` — 28 routing-specific case：
  - intent=latest 6 case (narrow/fallthrough/0-fallback/adapter/parser/budget cap)
  - intent=list FTS 9 case (entity 透传/无实体/老 vault/去重/不交叉触发/error 不阻塞/headroom/headroom=0/persons-items 预算)
  - intent=sum-amount 8 case (4-sub merge/0 empty no-fall/adapter/timeWindow/no-FTS/per-sub budget/dedup/截 effMaxFacts)
  - intent=count 5 case (默认 path 命中/TOTALS in prompt/no-FTS/no-sum-amount/persons-items 含)
- `packages/personal-data-hub/__tests__/query-parser.test.js` — `extractEntityTerm()` 10 case
- `packages/cli/src/commands/__tests__/hub-ask.test.js` — 7 case（含 question verbatim pass-through canary）

## 相关 commit 链

1. `19c11920e` (2026-05-21) — count TOTALS + query-parser 扩 count 触发词
2. `9a00c0d95` (2026-05-24) — latest narrow 3 + fallthrough on timeWindow
3. `a1fd5ffca` (2026-05-24) — extractEntityTerm + list FTS5 追加
4. `c0fe34933` (2026-05-24) — sum-amount 4-subtype narrow
5. （本次）— sum-amount empty no-fall bug fix + intent=count isolated test + 本设计文档
