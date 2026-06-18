# PDH App 数据库 Schema 字典（供 AI 解读 + adapter 适配）

> 目的：把各 App 解密出来的**本地数据库结构**（表 / 字段 / 含义 / 单位）逐一记录，
> 让 ① 个人 AI 读 PDH 数据时**知道每个字段是什么**才能正确解读；② adapter 开发**有据
> 可依**（避免靠猜列名，如 `participant` vs `SIMPLE_USER` 这类偏差）。
>
> **来源**：优先 Method B 真机内存扫描（`docs/internal/pdh-db-decryption-runbook.md`，
> rooted）实测 schema；标注 `device-verified`（实测）或 `inferred`（推断）。
> **授权边界**：仅针对用户本人设备/账号/App。
>
> 每个 App 一节，每张表给：列 + 含义 + → PDH 实体映射 + AI 解读要点。新 App 照此模板加。
>
> **完整导出 SQL（`docs/internal/reference/`，仅结构无数据，git tracked）**：
> | 文件 | 内容 |
> |---|---|
> | `wechat_schema.sql` | 微信 258 表完整 schema（源自 sjqz 取证项目）|
> | `toutiao_im_schema.sql` | 头条经典 ByteDance IM（12 表，`com.ss.android.im` 框架，与抖音通用）|
> | `douyin_im_schema.sql` | 抖音 (A)经典 ByteDance IM(mi_pigeon/同 encrypted_im 主库) + (B)新版 Room IM(`im_database_`：`im_message`/`im_conversation`)|
> | `toutiao_plaintext_db_schemas.sql` | 头条 19 个明文 app 库（遥测/缓存/新闻/推送等）|
> | `douyin_plaintext_db_schemas.sql` | 抖音 25 个明文 app 库（feature-engineering/下载器/观看记录/扫描等）|
>
> 解密方法见 `pdh-db-decryption-runbook.md`（方法 A/B/C/D）。

---

## 抖音 Douyin（`com.ss.android.ugc.aweme`）

两套库（互不相同）：
- **IM 私信库** `encrypted_<uid>_im.db`（WCDB2 + 专有 cipher，加密）— ByteDance IM SDK schema。
- **视频/内容库** `aweme.db` 等（部分明文 sqlite）— 观看/收藏/搜索历史。

### IM 库（`device-verified` 2026-06-16，真机内存解密实测）

> 引擎 WCDB2；表名/列名取自实测 CREATE TABLE / INDEX。`msg.content` 是 ByteDance
> 消息 JSON（按 `type` 区分文本/图片/卡片）。时间多为 epoch（秒/毫秒/微秒混用，按位数判）。

| 表 | 关键列 | 含义 | → PDH | AI 解读要点 |
|---|---|---|---|---|
| **`msg`** | `msg_uuid`(PK), `conversation_id`, `sender`, `type`(int), `content`(JSON), `created_time`, `order_index`, `index_in_conversation(_v2)`, `deleted`, `net_status` | 每条私信 | **EVENT** subtype=INTERACTION，`occurredAt=created_time`，text=content 按 type 解 | 沟通频率/活跃时段/话题/情绪；`type` 区分消息形态；`deleted=1` 应过滤；按 `conversation_id` 聚合成对话 |
| **`conversation_list`** | `conversation_id`(PK), `type`, `status`, `sort_order`, `last_msg_create_time`, `stranger`, `is_in_stranger_box`, `is_folded`, `root_conv_short_id`, `thread_*_unread_badge_count` | 会话/线程 | **TOPIC**（一个会话） | 活跃联系人、未读/拖延、`stranger` 区分陌生人 |
| **`participant`** | `conversation_id`, `user_id`, `sort_order`（UNIQUE(conversation_id,user_id)）| 会话成员（你聊的人）| **PERSON** subtype=CONTACT，identifiers `douyin-uid` | 社交图谱、关系强度（共现会话数）;⚠️ 只有 uid，昵称/头像要另查用户表 |
| `msg_property_new` | `msg_uuid`, `create_time` | 消息属性/表态 | EVENT.extra | 互动质量 |
| `mention` | `conversation_id`, `created_time` | @提及 | EVENT subtype=MENTION | 被@频率 |
| `conversation_setting_ext` / `_core_ext` | `conversation_id`, `key`, `value`, `version` | 会话元数据 KV | TOPIC.extra | 免打扰/置顶等设置 |

