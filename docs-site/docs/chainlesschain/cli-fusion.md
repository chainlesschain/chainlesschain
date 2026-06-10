# 协议融合与 AI 社交（cc fusion）

> **版本: Phase 72-73 CLI port + V2 + pfgov 治理覆盖层 | 状态: ✅ 可用（模拟后端） | 93 + 44 单元测试全绿**
>
> `cc fusion` 是桌面端「协议融合系统」（Phase 72-73，设计文档 `docs/design/modules/40_协议融合系统.md`）的 CLI 移植面：**跨协议统一消息**（DID / ActivityPub / Nostr / Matrix）、**身份映射**、**内容质量评估**与**翻译缓存**，外加 V2 桥/翻译运行状态机与 pfgov 治理覆盖层。注意：CLI 端为**模拟实现** —— 不含真实协议桥、实时 LLM 翻译、ML 内容分类器和 WebSocket 实时流（这些在桌面端）。

## 概述

去中心化社交世界有四套互不相通的身份与消息协议。`cc fusion` 在 CLI 层把它们抽象成统一对象：

1. **统一消息（Phase 72）**：`send` 把一条消息记录为统一格式（JSON：protocol/sender/body/ts），源/目标协议不同则标 `converted`，有目标协议则标 `routed`。
2. **身份映射**：一个映射行最多关联 4 个标识（`did_id` / `activitypub_id` / `nostr_pubkey` / `matrix_id`，至少填 1 个），可 `verify-identity` 标记已验证。
3. **内容质量评估（Phase 73）**：启发式打分（基线 0.5 + 长度因子 + 字符多样性因子 − 有害关键词惩罚），输出 `high / medium / low / harmful` 四级。
4. **翻译缓存（Phase 73）**：模拟翻译（输出 `[目标语言] 原文`），同 (text, sourceLang, targetLang) 命中缓存直接返回 `cached: true`；`detect-lang` 按 Unicode 区段启发式识别语言。

V1 表面带 SQLite 持久化（运行时注入共享 DB 时）；**V2 表面与 pfgov 覆盖层为纯进程内状态机**（桥注册/翻译运行/配额/自动翻转），不落库。

## 核心特性

- 🌐 **四协议目录**：`did` / `activitypub` / `nostr` / `matrix`（`PROTOCOL` 枚举，非法协议 fail-closed）
- ✉️ **跨协议消息记录**：converted/routed 标记 + 按协议过滤检索 + 统一格式快照
- 🪪 **身份映射 CRUD**：DID ↔ ActivityPub ↔ Nostr ↔ Matrix 任意子集组合，验证标记持久化
- 🏷️ **启发式内容质量**：长度/多样性加分、7 个有害关键词（spam/scam/phishing/malware/exploit/hack/injection）命中即封顶 0.2 分并标 `harmful`
- 🌍 **翻译缓存 + 语言检测**：缓存命中零成本；检测覆盖 zh/ja/ko/ar/ru/en（置信度 0.6-0.85）
- 🌉 **V2 桥成熟度状态机**：`provisional → active ⇄ degraded ⇄ deprecated → retired`（retired 终态），按 operator 限活跃桥数
- 🔄 **V2 翻译运行生命周期**：`queued → running → succeeded|failed|canceled`，按 bridge 限并发 RUNNING 数
- 🤖 **自动翻转批处理**：闲置桥批量 `retired`、卡死 RUNNING 翻译批量 `failed`
- 🏛️ **pfgov 治理覆盖层（iter23）**：profile（`pending→active⇄degraded→archived`）+ route（`queued→routing→routed|failed|cancelled`）双状态机，含配额与 auto-degrade/auto-fail
- 📊 **三层统计**：`stats`（消息/身份/质量/翻译汇总）、`stats-v2`（全枚举零初始化计数器）、`pfgov-gov-stats-v2`

## 命令参考

