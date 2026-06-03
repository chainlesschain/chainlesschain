# Personal Data Hub — v0.1 Scaffold → v1 Fixture Pin Protocol

> **状态**：v0.1 设计稿（2026-05-21）。覆盖三个 outstanding 待 pin 的 scaffold：Doubao (Phase 10.4) / Toutiao (Phase 13.10) / Kuaishou (Phase 13.10)，以及未来任意新 v0.1 scaffold 的升级方法论。
>
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 路线图；姐妹 [`Adapter_AIChat_History.md`](./Adapter_AIChat_History.md)（含 §6.9 Doubao endpoint 蓝图）/ [`Adapter_Social_Messaging.md`](./Adapter_Social_Messaging.md)（含 §11 Toutiao + §12 Kuaishou conjectured schema）/ [`Adapter_WeChat_SQLCipher.md §17.5`](./Adapter_WeChat_SQLCipher.md)（其它 fixture 策略 anchor）。
>
> **为什么单独成稿**：三个 scaffold 各自的设计文档（§6.9 / §11 / §12）只描述"猜想的 endpoint + schema"，不讲"怎么把猜想确认为现实"。验真过程是工程量大、易踩坑、跨 adapter 高度共性的工作流 —— 不抽出来每个 fixture pin 都要重复想一遍。

---

## 1. 背景 & 范围

### 1.1 v0.1 scaffold 的设计契约

scaffold 阶段三大不能确定的事：

| 不确定项 | 实例（Doubao） | 实例（Toutiao） |
|---|---|---|
| **endpoint 路径** | `POST /samantha/conversation/list` 是不是真路径？官方可能拼成 `POST /api/v1/conversation/_list` | — |
| **字段名** | 是 `last_message_time` 还是 `last_message_at`？是 `bot_name` 还是 `name`？ | `read_history` 表是不是真存在？字段是 `read_time` / `view_time` / `created_at`？ |
| **JSON 结构层级** | `data.conversation_list` vs `data.list` vs `result.conversations` —— v0.1 已用 fallback 数组吸收，但真实字段仍未知 | (table 实在不实在；字段层级问题不存在 — 只字段名) |

v0.1 设计原则（已内置在三个 scaffold 里）：
- 用 **fallback 数组吸收** 字段层级（`_extractList` / `_extractConvList` / `_extractMsgList`）—— 三选一命中即可
- 用 **多 fallback 字段名** 处理字段命名（`row.title || row.article_title || "(no title)"`）
- 拒绝"猜深" —— 仅吸收 1-3 个候选，不要列 10 个 —— 否则真错时 silent 通过

scaffold 在 fallback 命中前提下能跑通 mock fixture E2E，但**不能**保证真账号 / 真设备 sync 出有意义数据。v1 fixture pin 就是把这些假设全部 collapse 为单一确认事实。

### 1.2 scope（本文档覆盖什么）

- 三种 scaffold 的统一 capture 流程（HAR 抓包 / Android SQLite 取库）
- field-rename 影响面（adapter / vendor-spec / 测试 fixture / 类型推导）
- 单测 → 集成 → 真账号 smoke 的 ladder
- v1 sign-off gate（什么时候可以把 `v0.1` 标签去掉）

**不覆盖**：
- 法律 / 合规审查（见 [WeChat_SQLCipher §14](./Adapter_WeChat_SQLCipher.md)）—— 本方法论假设 fixture pin 在合规允许的范围内
- adapter 内部 normalize 设计（每 adapter 已在自己的 design doc 里）

---

## 2. 三类 scaffold 分类

