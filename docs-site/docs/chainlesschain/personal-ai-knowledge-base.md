# 个人 AI 知识库 — 数据分析与决策辅助

> **版本: v5.0.3.118 (pdh 0.4.28, 2026-06-17) | 状态: ✅ 生产就绪 | 6 确定性分析技能 + RAG 问答 | 5 实体表 | 全本地优先 (local-first) | PC + Android 双端**
>
> 个人数据中台（PDH）把你自己的真实数据采集进本地加密 vault；本页讲的是**采集之后**——如何让你的个人 AI **读懂并分析**这些数据，用于协助个人事务与决策。采集侧见 [个人数据中台](/chainlesschain/personal-data-hub)。

## 概述

**个人 AI 知识库** 是 ChainlessChain「数据主权回归个人」理念的分析层。个人数据中台（PDH）的采集器把联系人、通话、短信、聊天记录、消费、社交、媒体等真实数据归一化进本地加密 vault（`events` / `persons` / `places` / `items` / `topics` 五张实体表）；本知识库在此之上提供两条互补的分析通道：

- **确定性分析技能（`analysis.*`）**——6 个零 LLM、可复现的纯函数分析（关系图谱、消费、足迹、兴趣、时间线、跨应用总览），直接从 vault 聚合，结果稳定、可审计、零出域。
- **RAG 问答（`cc hub ask`）**——自然语言提问，先在 vault 上做检索召回（RAG），再交给本地或云端 LLM 归纳。默认本地优先；调用云端需显式放行（隐私闸）。

目标是把**散落在各 App 的个人数据**，变成你的私人 AI 能引用的**知识库语料**，让 AI 在「该联系谁」「钱花在哪」「最近作息」「兴趣画像」等个人决策上给出有据可依的建议——全程数据不离开你的设备（除非你显式选择云端 LLM）。

## 核心特性

- 🧠 **个人知识库语料化**: 采集数据经 vault → 可选 `kgSink`（知识图谱三元组）/ `ragSink`（RAG 文档）→ 个人 AI 可引用
- 🔗 **关系图谱 (`analysis.relations`)**: 按真实互动量排名联系人，带 `firstSeen`/`lastSeen`，识别核心圈层 / 转冷 / 新热联系
- 💰 **消费分析 (`analysis.spending`)**: 跨账单/订单聚合支出与收入，按商户/时间维度排名，月度趋势
- 🗺️ **足迹分析 (`analysis.footprint`)**: 出行事件聚合 Top 地点 + 月度分布
- 🎯 **兴趣画像 (`analysis.interests`)**: 从 topic / item / 应用归纳兴趣，自动过滤无意义噪声（数字群聊 ID 等）
- 🕒 **活动时间线 (`analysis.timeline`)**: 跨源按时间编织叙事，自动排除清单快照类「非活动」事件
- 📊 **跨应用总览 (`analysis.overview`)**: 一张去孤岛的决策快照（事件/应用/类型分布 + Top 联系人 + 消费汇总）
- 💬 **RAG 自然语言问答 (`cc hub ask`)**: vault 检索召回 + LLM 归纳，权威 TOTALS 注入，避免 LLM 幻觉
- 🔒 **本地优先 / 隐私闸**: 默认仅本地 LLM；云端 LLM 必须 `--accept-non-local` 显式放行
- 🧹 **去噪可信**: 兴趣过滤未解析群聊、时间线排除清单快照——避免污染知识库、误判画像
- 🔁 **可复现**: 确定性技能零随机、零 LLM，同一 vault 输出稳定，便于回归与审计
- 🖥️ **双端一致**: 同一 pdh 代码在桌面 CLI 与 Android in-APK cc 中行为一致（真机验证）

## 系统架构

### 数据流（采集 → 知识库 → 决策）

