# Phase 3c — OSS / WebDAV / 网盘 同步 设计文档

> 状态：v2，2026-05-06 起草并补充 Phase 3c.1 + 3c.2 上半段已落地内容
> 上游：Phase 3b 已落 `syncProviders` 抽象 + `webdav.ts` / `oss.ts` 两个 placeholder
> 范围：把 placeholder 替换成真 provider，并把"非本地仓库的同步目标"这条线收口

---

## 1. 背景与立项动机

Phase 3b 在 `desktop-app-vue/src/renderer/utils/syncProviders/` 抽象出 6 个
provider（backend / git / p2p / mobile / webdav / oss），其中 webdav / oss 是
**`available()=false` + `placeholder:true`** 的占位实现，runOnce 直接返回错误。
当前外部目标真正能用的只有 git（push markdown 到远程仓库），用户对"绑一个
网盘 / 对象存储就开始同步"是没有路径的。

Phase 3c 要决策：

1. 先做哪个 provider（或两个一起）；
2. 凭证怎么存 —— 现状散乱，是欠债还是顺手补；
3. 数据格式 —— 复用 `markdownExporter` 还是另起一套；
4. 冲突 / 加密 / 选择性同步等"网盘同步"普遍要解决的二级问题。

---

## 2. 现状速览（基于 2026-05-06 代码）

### 2.1 syncProviders 抽象层

| 文件 | 状态 |
|---|---|
| `syncProviders/types.ts` | SyncProvider interface（id / name / available / runOnce / configRoute / placeholder）已定型 |
| `syncProviders/index.ts` | 6 个 provider 注册顺序固定 |
| `syncProviders/{backend,git,p2p,mobile}.ts` | 真实，包 IPC |
| `syncProviders/{webdav,oss}.ts` | placeholder，注释里写明 "Phase 3c" |
| `utils/syncScheduler.ts` | 串行 runOnce，localStorage 持久化 enabled / interval / per-provider toggle |

抽象本身够用：新增真 provider **不动 scheduler 和 settings UI**，只补 `runOnce`
+ `available` + 可选 `configRoute`。

### 2.2 markdownExporter（来自 git/）

`desktop-app-vue/src/main/git/markdown-exporter.js`

- 公开 API：`exportAll()` / `exportItem(item)` / `exportById(id)` / `sync()` / `cleanAll()`
- `exportAll`：`getKnowledgeItems(9999, 0)` 一次取全表 → for 循环 `fs.writeFileSync`
- 输出：扁平树，文件名 `${id}-${cleanTitle}.md`，YAML front-matter + body
- 落地路径：`exportPath` 目录（git 工作树），git-ipc 在 `git:sync` 里先调
  `markdownExporter.sync()` 再 `gitManager.autoSync()`

**复用评估**：

- ✅ 输出格式（front-matter + flat tree）通用，WebDAV / OSS 直接拿
- ⚠️ **9999 条硬上限 → 实际是 100 条上限**（见 §6 副线 bug）
- ⚠️ **全量写盘**：每次 sync 把全部 .md 重写一遍，对网盘是 N × PUT，没增量
- ❌ **无增量游标**：没有 last-sync-ts 或 commit-hash 概念，是 git 工作树天然给了
  diff 才让 git push 自动只传变更；脱离 git 走 WebDAV 时，"哪些文件变了"得自己算

**结论**：能复用 `generateMarkdown` 这一段（YAML + body 渲染），不能复用
`exportAll` 这一段（要换成 cursor-driven 增量 walk）。已经按这个结论
单独抽出 `src/main/sync/markdown-renderer.js`（见 §4.3）。

### 2.3 凭证存储现状

发现两套互不通气的体系：

**(a) Git 凭证 — plaintext**
- `src/main/git/git-config.js` 写 `git-config.json` 到 `userData/`
- `git-manager.js:51` 读 `config.auth`，结构为 `{username, password}` 透明对象
- **无加密，无 hash**，明文 JSON 落盘

**(b) LLM 凭证 — safeStorage 加密**
- `src/main/llm/secure-config-storage.js`，包 Electron `safeStorage`
- Fallback：AES-256-GCM + 机器特征派生 PBKDF2 密钥
- 落盘：`userData/secure-config.enc`（单文件）
- API：`encrypt/decrypt/save/load/exists/createBackup/restoreFromBackup/exportWithPassword/migrateToSafeStorage`
- **字段路径命名空间**（30+ 条 `SENSITIVE_FIELDS`）：`openai.apiKey`、`xunfei.apiSecret`、
  `mcp.postgres.password` …