**adapter 适配状态**（`social-douyin` + `social-douyin-adb/im-db-parser.js`）：
- ✅ `msg` → 已支持（`PRAGMA table_info` 动态选列 `sender`/`created_time`/`content`/`conversation_id`，命中真机 schema）。
- ⚠️ 联系人：parser 现查 `SIMPLE_USER`（旧版/它版），**真机是 `participant`** → 需补 `participant` 读取（成员 uid → PERSON）。
- ⚠️ `conversation_list` → TOPIC 尚未映射，可补。
- 前提：parser 需**明文 sqlite 文件**；加密原始库要先经 Method B 重组出可查询文件（散页重组）或 Method A 拿 key 离线解密（见 runbook 约束 §4）。

### 视频/内容库（`inferred`，adapter 现有 sqlite 模式即针对它）

| 表（候选名） | 列 | → PDH | AI 解读 |
|---|---|---|---|
| `video_history` / `history` | `view_time`, `aweme_id`, `desc`, `author`... | EVENT subtype=MEDIA | 观看偏好、兴趣画像、时段 |
| `user_favorite` / `favourite` | `create_time`, `aweme_id`... | EVENT subtype=LIKE + ITEM | 收藏兴趣 |
| `search_history` | `time`, `keyword`/`query` | EVENT subtype=INTERACTION | 主动检索意图 |

> 真机内存打捞实测（2026-06-16）：除上述，内存里大量是**下载/内容缓存表**（JSON 字段
> `auto_install`/`dbjson_key_download_prepare_time`/`expect_file_length`/`start_offset`/
> `ttmd5_check_status` 等，带双 epoch 时间戳）——视频缓存/feed 投放记录，→ EVENT(MEDIA)。

### 明文 app 库（`device-verified` 2026-06-18，用户导出明文库实测）— **免解密直读，高价值**

抖音两个 **明文** sqlite 库（无需 frida/解密）直接给出"看过什么 + 怎么用 App"：

| 库 / 表 | 列 | → PDH | 解读 / 坑 |
|---|---|---|---|
| `video_record.db` → `record_<uid>` + `record_0` | `aid`, `view_time_timestamp`(ms), `enter_from`(来源页 homepage_hot/others_homepage…) | EVENT subtype=BROWSE（adapter kind `history`）| **观看记录**。⚠️ 历史按表分散：`record_0`(默认桶) + `record_<uid>`(登录账号)，**哪张装大头因设备而异**（一机 uid 表 900 行；另一机 record_0=223 vs uid=9）→ 必须 **MERGE 所有 `record_*` 表 + 按 (aid, ts) 去重**，别只取最大 uid 表（`readDouyinWatchHistory`，commit `6ed13be4d`）。只有 aid 无标题/作者，语义需另调 `aweme-detail-client`。|
| `1128_feature_engineering.db` → `FEInternalUserActivityTable` | `timestamp`(s), `open_app_count`, `launch_hour_0..23`, `total_duration`(ms) | EVENT subtype=other, `extra.kind="app-usage-profile"` | **使用画像基线**（每会话聚合）：天数/会话/启动次数/累计时长/24h 直方图/高峰时段桶。实测 24 天/81 会话/175 启动/107.9h/高峰 12-17h。`usage-profile-reader`（commit `51c1565c8`），stable originalId 去重、timeline 排除、overview/interests 可用。|

> 其余 `1128_feature_engineering.db` 数千行 `FeatureSchema_*`/`AppLog_*` = ML 特征向量（电商/直播/广告推荐），编码不可读 = 噪音，不入库。`offline_download_*`(下载视频)、`<uid>_im.db`(私信) 在该导出库为空。`scan_v1.db` = 手机相册 AI 扫描标签（本地相册元数据，另类，敏感度高）。

### `msg` 关键细节（IM 正文）
- `type`(int) 区分消息形态（文本/图片/卡片/系统）；`content` 是 ByteDance 消息 JSON，按 type 取文本。
- `created_time` 多为 epoch（秒/毫秒/微秒混用，按位数判，见 `im-db-parser.normalizeEpochMs`）。
- `deleted=1` 应过滤；按 `conversation_id` 聚合成一段对话；`order_index`/`index_in_conversation` 排序。
- ⚠️ `sender` 列存对端/自己 uid（大整数）；昵称/头像不在 msg 表，需另查用户表或 `participant`。

