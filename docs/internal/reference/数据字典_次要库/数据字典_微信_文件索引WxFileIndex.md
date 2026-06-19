# 数据字典 — 微信 文件索引WxFileIndex（`dec_wxfile.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 6 张表 / 27 个字段。

### `WxFileIndex3` — 文件传输索引(收发文件的元信息:名/大小/时间)

```sql
CREATE TABLE WxFileIndex3 (  msgId LONG,  username TEXT,  msgType INTEGER,  msgSubType INTEGER,  path TEXT,  size LONG,  msgtime LONG,  hash BLOB,  diskSpace LONG,  linkUUID BLOB,  subIdx INTEGER,  detail TEXT,  flags LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `username` | TEXT | 用户名 |
| `msgType` | INTEGER | 消息类型 |
| `msgSubType` | INTEGER | 消息子类型 |
| `path` | TEXT | 路径 |
| `size` | LONG | 大小 |
| `msgtime` | LONG | 消息时间 |
| `hash` | BLOB | 哈希 |
| `diskSpace` | LONG | (diskSpace) |
| `linkUUID` | BLOB | 链接UUID |
| `subIdx` | INTEGER | sub索引 |
| `detail` | TEXT | 详情 |
| `flags` | LONG | 标志s |

### `WxFileIndexDirty` — wx文件索引dirty表

```sql
CREATE TABLE WxFileIndexDirty(msgId INTEGER PRIMARY KEY)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |

### `WxFileIndexDownloadMigration` — wx文件索引下载迁移表

```sql
CREATE TABLE WxFileIndexDownloadMigration(id INTEGER PRIMARY KEY, originalPath TEXT, targetPath TEXT, indexRowId INT, msgId INT, status INT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `originalPath` | TEXT | 原图路径 |
| `targetPath` | TEXT | 目标路径 |
| `indexRowId` | INT | 索引rowID |
| `msgId` | INT | 消息ID |
| `status` | INT | 状态 |

### `WxFileIndexLinkify` — wx文件索引链接ify表

```sql
CREATE TABLE WxFileIndexLinkify(id INTEGER PRIMARY KEY, originalPath TEXT, targetPath TEXT, status INT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `originalPath` | TEXT | 原图路径 |
| `targetPath` | TEXT | 目标路径 |
| `status` | INT | 状态 |

### `WxFileIndexRefresh` — 文件索引刷新记录

```sql
CREATE TABLE WxFileIndexRefresh(indexRowId INTEGER PRIMARY KEY)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `indexRowId` | INTEGER | 索引rowID |

### `WxFileIndexRegistry` — 文件索引注册

```sql
CREATE TABLE WxFileIndexRegistry(id INTEGER PRIMARY KEY, value BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `value` | BLOB | 值 |

