# 数据字典 — QQ 杂项misc（`dec_qqmisc.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 39 张表 / 135 个字段。

### `config_mgr_table` — 配置管理(QQ)

```sql
CREATE TABLE config_mgr_table([82001] INTEGER PRIMARY KEY,[82002] INTEGER,[82003] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `82001` | INTEGER | QQ内部字段(编号82001, 含义社区未公开) |
| `82002` | INTEGER | QQ内部字段(编号82002, 含义社区未公开) |
| `82003` | BLOB | QQ内部字段(编号82003, 含义社区未公开) |

### `file_delete_kv_table` — 文件删除键值表

```sql
CREATE TABLE file_delete_kv_table([48901] TEXT PRIMARY KEY,[48902] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | INTEGER | QQ消息字段(编号48902, 含义社区未公开) |

### `file_exp_time_kv_table` — 文件exp时间键值表

```sql
CREATE TABLE file_exp_time_kv_table([48901] TEXT PRIMARY KEY,[48902] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | INTEGER | QQ消息字段(编号48902, 含义社区未公开) |

### `filebridge_cookie_buf_table` — 文件b请求IDgeCookie缓冲表

```sql
CREATE TABLE filebridge_cookie_buf_table([52831] TEXT PRIMARY KEY,[52832] BLOB,[52833] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `52831` | TEXT | QQ扩展字段(编号52831, 含义社区未公开) |
| `52832` | BLOB | QQ扩展字段(编号52832, 含义社区未公开) |
| `52833` | INTEGER | QQ扩展字段(编号52833, 含义社区未公开) |

### `filebridge_cookie_pb_table` — 文件b请求IDgeCookiepb表

```sql
CREATE TABLE filebridge_cookie_pb_table([52821] TEXT PRIMARY KEY,[52822] INTEGER,[52823] TEXT,[52824] TEXT,[52825] INTEGER,[52826] INTEGER,[52827] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `52821` | TEXT | QQ扩展字段(编号52821, 含义社区未公开) |
| `52822` | INTEGER | QQ扩展字段(编号52822, 含义社区未公开) |
| `52823` | TEXT | QQ扩展字段(编号52823, 含义社区未公开) |
| `52824` | TEXT | QQ扩展字段(编号52824, 含义社区未公开) |
| `52825` | INTEGER | QQ扩展字段(编号52825, 含义社区未公开) |
| `52826` | INTEGER | QQ扩展字段(编号52826, 含义社区未公开) |
| `52827` | BLOB | QQ扩展字段(编号52827, 含义社区未公开) |

### `filebridge_password_table` — 文件b请求IDgepass词表

```sql
CREATE TABLE filebridge_password_table([52810] INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,[52811] BLOB,[52812] INTEGER,[52814] INTEGER,[52815] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `52810` | INTEGER | QQ扩展字段(编号52810, 含义社区未公开) |
| `52811` | BLOB | QQ扩展字段(编号52811, 含义社区未公开) |
| `52812` | INTEGER | QQ扩展字段(编号52812, 含义社区未公开) |
| `52814` | INTEGER | QQ扩展字段(编号52814, 含义社区未公开) |
| `52815` | BLOB | QQ扩展字段(编号52815, 含义社区未公开) |

### `filebridge_table` — 文件b请求IDge表

```sql
CREATE TABLE filebridge_table([52800] TEXT,[52801] TEXT,[52802] TEXT,[52803] INTEGER,[52804] INTEGER,[52805] TEXT,[52806] INTEGER,PRIMARY KEY ([52800],[52805]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `52800` | TEXT | QQ扩展字段(编号52800, 含义社区未公开) |
| `52801` | TEXT | QQ扩展字段(编号52801, 含义社区未公开) |
| `52802` | TEXT | QQ扩展字段(编号52802, 含义社区未公开) |
| `52803` | INTEGER | QQ扩展字段(编号52803, 含义社区未公开) |
| `52804` | INTEGER | QQ扩展字段(编号52804, 含义社区未公开) |
| `52805` | TEXT | QQ扩展字段(编号52805, 含义社区未公开) |
| `52806` | INTEGER | QQ扩展字段(编号52806, 含义社区未公开) |

### `group_member_auth_info_kv_table` — 群/组成员授权信息键值表

```sql
CREATE TABLE group_member_auth_info_kv_table([48901] INTEGER PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | INTEGER | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `misc_kv_storage_table` — 杂项键值存储

```sql
CREATE TABLE misc_kv_storage_table([48901] TEXT PRIMARY KEY,[48902] TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | TEXT | QQ消息字段(编号48902, 含义社区未公开) |

### `msg_statistics_kv_table` — 消息统计istics键值表

```sql
CREATE TABLE msg_statistics_kv_table([48901] TEXT PRIMARY KEY,[48902] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | INTEGER | QQ消息字段(编号48902, 含义社区未公开) |

### `online_status_kv_table` — 在线状态键值

```sql
CREATE TABLE online_status_kv_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `public_account_kv_table` — 公众号键值

```sql
CREATE TABLE public_account_kv_table([48901] TEXT PRIMARY KEY,[48902] TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | TEXT | QQ消息字段(编号48902, 含义社区未公开) |

### `search_function_table_920` — search功能table920表

```sql
CREATE TABLE search_function_table_920([100311] TEXT,[100315] TEXT,[100310] INTEGER PRIMARY KEY,[100312] TEXT,[100321] TEXT,[100318] TEXT,[100319] INTEGER,[100320] INTEGER,[100322] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `100311` | TEXT | QQ账号字段(编号100311, 含义社区未公开) |
| `100315` | TEXT | QQ账号字段(编号100315, 含义社区未公开) |
| `100310` | INTEGER | QQ账号字段(编号100310, 含义社区未公开) |
| `100312` | TEXT | QQ账号字段(编号100312, 含义社区未公开) |
| `100321` | TEXT | QQ账号字段(编号100321, 含义社区未公开) |
| `100318` | TEXT | QQ账号字段(编号100318, 含义社区未公开) |
| `100319` | INTEGER | QQ账号字段(编号100319, 含义社区未公开) |
| `100320` | INTEGER | QQ账号字段(编号100320, 含义社区未公开) |
| `100322` | INTEGER | QQ账号字段(编号100322, 含义社区未公开) |

### `search_function_table_920_fts` — 全文搜索索引(FTS,辅助表)

```sql
CREATE VIRTUAL TABLE search_function_table_920_fts USING fts5(tokenize = 'pinyin_letter 1', content=search_function_table_920, [100311], [100315], [100310] UNINDEXED, [100312] UNINDEXED, [100321] UNINDEXED, [100318] UNINDEXED, [100319] UNINDEXED, [100320] UNINDEXED, [100322] UNINDEXED)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `100311` |  | QQ账号字段(编号100311, 含义社区未公开) |
| `100315` |  | QQ账号字段(编号100315, 含义社区未公开) |
| `100310` |  | QQ账号字段(编号100310, 含义社区未公开) |
| `100312` |  | QQ账号字段(编号100312, 含义社区未公开) |
| `100321` |  | QQ账号字段(编号100321, 含义社区未公开) |
| `100318` |  | QQ账号字段(编号100318, 含义社区未公开) |
| `100319` |  | QQ账号字段(编号100319, 含义社区未公开) |
| `100320` |  | QQ账号字段(编号100320, 含义社区未公开) |
| `100322` |  | QQ账号字段(编号100322, 含义社区未公开) |

### `search_function_table_920_fts_config` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_function_table_920_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `k` |  | (k) |
| `v` |  | (v) |

### `search_function_table_920_fts_data` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_function_table_920_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `block` | BLOB | 块 |

### `search_function_table_920_fts_docsize` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_function_table_920_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `sz` | BLOB | 大小 |

### `search_function_table_920_fts_idx` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_function_table_920_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `segid` |  | 段ID |
| `term` |  | 词条 |
| `pgno` |  | 页码 |

### `search_guild_group_member_table` — searchguild群/组成员表

```sql
CREATE TABLE search_guild_group_member_table([103603] TEXT,[103600] INTEGER,[103602] INTEGER,[103604] TEXT,PRIMARY KEY ([103600],[103602]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `103603` | TEXT | QQ账号字段(编号103603, 含义社区未公开) |
| `103600` | INTEGER | QQ账号字段(编号103600, 含义社区未公开) |
| `103602` | INTEGER | QQ账号字段(编号103602, 含义社区未公开) |
| `103604` | TEXT | QQ账号字段(编号103604, 含义社区未公开) |

### `search_guild_group_member_table_fts` — 全文搜索索引(FTS,辅助表)

```sql
CREATE VIRTUAL TABLE search_guild_group_member_table_fts USING fts5(tokenize = 'pinyin_letter 1', content=search_guild_group_member_table, [103603], [103600] UNINDEXED, [103602] UNINDEXED, [103604] UNINDEXED)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `103603` |  | QQ账号字段(编号103603, 含义社区未公开) |
| `103600` |  | QQ账号字段(编号103600, 含义社区未公开) |
| `103602` |  | QQ账号字段(编号103602, 含义社区未公开) |
| `103604` |  | QQ账号字段(编号103604, 含义社区未公开) |

### `search_guild_group_member_table_fts_config` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_member_table_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `k` |  | (k) |
| `v` |  | (v) |

### `search_guild_group_member_table_fts_data` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_member_table_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `block` | BLOB | 块 |

### `search_guild_group_member_table_fts_docsize` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_member_table_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `sz` | BLOB | 大小 |

### `search_guild_group_member_table_fts_idx` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_member_table_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `segid` |  | 段ID |
| `term` |  | 词条 |
| `pgno` |  | 页码 |

### `search_guild_group_table` — searchguild群/组表

```sql
CREATE TABLE search_guild_group_table([103502] TEXT,[103503] TEXT,[103500] INTEGER,[103501] INTEGER,[103504] INTEGER,[103505] INTEGER,[103506] INTEGER,[103507] INTEGER,[103508] INTEGER,PRIMARY KEY ([103500],[103501]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `103502` | TEXT | QQ账号字段(编号103502, 含义社区未公开) |
| `103503` | TEXT | QQ账号字段(编号103503, 含义社区未公开) |
| `103500` | INTEGER | QQ账号字段(编号103500, 含义社区未公开) |
| `103501` | INTEGER | QQ账号字段(编号103501, 含义社区未公开) |
| `103504` | INTEGER | QQ账号字段(编号103504, 含义社区未公开) |
| `103505` | INTEGER | QQ账号字段(编号103505, 含义社区未公开) |
| `103506` | INTEGER | QQ账号字段(编号103506, 含义社区未公开) |
| `103507` | INTEGER | QQ账号字段(编号103507, 含义社区未公开) |
| `103508` | INTEGER | QQ账号字段(编号103508, 含义社区未公开) |

### `search_guild_group_table_fts` — 全文搜索索引(FTS,辅助表)

```sql
CREATE VIRTUAL TABLE search_guild_group_table_fts USING fts5(tokenize = 'pinyin_letter 1', content=search_guild_group_table, [103502], [103503], [103500] UNINDEXED, [103501] UNINDEXED, [103504] UNINDEXED, [103505] UNINDEXED, [103506] UNINDEXED, [103507] UNINDEXED, [103508] UNINDEXED)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `103502` |  | QQ账号字段(编号103502, 含义社区未公开) |
| `103503` |  | QQ账号字段(编号103503, 含义社区未公开) |
| `103500` |  | QQ账号字段(编号103500, 含义社区未公开) |
| `103501` |  | QQ账号字段(编号103501, 含义社区未公开) |
| `103504` |  | QQ账号字段(编号103504, 含义社区未公开) |
| `103505` |  | QQ账号字段(编号103505, 含义社区未公开) |
| `103506` |  | QQ账号字段(编号103506, 含义社区未公开) |
| `103507` |  | QQ账号字段(编号103507, 含义社区未公开) |
| `103508` |  | QQ账号字段(编号103508, 含义社区未公开) |

### `search_guild_group_table_fts_config` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_table_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `k` |  | (k) |
| `v` |  | (v) |

### `search_guild_group_table_fts_data` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_table_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `block` | BLOB | 块 |

### `search_guild_group_table_fts_docsize` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_table_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `sz` | BLOB | 大小 |

### `search_guild_group_table_fts_idx` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_group_table_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `segid` |  | 段ID |
| `term` |  | 词条 |
| `pgno` |  | 页码 |

### `search_guild_table` — (search_guild_table)

```sql
CREATE TABLE search_guild_table([103403] TEXT,[103404] TEXT,[103400] INTEGER PRIMARY KEY,[103401] INTEGER,[103402] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `103403` | TEXT | QQ账号字段(编号103403, 含义社区未公开) |
| `103404` | TEXT | QQ账号字段(编号103404, 含义社区未公开) |
| `103400` | INTEGER | QQ账号字段(编号103400, 含义社区未公开) |
| `103401` | INTEGER | QQ账号字段(编号103401, 含义社区未公开) |
| `103402` | INTEGER | QQ账号字段(编号103402, 含义社区未公开) |

### `search_guild_table_fts` — 全文搜索索引(FTS,辅助表)

```sql
CREATE VIRTUAL TABLE search_guild_table_fts USING fts5(tokenize = 'pinyin_letter 1', content=search_guild_table, [103403], [103404], [103400] UNINDEXED, [103401] UNINDEXED, [103402] UNINDEXED)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `103403` |  | QQ账号字段(编号103403, 含义社区未公开) |
| `103404` |  | QQ账号字段(编号103404, 含义社区未公开) |
| `103400` |  | QQ账号字段(编号103400, 含义社区未公开) |
| `103401` |  | QQ账号字段(编号103401, 含义社区未公开) |
| `103402` |  | QQ账号字段(编号103402, 含义社区未公开) |

### `search_guild_table_fts_config` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_table_fts_config'(k PRIMARY KEY, v) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `k` |  | (k) |
| `v` |  | (v) |

### `search_guild_table_fts_data` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_table_fts_data'(id INTEGER PRIMARY KEY, block BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `block` | BLOB | 块 |

### `search_guild_table_fts_docsize` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_table_fts_docsize'(id INTEGER PRIMARY KEY, sz BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `sz` | BLOB | 大小 |

### `search_guild_table_fts_idx` — 全文搜索索引(FTS,辅助表)

```sql
CREATE TABLE 'search_guild_table_fts_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `segid` |  | 段ID |
| `term` |  | 词条 |
| `pgno` |  | 页码 |

### `service_assistant_kv_table` — 服务助手键值

```sql
CREATE TABLE service_assistant_kv_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `slow_mode_kv_storage_table` — slow模式键值storage表

```sql
CREATE TABLE slow_mode_kv_storage_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `ufs_search_box_sug_words_table` — ufssearchboxsug词s表

```sql
CREATE TABLE ufs_search_box_sug_words_table([48901] INTEGER PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | INTEGER | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