### AI 找数据指引（抖音）
- **私信**：`msg`（按 `conversation_id` 分组）；会话元信息 `conversation_list`；成员 `participant.user_id`。
- **看过的视频/兴趣**：优先 **明文** `video_record.db`（`record_*` 合并去重，免解密）；其次 `video_history`/内容缓存表。
- **使用习惯/作息**：**明文** `1128_feature_engineering.db` → `FEInternalUserActivityTable`（活跃时段+时长）。
- **收藏**：`user_favorite`；**搜索**：`search_history`。
- ⚠️ 仅 **IM 私信** 库加密（WCDB2 专有 cipher）→ 必须走 Method B/C；观看记录+使用画像是明文，直读即可。

### UI 展示建议（抖音）
- `msg`+`conversation_list`+`participant` → **私信会话视图**（会话列表 + 气泡）。
- `video_history`/内容缓存 → **观看历史/兴趣画像**（时间轴 + 标签云）。
- `user_favorite` → **收藏夹**；`search_history` → **搜索记录**。

---

## 今日头条 Toutiao（`com.ss.android.article.news`）— IM 库 `schema-accurate`（2026-06-17 真机明文库实测）

> **引擎/加密**：`databases/encrypted_<uid>_im.db` = WCDB（SQLCipher 4，文件头 16 字节=salt；
> 由 IM 插件 `files/plugins/com.ss.android.im.so/.../libwcdb.so` 打开）。**头条 = 抖音同一套
> ByteDance IM 框架（`com.ss.android.im`），下表 schema 对两者通用**——本表取自头条一个**明文旧账号库**
> `<olduid>_im.db`（"SQLite format 3" 头，12 表齐全、0 行），是 ByteDance IM 的**权威 schema**。
> `msg.content` 是 ByteDance 消息 JSON（按 `type` 分文本/图片/卡片）；时间 epoch（秒/毫秒/微秒混用按位数判）。

| 表 | 关键列 | 含义 | → PDH | AI 解读要点 |
|---|---|---|---|---|
| **`msg`** | `msg_uuid`(PK), `msg_server_id`, `conversation_id`, `conversation_short_id`, `conversation_type`, `type`(int 消息形态), `index_in_conversation(_v2)`, `order_index`, `status`, `net_status`, `deleted`, `created_time`(epoch), `sender`(BIGINT uid), `content`(TEXT=ByteDance JSON), `ext`, `local_info`, `read_status`, `sec_sender`, `property_list` | 每条私信 | **EVENT** subtype=MESSAGE/INTERACTION，`occurredAt=created_time`，text=content 按 type 解 | 沟通频率/活跃时段/话题；`type` 区分形态；`deleted=1` 过滤；按 `conversation_id` 聚合对话；`sender` 是 uid（昵称查 `participant`/`conversation_core`）|
| **`conversation_list`** | `conversation_id`(PK), `short_id`, `type`, `last_msg_index`, `updated_time`, `unread_count`, `read_index`, `inbox`, `is_member`, `member_count`, `participant`(TEXT), `stranger`, `sort_order`, `is_in_box`, `badge_count` | 会话列表 | **TOPIC**（一个会话） | 活跃联系人、未读/拖延、`stranger` 陌生人；`participant` 列冗余存成员 |
| **`conversation_core`** | `conversation_id`(PK), `name`, `desc`, `icon`, `notice`, `owner_id`, `sec_owner`, `mode`, `info_version` | 会话元信息（群名/群主）| **TOPIC**.title/desc | 群名/群主/公告；`mode` 区分单聊/群聊 |
| **`participant`** | `user_id`(NN), `conversation_id`, `role`, `alias`, `sec_uid`, `sort_order`, `silent` | 会话成员（你聊的人）| **PERSON** subtype=CONTACT，id=`toutiao-uid`/`sec_uid` | 社交图谱、关系强度（共现会话）、`role` 群角色、`alias` 备注名 |
| **`attchment`**(原文拼写) | `uuid`, `local_uri`, `remote_uri`, `size`, `type`, `mime_type`, `hash`, `status`, `display_type` | 消息附件（图/视频/文件）| EVENT.extra / ITEM | 多媒体沟通；`mime_type` 区分类型 |
| **`mention`** | `uuid`(PK), `conversation_id`, `ids_str`, `sender_id`, `created_time` | @提及 | EVENT subtype=MENTION | 被@频率/群活跃 |
| **`conversation_setting`** | `conversation_id`(PK), `stick_top`, `mute`, `favor`, `set_top_time`, `push_status` | 会话设置 | TOPIC.extra | 置顶/免打扰/收藏偏好 |
| `msg_property_new` | `msg_uuid`, `key`, `sender`, `create_time`, `value` | 消息属性/表态（点赞等）| EVENT.extra | 互动质量 |
| `conversation_kv` / `message_kv` | `(conv_id\|uuid, key, value)` | 会话/消息 KV 扩展 | TOPIC/EVENT.extra | 杂项元数据 |
| `conversation_tag` | `conv_id`, `tag_id`, `tag_type` | 会话标签/分组 | TOPIC.extra | 会话分类 |
| `participant_read` | `user_id`, `conversation_id`, `read_index` | 成员已读位 | — | 已读回执/群已读 |