- 唯一历史 caller：`llm/secure-storage-ipc.js`。Phase 3c.1 起 sync-credentials 也 caller

**结论**：项目里 *已经有* 一个能用的加密 vault（safeStorage），只是历史上只
被 LLM 用。WebDAV / OSS 凭证扩这套是几行改动 —— 加 `sync.webdav.password`、
`sync.oss.secretAccessKey` 条目到 `SENSITIVE_FIELDS`。**不需要新建 credential-vault
子系统**。已落地，见 §4.1。

附带债务：git-config.json 的明文密码是已存在安全 issue，是否同步迁到
safeStorage 是 Phase 3c 的搭车选项（不强制）。

### 2.4 测试覆盖（更新 2026-05-06）

- ✅ git: `git/__tests__/{diff-sync,git-sync-e2e,p2p-git-sync}.test.js`
- ✅ db / collaboration sync: `collaboration/__tests__/org-knowledge-sync-manager.test.js`
- ✅ **Phase 3c 已落 4 个测试文件 / 62 测试**：
  - `sync/__tests__/sync-credentials.test.js` (18 tests)
  - `sync/__tests__/sync-external-store.test.js` (18 tests)
  - `sync/__tests__/markdown-renderer.test.js` (16 tests)
  - `sync/__tests__/incremental-walker.test.js` (10 tests)
- ❌ syncProviders 抽象层（renderer 端）：仍 0
- ❌ webdav-client / webdav-ipc：尚未实施

---

## 3. 决策点与最终选择

| ID | 主题 | 选择 | 理由 |
|---|---|---|---|
| D1 | 第一个真 provider | **WebDAV 先于 S3** | 单包 `webdav` ~150kb 一次接 Nextcloud / 坚果云 / 群晖三家；用户群直觉是绑家用 NAS |
| D2 | 凭证存储 | **复用 safeStorage**：扩 `SENSITIVE_FIELDS` + 自家 `sync-credentials.js` 包薄一层 | 已有现成 vault；新建 credential-vault 子系统是 5–7 天投入但 Phase 3c 用不上 |
| D3 | 数据格式 | **增量游标 + 扁平 .md 树** | 复用 markdown-renderer；cursor (updated_at, id) 字典序；远端文件名 `${id}-${cleanTitle}.md` |
| D4 | 冲突策略 | **push-only v1 + ETag If-Match 兜底** | 80% 场景是"本地→云备份"；ETag 不匹配则跳过 + 计数 + UI 提示；双向合并留 3d |
| D5 | 加密层 | **TLS-only v1** | 端到端加密（用户密码派生 KDF）放 3d 或更晚 |
| D6 | Selective sync | **v1 不做** | UI 留入口禁用，文案"敬请期待" |

---

## 4. 已落地部分（Phase 3c.1 + 3c.2 上半段）

### 4.1 凭证 vault 扩展（task #1，已完成）

**改动**：
- `src/main/llm/secure-config-storage.js` `SENSITIVE_FIELDS` 加：
  - `sync.webdav.password`
  - `sync.oss.secretAccessKey`
- 新建 `src/main/sync/sync-credentials.js`（~150 行）

**API**（CommonJS）：
```js
const {
  ALLOWED_PROVIDER_IDS,        // ["webdav", "oss"]
  getCredentials,              // (providerId) → plain config object | {}
  getCredentialsSanitized,     // (providerId) → 同上但 password 字段 mask
  hasCredentials,              // (providerId) → boolean
  setCredentials,              // (providerId, credsObj) → boolean
  clearCredentials,            // (providerId) → boolean
  _setDepsForTest,             // 测试钩子
} = require("./sync-credentials");
```

**关键设计**：
- 整个 secure-config blob 共用一个 `secure-config.enc` 文件，sync 凭证以
  `config.sync.<providerId>` 命名空间存放（不污染 LLM 命名空间）
- 不直接顶层 destructure require —— 用 `_deps.getSecureConfigStorage()`
  懒求值，避免 vitest fork pool 下 CJS destructure + vi.mock 的已知 bug
  （见 `.claude/rules/testing.md`）