| 类 | 实例 | capture 工具 | 风险点 |
|---|---|---|---|
| **A. Web API (h5 cookie + JSON)** | Doubao (Phase 10.4)、+未来任何 AIChat / shopping / travel | Chrome DevTools HAR 导出 + 用户主动操作触发各接口 | API 路径 + 字段名 + 鉴权 cookie 名 + 分页机制 |
| **B. Android 本地 SQLite (明文)** | Toutiao 老版 / Kuaishou 老版 (Phase 13.10) | `adb pull` + `sqlite3 .schema` + 行抽样 | 表名 + 字段名 + 字段值编码（json/text/proto） |
| **C. Android 本地 SQLite (加密)** | WeChat (Phase 12.6+) / Toutiao 新版 / Kuaishou 新版 | A+B 串联：先用 frida/MD5 拿 key + 解密 + 同 B | 同 B + 密钥派生方法 |

**A vs B 选择规则**：scaffold doc 里的 endpoint URL 或 table 名是 capture 的起点 —— A 类已经有 URL，B 类已经有表名（虽不保证存在）。

> Doubao 是 A；Toutiao / Kuaishou 是 B（待评估，2024+ 版本可能升 C）。WeChat 已在 [WeChat_SQLCipher §18](./Adapter_WeChat_SQLCipher.md) 单独规划，本协议不覆盖 C 类的密钥派生细节。

---

## 3. 通用 fixture pin 流程

### 3.1 A 类（Web API）实施步骤

```
[Step 1] capture: Chrome DevTools HAR 录制
  ├─ 登录目标站点（vendor 的 h5 入口，如 https://www.doubao.com/chat/）
  ├─ DevTools → Network → 清屏 → 录制
  ├─ 主动触发：
  │   - 打开对话列表 → 抓 listConversations endpoint
  │   - 进入某对话 → 抓 listMessages endpoint
  │   - 滚动加载更多 → 抓 cursor pagination 行为
  │   - 删除一条对话 → 抓 ws / mutation API（v1 不一定需要，但记下来）
  └─ 导出 HAR (Save all as HAR)
  ↓
[Step 2] sanitize: 去 cookie token / Authorization / Set-Cookie
  ├─ 用 `jq` 或 capacities/scripts/sanitize-har.js（共享脚本，TBD）替换 token 为 "***"
  └─ 留下 URL + method + response body schema + 关键 header（非鉴权）
  ↓
[Step 3] diff vs scaffold
  ├─ 对每个抓到的 endpoint，与 scaffold 中 URL 对照
  ├─ field-by-field 对照 response body —— 列出 scaffold 猜想 vs 真实命名 mismatch
  └─ 输出 `field-rename-map.md`（per vendor）
  ↓
[Step 3.5] code change
  ├─ 主代码：替换 fallback chain 命中的字段名为唯一字段名
  │   - 保留 1 个 fallback（防小版本飘移），剩余删掉
  │   - `_extractList` 等只留命中的层级
  ├─ vendor-spec：endpoint 路径替为确认值
  └─ rateLimits 重测：用 capture 看每秒触发次数下 server 响应是否变化
  ↓
[Step 4] fixture file
  ├─ `__tests__/fixtures/<vendor>/conversations-page1.json`（HAR 抽出来的真 response，sanitized）
  ├─ `__tests__/fixtures/<vendor>/messages-conv-<id>.json`
  └─ Versioned: `<vendor>/2026-05-har.snapshot.json`（schema 飘移时新版本不覆盖旧版本）
  ↓
[Step 5] test update
  ├─ scaffold tests 改为 fixture-driven（之前用 hardcoded routes，现在用 fs.readFileSync(fixture)）
  ├─ 加 round-trip：fixture → listConversations → assert ≥1 conv with key 字段
  └─ 加 schema regression：fixture file 头加 ASSERTED_SCHEMA_VERSION = "v1.0.0"，testing helper compare
  ↓
[Step 6] 真账号 smoke
  ├─ 在 dev 机器上用真账号跑 `cc hub sync-adapter <name>`
  ├─ 检查 vault 里 ingested event 数 ≥ 1 且 content 非空
  └─ 检查 schema 字段未触发 NormalizeError （fallback 命中代表 schema 飘移）
  ↓
[Step 7] sign-off：去掉 v0.1 标签
  ├─ adapter `version = "0.5.0"` (per [bilibili reference, 0.1 → 0.5 jump](./Adapter_Social_Messaging.md))
  ├─ docs-site personal-data-hub.md 状态从 🚧 改 ✅
  ├─ MEMORY.md vendor entry 改 "fixture pinned <date>"
  └─ Phase 历史 +1 row
```

