# Personal Data Hub — Vault Browser (Phase 16)

> **状态**：v1.0 已 land（2026-05-24）。7 个独立 commit `801a95969..839e534c5`。**桌面 + Android 双端**「采集到的数据可视化展示入口」， 用户首次能主动浏览 vault 里所有 events，而不只能通过"问 AI"间接看到 RAG 召回片段。
>
> **关联文档**：[`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §4.2 (Hub core tables) + §11.1 (data lineage UX)。
>
> **关联 trap memo**（改前必看）：[`pdh_llm_routing_split_trap.md`](../../内存/) (category vs subtype) / [`compose_lazycolumn_key_burst_collision.md`](../../内存/) (LazyColumn burst keys) / [`android_mockk_viewmodel_androidtest_initializer_trap.md`](../../内存/) (stateful wrapper + stateless content)。

---

## 1. 背景

P0–P5 之前，用户已采集的 events 只能通过两种间接方式看到：

1. **桌面 PersonalDataHub.vue ask box** → ask AI → 答案附带 citations → 点 citation 看 EventDetail drawer（**单条**，且需要先问对问题）
2. **Android HubLocal "看采集到的" 按钮**（VaultPreviewSheet）→ bottom sheet 显示某 adapter 最近 10 条 raw events（**只有部分 tab 的卡片有，5 个 tab 中 4 个没有这个按钮**）

用户反馈："安卓端和桌面端都缺少采集上来数据的可视化展示  需要有可视化展示入口"。

## 2. 目标

提供**主动浏览**入口：

- 按数据类型分类（社交聊天 / 内容平台 / 邮件 / 支付订单 / 出行 / 系统数据 / AI 对话）
- 全文检索（CJK 子串）
- 按 adapter / 时间窗口筛选
- 差异化呈现（聊天气泡 vs 订单表 vs 出行时间线 vs 邮件列表）
- 客户端导出（JSON / NDJSON / CSV）

**非目标（v1.0 不做）**：
- 编辑 / 删除单条 event（read-only，破坏性操作走 `cc hub destroy`）
- 全文搜索高级语法（OR / AND / NEAR — 当前是 phrase-match）
- 跨表 join 查询（event ↔ person / place 联表浏览）
- 真机性能 benchmark（CI 待补，<500ms first page 是设计目标）

---

## 3. 关键设计决策

### D1. FTS5 contentless + trigram tokenizer

| 选项 | 取舍 |
|---|---|
| ✅ **SQLite FTS5 external-content + trigram** | BM25 排名 / CJK 子串匹配 / 完全离线 / 比 LIKE 快 10-100×。`content='events'` 模式只存倒排，events 仍是 source-of-truth。3 个 trigger (AI/AU/AD) 保持同步。 |
| ❌ LIKE '%x%' on payload JSON | 100k+ rows 全表扫描；无排名；CJK 分词错（"%李%" 匹配 base64 内 "李"）；fallback only |
| ❌ Qdrant 向量 | 语义检索（用户要"支付宝订单 2024-03"是精确子串）；增加 sidecar 依赖；语义搜索 v2 再说 |

**Fallback**：migration 时探测 FTS5 + trigram 编译可用性（CREATE VIRTUAL TABLE try/catch），若不可用记录 `_meta.fts_mode='like'`，runtime 透明降级到 LIKE 5-列 OR。

**Trigger 写法**（external-content idiom）：
```sql
CREATE TRIGGER events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, subtype, content_text, actor, place, extra_text)
  VALUES (new.rowid, new.subtype, new.content, new.actor, new.place, new.extra);
