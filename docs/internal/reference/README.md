# 个人 App 数据库字典 — 总索引

> 微信 / QQ / 抖音 / 头条 / 微博 的本机数据库**完整数据字典**：每库每表每字段中文备注 + 表关联关系。
> 纯结构（无个人数据，安全入 git）。解密/采集脚本见 `scripts/android/pdh-*`，runbook 见 [`../pdh-wechat-decrypt-runbook.md`](../pdh-wechat-decrypt-runbook.md)。
>
> **规模**：~1078 张表 / ~14400 个字段，表名 100% + 字段 96%+ 已中文标注。

## 🗺️ 怎么查

- **想看某张表/字段啥意思** → 按下面 App 找到对应字典文件（已按库拆分，单文件可读）
- **想看表之间怎么 JOIN（关联关系）** → [`数据库表结构详解.md`](数据库表结构详解.md)（核心表 + 一图流 + 跨 app 对照）
- **想一次看全部加密库** → [`数据字典_完整.md`](数据字典_完整.md)（合并版）
- **想重新生成** → `node scripts/android/pdh-gen-schema-dict.mjs --db "标签=库路径" --split 输出目录`

---

## 📱 微信（com.tencent.mm）

| 库 | 字典 | 表/字段 | 加密 | 解密 |
|---|---|---|---|---|
| `EnMicroMsg.db` 聊天/联系人/群 | [微信_EnMicroMsg](数据字典/数据字典_微信_EnMicroMsg.md) | 249 / 3177 | SQLCipher1 | `pdh-wechat-decrypt.mjs`（7位口令） |
| `SnsMicroMsg.db` 朋友圈 | [微信_朋友圈SnsMicroMsg](数据字典/数据字典_微信_朋友圈SnsMicroMsg.md) | 16 / 173 | 明文 | adb 直拉 |

**核心表**：`message`(消息) · `rcontact`(联系人) · `chatroom`(群) · `SnsInfo`(朋友圈)。

## 📱 QQ（com.tencent.mobileqq）

| 库 | 字典 | 表/字段 | 加密 | 解密 |
|---|---|---|---|---|
| `nt_msg.db` 消息 | [QQ_消息](数据字典/数据字典_QQ_消息.md) | 31 / 424 | QQ-SQLCipher | `pdh-qq-android-decrypt.mjs`（MD5(MD5(uid)+rand)，无需frida） |
| `profile_info.db` 联系人 | [QQ_联系人](数据字典/数据字典_QQ_联系人.md) | 22 / 271 | 同上 | 同上 |
| `group_info.db` 群 | [QQ_群信息](数据字典/数据字典_QQ_群信息.md) | 43 / 590 | 同上 | 同上 |
| `guild_msg.db` 频道 | [QQ_频道guild_msg](数据字典/数据字典_QQ_频道guild_msg.md) | 27 / 156 | 同上 | 同上 |
| `896075341.db` 老版社交图 | [QQ_老库](数据字典_明文库/数据字典_QQ_老库.md) | 48 / 1144 | 明文(文本混淆) | adb 直拉 |

**核心表**：`group_msg_table`/`c2c_msg_table`(消息，数字列40xxx) · `profile_info_v6`(联系人) · `group_list`(群)。
**消息正文 `40800` 是 protobuf**，解码入库见 `pdh-qq-ingest.mjs`。

## 📱 抖音（com.ss.android.ugc.aweme）

| 库 | 字典 | 表/字段 | 说明 |
|---|---|---|---|
| 私信 IM（`encrypted_<uid>_im.db`） | [抖音_私信IM](数据字典/数据字典_抖音_私信IM.md) | 23 / 175 | WCDB2 加密(未解开)，仅结构 |
| 明文库 | [抖音_明文库](数据字典_明文库/数据字典_抖音_明文库.md) | 395 / 4866 | 多为 AppLog 埋点 |

> 抖音 IM 走 ByteDance `com.ss.android.im` 框架（同头条）；`mi_pigeon_*_im.db` 实测全空。

## 📱 头条（com.ss.android.article.news）