```
┌──────────────┐   归一化    ┌──────────────────────────────────┐
│  采集器 89+   │ ─────────▶ │       本地加密 Vault (SQLCipher)    │
│ (微信/通话/   │            │  events · persons · places ·       │
│  消费/社交/   │            │  items · topics                    │
│  媒体/系统)   │            └──────────────┬───────────────────┘
└──────────────┘                           │
                            ┌──────────────┴───────────────┐
                            ▼                               ▼
                  ┌────────────────────┐        ┌────────────────────────┐
                  │  确定性分析技能      │        │   RAG 召回 + LLM 归纳    │
                  │  analysis.*         │        │   cc hub ask /          │
                  │  (零 LLM·可复现)     │        │   retrieve-context      │
                  │  overview/relations │        │  (本地优先·云端需放行)    │
                  │  spending/footprint │        └───────────┬─────────────┘
                  │  interests/timeline │                    │
                  └─────────┬──────────┘                    │
                            └──────────────┬─────────────────┘
                                           ▼
                              ┌─────────────────────────┐
                              │   个人 AI：事务协助 / 决策  │
                              │ 谁重要·钱花哪·作息·兴趣·画像 │
                              └─────────────────────────┘
```

### Vault 实体表（分析的输入）

| 表        | 含义           | 分析用途                                          |
| --------- | -------------- | ------------------------------------------------- |
| `events`  | 时间线事件     | 消息/支付/出行/浏览…—— 时间线、消费、关系互动计数 |
| `persons` | 人物/联系人    | 关系图谱节点，互动对手方                          |
| `places`  | 地点           | 足迹 Top 地点                                     |
| `items`   | 物品/商品/内容 | 兴趣画像（购买/收到的商品名）                     |
| `topics`  | 主题           | 兴趣画像（群聊/话题/兴趣标签）                    |

> `events.extra.kind` 用于区分事件子类（如 `app-snapshot` / `contact-snapshot` 这类**清单快照**，由时间线分析排除）；`events.source.adapter` 标记数据来源应用。

## 分析技能详解

6 个确定性技能经 `cc hub run-skill <name>` 调用，名称**必须带 `analysis.` 前缀**。

### 操作概览

| 技能                 | 作用                        | LLM | 全量/采样             |
| -------------------- | --------------------------- | --- | --------------------- |
| `analysis.overview`  | 跨应用决策快照              | 否¹ | 采样（默认 10k 事件） |
| `analysis.relations` | 联系人关系强度排名          | 否¹ | 全量                  |
| `analysis.spending`  | 消费/收入聚合 + 趋势        | 否¹ | 全量（时间窗可选）    |
| `analysis.footprint` | Top 地点 + 月度分布         | 否¹ | 全量                  |
| `analysis.interests` | 兴趣画像（topic/item/应用） | 否¹ | 全量（已去噪）        |
| `analysis.timeline`  | 跨源活动时间线              | 否¹ | 最近 N（默认 7 天）   |

> ¹ 所有技能在**无 LLM 时**输出确定性结果；提供本地 LLM（或显式放行云端）时附加一段归纳 `llm_commentary` / `llmInterests` / `llm_narrative`，但**数据本体始终来自确定性聚合**。

### analysis.relations — 关系图谱

按真实互动次数排名联系人，附 `firstSeen`/`lastSeen`，可识别核心圈层、近期转冷、新建立的高频联系。

```bash
cc hub run-skill analysis.relations
# ranked: [{ personId, name, totalInteractions, totalSpend, totalIncome,
#            byAdapter:{wechat-pc:685}, firstSeen, lastSeen }, ...]
```

支持单人模式 `--personId <id>`（聚合与某人的全部互动，跨合并组展开）。

### analysis.spending — 消费分析

跨账单/订单聚合支出与收入，按商户或时间维度排名，输出月度趋势。

```bash
cc hub run-skill analysis.spending          # 总额 + 按商户 breakdown + 月度 trend
cc hub run-skill analysis.spending --merchantFilter 美团   # 限定商户
```

### analysis.interests — 兴趣画像（已去噪）

从 `topics`、`items`、事件标题归纳兴趣。**自动过滤无意义噪声**：纯数字/空名的 topic（如未解析的微信群聊 ID `45498354778`）不计入兴趣，避免淹没真实兴趣。