### 解密状态（2026-06-17 真机实测，重要）
- 加密库 `encrypted_<uid>_im.db` **是 SQLCipher**（首 16 字节=salt）。**frida hook `sqlite3_key`（libwcdb.so/libwcdb2.so，均导出，头条无 libmsaoaidsec 反 frida）已成功截获 raw key**（`x'<64hex key><32hex salt>'`，salt 与文件头一致）。
- ⚠️ 但用 better-sqlite3-multiple-ciphers 标准 SQLCipher 参数（compat 1-4 × HMAC SHA1/256/512 × page/plaintext-header）**未能解密**（72 组合全 "file is not a database"）——WCDB **自研 cipher 配置**（导出 `setDefaultCipherConfiguration(CipherVersion)`/`cipherHmacAlgorithm`/`cipherPlainTextHeaderSize`），非 vanilla SQLCipher，光有 key 还不够。
- **现实解密路径**：① 用 WCDB 自身库（带正确 CipherVersion 配置）离线解；或 ② frida 拿到 db handle 后**直接在 app 已解密连接上 `sqlite3_exec("SELECT ... FROM msg")` dump**（绕过 cipher 复现）。两者皆 frida/RE 量，详见 [[pdh_mem_salvage_one_tap_and_release_gotchas]]。

### AI 找数据指引（头条/抖音 IM）
- **私信**：`msg`（按 `conversation_id` 分组、`order_index` 排序、过滤 `deleted=1`）；会话元 `conversation_list`+`conversation_core`；成员 `participant.user_id`/`sec_uid`。
- ⚠️ 加密 → 须先解密（frida 截 key + WCDB 配置解，或 frida 直查 app 连接）。明文旧账号库可直读但常为空。

### UI 展示建议（头条/抖音 IM）
- `msg`+`conversation_list`+`conversation_core`+`participant` → **私信会话视图**（会话列表+气泡，群显 `conversation_core.name`）。
- `attchment` → 媒体气泡；`conversation_setting.stick_top/mute` → 置顶/免打扰标。

---

## 微信 WeChat（`com.tencent.mm`）— `schema-accurate`（完整 258 表 schema 已入库：`docs/internal/reference/wechat_schema.sql`，源自 sjqz 取证项目）

> 主库 `/data/data/com.tencent.mm/MicroMsg/<md5(uin)>/EnMicroMsg.db`（标准 SQLCipher）。
> 解密：① Method B 免密钥内存打捞（已真机验证，登录态下解密页在内存）② Method A frida 抓 key
> 离线解密（sjqz `tools/wechat/capture_key_*.py` + `libWCDB.so` hook）。
> **下列列定义为 sjqz `wechat_schema.sql` 实测 schema 的精确字段**（字段名级，未导出任何真实内容）。
> 258 张表里绝大多数是缓存/配置；个人数据核心是下面 5 张（message/rcontact/chatroom/conversation/userinfo）。
> 完整 258 表清单与解析逻辑见 sjqz `sql/wechat_schema.sql` + `docs/wechat_parser_module.md`。

### `message`（聊天消息）→ PDH **EVENT**(subtype `MESSAGE`/`INTERACTION`)

