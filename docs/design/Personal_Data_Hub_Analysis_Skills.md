# Personal Data Hub — Phase 11 Analysis Skills 设计

> **状态**：v0.1 设计稿（2026-05-21）。Phase 11 已落地（5 内置 skill + base 类 + registry，参见 `packages/personal-data-hub/lib/analysis-skills/`）。本文档以"已实现"为底稿，回溯成形契约、输入/输出 schema、隐私边界、forward-looking trap，并给出"如何新增第 6 个 skill"的 checklist。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 Phase 11；姐妹 [`Personal_Data_Hub_EntityResolver.md`](./Personal_Data_Hub_EntityResolver.md)（Phase 8 给 `analysis.relations` 提供跨源合并组）/ [`Adapter_Alipay_Bill.md`](./Adapter_Alipay_Bill.md)（`payment` 子类是 `analysis.spending` 的主要事实源）/ [`Adapter_Email_IMAP.md`](./Adapter_Email_IMAP.md)（账单 / 出行模板填充 `content.amount`、Place）。
>
> **为什么把 5 个 skill 内置到 Hub 包**：
> 1. 隐私 gate 必须共享 `AnalysisEngine` 的 LLM 调用通路（`isLocal` 检测 + `acceptNonLocal` opt-in）；做成外部 Skill 模块要在每个 skill 里重抄一遍 gate 逻辑，容易漏。
> 2. 共享 `AnalysisSkill` base：5 个 skill 都用同一套 `resolveTimeWindow` / `expandToMergeGroup` / `callLlmCommentary` helper —— 复制开销 < 抽取依赖。
> 3. Citation 强校验同款逻辑：每个 skill 都要回出 `citations: eventId[]`，让 UI 能跳回事件详情（per `feedback_prompt_isolation`）。
> 4. 5 个 skill 数量稳定 —— 把它们当作 Hub "presentation layer" 的内置组件，不当作"插件"，避免 marketplace 权限模型蔓延到分析侧。

---

## 1. 背景 & 目标

### 1.1 问题陈述

Phase 3 落地了 `AnalysisEngine.ask` —— 自然语言通用 Q&A。但**通用 Q&A 不擅长聚合**：

- "上个月在淘宝总共花了多少？" —— LLM 看 RAG 召回的 30-50 条 order 事件，**手工累加**容易漏 / 重 / 算错（数值幻觉）；
- "和妈妈最近三个月联系多少次？" —— 跨源（Email / Alipay / 微信）必须先用 EntityResolver 合并，再按时间筛，**纯 prompt 难表达跨 Person 合并组的语义**；
- "上半年去过哪些城市？" —— Travel 类事件可能跨 12306 + 携程 + Alipay 三个 adapter，结果应去重；
- "我喜欢什么？" —— 需要从 Topic / Item / order 三个表抽取信号 + LLM 聚类命名。

通用 Q&A 把所有聚合都丢给 LLM，**算账靠 token 概率**不安全。每个聚合维度应该有一个确定性的"分析骨架"，LLM 只做最后一步语言化（commentary / narrative），数字必须落到 vault 查询结果上。

### 1.2 v1 目标

- 5 个 **内置 + 可枚举** 的 Analysis Skill，覆盖钱（spending）/ 人（relations）/ 地（footprint）/ 兴趣（interests）/ 叙事（timeline）五大维度
- 每个 skill 输入是结构化 typed bag（不是 NL），输出是 `{summary, breakdown, citations, llm_commentary}`
- 数字（`totalSpend` / `interactionCount` 等）**全部** 由 vault 查询确定性求得 —— LLM 不得"再算一次"
- LLM 用于 commentary（1-2 句中文摘要）+ interests skill 的语义聚类，受同一隐私 gate 约束（非本地 LLM 必须 `acceptNonLocal: true`）
- Citation 强约束：每个 skill 返回 `citations: eventId[]`，UI 能跳回事件详情（per Phase 5.6 deep-link）
- 跨源合并：`relations` skill 调用 `vault.getMergeGroupMembers(personId)` 展开 Phase 8 EntityResolver 合并组
- 工作流可消费：Phase 12 Workflow 路径里 `runAnalysisSkill(deps, name, options)` 被 Cowork 编排

### 1.3 非目标

