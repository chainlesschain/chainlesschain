# Adapter — Social + Messaging (Phase 13)

> **状态**：v0.5 已落地 (2026-05-19/20)。7 个 adapter 全部移植自 sjqz Python parser。
> **关联**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) §12 phase plan / [`Personal_Data_Hub_sjqz_Comparison.md`](./Personal_Data_Hub_sjqz_Comparison.md) §3 移植清单。
> **commit 锚点**：`ade1bc025` (13.1+13.2 Bilibili+Weibo) → `12b06c4d5` (13.3-13.6 Douyin+Xiaohongshu+QQ+Telegram) → `18c62c9d6` (13.7 WhatsApp 收口)。

---

## 1. 范围与归类

Phase 13 集中处理**纯本机 / 移动端加密 SQLite 类**数据源 — 与 Phase 5/6/7/9 走 Web API 的 adapter 走完全不同的采集链路。

| 子 phase | Adapter | 数据源 | 加密 | sjqz 移植锚点 |
|---|---|---|---|---|
| 13.1 | `social-bilibili` | Android B 站 `bilibili.db` (SQLite 明文) | 无 | `sjqz/parsers/social.py::BilibiliParser` |
| 13.2 | `social-weibo` | Android 微博 `sina_weibo.db` | 无 | `sjqz/parsers/social.py::WeiboParser` |
| 13.3 | `social-douyin` | Android 抖音 watch history SQLite | 无 | `sjqz/parsers/social.py::DouyinParser` |
| 13.4 | `social-xiaohongshu` | Android 小红书收藏 / 浏览历史 SQLite | 无 | `sjqz/parsers/social.py::XHSParser` |
| 13.5 | `messaging-qq` | Android QQ `msg.db` / `messages.db` | SQLCipher（per-installation key） | `sjqz/parsers/qq.py::QQParser` |
| 13.6 | `messaging-telegram` | Android Telegram `cache4.db` + `tdata` | 明文 (本地) | `sjqz/parsers/telegram.py::TelegramParser` |
| 13.7 | `messaging-whatsapp` | Android WhatsApp `msgstore.db` | crypt14 / crypt15 (双层 AES + SQLite) | `sjqz/parsers/whatsapp.py::WhatsAppParser` |

**总体哲学**：

1. **零自研提取层** — 全部 7 个 adapter 都把 DB 文件作为输入（`opts.dbPath`），不调 ADB 也不写文件。文件落盘交给 Phase 7.5 Mobile Extraction Layer (`adapters/_python-sidecar-base.js` + `mobile-extractor`)，本批只负责"拿到 .db 文件后怎么解析"。
2. **DB driver 依赖注入** — 默认 `better-sqlite3-multiple-ciphers`（既支持明文也支持 SQLCipher），但 `opts.dbDriverFactory` 可替换；测试用 stub driver 跑全部 unit case。
3. **schema mapping 跨源对齐** — 所有 row 派生进 UnifiedSchema 5 类实体（Person/Event/Place/Item/Topic），新字段一律挂 `extra`。
4. **错误优雅退化** — `trySelect(db, sql)` 包 `try/catch` 返回 `null`；某张表 schema 改了（B 站新版本把 `history` 改名 `playback_history`）单条降级，整库不挂。

---

## 2. 共同 Adapter 契约

所有 7 个 adapter 都实现完整 `PersonalDataAdapter` 接口（per `lib/adapter-spec.js`）：

```js
class XxxAdapter {
  constructor(opts = {})           // 检查 account.* 必填 + 接受 dbPath / keyProvider / dbDriverFactory
  authenticate() => { ok, reason?, account? }   // 多数仅做 fs.existsSync(dbPath)
  healthCheck() => { ok, lastChecked }
  async *sync(opts) => yields { adapter, originalId, capturedAt, payload }
  normalize(raw) => { events, persons, places, items, topics }
  name / version / capabilities / extractMode / rateLimits / dataDisclosure
}
```

**dataDisclosure 敏感度统一规则**：

| Adapter | sensitivity | legalGate |
|---|---|---|
| social-bilibili / weibo / douyin / xiaohongshu | `medium` | false |
| messaging-qq | `high` | true |
| messaging-telegram | `high` | true |
| messaging-whatsapp | `high` | true |

> `legalGate: true` 触发 UI 二次确认（"该 adapter 会读取私密通讯内容，确认继续？"），Phase 11+ EntityResolver 也对 high-sensitivity 数据走更严的 LLM 隔离。