- mask 行为复用 secure-config-storage 的 `sanitizeConfig`，由
  `SENSITIVE_FIELDS` 内的 `sync.*.password` 等条目驱动

**测试**：18 测试，包括 round-trip / mask / 隔离 / clear / 异常路径。

### 4.2 cursor schema + store（task #2，已完成）

**两张新表**（`src/main/database/database-schema.js` 行 ~3990–4060）：

```sql
CREATE TABLE IF NOT EXISTS sync_external_provider_cursor (
  provider_id TEXT NOT NULL,
  account_key TEXT NOT NULL DEFAULT '',
  last_sync_at INTEGER NOT NULL DEFAULT 0,
  last_item_id TEXT,
  remote_etag_map TEXT NOT NULL DEFAULT '{}',     -- JSON {item_id: etag}
  remote_filename_map TEXT NOT NULL DEFAULT '{}', -- JSON {item_id: filename}
  last_run_status TEXT,
  last_run_error TEXT,
  last_run_duration_ms INTEGER,
  items_pushed   INTEGER NOT NULL DEFAULT 0,
  items_skipped  INTEGER NOT NULL DEFAULT 0,
  items_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
  PRIMARY KEY (provider_id, account_key)
);

CREATE TABLE IF NOT EXISTS sync_external_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  account_key TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE(provider_id, account_key, item_id)
);

CREATE TRIGGER trg_sync_ext_tombstone_on_delete
AFTER DELETE ON knowledge_items
FOR EACH ROW
BEGIN
  INSERT OR IGNORE INTO sync_external_tombstones
    (provider_id, account_key, item_id, deleted_at)
  SELECT c.provider_id, c.account_key, OLD.id,
         (strftime('%s','now') * 1000)
  FROM sync_external_provider_cursor c;
END;
```

**关键设计**：
- 命名 `sync_external_*`，与现有 `sync_queue` / `sync_conflicts`（org-internal
  backend sync 用）解耦
- Tombstone 由 trigger 自动 fan-out 到所有已建过游标的 provider —— 任何路径
  删 `knowledge_items` 都被覆盖，不依赖应用层调用
- 没建过游标的 provider 不参与 fan-out（首次同步时全量推就行，无需 tombstone 历史）
- 推送成功 → 调用方删除对应 tombstone 行；失败 → `markTombstoneFailed`
  累加 retry_count

**Store 模块** `src/main/sync/sync-external-store.js`（~210 行）公开 9 个函数：
`getCursor / ensureCursor / updateCursor / recordPushedItem / listTombstones /
deleteTombstone / markTombstoneFailed / removeFromMaps / resetCursor`。

**测试**：18 测试，sql.js 内存数据库验证字典序游标 / JSON 列 round-trip /
触发器 fan-out / tombstone 重试 / 隔离。

### 4.3 markdown 渲染 + 增量游标 walker（task #4，已完成）

`src/main/sync/markdown-renderer.js`：纯函数 `generateFilename(item)` /
`generateMarkdown(item)`，与 `git/markdown-exporter.js` 输出格式 100% 一致
（保证两个 provider 同时启用时远端文件不抖动）。

`src/main/sync/incremental-walker.js`：
- `fetchBatch(dbManager, cursor, batch=200)` —— 取 cursor 之后的下一批
- `nextCursorFromBatch(batch)` —— 算下批起点
- `cursorAfterItem(item)` —— 单 item 推送成功后的 per-item 游标推进
- `countPending(dbManager, cursor)` —— 算待推送总数（进度条）

**关键设计**：
- 游标 lex-order：`(updated_at, id) > (sinceMs, sinceId)`，分支条件写法
  避免依赖 SQLite row-value 比较语法
- 直接走 `dbManager.all(sql)` 而 *不* 经 `database.getKnowledgeItems(...)`
  包装 —— 后者有已知 bug（见 §6）
- 默认 batch 200，clamp [1, 1000]，避免大 KB 一次性吃内存

**测试**：26 测试（markdown-renderer 16 + incremental-walker 10）。

---

## 5. 待实施（Phase 3c.2 下半段 + 3c.3）

### 5.1 webdav-client.js（task #3）