```bash
cc hub run-skill analysis.interests
# topTopics: [{ name:"豆包", eventCount, lastSeen }, ...]   ← 数字群 ID 已过滤
# topItems:  [{ name, occurrences, totalSpend }, ...]
```

### analysis.timeline — 活动时间线（已去噪）

跨源按时间编织活动叙事。**自动排除清单快照类事件**（`app-snapshot` 安装应用清单 / `contact-snapshot` 联系人花名册）——这类事件带「采集时刻」合成时间戳、量大（可达数万条），会冲垮按时间倒序的真实活动。

```bash
cc hub run-skill analysis.timeline                 # 默认最近 7 天
# entries: [{ id, occurredAt, title, kind, adapter, snippet }, ...]
# 仅真实活动（消息/支付/出行…），清单快照不出现
```

> 注：`since` 传 `0` 会被当作 falsy 退回 7 天默认窗口；要全量请传 `--since 1`（或具体毫秒时间戳）。

### analysis.overview — 跨应用决策快照

一张去孤岛的汇总：事件总数、活跃应用数、按应用/类型分布、月度活跃、Top 联系人（跨应用合并）、消费汇总。

```bash
cc hub run-skill analysis.overview
# summary:{ totalEvents, appsActive, topAppName } · byApp · byType ·
# monthlyActivity · topContacts · spending
```

> overview 默认按 10,000 条事件**采样**做分析（性能考量），其 byApp 计数是「近期采样」占比，不是全量；要全量关系排名用 `analysis.relations`。

### analysis.footprint — 足迹分析

聚合出行事件，输出 Top 地点与月度分布。

```bash
cc hub run-skill analysis.footprint
# summary:{ totalTrips } · topPlaces:[{name,...}] · monthlyDistribution
```

## RAG 自然语言问答

`cc hub ask` 先在 vault 上做检索召回（RAG），把权威事实（含 TOTALS）注入提示，再交给 LLM 归纳——既用自然语言，又避免 LLM 凭空捏造数字。

```bash
cc hub ask "最近一个月谁给我打电话最多？"
cc hub ask "我都收到过哪些银行/平台的验证码短信？注册了哪些金融服务？"

# 仅做检索、不调 LLM（看召回了哪些事实）：
cc hub retrieve-context "我的职业和兴趣"
```

| 选项                         | 作用                                             |
| ---------------------------- | ------------------------------------------------ |
| `--use-rag` / `--no-use-rag` | 开/关 RAG 检索（默认开）                         |
| `--accept-non-local`         | **允许调用非本地 LLM**（数据离开设备，云端必需） |
| `--max-facts <n>`            | 提示中事实条数上限（默认 80；端侧小模型建议 20） |
| `--max-query-limit <n>`      | vault 查询上限（默认 200；小模型建议 50）        |
| `--json`                     | 输出 JSON                                        |

> **隐私闸**：当配置的 LLM provider 不是本地（Ollama/vLLM）时，`cc hub ask` 默认拒绝发送、并提示需要 `--accept-non-local`。这是有意的——把个人数据摘要发往云端是一次明确的、需你确认的选择。

## 配置参考

主配置 `~/.chainlesschain/config.json`：

```jsonc
{
  "llm": {
    "provider": "volcengine", // 云端示例；本地优先用 "ollama"
    "model": "doubao-seed-1-6-251015",
    "apiKey": "...", // 云端 provider 需要；本地 Ollama 不需
  },
}
```

| 项                   | 默认                                          | 说明                                           |
| -------------------- | --------------------------------------------- | ---------------------------------------------- |
| `llm.provider`       | —                                             | `ollama`/`vllm` 视为本地；其它视为云端（出域） |
| `llm.model`          | —                                             | 分析归纳 / `ask` 使用的模型                    |
| 本地 LLM 端点        | `http://localhost:11434`                      | Ollama 默认；不在线时 `ask` 报 `fetch failed`  |
| vault 路径 (PC)      | `%APPDATA%/.../.chainlesschain/hub/vault.db`  | PC CLI 知识库                                  |
| vault 路径 (Android) | `files/home/.../.chainlesschain/hub/vault.db` | 设备 in-APK cc 知识库（与 PC 独立）            |