---

## 3. 采集链路（统一）

```
┌────────────────────────────────────────────────────────┐
│ 1. Phase 7.5 Mobile Extraction Layer                    │
│    - Android: ADB backup / root pull → 本地 cache       │
│    - iOS: pymobiledevice3 / iTunes backup → 本地 cache  │
│    输出：dbPath = "<vault>/cache/<adapter>/<acct>.db"   │
└─────────────────┬──────────────────────────────────────┘
                  ↓
┌────────────────────────────────────────────────────────┐
│ 2. (messaging 类) Key extraction                        │
│    - QQ: per-installation key from auth_info_*.xml      │
│    - WhatsApp: crypt14 key from /sdcard/WhatsApp/Databases │
│      或 Google Drive backup key                          │
│    - WeChat: MD5(IMEI+UIN)[:7] (Phase 12 path)          │
│    输出：keyProvider.getKey() => Buffer                 │
└─────────────────┬──────────────────────────────────────┘
                  ↓
┌────────────────────────────────────────────────────────┐
│ 3. Phase 13 Adapter (本批)                              │
│    new XxxAdapter({ account, dbPath, keyProvider? })    │
│      .sync() yields raw rows                            │
│      .normalize(raw) => UnifiedSchema 5 类实体          │
└─────────────────┬──────────────────────────────────────┘
                  ↓
┌────────────────────────────────────────────────────────┐
│ 4. AdapterRegistry 全流水线 (Phase 2)                   │
│    health → sync → vault.putBatch → KG → RAG → audit   │
└────────────────────────────────────────────────────────┘
```

**关键约束**：本 phase 不调 ADB 也不解 crypt14 — 那些动作分别属于 Phase 7.5 与 Phase 13.7b。当前 v0.5 仅接受**已解密的明文 .db**。

---

## 4. Schema 映射（每 Adapter）

### 4.1 Bilibili / Weibo / Douyin / Xiaohongshu

| sjqz row | UnifiedSchema | subtype | actor | content |
|---|---|---|---|---|
| `history.view_at` | Event | `browse` | `person-self` | `{ title: 视频标题 }` + `extra: { bvid, avid, duration, uploader }` |
| `bili_favourite` / `weibo_collection` / `xhs_favourite` | Event | `like` | `person-self` | `{ title }` + `extra: { folder, uploader }` |
| `bili_message` / `weibo_dm` | Event | `message` | `person-<jid>` | `{ text }` |
| User profile rows | Person | `self`（自己）/ `contact`（粉丝 / 关注） | — | identifiers `{ uid, screen_name }` |

> Douyin 不存私信（抖音私信在远端），仅 watch history → `browse`。

### 4.2 QQ / Telegram

| sjqz table | UnifiedSchema | subtype | 备注 |
|---|---|---|---|
| QQ `mr_friend` / TG `user` | Person | `contact` | identifiers `{ qq | telegram_id, name }` |
| QQ `mr_troop` / TG `chats` (group) | Topic | (free-form) | extra `{ jid, member_count }` |
| QQ `msgcsr_friend_*` / TG `messages` | Event | `message` | actor 走 `person-self` (`from_me=1`) 或 `person-<peer>` |
| QQ 群消息 `msgcsr_troop_*` | Event | `message` | extra 挂 `groupId` |

### 4.3 WhatsApp

| msgstore table | UnifiedSchema | subtype | 备注 |
|---|---|---|---|
| `jid` (1:1 contact, `@s.whatsapp.net`) | Person | `contact` | identifiers `{ phone: [E.164] }` |
| `jid` (group, `@g.us`) | Topic | — | extra `{ jid }` |
| `chat` | Topic | — | extra `{ subject, display_name }` |
| `message` | Event | `message` | extra `{ jid, isOutgoing, mediaType }` |
| `call_log` | Event | `call` | extra `{ duration, isVideo, fromMe, callResult }` |

---

## 5. sjqz Parser 借鉴细节

复用程度（按 sjqz LOC 折算）：

