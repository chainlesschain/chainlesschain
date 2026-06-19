# 数据字典 — 微信 EnMicroMsg（`EnMicroMsg_decrypted.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 249 张表 / 3177 个字段。

### `AAPayRecord` — aa支付记录表

```sql
CREATE TABLE AAPayRecord (  payMsgId TEXT PRIMARY KEY ,  insertmsg INTEGER,  chatroom TEXT,  msgId LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `payMsgId` | TEXT | 支付消息ID |
| `insertmsg` | INTEGER | 插入消息 |
| `chatroom` | TEXT | 聊天群 |
| `msgId` | LONG | 消息ID |

### `AARecord` — aa记录表

```sql
CREATE TABLE AARecord (  billNo TEXT PRIMARY KEY ,  insertmsg INTEGER,  localMsgId LONG,  status INTEGER default '-1' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `billNo` | TEXT | (billNo) |
| `insertmsg` | INTEGER | 插入消息 |
| `localMsgId` | LONG | 本地消息ID |
| `status` | INTEGER | 状态 |

### `ABTestInfo` — ab测试表

```sql
CREATE TABLE ABTestInfo (  abtestkey TEXT PRIMARY KEY ,  value TEXT,  expId TEXT,  sequence LONG,  prioritylevel INTEGER,  startTime LONG,  endTime LONG,  noReport INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `abtestkey` | TEXT | ab测试键 |
| `value` | TEXT | 值 |
| `expId` | TEXT | expID |
| `sequence` | LONG | 序号uence |
| `prioritylevel` | INTEGER | 优先级级别 |
| `startTime` | LONG | 开始时间 |
| `endTime` | LONG | 结束时间 |
| `noReport` | INTEGER | no上报 |

### `ABTestItem` — ab测试项表

```sql
CREATE TABLE ABTestItem (  layerId TEXT PRIMARY KEY ,  business TEXT,  expId TEXT,  sequence LONG,  prioritylevel INTEGER default '0' ,  startTime LONG,  endTime LONG,  needReport INTEGER,  rawXML TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `layerId` | TEXT | layerID |
| `business` | TEXT | (business) |
| `expId` | TEXT | expID |
| `sequence` | LONG | 序号uence |
| `prioritylevel` | INTEGER | 优先级级别 |
| `startTime` | LONG | 开始时间 |
| `endTime` | LONG | 结束时间 |
| `needReport` | INTEGER | 是否上报 |
| `rawXML` | TEXT | 原始XML |

### `ActiveInfo` — 活跃度信息

```sql
CREATE TABLE ActiveInfo (  key INTEGER PRIMARY KEY  COLLATE NOCASE ,  mau INTEGER,  dau INTEGER,  useTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | INTEGER | 键 |
| `mau` | INTEGER | (mau) |
| `dau` | INTEGER | (dau) |
| `useTime` | LONG | 使用时间 |

### `AddContactAntispamTicket` — 广告d联系人反垃圾票据表

```sql
CREATE TABLE AddContactAntispamTicket (  userName TEXT,  scene INTEGER,  ticket TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `userName` | TEXT | 用户名 |
| `scene` | INTEGER | 场景 |
| `ticket` | TEXT | 票据 |

### `ApkChannelPatchInfo` — apk渠道补丁表

```sql
CREATE TABLE ApkChannelPatchInfo (  pkgName TEXT PRIMARY KEY ,  isServerPatch INTEGER default 'false' ,  patchPath TEXT,  newChannelApkPath TEXT,  taskStatus INTEGER,  appId TEXT,  scene INTEGER,  ssid INTEGER,  uiarea INTEGER,  noticeId INTEGER,  extInfo TEXT,  userSessionId TEXT,  startTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `pkgName` | TEXT | pkg名称 |
| `isServerPatch` | INTEGER | 是否服务器补丁 |
| `patchPath` | TEXT | 补丁路径 |
| `newChannelApkPath` | TEXT | new渠道apk路径 |
| `taskStatus` | INTEGER | task状态 |
| `appId` | TEXT | 应用ID |
| `scene` | INTEGER | 场景 |
| `ssid` | INTEGER | ssID |
| `uiarea` | INTEGER | (uiarea) |
| `noticeId` | INTEGER | 通知/公告ID |
| `extInfo` | TEXT | 扩展信息 |
| `userSessionId` | TEXT | 用户会话ID |
| `startTime` | LONG | 开始时间 |

### `AppInfo` — 小程序/应用信息

```sql
CREATE TABLE AppInfo (  appId TEXT default ''  PRIMARY KEY ,  appName TEXT,  appDiscription TEXT,  appIconUrl TEXT,  appStoreUrl TEXT,  appVersion INTEGER,  appWatermarkUrl TEXT,  packageName TEXT,  status INTEGER,  signature TEXT,  modifyTime LONG,  appName_en TEXT,  appName_tw TEXT,  appName_hk TEXT,  appDiscription_en TEXT,  appDiscription_tw TEXT,  appType TEXT,  openId TEXT,  authFlag INTEGER,  appInfoFlag INTEGER default '-1' ,  lvbuff BLOB,  serviceAppType INTEGER default '0' ,  serviceAppInfoFlag INTEGER default '0' ,  serviceShowFlag INTEGER default '0' ,  appSupportContentType LONG default '0' ,  svrAppSupportContentType LONG default '0' ,  packageInfos TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `appName` | TEXT | 应用名称 |
| `appDiscription` | TEXT | 应用discription |
| `appIconUrl` | TEXT | 应用图标链接 |
| `appStoreUrl` | TEXT | 应用商店链接 |
| `appVersion` | INTEGER | 应用版本 |
| `appWatermarkUrl` | TEXT | 应用水印链接 |
| `packageName` | TEXT | 包名称 |
| `status` | INTEGER | 状态 |
| `signature` | TEXT | 签名 |
| `modifyTime` | LONG | 修改时间 |
| `appName_en` | TEXT | 应用名称en |
| `appName_tw` | TEXT | 应用名称tw |
| `appName_hk` | TEXT | 应用名称hk |
| `appDiscription_en` | TEXT | 应用discriptionen |
| `appDiscription_tw` | TEXT | 应用discriptiontw |
| `appType` | TEXT | 应用类型 |
| `openId` | TEXT | openID |
| `authFlag` | INTEGER | 授权标志 |
| `appInfoFlag` | INTEGER | 应用信息标志 |
| `lvbuff` | BLOB | lv缓冲f |
| `serviceAppType` | INTEGER | 服务应用类型 |
| `serviceAppInfoFlag` | INTEGER | 服务应用信息标志 |
| `serviceShowFlag` | INTEGER | 服务显示标志 |
| `appSupportContentType` | LONG | 应用support内容类型 |
| `svrAppSupportContentType` | LONG | 服务器应用support内容类型 |
| `packageInfos` | TEXT | 包信息s |

### `AppMessage` — 应用消息表

```sql
CREATE TABLE AppMessage (  msgId LONG default '0'  PRIMARY KEY ,  xml TEXT,  appId TEXT,  title TEXT,  description TEXT,  source TEXT,  type INTEGER,  msgSvrId LONG,  msgTalker TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `xml` | TEXT | XML |
| `appId` | TEXT | 应用ID |
| `title` | TEXT | 标题 |
| `description` | TEXT | 描述 |
| `source` | TEXT | 来源 |
| `type` | INTEGER | 类型 |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `msgTalker` | TEXT | 消息talker |

### `AppSort` — 应用sort表

```sql
CREATE TABLE AppSort (  flag LONG default '0' ,  appId TEXT default '' ,  sortId INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `flag` | LONG | 标志 |
| `appId` | TEXT | 应用ID |
| `sortId` | INTEGER | sortID |

### `BackupMoveTime` — 备份move时间表

```sql
CREATE TABLE BackupMoveTime (  deviceId TEXT default '' ,  sessionName TEXT default '' ,  moveTime BLOB default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `deviceId` | TEXT | 设备ID |
| `sessionName` | TEXT | 会话名称 |
| `moveTime` | BLOB | move时间 |

### `BackupRecoverMsgListDataId` — 备份恢复消息列表数据ID表

```sql
CREATE TABLE BackupRecoverMsgListDataId (  msgListDataId TEXT PRIMARY KEY ,  sessionName TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgListDataId` | TEXT | 消息列表数据ID |
| `sessionName` | TEXT | 会话名称 |

### `BackupTempMoveTime` — 备份临时move时间表

```sql
CREATE TABLE BackupTempMoveTime (  sessionName TEXT default '' ,  startTime LONG default '0' ,  endTime LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `sessionName` | TEXT | 会话名称 |
| `startTime` | LONG | 开始时间 |
| `endTime` | LONG | 结束时间 |

### `BizAdInfo` — 业务广告表

```sql
CREATE TABLE BizAdInfo (  aId TEXT PRIMARY KEY ,  msgId LONG,  exposeTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `aId` | TEXT | aID |
| `msgId` | LONG | 消息ID |
| `exposeTime` | LONG | expose时间 |

### `BizAppMsgReportContext` — 业务应用消息上报上下文表

```sql
CREATE TABLE BizAppMsgReportContext (  appMsgReportContextId LONG PRIMARY KEY ,  url TEXT,  reportTime LONG,  aScene INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appMsgReportContextId` | LONG | 应用消息上报上下文ID |
| `url` | TEXT | 链接 |
| `reportTime` | LONG | 上报时间 |
| `aScene` | INTEGER | a场景 |

### `BizBlockFinderInfo` — 业务块视频号表

```sql
CREATE TABLE BizBlockFinderInfo (  bizUsername TEXT PRIMARY KEY ,  finderUsername TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `bizUsername` | TEXT | 业务用户名 |
| `finderUsername` | TEXT | 视频号用户名 |

### `BizChatConversation` — 业务聊天会话表

```sql
CREATE TABLE BizChatConversation (  bizChatId LONG PRIMARY KEY ,  brandUserName TEXT,  unReadCount INTEGER,  newUnReadCount INTEGER,  lastMsgID LONG,  lastMsgTime LONG,  content TEXT,  digest TEXT default '' ,  digestUser TEXT default '' ,  atCount INTEGER default '0' ,  editingMsg TEXT,  chatType INTEGER,  status INTEGER default '0' ,  isSend INTEGER default '0' ,  msgType TEXT default '' ,  msgCount INTEGER default '0' ,  flag LONG default '0' ,  atAll INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `bizChatId` | LONG | 业务聊天ID |
| `brandUserName` | TEXT | 品牌用户名 |
| `unReadCount` | INTEGER | 未读数量 |
| `newUnReadCount` | INTEGER | new未读数量 |
| `lastMsgID` | LONG | 最后消息ID |
| `lastMsgTime` | LONG | 最后消息时间 |
| `content` | TEXT | 内容 |
| `digest` | TEXT | 摘要 |
| `digestUser` | TEXT | 摘要用户 |
| `atCount` | INTEGER | at数量 |
| `editingMsg` | TEXT | editing消息 |
| `chatType` | INTEGER | 聊天类型 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `msgType` | TEXT | 消息类型 |
| `msgCount` | INTEGER | 消息数量 |
| `flag` | LONG | 标志 |
| `atAll` | INTEGER | (atAll) |

### `BizChatInfo` — 业务聊天表

```sql
CREATE TABLE BizChatInfo (  bizChatLocalId LONG PRIMARY KEY ,  bizChatServId TEXT,  brandUserName TEXT default '' ,  chatType INTEGER,  headImageUrl TEXT,  chatName TEXT default '' ,  chatNamePY TEXT default '' ,  chatVersion INTEGER default '-1' ,  needToUpdate INTEGER default 'true' ,  bitFlag INTEGER default '0' ,  maxMemberCnt INTEGER default '0' ,  ownerUserId TEXT,  userList TEXT,  addMemberUrl TEXT,  roomflag INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `bizChatLocalId` | LONG | 业务聊天本地ID |
| `bizChatServId` | TEXT | 业务聊天servID |
| `brandUserName` | TEXT | 品牌用户名 |
| `chatType` | INTEGER | 聊天类型 |
| `headImageUrl` | TEXT | 头像图片链接 |
| `chatName` | TEXT | 聊天名称 |
| `chatNamePY` | TEXT | 聊天名称py |
| `chatVersion` | INTEGER | 聊天版本 |
| `needToUpdate` | INTEGER | 是否to更新 |
| `bitFlag` | INTEGER | 位标志 |
| `maxMemberCnt` | INTEGER | 最大成员cnt |
| `ownerUserId` | TEXT | 群主/拥有者用户ID |
| `userList` | TEXT | 用户列表 |
| `addMemberUrl` | TEXT | 广告d成员链接 |
| `roomflag` | INTEGER | 群标志 |

### `BizChatMyUserInfo` — 业务聊天我的用户表

```sql
CREATE TABLE BizChatMyUserInfo (  brandUserName TEXT PRIMARY KEY ,  userId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `brandUserName` | TEXT | 品牌用户名 |
| `userId` | TEXT | 用户ID |

### `BizChatUserInfo` — 业务聊天用户表

```sql
CREATE TABLE BizChatUserInfo (  userId TEXT PRIMARY KEY ,  userName TEXT default '' ,  userNamePY TEXT default '' ,  brandUserName TEXT default '' ,  UserVersion INTEGER default '-1' ,  needToUpdate INTEGER default 'true' ,  headImageUrl TEXT,  profileUrl TEXT,  bitFlag INTEGER default '0' ,  addMemberUrl TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `userId` | TEXT | 用户ID |
| `userName` | TEXT | 用户名 |
| `userNamePY` | TEXT | 用户名py |
| `brandUserName` | TEXT | 品牌用户名 |
| `UserVersion` | INTEGER | 用户版本 |
| `needToUpdate` | INTEGER | 是否to更新 |
| `headImageUrl` | TEXT | 头像图片链接 |
| `profileUrl` | TEXT | 资料链接 |
| `bitFlag` | INTEGER | 位标志 |
| `addMemberUrl` | TEXT | 广告d成员链接 |

### `BizContactConversationMassSend` — 业务联系人会话群发发送表

```sql
CREATE TABLE BizContactConversationMassSend (  msgId LONG PRIMARY KEY ,  createTime LONG,  massSendType INTEGER default '0' ,  clusterType INTEGER default '0' ,  scene INTEGER default '0' ,  talker TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `createTime` | LONG | 创建时间 |
| `massSendType` | INTEGER | 群发发送类型 |
| `clusterType` | INTEGER | cluster类型 |
| `scene` | INTEGER | 场景 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |

### `BizEnterprise` — 业务企业表

```sql
CREATE TABLE BizEnterprise (  userName TEXT PRIMARY KEY ,  qyUin INTEGER,  userUin INTEGER,  userFlag INTEGER,  wwExposeTimes INTEGER,  wwMaxExposeTimes INTEGER,  wwCorpId LONG,  wwUserVid LONG,  userType INTEGER,  chatOpen INTEGER,  wwUnreadCnt INTEGER default '0' ,  show_confirm INTEGER,  use_preset_banner_tips INTEGER,  hide_create_chat INTEGER,  hide_mod_chat_member INTEGER,  hide_colleage_invite INTEGER default 'true' ,  raw_attrs BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `userName` | TEXT | 用户名 |
| `qyUin` | INTEGER | qyQQ号/UIN |
| `userUin` | INTEGER | 用户QQ号/UIN |
| `userFlag` | INTEGER | 用户标志 |
| `wwExposeTimes` | INTEGER | wwexpose时间s |
| `wwMaxExposeTimes` | INTEGER | ww最大expose时间s |
| `wwCorpId` | LONG | wwcorpID |
| `wwUserVid` | LONG | ww用户vID |
| `userType` | INTEGER | 用户类型 |
| `chatOpen` | INTEGER | 聊天open |
| `wwUnreadCnt` | INTEGER | ww未读cnt |
| `show_confirm` | INTEGER | 显示确认 |
| `use_preset_banner_tips` | INTEGER | 使用preset横幅提示 |
| `hide_create_chat` | INTEGER | hIDe创建聊天 |
| `hide_mod_chat_member` | INTEGER | hIDemod聊天成员 |
| `hide_colleage_invite` | INTEGER | hIDecolleage邀请 |
| `raw_attrs` | BLOB | 原始attrs |

### `BizFollowedContactDigest` — 业务关注ed联系人摘要表

```sql
CREATE TABLE BizFollowedContactDigest (  bizUsername TEXT default ''  PRIMARY KEY ,  updateTime LONG default '0' ,  digest TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `bizUsername` | TEXT | 业务用户名 |
| `updateTime` | LONG | 更新时间 |
| `digest` | TEXT | 摘要 |

### `BizKF` — 业务kf表

```sql
CREATE TABLE BizKF (  openId TEXT PRIMARY KEY ,  brandUsername TEXT default '' ,  headImgUrl TEXT,  nickname TEXT,  kfType INTEGER,  updateTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `openId` | TEXT | openID |
| `brandUsername` | TEXT | 品牌用户名 |
| `headImgUrl` | TEXT | 头像图片链接 |
| `nickname` | TEXT | 昵称 |
| `kfType` | INTEGER | kf类型 |
| `updateTime` | LONG | 更新时间 |

### `BizPhotoSingleMsgInfo` — 业务照片单消息表

```sql
CREATE TABLE BizPhotoSingleMsgInfo (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  lvbuffer BLOB,  talkerId INTEGER,  isExpand INTEGER,  orderFlag LONG default '0' ,  hasShow INTEGER default '1' ,  placeTop INTEGER default '1' ,  appMsgStatInfoProto BLOB,  isRead INTEGER default '0' ,  bitFlag INTEGER default '0' ,  bizClientMsgId TEXT default '' ,  rankSessionId TEXT default '' ,  recommendCardId TEXT default '' ,  isValidExposed INTEGER,  resortBuffer TEXT default '' ,  recycleCardType INTEGER default '0' ,  recommendReason TEXT default '' ,  originBitFlag INTEGER default '0' ,  mergeShowTime LONG,  mergeCount INTEGER default '0' ,  notifyMsgId TEXT default '' ,  notifyMsgBlockFlag INTEGER,  silentFoldMsgReadStatus INTEGER,  mpArticleKey TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `isExpand` | INTEGER | 是否展开 |
| `orderFlag` | LONG | 顺序标志 |
| `hasShow` | INTEGER | 是否显示 |
| `placeTop` | INTEGER | place置顶 |
| `appMsgStatInfoProto` | BLOB | 应用消息stat信息proto |
| `isRead` | INTEGER | 是否已读 |
| `bitFlag` | INTEGER | 位标志 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `rankSessionId` | TEXT | 排名会话ID |
| `recommendCardId` | TEXT | 推荐卡片ID |
| `isValidExposed` | INTEGER | 是否有效exposed |
| `resortBuffer` | TEXT | resort缓冲 |
| `recycleCardType` | INTEGER | recycle卡片类型 |
| `recommendReason` | TEXT | 推荐原因 |
| `originBitFlag` | INTEGER | 原始位标志 |
| `mergeShowTime` | LONG | merge显示时间 |
| `mergeCount` | INTEGER | merge数量 |
| `notifyMsgId` | TEXT | 通知消息ID |
| `notifyMsgBlockFlag` | INTEGER | 通知消息块标志 |
| `silentFoldMsgReadStatus` | INTEGER | 静音折叠消息已读状态 |
| `mpArticleKey` | TEXT | mparticle键 |

### `BizRecExposeInfo` — 业务recexpose表

```sql
CREATE TABLE BizRecExposeInfo (  exposeId TEXT PRIMARY KEY ,  msgId LONG,  exposeTime LONG,  exposeType INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `exposeId` | TEXT | exposeID |
| `msgId` | LONG | 消息ID |
| `exposeTime` | LONG | expose时间 |
| `exposeType` | INTEGER | expose类型 |

### `BizScreenshotInfo` — 业务screenshot表

```sql
CREATE TABLE BizScreenshotInfo (  screenshotMd5 TEXT PRIMARY KEY ,  screenshotPath TEXT,  url TEXT,  screenshotTime LONG,  biz LONG,  mid LONG,  idx LONG,  itemShowType INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `screenshotMd5` | TEXT | screenshotMD5 |
| `screenshotPath` | TEXT | screenshot路径 |
| `url` | TEXT | 链接 |
| `screenshotTime` | LONG | screenshot时间 |
| `biz` | LONG | 业务 |
| `mid` | LONG | mID |
| `idx` | LONG | 索引 |
| `itemShowType` | INTEGER | 项显示类型 |

### `BizTimeLineInfo` — 业务时间线表

```sql
CREATE TABLE BizTimeLineInfo (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  lvbuffer BLOB,  talkerId INTEGER,  isExpand INTEGER,  orderFlag LONG default '0' ,  hasShow INTEGER default '1' ,  placeTop INTEGER default '1' ,  appMsgStatInfoProto BLOB,  isRead INTEGER default '0' ,  bitFlag INTEGER default '0' ,  bizClientMsgId TEXT default '' ,  rankSessionId TEXT default '' ,  recommendCardId TEXT default '' ,  isValidExposed INTEGER,  resortBuffer TEXT default '' ,  recycleCardType INTEGER default '0' ,  recommendReason TEXT default '' ,  originBitFlag INTEGER default '0' ,  mergeShowTime LONG,  mergeCount INTEGER default '0' ,  notifyMsgId TEXT default '' ,  notifyMsgBlockFlag INTEGER,  silentFoldMsgReadStatus INTEGER,  mpArticleKey TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `isExpand` | INTEGER | 是否展开 |
| `orderFlag` | LONG | 顺序标志 |
| `hasShow` | INTEGER | 是否显示 |
| `placeTop` | INTEGER | place置顶 |
| `appMsgStatInfoProto` | BLOB | 应用消息stat信息proto |
| `isRead` | INTEGER | 是否已读 |
| `bitFlag` | INTEGER | 位标志 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `rankSessionId` | TEXT | 排名会话ID |
| `recommendCardId` | TEXT | 推荐卡片ID |
| `isValidExposed` | INTEGER | 是否有效exposed |
| `resortBuffer` | TEXT | resort缓冲 |
| `recycleCardType` | INTEGER | recycle卡片类型 |
| `recommendReason` | TEXT | 推荐原因 |
| `originBitFlag` | INTEGER | 原始位标志 |
| `mergeShowTime` | LONG | merge显示时间 |
| `mergeCount` | INTEGER | merge数量 |
| `notifyMsgId` | TEXT | 通知消息ID |
| `notifyMsgBlockFlag` | INTEGER | 通知消息块标志 |
| `silentFoldMsgReadStatus` | INTEGER | 静音折叠消息已读状态 |
| `mpArticleKey` | TEXT | mparticle键 |

### `BizTimeLineSingleMsgInfo` — 业务时间线单消息表

```sql
CREATE TABLE BizTimeLineSingleMsgInfo (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  lvbuffer BLOB,  talkerId INTEGER,  isExpand INTEGER,  orderFlag LONG default '0' ,  hasShow INTEGER default '1' ,  placeTop INTEGER default '1' ,  appMsgStatInfoProto BLOB,  isRead INTEGER default '0' ,  bitFlag INTEGER default '0' ,  bizClientMsgId TEXT default '' ,  rankSessionId TEXT default '' ,  recommendCardId TEXT default '' ,  isValidExposed INTEGER,  resortBuffer TEXT default '' ,  recycleCardType INTEGER default '0' ,  recommendReason TEXT default '' ,  originBitFlag INTEGER default '0' ,  mergeShowTime LONG,  mergeCount INTEGER default '0' ,  notifyMsgId TEXT default '' ,  notifyMsgBlockFlag INTEGER,  silentFoldMsgReadStatus INTEGER,  mpArticleKey TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `isExpand` | INTEGER | 是否展开 |
| `orderFlag` | LONG | 顺序标志 |
| `hasShow` | INTEGER | 是否显示 |
| `placeTop` | INTEGER | place置顶 |
| `appMsgStatInfoProto` | BLOB | 应用消息stat信息proto |
| `isRead` | INTEGER | 是否已读 |
| `bitFlag` | INTEGER | 位标志 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `rankSessionId` | TEXT | 排名会话ID |
| `recommendCardId` | TEXT | 推荐卡片ID |
| `isValidExposed` | INTEGER | 是否有效exposed |
| `resortBuffer` | TEXT | resort缓冲 |
| `recycleCardType` | INTEGER | recycle卡片类型 |
| `recommendReason` | TEXT | 推荐原因 |
| `originBitFlag` | INTEGER | 原始位标志 |
| `mergeShowTime` | LONG | merge显示时间 |
| `mergeCount` | INTEGER | merge数量 |
| `notifyMsgId` | TEXT | 通知消息ID |
| `notifyMsgBlockFlag` | INTEGER | 通知消息块标志 |
| `silentFoldMsgReadStatus` | INTEGER | 静音折叠消息已读状态 |
| `mpArticleKey` | TEXT | mparticle键 |

### `CardMsgInfo` — 卡片消息表

```sql
CREATE TABLE CardMsgInfo (  card_type INTEGER,  title TEXT,  description TEXT,  logo_url TEXT,  time INTEGER,  card_id TEXT,  card_tp_id TEXT,  msg_id TEXT PRIMARY KEY ,  msg_type INTEGER,  jump_type INTEGER,  url TEXT,  buttonData BLOB,  operData BLOB,  report_scene INTEGER,  read_state INTEGER default '0' ,  accept_buttons TEXT,  consumed_box_id TEXT,  jump_buttons TEXT,  logo_color TEXT,  unavailable_qr_code_list TEXT,  all_unavailable INTEGER default 'false' ,  need_pull_card_entrance INTEGER default 'false' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `card_type` | INTEGER | 卡片类型 |
| `title` | TEXT | 标题 |
| `description` | TEXT | 描述 |
| `logo_url` | TEXT | 日志o链接 |
| `time` | INTEGER | 时间 |
| `card_id` | TEXT | 卡片ID |
| `card_tp_id` | TEXT | 卡片tpID |
| `msg_id` | TEXT | 消息ID |
| `msg_type` | INTEGER | 消息类型 |
| `jump_type` | INTEGER | jump类型 |
| `url` | TEXT | 链接 |
| `buttonData` | BLOB | button数据 |
| `operData` | BLOB | oper数据 |
| `report_scene` | INTEGER | 上报场景 |
| `read_state` | INTEGER | 已读状态 |
| `accept_buttons` | TEXT | 接受buttons |
| `consumed_box_id` | TEXT | consumedboxID |
| `jump_buttons` | TEXT | (jump_buttons) |
| `logo_color` | TEXT | 日志o颜色 |
| `unavailable_qr_code_list` | TEXT | unavailable二维码列表 |
| `all_unavailable` | INTEGER | (all_unavailable) |
| `need_pull_card_entrance` | INTEGER | 是否pull卡片entrance |

### `CardQrCodeConfi` — 卡片二维码confi表

```sql
CREATE TABLE CardQrCodeConfi (  card_id TEXT PRIMARY KEY ,  lower_bound INTEGER,  need_insert_show_timestamp INTEGER default 'false' ,  show_timestamp_encrypt_key TEXT,  expire_time_interval INTEGER,  show_expire_interval INTEGER,  fetch_time LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `card_id` | TEXT | 卡片ID |
| `lower_bound` | INTEGER | (lower_bound) |
| `need_insert_show_timestamp` | INTEGER | 是否插入显示时间戳 |
| `show_timestamp_encrypt_key` | TEXT | 显示时间戳加密键 |
| `expire_time_interval` | INTEGER | 过期时间interval |
| `show_expire_interval` | INTEGER | 显示过期interval |
| `fetch_time` | LONG | fetch时间 |

### `CardQrCodeDataInfo` — 卡片二维码数据表

```sql
CREATE TABLE CardQrCodeDataInfo (  code_id TEXT,  card_id TEXT,  code TEXT,  status INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `code_id` | TEXT | 码ID |
| `card_id` | TEXT | 卡片ID |
| `code` | TEXT | 码 |
| `status` | INTEGER | 状态 |

### `CdnDownloadInfo` — CDN下载表

```sql
CREATE TABLE CdnDownloadInfo (  mediaId TEXT,  downloadUrlHashCode INTEGER PRIMARY KEY ,  downloadUrl TEXT,  httpsUrl TEXT,  filePath TEXT,  verifyHeaders TEXT,  game_package_download INTEGER,  allowMobileNetDownload INTEGER,  wifiAutoDownload INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `mediaId` | TEXT | 媒体ID |
| `downloadUrlHashCode` | INTEGER | 下载链接哈希码 |
| `downloadUrl` | TEXT | 下载链接 |
| `httpsUrl` | TEXT | https链接 |
| `filePath` | TEXT | 文件路径 |
| `verifyHeaders` | TEXT | 验证头像ers |
| `game_package_download` | INTEGER | 游戏包下载 |
| `allowMobileNetDownload` | INTEGER | allow手机net下载 |
| `wifiAutoDownload` | INTEGER | WiFiauto下载 |

### `ChatBotConfig` — 聊天机器人配置表

```sql
CREATE TABLE ChatBotConfig (  userName TEXT PRIMARY KEY ,  menu TEXT,  profileInfoDetail TEXT,  serviceAgreement TEXT,  toolbarFlag LONG,  InteractiveMode INTEGER,  openIMId TEXT,  openIMDescId TEXT,  openIMCustomInfo TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `userName` | TEXT | 用户名 |
| `menu` | TEXT | (menu) |
| `profileInfoDetail` | TEXT | 资料信息详情 |
| `serviceAgreement` | TEXT | 服务同意ment |
| `toolbarFlag` | LONG | toolbar标志 |
| `InteractiveMode` | INTEGER | inter活跃模式 |
| `openIMId` | TEXT | openimID |
| `openIMDescId` | TEXT | openim描述ID |
| `openIMCustomInfo` | TEXT | openimcusto最小fo |

### `ChatroomMsgSeq` — 聊天群消息序号表

```sql
CREATE TABLE ChatroomMsgSeq (  username TEXT default ''  PRIMARY KEY ,  lastPushSeq LONG,  lastLocalSeq LONG,  lastPushCreateTime LONG,  lastLocalCreateTime LONG,  seqBlockInfo BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `lastPushSeq` | LONG | 最后push序号 |
| `lastLocalSeq` | LONG | 最后本地序号 |
| `lastPushCreateTime` | LONG | 最后push创建时间 |
| `lastLocalCreateTime` | LONG | 最后本地创建时间 |
| `seqBlockInfo` | BLOB | 序号块信息 |

### `ChatroomNoticeAttachIndex` — 聊天群通知/公告附件索引表

```sql
CREATE TABLE ChatroomNoticeAttachIndex (  msgId LONG,  dataId TEXT,  dataPath TEXT,  thumbPath TEXT,  size LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `dataId` | TEXT | 数据ID |
| `dataPath` | TEXT | 数据路径 |
| `thumbPath` | TEXT | 缩略图路径 |
| `size` | LONG | 大小 |

### `CleanDeleteItem` — 清理删除项表

```sql
CREATE TABLE CleanDeleteItem (  createTime LONG default '0' ,  modifyTime LONG default '0' ,  deleteTime LONG default '0' ,  id TEXT default '' ,  saveTime LONG default '0' ,  size LONG default '0' ,  flags LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `createTime` | LONG | 创建时间 |
| `modifyTime` | LONG | 修改时间 |
| `deleteTime` | LONG | 删除时间 |
| `id` | TEXT | ID |
| `saveTime` | LONG | save时间 |
| `size` | LONG | 大小 |
| `flags` | LONG | 标志s |

### `ContactCmdBuf` — 联系人命令缓冲表

```sql
CREATE TABLE ContactCmdBuf (  username TEXT default ''  PRIMARY KEY ,  cmdbuf BLOB default '' ,  fieldUpdateCtrlInfoList BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `cmdbuf` | BLOB | 命令缓冲 |
| `fieldUpdateCtrlInfoList` | BLOB | field更新ctrl信息列表 |

### `ContactLabel` — 联系人标签表

```sql
CREATE TABLE ContactLabel (  labelID INTEGER PRIMARY KEY ,  labelName TEXT,  labelPYFull TEXT,  labelPYShort TEXT,  createTime LONG,  isTemporary INTEGER,  lastUseTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `labelID` | INTEGER | 标签ID |
| `labelName` | TEXT | 标签名称 |
| `labelPYFull` | TEXT | 标签pyfull |
| `labelPYShort` | TEXT | 标签pyshort |
| `createTime` | LONG | 创建时间 |
| `isTemporary` | INTEGER | 是否临时orary |
| `lastUseTime` | LONG | 最后使用时间 |

### `ContactLabelCache` — 联系人标签缓存表

```sql
CREATE TABLE ContactLabelCache (  labelId TEXT,  contactName TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `labelId` | TEXT | 标签ID |
| `contactName` | TEXT | 联系人名称 |

### `DelayTransferRecord` — 延迟转账/转移记录表

```sql
CREATE TABLE DelayTransferRecord (  msgId LONG PRIMARY KEY ,  transferId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `transferId` | TEXT | 转账/转移ID |

### `DeletedConversationInfo` — 已删除会话表

```sql
CREATE TABLE DeletedConversationInfo ( userName TEXT  PRIMARY KEY , lastSeq LONG  , reserved1 INT  , reserved2 LONG  , reserved3 TEXT  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `userName` | TEXT | 用户名 |
| `lastSeq` | LONG | 最后序号 |
| `reserved1` | INT | 保留1 |
| `reserved2` | LONG | 保留2 |
| `reserved3` | TEXT | 保留3 |

### `DownloadTaskItem` — 下载task项表

```sql
CREATE TABLE DownloadTaskItem (  appId TEXT PRIMARY KEY ,  status INTEGER,  modifyTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `status` | INTEGER | 状态 |
| `modifyTime` | LONG | 修改时间 |

### `EmojiDesignerProduct` — 表情de签名er产品表

```sql
CREATE TABLE EmojiDesignerProduct (  designerUin INTEGER,  productId TEXT,  syncTime INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `designerUin` | INTEGER | de签名erQQ号/UIN |
| `productId` | TEXT | 产品ID |
| `syncTime` | INTEGER | 同步时间 |

### `EmojiGroupInfo` — 表情群/组表

```sql
CREATE TABLE EmojiGroupInfo (  productID TEXT PRIMARY KEY  COLLATE NOCASE ,  packIconUrl TEXT,  packGrayIconUrl TEXT,  packCoverUrl TEXT,  packName TEXT,  packDesc TEXT,  packAuthInfo TEXT,  packPrice TEXT,  packType INTEGER,  packFlag INTEGER,  packExpire LONG,  packTimeStamp LONG,  packCopyright TEXT,  type INTEGER,  status INTEGER,  sort INTEGER default '1' ,  lastUseTime LONG,  packStatus INTEGER default '0' ,  flag INTEGER default '0' ,  recommand INTEGER default '0' ,  sync INTEGER default '0' ,  idx INTEGER default '0' ,  BigIconUrl TEXT,  MutiLanName TEXT,  recommandType INTEGER default '-1' ,  lang TEXT,  recommandWord TEXT,  buttonType INTEGER,  count INTEGER,  ipKey TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `productID` | TEXT | 产品ID |
| `packIconUrl` | TEXT | pack图标链接 |
| `packGrayIconUrl` | TEXT | packgray图标链接 |
| `packCoverUrl` | TEXT | pack封面链接 |
| `packName` | TEXT | pack名称 |
| `packDesc` | TEXT | pack描述 |
| `packAuthInfo` | TEXT | pack授权信息 |
| `packPrice` | TEXT | pack价格 |
| `packType` | INTEGER | pack类型 |
| `packFlag` | INTEGER | pack标志 |
| `packExpire` | LONG | pack过期 |
| `packTimeStamp` | LONG | pack时间戳 |
| `packCopyright` | TEXT | (packCopyright) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `sort` | INTEGER | (sort) |
| `lastUseTime` | LONG | 最后使用时间 |
| `packStatus` | INTEGER | pack状态 |
| `flag` | INTEGER | 标志 |
| `recommand` | INTEGER | r电商mand |
| `sync` | INTEGER | 同步 |
| `idx` | INTEGER | 索引 |
| `BigIconUrl` | TEXT | big图标链接 |
| `MutiLanName` | TEXT | mutilan名称 |
| `recommandType` | INTEGER | r电商mand类型 |
| `lang` | TEXT | 语言 |
| `recommandWord` | TEXT | r电商mand词 |
| `buttonType` | INTEGER | button类型 |
| `count` | INTEGER | 数量 |
| `ipKey` | TEXT | ip键 |

### `EmojiIPSetInfo` — 表情ipset表

```sql
CREATE TABLE EmojiIPSetInfo (  key TEXT PRIMARY KEY ,  title TEXT,  desc TEXT,  iconUrl TEXT,  panelUrl TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `title` | TEXT | 标题 |
| `desc` | TEXT | 描述 |
| `iconUrl` | TEXT | 图标链接 |
| `panelUrl` | TEXT | panel链接 |

### `EmojiInfo` — 表情信息

```sql
CREATE TABLE EmojiInfo (  md5 TEXT PRIMARY KEY  COLLATE NOCASE ,  svrid TEXT,  catalog INTEGER,  type INTEGER,  size INTEGER,  start INTEGER,  state INTEGER,  name TEXT,  content TEXT,  reserved1 TEXT,  reserved2 TEXT,  reserved3 INTEGER,  reserved4 INTEGER,  app_id TEXT,  groupId TEXT default '' ,  lastUseTime LONG,  framesInfo TEXT default '' ,  idx INTEGER default '0' ,  temp INTEGER default '0' ,  source INTEGER default '0' ,  needupload INTEGER default '0' ,  designerID TEXT,  thumbUrl TEXT,  cdnUrl TEXT,  encrypturl TEXT,  aeskey TEXT,  width INTEGER default '0' ,  height INTEGER default '0' ,  externUrl TEXT,  externMd5 TEXT,  activityid TEXT,  tpurl TEXT,  tpauthkey TEXT,  wxamMd5 TEXT,  attachedText TEXT,  captureStatus INTEGER default '0' ,  attachedEmojiMD5 BLOB default '' ,  imitateMd5 TEXT,  captureUploadErrCode INTEGER default '0' ,  captureUploadCounter INTEGER default '0' ,  captureEnterTime LONG,  lensId TEXT,  attachTextColor TEXT,  captureScene INTEGER,  attr TEXT,  linkId TEXT,  meanings TEXT,  isOcrProcessed INTEGER default '0' ,  custom_meaning TEXT,  emojiFlag LONG default '0' ,  storeUnique INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `md5` | TEXT | MD5 |
| `svrid` | TEXT | 服务器ID |
| `catalog` | INTEGER | cata日志 |
| `type` | INTEGER | 类型 |
| `size` | INTEGER | 大小 |
| `start` | INTEGER | 开始 |
| `state` | INTEGER | 状态 |
| `name` | TEXT | 名称 |
| `content` | TEXT | 内容 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INTEGER | 保留3 |
| `reserved4` | INTEGER | 保留4 |
| `app_id` | TEXT | 应用ID |
| `groupId` | TEXT | 群ID |
| `lastUseTime` | LONG | 最后使用时间 |
| `framesInfo` | TEXT | frames信息 |
| `idx` | INTEGER | 索引 |
| `temp` | INTEGER | 临时 |
| `source` | INTEGER | 来源 |
| `needupload` | INTEGER | 是否上传 |
| `designerID` | TEXT | de签名erID |
| `thumbUrl` | TEXT | 缩略图链接 |
| `cdnUrl` | TEXT | CDN链接 |
| `encrypturl` | TEXT | 加密链接 |
| `aeskey` | TEXT | aes键 |
| `width` | INTEGER | 宽 |
| `height` | INTEGER | 高 |
| `externUrl` | TEXT | 扩展ern链接 |
| `externMd5` | TEXT | 扩展ernMD5 |
| `activityid` | TEXT | activityID |
| `tpurl` | TEXT | tp链接 |
| `tpauthkey` | TEXT | tp授权键 |
| `wxamMd5` | TEXT | wxamMD5 |
| `attachedText` | TEXT | 附件ed文本 |
| `captureStatus` | INTEGER | capture状态 |
| `attachedEmojiMD5` | BLOB | 附件ed表情MD5 |
| `imitateMd5` | TEXT | imitateMD5 |
| `captureUploadErrCode` | INTEGER | capture上传err码 |
| `captureUploadCounter` | INTEGER | capture上传数量er |
| `captureEnterTime` | LONG | capture进入时间 |
| `lensId` | TEXT | lensID |
| `attachTextColor` | TEXT | 附件文本颜色 |
| `captureScene` | INTEGER | capture场景 |
| `attr` | TEXT | (attr) |
| `linkId` | TEXT | 链接ID |
| `meanings` | TEXT | (meanings) |
| `isOcrProcessed` | INTEGER | (isOcrProcessed) |
| `custom_meaning` | TEXT | (custom_meaning) |
| `emojiFlag` | LONG | 表情标志 |
| `storeUnique` | INTEGER | 商店unique |

### `EmojiInfoDesc` — 表情信息描述表

```sql
CREATE TABLE EmojiInfoDesc (  md5_lang TEXT PRIMARY KEY  COLLATE NOCASE ,  md5 TEXT COLLATE NOCASE ,  lang TEXT COLLATE NOCASE ,  desc TEXT,  groupId TEXT default '' ,  click_flag INTEGER,  download_flag INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `md5_lang` | TEXT | MD5语言 |
| `md5` | TEXT | MD5 |
| `lang` | TEXT | 语言 |
| `desc` | TEXT | 描述 |
| `groupId` | TEXT | 群ID |
| `click_flag` | INTEGER | 点击标志 |
| `download_flag` | INTEGER | 下载标志 |

### `EmojiSuggestCacheInfo` — 表情suggest缓存表

```sql
CREATE TABLE EmojiSuggestCacheInfo (  desc TEXT PRIMARY KEY ,  updateTime INTEGER,  content BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `desc` | TEXT | 描述 |
| `updateTime` | INTEGER | 更新时间 |
| `content` | BLOB | 内容 |

### `EmojiSuggestDescInfo` — 表情suggest描述表

```sql
CREATE TABLE EmojiSuggestDescInfo (  groupID TEXT,  desc TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `groupID` | TEXT | 群ID |
| `desc` | TEXT | 描述 |

### `EmotionDesignerInfo` — 表情de签名er表

```sql
CREATE TABLE EmotionDesignerInfo (  designerIDAndType TEXT PRIMARY KEY ,  content BLOB default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `designerIDAndType` | TEXT | de签名erIDand类型 |
| `content` | BLOB | 内容 |

### `EmotionDetailInfo` — 表情详情表

```sql
CREATE TABLE EmotionDetailInfo (  productID TEXT PRIMARY KEY ,  content BLOB default '' ,  lan TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `productID` | TEXT | 产品ID |
| `content` | BLOB | 内容 |
| `lan` | TEXT | (lan) |

### `EmotionRewardInfo` — 表情打赏信息

```sql
CREATE TABLE EmotionRewardInfo (  productID TEXT PRIMARY KEY ,  content BLOB default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `productID` | TEXT | 产品ID |
| `content` | BLOB | 内容 |

### `FavOffline` — favoff线表

```sql
CREATE TABLE FavOffline (  url TEXT,  size LONG,  path TEXT,  imgDirPath TEXT,  imgPaths TEXT,  favTime LONG,  updateTime LONG,  status INTEGER,  failNum INTEGER,  isReport INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `url` | TEXT | 链接 |
| `size` | LONG | 大小 |
| `path` | TEXT | 路径 |
| `imgDirPath` | TEXT | 图片dir路径 |
| `imgPaths` | TEXT | 图片路径s |
| `favTime` | LONG | fav时间 |
| `updateTime` | LONG | 更新时间 |
| `status` | INTEGER | 状态 |
| `failNum` | INTEGER | 失败数量 |
| `isReport` | INTEGER | 是否上报 |

### `FileDownloadInfo` — 文件下载表

```sql
CREATE TABLE FileDownloadInfo (  downloadId LONG default '-1'  PRIMARY KEY ,  downloadUrl TEXT default '' ,  secondaryUrl TEXT default '' ,  fileSize LONG default '0' ,  fileName TEXT default '' ,  filePath TEXT default '' ,  fileType INTEGER default '0' ,  status INTEGER default '0' ,  md5 TEXT default '' ,  autoInstall INTEGER default 'false' ,  showNotification INTEGER default 'false' ,  sysDownloadId LONG default '-1' ,  downloaderType INTEGER default '0' ,  appId TEXT default '' ,  downloadUrlHashCode INTEGER default '0' ,  packageName TEXT default '' ,  downloadedSize LONG default '0' ,  totalSize LONG default '0' ,  autoDownload INTEGER default 'false' ,  channelId TEXT default '' ,  scene INTEGER default '0' ,  errCode INTEGER default '0' ,  startTime LONG default '0' ,  startSize LONG default '0' ,  startState INTEGER default '0' ,  fromWeApp INTEGER default 'false' ,  downloadInWifi INTEGER default 'false' ,  extInfo TEXT default '' ,  finishTime LONG default '0' ,  isSecondDownload INTEGER default 'false' ,  fromDownloadApp INTEGER default 'false' ,  updateTime LONG default '0' ,  reserveInWifi INTEGER default 'false' ,  ssid INTEGER default '0' ,  uiarea INTEGER default '0' ,  noticeId INTEGER default '0' ,  downloadType INTEGER default '0' ,  startScene INTEGER default '0' ,  sectionMd5Byte BLOB,  rawAppId TEXT default '' ,  notificationTitle TEXT default '' ,  userSessionId TEXT default '' ,  enableBrotli INTEGER default 'false' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `downloadId` | LONG | 下载ID |
| `downloadUrl` | TEXT | 下载链接 |
| `secondaryUrl` | TEXT | secondary链接 |
| `fileSize` | LONG | 文件大小 |
| `fileName` | TEXT | 文件名称 |
| `filePath` | TEXT | 文件路径 |
| `fileType` | INTEGER | 文件类型 |
| `status` | INTEGER | 状态 |
| `md5` | TEXT | MD5 |
| `autoInstall` | INTEGER | (autoInstall) |
| `showNotification` | INTEGER | 显示通知 |
| `sysDownloadId` | LONG | sys下载ID |
| `downloaderType` | INTEGER | 下载er类型 |
| `appId` | TEXT | 应用ID |
| `downloadUrlHashCode` | INTEGER | 下载链接哈希码 |
| `packageName` | TEXT | 包名称 |
| `downloadedSize` | LONG | 下载ed大小 |
| `totalSize` | LONG | 总大小 |
| `autoDownload` | INTEGER | auto下载 |
| `channelId` | TEXT | 渠道ID |
| `scene` | INTEGER | 场景 |
| `errCode` | INTEGER | err码 |
| `startTime` | LONG | 开始时间 |
| `startSize` | LONG | 开始大小 |
| `startState` | INTEGER | 开始状态 |
| `fromWeApp` | INTEGER | fromwe应用 |
| `downloadInWifi` | INTEGER | 下载inWiFi |
| `extInfo` | TEXT | 扩展信息 |
| `finishTime` | LONG | 完成时间 |
| `isSecondDownload` | INTEGER | 是否second下载 |
| `fromDownloadApp` | INTEGER | from下载应用 |
| `updateTime` | LONG | 更新时间 |
| `reserveInWifi` | INTEGER | reserveinWiFi |
| `ssid` | INTEGER | ssID |
| `uiarea` | INTEGER | (uiarea) |
| `noticeId` | INTEGER | 通知/公告ID |
| `downloadType` | INTEGER | 下载类型 |
| `startScene` | INTEGER | 开始场景 |
| `sectionMd5Byte` | BLOB | sectionMD5字节 |
| `rawAppId` | TEXT | 原始应用ID |
| `notificationTitle` | TEXT | 通知标题 |
| `userSessionId` | TEXT | 用户会话ID |
| `enableBrotli` | INTEGER | 启用brotli |

### `FileMsgInfo` — 文件消息表

```sql
CREATE TABLE FileMsgInfo (  msgSvrId LONG PRIMARY KEY ,  overwriteNewMsgId LONG,  cgi TEXT default '' ,  aeskey TEXT default '' ,  filePath TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `overwriteNewMsgId` | LONG | overwritenew消息ID |
| `cgi` | TEXT | (cgi) |
| `aeskey` | TEXT | aes键 |
| `filePath` | TEXT | 文件路径 |

### `ForceNotifyData` — force通知数据表

```sql
CREATE TABLE ForceNotifyData (  ForcePushId TEXT PRIMARY KEY ,  CreateTime LONG,  ExpiredTime LONG,  Description TEXT,  UserIcon TEXT,  UserName TEXT,  ExtInfo TEXT,  Status INTEGER default '0' ,  Type INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `ForcePushId` | TEXT | forcepushID |
| `CreateTime` | LONG | 创建时间 |
| `ExpiredTime` | LONG | 过期d时间 |
| `Description` | TEXT | 描述 |
| `UserIcon` | TEXT | 用户图标 |
| `UserName` | TEXT | 用户名 |
| `ExtInfo` | TEXT | 扩展信息 |
| `Status` | INTEGER | 状态 |
| `Type` | INTEGER | 类型 |

### `FriendUser` — 好友用户表

```sql
CREATE TABLE FriendUser (  encryptUsername TEXT default ''  PRIMARY KEY ,  username TEXT default '' ,  modifyTime LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `encryptUsername` | TEXT | 加密用户名 |
| `username` | TEXT | 用户名 |
| `modifyTime` | LONG | 修改时间 |

### `FunctionMsgItem` — 功能消息项表

```sql
CREATE TABLE FunctionMsgItem (  cgi TEXT,  cmdid INTEGER,  functionmsgid TEXT PRIMARY KEY ,  version LONG,  preVersion LONG,  retryinterval INTEGER,  reportid INTEGER,  successkey INTEGER,  failkey INTEGER,  finalfailkey INTEGER,  custombuff TEXT,  addMsg BLOB,  status INTEGER default '-1' ,  needShow INTEGER default 'false' ,  defaultContent TEXT,  actionTime LONG default '-1' ,  delayTime LONG default '-1' ,  retryCount INTEGER default '0' ,  retryCountLimit INTEGER default '0' ,  businessInfo BLOB,  opCode INTEGER default '-1' ,  addMsgs BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `cgi` | TEXT | (cgi) |
| `cmdid` | INTEGER | 命令ID |
| `functionmsgid` | TEXT | 功能消息ID |
| `version` | LONG | 版本 |
| `preVersion` | LONG | pre版本 |
| `retryinterval` | INTEGER | 重试interval |
| `reportid` | INTEGER | 上报ID |
| `successkey` | INTEGER | 成功键 |
| `failkey` | INTEGER | 失败键 |
| `finalfailkey` | INTEGER | final失败键 |
| `custombuff` | TEXT | custoMBuff |
| `addMsg` | BLOB | 广告d消息 |
| `status` | INTEGER | 状态 |
| `needShow` | INTEGER | 是否显示 |
| `defaultContent` | TEXT | 默认内容 |
| `actionTime` | LONG | 动作时间 |
| `delayTime` | LONG | 延迟时间 |
| `retryCount` | INTEGER | 重试数量 |
| `retryCountLimit` | INTEGER | 重试数量限制 |
| `businessInfo` | BLOB | business信息 |
| `opCode` | INTEGER | op码 |
| `addMsgs` | BLOB | 广告d消息s |

### `GameHaowanMedia` — 游戏haowan媒体表

```sql
CREATE TABLE GameHaowanMedia (  localId TEXT PRIMARY KEY ,  mediaId TEXT,  mediaType INTEGER,  filePath TEXT,  compressPath TEXT,  thumbPath TEXT,  width INTEGER,  height INTEGER,  duration INTEGER,  size LONG,  isGif INTEGER,  mediaUrl TEXT,  thumbPicUrl TEXT,  uploadState INTEGER default 'false' ,  hostTaskId TEXT,  editFlag INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `localId` | TEXT | 本地ID |
| `mediaId` | TEXT | 媒体ID |
| `mediaType` | INTEGER | 媒体类型 |
| `filePath` | TEXT | 文件路径 |
| `compressPath` | TEXT | compress路径 |
| `thumbPath` | TEXT | 缩略图路径 |
| `width` | INTEGER | 宽 |
| `height` | INTEGER | 高 |
| `duration` | INTEGER | 时长 |
| `size` | LONG | 大小 |
| `isGif` | INTEGER | 是否GIF |
| `mediaUrl` | TEXT | 媒体链接 |
| `thumbPicUrl` | TEXT | 缩略图图片链接 |
| `uploadState` | INTEGER | 上传状态 |
| `hostTaskId` | TEXT | hosttaskID |
| `editFlag` | INTEGER | edit标志 |

### `GameHaowanPublishEdition` — 游戏(好玩)发布版本

```sql
CREATE TABLE GameHaowanPublishEdition (  taskId TEXT PRIMARY KEY ,  createTime LONG,  publishSource INTEGER,  mediaType INTEGER,  localIdList TEXT,  mediaList TEXT,  BusinessData TEXT,  uploadState INTEGER default '0' ,  publishState INTEGER default '0' ,  compressImg INTEGER default 'true' ,  mixState INTEGER default '0' ,  bgMixTaskId TEXT,  sourceSceneId INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `taskId` | TEXT | taskID |
| `createTime` | LONG | 创建时间 |
| `publishSource` | INTEGER | 发布来源 |
| `mediaType` | INTEGER | 媒体类型 |
| `localIdList` | TEXT | 本地ID列表 |
| `mediaList` | TEXT | 媒体列表 |
| `BusinessData` | TEXT | business数据 |
| `uploadState` | INTEGER | 上传状态 |
| `publishState` | INTEGER | 发布状态 |
| `compressImg` | INTEGER | compress图片 |
| `mixState` | INTEGER | mix状态 |
| `bgMixTaskId` | TEXT | 背景mixtaskID |
| `sourceSceneId` | INTEGER | 来源场景ID |

### `GameLocalVideoInfo` — 游戏本地视频表

```sql
CREATE TABLE GameLocalVideoInfo (  fileId TEXT default ''  PRIMARY KEY ,  userId TEXT default '' ,  appId TEXT default '' ,  appName TEXT default '' ,  filePath TEXT default '' ,  orgFilePath TEXT default '' ,  coverPath TEXT default '' ,  extJsonData TEXT default '' ,  createTime LONG,  durationSec LONG,  title TEXT default '' ,  desc TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `fileId` | TEXT | 文件ID |
| `userId` | TEXT | 用户ID |
| `appId` | TEXT | 应用ID |
| `appName` | TEXT | 应用名称 |
| `filePath` | TEXT | 文件路径 |
| `orgFilePath` | TEXT | org文件路径 |
| `coverPath` | TEXT | 封面路径 |
| `extJsonData` | TEXT | 扩展JSON数据 |
| `createTime` | LONG | 创建时间 |
| `durationSec` | LONG | 时长sec |
| `title` | TEXT | 标题 |
| `desc` | TEXT | 描述 |

### `GameMsgPullRecord` — 游戏消息pull记录表

```sql
CREATE TABLE GameMsgPullRecord (  dateTimeRange TEXT PRIMARY KEY ,  pullCount INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `dateTimeRange` | TEXT | 日期时间range |
| `pullCount` | INTEGER | pull数量 |

### `GameMsgRelativeContent` — 游戏消息re纬度ive内容表

```sql
CREATE TABLE GameMsgRelativeContent (  contentId TEXT PRIMARY KEY ,  consumeMsgId LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `contentId` | TEXT | 内容ID |
| `consumeMsgId` | LONG | consume消息ID |

### `GamePBCache` — 游戏pb缓存表

```sql
CREATE TABLE GamePBCache (  key TEXT PRIMARY KEY ,  value BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `value` | BLOB | 值 |

### `GameRawMessage` — 游戏原始消息表

```sql
CREATE TABLE GameRawMessage (  msgId LONG PRIMARY KEY ,  mergerId TEXT,  gameMsgId TEXT,  msgType INTEGER,  createTime LONG default '0' ,  expireTime LONG default '0' ,  isRedDotExited INTEGER default 'false' ,  appId TEXT,  showInMsgList INTEGER default 'true' ,  isRead INTEGER default 'false' ,  label TEXT default '' ,  isHidden INTEGER default '0' ,  weight TEXT default '' ,  rawXML TEXT default '' ,  receiveTime LONG default '0' ,  showType INTEGER default '0' ,  interactiveMergeId TEXT default '' ,  hasMergedCount INTEGER default '1' ,  redDotExpireTime LONG default '0' ,  needReport INTEGER default 'false' ,  reportType INTEGER default '0' ,  reappearable INTEGER default 'false' ,  entranceExposure INTEGER default 'false' ,  exposuredCount INTEGER default '0' ,  completeExposuredCount INTEGER default '0' ,  pushId TEXT default '-1' ,  clickScore FLOAT default '0.5' ,  channel INTEGER default '0' ,  quickResponseContentId TEXT default '' ,  isGreet INTEGER default 'false' ,  relationType INTEGER default '0' ,  mergeSenderIcon TEXT default '' ,  contentId TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `mergerId` | TEXT | mergerID |
| `gameMsgId` | TEXT | 游戏消息ID |
| `msgType` | INTEGER | 消息类型 |
| `createTime` | LONG | 创建时间 |
| `expireTime` | LONG | 过期时间 |
| `isRedDotExited` | INTEGER | 是否红包dot退出ed |
| `appId` | TEXT | 应用ID |
| `showInMsgList` | INTEGER | 显示in消息列表 |
| `isRead` | INTEGER | 是否已读 |
| `label` | TEXT | 标签 |
| `isHidden` | INTEGER | 是否隐藏 |
| `weight` | TEXT | 权重 |
| `rawXML` | TEXT | 原始XML |
| `receiveTime` | LONG | receive时间 |
| `showType` | INTEGER | 显示类型 |
| `interactiveMergeId` | TEXT | inter活跃mergeID |
| `hasMergedCount` | INTEGER | 是否merged数量 |
| `redDotExpireTime` | LONG | 红包dot过期时间 |
| `needReport` | INTEGER | 是否上报 |
| `reportType` | INTEGER | 上报类型 |
| `reappearable` | INTEGER | re应用earable |
| `entranceExposure` | INTEGER | (entranceExposure) |
| `exposuredCount` | INTEGER | exposu红包数量 |
| `completeExposuredCount` | INTEGER | 完成exposu红包数量 |
| `pushId` | TEXT | pushID |
| `clickScore` | FLOAT | 点击分数 |
| `channel` | INTEGER | 渠道 |
| `quickResponseContentId` | TEXT | quick响应内容ID |
| `isGreet` | INTEGER | (isGreet) |
| `relationType` | INTEGER | 关系类型 |
| `mergeSenderIcon` | TEXT | merge发送者图标 |
| `contentId` | TEXT | 内容ID |

### `GameResourceDownload` — 游戏资源下载表

```sql
CREATE TABLE GameResourceDownload (  packageName TEXT PRIMARY KEY ,  appId TEXT,  intervalSeconds INTEGER,  expiredSeconds INTEGER,  createTime LONG,  checkCgiTime LONG,  finishDownloadTime LONG,  downloadItemList BLOB,  taskExpiredSeconds LONG,  scene INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `packageName` | TEXT | 包名称 |
| `appId` | TEXT | 应用ID |
| `intervalSeconds` | INTEGER | (intervalSeconds) |
| `expiredSeconds` | INTEGER | 过期dseconds |
| `createTime` | LONG | 创建时间 |
| `checkCgiTime` | LONG | checkcgi时间 |
| `finishDownloadTime` | LONG | 完成下载时间 |
| `downloadItemList` | BLOB | 下载项列表 |
| `taskExpiredSeconds` | LONG | task过期dseconds |
| `scene` | INTEGER | 场景 |

### `GameSilentDownload` — 游戏静音下载表

```sql
CREATE TABLE GameSilentDownload (  appId TEXT PRIMARY KEY ,  downloadUrl TEXT,  size LONG default '0' ,  md5 TEXT,  packageName TEXT,  expireTime LONG default '0' ,  randomTime LONG default '0' ,  isFirst INTEGER default 'true' ,  nextCheckTime LONG default '0' ,  isRunning INTEGER default 'false' ,  noWifi INTEGER default 'true' ,  noSdcard INTEGER default 'true' ,  noEnoughSpace INTEGER default 'true' ,  lowBattery INTEGER default 'true' ,  continueDelay INTEGER default 'true' ,  SecondaryUrl TEXT,  downloadInWidget INTEGER,  sectionMd5Byte BLOB,  forceUpdateFlag INTEGER default '0' ,  downloadScene INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `downloadUrl` | TEXT | 下载链接 |
| `size` | LONG | 大小 |
| `md5` | TEXT | MD5 |
| `packageName` | TEXT | 包名称 |
| `expireTime` | LONG | 过期时间 |
| `randomTime` | LONG | random时间 |
| `isFirst` | INTEGER | 是否首 |
| `nextCheckTime` | LONG | n扩展check时间 |
| `isRunning` | INTEGER | (isRunning) |
| `noWifi` | INTEGER | noWiFi |
| `noSdcard` | INTEGER | nosd卡片 |
| `noEnoughSpace` | INTEGER | (noEnoughSpace) |
| `lowBattery` | INTEGER | (lowBattery) |
| `continueDelay` | INTEGER | continue延迟 |
| `SecondaryUrl` | TEXT | secondary链接 |
| `downloadInWidget` | INTEGER | 下载inwIDget |
| `sectionMd5Byte` | BLOB | sectionMD5字节 |
| `forceUpdateFlag` | INTEGER | force更新标志 |
| `downloadScene` | INTEGER | 下载场景 |

### `GetEmotionListCache` — get表情列表缓存表

```sql
CREATE TABLE GetEmotionListCache (  reqType TEXT PRIMARY KEY ,  cache BLOB default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `reqType` | TEXT | req类型 |
| `cache` | BLOB | 缓存 |

### `GetEmotionStoreRecListCache` — get表情商店rec列表缓存表

```sql
CREATE TABLE GetEmotionStoreRecListCache (  reqType TEXT PRIMARY KEY ,  cache BLOB default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `reqType` | TEXT | req类型 |
| `cache` | BLOB | 缓存 |

### `GetSysCmdMsgInfo` — ge时间戳ys命令消息表

```sql
CREATE TABLE GetSysCmdMsgInfo (  originSvrId LONG PRIMARY KEY ,  newMsgId LONG,  fromUserName TEXT default '' ,  toUserName TEXT default '' ,  createTime LONG default '0' ,  content TEXT default '' ,  msgSource TEXT default '' ,  msgSeq INTEGER,  flag INTEGER,  reserved1 INTEGER,  reserved2 LONG,  reserved3 TEXT default '' ,  reserved4 TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `originSvrId` | LONG | 原始服务器ID |
| `newMsgId` | LONG | new消息ID |
| `fromUserName` | TEXT | from用户名 |
| `toUserName` | TEXT | to用户名 |
| `createTime` | LONG | 创建时间 |
| `content` | TEXT | 内容 |
| `msgSource` | TEXT | 消息来源 |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INTEGER | 标志 |
| `reserved1` | INTEGER | 保留1 |
| `reserved2` | LONG | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `GoogleFriend` — google好友表

```sql
CREATE TABLE GoogleFriend (  googleid TEXT,  googlename TEXT,  googlephotourl TEXT,  googlegmail TEXT,  username TEXT,  nickname TEXT,  nicknameqp TEXT,  usernamepy TEXT,  small_url TEXT,  big_url TEXT,  ret INTEGER,  status INTEGER,  googleitemid TEXT PRIMARY KEY ,  googlecgistatus INTEGER default '2' ,  contecttype TEXT,  googlenamepy TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `googleid` | TEXT | googleID |
| `googlename` | TEXT | google名称 |
| `googlephotourl` | TEXT | google照片链接 |
| `googlegmail` | TEXT | (googlegmail) |
| `username` | TEXT | 用户名 |
| `nickname` | TEXT | 昵称 |
| `nicknameqp` | TEXT | 昵称qp |
| `usernamepy` | TEXT | 用户名py |
| `small_url` | TEXT | s商城链接 |
| `big_url` | TEXT | big链接 |
| `ret` | INTEGER | (ret) |
| `status` | INTEGER | 状态 |
| `googleitemid` | TEXT | google项ID |
| `googlecgistatus` | INTEGER | googlecgi状态 |
| `contecttype` | TEXT | contect类型 |
| `googlenamepy` | TEXT | google名称py |

### `GroupBindApp` — 群/组bind应用表

```sql
CREATE TABLE GroupBindApp (  chatRoomName TEXT default '群username'  PRIMARY KEY ,  BindAppData BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `chatRoomName` | TEXT | 群ID(<id>@chatroom,主键) |
| `BindAppData` | BLOB | bind应用数据 |

### `GroupSolitatire` — 群/组solitatire表

```sql
CREATE TABLE GroupSolitatire (  username TEXT,  key TEXT,  content TEXT,  creator TEXT,  num INTEGER,  firstMsgId LONG,  msgSvrId LONG,  active INTEGER default '-1' ,  lastActiveTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `key` | TEXT | 键 |
| `content` | TEXT | 内容 |
| `creator` | TEXT | (creator) |
| `num` | INTEGER | 数量 |
| `firstMsgId` | LONG | 首消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `active` | INTEGER | 活跃 |
| `lastActiveTime` | LONG | 最后活跃时间 |

### `GroupTodo` — 群/组todo表

```sql
CREATE TABLE GroupTodo (  todoid TEXT,  roomname TEXT,  username TEXT,  path TEXT,  createtime LONG,  updatetime LONG,  custominfo TEXT default '' ,  title TEXT default '' ,  creator TEXT,  related_msgids TEXT,  manager TEXT,  nreply INTEGER,  state INTEGER,  netSceneState INTEGER,  shareKey TEXT,  shareName TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `todoid` | TEXT | todoID |
| `roomname` | TEXT | 群名称 |
| `username` | TEXT | 用户名 |
| `path` | TEXT | 路径 |
| `createtime` | LONG | 创建时间 |
| `updatetime` | LONG | 更新时间 |
| `custominfo` | TEXT | custo最小fo |
| `title` | TEXT | 标题 |
| `creator` | TEXT | (creator) |
| `related_msgids` | TEXT | re纬度ed消息IDs |
| `manager` | TEXT | (manager) |
| `nreply` | INTEGER | n回复 |
| `state` | INTEGER | 状态 |
| `netSceneState` | INTEGER | ne时间戳cene状态 |
| `shareKey` | TEXT | 分享键 |
| `shareName` | TEXT | 分享名称 |

### `GroupTools` — 群/组tools表

```sql
CREATE TABLE GroupTools (  chatroomname TEXT PRIMARY KEY ,  stickToollist TEXT,  recentUseToolList TEXT,  queryState INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `chatroomname` | TEXT | 群ID(<id>@chatroom,主键) |
| `stickToollist` | TEXT | 置顶tool列表 |
| `recentUseToolList` | TEXT | 最近使用tool列表 |
| `queryState` | INTEGER | query状态 |

### `HardDeviceChampionInfo` — hard设备champion表

```sql
CREATE TABLE HardDeviceChampionInfo (  username TEXT,  championUrl TEXT,  championMotto TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `championUrl` | TEXT | champion链接 |
| `championMotto` | TEXT | (championMotto) |

### `HardDeviceInfo` — hard设备表

```sql
CREATE TABLE HardDeviceInfo (  deviceID TEXT PRIMARY KEY ,  brandName TEXT,  mac LONG,  deviceType TEXT,  connProto TEXT,  connStrategy INTEGER,  closeStrategy INTEGER,  md5Str TEXT,  authKey TEXT,  url TEXT,  sessionKey BLOB,  sessionBuf BLOB,  authBuf BLOB,  lvbuffer BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `deviceID` | TEXT | 设备ID |
| `brandName` | TEXT | 品牌名称 |
| `mac` | LONG | (mac) |
| `deviceType` | TEXT | 设备类型 |
| `connProto` | TEXT | (connProto) |
| `connStrategy` | INTEGER | connst速率gy |
| `closeStrategy` | INTEGER | closest速率gy |
| `md5Str` | TEXT | MD5str |
| `authKey` | TEXT | 授权键 |
| `url` | TEXT | 链接 |
| `sessionKey` | BLOB | 会话键 |
| `sessionBuf` | BLOB | 会话缓冲 |
| `authBuf` | BLOB | 授权缓冲 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |

### `HardDeviceLikeUser` — hard设备点赞用户表

```sql
CREATE TABLE HardDeviceLikeUser (  rankID TEXT,  appusername TEXT,  username TEXT,  timestamp INTEGER default '0' ,  liketips TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `rankID` | TEXT | 排名ID |
| `appusername` | TEXT | 应用用户名 |
| `username` | TEXT | 用户名 |
| `timestamp` | INTEGER | 时间戳 |
| `liketips` | TEXT | 点赞提示 |

### `HardDeviceProfileRankDetail` — hard设备资料排名详情表

```sql
CREATE TABLE HardDeviceProfileRankDetail (  appusername TEXT,  title TEXT,  score INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appusername` | TEXT | 应用用户名 |
| `title` | TEXT | 标题 |
| `score` | INTEGER | 分数 |

### `HardDeviceRankFollowInfo` — hard设备排名关注表

```sql
CREATE TABLE HardDeviceRankFollowInfo (  appusername TEXT,  rankID TEXT,  username TEXT,  step INTEGER,  sort INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appusername` | TEXT | 应用用户名 |
| `rankID` | TEXT | 排名ID |
| `username` | TEXT | 用户名 |
| `step` | INTEGER | (step) |
| `sort` | INTEGER | (sort) |

### `HardDeviceRankInfo` — hard设备排名表

```sql
CREATE TABLE HardDeviceRankInfo (  rankID TEXT,  appusername TEXT,  username TEXT,  ranknum INTEGER,  score INTEGER,  likecount INTEGER default '0' ,  selfLikeState INTEGER default '3' ,  sportRecord BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `rankID` | TEXT | 排名ID |
| `appusername` | TEXT | 应用用户名 |
| `username` | TEXT | 用户名 |
| `ranknum` | INTEGER | 排名数量 |
| `score` | INTEGER | 分数 |
| `likecount` | INTEGER | 点赞数量 |
| `selfLikeState` | INTEGER | 自己点赞状态 |
| `sportRecord` | BLOB | sport记录 |

### `HardIotCdnInfo` — hardiotCDN表

```sql
CREATE TABLE HardIotCdnInfo (  msgid LONG PRIMARY KEY ,  fileid TEXT,  aeskey TEXT,  md5 TEXT,  size INTEGER,  talker TEXT,  cdnType INTEGER,  fileUrl TEXT,  fileThumbUrl TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgid` | LONG | 消息ID |
| `fileid` | TEXT | 文件ID |
| `aeskey` | TEXT | aes键 |
| `md5` | TEXT | MD5 |
| `size` | INTEGER | 大小 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `cdnType` | INTEGER | CDN类型 |
| `fileUrl` | TEXT | 文件链接 |
| `fileThumbUrl` | TEXT | 文件缩略图链接 |

### `HardIotDeviceInfo` — hardiot设备表

```sql
CREATE TABLE HardIotDeviceInfo (  deviceId TEXT PRIMARY KEY ,  deviceType INTEGER,  nickName TEXT,  iconUrl TEXT,  supportMsgTypeList TEXT,  productType INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `deviceId` | TEXT | 设备ID |
| `deviceType` | INTEGER | 设备类型 |
| `nickName` | TEXT | 昵称 |
| `iconUrl` | TEXT | 图标链接 |
| `supportMsgTypeList` | TEXT | support消息类型列表 |
| `productType` | INTEGER | 产品类型 |

### `HoneyPayMsgRecord` — honey支付消息记录表

```sql
CREATE TABLE HoneyPayMsgRecord (  payMsgId TEXT PRIMARY KEY ,  msgId LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `payMsgId` | TEXT | 支付消息ID |
| `msgId` | LONG | 消息ID |

### `ILinkResourceInfo` — i链接资源表

```sql
CREATE TABLE ILinkResourceInfo (  projectId TEXT,  resourceName TEXT,  resourceVersion INTEGER,  resourceSize INTEGER,  md5 TEXT default '' ,  url TEXT default '' ,  createTime LONG,  baseVersion INTEGER,  diffAlgo INTEGER,  diffSize INTEGER,  diffMd5 TEXT default '' ,  diffUrl TEXT default '' ,  resourceRet INTEGER,  resourceType INTEGER,  resourceExpireTime LONG,  resourceStoreType INTEGER,  diffEncryptAlgo INTEGER,  diffEncryptFileSize INTEGER,  diffEncryptMd5 TEXT default '' ,  diffEncryptUrl TEXT default '' ,  diffEncryptKey BLOB,  diffEncryptIv BLOB,  diffEncryptTag BLOB,  diffEncryptAad BLOB,  encryptAlgo INTEGER,  encryptFileSize INTEGER,  encryptMd5 TEXT default '' ,  encryptUrl TEXT default '' ,  encryptKey BLOB,  encryptIv BLOB,  encryptTag BLOB,  encryptAad BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `projectId` | TEXT | projectID |
| `resourceName` | TEXT | 资源名称 |
| `resourceVersion` | INTEGER | 资源版本 |
| `resourceSize` | INTEGER | 资源大小 |
| `md5` | TEXT | MD5 |
| `url` | TEXT | 链接 |
| `createTime` | LONG | 创建时间 |
| `baseVersion` | INTEGER | base版本 |
| `diffAlgo` | INTEGER | (diffAlgo) |
| `diffSize` | INTEGER | diff大小 |
| `diffMd5` | TEXT | diffMD5 |
| `diffUrl` | TEXT | diff链接 |
| `resourceRet` | INTEGER | 资源ret |
| `resourceType` | INTEGER | 资源类型 |
| `resourceExpireTime` | LONG | 资源过期时间 |
| `resourceStoreType` | INTEGER | 资源商店类型 |
| `diffEncryptAlgo` | INTEGER | diff加密algo |
| `diffEncryptFileSize` | INTEGER | diff加密文件大小 |
| `diffEncryptMd5` | TEXT | diff加密MD5 |
| `diffEncryptUrl` | TEXT | diff加密链接 |
| `diffEncryptKey` | BLOB | diff加密键 |
| `diffEncryptIv` | BLOB | diff加密iv |
| `diffEncryptTag` | BLOB | diff加密标签 |
| `diffEncryptAad` | BLOB | diff加密a广告 |
| `encryptAlgo` | INTEGER | 加密algo |
| `encryptFileSize` | INTEGER | 加密文件大小 |
| `encryptMd5` | TEXT | 加密MD5 |
| `encryptUrl` | TEXT | 加密链接 |
| `encryptKey` | BLOB | 加密键 |
| `encryptIv` | BLOB | 加密iv |
| `encryptTag` | BLOB | 加密标签 |
| `encryptAad` | BLOB | 加密a广告 |

### `IPCallAddressItem` — ip通话地址项表

```sql
CREATE TABLE IPCallAddressItem (  wechatUsername TEXT,  systemAddressBookUsername TEXT,  contactId TEXT,  sortKey TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `wechatUsername` | TEXT | we聊天用户名 |
| `systemAddressBookUsername` | TEXT | 系统地址book用户名 |
| `contactId` | TEXT | 联系人ID |
| `sortKey` | TEXT | sort键 |

### `IPCallMsg` — ip通话消息表

```sql
CREATE TABLE IPCallMsg (  svrId LONG PRIMARY KEY ,  isRead SHORT default '0' ,  title TEXT,  content TEXT,  pushTime LONG,  msgType INTEGER,  descUrl TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `svrId` | LONG | 服务器ID |
| `isRead` | SHORT | 是否已读 |
| `title` | TEXT | 标题 |
| `content` | TEXT | 内容 |
| `pushTime` | LONG | push时间 |
| `msgType` | INTEGER | 消息类型 |
| `descUrl` | TEXT | 描述链接 |

### `IPCallPopularCountry` — ip通话popular国家表

```sql
CREATE TABLE IPCallPopularCountry (  countryCode INTEGER PRIMARY KEY ,  callTimeCount LONG,  lastCallTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `countryCode` | INTEGER | 国家码 |
| `callTimeCount` | LONG | 通话时间数量 |
| `lastCallTime` | LONG | 最后通话时间 |

### `IPCallRecord` — ip通话记录表

```sql
CREATE TABLE IPCallRecord (  phonenumber TEXT,  calltime LONG,  duration LONG,  status INTEGER,  addressId LONG default '-1' ,  phoneType INTEGER default '-1' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `phonenumber` | TEXT | 手机号码 |
| `calltime` | LONG | 通话时间 |
| `duration` | LONG | 时长 |
| `status` | INTEGER | 状态 |
| `addressId` | LONG | 地址ID |
| `phoneType` | INTEGER | 手机类型 |

### `ImgInfo` — 图片表

```sql
CREATE TABLE ImgInfo ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `offset` | INT | 偏移 |
| `totalLen` | INT | 总len |
| `bigImgPath` | TEXT | big图片路径 |
| `thumbImgPath` | TEXT | 缩略图图片路径 |

### `ImgInfo2` — 图片消息元信息

```sql
CREATE TABLE ImgInfo2 ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, originSourceMd5 TEXT, msgTalker TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `offset` | INT | 偏移 |
| `totalLen` | INT | 总len |
| `bigImgPath` | TEXT | big图片路径 |
| `thumbImgPath` | TEXT | 缩略图图片路径 |
| `createtime` | INT | 创建时间 |
| `msglocalid` | INT | 消息本地ID |
| `status` | INT | 状态 |
| `nettimes` | INT | net时间s |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `hashdthumb` | INT | 是否hd缩略图 |
| `iscomplete` | INT | 是否完成 |
| `origImgMD5` | TEXT | orig图片MD5 |
| `compressType` | INT | compress类型 |
| `midImgPath` | TEXT | mID图片路径 |
| `forwardType` | INT | 转发类型 |
| `hevcPath` | TEXT | hevc路径 |
| `sendImgType` | INT | 发送图片类型 |
| `originSourceMd5` | TEXT | 原始来源MD5 |
| `msgTalker` | TEXT | 消息talker |

### `JsLogBlockList` — js日志块表

```sql
CREATE TABLE JsLogBlockList (  logId INTEGER PRIMARY KEY ,  liftTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `logId` | INTEGER | 日志ID |
| `liftTime` | LONG | lift时间 |

### `KindaCacheTable` — 种类a缓存表

```sql
CREATE TABLE KindaCacheTable (  key TEXT PRIMARY KEY ,  value BLOB,  expire_at LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `value` | BLOB | 值 |
| `expire_at` | LONG | 过期at |

### `LBSVerifyMessage` — lbs验证消息表

```sql
CREATE TABLE LBSVerifyMessage (  svrid LONG default '0'  PRIMARY KEY ,  status INTEGER,  type INTEGER,  scene INTEGER,  createtime LONG,  talker TEXT,  content TEXT,  sayhiuser TEXT,  sayhicontent TEXT,  imgpath TEXT,  isSend INTEGER,  sayhiencryptuser TEXT,  ticket TEXT,  flag INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `svrid` | LONG | 服务器ID |
| `status` | INTEGER | 状态 |
| `type` | INTEGER | 类型 |
| `scene` | INTEGER | 场景 |
| `createtime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `sayhiuser` | TEXT | sayhi用户 |
| `sayhicontent` | TEXT | sayh图标tent |
| `imgpath` | TEXT | 图片/资源缩略图本地路径 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `sayhiencryptuser` | TEXT | sayhi加密用户 |
| `ticket` | TEXT | 票据 |
| `flag` | INTEGER | 标志 |

### `LabAppInfo` — lab应用表

```sql
CREATE TABLE LabAppInfo (  LabsAppId TEXT PRIMARY KEY ,  expId TEXT default '' ,  Type INTEGER default '0' ,  BizType INTEGER default '0' ,  Switch INTEGER default '0' ,  AllVer INTEGER default '0' ,  DetailURL TEXT,  WeAppUser TEXT,  WeAppPath TEXT,  Pos INTEGER default '0' ,  TitleKey_android TEXT,  Title_cn TEXT,  Title_hk TEXT,  Title_tw TEXT,  Title_en TEXT,  Desc_cn TEXT,  Desc_hk TEXT,  Desc_tw TEXT,  Desc_en TEXT,  Introduce_cn TEXT,  Introduce_hk TEXT,  Introduce_tw TEXT,  Introduce_en TEXT,  starttime LONG,  endtime LONG,  sequence LONG,  prioritylevel INTEGER,  status INTEGER,  ThumbUrl_cn TEXT,  ThumbUrl_hk TEXT,  ThumbUrl_tw TEXT,  ThumbUrl_en TEXT,  ImgUrl_android_cn TEXT,  ImgUrl_android_hk TEXT,  ImgUrl_android_tw TEXT,  ImgUrl_android_en TEXT,  RedPoint INTEGER,  WeAppDebugMode INTEGER,  idkey INTEGER,  idkeyValue INTEGER,  Icon TEXT,  ImgUrl_cn TEXT,  ImgUrl_hk TEXT,  ImgUrl_tw TEXT,  ImgUrl_en TEXT,  bItemFromXExpt INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `LabsAppId` | TEXT | labs应用ID |
| `expId` | TEXT | expID |
| `Type` | INTEGER | 类型 |
| `BizType` | INTEGER | 业务类型 |
| `Switch` | INTEGER | (Switch) |
| `AllVer` | INTEGER | (AllVer) |
| `DetailURL` | TEXT | 详情链接 |
| `WeAppUser` | TEXT | we应用用户 |
| `WeAppPath` | TEXT | we应用路径 |
| `Pos` | INTEGER | (Pos) |
| `TitleKey_android` | TEXT | 标题键androID |
| `Title_cn` | TEXT | 标题cn |
| `Title_hk` | TEXT | 标题hk |
| `Title_tw` | TEXT | 标题tw |
| `Title_en` | TEXT | 标题en |
| `Desc_cn` | TEXT | 描述cn |
| `Desc_hk` | TEXT | 描述hk |
| `Desc_tw` | TEXT | 描述tw |
| `Desc_en` | TEXT | 描述en |
| `Introduce_cn` | TEXT | (Introduce_cn) |
| `Introduce_hk` | TEXT | (Introduce_hk) |
| `Introduce_tw` | TEXT | (Introduce_tw) |
| `Introduce_en` | TEXT | (Introduce_en) |
| `starttime` | LONG | 开始时间 |
| `endtime` | LONG | 结束时间 |
| `sequence` | LONG | 序号uence |
| `prioritylevel` | INTEGER | 优先级级别 |
| `status` | INTEGER | 状态 |
| `ThumbUrl_cn` | TEXT | 缩略图链接cn |
| `ThumbUrl_hk` | TEXT | 缩略图链接hk |
| `ThumbUrl_tw` | TEXT | 缩略图链接tw |
| `ThumbUrl_en` | TEXT | 缩略图链接en |
| `ImgUrl_android_cn` | TEXT | 图片链接androIDcn |
| `ImgUrl_android_hk` | TEXT | 图片链接androIDhk |
| `ImgUrl_android_tw` | TEXT | 图片链接androIDtw |
| `ImgUrl_android_en` | TEXT | 图片链接androIDen |
| `RedPoint` | INTEGER | 红包积分 |
| `WeAppDebugMode` | INTEGER | we应用调试模式 |
| `idkey` | INTEGER | ID键 |
| `idkeyValue` | INTEGER | ID键值 |
| `Icon` | TEXT | 图标 |
| `ImgUrl_cn` | TEXT | 图片链接cn |
| `ImgUrl_hk` | TEXT | 图片链接hk |
| `ImgUrl_tw` | TEXT | 图片链接tw |
| `ImgUrl_en` | TEXT | 图片链接en |
| `bItemFromXExpt` | INTEGER | 位emfromxexpt |

### `LiteAppAuthInfo` — lite应用授权表

```sql
CREATE TABLE LiteAppAuthInfo (  host TEXT PRIMARY KEY ,  param TEXT,  headerMap TEXT,  paramMap TEXT,  updateTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `host` | TEXT | (host) |
| `param` | TEXT | (param) |
| `headerMap` | TEXT | 头像ermap |
| `paramMap` | TEXT | (paramMap) |
| `updateTime` | LONG | 更新时间 |

### `LiteAppBaselibInfo` — lite应用baselib表

```sql
CREATE TABLE LiteAppBaselibInfo (  majorVersion TEXT PRIMARY KEY ,  signatureKey TEXT,  pkgPath TEXT,  pkgType TEXT,  patchId TEXT,  updateTime LONG,  url TEXT,  md5 TEXT,  lastUseTime LONG,  iLinkVersion INTEGER,  version TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `majorVersion` | TEXT | major版本 |
| `signatureKey` | TEXT | 签名键 |
| `pkgPath` | TEXT | pkg路径 |
| `pkgType` | TEXT | pkg类型 |
| `patchId` | TEXT | 补丁ID |
| `updateTime` | LONG | 更新时间 |
| `url` | TEXT | 链接 |
| `md5` | TEXT | MD5 |
| `lastUseTime` | LONG | 最后使用时间 |
| `iLinkVersion` | INTEGER | i链接版本 |
| `version` | TEXT | 版本 |

### `LiteAppConfigInfo` — lite应用配置表

```sql
CREATE TABLE LiteAppConfigInfo (  appId TEXT PRIMARY KEY ,  signatureKey TEXT,  packageConfigPath TEXT,  updateTime LONG,  md5 TEXT,  dynamicConfigPath TEXT,  iLinkVersion INTEGER,  configJson TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `signatureKey` | TEXT | 签名键 |
| `packageConfigPath` | TEXT | 包配置路径 |
| `updateTime` | LONG | 更新时间 |
| `md5` | TEXT | MD5 |
| `dynamicConfigPath` | TEXT | dynamic配置路径 |
| `iLinkVersion` | INTEGER | i链接版本 |
| `configJson` | TEXT | 配置JSON |

### `LiteAppInfo` — lite应用表

```sql
CREATE TABLE LiteAppInfo (  appId TEXT PRIMARY KEY ,  groupId TEXT,  signatureKey TEXT,  pkgPath TEXT,  pkgType TEXT,  patchId TEXT,  updateTime LONG,  version TEXT,  url TEXT,  md5 TEXT,  lastUseTime LONG,  iLinkVersion INTEGER,  openOption TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `groupId` | TEXT | 群ID |
| `signatureKey` | TEXT | 签名键 |
| `pkgPath` | TEXT | pkg路径 |
| `pkgType` | TEXT | pkg类型 |
| `patchId` | TEXT | 补丁ID |
| `updateTime` | LONG | 更新时间 |
| `version` | TEXT | 版本 |
| `url` | TEXT | 链接 |
| `md5` | TEXT | MD5 |
| `lastUseTime` | LONG | 最后使用时间 |
| `iLinkVersion` | INTEGER | i链接版本 |
| `openOption` | TEXT | (openOption) |

### `LiveTipsBar` — 直播提示bar表

```sql
CREATE TABLE LiveTipsBar (  liveId LONG default '0'  PRIMARY KEY ,  hostRoomId TEXT default '' ,  liveName TEXT default '' ,  thumbUrl TEXT default '' ,  anchorUsername TEXT default '' ,  isSender INTEGER default 'false' ,  timeStamp LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `liveId` | LONG | 直播ID |
| `hostRoomId` | TEXT | host房间ID |
| `liveName` | TEXT | 直播名称 |
| `thumbUrl` | TEXT | 缩略图链接 |
| `anchorUsername` | TEXT | 主播用户名 |
| `isSender` | INTEGER | 是否发送者 |
| `timeStamp` | LONG | 时间戳 |

### `LoanEntryInfo` — 借贷入口信息

```sql
CREATE TABLE LoanEntryInfo (  title TEXT PRIMARY KEY ,  loan_jump_url TEXT,  red_dot_index INTEGER,  is_show_entry INTEGER,  tips TEXT,  is_overdue INTEGER,  available_otb TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `title` | TEXT | 标题 |
| `loan_jump_url` | TEXT | 借贷jump链接 |
| `red_dot_index` | INTEGER | 红包dot索引 |
| `is_show_entry` | INTEGER | 是否显示入口 |
| `tips` | TEXT | 提示 |
| `is_overdue` | INTEGER | (is_overdue) |
| `available_otb` | TEXT | (available_otb) |

### `LocalGameReport` — 本地游戏上报表

```sql
CREATE TABLE LocalGameReport (  pkgName TEXT PRIMARY KEY ,  lastReportTimeStamp LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `pkgName` | TEXT | pkg名称 |
| `lastReportTimeStamp` | LONG | 最后上报时间戳 |

### `LocalLiteAppConf` — 本地lite应用conf表

```sql
CREATE TABLE LocalLiteAppConf (  url TEXT PRIMARY KEY ,  appid TEXT,  path TEXT,  expire_duration INTEGER,  refresh_duration INTEGER,  wepkg_id TEXT,  updateTime LONG,  hasLiteConf INTEGER default 'false' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `url` | TEXT | 链接 |
| `appid` | TEXT | 应用ID |
| `path` | TEXT | 路径 |
| `expire_duration` | INTEGER | 过期时长 |
| `refresh_duration` | INTEGER | 引用resh时长 |
| `wepkg_id` | TEXT | wepkgID |
| `updateTime` | LONG | 更新时间 |
| `hasLiteConf` | INTEGER | (hasLiteConf) |

### `LocalRedPacketStoryInfo` — 本地红包红包story表

```sql
CREATE TABLE LocalRedPacketStoryInfo (  title TEXT,  logo_url TEXT,  logo_md5 TEXT,  description TEXT,  corp_name TEXT,  action_type INTEGER,  action_url TEXT,  action_app_username TEXT,  action_app_nickname TEXT,  packet_id TEXT PRIMARY KEY ,  update_time LONG,  subtype_id INTEGER,  action_emotion_designer_uin INTEGER,  action_jump_text TEXT,  joint_label_text TEXT,  same_receive_link TEXT,  detail_dynamic_url TEXT,  action_before_jump_text TEXT,  action_normal_icon_url TEXT,  action_dark_icon_url TEXT,  wxapp_info_app_name TEXT,  wxapp_info_app_path TEXT,  wxapp_info_wording TEXT,  wxapp_info_icon_url TEXT,  detail_atmosphere_pag_url TEXT,  detail_image_url TEXT,  detail_image_url_md5 TEXT,  outer_jump_action_type INTEGER,  outer_jump_action_jump_text TEXT,  outer_jump_action_app_username TEXT,  outer_jump_action_jump_newlife INTEGER,  ecs_jump_info_str TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `title` | TEXT | 标题 |
| `logo_url` | TEXT | 日志o链接 |
| `logo_md5` | TEXT | 日志oMD5 |
| `description` | TEXT | 描述 |
| `corp_name` | TEXT | corp名称 |
| `action_type` | INTEGER | 动作类型 |
| `action_url` | TEXT | 动作链接 |
| `action_app_username` | TEXT | 动作应用用户名 |
| `action_app_nickname` | TEXT | 动作应用昵称 |
| `packet_id` | TEXT | 红包ID |
| `update_time` | LONG | 更新时间 |
| `subtype_id` | INTEGER | 子类型ID |
| `action_emotion_designer_uin` | INTEGER | 动作表情de签名erQQ号/UIN |
| `action_jump_text` | TEXT | 动作jump文本 |
| `joint_label_text` | TEXT | 加入t标签文本 |
| `same_receive_link` | TEXT | samereceive链接 |
| `detail_dynamic_url` | TEXT | 详情dynamic链接 |
| `action_before_jump_text` | TEXT | 动作beforejump文本 |
| `action_normal_icon_url` | TEXT | 动作normal图标链接 |
| `action_dark_icon_url` | TEXT | 动作dark图标链接 |
| `wxapp_info_app_name` | TEXT | wx应用信息应用名称 |
| `wxapp_info_app_path` | TEXT | wx应用信息应用路径 |
| `wxapp_info_wording` | TEXT | wx应用信息文案 |
| `wxapp_info_icon_url` | TEXT | wx应用信息图标链接 |
| `detail_atmosphere_pag_url` | TEXT | 详情atmospherepag链接 |
| `detail_image_url` | TEXT | 详情图片链接 |
| `detail_image_url_md5` | TEXT | 详情图片链接MD5 |
| `outer_jump_action_type` | INTEGER | outerjump动作类型 |
| `outer_jump_action_jump_text` | TEXT | outerjump动作jump文本 |
| `outer_jump_action_app_username` | TEXT | outerjump动作应用用户名 |
| `outer_jump_action_jump_newlife` | INTEGER | outerjump动作jumpnewlife |
| `ecs_jump_info_str` | TEXT | ecsjum置顶fostr |

### `LocalStoryDetail` — 本地story详情表

```sql
CREATE TABLE LocalStoryDetail (  media_type INTEGER,  media_url TEXT,  media_md5 TEXT,  height INTEGER,  width INTEGER,  packet_id TEXT,  media_fuzzy_thumbnail_url TEXT,  media_fuzzy_thumbnail_md5 TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `media_type` | INTEGER | 媒体类型 |
| `media_url` | TEXT | 媒体链接 |
| `media_md5` | TEXT | 媒体MD5 |
| `height` | INTEGER | 高 |
| `width` | INTEGER | 宽 |
| `packet_id` | TEXT | 红包ID |
| `media_fuzzy_thumbnail_url` | TEXT | 媒体fuzzy缩略图nail链接 |
| `media_fuzzy_thumbnail_md5` | TEXT | 媒体fuzzy缩略图nailMD5 |

### `LuckyMoneyDetailOpenRecord` — lucky金额详情open记录表

```sql
CREATE TABLE LuckyMoneyDetailOpenRecord (  send_id TEXT PRIMARY KEY ,  open_count INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `send_id` | TEXT | 发送ID |
| `open_count` | INTEGER | open数量 |

### `LuckyMoneyEnvelopeResource` — lucky金额环境elope资源表

```sql
CREATE TABLE LuckyMoneyEnvelopeResource (  subtype INTEGER PRIMARY KEY ,  bubbleMd5 TEXT,  bubbledynamicMd5 TEXT,  coverMd5 TEXT,  minilogoMd5 TEXT,  detailMd5 TEXT,  version INTEGER,  bubblewidgetMd5 TEXT,  coverwidgetMd5 TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `subtype` | INTEGER | 子类型 |
| `bubbleMd5` | TEXT | bubbleMD5 |
| `bubbledynamicMd5` | TEXT | bubbledynami命令5 |
| `coverMd5` | TEXT | 封面MD5 |
| `minilogoMd5` | TEXT | 最小i日志oMD5 |
| `detailMd5` | TEXT | 详情MD5 |
| `version` | INTEGER | 版本 |
| `bubblewidgetMd5` | TEXT | bubblewIDgetMD5 |
| `coverwidgetMd5` | TEXT | 封面wIDgetMD5 |

### `MagicPkgInfo` — 魔法表情包信息

```sql
CREATE TABLE MagicPkgInfo (  pkgId TEXT PRIMARY KEY ,  pkgPath TEXT,  unZipPath TEXT,  pkgType INTEGER,  patchId TEXT,  updateTime LONG,  version TEXT,  url TEXT,  md5 TEXT,  lastUseTime LONG,  wxaPkgPath TEXT,  originalName TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `pkgId` | TEXT | pkgID |
| `pkgPath` | TEXT | pkg路径 |
| `unZipPath` | TEXT | unzip路径 |
| `pkgType` | INTEGER | pkg类型 |
| `patchId` | TEXT | 补丁ID |
| `updateTime` | LONG | 更新时间 |
| `version` | TEXT | 版本 |
| `url` | TEXT | 链接 |
| `md5` | TEXT | MD5 |
| `lastUseTime` | LONG | 最后使用时间 |
| `wxaPkgPath` | TEXT | wxapkg路径 |
| `originalName` | TEXT | 原始al名称 |

### `MediaDuplication` — 媒体duplication表

```sql
CREATE TABLE MediaDuplication  (md5 text , size int , path text , createtime long, remuxing text, duration int, status int)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `md5` | TEXT | MD5 |
| `size` | INT | 大小 |
| `path` | TEXT | 路径 |
| `createtime` | long | 创建时间 |
| `remuxing` | TEXT | (remuxing) |
| `duration` | INT | 时长 |
| `status` | INT | 状态 |

### `MsgQuote` — 消息引用表

```sql
CREATE TABLE MsgQuote (  msgId LONG,  msgSvrId LONG,  quotedMsgId LONG,  quotedMsgSvrId LONG,  status INTEGER,  quotedMsgTalker TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `quotedMsgId` | LONG | 引用d消息ID |
| `quotedMsgSvrId` | LONG | 引用d消息服务器ID |
| `status` | INTEGER | 状态 |
| `quotedMsgTalker` | TEXT | 引用d消息talker |

### `MultiTalkInfo` — 群聊表

```sql
CREATE TABLE MultiTalkInfo (  wxGroupId TEXT PRIMARY KEY ,  groupId TEXT,  roomId INTEGER,  roomKey LONG,  routeId INTEGER,  inviteUserName TEXT,  memberCount INTEGER,  createTime LONG,  state INTEGER default '0' ,  ilinkRoomId LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `wxGroupId` | TEXT | wx群ID |
| `groupId` | TEXT | 群ID |
| `roomId` | INTEGER | 房间ID |
| `roomKey` | LONG | 群键 |
| `routeId` | INTEGER | routeID |
| `inviteUserName` | TEXT | 邀请用户名 |
| `memberCount` | INTEGER | 群成员数 |
| `createTime` | LONG | 创建时间 |
| `state` | INTEGER | 状态 |
| `ilinkRoomId` | LONG | i链接房间ID |

### `MultiTalkMember` — 群聊成员表

```sql
CREATE TABLE MultiTalkMember (  memberUuid LONG,  wxGroupId TEXT,  userName TEXT,  inviteUserName TEXT,  memberId LONG,  status INTEGER,  createTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `memberUuid` | LONG | 成员UUID |
| `wxGroupId` | TEXT | wx群ID |
| `userName` | TEXT | 用户名 |
| `inviteUserName` | TEXT | 邀请用户名 |
| `memberId` | LONG | 成员ID |
| `status` | INTEGER | 状态 |
| `createTime` | LONG | 创建时间 |

### `MultiTaskInfo` — 多task表

```sql
CREATE TABLE MultiTaskInfo (  id TEXT PRIMARY KEY ,  type INTEGER default '0' ,  createTime LONG default '0' ,  updateTime LONG default '0' ,  showData BLOB,  data BLOB default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | TEXT | ID |
| `type` | INTEGER | 类型 |
| `createTime` | LONG | 创建时间 |
| `updateTime` | LONG | 更新时间 |
| `showData` | BLOB | 显示数据 |
| `data` | BLOB | 数据 |

### `Music` — 音乐

```sql
CREATE TABLE Music (  musicId TEXT PRIMARY KEY ,  originMusicId TEXT,  musicType INTEGER,  downloadedLength LONG,  wifiDownloadedLength LONG,  endFlag INTEGER,  wifiEndFlag INTEGER,  updateTime LONG,  songId INTEGER,  songName TEXT,  songSinger TEXT,  songAlbum TEXT,  songAlbumType INTEGER,  songAlbumUrl TEXT,  songHAlbumUrl TEXT,  songAlbumLocalPath TEXT,  songWifiUrl TEXT,  songWapLinkUrl TEXT,  songWebUrl TEXT,  appId TEXT,  songMediaId TEXT,  songSnsAlbumUser TEXT,  songSnsShareUser TEXT,  songLyric TEXT,  songBgColor INTEGER,  songLyricColor INTEGER,  songFileLength LONG,  songWifiFileLength LONG,  hideBanner INTEGER,  jsWebUrlDomain TEXT,  isBlock INTEGER,  startTime INTEGER,  mimetype TEXT,  protocol TEXT,  barBackToWebView INTEGER,  musicbar_url TEXT,  srcUsername TEXT,  playbackRate DOUBLE,  songMId TEXT,  mid TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `musicId` | TEXT | 音乐ID |
| `originMusicId` | TEXT | 原始音乐ID |
| `musicType` | INTEGER | 音乐类型 |
| `downloadedLength` | LONG | 下载ed长度 |
| `wifiDownloadedLength` | LONG | WiFi下载ed长度 |
| `endFlag` | INTEGER | 结束标志 |
| `wifiEndFlag` | INTEGER | WiFi结束标志 |
| `updateTime` | LONG | 更新时间 |
| `songId` | INTEGER | songID |
| `songName` | TEXT | song名称 |
| `songSinger` | TEXT | (songSinger) |
| `songAlbum` | TEXT | (songAlbum) |
| `songAlbumType` | INTEGER | songalbum类型 |
| `songAlbumUrl` | TEXT | songalbum链接 |
| `songHAlbumUrl` | TEXT | songhalbum链接 |
| `songAlbumLocalPath` | TEXT | songalbum本地路径 |
| `songWifiUrl` | TEXT | songWiFi链接 |
| `songWapLinkUrl` | TEXT | songwap链接链接 |
| `songWebUrl` | TEXT | songweb链接 |
| `appId` | TEXT | 应用ID |
| `songMediaId` | TEXT | song媒体ID |
| `songSnsAlbumUser` | TEXT | song朋友圈album用户 |
| `songSnsShareUser` | TEXT | song朋友圈分享用户 |
| `songLyric` | TEXT | (songLyric) |
| `songBgColor` | INTEGER | song背景颜色 |
| `songLyricColor` | INTEGER | songlyric颜色 |
| `songFileLength` | LONG | song文件长度 |
| `songWifiFileLength` | LONG | songWiFi文件长度 |
| `hideBanner` | INTEGER | hIDe横幅 |
| `jsWebUrlDomain` | TEXT | jsweb链接domain |
| `isBlock` | INTEGER | 是否块 |
| `startTime` | INTEGER | 开始时间 |
| `mimetype` | TEXT | mime类型 |
| `protocol` | TEXT | (protocol) |
| `barBackToWebView` | INTEGER | barbacktoweb查看 |
| `musicbar_url` | TEXT | 音乐bar链接 |
| `srcUsername` | TEXT | src用户名 |
| `playbackRate` | DOUBLE | 播放back速率 |
| `songMId` | TEXT | songmID |
| `mid` | TEXT | mID |

### `NewTipsInfo` — 新提示信息

```sql
CREATE TABLE NewTipsInfo (  tipId INTEGER default '0'  PRIMARY KEY ,  tipVersion INTEGER,  tipkey TEXT,  tipType INTEGER,  isExit INTEGER,  hadRead INTEGER,  isReject INTEGER,  beginShowTime LONG,  disappearTime LONG,  overdueTime LONG,  tipsShowInfo BLOB,  extInfo TEXT,  pagestaytime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `tipId` | INTEGER | 提示ID |
| `tipVersion` | INTEGER | 提示版本 |
| `tipkey` | TEXT | 提示键 |
| `tipType` | INTEGER | 提示类型 |
| `isExit` | INTEGER | 是否退出 |
| `hadRead` | INTEGER | 曾已读 |
| `isReject` | INTEGER | (isReject) |
| `beginShowTime` | LONG | 开始显示时间 |
| `disappearTime` | LONG | dis应用ear时间 |
| `overdueTime` | LONG | overdue时间 |
| `tipsShowInfo` | BLOB | 提示显示信息 |
| `extInfo` | TEXT | 扩展信息 |
| `pagestaytime` | LONG | 页stay时间 |

### `NewTipsInfo2` — new提示信息2表

```sql
CREATE TABLE NewTipsInfo2 (  uniqueId TEXT,  path INTEGER,  showType INTEGER,  title TEXT,  icon_url TEXT,  parents BLOB,  tipId INTEGER,  priority INTEGER,  tipType INTEGER,  beginShowTime LONG,  exposureTime LONG,  overdueTime LONG,  disappearTime LONG,  exposureDisappearTime LONG,  minClientVersion INTEGER,  maxClientVersion INTEGER,  extInfo TEXT,  state INTEGER default '0' ,  dynamicPath TEXT,  lang TEXT,  regCountry TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `uniqueId` | TEXT | uniqueID |
| `path` | INTEGER | 路径 |
| `showType` | INTEGER | 显示类型 |
| `title` | TEXT | 标题 |
| `icon_url` | TEXT | 图标链接 |
| `parents` | BLOB | 父s |
| `tipId` | INTEGER | 提示ID |
| `priority` | INTEGER | 优先级 |
| `tipType` | INTEGER | 提示类型 |
| `beginShowTime` | LONG | 开始显示时间 |
| `exposureTime` | LONG | exposure时间 |
| `overdueTime` | LONG | overdue时间 |
| `disappearTime` | LONG | dis应用ear时间 |
| `exposureDisappearTime` | LONG | exposu红包is应用ear时间 |
| `minClientVersion` | INTEGER | 最小客户端版本 |
| `maxClientVersion` | INTEGER | 最大客户端版本 |
| `extInfo` | TEXT | 扩展信息 |
| `state` | INTEGER | 状态 |
| `dynamicPath` | TEXT | dynamic路径 |
| `lang` | TEXT | 语言 |
| `regCountry` | TEXT | reg国家 |

### `NotifyMessageRecord` — 通知消息记录表

```sql
CREATE TABLE NotifyMessageRecord (  msgId LONG PRIMARY KEY ,  talker TEXT,  createTime LONG,  digest TEXT,  is_special_talker INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `createTime` | LONG | 创建时间 |
| `digest` | TEXT | 摘要 |
| `is_special_talker` | INTEGER | (is_special_talker) |

### `OfflineOrderStatus` — off线顺序状态表

```sql
CREATE TABLE OfflineOrderStatus (  reqkey TEXT PRIMARY KEY ,  ack_key TEXT,  status INTEGER,  receive_time LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `reqkey` | TEXT | req键 |
| `ack_key` | TEXT | ack键 |
| `status` | INTEGER | 状态 |
| `receive_time` | LONG | receive时间 |

### `OldAccountFriend` — old账号好友表

```sql
CREATE TABLE OldAccountFriend (  encryptUsername TEXT,  oldUsername TEXT,  ticket TEXT,  nickname TEXT,  addState INTEGER,  showHead INTEGER,  pinyinName TEXT,  username TEXT,  seq INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `encryptUsername` | TEXT | 加密用户名 |
| `oldUsername` | TEXT | old用户名 |
| `ticket` | TEXT | 票据 |
| `nickname` | TEXT | 昵称 |
| `addState` | INTEGER | 广告d状态 |
| `showHead` | INTEGER | 显示头像 |
| `pinyinName` | TEXT | 置顶yin名称 |
| `username` | TEXT | 用户名 |
| `seq` | INTEGER | 序号 |

### `OpenIMAccTypeInfo` — openimacc类型表

```sql
CREATE TABLE OpenIMAccTypeInfo (  acctTypeId TEXT,  language TEXT,  accTypeRec BLOB,  updateTime LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `acctTypeId` | TEXT | acct类型ID |
| `language` | TEXT | 语言uage |
| `accTypeRec` | BLOB | acc类型rec |
| `updateTime` | LONG | 更新时间 |

### `OpenIMAppIdInfo` — openim应用ID表

```sql
CREATE TABLE OpenIMAppIdInfo (  appid TEXT,  language TEXT,  appRec BLOB,  updateTime LONG default '0' ,  acctTypeId TEXT,  subType INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appid` | TEXT | 应用ID |
| `language` | TEXT | 语言uage |
| `appRec` | BLOB | 应用rec |
| `updateTime` | LONG | 更新时间 |
| `acctTypeId` | TEXT | acct类型ID |
| `subType` | INTEGER | 子类型 |

### `OpenIMArchive` — openim归档表

```sql
CREATE TABLE OpenIMArchive (  username TEXT PRIMARY KEY ,  content TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `content` | TEXT | 内容 |

### `OpenIMFinderInfoNew` — openim视频号信息表

```sql
CREATE TABLE OpenIMFinderInfoNew (  openIMUsername TEXT PRIMARY KEY ,  finder_username TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `openIMUsername` | TEXT | openim用户名 |
| `finder_username` | TEXT | 视频号用户名 |

### `OpenIMKefuContact` — openimkefu联系人表

```sql
CREATE TABLE OpenIMKefuContact (  username TEXT default ''  PRIMARY KEY ,  nickname TEXT default '' ,  bigHeadImg TEXT default '' ,  smallHeadImg TEXT default '' ,  nicknamePyInit TEXT default '' ,  nicknamePyQuanPin TEXT default '' ,  openImAppId TEXT default '' ,  openImDescWordingId TEXT default '' ,  source INTEGER default '' ,  checkTime INTEGER default '0' ,  customInfoDetailVisible INTEGER,  customInfoDetail TEXT,  ticket TEXT,  type LONG default '0' ,  finderUsername TEXT default '' ,  kfUrl TEXT default '' ,  hasSetReport INTEGER default 'false' ,  needReport INTEGER default 'false' ,  locationType TEXT default 'Wsg84' ,  kefuType INTEGER default '0' ,  kefuToolsInfo TEXT default '' ,  enterprise_auth_status INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `nickname` | TEXT | 昵称 |
| `bigHeadImg` | TEXT | big头像图片 |
| `smallHeadImg` | TEXT | s商城头像图片 |
| `nicknamePyInit` | TEXT | 昵称pyinit |
| `nicknamePyQuanPin` | TEXT | 昵称pyquan置顶 |
| `openImAppId` | TEXT | openim应用ID |
| `openImDescWordingId` | TEXT | openim描述文案ID |
| `source` | INTEGER | 来源 |
| `checkTime` | INTEGER | check时间 |
| `customInfoDetailVisible` | INTEGER | custo最小fo详情visible |
| `customInfoDetail` | TEXT | custo最小fo详情 |
| `ticket` | TEXT | 票据 |
| `type` | LONG | 类型 |
| `finderUsername` | TEXT | 视频号用户名 |
| `kfUrl` | TEXT | kf链接 |
| `hasSetReport` | INTEGER | 是否set上报 |
| `needReport` | INTEGER | 是否上报 |
| `locationType` | TEXT | location类型 |
| `kefuType` | INTEGER | kefu类型 |
| `kefuToolsInfo` | TEXT | kefutools信息 |
| `enterprise_auth_status` | INTEGER | 企业授权状态 |

### `OpenIMSnsFlag` — openim朋友圈标志表

```sql
CREATE TABLE OpenIMSnsFlag (  openIMUsername TEXT PRIMARY KEY ,  openIMSnsFlag LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `openIMUsername` | TEXT | openim用户名 |
| `openIMSnsFlag` | LONG | openim朋友圈标志 |

### `OpenIMWordingInfo` — openim文案表

```sql
CREATE TABLE OpenIMWordingInfo (  appid TEXT,  wordingId TEXT,  language TEXT,  wording TEXT,  pinyin TEXT,  quanpin TEXT,  updateTime LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appid` | TEXT | 应用ID |
| `wordingId` | TEXT | 文案ID |
| `language` | TEXT | 语言uage |
| `wording` | TEXT | 文案 |
| `pinyin` | TEXT | 置顶yin |
| `quanpin` | TEXT | 全拼 |
| `updateTime` | LONG | 更新时间 |

### `OpenMsgListener` — open消息列表ener表

```sql
CREATE TABLE OpenMsgListener (  appId TEXT PRIMARY KEY ,  packageName TEXT,  status INTEGER default '0' ,  sceneFlag INTEGER default '0' ,  msgTypeFlag INTEGER default '0' ,  msgState INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `packageName` | TEXT | 包名称 |
| `status` | INTEGER | 状态 |
| `sceneFlag` | INTEGER | 场景标志 |
| `msgTypeFlag` | INTEGER | 消息类型标志 |
| `msgState` | INTEGER | 消息状态 |

### `OrderCommonMsgXml` — 顺序common消息XML表

```sql
CREATE TABLE OrderCommonMsgXml (  msgId TEXT PRIMARY KEY ,  msgContentXml TEXT,  isRead TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | TEXT | 消息ID |
| `msgContentXml` | TEXT | 消息内容XML |
| `isRead` | TEXT | 是否已读 |

### `PBCache` — pb缓存表

```sql
CREATE TABLE PBCache (  key TEXT PRIMARY KEY ,  value BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `value` | BLOB | 值 |

### `PendingCardId` — p结束ing卡片ID表

```sql
CREATE TABLE PendingCardId (  cardUserId TEXT PRIMARY KEY ,  retryCount INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `cardUserId` | TEXT | 卡片用户ID |
| `retryCount` | INTEGER | 重试数量 |

### `PieceMusicInfo` — 片段音乐信息

```sql
CREATE TABLE PieceMusicInfo (  musicId TEXT PRIMARY KEY ,  musicUrl TEXT,  fileName TEXT,  indexBitData BLOB,  fileCacheComplete INTEGER,  pieceFileMIMEType TEXT,  removeDirtyBit INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `musicId` | TEXT | 音乐ID |
| `musicUrl` | TEXT | 音乐链接 |
| `fileName` | TEXT | 文件名称 |
| `indexBitData` | BLOB | 索引位数据 |
| `fileCacheComplete` | INTEGER | 文件缓存完成 |
| `pieceFileMIMEType` | TEXT | 片段文件mime类型 |
| `removeDirtyBit` | INTEGER | removedirty位 |

### `PocketMoneyMsgRecord` — pocket金额消息记录表

```sql
CREATE TABLE PocketMoneyMsgRecord (  payMsgId TEXT PRIMARY KEY ,  msgId LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `payMsgId` | TEXT | 支付消息ID |
| `msgId` | LONG | 消息ID |

### `ProfileInfo` — 资料表

```sql
CREATE TABLE ProfileInfo (  username TEXT PRIMARY KEY ,  originalArticleCount INTEGER default '1' ,  friendSubscribeCount INTEGER default '1' ,  allArticleWording TEXT,  historyArticlesUrl TEXT,  userRole INTEGER default '1' ,  banReason TEXT,  showRecommendArticle INTEGER default '0' ,  showService INTEGER default '0' ,  messageListStr TEXT,  serviceInfoListStr TEXT,  bizAccountListStr TEXT,  cacheTime LONG default '0' ,  decryptUserName TEXT default '' ,  hiddenAvatar INTEGER default '0' ,  hiddenButtonBeforeFocus INTEGER default '0' ,  newBanReason TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `originalArticleCount` | INTEGER | 原始alarticle数量 |
| `friendSubscribeCount` | INTEGER | 好友订阅数量 |
| `allArticleWording` | TEXT | allarticle文案 |
| `historyArticlesUrl` | TEXT | 历史articles链接 |
| `userRole` | INTEGER | 用户角色 |
| `banReason` | TEXT | ban原因 |
| `showRecommendArticle` | INTEGER | 显示推荐article |
| `showService` | INTEGER | 显示服务 |
| `messageListStr` | TEXT | 消息列表str |
| `serviceInfoListStr` | TEXT | 服务信息列表str |
| `bizAccountListStr` | TEXT | 业务账号列表str |
| `cacheTime` | LONG | 缓存时间 |
| `decryptUserName` | TEXT | 解密用户名 |
| `hiddenAvatar` | INTEGER | 隐藏头像 |
| `hiddenButtonBeforeFocus` | INTEGER | 隐藏buttonbefo引用ocus |
| `newBanReason` | TEXT | newban原因 |

### `RecordCDNInfo` — 记录CDN表

```sql
CREATE TABLE RecordCDNInfo (  localId INTEGER PRIMARY KEY ,  recordLocalId INTEGER,  toUser TEXT default '' ,  dataId TEXT,  mediaId TEXT,  path TEXT,  cdnUrl TEXT,  cdnKey TEXT,  totalLen INTEGER default '0' ,  isThumb INTEGER default 'false' ,  offset INTEGER default '0' ,  type INTEGER default '0' ,  fileType INTEGER default '5' ,  status INTEGER default '0' ,  errCode INTEGER default '0' ,  tpaeskey TEXT,  tpauthkey TEXT,  tpdataurl TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `localId` | INTEGER | 本地ID |
| `recordLocalId` | INTEGER | 记录本地ID |
| `toUser` | TEXT | to用户 |
| `dataId` | TEXT | 数据ID |
| `mediaId` | TEXT | 媒体ID |
| `path` | TEXT | 路径 |
| `cdnUrl` | TEXT | CDN链接 |
| `cdnKey` | TEXT | CDN键 |
| `totalLen` | INTEGER | 总len |
| `isThumb` | INTEGER | 是否缩略图 |
| `offset` | INTEGER | 偏移 |
| `type` | INTEGER | 类型 |
| `fileType` | INTEGER | 文件类型 |
| `status` | INTEGER | 状态 |
| `errCode` | INTEGER | err码 |
| `tpaeskey` | TEXT | tpaes键 |
| `tpauthkey` | TEXT | tp授权键 |
| `tpdataurl` | TEXT | tp数据链接 |

### `RecordMessageInfo` — 记录消息表

```sql
CREATE TABLE RecordMessageInfo (  localId INTEGER PRIMARY KEY ,  msgId LONG default '-1' ,  oriMsgId LONG default '-1' ,  toUser TEXT default '' ,  title TEXT,  desc TEXT,  dataProto BLOB,  type INTEGER default '0' ,  status INTEGER default '0' ,  favFrom TEXT,  oriMsgTalker TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `localId` | INTEGER | 本地ID |
| `msgId` | LONG | 消息ID |
| `oriMsgId` | LONG | ori消息ID |
| `toUser` | TEXT | to用户 |
| `title` | TEXT | 标题 |
| `desc` | TEXT | 描述 |
| `dataProto` | BLOB | 数据proto |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `favFrom` | TEXT | (favFrom) |
| `oriMsgTalker` | TEXT | ori消息talker |

### `RemittanceRecord` — remittance记录表

```sql
CREATE TABLE RemittanceRecord (  transferId TEXT PRIMARY KEY ,  locaMsgId LONG,  receiveStatus INTEGER default '-1' ,  isSend INTEGER,  talker TEXT,  invalidtime LONG,  receiverName TEXT,  hasClicked INTEGER,  receiveTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `transferId` | TEXT | 转账/转移ID |
| `locaMsgId` | LONG | loca消息ID |
| `receiveStatus` | INTEGER | receive状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `invalidtime` | LONG | in有效时间 |
| `receiverName` | TEXT | 接收者名称 |
| `hasClicked` | INTEGER | 是否已点击 |
| `receiveTime` | LONG | receive时间 |

### `RtosQuickReplyInfo` — rtosquick回复表

```sql
CREATE TABLE RtosQuickReplyInfo (  orderIndex INTEGER,  quickMsg TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `orderIndex` | INTEGER | 顺序索引 |
| `quickMsg` | TEXT | quick消息 |

### `SafeDeviceInfo` — safe设备表

```sql
CREATE TABLE SafeDeviceInfo (  uid TEXT default ''  PRIMARY KEY ,  name TEXT default '' ,  devicetype TEXT default '' ,  createtime LONG default '0' ,  online INTEGER default 'false' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `uid` | TEXT | uid |
| `name` | TEXT | 名称 |
| `devicetype` | TEXT | 设备类型 |
| `createtime` | LONG | 创建时间 |
| `online` | INTEGER | on线 |

### `ScanHistoryItem` — 扫描历史项表

```sql
CREATE TABLE ScanHistoryItem (  productId TEXT PRIMARY KEY ,  xmlContent TEXT,  ScanTime LONG,  funcType INTEGER,  qrcodeUrl TEXT,  scene INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `productId` | TEXT | 产品ID |
| `xmlContent` | TEXT | XML内容 |
| `ScanTime` | LONG | 扫描时间 |
| `funcType` | INTEGER | 功能类型 |
| `qrcodeUrl` | TEXT | 二维码链接 |
| `scene` | INTEGER | 场景 |

### `ScanTranslationResult` — 扫描翻译纬度ion结果表

```sql
CREATE TABLE ScanTranslationResult (  originMD5 TEXT PRIMARY KEY ,  resultFile TEXT,  fromLang TEXT,  toLang TEXT,  brand TEXT,  originalImageFileId TEXT,  originalImageAesKey TEXT,  resultImageFileId TEXT,  resultImageAesKey TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `originMD5` | TEXT | 原始MD5 |
| `resultFile` | TEXT | 结果文件 |
| `fromLang` | TEXT | from语言 |
| `toLang` | TEXT | to语言 |
| `brand` | TEXT | 品牌 |
| `originalImageFileId` | TEXT | 原始al图片文件ID |
| `originalImageAesKey` | TEXT | 原始al图片aes键 |
| `resultImageFileId` | TEXT | 结果图片文件ID |
| `resultImageAesKey` | TEXT | 结果图片aes键 |

### `SelectRecord` — select记录表

```sql
CREATE TABLE SelectRecord (  historyId TEXT,  msgId LONG,  talker TEXT,  chatHistoryItem BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `historyId` | TEXT | 历史ID |
| `msgId` | LONG | 消息ID |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `chatHistoryItem` | BLOB | 聊天历史项 |

### `ShakeNewYearFriendInfo` — shakenewyear好友表

```sql
CREATE TABLE ShakeNewYearFriendInfo (  username TEXT default ''  PRIMARY KEY ,  lastshaketime INTEGER default '0' ,  isshowed INTEGER default 'false' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `lastshaketime` | INTEGER | 最后shake时间 |
| `isshowed` | INTEGER | 是否显示ed |

### `ShareCardInfo` — 分享卡片表

```sql
CREATE TABLE ShareCardInfo (  card_id TEXT PRIMARY KEY ,  card_tp_id TEXT,  from_username TEXT,  consumer TEXT,  app_id TEXT,  status INTEGER,  share_time LONG,  local_updateTime LONG,  updateTime LONG,  begin_time LONG,  end_time LONG,  updateSeq LONG,  block_mask LONG,  dataInfoData BLOB,  cardTpInfoData BLOB,  shareInfoData BLOB,  shopInfoData BLOB,  categoryType INTEGER default '0' ,  itemIndex INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `card_id` | TEXT | 卡片ID |
| `card_tp_id` | TEXT | 卡片tpID |
| `from_username` | TEXT | from用户名 |
| `consumer` | TEXT | (consumer) |
| `app_id` | TEXT | 应用ID |
| `status` | INTEGER | 状态 |
| `share_time` | LONG | 分享时间 |
| `local_updateTime` | LONG | 本地更新时间 |
| `updateTime` | LONG | 更新时间 |
| `begin_time` | LONG | 开始时间 |
| `end_time` | LONG | 结束时间 |
| `updateSeq` | LONG | 更新序号 |
| `block_mask` | LONG | 块mask |
| `dataInfoData` | BLOB | 数据信息数据 |
| `cardTpInfoData` | BLOB | 卡片t置顶fo数据 |
| `shareInfoData` | BLOB | 分享信息数据 |
| `shopInfoData` | BLOB | 店铺信息数据 |
| `categoryType` | INTEGER | 分类类型 |
| `itemIndex` | INTEGER | 项索引 |

### `ShareCardSyncItemInfo` — 分享卡片同步项表

```sql
CREATE TABLE ShareCardSyncItemInfo (  card_id TEXT PRIMARY KEY ,  state_flag INTEGER,  update_time LONG,  seq LONG,  retryCount INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `card_id` | TEXT | 卡片ID |
| `state_flag` | INTEGER | 状态标志 |
| `update_time` | LONG | 更新时间 |
| `seq` | LONG | 序号 |
| `retryCount` | INTEGER | 重试数量 |

### `SignedAgreementInfo` — 签名ed同意ment表

```sql
CREATE TABLE SignedAgreementInfo (  key TEXT PRIMARY KEY ,  selfUsername TEXT,  id INTEGER,  signedVersion INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `selfUsername` | TEXT | 自己用户名 |
| `id` | INTEGER | ID |
| `signedVersion` | INTEGER | 签名ed版本 |

### `SmileyInfo` — 小表情(smiley)信息

```sql
CREATE TABLE SmileyInfo (  key TEXT PRIMARY KEY ,  cnValue TEXT,  qqValue TEXT,  twValue TEXT,  enValue TEXT,  thValue TEXT,  fileName TEXT,  eggIndex INTEGER default '-1' ,  position INTEGER default '-1' ,  flag INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `cnValue` | TEXT | cn值 |
| `qqValue` | TEXT | qq值 |
| `twValue` | TEXT | tw值 |
| `enValue` | TEXT | 环境alue |
| `thValue` | TEXT | th值 |
| `fileName` | TEXT | 文件名称 |
| `eggIndex` | INTEGER | egg索引 |
| `position` | INTEGER | 位置 |
| `flag` | INTEGER | 标志 |

### `SmileyPanelConfigInfo` — 小表情panel配置表

```sql
CREATE TABLE SmileyPanelConfigInfo (  key TEXT PRIMARY KEY ,  position INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `position` | INTEGER | 位置 |

### `Stranger` — 陌生人表

```sql
CREATE TABLE Stranger (  encryptUsername TEXT default ''  PRIMARY KEY ,  conRemark TEXT default '' ,  contactLabels TEXT default '' ,  conDescription TEXT default '' ,  conPhone TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `encryptUsername` | TEXT | 加密用户名 |
| `conRemark` | TEXT | 我给对方设的备注名(优先显示) |
| `contactLabels` | TEXT | 联系人标签s |
| `conDescription` | TEXT | con描述 |
| `conPhone` | TEXT | con手机 |

### `TablesVersion` — tables版本表

```sql
CREATE TABLE TablesVersion (  tableHash INTEGER PRIMARY KEY ,  tableSQLMD5 TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `tableHash` | INTEGER | table哈希 |
| `tableSQLMD5` | TEXT | tablesqlMD5 |

### `TaskBarInfo` — tasKBar表

```sql
CREATE TABLE TaskBarInfo (  id TEXT PRIMARY KEY ,  type INTEGER default '0' ,  createTime LONG default '0' ,  updateTime LONG default '0' ,  showData BLOB,  data BLOB default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | TEXT | ID |
| `type` | INTEGER | 类型 |
| `createTime` | LONG | 创建时间 |
| `updateTime` | LONG | 更新时间 |
| `showData` | BLOB | 显示数据 |
| `data` | BLOB | 数据 |

### `TopMsgInfoRecord` — 置顶消息信息记录表

```sql
CREATE TABLE TopMsgInfoRecord (  chatRoomName TEXT,  id INTEGER,  isCancel INTEGER default 'false' ,  topMsgInfoItem BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `chatRoomName` | TEXT | 群ID(<id>@chatroom,主键) |
| `id` | INTEGER | ID |
| `isCancel` | INTEGER | (isCancel) |
| `topMsgInfoItem` | BLOB | 置顶消息信息项 |

### `UDRResource` — udr资源表

```sql
CREATE TABLE UDRResource (  key TEXT PRIMARY KEY ,  projectId TEXT,  name TEXT,  version INTEGER,  url TEXT,  md5 TEXT,  size LONG,  path TEXT,  postPath TEXT,  category INTEGER,  type INTEGER,  createTime LONG,  updateTime LONG,  extId LONG,  signatureKey TEXT,  fileKey TEXT,  expireTime LONG,  extInfo BLOB,  specifiedExtInfo TEXT,  virtualPath TEXT,  storageType INTEGER,  uinMd5 TEXT,  encryptAlgo INTEGER,  encryptFileSize LONG,  encryptMd5 TEXT,  encryptKey BLOB,  encryptIv BLOB,  encryptTag BLOB,  encryptAad BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `projectId` | TEXT | projectID |
| `name` | TEXT | 名称 |
| `version` | INTEGER | 版本 |
| `url` | TEXT | 链接 |
| `md5` | TEXT | MD5 |
| `size` | LONG | 大小 |
| `path` | TEXT | 路径 |
| `postPath` | TEXT | post路径 |
| `category` | INTEGER | 分类 |
| `type` | INTEGER | 类型 |
| `createTime` | LONG | 创建时间 |
| `updateTime` | LONG | 更新时间 |
| `extId` | LONG | 扩展ID |
| `signatureKey` | TEXT | 签名键 |
| `fileKey` | TEXT | 文件键 |
| `expireTime` | LONG | 过期时间 |
| `extInfo` | BLOB | 扩展信息 |
| `specifiedExtInfo` | TEXT | specified扩展信息 |
| `virtualPath` | TEXT | virtual路径 |
| `storageType` | INTEGER | storage类型 |
| `uinMd5` | TEXT | QQ号/UINMD5 |
| `encryptAlgo` | INTEGER | 加密algo |
| `encryptFileSize` | LONG | 加密文件大小 |
| `encryptMd5` | TEXT | 加密MD5 |
| `encryptKey` | BLOB | 加密键 |
| `encryptIv` | BLOB | 加密iv |
| `encryptTag` | BLOB | 加密标签 |
| `encryptAad` | BLOB | 加密a广告 |

### `UserCardInfo` — 用户卡片表

```sql
CREATE TABLE UserCardInfo (  card_id TEXT PRIMARY KEY ,  card_tp_id TEXT,  from_username TEXT,  status INTEGER,  delete_state_flag INTEGER,  local_updateTime LONG,  updateTime LONG,  updateSeq LONG,  create_time LONG,  begin_time LONG,  end_time LONG,  block_mask TEXT,  dataInfoData BLOB,  cardTpInfoData BLOB,  shareInfoData BLOB,  shopInfoData BLOB,  stickyIndex INTEGER,  stickyEndTime INTEGER,  stickyAnnouncement TEXT,  card_type INTEGER default '-1' ,  label_wording TEXT,  is_dynamic INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `card_id` | TEXT | 卡片ID |
| `card_tp_id` | TEXT | 卡片tpID |
| `from_username` | TEXT | from用户名 |
| `status` | INTEGER | 状态 |
| `delete_state_flag` | INTEGER | 删除状态标志 |
| `local_updateTime` | LONG | 本地更新时间 |
| `updateTime` | LONG | 更新时间 |
| `updateSeq` | LONG | 更新序号 |
| `create_time` | LONG | 创建时间 |
| `begin_time` | LONG | 开始时间 |
| `end_time` | LONG | 结束时间 |
| `block_mask` | TEXT | 块mask |
| `dataInfoData` | BLOB | 数据信息数据 |
| `cardTpInfoData` | BLOB | 卡片t置顶fo数据 |
| `shareInfoData` | BLOB | 分享信息数据 |
| `shopInfoData` | BLOB | 店铺信息数据 |
| `stickyIndex` | INTEGER | 置顶y索引 |
| `stickyEndTime` | INTEGER | 置顶y结束时间 |
| `stickyAnnouncement` | TEXT | 置顶y公告ment |
| `card_type` | INTEGER | 卡片类型 |
| `label_wording` | TEXT | 标签文案 |
| `is_dynamic` | INTEGER | (is_dynamic) |

### `UserOpenIdInApp` — 用户openIDin应用表

```sql
CREATE TABLE UserOpenIdInApp (  openId TEXT PRIMARY KEY ,  appId TEXT,  username TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `openId` | TEXT | openID |
| `appId` | TEXT | 应用ID |
| `username` | TEXT | 用户名 |

### `VideoEditInfo` — 视频edit表

```sql
CREATE TABLE VideoEditInfo (  taskId TEXT PRIMARY KEY ,  baseItemData BLOB,  timeStamp LONG,  mixRetryTime INTEGER,  expiredTime LONG,  status INTEGER,  targetWidth INTEGER,  targetHeight INTEGER,  videoBitrate INTEGER,  audioBitrate INTEGER,  audioSampleRate INTEGER,  audioChannelCount INTEGER,  frameRate INTEGER,  videoRotate INTEGER,  extraConfig BLOB,  reportInfo TEXT,  userData TEXT,  location BLOB,  mixFlag INTEGER,  blurBgPath TEXT,  fromScene INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `taskId` | TEXT | taskID |
| `baseItemData` | BLOB | base项数据 |
| `timeStamp` | LONG | 时间戳 |
| `mixRetryTime` | INTEGER | mix重试时间 |
| `expiredTime` | LONG | 过期d时间 |
| `status` | INTEGER | 状态 |
| `targetWidth` | INTEGER | 目标宽 |
| `targetHeight` | INTEGER | 目标高 |
| `videoBitrate` | INTEGER | 视频位速率 |
| `audioBitrate` | INTEGER | 音频位速率 |
| `audioSampleRate` | INTEGER | 音频sample速率 |
| `audioChannelCount` | INTEGER | 音频渠道数量 |
| `frameRate` | INTEGER | frame速率 |
| `videoRotate` | INTEGER | 视频旋转 |
| `extraConfig` | BLOB | 扩展配置 |
| `reportInfo` | TEXT | 上报信息 |
| `userData` | TEXT | 用户数据 |
| `location` | BLOB | (location) |
| `mixFlag` | INTEGER | mix标志 |
| `blurBgPath` | TEXT | blur背景路径 |
| `fromScene` | INTEGER | from场景 |

### `VideoHash` — 视频哈希表

```sql
CREATE TABLE VideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `size` | INT | 大小 |
| `CreateTime` | long | 创建时间 |
| `hash` | TEXT | 哈希 |
| `cdnxml` | TEXT | CDNXML |
| `orgpath` | TEXT | org路径 |

### `VideoPlayHistory` — 视频播放历史表

```sql
CREATE TABLE VideoPlayHistory ( filename text PRIMARY KEY, starttime int, playduration int, downloadway int )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `starttime` | INT | 开始时间 |
| `playduration` | INT | 播放时长 |
| `downloadway` | INT | 下载way |

### `VoiceTransText` — 语音翻译文本表

```sql
CREATE TABLE VoiceTransText (  msgId LONG PRIMARY KEY ,  cmsgId TEXT,  content TEXT default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `cmsgId` | TEXT | c消息ID |
| `content` | TEXT | 内容 |

### `WalletBankcard` — 钱包bank卡片表

```sql
CREATE TABLE WalletBankcard (  bindSerial TEXT PRIMARY KEY ,  defaultCardState INTEGER,  cardType INTEGER,  bankcardState INTEGER,  forbidWord TEXT,  bankName TEXT,  bankcardType TEXT,  bankcardTypeName TEXT,  bankcardTag INTEGER,  bankcardTail TEXT,  supportTag INTEGER,  mobile TEXT,  trueName TEXT,  desc TEXT,  bankPhone TEXT,  bizUsername TEXT,  onceQuotaKind DOUBLE,  onceQuotaVirtual DOUBLE,  dayQuotaKind DOUBLE,  dayQuotaVirtual DOUBLE,  fetchArriveTime LONG,  fetchArriveTimeWording TEXT,  repay_url TEXT,  wxcreditState INTEGER,  bankcardClientType INTEGER,  ext_msg TEXT,  support_micropay INTEGER,  arrive_type TEXT,  avail_save_wording TEXT,  fetch_charge_rate DOUBLE,  full_fetch_charge_fee DOUBLE,  fetch_charge_info TEXT,  tips TEXT,  forbid_title TEXT,  forbid_url TEXT,  no_micro_word TEXT,  card_bottom_wording TEXT,  support_lqt_turn_in INTEGER,  support_lqt_turn_out INTEGER,  is_hightlight_pre_arrive_time_wording INTEGER,  card_state_name TEXT,  prompt_info_prompt_text TEXT,  prompt_info_jump_text TEXT,  prompt_info_jump_url TEXT,  yht_related_bank TEXT,  yht_avail_balance LONG,  yht_user_state INTEGER,  yht_system_state INTEGER,  yht_ext_msg TEXT,  minimch_key TEXT,  minimch_avail_balance LONG,  minimch_user_state INTEGER,  minimch_system_state INTEGER,  minimch_ext_msg TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `bindSerial` | TEXT | bind序列 |
| `defaultCardState` | INTEGER | 默认卡片状态 |
| `cardType` | INTEGER | 卡片类型 |
| `bankcardState` | INTEGER | bank卡片状态 |
| `forbidWord` | TEXT | forbID词 |
| `bankName` | TEXT | bank名称 |
| `bankcardType` | TEXT | bank卡片类型 |
| `bankcardTypeName` | TEXT | bank卡片类型名称 |
| `bankcardTag` | INTEGER | bank卡片标签 |
| `bankcardTail` | TEXT | bank卡片tail |
| `supportTag` | INTEGER | support标签 |
| `mobile` | TEXT | 手机 |
| `trueName` | TEXT | true名称 |
| `desc` | TEXT | 描述 |
| `bankPhone` | TEXT | bank手机 |
| `bizUsername` | TEXT | 业务用户名 |
| `onceQuotaKind` | DOUBLE | oncequota种类 |
| `onceQuotaVirtual` | DOUBLE | (onceQuotaVirtual) |
| `dayQuotaKind` | DOUBLE | dayquota种类 |
| `dayQuotaVirtual` | DOUBLE | (dayQuotaVirtual) |
| `fetchArriveTime` | LONG | fetcharrive时间 |
| `fetchArriveTimeWording` | TEXT | fetcharrive时间文案 |
| `repay_url` | TEXT | re支付链接 |
| `wxcreditState` | INTEGER | wxc红包i时间戳tate |
| `bankcardClientType` | INTEGER | bank卡片客户端类型 |
| `ext_msg` | TEXT | 扩展消息 |
| `support_micropay` | INTEGER | supportmicro支付 |
| `arrive_type` | TEXT | arrive类型 |
| `avail_save_wording` | TEXT | availsave文案 |
| `fetch_charge_rate` | DOUBLE | fetchcharge速率 |
| `full_fetch_charge_fee` | DOUBLE | fullfetchcharge费用 |
| `fetch_charge_info` | TEXT | fetchcharge信息 |
| `tips` | TEXT | 提示 |
| `forbid_title` | TEXT | forbID标题 |
| `forbid_url` | TEXT | forbID链接 |
| `no_micro_word` | TEXT | nomicro词 |
| `card_bottom_wording` | TEXT | 卡片机器人tom文案 |
| `support_lqt_turn_in` | INTEGER | (support_lqt_turn_in) |
| `support_lqt_turn_out` | INTEGER | (support_lqt_turn_out) |
| `is_hightlight_pre_arrive_time_wording` | INTEGER | 是否hightlightprearrive时间文案 |
| `card_state_name` | TEXT | 卡片状态名称 |
| `prompt_info_prompt_text` | TEXT | prompt信息prompt文本 |
| `prompt_info_jump_text` | TEXT | prompt信息jump文本 |
| `prompt_info_jump_url` | TEXT | prompt信息jump链接 |
| `yht_related_bank` | TEXT | yhtre纬度edbank |
| `yht_avail_balance` | LONG | (yht_avail_balance) |
| `yht_user_state` | INTEGER | yht用户状态 |
| `yht_system_state` | INTEGER | yh时间戳ystem状态 |
| `yht_ext_msg` | TEXT | yh文本消息 |
| `minimch_key` | TEXT | 最小imch键 |
| `minimch_avail_balance` | LONG | 最小imchavailbalance |
| `minimch_user_state` | INTEGER | 最小imch用户状态 |
| `minimch_system_state` | INTEGER | 最小imch系统状态 |
| `minimch_ext_msg` | TEXT | 最小imch扩展消息 |

### `WalletBankcardScene` — 钱包bank卡片场景表

```sql
CREATE TABLE WalletBankcardScene (  fakePk INTEGER PRIMARY KEY ,  bindSerial TEXT,  defaultCardState INTEGER,  cardType INTEGER,  bankcardState INTEGER,  forbidWord TEXT,  bankName TEXT,  bankcardType TEXT,  bankcardTypeName TEXT,  bankcardTag INTEGER,  bankcardTail TEXT,  supportTag INTEGER,  mobile TEXT,  trueName TEXT,  desc TEXT,  bankPhone TEXT,  bizUsername TEXT,  onceQuotaKind DOUBLE,  onceQuotaVirtual DOUBLE,  dayQuotaKind DOUBLE,  dayQuotaVirtual DOUBLE,  fetchArriveTime LONG,  fetchArriveTimeWording TEXT,  repay_url TEXT,  wxcreditState INTEGER,  bankcardClientType INTEGER,  ext_msg TEXT,  support_micropay INTEGER,  arrive_type TEXT,  avail_save_wording TEXT,  fetch_charge_rate DOUBLE,  full_fetch_charge_fee DOUBLE,  fetch_charge_info TEXT,  tips TEXT,  forbid_title TEXT,  forbid_url TEXT,  no_micro_word TEXT,  card_bottom_wording TEXT,  support_lqt_turn_in INTEGER,  support_lqt_turn_out INTEGER,  is_hightlight_pre_arrive_time_wording INTEGER,  card_state_name TEXT,  prompt_info_prompt_text TEXT,  prompt_info_jump_text TEXT,  prompt_info_jump_url TEXT,  yht_related_bank TEXT,  yht_avail_balance LONG,  yht_user_state INTEGER,  yht_system_state INTEGER,  yht_ext_msg TEXT,  minimch_key TEXT,  minimch_avail_balance LONG,  minimch_user_state INTEGER,  minimch_system_state INTEGER,  minimch_ext_msg TEXT,  scene INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `fakePk` | INTEGER | (fakePk) |
| `bindSerial` | TEXT | bind序列 |
| `defaultCardState` | INTEGER | 默认卡片状态 |
| `cardType` | INTEGER | 卡片类型 |
| `bankcardState` | INTEGER | bank卡片状态 |
| `forbidWord` | TEXT | forbID词 |
| `bankName` | TEXT | bank名称 |
| `bankcardType` | TEXT | bank卡片类型 |
| `bankcardTypeName` | TEXT | bank卡片类型名称 |
| `bankcardTag` | INTEGER | bank卡片标签 |
| `bankcardTail` | TEXT | bank卡片tail |
| `supportTag` | INTEGER | support标签 |
| `mobile` | TEXT | 手机 |
| `trueName` | TEXT | true名称 |
| `desc` | TEXT | 描述 |
| `bankPhone` | TEXT | bank手机 |
| `bizUsername` | TEXT | 业务用户名 |
| `onceQuotaKind` | DOUBLE | oncequota种类 |
| `onceQuotaVirtual` | DOUBLE | (onceQuotaVirtual) |
| `dayQuotaKind` | DOUBLE | dayquota种类 |
| `dayQuotaVirtual` | DOUBLE | (dayQuotaVirtual) |
| `fetchArriveTime` | LONG | fetcharrive时间 |
| `fetchArriveTimeWording` | TEXT | fetcharrive时间文案 |
| `repay_url` | TEXT | re支付链接 |
| `wxcreditState` | INTEGER | wxc红包i时间戳tate |
| `bankcardClientType` | INTEGER | bank卡片客户端类型 |
| `ext_msg` | TEXT | 扩展消息 |
| `support_micropay` | INTEGER | supportmicro支付 |
| `arrive_type` | TEXT | arrive类型 |
| `avail_save_wording` | TEXT | availsave文案 |
| `fetch_charge_rate` | DOUBLE | fetchcharge速率 |
| `full_fetch_charge_fee` | DOUBLE | fullfetchcharge费用 |
| `fetch_charge_info` | TEXT | fetchcharge信息 |
| `tips` | TEXT | 提示 |
| `forbid_title` | TEXT | forbID标题 |
| `forbid_url` | TEXT | forbID链接 |
| `no_micro_word` | TEXT | nomicro词 |
| `card_bottom_wording` | TEXT | 卡片机器人tom文案 |
| `support_lqt_turn_in` | INTEGER | (support_lqt_turn_in) |
| `support_lqt_turn_out` | INTEGER | (support_lqt_turn_out) |
| `is_hightlight_pre_arrive_time_wording` | INTEGER | 是否hightlightprearrive时间文案 |
| `card_state_name` | TEXT | 卡片状态名称 |
| `prompt_info_prompt_text` | TEXT | prompt信息prompt文本 |
| `prompt_info_jump_text` | TEXT | prompt信息jump文本 |
| `prompt_info_jump_url` | TEXT | prompt信息jump链接 |
| `yht_related_bank` | TEXT | yhtre纬度edbank |
| `yht_avail_balance` | LONG | (yht_avail_balance) |
| `yht_user_state` | INTEGER | yht用户状态 |
| `yht_system_state` | INTEGER | yh时间戳ystem状态 |
| `yht_ext_msg` | TEXT | yh文本消息 |
| `minimch_key` | TEXT | 最小imch键 |
| `minimch_avail_balance` | LONG | 最小imchavailbalance |
| `minimch_user_state` | INTEGER | 最小imch用户状态 |
| `minimch_system_state` | INTEGER | 最小imch系统状态 |
| `minimch_ext_msg` | TEXT | 最小imch扩展消息 |
| `scene` | INTEGER | 场景 |

### `WalletBulletin` — 钱包公告

```sql
CREATE TABLE WalletBulletin (  bulletin_scene TEXT PRIMARY KEY ,  bulletin_content TEXT,  bulletin_url TEXT,  is_show_notice INTEGER,  wording TEXT,  left_icon TEXT,  jump_url TEXT,  notice_id TEXT,  type INTEGER default '1' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `bulletin_scene` | TEXT | 公告场景 |
| `bulletin_content` | TEXT | 公告内容 |
| `bulletin_url` | TEXT | 公告链接 |
| `is_show_notice` | INTEGER | 是否显示通知/公告 |
| `wording` | TEXT | 文案 |
| `left_icon` | TEXT | left图标 |
| `jump_url` | TEXT | jump链接 |
| `notice_id` | TEXT | 通知/公告ID |
| `type` | INTEGER | 类型 |

### `WalletFunciontList` — 钱包功能列表

```sql
CREATE TABLE WalletFunciontList (  wallet_region INTEGER PRIMARY KEY ,  function_list TEXT,  new_list TEXT,  banner_list TEXT,  type_name_list TEXT,  isShowSetting INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `wallet_region` | INTEGER | 钱包地区 |
| `function_list` | TEXT | 功能列表 |
| `new_list` | TEXT | new列表 |
| `banner_list` | TEXT | 横幅列表 |
| `type_name_list` | TEXT | 类型名称列表 |
| `isShowSetting` | INTEGER | 是否显示设置 |

### `WalletKindInfo` — 钱包种类信息

```sql
CREATE TABLE WalletKindInfo (  wallet_tpa_country TEXT PRIMARY KEY ,  wallet_type INTEGER,  wallet_name TEXT,  wallet_selected INTEGER,  wallet_balance INTEGER,  wallet_tpa_country_mask INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `wallet_tpa_country` | TEXT | 钱包tpa国家 |
| `wallet_type` | INTEGER | 钱包类型 |
| `wallet_name` | TEXT | 钱包名称 |
| `wallet_selected` | INTEGER | 钱包selected |
| `wallet_balance` | INTEGER | 钱包balance |
| `wallet_tpa_country_mask` | INTEGER | 钱包tpa国家mask |

### `WalletLuckyMoney` — 钱包lucky金额表

```sql
CREATE TABLE WalletLuckyMoney (  mNativeUrl TEXT PRIMARY KEY ,  hbType INTEGER,  receiveAmount LONG,  receiveTime LONG,  receiveStatus INTEGER,  hbStatus INTEGER,  sender TEXT,  exclusiveUsername TEXT,  sendId TEXT,  invalidtime INTEGER,  msgSvrId LONG,  msgLocalId LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `mNativeUrl` | TEXT | mnative链接 |
| `hbType` | INTEGER | hb类型 |
| `receiveAmount` | LONG | receive金额 |
| `receiveTime` | LONG | receive时间 |
| `receiveStatus` | INTEGER | receive状态 |
| `hbStatus` | INTEGER | hb状态 |
| `sender` | TEXT | 发送者 |
| `exclusiveUsername` | TEXT | exclusive用户名 |
| `sendId` | TEXT | 发送ID |
| `invalidtime` | INTEGER | in有效时间 |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `msgLocalId` | LONG | 消息本地ID |

### `WalletPrefInfo` — 钱包p引用表

```sql
CREATE TABLE WalletPrefInfo (  pref_key TEXT PRIMARY KEY ,  pref_title TEXT,  pref_url TEXT,  is_show INTEGER default '1' ,  pref_desc TEXT,  logo_url TEXT,  jump_type INTEGER,  tinyapp_username TEXT,  tinyapp_path TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `pref_key` | TEXT | p引用键 |
| `pref_title` | TEXT | p引用标题 |
| `pref_url` | TEXT | p引用链接 |
| `is_show` | INTEGER | 是否显示 |
| `pref_desc` | TEXT | p引用描述 |
| `logo_url` | TEXT | 日志o链接 |
| `jump_type` | INTEGER | jump类型 |
| `tinyapp_username` | TEXT | tiny应用用户名 |
| `tinyapp_path` | TEXT | tiny应用路径 |

### `WalletRegionGreyAreaList` — 钱包地区greyarea表

```sql
CREATE TABLE WalletRegionGreyAreaList (  wallet_region INTEGER PRIMARY KEY ,  wallet_grey_item_buf BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `wallet_region` | INTEGER | 钱包地区 |
| `wallet_grey_item_buf` | BLOB | 钱包grey项缓冲 |

### `WalletUserInfo` — 钱包用户表

```sql
CREATE TABLE WalletUserInfo (  uin TEXT PRIMARY KEY ,  is_reg INTEGER,  true_name TEXT,  card_num INTEGER,  isDomesticUser INTEGER,  cre_type INTEGER,  main_card_bind_serialno TEXT,  ftf_pay_url TEXT,  switchConfig INTEGER,  reset_passwd_flag TEXT,  find_passwd_url TEXT,  is_open_touch INTEGER,  lct_wording TEXT,  lct_url TEXT,  cre_name TEXT,  lqt_state INTEGER,  paymenu_use_new INTEGER,  is_show_lqb INTEGER,  is_open_lqb INTEGER,  lqb_open_url TEXT,  lqt_cell_is_show INTEGER,  lqt_cell_icon TEXT,  lqt_cell_is_open_lqt INTEGER,  lqt_cell_lqt_open_url TEXT,  lqt_cell_lqt_title TEXT,  lqt_cell_lqt_wording TEXT,  forget_passwd_url TEXT,  unipay_order_state INTEGER,  bank_priority TEXT,  wallet_balance LONG,  wallet_entrance_balance_switch_state INTEGER,  soter_pay_open_type INTEGER,  authen_account_type INTEGER default '-1' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `uin` | TEXT | QQ号/UIN |
| `is_reg` | INTEGER | (is_reg) |
| `true_name` | TEXT | true名称 |
| `card_num` | INTEGER | 卡片数量 |
| `isDomesticUser` | INTEGER | 是否domestic用户 |
| `cre_type` | INTEGER | cre类型 |
| `main_card_bind_serialno` | TEXT | main卡片bind序列no |
| `ftf_pay_url` | TEXT | ftf支付链接 |
| `switchConfig` | INTEGER | switch配置 |
| `reset_passwd_flag` | TEXT | resetpasswd标志 |
| `find_passwd_url` | TEXT | findpasswd链接 |
| `is_open_touch` | INTEGER | (is_open_touch) |
| `lct_wording` | TEXT | lct文案 |
| `lct_url` | TEXT | lct链接 |
| `cre_name` | TEXT | cre名称 |
| `lqt_state` | INTEGER | lq时间戳tate |
| `paymenu_use_new` | INTEGER | 支付menu使用new |
| `is_show_lqb` | INTEGER | 是否显示lqb |
| `is_open_lqb` | INTEGER | (is_open_lqb) |
| `lqb_open_url` | TEXT | lqbopen链接 |
| `lqt_cell_is_show` | INTEGER | lqtcellis显示 |
| `lqt_cell_icon` | TEXT | lqtcell图标 |
| `lqt_cell_is_open_lqt` | INTEGER | (lqt_cell_is_open_lqt) |
| `lqt_cell_lqt_open_url` | TEXT | lqtcelllq置顶en链接 |
| `lqt_cell_lqt_title` | TEXT | lqtcelllqt标题 |
| `lqt_cell_lqt_wording` | TEXT | lqtcelllqt文案 |
| `forget_passwd_url` | TEXT | forgetpasswd链接 |
| `unipay_order_state` | INTEGER | uni支付顺序状态 |
| `bank_priority` | TEXT | bank优先级 |
| `wallet_balance` | LONG | 钱包balance |
| `wallet_entrance_balance_switch_state` | INTEGER | 钱包entrancebalanceswitch状态 |
| `soter_pay_open_type` | INTEGER | soter支付open类型 |
| `authen_account_type` | INTEGER | 授权en账号类型 |

### `WePkgDiffPackage` — wepkgdiff包表

```sql
CREATE TABLE WePkgDiffPackage (  pkgId TEXT PRIMARY KEY ,  version TEXT,  oldVersion TEXT,  oldPath TEXT,  md5 TEXT,  downloadUrl TEXT,  pkgSize INTEGER,  downloadNetType INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `pkgId` | TEXT | pkgID |
| `version` | TEXT | 版本 |
| `oldVersion` | TEXT | old版本 |
| `oldPath` | TEXT | old路径 |
| `md5` | TEXT | MD5 |
| `downloadUrl` | TEXT | 下载链接 |
| `pkgSize` | INTEGER | pkg大小 |
| `downloadNetType` | INTEGER | 下载net类型 |

### `WebViewData` — web查看数据表

```sql
CREATE TABLE WebViewData (  appId TEXT,  appIdKey TEXT PRIMARY KEY ,  value TEXT,  weight TEXT,  expireTime LONG,  timeStamp LONG,  size LONG,  localFile TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `appIdKey` | TEXT | 应用ID键 |
| `value` | TEXT | 值 |
| `weight` | TEXT | 权重 |
| `expireTime` | LONG | 过期时间 |
| `timeStamp` | LONG | 时间戳 |
| `size` | LONG | 大小 |
| `localFile` | TEXT | 本地文件 |

### `WebViewHistory` — web查看历史表

```sql
CREATE TABLE WebViewHistory (  recordId TEXT PRIMARY KEY ,  link TEXT,  title TEXT,  source TEXT,  imgUrl TEXT,  timeStamp LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `recordId` | TEXT | 记录ID |
| `link` | TEXT | 链接 |
| `title` | TEXT | 标题 |
| `source` | TEXT | 来源 |
| `imgUrl` | TEXT | 图片链接 |
| `timeStamp` | LONG | 时间戳 |

### `WebViewHostsFilter` — web查看hos时间戳filter表

```sql
CREATE TABLE WebViewHostsFilter (  host TEXT,  expireTime LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `host` | TEXT | (host) |
| `expireTime` | LONG | 过期时间 |

### `WebviewLocalData` — web查看本地数据表

```sql
CREATE TABLE WebviewLocalData (  recordId INTEGER PRIMARY KEY ,  appId TEXT,  domin TEXT,  key TEXT,  value TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `recordId` | INTEGER | 记录ID |
| `appId` | TEXT | 应用ID |
| `domin` | TEXT | do最小 |
| `key` | TEXT | 键 |
| `value` | TEXT | 值 |

### `WepkgPreloadFiles` — wepkgprelo广告文件s表

```sql
CREATE TABLE WepkgPreloadFiles (  key TEXT PRIMARY KEY ,  pkgId TEXT,  version TEXT,  filePath TEXT,  rid TEXT,  mimeType TEXT,  md5 TEXT,  downloadUrl TEXT,  size INTEGER,  downloadNetType INTEGER,  completeDownload INTEGER default 'false' ,  createTime LONG,  autoDownloadCount INTEGER default '0' ,  fileDownloadCount INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `key` | TEXT | 键 |
| `pkgId` | TEXT | pkgID |
| `version` | TEXT | 版本 |
| `filePath` | TEXT | 文件路径 |
| `rid` | TEXT | rID |
| `mimeType` | TEXT | mime类型 |
| `md5` | TEXT | MD5 |
| `downloadUrl` | TEXT | 下载链接 |
| `size` | INTEGER | 大小 |
| `downloadNetType` | INTEGER | 下载net类型 |
| `completeDownload` | INTEGER | 完成下载 |
| `createTime` | LONG | 创建时间 |
| `autoDownloadCount` | INTEGER | auto下载数量 |
| `fileDownloadCount` | INTEGER | 文件下载数量 |

### `WepkgVersion` — wepkg版本表

```sql
CREATE TABLE WepkgVersion (  pkgId TEXT PRIMARY KEY ,  appId TEXT,  version TEXT,  pkgPath TEXT,  disableWvCache INTEGER default 'true' ,  clearPkgTime LONG,  checkIntervalTime LONG,  packMethod INTEGER,  domain TEXT,  md5 TEXT,  downloadUrl TEXT,  pkgSize INTEGER,  downloadNetType INTEGER,  nextCheckTime LONG,  createTime LONG,  accessTime LONG default '0' ,  charset TEXT default 'UTF-8' ,  bigPackageReady INTEGER default 'false' ,  preloadFilesReady INTEGER default 'false' ,  preloadFilesAtomic INTEGER default 'false' ,  autoDownloadCount INTEGER default '0' ,  disable INTEGER default 'false' ,  totalDownloadCount INTEGER default '0' ,  packageDownloadCount INTEGER default '0' ,  downloadTriggerType INTEGER default '-1' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `pkgId` | TEXT | pkgID |
| `appId` | TEXT | 应用ID |
| `version` | TEXT | 版本 |
| `pkgPath` | TEXT | pkg路径 |
| `disableWvCache` | INTEGER | 禁用wv缓存 |
| `clearPkgTime` | LONG | 清除pkg时间 |
| `checkIntervalTime` | LONG | checkinterval时间 |
| `packMethod` | INTEGER | (packMethod) |
| `domain` | TEXT | (domain) |
| `md5` | TEXT | MD5 |
| `downloadUrl` | TEXT | 下载链接 |
| `pkgSize` | INTEGER | pkg大小 |
| `downloadNetType` | INTEGER | 下载net类型 |
| `nextCheckTime` | LONG | n扩展check时间 |
| `createTime` | LONG | 创建时间 |
| `accessTime` | LONG | access时间 |
| `charset` | TEXT | (charset) |
| `bigPackageReady` | INTEGER | big包已读y |
| `preloadFilesReady` | INTEGER | prelo广告文件s已读y |
| `preloadFilesAtomic` | INTEGER | prelo广告文件satomic |
| `autoDownloadCount` | INTEGER | auto下载数量 |
| `disable` | INTEGER | 禁用 |
| `totalDownloadCount` | INTEGER | 总下载数量 |
| `packageDownloadCount` | INTEGER | 包下载数量 |
| `downloadTriggerType` | INTEGER | 下载trigger类型 |

### `WeseeProviderInfo` — weseeprovIDer表

```sql
CREATE TABLE WeseeProviderInfo (  weSeeUri TEXT,  time LONG)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `weSeeUri` | TEXT | wesee地址 |
| `time` | LONG | 时间 |

### `WxaTokenInfo` — wxa令牌表

```sql
CREATE TABLE WxaTokenInfo (  token TEXT PRIMARY KEY ,  username TEXT,  uin INTEGER,  appid TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `token` | TEXT | 令牌 |
| `username` | TEXT | 用户名 |
| `uin` | INTEGER | QQ号/UIN |
| `appid` | TEXT | 应用ID |

### `addr_upload2` — 通讯录上传

```sql
CREATE TABLE addr_upload2 ( id int  PRIMARY KEY , md5 text  , peopleid text  , uploadtime long  , realname text  , realnamepyinitial text  , realnamequanpin text  , username text  , nickname text  , nicknamepyinitial text  , nicknamequanpin text  , type int  , moblie text  , email text  , status int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int , lvbuf BLOG , showhead int  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INT | ID |
| `md5` | TEXT | MD5 |
| `peopleid` | TEXT | peopleID |
| `uploadtime` | long | 上传时间 |
| `realname` | TEXT | real名称 |
| `realnamepyinitial` | TEXT | real名称pyinitial |
| `realnamequanpin` | TEXT | real名称quan置顶 |
| `username` | TEXT | 用户名 |
| `nickname` | TEXT | 昵称 |
| `nicknamepyinitial` | TEXT | 昵称pyinitial |
| `nicknamequanpin` | TEXT | 昵称quan置顶 |
| `type` | INT | 类型 |
| `moblie` | TEXT | (moblie) |
| `email` | TEXT | 邮箱 |
| `status` | INT | 状态 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |
| `lvbuf` | BLOG | lv缓冲 |
| `showhead` | INT | 显示头像 |

### `appattach` — 应用附件表

```sql
CREATE TABLE appattach (  appId TEXT,  sdkVer LONG,  mediaSvrId TEXT,  mediaId TEXT,  clientAppDataId TEXT,  type LONG,  totalLen LONG,  offset LONG,  status LONG,  isUpload INTEGER,  createTime LONG,  lastModifyTime LONG,  fileFullPath TEXT,  fullXml TEXT,  msgInfoId LONG,  netTimes LONG,  isUseCdn INTEGER,  signature TEXT,  fakeAeskey TEXT,  fakeSignature TEXT,  msgInfoTalker TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `appId` | TEXT | 应用ID |
| `sdkVer` | LONG | SDKver |
| `mediaSvrId` | TEXT | 媒体服务器ID |
| `mediaId` | TEXT | 媒体ID |
| `clientAppDataId` | TEXT | 客户端应用数据ID |
| `type` | LONG | 类型 |
| `totalLen` | LONG | 总len |
| `offset` | LONG | 偏移 |
| `status` | LONG | 状态 |
| `isUpload` | INTEGER | 是否上传 |
| `createTime` | LONG | 创建时间 |
| `lastModifyTime` | LONG | 最后修改时间 |
| `fileFullPath` | TEXT | 文件full路径 |
| `fullXml` | TEXT | fullXML |
| `msgInfoId` | LONG | 消息信息ID |
| `netTimes` | LONG | net时间s |
| `isUseCdn` | INTEGER | 是否使用CDN |
| `signature` | TEXT | 签名 |
| `fakeAeskey` | TEXT | fakeaes键 |
| `fakeSignature` | TEXT | fake签名 |
| `msgInfoTalker` | TEXT | 消息信息talker |

### `appbrandmessage` — 应用品牌消息表

```sql
CREATE TABLE appbrandmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |
| `msgSvrId` | INTEGER | 服务器消息ID(全局唯一,去重用) |
| `type` | INT | 类型 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | INTEGER | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INT | 标志 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `appbrandnotifymessage` — 应用品牌通知消息表

```sql
CREATE TABLE appbrandnotifymessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |
| `msgSvrId` | INTEGER | 服务器消息ID(全局唯一,去重用) |
| `type` | INT | 类型 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | INTEGER | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INT | 标志 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `biz_photo_fans_img_info_table` — 业务照片粉丝图片信息表

```sql
CREATE TABLE biz_photo_fans_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, originSourceMd5 TEXT, msgTalker TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `offset` | INT | 偏移 |
| `totalLen` | INT | 总len |
| `bigImgPath` | TEXT | big图片路径 |
| `thumbImgPath` | TEXT | 缩略图图片路径 |
| `createtime` | INT | 创建时间 |
| `msglocalid` | INT | 消息本地ID |
| `status` | INT | 状态 |
| `nettimes` | INT | net时间s |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `hashdthumb` | INT | 是否hd缩略图 |
| `iscomplete` | INT | 是否完成 |
| `origImgMD5` | TEXT | orig图片MD5 |
| `compressType` | INT | compress类型 |
| `midImgPath` | TEXT | mID图片路径 |
| `forwardType` | INT | 转发类型 |
| `hevcPath` | TEXT | hevc路径 |
| `sendImgType` | INT | 发送图片类型 |
| `originSourceMd5` | TEXT | 原始来源MD5 |
| `msgTalker` | TEXT | 消息talker |

### `bizchatmessage` — 业务聊天消息表

```sql
CREATE TABLE bizchatmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, talkerId INTEGER, bizClientMsgId TEXT , msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |
| `msgSvrId` | INTEGER | 服务器消息ID(全局唯一,去重用) |
| `type` | INT | 类型 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `bizChatId` | INTEGER | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INT | 标志 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `bizfans_img_info_table` — 业务粉丝图片信息表

```sql
CREATE TABLE bizfans_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, originSourceMd5 TEXT, msgTalker TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `offset` | INT | 偏移 |
| `totalLen` | INT | 总len |
| `bigImgPath` | TEXT | big图片路径 |
| `thumbImgPath` | TEXT | 缩略图图片路径 |
| `createtime` | INT | 创建时间 |
| `msglocalid` | INT | 消息本地ID |
| `status` | INT | 状态 |
| `nettimes` | INT | net时间s |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `hashdthumb` | INT | 是否hd缩略图 |
| `iscomplete` | INT | 是否完成 |
| `origImgMD5` | TEXT | orig图片MD5 |
| `compressType` | INT | compress类型 |
| `midImgPath` | TEXT | mID图片路径 |
| `forwardType` | INT | 转发类型 |
| `hevcPath` | TEXT | hevc路径 |
| `sendImgType` | INT | 发送图片类型 |
| `originSourceMd5` | TEXT | 原始来源MD5 |
| `msgTalker` | TEXT | 消息talker |

### `bizfansmessage` — 业务粉丝消息表

```sql
CREATE TABLE bizfansmessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | LONG | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | LONG | 消息序号 |
| `flag` | INTEGER | 标志 |
| `fromUsername` | TEXT | from用户名 |
| `toUsername` | TEXT | to用户名 |
| `extInfo` | BLOB | 扩展信息 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `bizfansvideoinfo` — 业务粉丝视频表

```sql
CREATE TABLE bizfansvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | TEXT | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `bizfansvideoinfoVideoHash` — 业务粉丝视频信息视频哈希表

```sql
CREATE TABLE bizfansvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `size` | INT | 大小 |
| `CreateTime` | long | 创建时间 |
| `hash` | TEXT | 哈希 |
| `cdnxml` | TEXT | CDNXML |
| `orgpath` | TEXT | org路径 |

### `bizinfo` — 公众号信息

```sql
CREATE TABLE bizinfo (  username TEXT PRIMARY KEY ,  appId TEXT,  brandList TEXT default '' ,  brandListVersion TEXT,  brandListContent TEXT,  brandFlag INTEGER,  extInfo TEXT,  brandInfo TEXT,  brandIconURL TEXT,  updateTime LONG,  hadAlert INTEGER,  acceptType INTEGER default '0' ,  type INTEGER default '0' ,  status INTEGER default '0' ,  enterpriseFather TEXT,  kfWorkerId TEXT,  specialType INTEGER,  attrSyncVersion TEXT,  incrementUpdateTime LONG,  bitFlag INTEGER default '0' ,  aiReplyOpen INTEGER default '0' ,  aiWording TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `appId` | TEXT | 应用ID |
| `brandList` | TEXT | 品牌列表 |
| `brandListVersion` | TEXT | 品牌列表版本 |
| `brandListContent` | TEXT | 品牌列表内容 |
| `brandFlag` | INTEGER | 品牌标志 |
| `extInfo` | TEXT | 扩展信息 |
| `brandInfo` | TEXT | 品牌信息 |
| `brandIconURL` | TEXT | 品牌图标链接 |
| `updateTime` | LONG | 更新时间 |
| `hadAlert` | INTEGER | 曾alert |
| `acceptType` | INTEGER | 接受类型 |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `enterpriseFather` | TEXT | 企业father |
| `kfWorkerId` | TEXT | kfworkerID |
| `specialType` | INTEGER | special类型 |
| `attrSyncVersion` | TEXT | attr同步版本 |
| `incrementUpdateTime` | LONG | increment更新时间 |
| `bitFlag` | INTEGER | 位标志 |
| `aiReplyOpen` | INTEGER | ai回复open |
| `aiWording` | TEXT | ai文案 |

### `bizphotofansvideoinfo` — 业务照片粉丝视频表

```sql
CREATE TABLE bizphotofansvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | TEXT | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `bizphotofansvideoinfoVideoHash` — 业务照片粉丝视频信息视频哈希表

```sql
CREATE TABLE bizphotofansvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `size` | INT | 大小 |
| `CreateTime` | long | 创建时间 |
| `hash` | TEXT | 哈希 |
| `cdnxml` | TEXT | CDNXML |
| `orgpath` | TEXT | org路径 |

### `bottlecontact` — 机器人tle联系人表

```sql
CREATE TABLE bottlecontact (  username TEXT default ''  PRIMARY KEY ,  alias TEXT default '' ,  conRemark TEXT default '' ,  domainList TEXT default '' ,  nickname TEXT default '' ,  pyInitial TEXT default '' ,  quanPin TEXT default '' ,  showHead INTEGER default '0' ,  type INTEGER default '0' ,  uiType LONG default '0' ,  weiboFlag INTEGER default '0' ,  weiboNickname TEXT default '' ,  conRemarkPYFull TEXT default '' ,  conRemarkPYShort TEXT default '' ,  lvbuff BLOB,  verifyFlag INTEGER default '0' ,  encryptUsername TEXT default '' ,  chatroomFlag INTEGER,  deleteFlag INTEGER default '0' ,  contactLabelIds TEXT default '' ,  descWordingId TEXT default '' ,  openImAppid TEXT,  sourceExtInfo TEXT,  ticket TEXT default '' ,  usernameFlag LONG default '0' ,  contactExtra BLOB,  createTime LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `alias` | TEXT | 别名 |
| `conRemark` | TEXT | 我给对方设的备注名(优先显示) |
| `domainList` | TEXT | domain列表 |
| `nickname` | TEXT | 昵称 |
| `pyInitial` | TEXT | 拼音首字母 |
| `quanPin` | TEXT | 全拼 |
| `showHead` | INTEGER | 显示头像 |
| `type` | INTEGER | 类型 |
| `uiType` | LONG | ui类型 |
| `weiboFlag` | INTEGER | weibo标志 |
| `weiboNickname` | TEXT | weibo昵称 |
| `conRemarkPYFull` | TEXT | con备注pyfull |
| `conRemarkPYShort` | TEXT | con备注pyshort |
| `lvbuff` | BLOB | lv缓冲f |
| `verifyFlag` | INTEGER | 验证标志 |
| `encryptUsername` | TEXT | 加密用户名 |
| `chatroomFlag` | INTEGER | 群标志 |
| `deleteFlag` | INTEGER | 删除标志 |
| `contactLabelIds` | TEXT | 联系人标签IDs |
| `descWordingId` | TEXT | 描述文案ID |
| `openImAppid` | TEXT | openim应用ID |
| `sourceExtInfo` | TEXT | 来源扩展信息 |
| `ticket` | TEXT | 票据 |
| `usernameFlag` | LONG | 用户名标志 |
| `contactExtra` | BLOB | 联系人扩展 |
| `createTime` | LONG | 创建时间 |

### `bottleconversation` — 机器人tle会话表

```sql
CREATE TABLE bottleconversation ( unReadCount INTEGER, status INT, isSend INT, createTime LONG, username VARCHAR(40), content TEXT, reserved TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `unReadCount` | INTEGER | 未读数量 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `createTime` | LONG | 创建时间 |
| `username` | VARCHAR(40) | 用户名 |
| `content` | TEXT | 内容 |
| `reserved` | TEXT | 保留 |

### `bottlemessage` — 机器人tle消息表

```sql
CREATE TABLE bottlemessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |
| `msgSvrId` | INTEGER | 服务器消息ID(全局唯一,去重用) |
| `type` | INT | 类型 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | INTEGER | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INT | 标志 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `chatroom` — 群信息(成员/群主)

```sql
CREATE TABLE chatroom (  chatroomname TEXT default ''  PRIMARY KEY ,  addtime LONG,  memberlist TEXT,  displayname TEXT,  chatroomnick TEXT,  roomflag INTEGER,  roomowner TEXT,  roomdata BLOB,  isShowname INTEGER,  selfDisplayName TEXT,  style INTEGER,  chatroomdataflag INTEGER,  modifytime LONG,  chatroomnotice TEXT,  xmlChatroomnotice TEXT,  chatroomVersion INTEGER,  chatroomnoticeEditor TEXT,  chatroomnoticePublishTime LONG,  chatroomNoticeNew INTEGER,  chatroomLocalVersion LONG,  chatroomStatus INTEGER default '0' ,  memberCount INTEGER default '-1' ,  chatroomfamilystatusmodifytime LONG default '0' ,  associateOpenIMRoomName TEXT,  openIMRoomMigrateStatus INTEGER default '0' ,  saveByteVersion TEXT,  handleByteVersion TEXT,  roomInfoDetailResByte BLOB,  oldChatroomVersion INTEGER,  localChatRoomWatchMembers BLOB,  spamStatus INTEGER default '0' ,  compactFlag LONG default '0' ,  qrCodeAccessType INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `chatroomname` | TEXT | 群ID(<id>@chatroom,主键) |
| `addtime` | LONG | 广告d时间 |
| `memberlist` | TEXT | 群成员wxid列表(;分隔) |
| `displayname` | TEXT | 群成员群名片(;分隔,与memberlist同序) |
| `chatroomnick` | TEXT | 聊天群nick |
| `roomflag` | INTEGER | 群标志 |
| `roomowner` | TEXT | 群主wxid |
| `roomdata` | BLOB | 群成员扩展(protobuf) |
| `isShowname` | INTEGER | 是否显示名称 |
| `selfDisplayName` | TEXT | 我在本群的群名片 |
| `style` | INTEGER | 样式 |
| `chatroomdataflag` | INTEGER | 聊天群数据标志 |
| `modifytime` | LONG | 修改时间 |
| `chatroomnotice` | TEXT | 聊天群通知/公告 |
| `xmlChatroomnotice` | TEXT | XML聊天群通知/公告 |
| `chatroomVersion` | INTEGER | 聊天群版本 |
| `chatroomnoticeEditor` | TEXT | 聊天群通知/公告editor |
| `chatroomnoticePublishTime` | LONG | 聊天群通知/公告发布时间 |
| `chatroomNoticeNew` | INTEGER | 聊天群通知/公告new |
| `chatroomLocalVersion` | LONG | 聊天群本地版本 |
| `chatroomStatus` | INTEGER | 聊天群状态 |
| `memberCount` | INTEGER | 群成员数 |
| `chatroomfamilystatusmodifytime` | LONG | 聊天群family状态修改时间 |
| `associateOpenIMRoomName` | TEXT | associateopenim群名称 |
| `openIMRoomMigrateStatus` | INTEGER | openim群迁移状态 |
| `saveByteVersion` | TEXT | save字节版本 |
| `handleByteVersion` | TEXT | handle字节版本 |
| `roomInfoDetailResByte` | BLOB | 群信息详情res字节 |
| `oldChatroomVersion` | INTEGER | old聊天群版本 |
| `localChatRoomWatchMembers` | BLOB | 本地聊天群watch成员s |
| `spamStatus` | INTEGER | 垃圾状态 |
| `compactFlag` | LONG | compact标志 |
| `qrCodeAccessType` | INTEGER | 二维码access类型 |

### `chattingbginfo` — 聊天ting背景表

```sql
CREATE TABLE chattingbginfo ( username text  PRIMARY KEY , bgflag int  , path text  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `bgflag` | INT | 背景标志 |
| `path` | TEXT | 路径 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |

### `contact` — 联系人表

```sql
CREATE TABLE contact ( contactID INTEGER PRIMARY KEY, sex INT, type INT, showHead INT, username VARCHAR(40), nickname VARCHAR(40), pyInitial VARCHAR(40), quanPin VARCHAR(60), reserved TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `contactID` | INTEGER | 联系人ID |
| `sex` | INT | 性别 |
| `type` | INT | 类型 |
| `showHead` | INT | 显示头像 |
| `username` | VARCHAR(40) | 用户名 |
| `nickname` | VARCHAR(40) | 昵称 |
| `pyInitial` | VARCHAR(40) | 拼音首字母 |
| `quanPin` | VARCHAR(60) | 全拼 |
| `reserved` | TEXT | 保留 |

### `contact_ext` — 联系人扩展表

```sql
CREATE TABLE contact_ext ( username VARCHAR(40), Uin INTEGER DEFAULT 0, Email VARCHAR(128), Mobile VARCHAR(40), ShowFlag INTEGER DEFAULT 0 , ConType INTEGER DEFAULT 0 , ConRemark TEXT, ConRemark_PYShort TEXT, ConRemark_PYFull TEXT, ConQQMBlog TEXT, ConSMBlog TEXT, DomainList TEXT, reserved1 INT DEFAULT 0 , reserved2 INT DEFAULT 0 , reserved3 INT DEFAULT 0 , reserved4 INT DEFAULT 0 , reserved5 INT DEFAULT 0 , reserved6 TEXT, reserved7 TEXT, reserved8 TEXT, reserved9 TEXT, reserved10 TEXT, weiboflag  INT DEFAULT 0 ,weibonickname TEXT  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | VARCHAR(40) | 用户名 |
| `Uin` | INTEGER | QQ号/UIN |
| `Email` | VARCHAR(128) | 邮箱 |
| `Mobile` | VARCHAR(40) | 手机 |
| `ShowFlag` | INTEGER | 显示标志 |
| `ConType` | INTEGER | con类型 |
| `ConRemark` | TEXT | 我给对方设的备注名(优先显示) |
| `ConRemark_PYShort` | TEXT | con备注pyshort |
| `ConRemark_PYFull` | TEXT | con备注pyfull |
| `ConQQMBlog` | TEXT | conqqMB日志 |
| `ConSMBlog` | TEXT | consMB日志 |
| `DomainList` | TEXT | domain列表 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |
| `reserved5` | INT | 保留5 |
| `reserved6` | TEXT | 保留6 |
| `reserved7` | TEXT | 保留7 |
| `reserved8` | TEXT | 保留8 |
| `reserved9` | TEXT | 保留9 |
| `reserved10` | TEXT | 保留10 |
| `weiboflag` | INT | weibo标志 |
| `weibonickname` | TEXT | weibo昵称 |

### `conversation` — 会话表

```sql
CREATE TABLE conversation ( unReadCount INTEGER, status INT, isSend INT, createTime LONG, username VARCHAR(40), content TEXT, reserved TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `unReadCount` | INTEGER | 未读数量 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `createTime` | LONG | 创建时间 |
| `username` | VARCHAR(40) | 用户名 |
| `content` | TEXT | 内容 |
| `reserved` | TEXT | 保留 |

### `facebookfriend` — facebook好友表

```sql
CREATE TABLE facebookfriend ( fbid long  PRIMARY KEY , fbname text  , fbimgkey int  , status int  , username text  , nickname text  , nicknamepyinitial text  , nicknamequanpin text  , sex int  , personalcard int  , province text  , city text  , signature text  , alias text  , type int  , email text  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `fbid` | long | fbID |
| `fbname` | TEXT | fb名称 |
| `fbimgkey` | INT | fb图片键 |
| `status` | INT | 状态 |
| `username` | TEXT | 用户名 |
| `nickname` | TEXT | 昵称 |
| `nicknamepyinitial` | TEXT | 昵称pyinitial |
| `nicknamequanpin` | TEXT | 昵称quan置顶 |
| `sex` | INT | 性别 |
| `personalcard` | INT | personal卡片 |
| `province` | TEXT | 省 |
| `city` | TEXT | 城市 |
| `signature` | TEXT | 签名 |
| `alias` | TEXT | 别名 |
| `type` | INT | 类型 |
| `email` | TEXT | 邮箱 |

### `finder_img_info_table` — 视频号图片信息表

```sql
CREATE TABLE finder_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, originSourceMd5 TEXT, msgTalker TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `offset` | INT | 偏移 |
| `totalLen` | INT | 总len |
| `bigImgPath` | TEXT | big图片路径 |
| `thumbImgPath` | TEXT | 缩略图图片路径 |
| `createtime` | INT | 创建时间 |
| `msglocalid` | INT | 消息本地ID |
| `status` | INT | 状态 |
| `nettimes` | INT | net时间s |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `hashdthumb` | INT | 是否hd缩略图 |
| `iscomplete` | INT | 是否完成 |
| `origImgMD5` | TEXT | orig图片MD5 |
| `compressType` | INT | compress类型 |
| `midImgPath` | TEXT | mID图片路径 |
| `forwardType` | INT | 转发类型 |
| `hevcPath` | TEXT | hevc路径 |
| `sendImgType` | INT | 发送图片类型 |
| `originSourceMd5` | TEXT | 原始来源MD5 |
| `msgTalker` | TEXT | 消息talker |

### `findermessage006` — 视频号消息006表

```sql
CREATE TABLE findermessage006 (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | LONG | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | LONG | 消息序号 |
| `flag` | INTEGER | 标志 |
| `fromUsername` | TEXT | from用户名 |
| `toUsername` | TEXT | to用户名 |
| `extInfo` | BLOB | 扩展信息 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `findervideoinfo` — 视频号视频表

```sql
CREATE TABLE findervideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | TEXT | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `findervideoinfoVideoHash` — 视频号视频信息视频哈希表

```sql
CREATE TABLE findervideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `size` | INT | 大小 |
| `CreateTime` | long | 创建时间 |
| `hash` | TEXT | 哈希 |
| `cdnxml` | TEXT | CDNXML |
| `orgpath` | TEXT | org路径 |

### `fmessage_conversation` — f消息会话表

```sql
CREATE TABLE fmessage_conversation (  talker TEXT default '0'  PRIMARY KEY ,  encryptTalker TEXT default '' ,  displayName TEXT default '' ,  state INTEGER default '0' ,  lastModifiedTime LONG default '0' ,  isNew INTEGER default '0' ,  addScene INTEGER default '0' ,  fmsgSysRowId LONG default '0' ,  fmsgIsSend INTEGER default '0' ,  fmsgType INTEGER default '0' ,  fmsgContent TEXT default '' ,  recvFmsgType INTEGER default '0' ,  contentFromUsername TEXT default '' ,  contentNickname TEXT default '' ,  contentPhoneNumMD5 TEXT default '' ,  contentFullPhoneNumMD5 TEXT default '' ,  contentVerifyContent TEXT default '' ,  fmsgIsHasShowSelfQRCode INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `encryptTalker` | TEXT | 加密talker |
| `displayName` | TEXT | 群成员群名片(;分隔,与memberlist同序) |
| `state` | INTEGER | 状态 |
| `lastModifiedTime` | LONG | 最后modified时间 |
| `isNew` | INTEGER | (isNew) |
| `addScene` | INTEGER | 广告d场景 |
| `fmsgSysRowId` | LONG | f消息sysrowID |
| `fmsgIsSend` | INTEGER | f消息is发送 |
| `fmsgType` | INTEGER | f消息类型 |
| `fmsgContent` | TEXT | f消息内容 |
| `recvFmsgType` | INTEGER | 接收f消息类型 |
| `contentFromUsername` | TEXT | 内容from用户名 |
| `contentNickname` | TEXT | 内容昵称 |
| `contentPhoneNumMD5` | TEXT | 内容手机数量MD5 |
| `contentFullPhoneNumMD5` | TEXT | 内容full手机数量MD5 |
| `contentVerifyContent` | TEXT | 内容验证内容 |
| `fmsgIsHasShowSelfQRCode` | INTEGER | f消息ishas显示自己二维码 |

### `fmessage_msginfo` — f消息消息表

```sql
CREATE TABLE fmessage_msginfo (  msgContent TEXT default '' ,  isSend INTEGER default '0' ,  talker TEXT default '' ,  encryptTalker TEXT default '' ,  svrId LONG default '0' ,  type INTEGER default '0' ,  createTime LONG default '0' ,  chatroomName TEXT default '' ,  isContactDeleted INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgContent` | TEXT | 消息内容 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `encryptTalker` | TEXT | 加密talker |
| `svrId` | LONG | 服务器ID |
| `type` | INTEGER | 类型 |
| `createTime` | LONG | 创建时间 |
| `chatroomName` | TEXT | 群ID(<id>@chatroom,主键) |
| `isContactDeleted` | INTEGER | 是否联系人已删除 |

### `friend_ext` — 好友扩展表

```sql
CREATE TABLE friend_ext ( username text  PRIMARY KEY , sex int  , personalcard int  , province text  , city text  , signature text  , reserved1 text  , reserved2 text  , reserved3 text  , reserved4 text  , reserved5 int  , reserved6 int  , reserved7 int  , reserved8 int  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `sex` | INT | 性别 |
| `personalcard` | INT | personal卡片 |
| `province` | TEXT | 省 |
| `city` | TEXT | 城市 |
| `signature` | TEXT | 签名 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `reserved5` | INT | 保留5 |
| `reserved6` | INT | 保留6 |
| `reserved7` | INT | 保留7 |
| `reserved8` | INT | 保留8 |

### `gamelife_img_info_table` — 游戏life图片信息表

```sql
CREATE TABLE gamelife_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, originSourceMd5 TEXT, msgTalker TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `offset` | INT | 偏移 |
| `totalLen` | INT | 总len |
| `bigImgPath` | TEXT | big图片路径 |
| `thumbImgPath` | TEXT | 缩略图图片路径 |
| `createtime` | INT | 创建时间 |
| `msglocalid` | INT | 消息本地ID |
| `status` | INT | 状态 |
| `nettimes` | INT | net时间s |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `hashdthumb` | INT | 是否hd缩略图 |
| `iscomplete` | INT | 是否完成 |
| `origImgMD5` | TEXT | orig图片MD5 |
| `compressType` | INT | compress类型 |
| `midImgPath` | TEXT | mID图片路径 |
| `forwardType` | INT | 转发类型 |
| `hevcPath` | TEXT | hevc路径 |
| `sendImgType` | INT | 发送图片类型 |
| `originSourceMd5` | TEXT | 原始来源MD5 |
| `msgTalker` | TEXT | 消息talker |

### `gamelifemessage` — 游戏life消息表

```sql
CREATE TABLE gamelifemessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | LONG | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | LONG | 消息序号 |
| `flag` | INTEGER | 标志 |
| `fromUsername` | TEXT | from用户名 |
| `toUsername` | TEXT | to用户名 |
| `extInfo` | BLOB | 扩展信息 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `gamelifevideoinfo` — 游戏life视频表

```sql
CREATE TABLE gamelifevideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | TEXT | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `gamelifevideoinfoVideoHash` — 游戏life视频信息视频哈希表

```sql
CREATE TABLE gamelifevideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `size` | INT | 大小 |
| `CreateTime` | long | 创建时间 |
| `hash` | TEXT | 哈希 |
| `cdnxml` | TEXT | CDNXML |
| `orgpath` | TEXT | org路径 |

### `getcontactinfov2` — get联系人信息表

```sql
CREATE TABLE getcontactinfov2 ( username text  PRIMARY KEY , inserttime long  , type int  , lastgettime int  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `inserttime` | long | 插入时间 |
| `type` | INT | 类型 |
| `lastgettime` | INT | 最后get时间 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `hdheadimginfo` — hd头像图片表

```sql
CREATE TABLE hdheadimginfo ( username text  PRIMARY KEY , imgwidth int  , imgheigth int  , imgformat text  , totallen int  , startpos int  , headimgtype int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `imgwidth` | INT | 图片宽 |
| `imgheigth` | INT | 图片heigth |
| `imgformat` | TEXT | 图片格式 |
| `totallen` | INT | 总len |
| `startpos` | INT | 开始pos |
| `headimgtype` | INT | 头像图片类型 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |

### `img_flag` — 图片标志表

```sql
CREATE TABLE img_flag ( username VARCHAR(40) PRIMARY KEY , imgflag int , lastupdatetime int , reserved1 text ,reserved2 text ,reserved3 int ,reserved4 int ,updateflag int default 0)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | VARCHAR(40) | 用户名 |
| `imgflag` | INT | 图片标志 |
| `lastupdatetime` | INT | 最后更新时间 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |
| `updateflag` | INT | 更新标志 |

### `invitefriendopen` — 邀请好友open表

```sql
CREATE TABLE invitefriendopen ( username text  PRIMARY KEY , friendtype int  , updatetime int  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `friendtype` | INT | 好友类型 |
| `updatetime` | INT | 更新时间 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `massendinfo` — 群发结束表

```sql
CREATE TABLE massendinfo ( clientid text  PRIMARY KEY , status int  , createtime long  , lastmodifytime long  , filename text  , thumbfilename text  , tolist text  , tolistcount int  , msgtype int  , mediatime int  , datanetoffset int  , datalen int  , thumbnetoffset int  , thumbtotallen int  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `clientid` | TEXT | 客户端ID |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `filename` | TEXT | 文件名称 |
| `thumbfilename` | TEXT | 缩略图文件名称 |
| `tolist` | TEXT | to列表 |
| `tolistcount` | INT | to列表数量 |
| `msgtype` | INT | 消息类型 |
| `mediatime` | INT | 媒体时间 |
| `datanetoffset` | INT | 数据net偏移 |
| `datalen` | INT | 数据len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumbtotallen` | INT | 缩略图总len |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `message` — 聊天消息(核心)

```sql
CREATE TABLE message ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT,transBrandWording TEXT ,talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |
| `msgSvrId` | INTEGER | 服务器消息ID(全局唯一,去重用) |
| `type` | INT | 类型 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | INTEGER | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INT | 标志 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `netstat` — ne时间戳tat表

```sql
CREATE TABLE netstat ( id INTEGER PRIMARY KEY, peroid INT, textCountIn INT, textBytesIn INT, imageCountIn INT, imageBytesIn INT, voiceCountIn INT, voiceBytesIn INT, videoCountIn INT, videoBytesIn INT, mobileBytesIn INT, wifiBytesIn INT, sysMobileBytesIn INT, sysWifiBytesIn INT, textCountOut INT, textBytesOut INT, imageCountOut INT, imageBytesOut INT, voiceCountOut INT, voiceBytesOut INT, videoCountOut INT, videoBytesOut INT, mobileBytesOut INT, wifiBytesOut INT, sysMobileBytesOut INT, sysWifiBytesOut INT, reserved1 INT, reserved2 INT, reserved3 TEXT, realMobileBytesIn INT, realWifiBytesIn INT, realMobileBytesOut INT, realWifiBytesOut INT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `peroid` | INT | peroID |
| `textCountIn` | INT | 文本数量in |
| `textBytesIn` | INT | 文本字节in |
| `imageCountIn` | INT | 图片数量in |
| `imageBytesIn` | INT | 图片字节in |
| `voiceCountIn` | INT | 语音数量in |
| `voiceBytesIn` | INT | 语音字节in |
| `videoCountIn` | INT | 视频数量in |
| `videoBytesIn` | INT | 视频字节in |
| `mobileBytesIn` | INT | 手机字节in |
| `wifiBytesIn` | INT | WiFi字节in |
| `sysMobileBytesIn` | INT | sys手机字节in |
| `sysWifiBytesIn` | INT | sysWiFi字节in |
| `textCountOut` | INT | 文本数量out |
| `textBytesOut` | INT | 文本字节out |
| `imageCountOut` | INT | 图片数量out |
| `imageBytesOut` | INT | 图片字节out |
| `voiceCountOut` | INT | 语音数量out |
| `voiceBytesOut` | INT | 语音字节out |
| `videoCountOut` | INT | 视频数量out |
| `videoBytesOut` | INT | 视频字节out |
| `mobileBytesOut` | INT | 手机字节out |
| `wifiBytesOut` | INT | WiFi字节out |
| `sysMobileBytesOut` | INT | sys手机字节out |
| `sysWifiBytesOut` | INT | sysWiFi字节out |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `realMobileBytesIn` | INT | real手机字节in |
| `realWifiBytesIn` | INT | realWiFi字节in |
| `realMobileBytesOut` | INT | real手机字节out |
| `realWifiBytesOut` | INT | realWiFi字节out |

### `oplog2` — 操作日志2表

```sql
CREATE TABLE oplog2 ( id INTEGER PRIMARY KEY , inserTime long , cmdId int , buffer blob , reserved1 int , reserved2 long , reserved3 text , reserved4 text )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `inserTime` | long | 插入ime |
| `cmdId` | INT | 命令ID |
| `buffer` | BLOB | 缓冲 |
| `reserved1` | INT | 保留1 |
| `reserved2` | long | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `packageinfo` — 包表

```sql
CREATE TABLE packageinfo ( id int  PRIMARY KEY, version int  , name text  , size int  , packname text  , status int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INT | ID |
| `version` | INT | 版本 |
| `name` | TEXT | 名称 |
| `size` | INT | 大小 |
| `packname` | TEXT | pack名称 |
| `status` | INT | 状态 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |

### `packageinfo2` — 包信息2表

```sql
CREATE TABLE packageinfo2 ( localId text  PRIMARY KEY , id int  , version int  , name text  , size int  , packname text  , status int  , type int  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `localId` | TEXT | 本地ID |
| `id` | INT | ID |
| `version` | INT | 版本 |
| `name` | TEXT | 名称 |
| `size` | INT | 大小 |
| `packname` | TEXT | pack名称 |
| `status` | INT | 状态 |
| `type` | INT | 类型 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |

### `picfansmsg` — 图片粉丝消息表

```sql
CREATE TABLE picfansmsg (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | LONG | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | LONG | 消息序号 |
| `flag` | INTEGER | 标志 |
| `fromUsername` | TEXT | from用户名 |
| `toUsername` | TEXT | to用户名 |
| `extInfo` | BLOB | 扩展信息 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `qmessage` — q消息表

```sql
CREATE TABLE qmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |
| `msgSvrId` | INTEGER | 服务器消息ID(全局唯一,去重用) |
| `type` | INT | 类型 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | INTEGER | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INT | 标志 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `qqgroup` — qq群/组表

```sql
CREATE TABLE qqgroup ( grouopid int PRIMARY KEY,membernum int,weixinnum int,insert_time int,lastupdate_time int,needupdate int,updatekey text,groupname text,reserved1 text ,reserved2 text ,reserved3 int ,reserved4 int )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `grouopid` | INT | grouopID |
| `membernum` | INT | 成员数量 |
| `weixinnum` | INT | weixin数量 |
| `insert_time` | INT | 插入时间 |
| `lastupdate_time` | INT | 最后更新时间 |
| `needupdate` | INT | 是否更新 |
| `updatekey` | TEXT | 更新键 |
| `groupname` | TEXT | 群/组名称 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |

### `qqlist` — 导入的QQ好友列表

```sql
CREATE TABLE qqlist ( qq long  PRIMARY KEY , wexinstatus int  , groupid int  , username text  , nickname text  , pyinitial text  , quanpin text  , qqnickname text  , qqpyinitial text  , qqquanpin text  , qqremark text  , qqremarkpyinitial text  , qqremarkquanpin text  , reserved1 text  , reserved2 text  , reserved3 int  , reserved4 int  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `qq` | long | (qq) |
| `wexinstatus` | INT | wexin状态 |
| `groupid` | INT | 群ID |
| `username` | TEXT | 用户名 |
| `nickname` | TEXT | 昵称 |
| `pyinitial` | TEXT | 拼音首字母 |
| `quanpin` | TEXT | 全拼 |
| `qqnickname` | TEXT | qq昵称 |
| `qqpyinitial` | TEXT | (qqpyinitial) |
| `qqquanpin` | TEXT | qqquan置顶 |
| `qqremark` | TEXT | q二维码e标记 |
| `qqremarkpyinitial` | TEXT | q二维码e标记pyinitial |
| `qqremarkquanpin` | TEXT | q二维码e标记quan置顶 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INT | 保留3 |
| `reserved4` | INT | 保留4 |

### `rbottleconversation` — r机器人tle会话表

```sql
CREATE TABLE rbottleconversation (  msgCount INTEGER default '0' ,  username TEXT default ''  PRIMARY KEY ,  unReadCount INTEGER default '0' ,  chatmode INTEGER default '0' ,  status INTEGER default '0' ,  isSend INTEGER default '0' ,  conversationTime LONG default '0' ,  content TEXT default '' ,  msgType TEXT default '' ,  customNotify TEXT default '' ,  showTips INTEGER default '0' ,  flag LONG default '0' ,  digest TEXT default '' ,  digestUser TEXT default '' ,  hasTrunc INTEGER default '0' ,  parentRef TEXT,  attrflag INTEGER default '0' ,  editingMsg TEXT default '' ,  atCount INTEGER default '0' ,  sightTime LONG default '0' ,  unReadMuteCount INTEGER default '0' ,  lastSeq LONG,  UnDeliverCount INTEGER,  UnReadInvite INTEGER,  firstUnDeliverSeq LONG,  editingQuoteMsgId LONG default '0' ,  hasTodo INTEGER default '0' ,  hbMarkRed INTEGER default '0' ,  remitMarkRed INTEGER default '0' ,  hasSpecialFollow INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgCount` | INTEGER | 消息数量 |
| `username` | TEXT | 用户名 |
| `unReadCount` | INTEGER | 未读数量 |
| `chatmode` | INTEGER | 聊天模式 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `conversationTime` | LONG | 会话时间 |
| `content` | TEXT | 内容 |
| `msgType` | TEXT | 消息类型 |
| `customNotify` | TEXT | custom通知 |
| `showTips` | INTEGER | 显示提示 |
| `flag` | LONG | 标志 |
| `digest` | TEXT | 摘要 |
| `digestUser` | TEXT | 摘要用户 |
| `hasTrunc` | INTEGER | (hasTrunc) |
| `parentRef` | TEXT | 父引用 |
| `attrflag` | INTEGER | attr标志 |
| `editingMsg` | TEXT | editing消息 |
| `atCount` | INTEGER | at数量 |
| `sightTime` | LONG | sight时间 |
| `unReadMuteCount` | INTEGER | 未读免打扰数量 |
| `lastSeq` | LONG | 最后序号 |
| `UnDeliverCount` | INTEGER | unde直播r数量 |
| `UnReadInvite` | INTEGER | 未读邀请 |
| `firstUnDeliverSeq` | LONG | 首unde直播r序号 |
| `editingQuoteMsgId` | LONG | editing引用消息ID |
| `hasTodo` | INTEGER | (hasTodo) |
| `hbMarkRed` | INTEGER | hb标记红包 |
| `remitMarkRed` | INTEGER | remit标记红包 |
| `hasSpecialFollow` | INTEGER | 是否special关注 |

### `rcontact` — 联系人/好友/群/公众号

```sql
CREATE TABLE rcontact (  username TEXT default ''  PRIMARY KEY ,  alias TEXT default '' ,  conRemark TEXT default '' ,  domainList TEXT default '' ,  nickname TEXT default '' ,  pyInitial TEXT default '' ,  quanPin TEXT default '' ,  showHead INTEGER default '0' ,  type INTEGER default '0' ,  uiType LONG default '0' ,  weiboFlag INTEGER default '0' ,  weiboNickname TEXT default '' ,  conRemarkPYFull TEXT default '' ,  conRemarkPYShort TEXT default '' ,  lvbuff BLOB,  verifyFlag INTEGER default '0' ,  encryptUsername TEXT default '' ,  chatroomFlag INTEGER,  deleteFlag INTEGER default '0' ,  contactLabelIds TEXT default '' ,  descWordingId TEXT default '' ,  openImAppid TEXT,  sourceExtInfo TEXT,  ticket TEXT default '' ,  usernameFlag LONG default '0' ,  contactExtra BLOB,  createTime LONG default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `alias` | TEXT | 别名 |
| `conRemark` | TEXT | 我给对方设的备注名(优先显示) |
| `domainList` | TEXT | domain列表 |
| `nickname` | TEXT | 昵称 |
| `pyInitial` | TEXT | 拼音首字母 |
| `quanPin` | TEXT | 全拼 |
| `showHead` | INTEGER | 显示头像 |
| `type` | INTEGER | 类型 |
| `uiType` | LONG | ui类型 |
| `weiboFlag` | INTEGER | weibo标志 |
| `weiboNickname` | TEXT | weibo昵称 |
| `conRemarkPYFull` | TEXT | con备注pyfull |
| `conRemarkPYShort` | TEXT | con备注pyshort |
| `lvbuff` | BLOB | lv缓冲f |
| `verifyFlag` | INTEGER | 验证标志 |
| `encryptUsername` | TEXT | 加密用户名 |
| `chatroomFlag` | INTEGER | 群标志 |
| `deleteFlag` | INTEGER | 删除标志 |
| `contactLabelIds` | TEXT | 联系人标签IDs |
| `descWordingId` | TEXT | 描述文案ID |
| `openImAppid` | TEXT | openim应用ID |
| `sourceExtInfo` | TEXT | 来源扩展信息 |
| `ticket` | TEXT | 票据 |
| `usernameFlag` | LONG | 用户名标志 |
| `contactExtra` | BLOB | 联系人扩展 |
| `createTime` | LONG | 创建时间 |

### `rconversation` — r会话表

```sql
CREATE TABLE rconversation (  msgCount INTEGER default '0' ,  username TEXT default ''  PRIMARY KEY ,  unReadCount INTEGER default '0' ,  chatmode INTEGER default '0' ,  status INTEGER default '0' ,  isSend INTEGER default '0' ,  conversationTime LONG default '0' ,  content TEXT default '' ,  msgType TEXT default '' ,  customNotify TEXT default '' ,  showTips INTEGER default '0' ,  flag LONG default '0' ,  digest TEXT default '' ,  digestUser TEXT default '' ,  hasTrunc INTEGER default '0' ,  parentRef TEXT,  attrflag INTEGER default '0' ,  editingMsg TEXT default '' ,  atCount INTEGER default '0' ,  sightTime LONG default '0' ,  unReadMuteCount INTEGER default '0' ,  lastSeq LONG,  UnDeliverCount INTEGER,  UnReadInvite INTEGER,  firstUnDeliverSeq LONG,  editingQuoteMsgId LONG default '0' ,  hasTodo INTEGER default '0' ,  hbMarkRed INTEGER default '0' ,  remitMarkRed INTEGER default '0' ,  hasSpecialFollow INTEGER default '0' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgCount` | INTEGER | 消息数量 |
| `username` | TEXT | 用户名 |
| `unReadCount` | INTEGER | 未读数量 |
| `chatmode` | INTEGER | 聊天模式 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `conversationTime` | LONG | 会话时间 |
| `content` | TEXT | 内容 |
| `msgType` | TEXT | 消息类型 |
| `customNotify` | TEXT | custom通知 |
| `showTips` | INTEGER | 显示提示 |
| `flag` | LONG | 标志 |
| `digest` | TEXT | 摘要 |
| `digestUser` | TEXT | 摘要用户 |
| `hasTrunc` | INTEGER | (hasTrunc) |
| `parentRef` | TEXT | 父引用 |
| `attrflag` | INTEGER | attr标志 |
| `editingMsg` | TEXT | editing消息 |
| `atCount` | INTEGER | at数量 |
| `sightTime` | LONG | sight时间 |
| `unReadMuteCount` | INTEGER | 未读免打扰数量 |
| `lastSeq` | LONG | 最后序号 |
| `UnDeliverCount` | INTEGER | unde直播r数量 |
| `UnReadInvite` | INTEGER | 未读邀请 |
| `firstUnDeliverSeq` | LONG | 首unde直播r序号 |
| `editingQuoteMsgId` | LONG | editing引用消息ID |
| `hasTodo` | INTEGER | (hasTodo) |
| `hbMarkRed` | INTEGER | hb标记红包 |
| `remitMarkRed` | INTEGER | remit标记红包 |
| `hasSpecialFollow` | INTEGER | 是否special关注 |

### `readerappnews1` — 已读er应用news1表

```sql
CREATE TABLE readerappnews1 ( tweetid text  PRIMARY KEY , time long  , type int  , name text  , title text  , url text  , shorturl text  , longurl text  , pubtime long  , sourcename text  , sourceicon text  , istop int  , cover text  , digest text  , reserved1 int  , reserved2 long  , reserved3 text  , reserved4 text  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `tweetid` | TEXT | tweetID |
| `time` | long | 时间 |
| `type` | INT | 类型 |
| `name` | TEXT | 名称 |
| `title` | TEXT | 标题 |
| `url` | TEXT | 链接 |
| `shorturl` | TEXT | short链接 |
| `longurl` | TEXT | long链接 |
| `pubtime` | long | pub时间 |
| `sourcename` | TEXT | 来源名称 |
| `sourceicon` | TEXT | 来源图标 |
| `istop` | INT | 是否置顶 |
| `cover` | TEXT | 封面 |
| `digest` | TEXT | 摘要 |
| `reserved1` | INT | 保留1 |
| `reserved2` | long | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `readerappweibo` — 已读er应用weibo表

```sql
CREATE TABLE readerappweibo ( tweetid text  PRIMARY KEY , time long  , type int  , name text  , title text  , url text  , shorturl text  , longurl text  , pubtime long  , sourcename text  , sourceicon text  , istop int  , cover text  , digest text  , reserved1 int  , reserved2 long  , reserved3 text  , reserved4 text  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `tweetid` | TEXT | tweetID |
| `time` | long | 时间 |
| `type` | INT | 类型 |
| `name` | TEXT | 名称 |
| `title` | TEXT | 标题 |
| `url` | TEXT | 链接 |
| `shorturl` | TEXT | short链接 |
| `longurl` | TEXT | long链接 |
| `pubtime` | long | pub时间 |
| `sourcename` | TEXT | 来源名称 |
| `sourceicon` | TEXT | 来源图标 |
| `istop` | INT | 是否置顶 |
| `cover` | TEXT | 封面 |
| `digest` | TEXT | 摘要 |
| `reserved1` | INT | 保留1 |
| `reserved2` | long | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `role_info` — 角色信息

```sql
CREATE TABLE role_info ( id TEXT PRIMARY KEY, name TEXT, status INT, text_reserved1 TEXT, text_reserved2 TEXT, text_reserved3 TEXT, text_reserved4 TEXT, int_reserved1 INT, int_reserved2 INT, int_reserved3 INT, int_reserved4 INT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | TEXT | ID |
| `name` | TEXT | 名称 |
| `status` | INT | 状态 |
| `text_reserved1` | TEXT | 文本保留1 |
| `text_reserved2` | TEXT | 文本保留2 |
| `text_reserved3` | TEXT | 文本保留3 |
| `text_reserved4` | TEXT | 文本保留4 |
| `int_reserved1` | INT | int保留1 |
| `int_reserved2` | INT | int保留2 |
| `int_reserved3` | INT | int保留3 |
| `int_reserved4` | INT | int保留4 |

### `shakeitem1` — shake项1表

```sql
CREATE TABLE shakeitem1 (  shakeItemID INTEGER default '0'  PRIMARY KEY ,  username TEXT,  nickname TEXT,  province TEXT,  city TEXT,  signature TEXT,  distance TEXT,  sex INTEGER,  imgstatus INTEGER,  hasHDImg INTEGER,  insertBatch INTEGER,  reserved1 INTEGER,  reserved2 INTEGER,  reserved3 TEXT,  reserved4 TEXT,  type INTEGER,  lvbuffer BLOB,  regionCode TEXT,  snsFlag INTEGER,  sns_bgurl TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `shakeItemID` | INTEGER | shake项ID |
| `username` | TEXT | 用户名 |
| `nickname` | TEXT | 昵称 |
| `province` | TEXT | 省 |
| `city` | TEXT | 城市 |
| `signature` | TEXT | 签名 |
| `distance` | TEXT | (distance) |
| `sex` | INTEGER | 性别 |
| `imgstatus` | INTEGER | 图片状态 |
| `hasHDImg` | INTEGER | 是否hd图片 |
| `insertBatch` | INTEGER | 插入批 |
| `reserved1` | INTEGER | 保留1 |
| `reserved2` | INTEGER | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `type` | INTEGER | 类型 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `regionCode` | TEXT | 地区码 |
| `snsFlag` | INTEGER | 朋友圈标志 |
| `sns_bgurl` | TEXT | 朋友圈背景链接 |

### `shakemessage` — shake消息表

```sql
CREATE TABLE shakemessage (  svrid LONG default '0'  PRIMARY KEY ,  type INTEGER,  subtype INTEGER default '0' ,  createtime LONG,  tag TEXT,  status INTEGER,  title TEXT,  desc TEXT,  thumburl TEXT,  reserved1 TEXT,  reserved2 TEXT,  reserved3 INTEGER,  reservedBuf BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `svrid` | LONG | 服务器ID |
| `type` | INTEGER | 类型 |
| `subtype` | INTEGER | 子类型 |
| `createtime` | LONG | 创建时间 |
| `tag` | TEXT | 标签 |
| `status` | INTEGER | 状态 |
| `title` | TEXT | 标题 |
| `desc` | TEXT | 描述 |
| `thumburl` | TEXT | 缩略图链接 |
| `reserved1` | TEXT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `reserved3` | INTEGER | 保留3 |
| `reservedBuf` | BLOB | 保留缓冲 |

### `shaketvhistory` — shaketv历史表

```sql
CREATE TABLE shaketvhistory (  username TEXT default ''  PRIMARY KEY ,  deeplink TEXT default '' ,  title TEXT default '' ,  iconurl TEXT default '' ,  createtime LONG default '' )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `deeplink` | TEXT | deep链接 |
| `title` | TEXT | 标题 |
| `iconurl` | TEXT | 图标链接 |
| `createtime` | LONG | 创建时间 |

### `shakeverifymessage` — shake验证消息表

```sql
CREATE TABLE shakeverifymessage (  svrid LONG default '0'  PRIMARY KEY ,  status INTEGER,  type INTEGER,  scene INTEGER,  createtime LONG,  talker TEXT,  content TEXT,  sayhiuser TEXT,  sayhicontent TEXT,  imgpath TEXT,  isSend INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `svrid` | LONG | 服务器ID |
| `status` | INTEGER | 状态 |
| `type` | INTEGER | 类型 |
| `scene` | INTEGER | 场景 |
| `createtime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `sayhiuser` | TEXT | sayhi用户 |
| `sayhicontent` | TEXT | sayh图标tent |
| `imgpath` | TEXT | 图片/资源缩略图本地路径 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |

### `textstatusmessage` — 文本状态消息表

```sql
CREATE TABLE textstatusmessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | LONG | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | LONG | 消息序号 |
| `flag` | INTEGER | 标志 |
| `fromUsername` | TEXT | from用户名 |
| `toUsername` | TEXT | to用户名 |
| `extInfo` | BLOB | 扩展信息 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `textstatusvideoinfo` — 文本状态视频表

```sql
CREATE TABLE textstatusvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | TEXT | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `textstatusvideoinfoVideoHash` — 文本状态视频信息视频哈希表

```sql
CREATE TABLE textstatusvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `size` | INT | 大小 |
| `CreateTime` | long | 创建时间 |
| `hash` | TEXT | 哈希 |
| `cdnxml` | TEXT | CDNXML |
| `orgpath` | TEXT | org路径 |

### `tmessage` — t消息表

```sql
CREATE TABLE tmessage ( msgId INTEGER PRIMARY KEY, msgSvrId INTEGER , type INT, status INT, isSend INT, isShowTimer INTEGER, createTime INTEGER, talker TEXT, content TEXT, imgPath TEXT, reserved TEXT, lvbuffer BLOB, transContent TEXT, transBrandWording TEXT , talkerId INTEGER, bizClientMsgId TEXT, bizChatId INTEGER DEFAULT -1, bizChatUserId TEXT, msgSeq INTEGER, flag INT DEFAULT 0, solitaireFoldInfo BLOB, historyId TEXT)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | INTEGER | 消息ID |
| `msgSvrId` | INTEGER | 服务器消息ID(全局唯一,去重用) |
| `type` | INT | 类型 |
| `status` | INT | 状态 |
| `isSend` | INT | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | INTEGER | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | INTEGER | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | INTEGER | 消息序号 |
| `flag` | INT | 标志 |
| `solitaireFoldInfo` | BLOB | 接龙折叠信息 |
| `historyId` | TEXT | 历史ID |

### `userinfo` — 账号配置

```sql
CREATE TABLE userinfo ( id INTEGER PRIMARY KEY, type INT, value TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `type` | INT | 类型 |
| `value` | TEXT | 值 |

### `userinfo2` — 用户信息2表

```sql
CREATE TABLE userinfo2 ( sid TEXT PRIMARY KEY, type INT, value TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `sid` | TEXT | sID |
| `type` | INT | 类型 |
| `value` | TEXT | 值 |

### `verifycontact` — 验证联系人表

```sql
CREATE TABLE verifycontact ( id INTEGER PRIMARY KEY, username varchar(40), nickname varchar(40), fullpy varchar(60), shortpy varchar(40), imgflag int, scene int, content text, status int, reserved1 int,reserved2 int,reserved3 text,reserved4 text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `username` | varchar(40) | 用户名 |
| `nickname` | varchar(40) | 昵称 |
| `fullpy` | varchar(60) | (fullpy) |
| `shortpy` | varchar(40) | (shortpy) |
| `imgflag` | INT | 图片标志 |
| `scene` | INT | 场景 |
| `content` | TEXT | 内容 |
| `status` | INT | 状态 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |

### `videoinfo` — 视频表

```sql
CREATE TABLE videoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int, msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | TEXT | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `videoinfo2` — 视频信息

```sql
CREATE TABLE videoinfo2 ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text,share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text forward_msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | text forward_msg_talker text | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `voiceinfo` — 语音信息

```sql
CREATE TABLE voiceinfo ( FileName TEXT PRIMARY KEY, User TEXT, MsgId INT, NetOffset INT, FileNowSize INT, TotalLen INT, Status INT, CreateTime INT, LastModifyTime INT, ClientId TEXT, VoiceLength INT, MsgLocalId INT, Human TEXT, reserved1 INT, reserved2 TEXT, MsgSource TEXT, MsgFlag INT, MsgSeq INT, MasterBufId INT, checksum INT DEFAULT 0, VoiceFlag INT DEFAULT 0, VoiceInfoExt BLOB, MsgTalker TEXT  )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `FileName` | TEXT | 文件名称 |
| `User` | TEXT | 用户 |
| `MsgId` | INT | 消息ID |
| `NetOffset` | INT | net偏移 |
| `FileNowSize` | INT | 文件now大小 |
| `TotalLen` | INT | 总len |
| `Status` | INT | 状态 |
| `CreateTime` | INT | 创建时间 |
| `LastModifyTime` | INT | 最后修改时间 |
| `ClientId` | TEXT | 客户端ID |
| `VoiceLength` | INT | 语音长度 |
| `MsgLocalId` | INT | 消息本地ID |
| `Human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | TEXT | 保留2 |
| `MsgSource` | TEXT | 消息来源 |
| `MsgFlag` | INT | 消息标志 |
| `MsgSeq` | INT | 消息序号 |
| `MasterBufId` | INT | master缓冲ID |
| `checksum` | INT | (checksum) |
| `VoiceFlag` | INT | 语音标志 |
| `VoiceInfoExt` | BLOB | 语音信息扩展 |
| `MsgTalker` | TEXT | 消息talker |

### `w1w_img_info_table` — w1w图片信息表

```sql
CREATE TABLE w1w_img_info_table ( id INTEGER PRIMARY KEY, msgSvrId LONG, offset INT, totalLen INT, bigImgPath TEXT, thumbImgPath TEXT, createtime INT, msglocalid INT, status INT, nettimes INT, reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text, hashdthumb int DEFAULT 0, iscomplete INT DEFAULT 1, origImgMD5 TEXT, compressType INT DEFAULT 0, midImgPath TEXT, forwardType INT DEFAULT 0, hevcPath TEXT, sendImgType INT DEFAULT 0, originSourceMd5 TEXT, msgTalker TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `id` | INTEGER | ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `offset` | INT | 偏移 |
| `totalLen` | INT | 总len |
| `bigImgPath` | TEXT | big图片路径 |
| `thumbImgPath` | TEXT | 缩略图图片路径 |
| `createtime` | INT | 创建时间 |
| `msglocalid` | INT | 消息本地ID |
| `status` | INT | 状态 |
| `nettimes` | INT | net时间s |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `hashdthumb` | INT | 是否hd缩略图 |
| `iscomplete` | INT | 是否完成 |
| `origImgMD5` | TEXT | orig图片MD5 |
| `compressType` | INT | compress类型 |
| `midImgPath` | TEXT | mID图片路径 |
| `forwardType` | INT | 转发类型 |
| `hevcPath` | TEXT | hevc路径 |
| `sendImgType` | INT | 发送图片类型 |
| `originSourceMd5` | TEXT | 原始来源MD5 |
| `msgTalker` | TEXT | 消息talker |

### `w1wmessage` — w1w消息表

```sql
CREATE TABLE w1wmessage (  msgId LONG PRIMARY KEY ,  msgSvrId LONG,  type INTEGER,  status INTEGER,  isSend INTEGER,  isShowTimer INTEGER,  createTime LONG,  talker TEXT,  content TEXT default '' ,  imgPath TEXT,  reserved TEXT,  lvbuffer BLOB,  talkerId INTEGER,  transContent TEXT default '' ,  transBrandWording TEXT default '' ,  bizClientMsgId TEXT default '' ,  bizChatId LONG default '-1' ,  bizChatUserId TEXT default '' ,  msgSeq LONG,  flag INTEGER default '0' ,  fromUsername TEXT,  toUsername TEXT,  extInfo BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `msgId` | LONG | 消息ID |
| `msgSvrId` | LONG | 服务器消息ID(全局唯一,去重用) |
| `type` | INTEGER | 类型 |
| `status` | INTEGER | 状态 |
| `isSend` | INTEGER | 方向: 0=收到 1=我发出 |
| `isShowTimer` | INTEGER | 是否显示时间r |
| `createTime` | LONG | 创建时间 |
| `talker` | TEXT | 会话方: 单聊=对方wxid / 群=<id>@chatroom / 公众号=gh_xxx |
| `content` | TEXT | 内容 |
| `imgPath` | TEXT | 图片/资源缩略图本地路径 |
| `reserved` | TEXT | 保留 |
| `lvbuffer` | BLOB | 扩展二进制(protobuf) |
| `talkerId` | INTEGER | 会话方数字ID(关联rcontact行) |
| `transContent` | TEXT | 翻译内容 |
| `transBrandWording` | TEXT | 翻译品牌文案 |
| `bizClientMsgId` | TEXT | 业务客户端消息ID |
| `bizChatId` | LONG | 业务聊天ID |
| `bizChatUserId` | TEXT | 业务聊天用户ID |
| `msgSeq` | LONG | 消息序号 |
| `flag` | INTEGER | 标志 |
| `fromUsername` | TEXT | from用户名 |
| `toUsername` | TEXT | to用户名 |
| `extInfo` | BLOB | 扩展信息 |

### `walletcache` — 钱包缓存表

```sql
CREATE TABLE walletcache ( sid TEXT PRIMARY KEY, type INT, value TEXT )
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `sid` | TEXT | sID |
| `type` | INT | 类型 |
| `value` | TEXT | 值 |

### `zhugemsgvideoinfo` — zhuge消息视频表

```sql
CREATE TABLE zhugemsgvideoinfo ( filename text  PRIMARY KEY , clientid text  , msgsvrid int  , netoffset int  , filenowsize int  , totallen int  , thumbnetoffset int  , thumblen int  , status int  , createtime long  , lastmodifytime long  , downloadtime long  , videolength int  , msglocalid int  , nettimes int  , cameratype int  , user text  , human text  , reserved1 int  , reserved2 int  , reserved3 text  , reserved4 text  , videofuncflag int ,masssendid long ,masssendlist text,videomd5 text, streamvideo byte[], statextstr text, downloadscene int, mmsightextinfo byte[], preloadsize int, videoformat int, forward_msg_local_id int,msg_uuid text, share_app_info text, origin_file_name text, had_clicked_video int, media_id text, media_flag text, video_path text, media_cdnid text, video_wxa_info BLOB, weapp_source_username text, msg_talker text, forward_msg_talker text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `filename` | TEXT | 文件名称 |
| `clientid` | TEXT | 客户端ID |
| `msgsvrid` | INT | 服务器消息ID(全局唯一,去重用) |
| `netoffset` | INT | net偏移 |
| `filenowsize` | INT | 文件now大小 |
| `totallen` | INT | 总len |
| `thumbnetoffset` | INT | 缩略图net偏移 |
| `thumblen` | INT | 缩略图len |
| `status` | INT | 状态 |
| `createtime` | long | 创建时间 |
| `lastmodifytime` | long | 最后修改时间 |
| `downloadtime` | long | 下载时间 |
| `videolength` | INT | 视频长度 |
| `msglocalid` | INT | 消息本地ID |
| `nettimes` | INT | net时间s |
| `cameratype` | INT | camera类型 |
| `user` | TEXT | 用户 |
| `human` | TEXT | 人工 |
| `reserved1` | INT | 保留1 |
| `reserved2` | INT | 保留2 |
| `reserved3` | TEXT | 保留3 |
| `reserved4` | TEXT | 保留4 |
| `videofuncflag` | INT | 视频功能标志 |
| `masssendid` | long | 群发发送ID |
| `masssendlist` | TEXT | 群发发送列表 |
| `videomd5` | TEXT | 视频MD5 |
| `streamvideo` | byte[] | 流视频 |
| `statextstr` | TEXT | 状态x时间戳tr |
| `downloadscene` | INT | 下载场景 |
| `mmsightextinfo` | byte[] | mmsigh文本信息 |
| `preloadsize` | INT | prelo广告大小 |
| `videoformat` | INT | 视频格式 |
| `forward_msg_local_id` | INT | 转发消息本地ID |
| `msg_uuid` | TEXT | 消息UUID(本地唯一,主键) |
| `share_app_info` | TEXT | 分享应用信息 |
| `origin_file_name` | TEXT | 原始文件名称 |
| `had_clicked_video` | INT | 曾已点击视频 |
| `media_id` | TEXT | 媒体ID |
| `media_flag` | TEXT | 媒体标志 |
| `video_path` | TEXT | 视频路径 |
| `media_cdnid` | TEXT | 媒体CDNID |
| `video_wxa_info` | BLOB | 视频wxa信息 |
| `weapp_source_username` | TEXT | we应用来源用户名 |
| `msg_talker` | TEXT | 消息talker |
| `forward_msg_talker` | TEXT | 转发消息talker |

### `zhugemsgvideoinfoVideoHash` — zhuge消息视频信息视频哈希表

```sql
CREATE TABLE zhugemsgvideoinfoVideoHash  (size int , CreateTime long, hash text ,  cdnxml text, orgpath text)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `size` | INT | 大小 |
| `CreateTime` | long | 创建时间 |
| `hash` | TEXT | 哈希 |
| `cdnxml` | TEXT | CDNXML |
| `orgpath` | TEXT | org路径 |