- **不做** ad-hoc 维度（"按周二/周四区分消费"等小众查询） —— 用户在 SPA 里通过自定义 SQL 工具走 vault 直查，不是 skill 责任
- **不做** 预测 / forecast（"下个月预计花多少"）—— v1 只做历史聚合，预测开销与误差都不在隐私 gate 可控范围
- **不做** 用 LLM 求和 / 求平均（`SpendingSkill` 例外：仅 commentary 描述大致级别，数字仍用 vault 求） —— 防数值幻觉
- **不做** marketplace 化为可下载第三方 skill —— 数据安全敏感性远超 skill marketplace 安全收益（一个 spending skill 看到全部支付事实，恶意 skill 即数据泄漏）

---

## 2. 总体设计

### 2.1 dispatch 入口

```
SPA / cli / cc ui
        │
        ▼ IPC `personal-data-hub:run-skill` / WS `personal-data-hub.run-skill`
desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js
        │  payload { skill: "analysis.spending", options: {...} }
        ▼
packages/personal-data-hub/lib/analysis-skills/index.js
   runAnalysisSkill({ vault, llm }, skillName, options)
        │
        ▼ SKILL_REGISTRY[skillName]  (5 keys)
   new SpendingSkill({ vault, llm }).run(options)
```

`runAnalysisSkill` 是**唯一**对外入口。SPA 不直接 `new SpendingSkill()`；Cowork 编排也走 `runSkill` 主题。这让"添加 / 移除 skill"只改 `SKILL_REGISTRY` 一处。

### 2.2 共享基类 `AnalysisSkill`

`lib/analysis-skills/base.js`（113 LOC）—— 5 skill 必须 `extends AnalysisSkill`。

**Constructor 契约**：

```js
new SpendingSkill({ vault: LocalVault, llm: LLMClient | null })
// vault 必填；llm 可空（无 LLM 时跳过 commentary 返回纯数据）
```

**共享 helper**（不要在 skill 子类重抄）：

| Helper | 用途 | 注意 |
|---|---|---|
| `resolveTimeWindow(options)` | 接受 `{since,until}` / `{sinceDays}` / `{sinceMonths}` 任一形态 → 统一 `{since, until}` ms 对 | `sinceDays` × `86400_000`，`sinceMonths` 用近似 `30 × 86400_000`（**不**做日历月精确） |
| `expandToMergeGroup(personId)` | `vault.getMergeGroupMembers(personId)` 调用 + 异常兜底返回 `[personId]` | EntityResolver Phase 8 未启时仍可工作 |
| `callLlmCommentary(messages, opts)` | LLM commentary 通用包装 + 隐私 gate + 异常吞 | `isLocal === false && !opts.acceptNonLocal` → 返 `null`；这是**唯一**允许吞 LLM 异常的入口 |

### 2.3 输出统一形状

```ts
type SkillResult<TSummary, TBreakdown = unknown> = {
  skill: string;                      // "analysis.spending" 等
  summary: TSummary;                  // skill-specific
  breakdown?: TBreakdown[];           // optional aggregate detail
  trend?: { monthKey, ... }[];        // optional time series
  citations: string[];                // eventId 列表，UI 跳详情用
  llm_commentary?: string | null;     // 1-2 句中文摘要，无 LLM → null
};
```

**citations 必填且非空（除非 events 为空）**。UI 据此渲染 "依据 N 条事件" + 列出引用 chip。Phase 5.6 deep-link 流程对全 5 skill 复用。

---

## 3. 5 个 Skill 详细契约

### 3.1 `analysis.spending` — 消费聚合

**`lib/analysis-skills/spending.js` (219 LOC)**

| 输入字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `since` / `until` / `sinceDays` / `sinceMonths` | number | （由 `resolveTimeWindow`）| 时间窗 |
| `dimension` | `"merchant" \| "category" \| "counterparty" \| "month"` | `"merchant"` | 聚合维度 |
| `merchantFilter` | string | — | 商家子串过滤（case-insensitive） |
| `personId` | string | — | scope 到给某人转出的支付（merge-group 展开） |
| `topN` | number | `10` | breakdown 前 N |
| `commentary` | boolean | `true` | 关掉 LLM 评论 |

**事实源**：`vault.queryEvents({ subtype })` for `subtype ∈ {payment, transfer, refund, utility, redenvelope, investment, income, order}`，过滤 `content.amount.value` finite。

**事件覆盖**：Phase 6 (Alipay)、Phase 5 (Email 账单模板)、Phase 7 (Taobao/JD/Meituan order 子类)。