### 3.2 B 类（明文 Android SQLite）实施步骤

差异点（与 A 类）：

```
[Step 1'] capture: adb pull database
  ├─ 测设备：rooted or developer-mode Xiaomi 24115RA8EC（Plan A 真机闭环验证机）
  ├─ 用 dummy 账号产生数据（看 1-3 篇文章 / 视频 / 搜 2-3 个词）
  ├─ `adb shell` → `su` → `cp /data/data/<package>/databases/<file>.db /sdcard/` → `adb pull`
  └─ **每次抓**：注明 app 版本号（`adb shell dumpsys package <pkg> | grep versionName`）
  ↓
[Step 2'] schema probe
  ├─ `sqlite3 <file>.db ".tables"` → 与 scaffold 猜想表名对照
  ├─ `sqlite3 <file>.db ".schema <table>"` → 字段名 + 类型
  ├─ `sqlite3 <file>.db "SELECT * FROM <table> LIMIT 5"` → 真值采样
  └─ 输出 `schema-snapshot.md`
  ↓
[Step 3'] diff vs scaffold（同 A 类 Step 3）
  ├─ 表名 vs scaffold 假设
  ├─ 字段名 vs scaffold fallback chain
  └─ 真值数据形态（int unix-epoch / "YYYY-MM-DD HH:MM:SS" / ISO8601）
```

剩余 Step 3.5 / 4 / 5 / 6 / 7 与 A 类同。fixture 是 `.db` 副本（脱敏，删 PII 列）放 `__tests__/fixtures/<adapter>/<version>.db`（git-lfs 不接，体积大用 sqlite dump txt）。

### 3.3 C 类（加密 Android SQLite）

走 [WeChat_SQLCipher §18](./Adapter_WeChat_SQLCipher.md) 的 KeyProvider DI + Frida agent 路径先解密，解出来再走 B 类。

> Toutiao / Kuaishou 2024+ 版本是否加密，schema probe 阶段才能确认。若加密，需先评估是否值得引入 Frida 依赖 —— Toutiao 加密版可能就 defer 到 v2，先支持 7.x / 老版用户。

---

## 4. field-rename-map.md 模板

每个 adapter pin 时落一份，便于回溯 + 给后续 schema 飘移做基线。

```markdown
# <Vendor> Field Rename Map — Phase X.Y Pin

> **HAR / DB 抓取时间**：YYYY-MM-DD
> **目标 app 版本**：vX.Y.Z
> **抓取设备 / 账号**：(占位)

## conversations endpoint response

| scaffold 猜想 | 真实字段名 | 类型 | 备注 |
|---|---|---|---|
| `data.conversation_list[].name` | `data.conversations[].title` | string | layer changed `conversation_list` → `conversations` |
| `data.conversation_list[].bot_name` | `data.conversations[].character_name` | string | 命名不同 |
| `data.conversation_list[].create_time` | `data.conversations[].create_at` | int (s) | 单位仍是 seconds |
| `data.has_more` | `data.hasMore` | bool | camelCase |
| `data.cursor` | `data.next_offset` | string | 不是 cursor，是 offset 字符串 |

## messages endpoint response

| scaffold 猜想 | 真实字段名 | 类型 | 备注 |
| `data.message_list[].sender_type` | `data.messages[].user_role` | enum | 1/2/3 → "user"/"bot"/"system" |
| ... | ... | ... | ... |

## rate limit observation

scaffold 写 `{ perMinute: 20, minIntervalMs: 2000 }`. 实测 60 req/min 不被限，10/min 触发 429 退避 5s — 改为 `{ perMinute: 40, minIntervalMs: 1500 }`.

## anti-bot 信号

- request 必带 `X-Csrf-Token` cookie 复制到 header（scaffold 未声明）
- User-Agent 必须 mobile（PC UA 触发 captcha）
- 全部请求需 Referer: https://www.doubao.com/chat/

## 后续 schema 飘移监测

- 在测试夹具头部加 `ASSERTED_AT: "2026-MM-DD"` 和 `APP_VERSION: "vX.Y.Z"`
- CI 加 monthly cron task：拉一次真账号，diff fixture，发 issue if changed
```