END;
-- DELETE / UPDATE 类似，UPDATE 是 delete-then-insert 模式
```

**CJK trigram min length = 3 字符**。Sub-3 query 在 FTS5 模式被 silently drop，runtime 返回 `shortQuery: true`，UI 提示"关键词需至少 3 字"。

### D2. 两轴分类：Category 主侧栏 × Adapter 副 chip

7 个稳定 bucket + 1 兜底（other）：

| Category | Label | Adapter 匹配规则 |
|---|---|---|
| `chat` | 社交聊天 | `wechat` exact / `messaging-*` prefix |
| `social` | 内容平台 | `social-*` |
| `email` | 邮件 | `email-*` |
| `shopping` | 支付订单 | `shopping-*` / `alipay-*` |
| `travel` | 出行 | `travel-*` |
| `system` | 系统数据 | `system-data*` / `browser-*` |
| `ai-chat` | AI 对话 | `ai-chat-*` |
| `other` | 其他 | NOT-IN-any-prefix |

**单一真相源**：`packages/personal-data-hub/lib/categories.js#PREFIX_RULES`。桌面 (`packages/web-panel/src/utils/pdhCategories.js`) + Android (`HubBrowserRenderers.kt#PREFIX_MAP`) 是手动 mirror — 加新 prefix 必须 3 处同时改 + 加测试。

**`category="other"` 反向匹配**：因为没有 prefix 规则映射到 other，反着展开为 NOT-LIKE-any-prefix 的 AND 条件。

### D3. Category-keyed renderer dispatcher（不是 subtype）

5 种 renderer：

| Category | Renderer | 布局 |
|---|---|---|
| chat / ai-chat | ChatBubbleRenderer | 左右气泡，actor 含 "_self" / "me" 右对齐 |
| shopping | OrderTableRenderer | 商户/商品/金额/单号/状态 表格行 |
| travel | TimelineRenderer | 时间线 + from→to + 车次/航班 chip |
| email | EmailListRenderer | from/subject/snippet + 附件计数 |
| social / system / other | GenericCardRenderer | 通用卡（兜底） |

**派发 key = category（稳定）而非 subtype（漂移快）**。这条规则来自 trap memo `pdh_llm_routing_split_trap`：subtype 名字会随 adapter 重构变（如 `chat.message` → `messaging.chat.text`），而 category 是 user-visible 桶，几乎不变。Subtype 内部差异（chat.message vs chat.image）由 renderer 内部 if/else 处理，不分发到不同 component。

### D4. 游标分页 `(occurred_at DESC, id DESC)`

| 选项 | 取舍 |
|---|---|
| ✅ **游标 `{occurredAt, id}`** | 稳定（新事件只在 page 1 refresh 时出现） / SQLite tuple 比较原生支持 / 10k+ 行不退化 |
| ❌ OFFSET / LIMIT | offset 大了 walk index 慢；并发 insert 会 row 错位 |

实现：`WHERE (occurred_at, e.id) < (@cursorAt, @cursorId) ORDER BY occurred_at DESC, e.id DESC LIMIT @limit`。SQL 用 tuple 比较，复合索引由 `idx_events_occurred` + PRIMARY KEY 自然支持。

**Page size = 50**，max = 500。Backend 返回 +1 row 检测 nextCursor 是否存在。

### D5. Race-resolution token

桌面 Pinia store + Android ViewModel 都用 `_searchToken` 计数器。每次 search() 自增；slow response 返回时若 token != 当前，silently drop（不覆盖 newer results）。

**为什么需要**：300ms debounce + 用户连打三个字 = 三次请求 in-flight，第一个响应最慢的话会盖掉最后一个。

---

## 4. 实现总览

### 4.1 后端（packages/personal-data-hub）

```
lib/
├── categories.js                  # PREFIX_RULES + getCategory()
├── migrations.js                  # migration v3 (FTS5 + 3 triggers + backfill + getFtsMode)
└── vault.js                       # searchEvents / facetCounts / ftsMode / _categoryToWhere / _quoteFtsQuery
```

**Public API**:
```js
vault.searchEvents({ q, adapter, category, subtype, since, until, cursor, limit })
  → { rows: Event[], nextCursor: {occurredAt,id}|null, mode, shortQuery }
vault.facetCounts({ q, since, until })
  → { byCategory, byAdapter, bySubtype, total, mode, shortQuery }
vault.ftsMode() → 'fts5' | 'like'
```

**Test coverage**:
- `__tests__/categories.test.js` — 36 tests (prefix mapping, fallback to "other", `groupByCategory`)
- `__tests__/vault-search-helpers.test.js` — 13 tests (pure-JS SQL builder, FTS5 escape)
- `__tests__/vault-search.test.js` — 27 integration tests (FTS5 migration + search + cursor + triggers + category filter; **requires native bs3mc binding**; CI plays natively, Win local needs `scripts/run-native-tests-sandbox.sh` due to Electron 39 ABI 140 root binding — see §5 L1)
- `scripts/run-native-tests-sandbox.sh` — sandbox runner for the local FTS5 native suite