| 库 | 字典 | 表/字段 | 说明 |
|---|---|---|---|
| 私信 IM | [头条_私信IM](数据字典/数据字典_头条_私信IM.md) | 12 / 125 | 同抖音框架 |
| `news_article.db` 阅读 | [头条_阅读库](数据字典_明文库/数据字典_头条_阅读库.md) | 17 / 200 | 明文，文章+互动(digg/repin) |
| 明文库 | [头条_明文库](数据字典_明文库/数据字典_头条_明文库.md) | 106 / 1128 | 埋点(Tea SDK) |

**核心表**：`article`(信息流) · `article_detail`(打开过的正文) · `msg`(私信)。

## 📱 微博（com.sina.weibo，全明文）

| 库 | 字典 | 表/字段 | 内容 |
|---|---|---|---|
| `message_<uid>.db` 私信 | [微博_私信](数据字典_明文库/数据字典_微博_私信.md) | 28 / 543 | 私信会话 |
| `sina_weibo` 配图 | [微博_配图](数据字典_明文库/数据字典_微博_配图.md) | 59 / 1405 | 图片/缓存 |
| `ArticleDb.db` 长文 | [微博_长文](数据字典_明文库/数据字典_微博_长文.md) | 2 / 42 | 本人长微博正文 |

**核心表**：`long_text_table`(本人长微博) · `mblog_pic_table`(配图) · `t_session`(私信)。

---

## 📦 次要/元数据库（有数据但非核心聊天内容，`数据字典_次要库/`）

| 库 | 字典 | 内容 |
|---|---|---|
| 微信 `TextStatus.db` | [微信_状态TextStatus](数据字典_次要库/数据字典_微信_状态TextStatus.md) | 微信状态(心情) |
| 微信 `FinderMessage.db` | [微信_视频号FinderMessage](数据字典_次要库/数据字典_微信_视频号FinderMessage.md) | 视频号会话 |
| 微信 `WxFileIndex.db` | [微信_文件索引WxFileIndex](数据字典_次要库/数据字典_微信_文件索引WxFileIndex.md) | 收发文件元信息 |
| QQ `misc.db` | [QQ_杂项misc](数据字典_次要库/数据字典_QQ_杂项misc.md) | 配置/在线状态/公众号KV |
| QQ `file_assistant.db` | [QQ_文件助手file_assistant](数据字典_次要库/数据字典_QQ_文件助手file_assistant.md) | 文件传输助手记录 |

> 其余设备 DB（微信 liteapp/finder/FTS索引、抖音 feature_engineering 94MB埋点/ccd缓存、各 app push/sdk）= 缓存/埋点/索引，无个人内容，已确认非遗漏。
> 微信 3 个账号（e1d7e7a2/2d80efb/60e2c317，60e2c317 朋友圈 13MB）schema 相同，字典通用。

## 🔧 配套

- **结构 SQL（无注释，给程序用）**：[`wechat_schema.sql`](wechat_schema.sql) · [`qq_nt_schema.sql`](qq_nt_schema.sql) · [`douyin_im_schema.sql`](douyin_im_schema.sql) · [`toutiao_im_schema.sql`](toutiao_im_schema.sql) · `*_plaintext_db_schemas.sql`
- **解密/采集脚本**（`scripts/android/`）：
  - `pdh-wechat-decrypt.mjs` + `pdh-frida-wechat-aeskey.mjs` — 微信
  - `pdh-qq-decrypt.mjs`(PC,需frida) / `pdh-qq-android-decrypt.mjs`(安卓,无frida) / `pdh-frida-qq-aeskey.mjs`
  - `pdh-qq-ingest.mjs`(消息) / `pdh-qq-contacts-ingest.mjs`(联系人群) / `pdh-qq-analyze.mjs`(关系分析)
  - `pdh-gen-schema-dict.mjs` — 本字典生成器
  - `pdh-device-collect.mjs` — 系统数据（联系人/短信/通话/媒体）
- **生成实例解读（含真实数据，仅本地不入 git）**：`pdh-{wechat,qq}-interpret.mjs`

## ⚠️ 隐私

本目录全是**结构 + 中文备注，无任何个人数据**（无 INSERT/无样本值，已校验）。
解密后的**明文库**与**实例解读**含真实聊天/联系人，只放本机 `桌面/我的数据库/`，**绝不入 git**。
