# 数据字典 — QQ 频道guild_msg（`dec_qq_guild.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 27 张表 / 156 个字段。

### `direct_node_list_table` — directnode列表表

```sql
CREATE TABLE direct_node_list_table([40022] TEXT PRIMARY KEY,[40027] INTEGER,[40021] TEXT,[40050] INTEGER,[40011] INTEGER,[40003] INTEGER,[42051] INTEGER,[42052] INTEGER,[42053] TEXT,[42054] TEXT,[42055] TEXT,[42056] INTEGER,[42057] INTEGER,[40041] INTEGER,[43101] INTEGER,[40051] BLOB,[42058] INTEGER,[42059] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40022` | TEXT | QQ消息字段(编号40022, 含义社区未公开) |
| `40027` | INTEGER | 对端uid数字 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40003` | INTEGER | 消息seq序列号 |
| `42051` | INTEGER | QQ消息字段(编号42051, 含义社区未公开) |
| `42052` | INTEGER | QQ消息字段(编号42052, 含义社区未公开) |
| `42053` | TEXT | QQ消息字段(编号42053, 含义社区未公开) |
| `42054` | TEXT | QQ消息字段(编号42054, 含义社区未公开) |
| `42055` | TEXT | QQ消息字段(编号42055, 含义社区未公开) |
| `42056` | INTEGER | QQ消息字段(编号42056, 含义社区未公开) |
| `42057` | INTEGER | QQ消息字段(编号42057, 含义社区未公开) |
| `40041` | INTEGER | 消息流向 |
| `43101` | INTEGER | QQ消息字段(编号43101, 含义社区未公开) |
| `40051` | BLOB | QQ消息字段(编号40051, 含义社区未公开) |
| `42058` | INTEGER | QQ消息字段(编号42058, 含义社区未公开) |
| `42059` | INTEGER | QQ消息字段(编号42059, 含义社区未公开) |

### `direct_node_misc_table` — (direct_node_misc_table)

```sql
CREATE TABLE direct_node_misc_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `draft_storage_table` — 草稿storage表