```bash
# 目录/枚举
cc fusion protocols | quality-levels [--json]
cc fusion bridge-maturities-v2 | translation-runs-v2 | pfgov-enums-v2

# Phase 72 — 跨协议消息
cc fusion send -s <protocol> -c <content> [-t <protocol>] [-f <senderId>] [--json]
cc fusion msg-show <id>  |  cc fusion messages [-p <protocol>] [--limit <n>]

# 身份映射
cc fusion map-identity [-d <did>] [-a <activitypub>] [-n <nostrPubkey>] [-m <matrixId>]
cc fusion identity <did>           # 按 DID 查映射
cc fusion identities [--limit <n>] | verify-identity <id>

# Phase 73 — 内容质量
cc fusion assess <content> [-i <contentId>] [--json]
cc fusion quality-show <id> | quality-scores [-l <level>] [--limit <n>] | quality-report

# Phase 73 — 翻译
cc fusion translate <text> -t <targetLang> [-s <sourceLang>] [--json]
cc fusion detect-lang <text> | translation-stats

cc fusion stats [--json]

# V2 — 桥/翻译状态机（进程内）
cc fusion register-bridge-v2 <id> -o <operator> -s <source> -t <target> [-i <initial>] [--metadata <json>]
cc fusion bridge-v2 <id> | list-bridges-v2 [-o ...] [-s ...]
cc fusion set-bridge-maturity-v2 <id> <status> [-r <reason>] [--metadata <json>]
cc fusion activate-bridge|degrade-bridge|deprecate-bridge|retire-bridge <id> [-r <reason>]
cc fusion touch-bridge-usage <id>
cc fusion enqueue-translation-v2 <id> -b <bridge> -t <lang> -x <text> [-s <lang>] [--metadata <json>]
cc fusion translation-v2 <id> | list-translations-v2 [-b ...] [-s ...]
cc fusion set-translation-status-v2 <id> <status> [-r <reason>] [--result <json>]
cc fusion start-translation|succeed-translation|fail-translation|cancel-translation <id>
cc fusion auto-retire-idle-bridges | auto-fail-stuck-running-translations | stats-v2

# V2 配额读写
cc fusion max-active-bridges-per-operator         # get（set- 前缀写）
cc fusion max-running-translations-per-bridge
cc fusion bridge-idle-ms | translation-stuck-ms
cc fusion active-bridge-count [-o <operator>] | running-translation-count [-b <bridge>]

# pfgov 治理覆盖层（iter23）
cc fusion pfgov-register-v2 <id> <owner> [--protocol <v>]
cc fusion pfgov-activate-v2|degrade-v2|archive-v2|touch-v2|get-v2 <id>  |  pfgov-list-v2
cc fusion pfgov-create-route-v2 <id> <profileId> [--destination <v>]
cc fusion pfgov-routing-route-v2|complete-route-v2|fail-route-v2|cancel-route-v2 <id>
cc fusion pfgov-config-v2 | pfgov-set-max-active-v2 <n> | pfgov-set-max-pending-v2 <n>
cc fusion pfgov-set-idle-ms-v2 <n> | pfgov-set-stuck-ms-v2 <n>
cc fusion pfgov-auto-degrade-idle-v2 | pfgov-auto-fail-stuck-v2 | pfgov-gov-stats-v2
```

## 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│ cc fusion <subcommand>      (commands/fusion.js)                   │
│   preAction hook: 有 root._db 时 ensureProtocolFusionTables(db)     │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                ┌──────────────▼──────────────────┐
                │ src/lib/protocol-fusion.js       │
                ├──────────────────────────────────┤
                │ V1 (Phase 72-73)                 │   SQLite 表（注入 db 时）:
                │  sendMessage / mapIdentity /     │──► unified_messages
                │  assessQuality / translate       │    identity_mappings
                │  → 内存 Map + db 双写             │    content_quality_scores
                │                                  │    translation_cache
                │ V2 (桥/翻译运行状态机)            │
                │  _bridgesV2/_translationsV2 Map  │   （V2 / pfgov: 纯进程内
                │  转移白名单 + operator/bridge 配额│     Map，不落库）
                │                                  │
                │ pfgov 覆盖层 (iter23)             │
                │  profile + route 双状态机         │
                └──────────────────────────────────┘
```

### 状态机（来自代码转移表）

```
桥 V2:        provisional → active|retired;  active → degraded|deprecated|retired;
              degraded → active|deprecated|retired;  deprecated → active|retired;
              retired=终态
翻译运行 V2:  queued → running|canceled|failed;  running → succeeded|failed|canceled
pfgov 档案:   pending → active|archived;  active → degraded|archived;
              degraded → active|archived;  archived=终态
pfgov 路由:   queued → routing|cancelled;  routing → routed|failed|cancelled
```

### 质量评分算法（assessQuality）

```
score = 0.5
      + 长度因子   (len>200: +0.2 | len>50: +0.1 | len<10: −0.2)
      + 多样性因子 (uniqueChars / min(len,100)) × 0.2