### 4.2 协议层

| Layer | 文件 | 暴露 |
|---|---|---|
| CLI | `packages/cli/src/commands/hub.js#cmdSearchEvents` / `cmdFacetCounts` | `cc hub search` / `cc hub facet-counts` |
| WS | `packages/cli/src/gateways/ws/personal-data-hub-protocol.js` | `personal-data-hub.search-events` / `.facet-counts` |
| Composable | `packages/web-panel/src/composables/usePersonalDataHub.js` | `searchEvents(filters)` / `facetCounts(filters)` |

### 4.3 桌面 UI

```
packages/web-panel/src/
├── utils/pdhCategories.js              # LABELS + ICONS + getCategory()
├── utils/pdhExport.js                  # eventsToJson / NDJSON / CSV + downloadAs
├── stores/pdhBrowser.js                # Pinia store: filters / results / cursor / facets / debounce / race-token
├── components/pdh/
│   ├── CategorySidebar.vue             # 8 类目侧栏 + badge counts
│   ├── SearchFilterBar.vue             # keyword + adapter chip + date range
│   ├── ExportDropdown.vue              # JSON / NDJSON / CSV
│   └── renderers/
│       ├── RendererDispatcher.vue      # async-imports 5 renderer chunks
│       ├── ChatBubbleRenderer.vue
│       ├── OrderTableRenderer.vue
│       ├── TimelineRenderer.vue
│       ├── EmailListRenderer.vue
│       └── GenericCardRenderer.vue
├── views/PdhVaultBrowser.vue           # 主视图
└── router/index.js                     # /personal-data-hub/browser

components/AppLayout.vue                # 侧栏菜单 "数据浏览器" 入口
```

**Test coverage**:
- `__tests__/unit/pdhCategories-getCategory.test.js` — 19 tests
- `__tests__/unit/pdhBrowser-store.test.js` — 10 tests (debounce / race / facets / loadMore / reset / error)
- `__tests__/unit/usePersonalDataHub-search.test.js` — 4 tests (WS topic routing)
- `__tests__/unit/pdhExport.test.js` — 11 tests (3 formats + RFC-4180 escaping + filename)
- `__tests__/unit/PdhVaultBrowser.test.js` — 12 tests (view-level integration via @pinia/testing + vue-test-utils, mocked WS)
- `__tests__/e2e/panel.test.js` — `/personal-data-hub` + `/personal-data-hub/browser` SPA fallback 200

### 4.4 Android UI

```
android-app/app/src/main/java/com/chainlesschain/android/
├── pdh/LocalCcRunner.kt                       # +searchEvents / +facetCounts / +_runCcJson helper
└── remote/ui/personalDataHub/
    ├── PersonalDataHubScreen.kt               # tab list 5→6, new tab "数据浏览" index 5
    ├── HubBrowserViewModel.kt                 # MVI state, debounce, race-token
    ├── HubBrowserScreen.kt                    # stateful wrapper + stateless Content (mockk trap)
    └── HubBrowserRenderers.kt                 # categoryFor() dispatcher + 5 Composable renderers
```

**Test coverage**:
- `app/src/test/.../HubBrowserViewModelTest.kt` — 7 JVM unit tests via mockk-android
- `app/src/test/.../HubBrowserRenderersTest.kt` — 10 categoryFor() dispatcher tests

---

## 5. 已知限制 / 后续

