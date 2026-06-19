# 数据字典 — 微信 朋友圈SnsMicroMsg（`sns.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 16 张表 / 173 个字段。

### `AdCanvasCacheInfo` — 广告canvas缓存表

```sql
CREATE TABLE AdCanvasCacheInfo (  cacheKey TEXT PRIMARY KEY ,  canvasId LONG,  canvasXml TEXT,  createTime LONG,  source INTEGER,  uxInfo TEXT,  dynamicInfo TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `cacheKey` | TEXT | 缓存键 |
| `canvasId` | LONG | canvasID |
| `canvasXml` | TEXT | canvasXML |
| `createTime` | LONG | 创建时间 |
| `source` | INTEGER | 来源 |
| `uxInfo` | TEXT | ux信息 |
| `dynamicInfo` | TEXT | dynamic信息 |

### `AdDynamicCanvasInfo` — 广告dynamiccanvas表

```sql
CREATE TABLE AdDynamicCanvasInfo (  key TEXT PRIMARY KEY ,  pageId TEXT,  createdTime LONG,  dynamicInfo TEXT,  dynamicCanvas TEXT,  onetimeCanvas TEXT,  extra TEXT,  extra1 TEXT,  extra2 TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `pageId` | TEXT | 页ID |
| `createdTime` | LONG | 创建d时间 |
| `dynamicInfo` | TEXT | dynamic信息 |
| `dynamicCanvas` | TEXT | (dynamicCanvas) |
| `onetimeCanvas` | TEXT | one时间canvas |
| `extra` | TEXT | 扩展 |
| `extra1` | TEXT | 扩展1 |
| `extra2` | TEXT | 扩展2 |

### `AdPullRecordsInfo` — 广告拉取记录

```sql
CREATE TABLE AdPullRecordsInfo (  traceid TEXT,  aid TEXT,  snsid TEXT,  storeTime LONG,  isAsync INTEGER default '0' ,  isSelected INTEGER default '1' ,  sessionKey TEXT,  ext TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `traceid` | TEXT | 追踪ID |
| `aid` | TEXT | aID |
| `snsid` | TEXT | 朋友圈ID |
| `storeTime` | LONG | 商店时间 |
| `isAsync` | INTEGER | 是否a同步 |
| `isSelected` | INTEGER | (isSelected) |
| `sessionKey` | TEXT | 会话键 |
| `ext` | TEXT | 扩展 |

### `CanvasInfo` — (CanvasInfo)

```sql
CREATE TABLE CanvasInfo (  canvasId LONG PRIMARY KEY ,  canvasXml TEXT,  createTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `canvasId` | LONG | canvasID |
| `canvasXml` | TEXT | canvasXML |
| `createTime` | LONG | 创建时间 |

### `SnsComment` — 朋友圈评论/点赞

```sql
CREATE TABLE SnsComment (  snsID LONG,  parentID LONG,  isRead SHORT default '0' ,  createTime INTEGER,  talker TEXT,  type INTEGER,  isSend INTEGER default 'false' ,  curActionBuf BLOB,  refActionBuf BLOB,  commentSvrID LONG,  clientId TEXT,  commentflag INTEGER,  isSilence INTEGER default '0' ,  springWishFlag INTEGER default '0' ,  msgRelevanceType INTEGER default '0' ,  isReminding INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `snsID` | LONG | 朋友圈ID |
| `parentID` | LONG | 父ID |
| `isRead` | SHORT | 是否已读 |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `type` | INTEGER | 类型 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `curActionBuf` | BLOB | cur动作缓冲 |
| `refActionBuf` | BLOB | 引用动作缓冲 |
| `commentSvrID` | LONG | 评论服务器ID |
| `clientId` | TEXT | 客户端ID |
| `commentflag` | INTEGER | 评论标志 |
| `isSilence` | INTEGER | (isSilence) |
| `springWishFlag` | INTEGER | springwish标志 |
| `msgRelevanceType` | INTEGER | 消息relevance类型 |
| `isReminding` | INTEGER | 是否re最小ding |

### `SnsCover` — 朋友圈封面

```sql
CREATE TABLE SnsCover (  userName TEXT default ''  PRIMARY KEY ,  type INTEGER,  snsBgId LONG,  thumbUrl TEXT,  imageBgUrl TEXT,  videoBgUrl TEXT,  localThumb TEXT,  localImage TEXT,  localVideo TEXT,  cacheVideo TEXT,  finderObject BLOB,  finderCheckTime LONG,  success INTEGER default 'false' ,  isLike INTEGER default 'false' ,  size LONG,  snsCoverOffset INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `userName` | TEXT | 用户名 |
| `type` | INTEGER | 类型 |
| `snsBgId` | LONG | 朋友圈背景ID |
| `thumbUrl` | TEXT | 缩略图链接 |
| `imageBgUrl` | TEXT | 图片背景链接 |
| `videoBgUrl` | TEXT | 视频背景链接 |
| `localThumb` | TEXT | 本地缩略图 |
| `localImage` | TEXT | 本地图片 |
| `localVideo` | TEXT | 本地视频 |
| `cacheVideo` | TEXT | 缓存视频 |
| `finderObject` | BLOB | 视频号object |
| `finderCheckTime` | LONG | 视频号check时间 |
| `success` | INTEGER | 成功 |
| `isLike` | INTEGER | 是否点赞 |
| `size` | LONG | 大小 |
| `snsCoverOffset` | INTEGER | 朋友圈封面偏移 |

### `SnsInfo` — 朋友圈动态(本人+好友; userName=发布者, createTime=发布时间, type=类型, likeFlag=已赞)

```sql
CREATE TABLE SnsInfo (  snsId LONG,  userName TEXT,  localFlag INTEGER,  createTime INTEGER,  head INTEGER,  localPrivate INTEGER,  type INTEGER,  sourceType INTEGER,  likeFlag INTEGER,  pravited INTEGER,  stringSeq TEXT,  withTa TEXT,  withTaHasOther INTEGER,  content BLOB,  attrBuf BLOB,  postBuf BLOB,  subType INTEGER,  serverExtFlag INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `snsId` | LONG | 朋友圈ID |
| `userName` | TEXT | 用户名 |
| `localFlag` | INTEGER | 本地标志 |
| `createTime` | INTEGER | 创建时间 |
| `head` | INTEGER | 头像 |
| `localPrivate` | INTEGER | 本地private |
| `type` | INTEGER | 类型 |
| `sourceType` | INTEGER | 来源类型 |
| `likeFlag` | INTEGER | 点赞标志 |
| `pravited` | INTEGER | (pravited) |
| `stringSeq` | TEXT | string序号 |
| `withTa` | TEXT | (withTa) |
| `withTaHasOther` | INTEGER | withtahas其它 |
| `content` | BLOB | 内容 |
| `attrBuf` | BLOB | attr缓冲 |
| `postBuf` | BLOB | post缓冲 |
| `subType` | INTEGER | 子类型 |
| `serverExtFlag` | INTEGER | 服务器扩展标志 |

### `SnsMedia` — 朋友圈媒体表

```sql
CREATE TABLE SnsMedia ( local_id INTEGER PRIMARY KEY, seqId LONG, type INT, createTime LONG, userName VARCHAR(40), totallen INT, offset INT, local_flag INT, tmp_path TEXT, nums INT, try_times INT, StrId VARCHAR(40), upload_buf TEXT, reserved1 INT, reserved2 TEXT, reserved3 TEXT, reserved4 TEXT, reserved5 TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `local_id` | INTEGER | 本地ID |
| `seqId` | LONG | 序号ID |
| `type` | INT | 类型 |
| `createTime` | LONG | 创建时间 |
| `userName` | VARCHAR(40) | 用户名 |
| `totallen` | INT | 总len |
| `offset` | INT | 偏移 |
| `local_flag` | INT | 本地标志 |
| `tmp_path` | TEXT | tmp路径 |
| `nums` | INT | 数量s |
| `try_times` | INT | try时间s |
| `StrId` | VARCHAR(40) | st请求ID |
| `upload_buf` | TEXT | 上传缓冲 |
| `reserved1` | INT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `reserved5` | TEXT | 保留5 |

### `SnsReportKv` — 朋友圈上报键值表

```sql
CREATE TABLE SnsReportKv (  logtime LONG,  offset INTEGER default '0' ,  logsize INTEGER,  errorcount INTEGER,  value BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `logtime` | LONG | 日志时间 |
| `offset` | INTEGER | 偏移 |
| `logsize` | INTEGER | 日志大小 |
| `errorcount` | INTEGER | 错误数量 |
| `value` | BLOB | 值 |

### `SnsWsFoldGroup` — 朋友圈ws折叠群/组表

```sql
CREATE TABLE SnsWsFoldGroup (  top LONG,  bottom LONG PRIMARY KEY ,  size INTEGER,  state INTEGER, memberList TEXT default '', tagId LONG default '0', count INTEGER default '0', tagName TEXT default '')
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `top` | LONG | 置顶 |
| `bottom` | LONG | 底部 |
| `size` | INTEGER | 大小 |
| `state` | INTEGER | 状态 |
| `memberList` | TEXT | 群成员wxid列表(;分隔) |
| `tagId` | LONG | 标签ID |
| `count` | INTEGER | 数量 |
| `tagName` | TEXT | 标签名称 |

### `SnsWsFoldGroupDetail` — 朋友圈折叠分组

```sql
CREATE TABLE SnsWsFoldGroupDetail (  groupId LONG PRIMARY KEY ,  groupTime INTEGER,  groupStrcut BLOB, memberList TEXT default '', tagId LONG default '0', count INTEGER default '0', tagName TEXT default '')
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `groupId` | LONG | 群ID |
| `groupTime` | INTEGER | 群/组时间 |
| `groupStrcut` | BLOB | 群/组str裁剪 |
| `memberList` | TEXT | 群成员wxid列表(;分隔) |
| `tagId` | LONG | 标签ID |
| `count` | INTEGER | 数量 |
| `tagName` | TEXT | 标签名称 |

### `UxCanvasInfo` — (UxCanvasInfo)

```sql
CREATE TABLE UxCanvasInfo (  canvasId TEXT PRIMARY KEY ,  canvasXml TEXT,  createTime LONG,  canvasExt TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `canvasId` | TEXT | canvasID |
| `canvasXml` | TEXT | canvasXML |
| `createTime` | LONG | 创建时间 |
| `canvasExt` | TEXT | canva性别t |

### `adsnsinfo` — 朋友圈广告

```sql
CREATE TABLE adsnsinfo (  snsId LONG,  userName TEXT,  localFlag INTEGER,  createTime INTEGER,  head INTEGER,  localPrivate INTEGER,  type INTEGER,  sourceType INTEGER,  likeFlag INTEGER,  pravited INTEGER,  stringSeq TEXT,  content BLOB,  attrBuf BLOB,  postBuf BLOB,  adinfo TEXT,  adxml TEXT,  createAdTime INTEGER,  exposureTime INTEGER,  firstControlTime INTEGER,  recxml TEXT,  subType INTEGER,  exposureCount INTEGER,  atAdinfo TEXT,  remindInfoGroup BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `snsId` | LONG | 朋友圈ID |
| `userName` | TEXT | 用户名 |
| `localFlag` | INTEGER | 本地标志 |
| `createTime` | INTEGER | 创建时间 |
| `head` | INTEGER | 头像 |
| `localPrivate` | INTEGER | 本地private |
| `type` | INTEGER | 类型 |
| `sourceType` | INTEGER | 来源类型 |
| `likeFlag` | INTEGER | 点赞标志 |
| `pravited` | INTEGER | (pravited) |
| `stringSeq` | TEXT | string序号 |
| `content` | BLOB | 内容 |
| `attrBuf` | BLOB | attr缓冲 |
| `postBuf` | BLOB | post缓冲 |
| `adinfo` | TEXT | 广告信息 |
| `adxml` | TEXT | 广告XML |
| `createAdTime` | INTEGER | 创建广告时间 |
| `exposureTime` | INTEGER | 曝光时间 |
| `firstControlTime` | INTEGER | 首co网络类型rol时间 |
| `recxml` | TEXT | recXML |
| `subType` | INTEGER | 子类型 |
| `exposureCount` | INTEGER | 曝光数量 |
| `atAdinfo` | TEXT | at广告信息 |
| `remindInfoGroup` | BLOB | re最小d信息群/组 |

### `snsDraft` — 朋友圈草稿

```sql
CREATE TABLE snsDraft (  key TEXT default ''  PRIMARY KEY ,  timestamp LONG default '0' ,  extFlag INTEGER default '0' ,  draft BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `timestamp` | LONG | 时间戳 |
| `extFlag` | INTEGER | 扩展标志 |
| `draft` | BLOB | 草稿 |

### `snsExtInfo3` — 朋友圈扩展信息

```sql
CREATE TABLE snsExtInfo3 (  userName TEXT default ''  PRIMARY KEY ,  md5 TEXT,  newerIds TEXT,  bgId TEXT,  bgUrl TEXT,  older_bgId TEXT,  local_flag INTEGER,  istyle INTEGER,  iFlag INTEGER,  icount INTEGER,  faultS BLOB,  snsBgId LONG,  snsuser BLOB,  adsession BLOB,  lastFirstPageRequestErrCode INTEGER,  lastFirstPageRequestErrType INTEGER,  snsYearMonthInfo BLOB,  albumMd5 TEXT,  imBGaeskey TEXT,  imBGauthkey TEXT,  imBGmd5sum TEXT,  imBGfileid TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `userName` | TEXT | 用户名 |
| `md5` | TEXT | MD5 |
| `newerIds` | TEXT | newe请求IDs |
| `bgId` | TEXT | 背景ID |
| `bgUrl` | TEXT | 背景链接 |
| `older_bgId` | TEXT | older背景ID |
| `local_flag` | INTEGER | 本地标志 |
| `istyle` | INTEGER | (istyle) |
| `iFlag` | INTEGER | i标志 |
| `icount` | INTEGER | i数量 |
| `faultS` | BLOB | faul时间戳 |
| `snsBgId` | LONG | 朋友圈背景ID |
| `snsuser` | BLOB | 朋友圈用户 |
| `adsession` | BLOB | 广告会话 |
| `lastFirstPageRequestErrCode` | INTEGER | 最后首页请求err码 |
| `lastFirstPageRequestErrType` | INTEGER | 最后首页请求err类型 |
| `snsYearMonthInfo` | BLOB | 朋友圈yearmo网络类型h信息 |
| `albumMd5` | TEXT | albumMD5 |
| `imBGaeskey` | TEXT | iMBgaes键 |
| `imBGauthkey` | TEXT | iMBg授权键 |
| `imBGmd5sum` | TEXT | iMBgMD5sum |
| `imBGfileid` | TEXT | iMBg文件ID |

### `snsTagInfo2` — 朋友圈标签信息2表

```sql
CREATE TABLE snsTagInfo2 (  tagId LONG default '0' ,  tagName TEXT default '' ,  count INTEGER default '0' ,  memberList TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `tagId` | LONG | 标签ID |
| `tagName` | TEXT | 标签名称 |
| `count` | INTEGER | 数量 |
| `memberList` | TEXT | 群成员wxid列表(;分隔) |