**输出 summary**：

```ts
{
  totalSpend: number;        // 出 (payment + utility + redenvelope + order)
  totalIncome: number;       // 入 (income)
  netFlow: number;
  currency: "CNY";           // v1 CNY only；混币种 v2
  eventCount: number;
  uniqueCounterparties: number;
  period: { since, until };
}
```

**关键不变量**：
- `totalSpend` / `totalIncome` 均来自 `vault.queryEvents` 累加，**LLM 不参与求值**
- `breakdown[].percentOfTotal` = `totalSpend / sumSpend × 100`，避免 0 除（无事件 → `[]`）
- `dimension === "month"` 时 key 用 `YYYY-MM`

### 3.2 `analysis.relations` — 人物关系

**`lib/analysis-skills/relations.js` (226 LOC)**

两种模式：

- `personId` 给：返回该 Person 的 `profile`（merge-group 展开）—— 总互动数、按 adapter 分布、按月分布、净流向（你→他 vs 他→你）、首/末次互动；
- `personId` 不给：返回 `ranked[topN]` —— 按总互动排前 N 人。

**事实源**：`vault.queryEvents` for `subtype ∈ {message, payment, transfer, redenvelope, order, ai-message}`，按 `actor` + `participants` 维度 bucket。

**跨源**：`profile.totalInteractions` = email 邮件数 + alipay 转账数 + 微信消息数 + ... 全靠 `expandToMergeGroup` 把同一现实人物的多个 Person id 合并到一桶。**EntityResolver Phase 8 未启时仍可工作**（每人独立桶）—— 这是 Phase 11 早于 Phase 8 上线就能用的关键。

**输出 profile**：

```ts
{
  personId: string;          // 原始入参 id
  names: string[];           // merge-group 内所有 Person 的 name 列表
  totalInteractions: number;
  byAdapter: { [adapter]: number };
  byMonth: { [YYYY-MM]: number };
  outboundCount: number;     // self→other
  inboundCount: number;      // other→self
  outboundShare: number;     // outbound / total, 0-1
  totalSpend: number;        // self→other 转账总和
  totalIncome: number;       // other→self
  firstInteraction: number;  // ms epoch
  lastInteraction: number;
}
```

### 3.3 `analysis.footprint` — 地理足迹

**`lib/analysis-skills/footprint.js` (167 LOC)**

| 输入 | 默认 | 含义 |
|---|---|---|
| `timeWindow` 标准 | 全时段 | — |
| `topN` | `10` | 前 N 地点 |
| `groupBy` | `"place"` | `"city" \| "place" \| "country"` |

**事实源**：subtype ∈ {`travel`, `visit`, `checkin`}。Phase 9 (Travel four-pack) 后才"满盘真数据"；目前用 Phase 5 (Email 出行模板) + Phase 6 (Alipay 出行类支付) 已能跑 v0 结果。

**输出**：

```ts
{
  summary: { totalTrips, uniquePlaces, period };
  topPlaces: [{ name, visits, lastVisit, eventIds }];
  monthlyDistribution: [{ monthKey, trips }];
  citations;
  llm_commentary;
}
```

**注意**：v1 不算"在某地停留时长"（需 entry/exit pair，Phase 9 才能 reliable 出）。仅算"到访次数"。

### 3.4 `analysis.interests` — 兴趣画像

**`lib/analysis-skills/interests.js` (161 LOC)**

| 输入 | 默认 | 含义 |
|---|---|---|
| `timeWindow` | 全时段 | — |
| `topN` | `15` | 各 list 前 N |
| `commentary` | `true` | 关 LLM 跳 `llmInterests` 聚类 |

**事实源**：
- Topic 表（adapter 已分类的 `Topic` rows） — 按出现频次排序
- Item 表（订单 product / 链接 / 文档） — 按出现次数 + 总消费
- Event content.title from order / payment / visit — 给 LLM 看 200 条样本做聚类

**纯数据路径**（无 LLM）：返回 `topTopics` + `topItems` 频次表。**绝不**用 LLM 给已有数字"重新生成"频次。

**LLM 聚类路径**（`llmInterests`）：sample 200 条 title → prompt "Cluster these into 5-10 interest categories and name each" → 解析输出为 `[{ category, evidenceCount, examples }]`。**examples 必须来自原始 title 字面**（防幻觉杜撰）。

