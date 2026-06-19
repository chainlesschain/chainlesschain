# 数据字典 — QQ 消息（`QQ_nt_msg_decrypted.db`）

> 纯结构(无数据)。备注来源：精确字典 + 英文字段名启发式翻译；`(原名)` 表示未能翻译的字段。
> 表关联见 `数据库表结构详解.md`。生成器 `scripts/android/pdh-gen-schema-dict.mjs`。

> 本库 31 张表 / 424 个字段。

### `ai_assistant_msg_table` — AI助手消息

```sql
CREATE TABLE ai_assistant_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40006] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40850] INTEGER,[40851] INTEGER,[40601] BLOB,[40801] BLOB,[40605] BLOB,[40030] INTEGER,[40033] INTEGER,[40062] BLOB,[40083] INTEGER,[40084] INTEGER,[40008] INTEGER,[40009] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40006` | INTEGER | 关联序号 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40851` | INTEGER | QQ消息字段(编号40851, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40605` | BLOB | QQ消息字段(编号40605, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |
| `40062` | BLOB | QQ消息字段(编号40062, 含义社区未公开) |
| `40083` | INTEGER | QQ消息字段(编号40083, 含义社区未公开) |
| `40084` | INTEGER | QQ消息字段(编号40084, 含义社区未公开) |
| `40008` | INTEGER | QQ消息字段(编号40008, 含义社区未公开) |
| `40009` | INTEGER | QQ消息字段(编号40009, 含义社区未公开) |

### `ai_session_table` — ai会话表

```sql
CREATE TABLE ai_session_table([40055] INTEGER,[40021] TEXT,[40010] INTEGER,[60001] INTEGER,[40094] TEXT,[40050] INTEGER,[40003] INTEGER,PRIMARY KEY ([40055],[40021]))
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40055` | INTEGER | QQ消息字段(编号40055, 含义社区未公开) |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `60001` | INTEGER | 群号(关联消息40021) |
| `40094` | TEXT | QQ消息字段(编号40094, 含义社区未公开) |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40003` | INTEGER | 消息seq序列号 |

### `ark_to_markdown_config_table` — arkto标记down配置表

```sql
CREATE TABLE ark_to_markdown_config_table([43001] TEXT PRIMARY KEY,[43002] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `43001` | TEXT | QQ消息字段(编号43001, 含义社区未公开) |
| `43002` | BLOB | QQ消息字段(编号43002, 含义社区未公开) |

### `c2c_msg_flow_table` — 单聊消息流水

```sql
CREATE TABLE c2c_msg_flow_table([41711] INTEGER PRIMARY KEY,[41712] INTEGER,[41713] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41711` | INTEGER | QQ消息字段(编号41711, 含义社区未公开) |
| `41712` | INTEGER | QQ消息字段(编号41712, 含义社区未公开) |
| `41713` | BLOB | QQ消息字段(编号41713, 含义社区未公开) |

### `c2c_msg_table` — 单聊(1对1)消息

```sql
CREATE TABLE c2c_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40006] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40850] INTEGER,[40851] INTEGER,[40601] BLOB,[40801] BLOB,[40605] BLOB,[40030] INTEGER,[40033] INTEGER,[40062] BLOB,[40083] INTEGER,[40084] INTEGER,[40008] INTEGER,[40009] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40006` | INTEGER | 关联序号 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40851` | INTEGER | QQ消息字段(编号40851, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40605` | BLOB | QQ消息字段(编号40605, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |
| `40062` | BLOB | QQ消息字段(编号40062, 含义社区未公开) |
| `40083` | INTEGER | QQ消息字段(编号40083, 含义社区未公开) |
| `40084` | INTEGER | QQ消息字段(编号40084, 含义社区未公开) |
| `40008` | INTEGER | QQ消息字段(编号40008, 含义社区未公开) |
| `40009` | INTEGER | QQ消息字段(编号40009, 含义社区未公开) |

### `c2c_temp_msg_flow_table` — c2c临时消息flow表

```sql
CREATE TABLE c2c_temp_msg_flow_table([41711] INTEGER PRIMARY KEY,[41712] INTEGER,[41713] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41711` | INTEGER | QQ消息字段(编号41711, 含义社区未公开) |
| `41712` | INTEGER | QQ消息字段(编号41712, 含义社区未公开) |
| `41713` | BLOB | QQ消息字段(编号41713, 含义社区未公开) |

### `c2c_temp_msg_table` — c2c临时消息表

```sql
CREATE TABLE c2c_temp_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40006] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40850] INTEGER,[40851] INTEGER,[40601] BLOB,[40801] BLOB,[40605] BLOB,[40030] INTEGER,[40033] INTEGER,[40062] BLOB,[40083] INTEGER,[40084] INTEGER,[40008] INTEGER,[40009] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40006` | INTEGER | 关联序号 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40851` | INTEGER | QQ消息字段(编号40851, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40605` | BLOB | QQ消息字段(编号40605, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |
| `40062` | BLOB | QQ消息字段(编号40062, 含义社区未公开) |
| `40083` | INTEGER | QQ消息字段(编号40083, 含义社区未公开) |
| `40084` | INTEGER | QQ消息字段(编号40084, 含义社区未公开) |
| `40008` | INTEGER | QQ消息字段(编号40008, 含义社区未公开) |
| `40009` | INTEGER | QQ消息字段(编号40009, 含义社区未公开) |

### `dataline_flow_table` — 数据线flow表

```sql
CREATE TABLE dataline_flow_table([41711] INTEGER PRIMARY KEY,[41712] INTEGER,[41713] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41711` | INTEGER | QQ消息字段(编号41711, 含义社区未公开) |
| `41712` | INTEGER | QQ消息字段(编号41712, 含义社区未公开) |
| `41713` | BLOB | QQ消息字段(编号41713, 含义社区未公开) |

### `dataline_msg_table` — 数据线消息表

```sql
CREATE TABLE dataline_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40006] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40850] INTEGER,[40851] INTEGER,[40601] BLOB,[40801] BLOB,[40605] BLOB,[40030] INTEGER,[40033] INTEGER,[40062] BLOB,[40083] INTEGER,[40084] INTEGER,[40008] INTEGER,[40009] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40006` | INTEGER | 关联序号 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40851` | INTEGER | QQ消息字段(编号40851, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40605` | BLOB | QQ消息字段(编号40605, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |
| `40062` | BLOB | QQ消息字段(编号40062, 含义社区未公开) |
| `40083` | INTEGER | QQ消息字段(编号40083, 含义社区未公开) |
| `40084` | INTEGER | QQ消息字段(编号40084, 含义社区未公开) |
| `40008` | INTEGER | QQ消息字段(编号40008, 含义社区未公开) |
| `40009` | INTEGER | QQ消息字段(编号40009, 含义社区未公开) |

### `discuss_msg_flow_table` — 讨论组消息flow表

```sql
CREATE TABLE discuss_msg_flow_table([41711] INTEGER PRIMARY KEY,[41712] INTEGER,[41713] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41711` | INTEGER | QQ消息字段(编号41711, 含义社区未公开) |
| `41712` | INTEGER | QQ消息字段(编号41712, 含义社区未公开) |
| `41713` | BLOB | QQ消息字段(编号41713, 含义社区未公开) |

### `discuss_msg_table` — 讨论组消息表

```sql
CREATE TABLE discuss_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40094] TEXT,[40030] INTEGER,[40033] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40094` | TEXT | QQ消息字段(编号40094, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |

### `draft_storage_table_v1` — 草稿storagetable表

```sql
CREATE TABLE draft_storage_table_v1([43001] TEXT PRIMARY KEY,[43002] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `43001` | TEXT | QQ消息字段(编号43001, 含义社区未公开) |
| `43002` | BLOB | QQ消息字段(编号43002, 含义社区未公开) |

### `eventflow_seq_storage_table` — eventflow序号storage表

```sql
CREATE TABLE eventflow_seq_storage_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `game_msg_config_table` — 游戏消息配置表

```sql
CREATE TABLE game_msg_config_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `group_ai_assistant_msg_table` — 群/组aiassistant消息表

```sql
CREATE TABLE group_ai_assistant_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40006] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40850] INTEGER,[40851] INTEGER,[40601] BLOB,[40801] BLOB,[40605] BLOB,[40030] INTEGER,[40033] INTEGER,[40062] BLOB,[40083] INTEGER,[40084] INTEGER,[40008] INTEGER,[40009] INTEGER,[40031] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40006` | INTEGER | 关联序号 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40851` | INTEGER | QQ消息字段(编号40851, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40605` | BLOB | QQ消息字段(编号40605, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |
| `40062` | BLOB | QQ消息字段(编号40062, 含义社区未公开) |
| `40083` | INTEGER | QQ消息字段(编号40083, 含义社区未公开) |
| `40084` | INTEGER | QQ消息字段(编号40084, 含义社区未公开) |
| `40008` | INTEGER | QQ消息字段(编号40008, 含义社区未公开) |
| `40009` | INTEGER | QQ消息字段(编号40009, 含义社区未公开) |
| `40031` | INTEGER | QQ消息字段(编号40031, 含义社区未公开) |

### `group_at_me_msg` — 群里@我的消息

```sql
CREATE TABLE group_at_me_msg([40001] INTEGER PRIMARY KEY,[40027] INTEGER,[40020] TEXT,[40100] INTEGER,[40050] INTEGER,[40003] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40027` | INTEGER | 对端uid数字 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40003` | INTEGER | 消息seq序列号 |

### `group_msg_flow_table` — 群消息流水

```sql
CREATE TABLE group_msg_flow_table([41711] INTEGER PRIMARY KEY,[41712] INTEGER,[41713] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41711` | INTEGER | QQ消息字段(编号41711, 含义社区未公开) |
| `41712` | INTEGER | QQ消息字段(编号41712, 含义社区未公开) |
| `41713` | BLOB | QQ消息字段(编号41713, 含义社区未公开) |

### `group_msg_table` — 群聊消息

```sql
CREATE TABLE group_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40006] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40850] INTEGER,[40851] INTEGER,[40601] BLOB,[40801] BLOB,[40605] BLOB,[40030] INTEGER,[40033] INTEGER,[40062] BLOB,[40083] INTEGER,[40084] INTEGER,[40008] INTEGER,[40009] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40006` | INTEGER | 关联序号 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40851` | INTEGER | QQ消息字段(编号40851, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40605` | BLOB | QQ消息字段(编号40605, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |
| `40062` | BLOB | QQ消息字段(编号40062, 含义社区未公开) |
| `40083` | INTEGER | QQ消息字段(编号40083, 含义社区未公开) |
| `40084` | INTEGER | QQ消息字段(编号40084, 含义社区未公开) |
| `40008` | INTEGER | QQ消息字段(编号40008, 含义社区未公开) |
| `40009` | INTEGER | QQ消息字段(编号40009, 含义社区未公开) |

### `hidden_session_storage_table_v1` — 隐藏会话storagetable表

```sql
CREATE TABLE hidden_session_storage_table_v1([43001] TEXT PRIMARY KEY,[43002] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `43001` | TEXT | QQ消息字段(编号43001, 含义社区未公开) |
| `43002` | BLOB | QQ消息字段(编号43002, 含义社区未公开) |

### `kv_tofu_msg_table` — 键值tofu消息表

```sql
CREATE TABLE kv_tofu_msg_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `msg_backup_storage_table` — 消息备份storage表

```sql
CREATE TABLE msg_backup_storage_table([50501] TEXT PRIMARY KEY,[50502] TEXT,[50503] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `50501` | TEXT | QQ扩展字段(编号50501, 含义社区未公开) |
| `50502` | TEXT | QQ扩展字段(编号50502, 含义社区未公开) |
| `50503` | INTEGER | QQ扩展字段(编号50503, 含义社区未公开) |

### `msg_unread_info_table` — 未读计数

```sql
CREATE TABLE msg_unread_info_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `nt_kv_storage_table` — nt键值storage表

```sql
CREATE TABLE nt_kv_storage_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `nt_uid_mapping_table` — ntuidm应用ing表

```sql
CREATE TABLE nt_uid_mapping_table([48901] INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,[48902] TEXT,[48912] TEXT,[1002] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | INTEGER | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | TEXT | QQ消息字段(编号48902, 含义社区未公开) |
| `48912` | TEXT | QQ消息字段(编号48912, 含义社区未公开) |
| `1002` | INTEGER | QQ号(uin,关联消息40033) |

### `pai_yi_pai_msg_id_table` — paiyipai消息ID表

```sql
CREATE TABLE pai_yi_pai_msg_id_table([48901] TEXT PRIMARY KEY,[48902] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `48901` | TEXT | QQ消息字段(编号48901, 含义社区未公开) |
| `48902` | BLOB | QQ消息字段(编号48902, 含义社区未公开) |

### `recent_contact_delete_storage` — 最近联系人删除storage表

```sql
CREATE TABLE recent_contact_delete_storage([1005] TEXT PRIMARY KEY,[40050] INTEGER,[49740] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `1005` | TEXT | QQ账号字段(编号1005, 含义社区未公开) |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `49740` | INTEGER | QQ消息字段(编号49740, 含义社区未公开) |

### `recent_contact_top_table` — 最近联系人置顶表

```sql
CREATE TABLE recent_contact_top_table([41145] INTEGER PRIMARY KEY,[40010] INTEGER,[41103] INTEGER,[1000] TEXT,[60001] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41145` | INTEGER | QQ消息字段(编号41145, 含义社区未公开) |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `41103` | INTEGER | QQ消息字段(编号41103, 含义社区未公开) |
| `1000` | TEXT | uid(u_xxx,关联消息40020) |
| `60001` | INTEGER | 群号(关联消息40021) |

### `recent_contact_v3_table` — 最近会话列表

```sql
CREATE TABLE recent_contact_v3_table([40055] INTEGER,[40010] INTEGER,[40027] INTEGER,[40021] TEXT,[40030] INTEGER,[40051] BLOB,[40041] INTEGER,[41102] INTEGER PRIMARY KEY,[40056] TEXT,[40050] INTEGER,[40003] INTEGER,[40094] TEXT,[40093] TEXT,[40090] TEXT,[40095] TEXT,[40096] TEXT,[40001] INTEGER,[41103] INTEGER,[41104] INTEGER,[40020] TEXT,[40033] INTEGER,[41220] INTEGER,[40600] BLOB,[41106] INTEGER,[41107] INTEGER,[41108] INTEGER,[41110] TEXT,[40011] INTEGER,[41114] INTEGER,[41115] BLOB,[41116] BLOB,[42261] INTEGER,[41124] INTEGER,[41123] INTEGER,[41130] INTEGER,[41136] INTEGER,[41131] BLOB,[40022] TEXT,[41127] TEXT,[40092] TEXT,[40091] TEXT,[40014] INTEGER,[41126] INTEGER,[41128] BLOB,[41133] INTEGER,[41134] INTEGER,[41135] TEXT,[49102] INTEGER,[49103] INTEGER,[41132] INTEGER,[41138] INTEGER,[41137] INTEGER,[41144] INTEGER,[41147] INTEGER,[41146] INTEGER,[41148] TEXT,[60001] INTEGER,[41150] BLOB,[40005] INTEGER,[40002] INTEGER,[40006] INTEGER,[41158] INTEGER,[41159] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40055` | INTEGER | QQ消息字段(编号40055, 含义社区未公开) |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40027` | INTEGER | 对端uid数字 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40030` | INTEGER | 发送者类型 |
| `40051` | BLOB | QQ消息字段(编号40051, 含义社区未公开) |
| `40041` | INTEGER | 消息流向 |
| `41102` | INTEGER | QQ消息字段(编号41102, 含义社区未公开) |
| `40056` | TEXT | QQ消息字段(编号40056, 含义社区未公开) |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40003` | INTEGER | 消息seq序列号 |
| `40094` | TEXT | QQ消息字段(编号40094, 含义社区未公开) |
| `40093` | TEXT | 群名片/备注 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40095` | TEXT | QQ消息字段(编号40095, 含义社区未公开) |
| `40096` | TEXT | QQ消息字段(编号40096, 含义社区未公开) |
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `41103` | INTEGER | QQ消息字段(编号41103, 含义社区未公开) |
| `41104` | INTEGER | QQ消息字段(编号41104, 含义社区未公开) |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |
| `41220` | INTEGER | QQ消息字段(编号41220, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `41106` | INTEGER | QQ消息字段(编号41106, 含义社区未公开) |
| `41107` | INTEGER | QQ消息字段(编号41107, 含义社区未公开) |
| `41108` | INTEGER | QQ消息字段(编号41108, 含义社区未公开) |
| `41110` | TEXT | QQ消息字段(编号41110, 含义社区未公开) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `41114` | INTEGER | QQ消息字段(编号41114, 含义社区未公开) |
| `41115` | BLOB | QQ消息字段(编号41115, 含义社区未公开) |
| `41116` | BLOB | QQ消息字段(编号41116, 含义社区未公开) |
| `42261` | INTEGER | QQ消息字段(编号42261, 含义社区未公开) |
| `41124` | INTEGER | QQ消息字段(编号41124, 含义社区未公开) |
| `41123` | INTEGER | QQ消息字段(编号41123, 含义社区未公开) |
| `41130` | INTEGER | QQ消息字段(编号41130, 含义社区未公开) |
| `41136` | INTEGER | QQ消息字段(编号41136, 含义社区未公开) |
| `41131` | BLOB | QQ消息字段(编号41131, 含义社区未公开) |
| `40022` | TEXT | QQ消息字段(编号40022, 含义社区未公开) |
| `41127` | TEXT | QQ消息字段(编号41127, 含义社区未公开) |
| `40092` | TEXT | QQ消息字段(编号40092, 含义社区未公开) |
| `40091` | TEXT | QQ消息字段(编号40091, 含义社区未公开) |
| `40014` | INTEGER | QQ消息字段(编号40014, 含义社区未公开) |
| `41126` | INTEGER | QQ消息字段(编号41126, 含义社区未公开) |
| `41128` | BLOB | QQ消息字段(编号41128, 含义社区未公开) |
| `41133` | INTEGER | QQ消息字段(编号41133, 含义社区未公开) |
| `41134` | INTEGER | QQ消息字段(编号41134, 含义社区未公开) |
| `41135` | TEXT | QQ消息字段(编号41135, 含义社区未公开) |
| `49102` | INTEGER | QQ消息字段(编号49102, 含义社区未公开) |
| `49103` | INTEGER | QQ消息字段(编号49103, 含义社区未公开) |
| `41132` | INTEGER | QQ消息字段(编号41132, 含义社区未公开) |
| `41138` | INTEGER | QQ消息字段(编号41138, 含义社区未公开) |
| `41137` | INTEGER | QQ消息字段(编号41137, 含义社区未公开) |
| `41144` | INTEGER | QQ消息字段(编号41144, 含义社区未公开) |
| `41147` | INTEGER | QQ消息字段(编号41147, 含义社区未公开) |
| `41146` | INTEGER | QQ消息字段(编号41146, 含义社区未公开) |
| `41148` | TEXT | QQ消息字段(编号41148, 含义社区未公开) |
| `60001` | INTEGER | 群号(关联消息40021) |
| `41150` | BLOB | QQ消息字段(编号41150, 含义社区未公开) |
| `40005` | INTEGER | 客户端序号 |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40006` | INTEGER | 关联序号 |
| `41158` | INTEGER | QQ消息字段(编号41158, 含义社区未公开) |
| `41159` | INTEGER | QQ消息字段(编号41159, 含义社区未公开) |

### `service_assistant_contact` — 服务assistant联系人表

```sql
CREATE TABLE service_assistant_contact([41102] INTEGER PRIMARY KEY,[40051] BLOB,[40050] INTEGER,[41110] TEXT,[40094] TEXT,[41131] BLOB,[40001] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `41102` | INTEGER | QQ消息字段(编号41102, 含义社区未公开) |
| `40051` | BLOB | QQ消息字段(编号40051, 含义社区未公开) |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `41110` | TEXT | QQ消息字段(编号41110, 含义社区未公开) |
| `40094` | TEXT | QQ消息字段(编号40094, 含义社区未公开) |
| `41131` | BLOB | QQ消息字段(编号41131, 含义社区未公开) |
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |

### `service_assistant_msg_table` — 服务assistant消息表

```sql
CREATE TABLE service_assistant_msg_table([40001] INTEGER PRIMARY KEY,[40002] INTEGER,[40003] INTEGER,[40010] INTEGER,[40011] INTEGER,[40012] INTEGER,[40013] INTEGER,[40020] TEXT,[40026] INTEGER,[40021] TEXT,[40027] INTEGER,[40035] INTEGER,[40040] INTEGER,[40041] INTEGER,[40050] INTEGER,[40052] INTEGER,[40090] TEXT,[40093] TEXT,[40800] BLOB,[40900] BLOB,[40105] INTEGER,[40005] INTEGER,[40058] INTEGER,[40006] INTEGER,[40100] INTEGER,[40600] BLOB,[40060] INTEGER,[40850] INTEGER,[40851] INTEGER,[40601] BLOB,[40801] BLOB,[40605] BLOB,[40030] INTEGER,[40033] INTEGER)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `40001` | INTEGER | msgId(本地消息ID,19位雪花长整型) |
| `40002` | INTEGER | 消息random随机数(去重) |
| `40003` | INTEGER | 消息seq序列号 |
| `40010` | INTEGER | 消息归属(0自己/2群) |
| `40011` | INTEGER | 消息类型大类(2普通/5,9含文本特殊/3文件/7视频/10红包/1,11图片或系统) |
| `40012` | INTEGER | 消息子类型elemType |
| `40013` | INTEGER | 消息状态 |
| `40020` | TEXT | 发送者uid(u_xxx) |
| `40026` | INTEGER | 会话标识 |
| `40021` | TEXT | 群号/对端QQ号(关联键) |
| `40027` | INTEGER | 对端uid数字 |
| `40035` | INTEGER | QQ消息字段(编号40035, 含义社区未公开) |
| `40040` | INTEGER | 已读标志 |
| `40041` | INTEGER | 消息流向 |
| `40050` | INTEGER | 发送时间戳(秒,×1000=毫秒) |
| `40052` | INTEGER | 修改时间 |
| `40090` | TEXT | 发送者群名片/昵称 |
| `40093` | TEXT | 群名片/备注 |
| `40800` | BLOB | 消息体(protobuf,富元素需解码) |
| `40900` | BLOB | 消息扩展(protobuf) |
| `40105` | INTEGER | 引用消息信息 |
| `40005` | INTEGER | 客户端序号 |
| `40058` | INTEGER | QQ消息字段(编号40058, 含义社区未公开) |
| `40006` | INTEGER | 关联序号 |
| `40100` | INTEGER | QQ消息字段(编号40100, 含义社区未公开) |
| `40600` | BLOB | QQ消息字段(编号40600, 含义社区未公开) |
| `40060` | INTEGER | QQ消息字段(编号40060, 含义社区未公开) |
| `40850` | INTEGER | QQ消息字段(编号40850, 含义社区未公开) |
| `40851` | INTEGER | QQ消息字段(编号40851, 含义社区未公开) |
| `40601` | BLOB | QQ消息字段(编号40601, 含义社区未公开) |
| `40801` | BLOB | 消息体扩展(protobuf) |
| `40605` | BLOB | QQ消息字段(编号40605, 含义社区未公开) |
| `40030` | INTEGER | 发送者类型 |
| `40033` | INTEGER | 发送者QQ号(uin,关联profile.1002) |

### `them_module_storage_table_v1` — them模块storagetable表

```sql
CREATE TABLE them_module_storage_table_v1([43001] TEXT PRIMARY KEY,[43002] BLOB)
```

| 字段 | 类型 | 中文备注 |
|---|---|---|
| `43001` | TEXT | QQ消息字段(编号43001, 含义社区未公开) |
| `43002` | BLOB | QQ消息字段(编号43002, 含义社区未公开) |