| 列 | 含义 | 备注 |
|---|---|---|
| `msgId` | 本地自增 id（PK）| |
| `msgSvrId` | 服务器消息 id | 跨设备唯一，做去重 |
| `type` | 消息类型码 | 见下方类型码表 |
| `isSend` | 0=收到 / 1=发出 | → actor=self(1) 或 talker(0) |
| `createTime` | 发送时间（epoch **ms**）| → occurredAt |
| `talker` | 对端 `wxid` 或 `<id>@chatroom`（群）| → 会话键；群消息 content 前缀 `wxid:\n` |
| `content` | 正文：type=1 纯文本；群聊为 `wxid:\n正文`；type≠1 多为 XML(`<msg>/<appmsg>`) | → content.text（群需剥前缀）|
| `imgPath` / `reserved` / `lvbuffer` | 图片缩略路径 / 预留 / 二进制附加 | |
| `status` `flag` `talkerId` `msgSeq` | 状态/标志/会话内序 | |

**`type` 类型码**：1=文本 · 3=图片 · 34=语音 · 42=名片 · 43/44=视频 · 47=表情 · 48=位置 · 49=富媒体(XML，子类型在 `<appmsg><type>`：5=链接 6=文件 8=自定义表情 33/36=小程序 2000=转账 2001=红包) · 50=音视频通话 · 10000=系统提示 · 10002=撤回。

### `rcontact`（联系人）→ PDH **PERSON**(subtype `CONTACT`；`verifyFlag≠0` → `MERCHANT` 公众号/服务号)

| 列 | 含义 |
|---|---|
| `username` | `wxid`（PK）或 `<id>@chatroom` | → identifiers `wechat-wxid` |
| `alias` | 微信号（用户自设）| → identifiers `wechat-alias` |
| `conRemark` | 备注名 | → names[0]（优先）|
| `nickname` | 昵称 | → names fallback |
| `type` | 联系人类型位掩码（好友/群/黑名单等）| |
| `verifyFlag` | ≠0=公众号/服务号 | → subtype MERCHANT |
| `pyInitial`/`quanPin` | 拼音首字母/全拼（搜索用）| |

### `chatroom`（群聊）→ PDH **TOPIC** + 成员 **PERSON**

| 列 | 含义 |
|---|---|
| `chatroomname` | `<id>@chatroom`（PK）| → TOPIC id |
| `memberlist` | 成员 `wxid` 分号分隔 | → 每个成员一个 PERSON + participant |
| `displayname` | 与 memberlist 对应的群昵称（分号分隔）| |
| `roomowner` | 群主 wxid | |
| `roomdata` | 成员详情（protobuf BLOB）| |
| `memberCount` | 群成员数 | |
| `chatroomnotice` | 群公告（文本）| → TOPIC.extra |
| `roomowner` | 群主 wxid | |
| `modifytime`/`addtime` | 修改/入群时间(LONG) | |

### `conversation`（会话列表 / 最近聊天）→ PDH **TOPIC**(会话摘要)

> sjqz 实测列：`conversation(unReadCount INTEGER, status INT, isSend INT, createTime LONG, username VARCHAR(40), content TEXT, reserved TEXT)`

| 列 | 含义 |
|---|---|
| `username` | 会话对端（wxid 或 `@chatroom`）→ 关联 message.talker / rcontact / chatroom |
| `unReadCount` | 未读数 → 关注度信号 |
| `content` | 最后一条消息摘要 |
| `createTime` | 最后活跃时间(LONG) → 会话排序 |
| `isSend`/`status` | 最后消息方向/状态 |

→ 直接给「会话列表 UI」用；AI 判断**活跃联系人/未读积压**的首选表（比全表扫 message 快）。

### 其它表 / 同账号其它库

| 表/库 | 含义 | → PDH |
|---|---|---|
| `userinfo`(id,value) | 本账号 KV（id 2=wxid 4=昵称 6=手机）| PERSON(self) |
| `ImgInfo2`/`videoinfo2`/`voiceinfo` | 图片/视频/语音文件索引 | ITEM(media) |
| `fmessage_conversation`/`_msginfo` | 好友验证/请求 | EVENT(INTERACTION) |
| `addr_upload2` | 上传的手机通讯录（手机号↔联系人）| PERSON 身份补全 |
| `SnsMicroMsg.db`：`SnsInfo`/`SnsComment` | 朋友圈条目/评论点赞 | EVENT(POST)/EVENT(LIKE) |
| `WxFileIndex.db` | 文件传输索引 | ITEM(file) |
| `FTS5IndexMicroMsg_*.db` | 全文搜索索引（含消息明文分词）| 备用检索源 |