> **关键事实**：`cc hub` 用的是**已发布的 npm bundle**，不是工作区源码。改了 `packages/personal-data-hub/lib/**` 后，全局 `cc hub` 不会反映，需 republish + `npm i -g chainlesschain@latest`。

## 性能指标

| 操作                         | 典型规模 / 表现                                                    |
| ---------------------------- | ------------------------------------------------------------------ |
| `analysis.relations`（全量） | 15 万事件 / 2.4 万人物级 vault 秒级返回                            |
| `analysis.overview`          | 采样 10,000 事件，恒定开销                                         |
| `analysis.timeline`          | SQL 层 `excludeExtraKinds` 排除清单快照，避免扫描 2.4 万条同戳事件 |
| `analysis.interests`         | 过滤前 over-fetch ×20（上限 2000），防真兴趣被噪声挤出             |
| `cc hub ask` 检索            | `--max-facts` / `--max-query-limit` 控制提示规模与时延             |

> 实测参考：单机 vault `events 150,443 · persons 23,976 · items 2,286 · topics 167`，6 技能均秒级。

## 测试覆盖

| 套件                                               | 覆盖                                                     |
| -------------------------------------------------- | -------------------------------------------------------- |
| `__tests__/analysis-skills.test.js`                | 6 技能全覆盖（聚合/时间窗/LLM 门控/空库/去噪），45 用例  |
| `__tests__/analysis.test.js`                       | 分析引擎 / `ask` 意图路由，114 用例                      |
| `__tests__/vault.test.js`                          | `queryEvents`（含 `excludeExtraKinds`）等，vault 78 用例 |
| `__tests__/adapters/wechat-pc-group-topic.test.js` | 群 topic 名解析（显示名 / 回退 id / 空名回退），3 用例   |

- ✅ 去噪回归：兴趣过滤纯数字群 ID、时间线排除 `app-snapshot`/`contact-snapshot`、NULL-kind 事件保留
- ✅ LLM 门控：非本地 LLM 无 `acceptNonLocal` 时归纳被抑制；LLM 异常吞掉但数据路径不受影响
- ✅ 双端验证：真机（Android root）跑设备上提取的 pdh 0.4.28 代码，输出与 PC 一致

## 安全考虑

1. **本地优先**：确定性技能零出域；`cc hub ask` 默认仅本地 LLM，云端必须 `--accept-non-local` 显式放行。
2. **加密落盘**：vault 为 SQLCipher（AES-256）加密；Android 陪伴类数据另经设备 Keystore（StrongBox）加密。
3. **采集授权边界**：仅对**本人拥有**的设备 / **本人**账号 / **本人**应用采集；真机解密素材（明文副本）只存仓库外、用后即删，绝不入库/入 git。
4. **去噪即防污染**：过滤未解析群聊、排除清单快照——既是数据质量，也避免向个人 AI 知识库注入噪声、误判画像。
5. **隐私聚合**：跨同类家庭/人群的对比类分析（如温和度月报）由调用方注入已脱敏的分布，不下发个体明文。

## 故障排除

### 常见问题

**Q: `Unknown skill: overview`？**
A: 技能名必须带前缀，用 `analysis.overview`。可用：`analysis.{overview,relations,spending,footprint,interests,timeline}`。

**Q: 分析结果为空 / 没有数据？**
A: vault 为空——还没有采集器 sync 过数据。先采集（见[个人数据中台](/chainlesschain/personal-data-hub)）。注意 **PC vault 与 Android 设备 vault 相互独立**，设备端为空是因为设备上没采集过。

**Q: `analysis.timeline` 几乎没有条目？**
A: 默认只看最近 7 天，且 `since:0` 被当 falsy。要全量传 `--since 1`。另外清单快照事件被有意排除（它们不是真实活动）。

**Q: `cc hub ask` 报 `OllamaClient.chat: request failed — fetch failed`？**
A: 本地 Ollama 未运行（`http://localhost:11434`）。启动 Ollama，或在 config 配置云端 provider 并加 `--accept-non-local`。