### 3.5 `analysis.timeline` — 跨源叙事时间线

**`lib/analysis-skills/timeline.js` (167 LOC)**

| 输入 | 默认 | 含义 |
|---|---|---|
| `timeWindow` | 近 7 天 | 默认窗口短 |
| `topicFilter` | — | 子串 match title / counterparty |
| `personId` | — | scope 含该人事件（merge-group 展开） |
| `limit` | `100` | 事件上限 |
| `narrative` | `true` | 关 LLM 跳叙事段落 |

**输出 entries**：每行 `{ id, occurredAt, title, kind, amount?, adapter, snippet }`，按 occurredAt asc 排好。kind 字段：`payment` / `message` / `order` / `travel` / `email` / `ai-chat` —— 让前端能挂不同图标。

**LLM narrative**：1 段中文（≤120 字）—— "你 5/12 在淘宝下了 X 单，5/14 给妈妈转账 Y 元，周末去了 Z"。事件具体描述**必须**用 prompt 里给出的 entries 字面 —— 不允许 LLM 编造新事件。

---

## 4. 隐私 Gate 与 LLM 调用

5 个 skill 中**只有 4 个**默认调用 LLM（`spending` / `relations` / `footprint` / `interests` / `timeline` 都可关），且**全部走** `base.callLlmCommentary`：

```js
async callLlmCommentary(messages, opts = {}) {
  if (!this.llm || typeof this.llm.chat !== "function") return null;
  if (this.llm.isLocal === false && !opts.acceptNonLocal) return null;
  try {
    const r = await this.llm.chat(messages, { temperature: 0.2, ...opts });
    return (r && r.text) || null;
  } catch (_e) { return null; }
}
```

**三重防御**：

1. 没 LLM → null（commentary 字段就是 null，UI 不渲染）
2. 非本地 LLM + 未 opt-in → null（同 `AnalysisEngine.ask` 的隐私 gate）
3. LLM 抛错 → null（commentary 故障**不应**阻塞整个 skill 返回数据 — 数字仍有，叙事/评论是 nice-to-have）

**关键设计**：commentary 是 **post-hoc** 的，不参与求值。所以 LLM 不可用时整个 skill 仍能返回 `summary` + `breakdown` + `citations` —— 完全可用，只是没有"自然语言摘要"。这与 `AnalysisEngine.ask` 不同（ask 强依赖 LLM）。

---

## 5. IPC / WS 接口

```ts
// 通道：personal-data-hub:run-skill  (IPC) / personal-data-hub.run-skill (WS)
interface RunSkillRequest {
  skill: "analysis.spending" | "analysis.relations" | "analysis.footprint"
       | "analysis.interests" | "analysis.timeline";
  options: object;  // skill-specific
}
type RunSkillResponse = SkillResult | { error: string };
```

错误模式：

| 错误 | 触发 | UX |
|---|---|---|
| `unknown analysis skill: X. Known: ...` | `SKILL_REGISTRY[name]` 没匹配 | UI 报"未知 skill"，列出 5 个可选 |
| `AnalysisSkill: opts.vault required` | wiring 没注入 vault（理论上 IPC 层兜底） | UI 报"Hub 未初始化"，引导走 health check |
| LLM 错误 | callLlmCommentary 内部吞了 | summary/breakdown 仍正常，commentary=null |

---

## 6. 测试策略

- **每个 skill 至少 1 个 happy-path 测试**：mock vault + canned events → run() → 断言 summary 各字段
- **跨源 merge-group 路径**：`relations` 必须有 vault.getMergeGroupMembers 桩，验同一现实人的多个 PersonId 计数被合并
- **空数据路径**：`vault.queryEvents` 返 `[]` → skill 不 crash，返 `{ summary: { ... 0 / null ...}, breakdown: [], citations: [] }`
- **隐私 gate 路径**：`llm.isLocal=false` + 不传 `acceptNonLocal` → `llm_commentary === null`
- **LLM 异常路径**：注入 `llm.chat = () => Promise.reject()` → 不冒泡，commentary=null

测试基线见 `packages/personal-data-hub/__tests__/analysis-skills.test.js`（≥30 test）。

---

## 7. Forward-looking Traps

