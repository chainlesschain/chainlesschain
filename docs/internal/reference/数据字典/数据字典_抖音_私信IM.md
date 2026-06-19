# 数据字典 — 抖音 私信IM（`douyin_im_schema.sql`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 23 张表 / 175 个字段。

### `attchment` — 附件(图片/文件)

```sql
CREATE TABLE attchment(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `uuid` | TEXT | UUID |
| `local_uri` | TEXT | 本地路径 |
| `remote_uri` | TEXT | 远程URL |
| `size` | BIGINT | 大小 |
| `type` | TEXT | 类型 |
| `hash` | TEXT | 哈希 |
| `position` | INTEGER | 位置 |
| `status` | INTEGER | 状态 |
| `ext` | TEXT | 扩展 |
| `display_type` | TEXT | 显示类型 |
| `mime_type` | TEXT | MIME类型 |

### `conversation_core` — 会话/群核心信息

```sql
CREATE TABLE conversation_core(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `info_version` | BIGINT | 信息版本 |
| `name` | TEXT | 名称 |
| `desc` | TEXT | 描述 |
| `icon` | TEXT | 图标 |
| `notice` | TEXT | 通知/公告 |
| `owner_id` | INTEGER | 群主uid |
| `sec_owner` | TEXT | 群主sec_uid |
| `silent` | INTEGER | 静音 |
| `silent_normal_only` | INTEGER | 静音normalonly |
| `mode` | INTEGER | 模式 |
| `ext` | TEXT | 扩展 |
| `creator_uid` | INTEGER | 创建者uid |
| `create_time` | INTEGER | 创建时间 |
| `silent_source` | INTEGER | 静音来源 |
| `silent_util_time` | INTEGER | 静音util时间 |

### `conversation_kv` — 会话键值扩展

```sql
CREATE TABLE conversation_kv(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `conv_id` | TEXT | convID |
| `key` | TEXT | 键 |
| `value` | TEXT | 值 |
| `primary` | key | 主 |

### `conversation_list` — 会话列表(未读/排序)

```sql
CREATE TABLE conversation_list(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `short_id` | BIGINT | shortID |
| `type` | INTEGER | 类型 |
| `last_msg_index` | BIGINT | 最后消息位置 |
| `updated_time` | INTEGER | 更新d时间 |
| `unread_count` | INTEGER | 未读数 |
| `read_index` | BIGINT | 已读位置 |
| `inbox` | INTEGER | (inbox) |
| `min_index` | BIGINT | 最小索引 |
| `drafted_time` | INTEGER | 草稿ed时间 |
| `ticket` | TEXT | 票据 |
| `draft_content` | TEXT | 草稿内容 |
| `local_info` | TEXT | 本地态(JSON) |
| `is_member` | INTEGER | 是否成员 |
| `has_more` | INTEGER | (has_more) |
| `member_count` | INTEGER | 成员数 |
| `status` | INTEGER | 状态 |
| `participant` | TEXT | 成员(JSON) |
| `last_msg_order_index` | BIGINT | 最后消息顺序索引 |
| `stranger` | INTEGER | 是否陌生人 |
| `sort_order` | INTEGER | 排序 |
| `min_index_v2` | BIGINT | 最小索引v2 |
| `max_index_v2` | BIGINT | 最大索引v2 |
| `read_index_v2` | BIGINT | 已读索引v2 |
| `badge_count` | INTEGER | b广告ge数量 |
| `read_badge_count` | INTEGER | 已读b广告ge数量 |
| `is_in_box` | INTEGER | (is_in_box) |
| `sub_conversation_short_id` | BIGINT | sub会话shortID |
| `server_max_index_v2` | BIGINT | 服务器最大索引v2 |
| `last_show_msg_uuid` | TEXT | 最后显示消息UUID |

### `conversation_setting` — 会话设置(置顶/免打扰)

```sql
CREATE TABLE conversation_setting(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `info_version` | BIGINT | 信息版本 |
| `stick_top` | INTEGER | 是否置顶 |
| `mute` | INTEGER | 是否免打扰 |
| `ext` | TEXT | 扩展 |
| `favor` | INTEGER | 收藏 |

### `conversation_sub_info` — 会话sub表

```sql
CREATE TABLE conversation_sub_info(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `short_id` | BIGINT | shortID |
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `parent_conversation_id` | TEXT | 父会话ID |
| `parent_short_id` | BIGINT | 父shortID |
| `conversation_type` | INTEGER | 会话类型(0单聊/群另值) |
| `status` | INTEGER | 状态 |
| `biz_status` | TEXT | 业务状态 |
| `create_time` | BIGINT | 创建时间 |
| `modify_time` | BIGINT | 修改时间 |
| `ext` | TEXT | 扩展 |
| `inbox_type` | INTEGER | inbox类型 |
| `version` | BIGINT | 版本 |

### `conversation_unreadcount` — 会话未读数量表

```sql
CREATE TABLE conversation_unreadcount(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `type` | INTEGER | 类型 |
| `read_badge_count` | INTEGER | 已读b广告ge数量 |
| `badge_count` | INTEGER | b广告ge数量 |

### `mention` — @提及记录

```sql
CREATE TABLE mention(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `uuid` | TEXT | UUID |
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `ids_str` | TEXT | @的人ID串 |
| `sender_id` | BIGINT | 发送者ID |
| `created_time` | INTEGER | 创建d时间 |

### `message_kv` — 消息键值扩展

```sql
CREATE TABLE message_kv(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `uuid` | TEXT | UUID |
| `key` | TEXT | 键 |
| `value` | TEXT | 值 |
| `primary` | key | 主 |

### `msg` — 私信消息(ByteDance IM)

```sql
CREATE TABLE msg(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `msg_server_id` | BIGINT | 服务器消息ID(全局唯一) |
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `conversation_short_id` | BIGINT | 会话短ID(数字) |
| `conversation_type` | INTEGER | 会话类型(0单聊/群另值) |
| `type` | INTEGER | 类型 |
| `index_in_conversation` | BIGINT | 会话内序号(排序) |
| `order_index` | BIGINT | 排序索引 |
| `status` | INTEGER | 状态 |
| `net_status` | INTEGER | 网络状态 |
| `version` | INTEGER | 版本 |
| `deleted` | INTEGER | 已删除 |
| `created_time` | INTEGER | 创建d时间 |
| `sender` | BIGINT | 发送者 |
| `content` | TEXT | 内容 |
| `ext` | TEXT | 扩展 |
| `local_info` | TEXT | 本地态(JSON) |
| `read_status` | INTEGER | 已读状态 |
| `sec_sender` | TEXT | 发送者sec_uid(加密uid) |
| `property_list` | TEXT | 属性列表(JSON) |
| `index_in_conversation_v2` | BIGINT | 索引in会话v2 |
| `table_flag` | BIGINT | table标志 |
| `sub_conversation_short_id` | BIGINT | sub会话shortID |

### `msg_property_new` — 消息property表

```sql
CREATE TABLE msg_property_new(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `key` | TEXT | 键 |
| `idempotent_id` | TEXT | IDempotentID |
| `sender` | INTEGER | 发送者 |
| `sender_sec` | TEXT | 发送者sec |
| `create_time` | INTEGER | 创建时间 |
| `value` | TEXT | 值 |
| `deleted` | INTEGER | 已删除 |
| `version` | INTEGER | 版本 |
| `status` | INTEGER | 状态 |
| `PRIMARY` | KEY | 主 |

### `participant` — 会话成员

```sql
CREATE TABLE participant(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `user_id` | INTEGER | 用户ID |
| `sort_order` | INTEGER | 排序 |
| `role` | INTEGER | 角色 |
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `alias` | TEXT | 别名 |
| `sec_uid` | TEXT | secuid |
| `silent` | INTEGER | 静音 |
| `silent_time` | INTEGER | 静音时间 |
| `biz_role` | TEXT | 业务角色 |

### `participant_read` — participant已读表

```sql
CREATE TABLE participant_read(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `user_id` | INTEGER | 用户ID |
| `conversation_id` | TEXT | 会话ID(0:类型:uidA:uidB,关联conversation_core) |
| `min_index` | INTEGER | 最小索引 |
| `read_index` | INTEGER | 已读位置 |
| `read_order` | INTEGER | 已读顺序 |

### `share_merge_msg` — 分享merge消息表

```sql
CREATE TABLE share_merge_msg(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msg_id` | BIGINT | 消息ID |
| `card_conversation_id` | TEXT | 卡片会话ID |
| `msg_data` | TEXT | 消息数据 |
| `created_time` | INTEGER | 创建d时间 |
| `request_time` | INTEGER | 请求时间 |
| `primary` | key | 主 |

### `fts_im_conversation_docsize` — 全文索引im会话doc大小表

```sql
CREATE TABLE fts_im_conversation_docsize(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `docid` | INTEGER | docID |
| `size` | BLOB | 大小 |

### `fts_im_conversation_segdir` — 全文索引im会话段dir表

```sql
CREATE TABLE fts_im_conversation_segdir(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `level` | INTEGER | 级别 |
| `idx` | INTEGER | 索引 |
| `start_block` | INTEGER | 开始块 |
| `leaves_end_block` | INTEGER | leave发送块 |
| `end_block` | INTEGER | 结束块 |
| `root` | BLOB | 根 |
| `PRIMARY` | KEY | 主 |

### `fts_im_conversation_segments` — 全文索引im会话段s表

```sql
CREATE TABLE fts_im_conversation_segments(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `blockid` | INTEGER | 块ID |
| `block` | BLOB | 块 |

### `fts_im_conversation_stat` — 全文索引im会话stat表

```sql
CREATE TABLE fts_im_conversation_stat(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `value` | BLOB | 值 |

### `fts_im_message_docsize` — 全文索引im消息doc大小表

```sql
CREATE TABLE fts_im_message_docsize(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `docid` | INTEGER | docID |
| `size` | BLOB | 大小 |

### `fts_im_message_segdir` — 全文索引im消息段dir表

```sql
CREATE TABLE fts_im_message_segdir(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `level` | INTEGER | 级别 |
| `idx` | INTEGER | 索引 |
| `start_block` | INTEGER | 开始块 |
| `leaves_end_block` | INTEGER | leave发送块 |
| `end_block` | INTEGER | 结束块 |
| `root` | BLOB | 根 |
| `PRIMARY` | KEY | 主 |

### `fts_im_message_segments` — 全文索引im消息段s表

```sql
CREATE TABLE fts_im_message_segments(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `blockid` | INTEGER | 块ID |
| `block` | BLOB | 块 |

### `fts_im_message_stat` — 全文索引im消息stat表

```sql
CREATE TABLE fts_im_message_stat(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `value` | BLOB | 值 |

### `room_master_table` — 群master表

```sql
CREATE TABLE room_master_table(...)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `identity_hash` | TEXT | IDentity哈希 |