### AI 找数据指引（WeChat）
- **「和某人的聊天」**：先在 `rcontact` 用 `conRemark`/`nickname` 找到 `username`(wxid)，再 `message WHERE talker=<wxid>`。
- **群聊**：`message WHERE talker LIKE '%@chatroom'`；群信息+成员在 `chatroom`。
- **好友/联系人数**：`rcontact` 按 `type` 位过滤（排除公众号 verifyFlag≠0）。
- **朋友圈**：`SnsMicroMsg.db.SnsInfo`。
- **时间**：`message.createTime` 是 **毫秒**（部分旧版为秒，按位数判）。

### UI 展示建议（WeChat）
- `message` → **会话时间线**（按 `talker` 分组的聊天气泡，isSend 决定左右）。
- `rcontact` → **通讯录列表**（备注名 + 头像）。
- `chatroom` → **群列表** + 成员面板。
- `SnsInfo` → **朋友圈 feed 卡片**。

---

## Android 系统数据 System Providers（明文，`device-verified` 2026-06-17）— **决策价值最高、最可靠**

> 采集脚本：`scripts/android/pdh-device-collect.mjs`（contacts 走 root 读库，sms/call/app/media 走 `adb content query`/`pm`/`find`）。全部**明文**，无需解密，是真机采集首选（远比加密 App IM 容易、量大）。落库适配器 = `system-data-android`（bridge 模式）。

**① 联系人** `contacts2.db`（`/data/data/com.android.providers.contacts/databases/`，明文；`content query` 被拒→须 root 读）

| 表 | 关键列 | 含义 | → PDH 实体 | AI 解读要点 |
|---|---|---|---|---|
| `raw_contacts` | `_id`,`display_name`,`deleted` | 联系人主记录 | **PERSON**(`CONTACT`) | `deleted=0` 才有效；`display_name` 常含**单位/职务**（"黄金鹏 支队长 莆田海渔局"）→ 可抽取组织/角色 |
| `data` + `mimetypes` | `data1`,`mimetype_id`→`mimetype` | 多值字段：`phone_v2`=电话 / `email_v2`=邮箱 | identifiers.phone/email | 一人多号；按 `raw_contact_id` 聚合；电话号是跨 SMS/通话 join 的主键 |

**② 短信** `content://sms`（或 `mmssms.db`，明文）→ **EVENT**(`MESSAGE`)

| 列 | 含义 | AI 解读 / 决策价值 |
|---|---|---|
| `address` | 对端号码/短号 | 银行(95xxx)/运营商/平台(106xxx) 可分类 |
| `body` | 正文 | **验证码短信=账号资产清单**（你注册了哪些 App：支付宝/微信/银行）；**账单/扣款短信=财务流水**；物流短信=消费 |
| `date` | 收到时间(ms) | 时间线 |
| `type` | 1=收 2=发 | 方向 |
| `thread_id` | 会话线程 | 按对端归并 |

**③ 通话记录** `content://call_log/calls`（或 `calllog.db`，明文）→ **EVENT**(`call`/通讯)

| 列 | 含义 | AI 解读 / 决策价值 |
|---|---|---|
| `number` | 号码 | join `contacts2.db` 得姓名（title 已是"拨打/来电 <姓名>"）|
| `date` | 时间(ms) | — |
| `duration` | 时长(秒) | 0=未接通 |
| `type` | 1=来电 2=去电 3=未接 4=语音留言 | **通话频次+时长+方向 → 关系强度/亲密度**（谁联系最多、最近联系是谁）→ 关系维护决策 |

**④ 媒体** `find /sdcard/{DCIM/Camera,Pictures,Movies,Download,Documents}`（仅元数据：path/size/mtime/ext）→ **ITEM**(`media-file`)

| 字段 | 含义 | AI 解读 / 决策价值 |
|---|---|---|
| `path` | 完整路径 | 目录即类别（Camera=拍摄/Download=下载）|
| `size`,`mtimeMs` | 大小/修改时间 | **拍照时间分布=活动/出行时间线**（集中拍照=旅行/活动）；大文件清理决策；按月聚合看生活节奏 |