| # | Trap | 修法 |
|---|---|---|
| T1 | **数值由 LLM 生成** —— 把 `totalSpend` 数字字段写进 prompt 让 LLM "汇总" | 永远在 skill 代码里求和，prompt 只接收**已计算好的**数字让 LLM 描述（commentary 字段） |
| T2 | **citations 漏给 / 给错** —— 把整 list events.id 全塞造成 SPA 渲染上千个 chip | `citations.slice(0, 50)` 截断；UI 显示 "依据 N 条（仅展示前 50）" |
| T3 | **隐私 gate 在 skill 内重写** —— 子类绕开 `callLlmCommentary` 直接 `this.llm.chat()` | code review 强制走 base helper；ESLint 自定义 rule 拒绝直接调用 `this.llm.chat` |
| T4 | **`sinceMonths × 30 × 86400_000` 近似月** —— 6 月 30 日跑"近 1 个月"少算 1 天 | 文档明确"近似月 = 30 天"；UI 展示"近 30 天"避免歧义。日历月精确版 v2 |
| T5 | **timeline narrative 编新事件** —— LLM 把 prompt 里的 5 条 title 串成"周末去吃了海底捞"，但 vault 没有海底捞事件 | prompt 用 "ONLY summarize the events listed; do not invent new ones"；post-validate 拿 narrative 里的实体名 vs entries.title 子串 match |
| T6 | **interests 聚类 hallucinated examples** —— LLM 编 example 名 | examples 必须从输入 title list 取，post-validate "每个 example 必须是输入 title 之一的子串" |
| T7 | **`expandToMergeGroup` 没桩** —— EntityResolver Phase 8 未启时 `vault.getMergeGroupMembers` 不存在 | base helper 已 try/catch + 返 `[personId]` 兜底；新 skill 必须用 helper 不要直查 vault |
| T8 | **Spending 不含 order 子类** —— 用户问"上月在淘宝花多少"，spending skill 只看 payment → 0 元 | 修：subtypes 列表已加 `"order"`（commit 时验：Phase 7 后 spending tests 必须含 order fixture） |
| T9 | **跨币种混算** —— content.amount.currency 可能是 USD/CNY 混杂 | v1 文档明示 CNY only；遇到非 CNY 事件需 filter 掉并 warn；v2 加 currency 字段 + 实时汇率 |
| T10 | **commentary 阻塞返回** —— 同步 await LLM 让 skill 总 latency 飙到 3-8s | commentary 是 `await this._llmCommentary(...)` 但**已 try/catch**，超时由调用方设（IPC 层 30s）。**绝不** Promise.race 加自有 timeout（用户偏好关掉而非超时） |

---

## 8. 如何新增第 6 个 skill（checklist）

1. 在 `lib/analysis-skills/<name>.js` 新建文件，`extends AnalysisSkill`
2. constructor 调 `super({ ...opts, name: "analysis.<name>" })` —— name 必须 `analysis.` 前缀
3. 实现 `async run(options)`，**必须** 返 `{ skill, summary, citations, llm_commentary }` 形状
4. 在 `lib/analysis-skills/index.js` `SKILL_REGISTRY` 加一行 `"analysis.<name>": <Name>Skill`
5. 在 `lib/index.js` `module.exports` 加 `<Name>Skill` re-export
6. 写 happy-path / empty / privacy-gate / llm-fail 4 测试到 `__tests__/analysis-skills.test.js`
7. 在 SPA 端 `views/PersonalDataHub.vue` 加按钮 + result 渲染（per-skill 形状不同需自定义模板）
8. 更新本文档 §3 增加该 skill 的契约表 + §6 测试要求
9. 评估：是否需要新事件 subtype？需要的话先在 `lib/constants.js` 加 subtype + 让相关 adapter 补 normalize
10. CHANGELOG 记 "+analysis.<name>"，docs-site `personal-data-hub.md` 总测试数 + 1

---

## 9. 相关文档

- [父：Personal_Data_Hub_Architecture.md](./Personal_Data_Hub_Architecture.md) — Phase 11 在 §12 路线图
- [EntityResolver Phase 8](./Personal_Data_Hub_EntityResolver.md) — relations skill 依赖
- [E2E Runbook](./Personal_Data_Hub_E2E_Runbook.md) — 真账号端到端验收（含 skill 跑通路径）
- [Adapter — Alipay 账单](./Adapter_Alipay_Bill.md) — spending 主要事实源
- [Adapter — 电商 Cookie](./Adapter_Shopping_Cookie.md) — order 子类（Phase 7 后扩 spending 覆盖）