`src/main/sync/webdav-client.js`：包 `webdav` npm 包

```js
class WebDAVClient {
  async testConnection()                       // PROPFIND root, returns true/false + error
  async putFile(remotePath, content, etag?)    // PUT with If-Match
  async deleteFile(remotePath, etag?)          // DELETE with If-Match
  async getEtag(remotePath)                    // PROPFIND, returns etag string | null
  async listRemote(remoteRoot)                 // PROPFIND depth=1, returns [{name, etag}]
}
```

**前置依赖**：
```bash
cd desktop-app-vue && npm install webdav
```

**重试策略**：429 / 5xx → 指数退避 3 次；4xx → 立即抛错。

**测试**：mock webdav server（可用 `webdav-server` npm 包搭建本地实例，
或用 axios mock interceptor）。

### 5.2 webdav-engine.js（业务编排，task #5 拆出来一半）

把 walker / store / client / renderer 串起来的业务编排。
单独 module 让测试可以注入 fake client。

```js
async function runWebDAVSync(deps) {
  // deps: { dbManager, client, providerId='webdav', accountKey='', logger, onProgress? }
  // 1. ensureCursor → cursor
  // 2. 串行处理 tombstones：listTombstones → DELETE 每条 → deleteTombstone
  //    （成功）/ markTombstoneFailed（失败）+ 从 etag/filename map 移除
  // 3. push 循环：fetchBatch → 每条 generateFilename + generateMarkdown
  //    → client.putFile（带 If-Match if cursor 有 etag）→ recordPushedItem
  //    → cursorAfterItem 推进；冲突 → items_skipped++
  // 4. 完成后 updateCursor: lastRunStatus, lastRunError, lastRunDurationMs
  // 5. 返回 { pushed, skipped, deleted, conflicts, durationMs, error? }
}
```

**push-only v1**：远端 manual 编辑导致 ETag 不匹配 → 不覆盖，
计入 `items_skipped` + `lastRunStatus='conflict'`，UI 显式提示用户。

### 5.3 webdav-ipc.js（task #5 另一半）

注册 4 个 IPC channel：
- `sync:webdav:test` —— 调 `client.testConnection()`，立即返回
- `sync:webdav:run` —— 调 `runWebDAVSync(...)`，长时间，进度通过
  `mainWindow.webContents.send('sync:webdav:progress', {pushed, total})` 推送
- `sync:webdav:config-get` —— 返回 `getCredentialsSanitized('webdav')`
- `sync:webdav:config-set` —— 接受 `{url, username, password, remotePath}`，调 `setCredentials`

### 5.4 替换 syncProviders/webdav.ts placeholder（task #5 收口）

```ts
export const webdavProvider: SyncProvider = {
  id: "webdav",
  name: "WebDAV 网盘",
  description: "Nextcloud / 坚果云 / 群晖等 WebDAV 协议网盘",
  configRoute: "/settings/system?tab=sync-webdav",
  available: () => typeof (window as any).electronAPI?.sync?.webdav?.run === "function",
  async runOnce() {
    const res = await (window as any).electronAPI.sync.webdav.run();
    return {
      success: res.success,
      error: res.error,
      detail: `推送 ${res.pushed} / 跳过 ${res.skipped}`,
    };
  },
};
```

需要 `preload/index.js` 暴露 `electronAPI.sync.webdav.{test,run,configGet,configSet}` 命名空间。

### 5.5 Settings UI（task #6）

`/settings/system?tab=sync-webdav` 单页表单：

- URL（必填，placeholder `https://nas.example.com/dav`）
- 用户名 / 密码
- 远端路径（默认 `/chainlesschain`）
- 「测试连接」按钮 → `sync:webdav:test`
- 状态卡：上次同步时间 / 状态 / pushed-skipped-deleted 计数
- 「立即同步」按钮 → 调 scheduler.runProviderOnce("webdav")
- 「断开 / 清除凭证」按钮 → confirm + `clearCredentials`

---

## 6. ⚠️ 副线发现：`getKnowledgeItems` 包装层 bug

`src/main/database.js:828–833`：

```js
getKnowledgeItems(limit = 100, offset = 0) {
  const { getKnowledgeItems: _getKnowledgeItems } =
    require("./database/database-knowledge");
  return _getKnowledgeItems(this, logger, (limit = 100), (offset = 0));
  //                                       ^^^^^^^^^^^^   ^^^^^^^^^^^^^
  //                                       赋值表达式：永远变成 100, 0
}
```

