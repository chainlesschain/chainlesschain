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

### `msg` 关键细节（IM 正文）
- `type`(int) 区分消息形态（文本/图片/卡片/系统）；`content` 是 ByteDance 消息 JSON，按 type 取文本。
- `created_time` 多为 epoch（秒/毫秒/微秒混用，按位数判，见 `im-db-parser.normalizeEpochMs`）。
- `deleted=1` 应过滤；按 `conversation_id` 聚合成一段对话；`order_index`/`index_in_conversation` 排序。
- ⚠️ `sender` 列存对端/自己 uid（大整数）；昵称/头像不在 msg 表，需另查用户表或 `participant`。

### AI 找数据指引（抖音）
- **私信**：`msg`（按 `conversation_id` 分组）；会话元信息 `conversation_list`；成员 `participant.user_id`。
- **看过的视频/兴趣**：`video_history`/内容缓存表（`aweme_id` + 时间戳）。
- **收藏**：`user_favorite`；**搜索**：`search_history`。
- ⚠️ 库加密（WCDB2 专有 cipher）→ 必须走 Method B 内存打捞（免密钥）；端点见 runbook。

### UI 展示建议（抖音）
- `msg`+`conversation_list`+`participant` → **私信会话视图**（会话列表 + 气泡）。
- `video_history`/内容缓存 → **观看历史/兴趣画像**（时间轴 + 标签云）。
- `user_favorite` → **收藏夹**；`search_history` → **搜索记录**。

---

## 微信 WeChat（`com.tencent.mm`）— `reference`（公开 DFIR；字段名级，未导出任何真实内容）

> 主库 `/data/data/com.tencent.mm/MicroMsg/<md5(uin)>/EnMicroMsg.db`（标准 SQLCipher）。
> 解密：① Method B 免密钥内存打捞（已真机验证可行，登录态下解密页在内存）② Method A frida
> 抓 key 离线解密。下表为**公开 DFIR 已知字段名**（abrignoni 等），本会话**未导出真实内容**；
> 真机实测列序后改标 `device-verified`。⚠️ 微信 8.x 为多库/分表，下列以经典 `EnMicroMsg.db`
> 结构为准，8.x 部分消息可能在分库（见库清单末尾）。

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

## 模板（新增 App 照抄）

```
## <App 名>（<包名>）— <device-verified|inferred>
DB 文件：<路径>（引擎：标准 SQLCipher / WCDB2-custom / 明文）
| 表 | 关键列 | 含义 | → PDH 实体(EVENT/PERSON/TOPIC/ITEM + subtype) | AI 解读要点 |
adapter 适配状态：<已支持/缺口>
```

PDH 实体模型见 `packages/personal-data-hub/lib/constants.js`（ENTITY_TYPES / *_SUBTYPES）。
解密方法见 `pdh-db-decryption-runbook.md`；端点抓包见 `pdh-endpoint-capture-runbook.md`。