有害关键词命中 → score = min(score, 0.2)，level = harmful
否则: score ≥ 0.7 → high;  ≥ 0.4 → medium;  其余 → low
```

## 配置参考

均为代码内默认值，经对应 `set-*` 子命令在**当前进程内**修改（无配置文件/环境变量）：

| 配置项 | 默认值 | 读/写命令 |
|--------|--------|-----------|
| `PF_DEFAULT_MAX_ACTIVE_BRIDGES_PER_OPERATOR` | `10` | `max-active-bridges-per-operator` / `set-...` |
| `PF_DEFAULT_MAX_RUNNING_TRANSLATIONS_PER_BRIDGE` | `5` | `max-running-translations-per-bridge` / `set-...` |
| `PF_DEFAULT_BRIDGE_IDLE_MS` | `1209600000`（14 天） | `bridge-idle-ms` / `set-bridge-idle-ms` |
| `PF_DEFAULT_TRANSLATION_STUCK_MS` | `600000`（10 分钟） | `translation-stuck-ms` / `set-...` |
| pfgov maxActive / maxPending | `6` / `15` | `pfgov-config-v2` / `pfgov-set-max-*-v2` |
| pfgov idleMs / stuckMs | 30 天 / `60000`（60 秒） | `pfgov-set-idle-ms-v2` / `pfgov-set-stuck-ms-v2` |
| `translate -s` 源语言默认 | `auto` | — |
| `enqueue-translation-v2 -s` 默认 | `auto` | — |
| 质量等级阈值 | high ≥ 0.7 / medium ≥ 0.4 / harmful 封顶 0.2 | — |
| 有害关键词表 | spam, scam, phishing, malware, exploit, hack, injection | — |
| 各 list 命令 `--limit` | `50` | — |
| V1 持久化 DB | 运行时注入的共享 SQLite（`root._db`） | — |

## 性能指标

无独立基准（基准数据待补）；代码内的运行边界：

- **翻译卡死阈值**：RUNNING 超过 10 分钟（默认）可被 `auto-fail-stuck-running-translations` 批量翻 `failed`
- **桥闲置阈值**：`lastUsedAt` 超 14 天（默认）可被 `auto-retire-idle-bridges` 批量翻 `retired`；`touch-bridge-usage` 续命
- **pfgov 路由卡死阈值**：ROUTING 超 60 秒（默认）
- **配额**：每 operator 最多 10 个活跃桥（非 retired/provisional）；每 bridge 最多 5 个并发 RUNNING 翻译；pfgov 每 owner 6 个活跃档案 / 每 profile 15 条未完结路由 —— 超限直接抛错
- **翻译缓存**：命中 (text, sourceLang, targetLang) 三元组直接返回，不产生新记录；查找为缓存全扫 O(N)
- **语言检测置信度**：ja/zh/ko/ar 0.85、ru 0.8、拉丁默认 en 0.7
- **查询**：所有 list 走内存 Map 全扫 + 排序 + limit（默认 50）

## 测试覆盖

| 文件 | 用例数 | 覆盖 |
|------|--------|------|
| `packages/cli/__tests__/unit/protocol-fusion.test.js` | 93 | V1 四子系统（消息/身份/质量/翻译/stats）+ V2 桥注册/转移/过滤/翻译生命周期/auto-flip/stats |
| `packages/cli/__tests__/unit/lib/protocol-fusion-v2-iter23.test.js` | 44 | pfgov 覆盖层：枚举/配置/档案生命周期/活跃配额/路由生命周期/auto-flip/治理统计 |

```bash
cd packages/cli
npx vitest run __tests__/unit/protocol-fusion.test.js __tests__/unit/lib/protocol-fusion-v2-iter23.test.js
```

## 安全考虑

- **协议白名单 fail-closed**：源/目标协议不在 `did/activitypub/nostr/matrix` 即拒绝（`invalid_source_protocol` / `invalid_target_protocol`），不写任何数据
- **身份映射最小输入校验**：四个标识全空拒绝（`at_least_one_identity_required`）；`verified` 仅能由显式 `verify-identity` 置位
- **有害内容防漂白**：有害关键词命中后分数**封顶** 0.2 —— 长文本/高多样性加分无法把有害内容抬回 medium/high
- **内容哈希**：每次评估记录 sha256(content)，`content_id` 缺省取哈希前 16 位，可追溯重复内容
- **状态转移白名单**：V2 桥/翻译与 pfgov 全部查转移表，非法转移抛 `illegal transition A → B`；终态不可再转移
- **配额上限**：operator 桥数、bridge 并发翻译、pfgov 档案/路由均有硬上限（防单一主体打爆队列）
- **配置项正整数校验**：所有 `set-*` 经正整数检查，非法值抛错
- **⚠️ 模拟边界**：翻译是 `[lang] 前缀` 模拟（`model_used: "simulated"`）、质量评估是启发式而非 ML 分类器 —— **不可作为真实内容安全判定**；真实桥接/LLM 翻译在桌面端

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `Failed: invalid_source_protocol` | `-s` 不在四协议白名单 | `cc fusion protocols` 查合法值 |
| `Failed: at_least_one_identity_required` | `map-identity` 四个标识一个都没传 | 至少给 `-d/-a/-n/-m` 之一 |
| `Identity mapping not found.` | `identity <did>` 按 `did_id` 精确匹配查询 | 确认映射建立时填了 `-d`；按映射 ID 查请用 `--json` 列表筛选 |
| `assess` 给优质长文打了 harmful | 内容含有害关键词子串（如 "hack" 出现在 "hackathon"） | 启发式按子串匹配，属已知模拟行为；真实判定走桌面 ML 路径 |
| `Translation: [zh] hello` 而不是真翻译 | CLI 端翻译是模拟实现 | 预期行为；`translation-stats` 仍可验证缓存逻辑 |
| `operator <x> ... cap reached` / `bridge ... running cap` | V2 配额超限（桥 10 / 并发翻译 5） | 先 retire/完结释放，或 `set-max-*` 调大 |
| `illegal transition provisional → degraded` 等 | V2 转移表不允许 | 先 `activate-bridge` 再降级；`deprecated` 可经 `activate-bridge` 复活 |
| 重启后 V2 桥/翻译/pfgov 数据消失 | V2 与 pfgov 是**纯进程内**状态，不落 SQLite | 预期行为；持久对象用 V1 表面 |
| V1 数据也不持久 / 列表为空 | 当前调用环境未注入共享 DB（`root._db`），preAction 跳过建表 | 在已初始化 DB 的运行时（REPL/桌面联动）中使用 |
| `invalid JSON: ...` | `--metadata` / `--result` 不是合法 JSON | 注意 shell 引号转义 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/fusion.js` | `cc fusion` 全部子命令（含 `registerPfgovV2Commands` 覆盖层注册） |
| `packages/cli/src/lib/protocol-fusion.js` | V1 四子系统 + V2 状态机 + pfgov 覆盖层全部实现（1290 行） |
| `packages/cli/__tests__/unit/protocol-fusion.test.js` | 93 单元测试（MockDatabase） |
| `packages/cli/__tests__/unit/lib/protocol-fusion-v2-iter23.test.js` | 44 单元测试（pfgov） |
| `docs/design/modules/40_协议融合系统.md` | 桌面端设计文档（Phase 72-73 全量设计） |