---

## 5. 测试 ladder

| 层 | 名 | 是什么 | sign-off 必过？ |
|---|---|---|---|
| 1 | scaffold unit test | mock route / mock SQL driver | ✅ scaffold 阶段已过 |
| 2 | fixture-driven test | 用真 fixture 文件 replay capture | **v1 必过**；replaces scaffold mock |
| 3 | adapter integration | 自己内部 sync → vault → query roundtrip | ✅ v1 必过 |
| 4 | cross-source | 与 EntityResolver + 至少一个其它 adapter 合并 | optional，但强推 |
| 5 | 真账号 smoke | dev 设备实跑一次完整 sync | **v1 必过**（不进 CI，dev box 手工跑） |
| 6 | regression cron | monthly 真账号跑一次，diff fixture | post-v1 维护 |

### 5.1 fixture-driven test 模板（替换 hardcoded routes）

```js
// scaffold 旧
const fixture = makeRoutedFetch([
  ["/samantha/user/info", makeResponse({ body: { code: 0, data: { user_id: "db-u1" } } })],
  // ...
]);

// v1 新
const har = require("./fixtures/doubao/2026-05-har.snapshot.json");
const fixture = makeRoutedFetchFromHar(har);
// makeRoutedFetchFromHar 把 HAR entries 转 makeRoutedFetch 兼容形式
```

`makeRoutedFetchFromHar` 是共享 helper，TBD 放 `__tests__/_helpers/har-routing.js`。

### 5.2 真账号 smoke 命令

```bash
# A 类（vendor 走 cc ui 或 cc hub）
$ cc hub sync-adapter <name>          # 真 cookie 已 register 过
$ cc hub query-events --adapter <name> --limit 10
# expect: ≥ 5 events，content.text 真值非空

# B 类（device-pull）
$ cc hub sync-adapter <name>          # 提前 adb pull 好 DB 到 dbPath
$ cc hub query-events --adapter <name> --subtype browse
```

---

## 6. v1 sign-off gate（清单）

把 v0.1 标签去掉前必须全过：

- [ ] HAR / DB capture 完成 + sanitized fixture 已 commit
- [ ] `field-rename-map.md` 已写 + reviewed
- [ ] scaffold adapter 代码 fallback chain 已 collapse 为唯一字段名（保留 1 alt 应对小版本飘）
- [ ] fixture-driven 单测全绿（replace scaffold mock）
- [ ] 真账号 / 真设备 sync ≥ 5 个事件并 normalize 成功
- [ ] adapter `version` 0.1.0 → 0.5.0（与 bilibili 等价 maturity）
- [ ] `docs-site/docs/chainlesschain/personal-data-hub.md` 状态符号 🚧 → ✅
- [ ] 该 vendor 在 MEMORY.md 加一行 "pinned <date>"（如适用）
- [ ] CHANGELOG 标 `feat(hub): Phase X.Y — <vendor> fixture pinned (v0.1 → v0.5)`
- [ ] Phase 历史表 +1 row

> 不要把"已通过 unit test"和"v1 sign-off"等同。v0.1 scaffold 自带 unit test 已绿（mock 路径），通过测试**不**代表 schema 是对的。Sign-off 必须有真账号 smoke 收尾。

---

## 7. Forward-looking Traps