**AI 找数据指引（系统数据）**：决策类问题优先查这里——「我都注册过哪些金融 App」→SMS 验证码 `body`；「最近谁联系我最多」→`call_log` 按 `number` 聚合频次；「我认识哪些某单位的人」→`contacts.display_name` 模糊匹配；「这个月我忙不忙」→media `mtime` + call/SMS 频次。
**UI 展示建议**：联系人通讯录（按拼音/星标）；短信时间线（按对端分组气泡）；通话记录（来/去/未接图标 + 时长 + 频次榜）；媒体按日期网格 + 月度热力图。
**敏感度**：高（真实身份/社交图谱/财务线索）；`legalGate` 适用，本人设备本人用途。

---

## AOSP 浏览器 MIUI Browser（`com.android.browser` → `browser2.db`，明文，`device-verified` 2026-06-17）

DB 文件：`/data/data/com.android.browser/databases/browser2.db`（明文；**注意≠Chrome**，schema 不同）

| 表 | 关键列 | 含义 | → PDH 实体 | AI 解读要点 |
|---|---|---|---|---|
| `history` | `_id`,`title`,`url`,`date`(ms),`visits` | 浏览历史 | **EVENT**(`browse`) | `date`=ms(1970)；`visits`=访问次数 |
| `bookmarks` | `title`,`url`,`folder`,`deleted` | 书签(folder=1)+部分历史 | ITEM/EVENT | `folder=0` 才是书签条目 |

**适配缺口**：仅有 `browser-history-chrome`/`-edge` 适配器（读 Chrome `urls`+`visits`，WebKit-µs 时间）。AOSP `browser2.db` 须**转 Chrome 形再喂**：建临时 `History`(urls+visits)，`visit_time=(date_ms+11644473600000)*1000`，然后 `syncAdapter("browser-history-chrome",{profilePath})`（见 `pdh-device-collect` 同款思路）。
**AI/决策**：浏览 `url` 域名分布=兴趣/关注；但本测试机多为应用市场/推送落地页（噪声多，需过滤 `*.market.xiaomi.com`/push 域）。**UI**：按域名聚合的访问 Top + 时间线。

---

## 微博 Weibo（`com.sina.weibo`，明文，`device-verified` 2026-06-17）

DB 文件（均明文 `SQLite format 3`，root 读）：`sina_weibo` / `message_<uid>.db` / `ArticleDb.db` / `Recent.db` / `UnreadDb.db`

| 库.表 | 关键列 | 含义 | → PDH 实体 | AI 解读要点 |
|---|---|---|---|---|
| `ArticleDb.long_text_table` | `_own_uid`,`_mid`,`_content` | **本人发的长微博正文** | **EVENT**(`POST`) | `_mid`=微博 id；`_content`=正文（兴趣/观点信号）|
| `sina_weibo.mblog_pic_table` | `mblogid`,`picid`,`*url` | 微博配图 | ITEM(图片) | 按 `mblogid` 关联到 post |
| `message_<uid>.db.t_session` | `session_id`,`last_msg_*` | 私信会话列表 | **TOPIC** | 本机为空壳(null)；填充账号有 `t_message`(t_buddy/t_group) |
| `sina_weibo.home_table`/`like_table`/`follower_table` | (填充账号才有) | 时间线/赞/粉丝 | EVENT/PERSON | 本测试账号无这些表→**旧 sqlite 适配器查这些表会静默 0 行**（已知坑）|

**适配状态**：`social-weibo` 适配器 **snapshot 模式**（`{schemaVersion:1,account:{uid},events:[{kind:"post",text,mid,picCount}]}` → `cc hub sync-adapter social-weibo --input`，已实测入库 + FTS5 可搜）。sqlite 模式查的表名与真机不符（坑）。
**AI/决策**：`long_text_table` 正文=公开表达/兴趣；**UI**：个人微博 feed 卡（正文+配图）。

---

## 模板（新增 App 照抄）

```
## <App 名>（<包名>）— <device-verified|inferred>
DB 文件：<路径>（引擎：标准 SQLCipher / WCDB2-custom / 明文）
| 表 | 关键列 | 含义 | → PDH 实体(EVENT/PERSON/TOPIC/ITEM + subtype) | AI 解读要点 |
adapter 适配状态：<已支持/缺口>
```

PDH 实体模型见 `packages/personal-data-hub/lib/constants.js`（ENTITY_TYPES / *_SUBTYPES）。
解密方法见 `pdh-db-decryption-runbook.md`；端点抓包见 `pdh-endpoint-capture-runbook.md`。