## 使用示例

```bash
# 1) 发一条 DID → ActivityPub 跨协议消息
cc fusion send -s did -t activitypub -f did:cc:alice -c "hello fediverse"
#    → Converted: YES   Routed: YES
cc fusion messages -p activitypub

# 2) 建身份映射并验证
cc fusion map-identity -d did:cc:alice -a "@alice@mastodon.social" -n npub1xxx
cc fusion verify-identity <mappingId>
cc fusion identity did:cc:alice

# 3) 内容质量评估 + 报告
cc fusion assess "这是一段长而多样化的优质内容……" -i post-42
cc fusion assess "click here free scam offer"      # → harmful (≤0.2)
cc fusion quality-report

# 4) 翻译（第二次命中缓存）+ 语言检测
cc fusion translate "hello world" -t zh
cc fusion translate "hello world" -t zh    # → Cached: YES
cc fusion detect-lang "你好世界"            # → zh (0.85)

# 5) V2 桥 + 翻译运行状态机
cc fusion register-bridge-v2 br-1 -o op-A -s did -t matrix
cc fusion activate-bridge br-1
cc fusion enqueue-translation-v2 tr-1 -b br-1 -t zh -x "hello"
cc fusion start-translation tr-1 && cc fusion succeed-translation tr-1
cc fusion stats-v2

# 6) 运维批处理：清闲置桥 / 卡死翻译
cc fusion auto-retire-idle-bridges
cc fusion auto-fail-stuck-running-translations

# 7) pfgov 治理档案 + 路由
cc fusion pfgov-register-v2 prof-1 owner-A --protocol nostr
cc fusion pfgov-activate-v2 prof-1
cc fusion pfgov-create-route-v2 rt-1 prof-1 --destination matrix
cc fusion pfgov-routing-route-v2 rt-1 && cc fusion pfgov-complete-route-v2 rt-1
cc fusion pfgov-gov-stats-v2
```

## 相关文档

- [协议融合系统](./protocol-fusion.md)
- [AI 社交增强](./ai-social-enhancement.md)
- [社交 AI](./social-ai.md)
- [CLI ActivityPub（cc activitypub）](./cli-activitypub.md)
- [CLI Nostr（cc nostr）](./cli-nostr.md)
- [CLI Matrix（cc matrix）](./cli-matrix.md)
- [CLI DID 身份（cc did）](./cli-did.md)
