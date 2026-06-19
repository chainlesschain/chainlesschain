# 数据字典 — 微信 视频号FinderMessage（`wxfinder.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 3 张表 / 35 个字段。

### `FinderConversation` — 视频号私信会话

```sql
CREATE TABLE FinderConversation (  sessionId TEXT default ''  PRIMARY KEY ,  talker TEXT default '' ,  unReadCount INTEGER default '0' ,  status INTEGER default '0' ,  updateTime LONG default '0' ,  digest TEXT default '' ,  digestUser TEXT default '' ,  digestType TEXT default '' ,  lastMsgID LONG,  content TEXT,  isSend INTEGER,  placedFlag LONG default '0' ,  editingMsg TEXT,  type INTEGER,  actionPermission INTEGER,  scene INTEGER,  readStatus INTEGER,  senderUserName TEXT default '' ,  senderRoleType INTEGER default '0' ,  senderUserNameVersion INTEGER default '0' ,  followFlag INTEGER)
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
| `followFlag` | INTEGER | 关注标志 |

### `FinderOrAliasDeletingInfo` — 视频号or别名deleting表

```sql
CREATE TABLE FinderOrAliasDeletingInfo (  username TEXT default ''  PRIMARY KEY ,  type INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `username` | TEXT | 用户名 |
| `type` | INTEGER | 类型 |

### `FinderSessionInfo` — 视频号会话信息

```sql
CREATE TABLE FinderSessionInfo (  sessionId TEXT default ''  PRIMARY KEY ,  talker TEXT default '' ,  updateTime LONG default '0' ,  selfUsername TEXT default '' ,  type INTEGER,  actionPermission INTEGER,  rejectMsg INTEGER,  disableSendMsg INTEGER,  senderUserName TEXT default '' ,  senderRoleType INTEGER default '0' ,  followFlag INTEGER,  disableSendmsgNeedFollow INTEGER)
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
| `followFlag` | INTEGER | 关注标志 |
| `disableSendmsgNeedFollow` | INTEGER | 禁用发送消息need关注 |

