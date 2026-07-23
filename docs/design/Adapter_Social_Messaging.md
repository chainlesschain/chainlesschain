# Adapter — Social + Messaging (Phase 13)

> **状态**：v0.7 已落地。7 个 adapter 已移植；WhatsApp 已支持用户自有 crypt14 / crypt15 密钥的本地直解，并兼容新旧消息表。
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
│    - WhatsApp: crypt14 key from app-private files/key      │
│      或 crypt15 64 字符备份密钥 / encrypted_backup.key    │
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

**关键约束（历史）**：Phase 13.7 v0.5 不调 ADB、只接受已解密的明文 `.db`。Phase 13.7b / v0.7 已补齐 crypt14 与 crypt15：桌面/CLI 可通过 ADB 从 Android 公共备份目录自动拉取加密库（无需 root），也可手选文件；必须由用户主动提供自己的 key/keyProvider。ADB 加密副本与解密明文都只在本机临时目录存在，采集结束立即清理。

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
| WhatsApp | 312 (parser) + 437 (crypt14 解密) | Node 解析 + ADB 公共目录拉取 + 流式解密 | 核心采集路径 ✅ (v0.7) | 新旧 `message` / `messages` 合并去重；解析 chat/sender JID、media/location/vcard/quote/call；用户自有 key；AES-256-GCM 认证、zlib 解压、SQLite magic 校验、拉取副本与临时明文清理；真实 crypt14/15 fixture 与 `msgstore.db` 结构交叉验证通过 |

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
| `__tests__/whatsapp-adapter.test.js` + `adapters/messaging-whatsapp.test.js` + `adapters/whatsapp-backup-decryptor.test.js` + `adapters/whatsapp-adb-extension.test.js` | WhatsApp ADB 公共备份拉取、路径白名单、jid/contact/group/chat、新旧 message 合并去重、media/location/vcard/quote/call_log + crypt14/crypt15 解密、错误密钥、临时文件清理 | 32 |

合计 +70 单测累计到 hub 总线 47 文件 / 927 单测。

---

## 7. 已知局限与 follow-up

| 项 | 当前状态 | follow-up phase | 工期估 |
|---|---|---|---|
| WhatsApp crypt14 / 15 采集 | **v0.7 已完成**：ADB 公共备份自动拉取（个人版/Business）或文件导入；用户自有 key/keyProvider；流式 AES-GCM + MD5/tag 校验 + zlib + SQLite 校验；全程临时文件清理 | Phase 13.7b ✅ | 真机 UX 验收仍需用户设备/备份 |
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

## 11. Toutiao 今日头条 (`com.ss.android.article.news`) — v0.2.1 dual-mode

> **状态**：v0.2.1 已接通 snapshot + SQLite 双模式，覆盖 profile / read history / collection / search；桌面/CLI 与 Android 已有 ADB cookie/sign/root collector。当前环境无连接设备，真机端点命中率与新版加密库仍按对应 E2E runbook 验收，不再标为 scaffold。

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

## 12. Kuaishou 快手 (`com.smile.gifmaker`) — v0.2.1 dual-mode

> **状态**：v0.2.1 已接通 snapshot + SQLite 双模式，覆盖 profile / watch history / collection / search；桌面/CLI 与 Android 已有 ADB cookie/sign/root collector。当前环境无连接设备，`__NS_sig3` 命中率与新版加密库仍按对应 E2E runbook 验收，不再标为 scaffold。

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

> §11+§12 的代码与 mock/结构回归已收口；发布 sign-off 仍以用户设备上的真实账号 smoke 为准，不能用单元测试替代。

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
  dbPath: "C:/Users/me/msgstore.db.crypt15",
  // 支持 64 字符 hex、key/encrypted_backup.key 文件路径，或 async getKey(ctx)。
  keyProvider: { getKey: async () => process.env.WHATSAPP_BACKUP_KEY },
});
```

ADB 自动拉取（推荐把 64 位密钥写入仅当前用户可读的文本文件，避免进入 shell 历史）：

```bash
cc hub sync-adapter messaging-whatsapp --key C:/secure/whatsapp-crypt15.key
# WhatsApp Business 可追加 --whatsapp-business；多设备时追加 --serial <adb-serial>
```

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档（Adapter 规格）。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 范围与归类」。Phase 13 集中处理纯本机 / 移动端加密 SQLite 类数据源（7 个 adapter，全部移植自 sjqz Python parser），与走 Web API 的 Phase 5/6/7/9 采集链路完全不同。

### 2. 核心特性

7 adapter：Bilibili / Weibo / Douyin / Xiaohongshu / QQ / Telegram / WhatsApp；本机加密 SQLite device-pull 模式。

### 3. 系统架构

见正文与父文档 `Personal_Data_Hub_Architecture.md` §12 phase plan、`Personal_Data_Hub_sjqz_Comparison.md` §3 移植清单。

### 4. 系统定位

Personal Data Hub 的**本机加密消息 / 社交 SQLite 采集层**（Phase 13）。

### 5. 核心功能

各平台加密 DB 解密 → parse → normalize → LocalVault。详见正文子 phase 表。

### 6. 技术架构

加密 SQLite（含 SQLCipher / crypt14 等）+ keyProvider；实现包 `@chainlesschain/personal-data-hub/adapters/messaging-*`。

### 7. 系统特点

device-pull（非 Web API），需外部 / keyProvider 提供解密密钥；与 cookie 模式互补。

### 8. 应用场景

本机即时通讯 / 社交记录归集进个人知识图谱。

### 9. 竞品对比

见正文 Phase 13 与 Phase 5/6/7/9（Web API）链路差异说明。

### 10. 配置参考

各 adapter 的 `dbPath` / `keyProvider` / `account` 配置见正文示例。

### 11. 性能指标

解密 + 解析为本机 I/O；随消息库大小线性增长。

### 12. 测试覆盖

各 adapter 移植自 sjqz parser，带对应单测（见 `Personal_Data_Hub_sjqz_Comparison.md`）。

### 13. 安全考虑

涉及加密消息库与解密密钥；密钥不落盘，仅本机使用；输出经 LocalVault 加密。

### 14. 故障排除

crypt14 / SQLCipher 解密失败 → 检查 keyProvider / 外部解密产物（见正文 WhatsApp 示例）。

### 15. 关键文件

`@chainlesschain/personal-data-hub/adapters/messaging-*`（含 `messaging-whatsapp`）。

### 16. 使用示例

见正文 `WhatsAppAdapter` 等调用示例。

### 17. 相关文档

见正文头部关联：`Personal_Data_Hub_Architecture.md` §12、`Personal_Data_Hub_sjqz_Comparison.md` §3、`Adapter_Social_Cookie.md`（cookie 模式互补）。
