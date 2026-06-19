# 数据字典 — 微信 状态TextStatus（`wxstatus.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 8 张表 / 141 个字段。

### `TextStatus` — 微信状态(我发布的状态/心情)

```sql
CREATE TABLE TextStatus (  UserName TEXT,  StatusID TEXT,  TopicId TEXT,  SourceID TEXT,  TopicInfo BLOB,  ClusterShowInfo BLOB,  IconID TEXT,  Description TEXT,  MediaType INTEGER,  MediaUrl TEXT,  MediaAESKey TEXT,  MediaThumbUrl TEXT,  MediaThumbAESKey TEXT,  PoiID TEXT,  PoiName TEXT,  Longitude DOUBLE,  Latitude DOUBLE,  Visibility INTEGER,  CreateTime INTEGER,  ExpireTime INTEGER,  LikeCount INTEGER,  state INTEGER,  backgroundId TEXT,  option LONG,  mediaWidth INTEGER,  mediaHeight INTEGER,  visibilityInfo TEXT,  referenceUserName TEXT,  referenceTextStatusId TEXT,  referenceCount INTEGER,  sceneType INTEGER,  duplicateUserName TEXT,  duplicateTextStatusId TEXT,  EmojiInfo BLOB,  statusExtInfoOriBytes BLOB,  ClusterId TEXT,  LikeCountVersion INTEGER,  profileSeq LONG,  CommentCount INTEGER,  City TEXT,  contentScore FLOAT,  HasHb INTEGER,  PrivateInfo BLOB,  PublicInfo BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `UserName` | TEXT | 用户名 |
| `StatusID` | TEXT | 状态ID |
| `TopicId` | TEXT | 话题ID |
| `SourceID` | TEXT | 来源ID |
| `TopicInfo` | BLOB | 话题信息 |
| `ClusterShowInfo` | BLOB | cluster显示信息 |
| `IconID` | TEXT | 图标ID |
| `Description` | TEXT | 描述 |
| `MediaType` | INTEGER | 媒体类型 |
| `MediaUrl` | TEXT | 媒体链接 |
| `MediaAESKey` | TEXT | 媒体aes键 |
| `MediaThumbUrl` | TEXT | 媒体缩略图链接 |
| `MediaThumbAESKey` | TEXT | 媒体缩略图aes键 |
| `PoiID` | TEXT | poiID |
| `PoiName` | TEXT | poi名称 |
| `Longitude` | DOUBLE | 经度 |
| `Latitude` | DOUBLE | 纬度 |
| `Visibility` | INTEGER | (Visibility) |
| `CreateTime` | INTEGER | 创建时间 |
| `ExpireTime` | INTEGER | 过期时间 |
| `LikeCount` | INTEGER | 点赞数量 |
| `state` | INTEGER | 状态 |
| `backgroundId` | TEXT | 背景ID |
| `option` | LONG | 选项 |
| `mediaWidth` | INTEGER | 媒体宽 |
| `mediaHeight` | INTEGER | 媒体高 |
| `visibilityInfo` | TEXT | visibility信息 |
| `referenceUserName` | TEXT | 引用erence用户名 |
| `referenceTextStatusId` | TEXT | 引用erence文本状态ID |
| `referenceCount` | INTEGER | 引用erence数量 |
| `sceneType` | INTEGER | 场景类型 |
| `duplicateUserName` | TEXT | duplicate用户名 |
| `duplicateTextStatusId` | TEXT | duplicate文本状态ID |
| `EmojiInfo` | BLOB | 表情信息 |
| `statusExtInfoOriBytes` | BLOB | 状态扩展信息ori字节 |
| `ClusterId` | TEXT | cluste请求ID |
| `LikeCountVersion` | INTEGER | 点赞数量版本 |
| `profileSeq` | LONG | 资料序号 |
| `CommentCount` | INTEGER | 评论数量 |
| `City` | TEXT | 城市 |
| `contentScore` | FLOAT | 内容分数 |
| `HasHb` | INTEGER | 哈希b |
| `PrivateInfo` | BLOB | private信息 |
| `PublicInfo` | BLOB | public信息 |

### `TextStatusComment` — 文本状态评论表

```sql
CREATE TABLE TextStatusComment (  CommentId TEXT,  FromUserName TEXT,  TextStatusId TEXT,  RootCommentId TEXT,  CommentContent TEXT,  CommentCount INTEGER,  CreateTime INTEGER,  TextStatusOwnerUserName TEXT,  Read INTEGER,  DeleteInMsgList INTEGER,  thumbUrl TEXT,  TopicInfo BLOB,  Description TEXT,  HasBeenDeleted INTEGER,  Option LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `CommentId` | TEXT | 评论ID |
| `FromUserName` | TEXT | from用户名 |
| `TextStatusId` | TEXT | 文本状态ID |
| `RootCommentId` | TEXT | 根评论ID |
| `CommentContent` | TEXT | 评论内容 |
| `CommentCount` | INTEGER | 评论数量 |
| `CreateTime` | INTEGER | 创建时间 |
| `TextStatusOwnerUserName` | TEXT | 文本状态群主/拥有者用户名 |
| `Read` | INTEGER | 已读 |
| `DeleteInMsgList` | INTEGER | 删除in消息列表 |
| `thumbUrl` | TEXT | 缩略图链接 |
| `TopicInfo` | BLOB | 话题信息 |
| `Description` | TEXT | 描述 |
| `HasBeenDeleted` | INTEGER | 是否be结束eleted |
| `Option` | LONG | 选项 |

### `TextStatusConversation` — 文本状态会话表

```sql
CREATE TABLE TextStatusConversation (  sessionId TEXT default ''  PRIMARY KEY ,  talker TEXT default '' ,  unReadCount INTEGER default '0' ,  status INTEGER default '0' ,  updateTime LONG default '0' ,  digest TEXT default '' ,  digestUser TEXT default '' ,  digestType TEXT default '' ,  lastMsgID LONG,  content TEXT,  isSend INTEGER,  placedFlag LONG default '0' ,  editingMsg TEXT,  type INTEGER,  actionPermission INTEGER,  scene INTEGER,  readStatus INTEGER,  senderUserName TEXT default '' ,  senderRoleType INTEGER default '0' ,  senderUserNameVersion INTEGER default '0' ,  isRedDot INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `sessionId` | TEXT | 会话ID |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `unReadCount` | INTEGER | 未读数量 |
| `status` | INTEGER | 状态 |
| `updateTime` | LONG | 更新时间 |
| `digest` | TEXT | 摘要 |
| `digestUser` | TEXT | 摘要用户 |
| `digestType` | TEXT | 摘要类型 |
| `lastMsgID` | LONG | 最后消息ID |
| `content` | TEXT | 内容 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `placedFlag` | LONG | placed标志 |
| `editingMsg` | TEXT | editing消息 |
| `type` | INTEGER | 类型 |
| `actionPermission` | INTEGER | 动作权限 |
| `scene` | INTEGER | 场景 |
| `readStatus` | INTEGER | 已读状态 |
| `senderUserName` | TEXT | 发送者用户名 |
| `senderRoleType` | INTEGER | 发送者角色类型 |
| `senderUserNameVersion` | INTEGER | 发送者用户名版本 |
| `isRedDot` | INTEGER | 是否红包dot |

### `TextStatusGreetingItem` — 文本状态greeting项表

```sql
CREATE TABLE TextStatusGreetingItem (  newMsgId LONG default '0'  PRIMARY KEY ,  session_id TEXT default '' ,  hash_username TEXT default '' ,  encUsername TEXT default '' ,  tag TEXT default '' ,  source_id TEXT default '' ,  canChatting INTEGER default '0' ,  plain TEXT default '' ,  createTime INTEGER,  Read INTEGER default '0' ,  status_id TEXT default '' ,  modify_count INTEGER default '0' ,  card_key LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `newMsgId` | LONG | new消息ID |
| `session_id` | TEXT | 会话ID |
| `hash_username` | TEXT | 是否h用户名 |
| `encUsername` | TEXT | enc用户名 |
| `tag` | TEXT | 标签 |
| `source_id` | TEXT | 来源ID |
| `canChatting` | INTEGER | can聊天ting |
| `plain` | TEXT | (plain) |
| `createTime` | INTEGER | 创建时间 |
| `Read` | INTEGER | 已读 |
| `status_id` | TEXT | 状态ID |
| `modify_count` | INTEGER | 修改数量 |
| `card_key` | LONG | 卡片键 |

### `TextStatusLike` — 文本状态点赞表

```sql
CREATE TABLE TextStatusLike (  TextStatusId TEXT,  HashUserName TEXT,  DisplayName TEXT,  HeadImgUrl TEXT,  Description TEXT,  Type INTEGER,  CreateTime INTEGER,  Notify INTEGER,  Read INTEGER,  thumbUrl TEXT,  TopicInfo BLOB,  DeleteInMsgList INTEGER,  Version INTEGER,  Option LONG,  LikeId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `TextStatusId` | TEXT | 文本状态ID |
| `HashUserName` | TEXT | 是否h用户名 |
| `DisplayName` | TEXT | 群成员群名片(;分隔,与memberlist同序) |
| `HeadImgUrl` | TEXT | 头像图片链接 |
| `Description` | TEXT | 描述 |
| `Type` | INTEGER | 类型 |
| `CreateTime` | INTEGER | 创建时间 |
| `Notify` | INTEGER | 通知 |
| `Read` | INTEGER | 已读 |
| `thumbUrl` | TEXT | 缩略图链接 |
| `TopicInfo` | BLOB | 话题信息 |
| `DeleteInMsgList` | INTEGER | 删除in消息列表 |
| `Version` | INTEGER | 版本 |
| `Option` | LONG | 选项 |
| `LikeId` | TEXT | 点赞ID |

### `TextStatusReference` — 文本状态引用erence表

```sql
CREATE TABLE TextStatusReference (  TextStatusId TEXT,  UserName TEXT,  CreateTime INTEGER,  thumbUrl TEXT,  Read INTEGER,  TopicInfo BLOB,  DeleteInMsgList INTEGER,  ShowType INTEGER,  Description TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `TextStatusId` | TEXT | 文本状态ID |
| `UserName` | TEXT | 用户名 |
| `CreateTime` | INTEGER | 创建时间 |
| `thumbUrl` | TEXT | 缩略图链接 |
| `Read` | INTEGER | 已读 |
| `TopicInfo` | BLOB | 话题信息 |
| `DeleteInMsgList` | INTEGER | 删除in消息列表 |
| `ShowType` | INTEGER | 显示类型 |
| `Description` | TEXT | 描述 |

### `TextStatusSessionInfo` — 状态会话信息

```sql
CREATE TABLE TextStatusSessionInfo (  sessionId TEXT default ''  PRIMARY KEY ,  talker TEXT default '' ,  updateTime LONG default '0' ,  selfUsername TEXT default '' ,  type INTEGER,  actionPermission INTEGER,  rejectMsg INTEGER,  disableSendMsg INTEGER,  senderUserName TEXT default '' ,  senderRoleType INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `sessionId` | TEXT | 会话ID |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `updateTime` | LONG | 更新时间 |
| `selfUsername` | TEXT | 自己用户名 |
| `type` | INTEGER | 类型 |
| `actionPermission` | INTEGER | 动作权限 |
| `rejectMsg` | INTEGER | reject消息 |
| `disableSendMsg` | INTEGER | 禁用发送消息 |
| `senderUserName` | TEXT | 发送者用户名 |
| `senderRoleType` | INTEGER | 发送者角色类型 |

### `TextStatusStrangerContact` — 文本状态陌生人联系人表

```sql
CREATE TABLE TextStatusStrangerContact (  sessionId TEXT default ''  PRIMARY KEY ,  userName TEXT default '' ,  nickname TEXT,  sex INTEGER,  province TEXT,  city TEXT,  signature TEXT,  bigHeadImgUrl TEXT,  smallHeadImgUrl TEXT,  textStatusExtInfo TEXT,  country TEXT,  textStatusId TEXT,  block INTEGER,  canTalk INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `sessionId` | TEXT | 会话ID |
| `userName` | TEXT | 用户名 |
| `nickname` | TEXT | 昵称 |
| `sex` | INTEGER | 性别 |
| `province` | TEXT | 省 |
| `city` | TEXT | 城市 |
| `signature` | TEXT | 签名 |
| `bigHeadImgUrl` | TEXT | big头像图片链接 |
| `smallHeadImgUrl` | TEXT | s商城头像图片链接 |
| `textStatusExtInfo` | TEXT | 文本状态扩展信息 |
| `country` | TEXT | 国家 |
| `textStatusId` | TEXT | 文本状态ID |
| `block` | INTEGER | 块 |
| `canTalk` | INTEGER | ca网络类型alk |