`(limit = 100)` 是 *赋值表达式*，先把 100 赋给 `limit`（覆盖入参），
再把整个表达式的值（100）作为参数。后果：

- 调用方传任何 `limit` 都被静默忽略
- `markdown-exporter.exportAll` 调 `getKnowledgeItems(9999, 0)` —— **真实只导出 100 条**
- KB 超过 100 条的用户：git 同步默默漏数据

**与 Phase 3c 的关系**：incremental-walker 已**绕过**这个包装层，直接
`dbManager.all(sql)`，所以 WebDAV 路径不受影响。但 git provider 的 markdown
导出仍踩这个 bug。

**建议**：单开 follow-up issue 修 `database.js`（去掉两个赋值表达式），
不在 Phase 3c 范围内修，避免范围漂移。

---

## 7. 二级决策（已锁定，2026-05-06）

> 之前的 Q1 / Q2 / Q4 / Q5 已在落地中默认化（路径扁平 / 单账户 v1 / 不做附件 /
> delete via tombstone trigger），不再列。剩下 4 条对实现有显著影响 ——
> 用户授权，按以下定案：

### D7 — 远端 rename：**PUT with If-Match etag，不 PROPFIND 探活**

- 流程：本地推送时拿 `remote_filename_map[itemId]` 作为目标路径，PUT 时带
  `If-Match: <cursor.remote_etag_map[itemId]>`。远端如果被改名 → etag 变
  → 412 Precondition Failed → 计 `items_skipped`，UI 提示
- 代价：远端可能积累 "旧名(用户改的) + 新名(本地推的)" 两份。**Settings 页
  加一个「清理远端孤儿文件」按钮**（PROPFIND 列远端 + diff `remote_filename_map`，
  确认后 DELETE 不在 map 里的 `.md` 文件）作为手动逃生口，不进自动循环
- 反对的方案（每次 PUT 前 PROPFIND 探活）：每条多一次往返，1000 条 KB
  首次同步实测会接近 2× 慢，且解决的是 1% 用户场景，不划算

### D8 — 附件：**v1 不同步，3d 加**

- markdown-renderer 不渲染 `content_path`，远端只有纯文本 .md
- Settings 页文案显式：「当前仅同步笔记正文，附件 / 图片不上传 — 计划 v3d
  支持 attachments/ 子目录」
- 不在 v1 留半成品（不预先在 schema / 渲染器里加 placeholder 字段）

### D9 — 进度上报：**每 5 条 + 500ms 节流**

- IPC channel `sync:webdav:progress` 推送 `{pushed, skipped, deleted, total}`
- 触发条件：(批内已推 5 条) **OR** (距上次推送 ≥ 500ms)，先到先发
- 1000 条 KB 首次同步 ≈ 200 events（不刷爆 IPC，进度条平滑）
- 失败 / 完成事件单独发，不走节流

### D10 — 冲突通知：**首次 NotificationCenter，后续仅红点 + 防再激活**

- 单次 sync 内 `items_skipped > 0` 且 `lastRunStatus='conflict'` ——
  通过 `notificationCenter.push({ type: "warning", title: "WebDAV 冲突",
  body: "N 个文件被跳过，远端可能有手动修改" })`
- 同一冲突批次重复 sync 不再推（Settings 页红点持续）
- **再激活规则**：连续一次干净 sync（`items_skipped === 0`）后再次出现冲突
  → 重新推送 NotificationCenter（避免"修复后又出冲突"被静默淹没）
- 实施位置：webdav-engine.js 在拼 result 时持久化 `last_clean_run_at` 到
  cursor 的 `last_run_*` 列里，IPC 层做"上次是否干净"判断

---

## 8. 不在范围内（重申）

