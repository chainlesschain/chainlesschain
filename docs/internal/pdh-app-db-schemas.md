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

---

## 微信 WeChat（`com.tencent.mm`）— `inferred`（标准 SQLCipher，待真机解密填充）

`EnMicroMsg.db`（标准 SQLCipher，key=Method A frida hook 拿）。经典表（公开逆向已知，待本机实测确认列）：

| 表 | 含义 | → PDH | AI 解读 |
|---|---|---|---|
| `message` | 聊天消息（`talker`, `content`, `createTime`, `type`, `isSend`）| EVENT INTERACTION | 沟通网络/频率/话题 |
| `rcontact` | 联系人（`username`, `nickname`, `type`）| PERSON CONTACT | 社交图谱 |
| `chatroom` | 群（`chatroomname`, `memberlist`）| TOPIC | 群活跃度 |

> 待用 Method A 解密真机 `EnMicroMsg.db` 后把列名/单位改成 `device-verified`。

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