| # | 项 | 状态 / 后续 |
|---|---|---|
| L1 ✅ 已解 | FTS5 native integration test 在 Win Node 22 跑不动 | **真正原因：root node_modules bs3mc 是给 Electron 39 编的 ABI 140**，Node 任何版本（24=ABI 137, 25=ABI 141）都加载不了；纯 Node rebuild 又被 desktop-app-vue dev server 占用文件 EBUSY/EPERM。**修法**：`bash packages/personal-data-hub/scripts/run-native-tests-sandbox.sh` — 在 $TMPDIR/pdh-fts5-sandbox/ 独立 `npm install` 给当前 Node ABI 编一份独立 bs3mc，跑 27/27 PASS（21s）。脚本 idempotent，第二次只复制源不重装。CI Linux 不需这步（无 Electron 占用）。 |
| L2 | Android Compose UI 真机渲染测试 | androidTest 已 stateful/stateless 拆分 ready，需要真机或 API 30+ emulator（Win dev box 无 device），待 CI Android emulator job 启用 |
| L3 | 真机 latency benchmark (≥10k events, <500ms first page) | 同 L2 |
| L4 | 子表 (persons / items / places) 全文检索 | v1.0 仅 events_fts；其他表数据量小、用户主要按事件浏览。如需要可加 persons_fts / items_fts，模式相同 |
| L5 | Highlight 命中关键词 | FTS5 `highlight()` 函数可拿到 `<mark>...</mark>` 包裹的片段；v1.0 没接，留 v1.1 |
| L6 | Adapter chip 在选中 category 后未过滤 | 当前 SearchFilterBar 的 adapter 下拉显示**所有** facets.byAdapter（across categories），应该按 selected category 过滤。小 UX bug，v1.1 修 |

---

## 6. Commit 链

```
839e534c5 feat(pdh-browser): export current view as JSON / NDJSON / CSV
7b9815381 feat(pdh-browser): 4 category-keyed renderers (chat/order/timeline/email) both shells
b4fa54b6d feat(pdh-android): vault browser tab + LocalCcRunner.searchEvents
3aebbbffe feat(desktop): PDH Vault Browser view + Pinia store + sidebar/filter/renderer
856312de8 feat(ws): personal-data-hub search-events + facet-counts topics + composable
c8142e573 feat(pdh): vault FTS5 search + facetCounts API (migration v3)
801a95969 feat(pdh): add shared adapter→category taxonomy
```

每个 commit 独立可 revert + 自带测试。详见各 commit message。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 背景」。Vault Browser（Phase 16，v1.0 已 land）是桌面 + Android 双端的"采集数据可视化展示入口"——用户首次能主动浏览 vault 里所有 events，而非只能通过"问 AI"间接看 RAG 召回片段。

### 2. 核心特性

桌面 + Android 双端；vault events 浏览；FTS5 全文搜索 + facetCounts；adapter→category taxonomy；sidebar/filter/renderer。

### 3. 系统架构

见正文「4. 实现总览」；Pinia store + WS search-events/facet-counts topics + PDH FTS5（migration v3）。

### 4. 系统定位

PDH 的**vault 数据可视化浏览入口**（Phase 16）。

### 5. 核心功能

见正文：events 列表 / 过滤 / 全文搜索 / facet 计数 / category 分类。

### 6. 技术架构

桌面 Vue + Pinia store；WS `personal-data-hub.search-events` / `facet-counts`；vault FTS5 search + facetCounts API。

### 7. 系统特点

7 独立 commit（各自可 revert + 自带测试）；双端一致 taxonomy。

### 8. 应用场景

用户主动浏览 / 搜索 vault 中所有采集 events。

### 9. 竞品对比

vs 仅"问 AI"间接看 RAG 片段——本功能让用户直接浏览全量 events（见正文背景）。

### 10. 配置参考

adapter→category taxonomy（shared）；FTS5 migration v3。

### 11. 性能指标

FTS5 全文搜索 + facetCounts（索引查询）。

### 12. 测试覆盖

每个 commit 自带测试（见正文 Commit 链 `801a95969..839e534c5`）。

### 13. 安全考虑

vault events 高敏感；本地浏览不外发；SQLCipher 加密存储。

### 14. 故障排除

搜索无结果 / facet 不准 → 检查 FTS5 索引（migration v3）。

### 15. 关键文件

桌面 Vault Browser view + Pinia store；WS search-events/facet-counts；PDH vault FTS5 + facetCounts API。

### 16. 使用示例

见正文实现总览（浏览 / 搜索 / 过滤）。

### 17. 相关文档

`Personal_Data_Hub_Architecture.md`；各 `Adapter_*.md`（数据源）。