| Adapter | sjqz Python LOC | PDH Node.js LOC | 复用率 | 不可复用部分 |
|---|---|---|---|---|
| Bilibili | 187 | ~170 | 90% | sjqz 还输出 Excel 报告；PDH 不需要 |
| Weibo | 165 | ~150 | 88% | 同上 |
| Douyin | 102 | ~85 | 95% | — |
| Xiaohongshu | 124 | ~110 | 90% | — |
| QQ | 391 | ~280 | 70% | sjqz 还包 PC QQ `MsgEx.db` 旧路径；PDH 暂只支持 Android |
| Telegram | 248 | ~190 | 78% | sjqz 处理 `tdata` 桌面端 cache；PDH 仅 Android |
| WhatsApp | 312 (parser) + 437 (crypt14 解密) | ~190 (parser) | parser 80% / crypt14 0% (v0.5b TODO) | crypt14 解密路径完全未移植 |

**移植 SOP**：

1. 读 sjqz 对应 `parsers/<name>.py` → 拷贝表名 + 字段列表
2. 用 `trySelect` 替换 sjqz 的 `cursor.execute` (保留 catch-all error handling)
3. row → UnifiedSchema 映射手写 (这步 sjqz 输出 Excel，PDH 输出 events，逻辑差异最大)
4. 单测 fixture：fork sjqz `tests/fixtures/<name>.db` 直接进 `__tests__/fixtures/`
5. 各 adapter 单测约 8-15 case，进 `__tests__/social-adapters.test.js` / `longtail-adapters.test.js` / `whatsapp-adapter.test.js`

---

## 6. 测试矩阵

| 测试文件 | 覆盖 | case 数 |
|---|---|---|
| `__tests__/social-adapters.test.js` | Bilibili / Weibo / Douyin / Xiaohongshu (history / favourite / DM 等三类 row 各一例 fixture) | ~32 |
| `__tests__/longtail-adapters.test.js` | QQ + Telegram (friend / group / message 三 kind) | ~24 |
| `__tests__/whatsapp-adapter.test.js` | WhatsApp jid(contact/group) / chat / message / call_log 全 4 kind + crypt14 graceful error | ~14 |

合计 +70 单测累计到 hub 总线 47 文件 / 927 单测。

---

## 7. 已知局限与 follow-up

| 项 | 当前状态 | follow-up phase | 工期估 |
|---|---|---|---|
| WhatsApp crypt14 / 15 解密 | v0.5 仅接受明文 db | Phase 13.7b | 1d (sjqz Python 移植) |
| QQ 8.x+ 新 schema | v0.5 仅老版本 mr_* 表名 | Phase 13.5b | 0.5d |
| iOS app-private container 提取 | 不支持 | Phase 7.5b (iOS pull 增强) | 2d |
| 自动同步 watermark for 增量 | 全表 LIMIT N，无水位 | Phase 13.8 | 1d × 7 adapter ≈ 4d 含测试 |
| 真机 E2E (rooted Android + 真账号) | 仅 fixture 单测 | Phase 13.9 | 3d（含 7 个 app 拷数据 / 验解析） |
| KG / RAG sink 适配 (Bilibili UP 主作为 Person，TG group 作为 Place 候选) | 仅基础映射 | Phase 14（与 EntityResolver 联动） | 2d |

---

## 8. 与其它 phase 的依赖关系

- **依赖**：Phase 7.5 Mobile Extraction Layer（拿 .db 文件）
- **依赖**：Phase 12 WeChat 同套机制（共用 `better-sqlite3-multiple-ciphers` + key-provider 抽象）
- **被依赖**：Phase 14 移动端 NL 入口（手机端 `hub.ask` 通过 P2P DC 调桌面，社交 / 通讯数据成为高频问答素材）
- **被依赖**：Phase 8 EntityResolver（跨源把"妈妈"在 WhatsApp / QQ / Email 里的不同身份消歧）

---

## 9. 隐私 / 合规考虑

1. **`legalGate: true` 在 messaging adapter 上**：UI 注册前弹"该 adapter 会读取通讯记录，仅供本人使用"二次确认；操作落 audit_log。
2. **本地不外发**：与桌面 Hub 主架构一致 — 所有解析 / 入 vault / KG / RAG 都在本机，AnalysisEngine 隐私 gate 默认拒非本地 LLM。
3. **数据销毁**：`adapter.unregister` 走标准链路；`vault.destroy` 同时清掉这些 adapter 的 raw_events / events / persons。
4. **第三方合规**：本 adapter 不调任何远端 API（QQ / WhatsApp 服务端），不触发 ToS 中的"未经授权访问"条款 — 用户拷自己手机的 .db 属于 device 本地数据。
5. **加密 DB 解密 key**：crypt14 key / QQ per-installation key 必须由用户主动提供（手机里复制粘贴或拷文件），Hub 不内置任何破解。