```sql
CREATE TABLE draft_storage_table([43001] TEXT PRIMARY KEY,[43002] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `43001` | TEXT | QQ消息字段(编号43001, 含义社区未公开) |
| `43002` | BLOB | QQ消息字段(编号43002, 含义社区未公开) |

### `feed_rc_abstract_storage_table` — 信息流rcabstrac时间戳torage表

```sql
CREATE TABLE feed_rc_abstract_storage_table([49900] TEXT PRIMARY KEY,[49903] BLOB,[49904] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49900` | TEXT | QQ消息字段(编号49900, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |
| `49904` | INTEGER | QQ消息字段(编号49904, 含义社区未公开) |

### `folding_msg_storage_table` — 折叠ing消息storage表

```sql
CREATE TABLE folding_msg_storage_table([43001] TEXT PRIMARY KEY,[43002] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `43001` | TEXT | QQ消息字段(编号43001, 含义社区未公开) |
| `43002` | BLOB | QQ消息字段(编号43002, 含义社区未公开) |

### `guild_channel_feeds_storage_table_v2` — guild渠道信息流sstoragetable表

```sql
CREATE TABLE guild_channel_feeds_storage_table_v2([49901] TEXT,[49900] TEXT,[49908] INTEGER,[49903] BLOB,[49904] INTEGER,PRIMARY KEY ([49901],[49908]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49901` | TEXT | QQ消息字段(编号49901, 含义社区未公开) |
| `49900` | TEXT | QQ消息字段(编号49900, 含义社区未公开) |
| `49908` | INTEGER | QQ消息字段(编号49908, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |
| `49904` | INTEGER | QQ消息字段(编号49904, 含义社区未公开) |

### `guild_essence_feed_list_storage_table` — guildessence信息流列表storage表

```sql
CREATE TABLE guild_essence_feed_list_storage_table([49900] TEXT PRIMARY KEY,[49903] BLOB,[49904] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49900` | TEXT | QQ消息字段(编号49900, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |
| `49904` | INTEGER | QQ消息字段(编号49904, 含义社区未公开) |

### `guild_eventflow_time_storage_table` — guild事件流水时间storage表

```sql
CREATE TABLE guild_eventflow_time_storage_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `guild_feed_draft_table` — guild信息流草稿表

```sql
CREATE TABLE guild_feed_draft_table([49950] TEXT PRIMARY KEY,[49951] TEXT,[49952] INTEGER,[49953] TEXT,[49954] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49950` | TEXT | QQ消息字段(编号49950, 含义社区未公开) |
| `49951` | TEXT | QQ消息字段(编号49951, 含义社区未公开) |
| `49952` | INTEGER | QQ消息字段(编号49952, 含义社区未公开) |
| `49953` | TEXT | QQ消息字段(编号49953, 含义社区未公开) |
| `49954` | BLOB | QQ消息字段(编号49954, 含义社区未公开) |

### `guild_feed_list_storage_table_v2` — guild信息流列表storagetable表

```sql
CREATE TABLE guild_feed_list_storage_table_v2([49900] TEXT,[49905] INTEGER,[49908] INTEGER,[49903] BLOB,[49904] INTEGER,PRIMARY KEY ([49900],[49905],[49908]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49900` | TEXT | QQ消息字段(编号49900, 含义社区未公开) |
| `49905` | INTEGER | QQ消息字段(编号49905, 含义社区未公开) |
| `49908` | INTEGER | QQ消息字段(编号49908, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |
| `49904` | INTEGER | QQ消息字段(编号49904, 含义社区未公开) |

### `guild_feed_list_table` — guild信息流列表表

```sql
CREATE TABLE guild_feed_list_table([49902] TEXT PRIMARY KEY,[49909] INTEGER,[49903] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49902` | TEXT | QQ消息字段(编号49902, 含义社区未公开) |
| `49909` | INTEGER | QQ消息字段(编号49909, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |

### `guild_feed_notices_storage_table` — guild信息流通知/公告sstorage表

```sql
CREATE TABLE guild_feed_notices_storage_table([49900] TEXT,[49901] TEXT,[49907] INTEGER,[49903] BLOB,[49904] INTEGER,PRIMARY KEY ([49900],[49901],[49907]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49900` | TEXT | QQ消息字段(编号49900, 含义社区未公开) |
| `49901` | TEXT | QQ消息字段(编号49901, 含义社区未公开) |
| `49907` | INTEGER | QQ消息字段(编号49907, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |
| `49904` | INTEGER | QQ消息字段(编号49904, 含义社区未公开) |

### `guild_feed_storage_table` — guild信息流storage表

```sql
CREATE TABLE guild_feed_storage_table([49902] TEXT PRIMARY KEY,[49900] TEXT,[49901] TEXT,[49903] BLOB,[49904] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49902` | TEXT | QQ消息字段(编号49902, 含义社区未公开) |
| `49900` | TEXT | QQ消息字段(编号49900, 含义社区未公开) |
| `49901` | TEXT | QQ消息字段(编号49901, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |
| `49904` | INTEGER | QQ消息字段(编号49904, 含义社区未公开) |

### `guild_group_red_point_storage_table` — guild群/组红包积分storage表

```sql
CREATE TABLE guild_group_red_point_storage_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `guild_msg_flow_table` — guild消息流水表

```sql
CREATE TABLE guild_msg_flow_table([41711] INTEGER PRIMARY KEY,[41712] INTEGER,[41713] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41711` | INTEGER | QQ消息字段(编号41711, 含义社区未公开) |
| `41712` | INTEGER | QQ消息字段(编号41712, 含义社区未公开) |
| `41713` | BLOB | QQ消息字段(编号41713, 含义社区未公开) |

### `guild_msg_fts` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE guild_msg_fts([41701] TEXT,[41702] TEXT,[41703] TEXT,[41704] TEXT,[41705] TEXT,[41706] TEXT,[41707] TEXT,[41700] INTEGER PRIMARY KEY,[40001] INTEGER UNIQUE,[40050] INTEGER,[40003] INTEGER,[40010] INTEGER,[40021] TEXT,[40027] INTEGER,[40020] TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41701` | TEXT | QQ消息字段(编号41701, 含义社区未公开) |
| `41702` | TEXT | QQ消息字段(编号41702, 含义社区未公开) |
| `41703` | TEXT | QQ消息字段(编号41703, 含义社区未公开) |
| `41704` | TEXT | QQ消息字段(编号41704, 含义社区未公开) |
| `41705` | TEXT | QQ消息字段(编号41705, 含义社区未公开) |
| `41706` | TEXT | QQ消息字段(编号41706, 含义社区未公开) |
| `41707` | TEXT | QQ消息字段(编号41707, 含义社区未公开) |
| `41700` | INTEGER | QQ消息字段(编号41700, 含义社区未公开) |
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40020` | TEXT | 发送者uid(u_xxx) |

### `guild_msg_fts_fts` — 全文搜索索引(FTS,辅助表)

```sql
CREATE VIRTUAL TABLE guild_msg_fts_fts USING fts5(tokenize = 'pinyin_letter 0', content=guild_msg_fts, [41701], [41702], [41703], [41704], [41705], [41706], [41707], [41700] UNINDEXED, [40001] UNINDEXED, [40050] UNINDEXED, [40003] UNINDEXED, [40010] UNINDEXED, [40021] UNINDEXED, [40027] UNINDEXED, [40020] UNINDEXED)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41701` |  | QQ消息字段(编号41701, 含义社区未公开) |
| `41702` |  | QQ消息字段(编号41702, 含义社区未公开) |
| `41703` |  | QQ消息字段(编号41703, 含义社区未公开) |
| `41704` |  | QQ消息字段(编号41704, 含义社区未公开) |
| `41705` |  | QQ消息字段(编号41705, 含义社区未公开) |
| `41706` |  | QQ消息字段(编号41706, 含义社区未公开) |
| `41707` |  | QQ消息字段(编号41707, 含义社区未公开) |
| `41700` |  | QQ消息字段(编号41700, 含义社区未公开) |
| `40001` |  | msgId(本地消息ID,19位雪花长整型) |
| `40050` |  | 发送时间戳(秒,×1000=毫秒) |
| `40003` |  | 消息seq序列号 |
| `40010` |  | 消息归属(0自己/2群) |
| `40021` |  | 群号/对端QQ号(关联键) |
| `40027` |  | 对端uid数字 |
| `40020` |  | 发送者uid(u_xxx) |

### `guild_msg_fts_fts_config` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'guild_msg_fts_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `k` |  | (k) |
| `v` |  | (v) |

### `guild_msg_fts_fts_data` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'guild_msg_fts_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `block` | BLOB | 块 |

### `guild_msg_fts_fts_docsize` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'guild_msg_fts_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `sz` | BLOB | 大小 |

### `guild_msg_fts_fts_idx` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'guild_msg_fts_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `segid` |  | 段ID |
| `term` |  | 词条 |
| `pgno` |  | 页码 |

### `guild_msg_kv_storage_table` — guild消息键值storage表

```sql
CREATE TABLE guild_msg_kv_storage_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `guild_msg_table` — guild消息表

```sql
CREATE TABLE guild_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40004] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40021] TEXT,[40022] TEXT,[40025] TEXT,[40023] INTEGER,[40026] INTEGER,[40027] INTEGER,[40028] INTEGER,[40029] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40054] BLOB,[40061] BLOB,[40800] BLOB,[40900] BLOB,[40081] INTEGER,[40080] BLOB,[40082] INTEGER,[40090] TEXT,[40093] TEXT,[40100] INTEGER,[40600] BLOB,[40062] BLOB,[40063] BLOB,[40105] INTEGER,[40801] BLOB,[40850] INTEGER,[40601] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40004` | INTEGER | QQ消息字段(编号40004, 含义社区未公开) |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40022` | TEXT | QQ消息字段(编号40022, 含义社区未公开) |
| `40025` | TEXT | QQ消息字段(编号40025, 含义社区未公开) |
| `40023` | INTEGER | QQ消息字段(编号40023, 含义社区未公开) |
| `40026` | INTEGER | 会话标识 |
| `40027` | INTEGER | 对端uid数字 |
| `40028` | INTEGER | QQ消息字段(编号40028, 含义社区未公开) |
| `40029` | INTEGER | QQ消息字段(编号40029, 含义社区未公开) |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40054` | BLOB | QQ消息字段(编号40054, 含义社区未公开) |
| `40061` | BLOB | QQ消息字段(编号40061, 含义社区未公开) |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40081` | INTEGER | QQ消息字段(编号40081, 含义社区未公开) |
| `40080` | BLOB | 消息摘要文本 |
| `40082` | INTEGER | QQ消息字段(编号40082, 含义社区未公开) |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40062` | BLOB | QQ消息字段(编号40062, 含义社区未公开) |
| `40063` | BLOB | QQ消息字段(编号40063, 含义社区未公开) |
| `40105` | INTEGER | 引用消息信息 |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |

### `guild_msgbox_seqtime_storage_table` — guild消息box序号时间storage表

```sql
CREATE TABLE guild_msgbox_seqtime_storage_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `guild_msgbox_storage_table` — guild消息boxstorage表

```sql
CREATE TABLE guild_msgbox_storage_table([40021] TEXT,[10000] INTEGER,[40003] INTEGER,[48902] BLOB,PRIMARY KEY ([40021],[10000],[40003]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `10000` | INTEGER | QQ账号字段(编号10000, 含义社区未公开) |
| `40003` | INTEGER | 消息seq序列号 |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `guild_profile_feed_storage_table` — guild资料信息流storage表

```sql
CREATE TABLE guild_profile_feed_storage_table([49900] TEXT,[49906] INTEGER,[49903] BLOB,[49904] INTEGER,PRIMARY KEY ([49900],[49906]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49900` | TEXT | QQ消息字段(编号49900, 含义社区未公开) |
| `49906` | INTEGER | QQ消息字段(编号49906, 含义社区未公开) |
| `49903` | BLOB | QQ消息字段(编号49903, 含义社区未公开) |
| `49904` | INTEGER | QQ消息字段(编号49904, 含义社区未公开) |

### `msg_type_storage_table` — 消息类型storage表

```sql
CREATE TABLE msg_type_storage_table([49970] TEXT,[49971] TEXT,[49972] BLOB,PRIMARY KEY ([49970],[49971]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `49970` | TEXT | QQ消息字段(编号49970, 含义社区未公开) |
| `49971` | TEXT | QQ消息字段(编号49971, 含义社区未公开) |
| `49972` | BLOB | QQ消息字段(编号49972, 含义社区未公开) |