**Q: 兴趣画像里全是数字群聊 ID？**
A: 该问题已在 pdh 0.4.28 修复（过滤纯数字 topic）。升级：`npm i -g chainlesschain@latest`（PC）/ 安装 ≥ v5.0.3.118 的 APK（Android）。

**Q: 改了分析代码但 `cc hub` 没变化？**
A: `cc hub` 用已发布 npm bundle，非工作区。需 republish pdh + cli 再 `npm i -g`。本地验证工作区改动可用 node 脚本经 `getHub()`（monorepo 把 `@chainlesschain/personal-data-hub` symlink 到工作区源）。

### 调试

```bash
cc hub stats                                   # 确认 events/persons/items/topics 增长
cc hub run-skill analysis.overview --json      # 跨应用快照，定位数据来自哪些 adapter
cc hub search --adapter system-data-android    # 按来源抽查事件
cc hub retrieve-context "<问题>"                # 看 RAG 召回了哪些事实（不调 LLM）
```

## 关键文件

| 文件                                                          | 说明                                          |
| ------------------------------------------------------------- | --------------------------------------------- |
| `packages/personal-data-hub/lib/analysis-skills/index.js`     | 技能注册与 `runAnalysisSkill` 分发            |
| `packages/personal-data-hub/lib/analysis-skills/base.js`      | `AnalysisSkill` 基类（时间窗 / LLM 门控）     |
| `packages/personal-data-hub/lib/analysis-skills/relations.js` | 关系图谱                                      |
| `packages/personal-data-hub/lib/analysis-skills/spending.js`  | 消费分析                                      |
| `packages/personal-data-hub/lib/analysis-skills/interests.js` | 兴趣画像（含数字 topic 过滤）                 |
| `packages/personal-data-hub/lib/analysis-skills/timeline.js`  | 活动时间线（清单快照排除）                    |
| `packages/personal-data-hub/lib/analysis-skills/overview.js`  | 跨应用决策快照                                |
| `packages/personal-data-hub/lib/analysis-skills/footprint.js` | 足迹分析                                      |
| `packages/personal-data-hub/lib/vault.js`                     | vault；`queryEvents` 支持 `excludeExtraKinds` |
| `packages/personal-data-hub/lib/adapters/wechat-pc/index.js`  | 微信 PC 采集；群 topic 名解析                 |
| `scripts/android/pdh-device-collect.mjs`                      | 真机系统数据一键采集（采集侧）                |

## 使用示例

### 跑一遍知识库分析

```bash
cc hub stats                                # 看库里有多少数据
cc hub run-skill analysis.overview          # 跨应用决策快照
cc hub run-skill analysis.relations         # 谁最重要 / 谁该联系
cc hub run-skill analysis.interests         # 兴趣画像（已去噪）
cc hub run-skill analysis.timeline --since 1  # 全量活动时间线
cc hub run-skill analysis.spending          # 消费画像
```

### 让个人 AI 用真实数据辅助决策

```bash
# 本地 LLM（数据不离开设备）
cc hub ask "最近一个月谁给我打电话最多？"

# 云端 LLM（需显式放行；数据摘要会发往云端）
cc hub ask "根据我的文件和应用，总结我的职业和兴趣" --accept-non-local
```

### 设备端（Android root）一致性验证

```bash
# 设备上提取的 pdh 代码与 PC 同源、行为一致：
#   interests → 数字群 ID 被过滤，只剩真实兴趣
#   timeline  → 清单快照被排除，只剩真实活动
# 安装 ≥ v5.0.3.118 的 APK，本地终端首次启动会把 cc bundle 解压到 USR 48。
```

## 相关文档

- [个人数据中台](/chainlesschain/personal-data-hub) — 采集侧：89+ 采集器、真机采集与本地解密
- [知识库管理](/chainlesschain/knowledge-base) — 通用知识库 / RAG 增强检索
- [Cowork 多智能体协作系统](/chainlesschain/cowork) — 多代理协作与技能系统
- [AI 模型](/chainlesschain/ai-models) — 本地 / 云端 LLM 配置