| # | Trap | 来源 | 修法 |
|---|---|---|---|
| T1 | scaffold fallback chain 太广 → 命中 wrong field 仍 silent 跑通 | "data.list" 既是 conversations 也是 messages，会路由错 | fallback 限 1-3 个；命中后 v1 必 collapse |
| T2 | HAR 抓时漏触发某 endpoint → fixture 不完整 → v1 上线后某场景才发现 | DevTools 录的不是完整用户路径 | capture checklist 包：登录 + list + open + scroll + delete |
| T3 | sanitize 时把关键字段（如 user_id）也擦了 | `replace` 正则太宽 | sanitize 脚本只擦已知 token / Authorization / Set-Cookie，其它字段保留 |
| T4 | fixture 体积过大让 git-lfs 抱怨 | DB 副本 50MB+ 不适合直接进 git | sqlite3 `.dump > schema-and-100-rows.sql` 仅留 schema + 100 sample row，体积 KB 级 |
| T5 | 真账号 smoke 用主账号 → PII 风险 | 用户隐私 | 三方约定：smoke 必须用 dev 测试账号（QQ 新申请 / 测试号），不动主账号；fixture sanitize 必去 PII |
| T6 | app 版本升级 schema 默默变 → fixture 跟 prod 不一致 | 静默 break | regression cron 每月跑 + ASSERTED_AT timestamp，>= 3 月旧 fixture 标 stale |
| T7 | scaffold 把 fallback 数量写成 0 等于真 break 时直接抛 | "我已经 pin 完了所以删干净" | 保留至少 1 个 fallback。"已 pin" 不等于"永远对" |
| T8 | fixture-driven test 写得太 brittle —— `expect(out[0].id === "exact-string-from-fixture")` | fixture 内容 commit 后被 rotate fixture 时 test 全炸 | 断言用 shape 不用 value：`expect(out[0]).toMatchObject({ id: expect.any(String), title: expect.any(String) })` |
| T9 | rate limit pin 完后 server 又改 | vendor 调 throttle policy | rate limit 错误 (429) 已被 HttpClient 兜底为退避 + 重试，影响 throughput 不影响 correctness；下次 cron 抓时刷新 |
| T10 | 抓的 HAR 含 EU-only 字段 / CN-only 字段 | 跨区域 schema 不同 | smoke 用 CN 域名 / CN 测试账号；fixture 头注明 region |

---

## 8. 当前 outstanding pin 任务（2026-05-21 snapshot）

| Adapter | Phase | 类 | 阻塞 | 工期 |
|---|---|---|---|---|
| Doubao | 10.4 | A | 需 doubao.com 账号 + HAR 录制 | ~0.5d |
| Toutiao | 13.10 | B / C 待评估 | 需 Xiaomi 24115RA8EC + dummy 头条账号 | 1d |
| Kuaishou | 13.10 | B / C 待评估 | 需 Xiaomi 24115RA8EC + dummy 快手账号 | 1d |

> 三项可并行；总不到 3 d 真人 time。但 **WeChat** (12.6+/12.9) 走自己的 §18 设计，**不**走本协议。

---

## 9. 与现有文档的关系

- 本协议是**方法论**；具体 endpoint / schema 留在 per-adapter design doc：
  - Doubao endpoint 蓝图 → [`Adapter_AIChat_History.md §6.9`](./Adapter_AIChat_History.md)
  - Toutiao / Kuaishou conjectured schema → [`Adapter_Social_Messaging.md §11/§12`](./Adapter_Social_Messaging.md)
  - WeChat KeyProvider DI（C 类的密钥派生） → [`Adapter_WeChat_SQLCipher.md §18`](./Adapter_WeChat_SQLCipher.md)
- v1 完成时 update：
  - per-adapter design doc 头部状态标签
  - personal-data-hub.md 总览表
  - CHANGELOG + MEMORY.md
- 真账号 smoke 命令模板放在 [`Personal_Data_Hub_E2E_Runbook.md`](./Personal_Data_Hub_E2E_Runbook.md) 配套维护