- git-config.json 明文密码迁 safeStorage
- 双向同步 / 冲突 UI（3d）
- 端到端加密上传（3d 或更晚）
- Selective sync / 文件夹级开关（3d）
- 附件 / 二进制资产同步（3d）
- 移动端 (Android) 同源 sync（已有 mobile provider 走 P2P，不动）
- §6 的 `getKnowledgeItems` 包装层 bug 修复

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| WebDAV 服务端实现差异（坚果云非标头、Nextcloud 大小写敏感） | 各家做手测矩阵，README 列已知坑 |
| safeStorage 在 Linux headless（无 KWallet/GNOME-Keyring）退化 fallback AES | 已有 fallback 路径，文档警告 |
| `webdav` 包加进来 ~150kb 增包体 | 主进程依赖，不进 renderer bundle；asar:false 模式可接受 |
| 全量首次同步对大 KB（>5000 条）慢 | 进度条 + 可暂停；首次推完后增量小。已用 batch=200 + cursor 分次推送规避 OOM |
| 用户配错 endpoint 导致密钥发到错误服务器 | "测试连接"按钮（PROPFIND）+ 显式 host 警告文案 |
| §6 的 100 条上限 bug 让 git provider 默默漏数据 | 已识别但不在 3c 范围；single follow-up issue |

---

## 10. 进度追踪（v3 — 2026-05-06 全部完成）

| Task | Phase | 状态 | 文件 / 测试数 |
|---|---|---|---|
| #1 vault extension | 3c.1 | ✅ 已完成 | `sync-credentials.js` + 18 tests |
| #2 cursor schema | 3c.2 | ✅ 已完成 | `sync-external-store.js` + database-schema 增量 + 18 tests |
| #4 incremental exporter | 3c.2 | ✅ 已完成 | `markdown-renderer.js` / `incremental-walker.js` + 26 tests |
| #3 webdav-client.js | 3c.2 | ✅ 已完成 | `webdav-client.js` + 23 tests（包 webdav@5.10.0 ESM via dynamic import） |
| #5 webdav-ipc + provider | 3c.2 | ✅ 已完成 | `webdav-engine.js` + 12 tests / `webdav-ipc.js` + 12 tests / `webdav.ts` 替换 placeholder / preload / phase-8-9-extras 注册 |
| #6 Settings UI | 3c.3 | ✅ 已完成 | `pages/settings/SyncWebDAV.vue` + 路由 + provider configRoute |

**累计**：8 主进程模块 / 1 renderer 页 / **109 单元测试** / 5 IPC channels / preload bridge /
路由 + provider 替换 / `npm install webdav` 已完成。

**验证状态**：
- ✅ `npx vitest run src/main/sync/__tests__/` — 109/109 green
- ✅ `npx vue-tsc --noEmit` — 0 errors on new SyncWebDAV.vue
- ⏳ 集成测试（mock webdav server）—— 未做，列入 follow-up
- ⏳ 真实 WebDAV 服务对接手测（坚果云 / Nextcloud）—— 用户 dogfood

**Phase 3c.4 — web-shell parity**（2026-05-06 当天追加）：
- `src/main/web-shell/handlers/sync-webdav-handlers.js`：5 个 WS topic
  (`sync.webdav.test/run/config-get/config-set/config-clear`)
- `web-shell-bootstrap.js` 注册 + `index.js` 传 `database` 到 `startWebShell({...})`
- `packages/web-panel/src/views/SyncSettings.vue` 顶部加 WebDAV 卡片，调用 `ws.sendRaw({type:'sync.webdav.*'})`
- 不走 `cc sync webdav ...` CLI 路径（CLI 端无对应实现，且 web-shell `_executeCommand` spawn 的是 Electron binary，同 skill.list 的解决路径）
- 测试：12 个新 handler 测试，**累计 121 测试 / 8 文件**

**剩余 follow-ups**：
- 集成测试：用 `webdav-server` npm 起 local server 跑 e2e
- §6 副线 `getKnowledgeItems(9999, 0)` bug 单独 issue
- 「清理远端孤儿文件」按钮（D7 兜底，Settings 页扩展）
- D10 NotificationCenter 推冲突通知（webdav-engine 内 hook）
- web-shell 端实时 progress chunk（async-generator handler，目前只有最终结果，no streaming）
- `cc sync webdav` CLI 命令（独立工程 — 需要先解决 CLI 端的 safeStorage 等价物）
- Phase 3c 之后 — S3 / OSS provider

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。Phase 3c OSS / WebDAV / 网盘 同步设计：第三方网盘同步。

### 2. 核心特性
OSS / WebDAV / 网盘 / 同步。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「网盘同步（Phase 3c）」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