---

## 11. Toutiao 今日头条 (`com.ss.android.article.news`) — v0.1 scaffold

> **状态**：v0.1 scaffold（2026-05-20，与 Kuaishou 同批补完）。代码 `lib/adapters/social-toutiao/`；schema 字段名待 Phase 13.10 Xiaomi 24115RA8EC 真机 fixture pin。

**事实源**：Android `/data/data/com.ss.android.article.news/databases/` 下 SQLite 库。新版（2024+）逐步加密，老 7.x 版本明文。

**conjectured 表**（待 fixture 校准）：

| 表 | event subtype | 说明 |
|---|---|---|
| `read_history` | `browse` | 已读文章（item_id / title / read_time / category） |
| `collection_article` | `like` | 收藏的文章（save_time） |
| `search_history` | `post` | 搜索词 reframed 为自发"search"事件 — 揭示用户主动兴趣方向 |

**sensitivity = high**：新闻阅读模式可能暴露政治倾向 / 医疗咨询 / 个人调查方向，敏感度高于 Bilibili 视频史。

**已知局限**：
- 新版（8.x+）逐渐加密 SQLite，需 Phase 13.10 评估 frida-indep MD5(IMEI/UIN) 类密钥派生路径（同 WeChat Phase 12 v0.5）
- App 间数据流（如"今日头条 → 抖音"跳转打开同一文章）目前无法关联 — 同 ByteDance 内多 app 共享日志在系统层无暴露；Phase 13.10 评估能否从 Toutiao 自身 log 表追到 click-out

## 12. Kuaishou 快手 (`com.smile.gifmaker`) — v0.1 scaffold

> **状态**：v0.1 scaffold（2026-05-20）。代码 `lib/adapters/social-kuaishou/`；schema 字段名待 Phase 13.10 fixture pin。

**事实源**：Android `/data/data/com.smile.gifmaker/databases/`。Kuaishou 内部把短视频叫做 "photo"（产品历史遗留），SQLite 字段沿用此命名。

**conjectured 表**：

| 表 | event subtype | 说明 |
|---|---|---|
| `photo_history` | `browse` | 已观看的短视频（photo_id / caption / view_time / duration / author_id） |
| `user_collect` | `like` | 收藏的视频（collect_time） |
| `search_record` | `post` | 搜索词 reframed |

**sensitivity = medium**：短视频观看主要揭示娱乐偏好；不及 Toutiao 的政治/医疗倾向敏感。

**已知局限**：
- "完整观看率"字段（duration vs play_duration）字段名待 pin — 区分"刷过"和"看完"对 interests skill 信号差大
- 与 Douyin 数据无关联（虽然算法上类似）；两 adapter 完全独立运行
- 直播 / 商品挂载等高阶交互目前不采集，仅 v0 视频观看 / 收藏 / 搜索三表

> §11+§12 schema 真正确定后，本文档版本 bump 至 v0.6（含 fixture link）+ 撤销 `(v0.1 scaffold)` 标记。

---

## 10. 与 sjqz Comparison 文档的关系

本设计稿 **不重复** `Personal_Data_Hub_sjqz_Comparison.md` §2-3 的"为什么借 sjqz"论述，那里讲战略；本文档讲战术 — **如何借**。两文档配对阅读。

---

## 附录 A：单 adapter 注册示例

```js
const { BilibiliAdapter } = require("@chainlesschain/personal-data-hub/adapters/social-bilibili");

const adapter = new BilibiliAdapter({
  account: { uid: "123456" },
  dbPath: "C:/Users/me/.chainlesschain/hub/cache/bilibili/123456.db",
});

const { registry } = await getHub();
await registry.register(adapter);
const report = await registry.syncAdapter("social-bilibili");
// → { ingested: 1247, kgTriples: 312, ragDocs: 1247, durationMs: 480 }
```

WhatsApp 含 keyProvider：

```js
const { WhatsAppAdapter } = require("@chainlesschain/personal-data-hub/adapters/messaging-whatsapp");

const adapter = new WhatsAppAdapter({
  account: { phone: "+8613800138000" },
  dbPath: "C:/Users/me/decrypted-msgstore.db",   // 用户已在外部解 crypt14
  keyProvider: null,                              // Phase 13.7b 实施后改用 keyProvider
});
```
