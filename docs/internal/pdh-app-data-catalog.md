# PDH App 数据目录（自动生成，供 AI 找数据）

> 由 `scripts/pdh/gen-app-data-catalog.js` 从各 adapter 自带元数据生成 —— 索引「哪个 app
> 有什么数据、怎么采、敏感度」。**共 81 个 adapter。** 详细表/字段级 schema 见
> `pdh-app-db-schemas.md`（微信/抖音等已展开）。重新生成：`node scripts/pdh/gen-app-data-catalog.js`。
>
> 列含义：**底层模式** = adapter.extractMode；**采集方式** = capabilities（sync:cookie-api/sqlite/snapshot/...）；**敏感度** =
> dataDisclosure.sensitivity；🔒 = legalGate（需法律/用户同意门）。

## 分类: AI 对话（1）

| App         | 名称              | 底层模式 | 采集方式                                                      | 敏感度 | 数据字段（摘要）                                                                                                         |
| ----------- | ----------------- | -------- | ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| AI 对话历史 | `ai-chat-history` | web-api  | cookie-multi-vendor/persisted-cookie-accounts/cookie-snapshot | high   | ai-chat:vendor,conversationId,messageId,role,text,modelName; ai-chat:attachments(url,filename,mimeType,size); ai-chat:ge |

## 分类: 企业/工商（1）

| App    | 名称             | 底层模式 | 采集方式                   | 敏感度 | 数据字段（摘要）                                                                                    |
| ------ | ---------------- | -------- | -------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| 天眼查 | `biz-tianyancha` | web-api  | snapshot/custom-cookie-api | medium | tianyancha:monitor (companyName / legalPerson / regStatus); tianyancha:search (query / companyName) |

## 分类: 健康/运动（4）

| App        | 名称             | 底层模式    | 采集方式    | 敏感度  | 数据字段（摘要）                                                                                                        |
| ---------- | ---------------- | ----------- | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Apple 健康 | `apple-health`   | file-import | file-import | high    | apple-health:records (步数 / 心率 / 睡眠 / 体重 / 距离 / 能量 …); apple-health:workouts (运动类型 / 时长 / 距离 / 能量) |
| 悦跑圈     | `fitness-joyrun` | file-import | snapshot    | medium  | joyrun:run (distance / duration / pace / calories / steps — carries GPS route)                                          |
| Keep       | `fitness-keep`   | file-import | snapshot    | medium  | keep:workout (type / distance / duration / calories / steps — outdoor carries GPS route)                                |
| 美柚       | `health-meiyou`  | file-import | snapshot    | high 🔒 | meiyou:period (startDate / endDate / cycleLength / periodLength); meiyou:record (recordType / value / note)             |

## 分类: 其它（2）

| App        | 名称            | 底层模式 | 采集方式        | 敏感度 | 数据字段（摘要）                                                                                              |
| ---------- | --------------- | -------- | --------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| 网易云音乐 | `netease-music` | web-api  | snapshot/cookie | low    | netease:play (歌名 / 歌手 / 专辑 / 播放次数); netease:favorite (收藏的歌); netease:playlist (歌单名 / 曲目数) |
| 微信读书   | `weread`        | web-api  | cookie/snapshot | medium | weread:book (书名 / 作者 / 笔记数); weread:highlight (划线文本 / 章节); weread:review (想法文本 / 章节)       |

## 分类: 出行/车（9）

| App              | 名称                   | 底层模式    | 采集方式                   | 敏感度 | 数据字段（摘要）                                                                                                         |
| ---------------- | ---------------------- | ----------- | -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| 奔驰 Mercedes me | `car-mercedesme`       | file-import | snapshot                   | medium | mercedesme:tripId / startAddress / endAddress / startTime / endTime / distanceKm                                         |
| 12306 铁路       | `travel-12306`         | device-pull | snapshot/custom-cookie-api | medium | 12306:orderSequenceNo / ticketNumber / passengerName / trainNumber / fromStation / toStation / departureMs / arrivalMs / |
| 高德地图         | `travel-amap`          | device-pull | sqlite/snapshot            | medium | amap:search_history (query / time / location); amap:route_history (from / to / mode / time); amap:favourites (name / add |
| 百度地图         | `travel-baidu-map`     | device-pull | snapshot/sqlite            | medium | baidu:account (uid / displayName, cookie scrape); baidu:my_favourite (saved places — home / company / other); baidu:sear |
| 携程             | `travel-ctrip`         | file-import | snapshot/custom-cookie-api | medium | ctrip:orderId / type / fromCity / toCity / dates / passengerName / price / carrier                                       |
| 滴滴企业版       | `travel-didi`          | file-import | snapshot/custom-cookie-api | medium | didi:orderId / fromAddress / toAddress / departTime / arriveTime / fare / carType                                        |
| 滴滴出行         | `travel-didi-consumer` | file-import | snapshot                   | medium | didi:orderId / fromAddress / toAddress / departTime / arriveTime / fare / carType                                        |
| 腾讯地图         | `travel-tencent-map`   | file-import | snapshot                   | medium | tencent:account (uid / displayName, cookie scrape); tencent:favourite (saved places — home / company / other); tencent:s |
| 同程旅行         | `travel-tongcheng`     | file-import | snapshot/custom-cookie-api | medium | tongcheng:orderId / type / fromCity / toCity / dates / passengerName / price / carrier                                   |

## 分类: 即时通讯（9）

| App                | 名称                 | 底层模式    | 采集方式                          | 敏感度  | 数据字段（摘要）                                                                                                            |
| ------------------ | -------------------- | ----------- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| 钉钉（电脑版）     | `dingtalk-pc`        | device-pull | sqlite                            | high 🔒 | dingtalk:messages (time / sender / peer / best-effort text; raw row preserved)                                              |
| 飞书（电脑版）     | `feishu-pc`          | device-pull | sqlite                            | high 🔒 | feishu:messages (time / sender / peer / best-effort text; raw row preserved)                                                |
| QQ（手机）         | `messaging-qq`       | device-pull | snapshot/sqlite                   | high 🔒 | qq:contacts (uin / nickname / remark); qq:groups (troop_uin / name / member_count); qq:messages (peer / content / time /    |
| Telegram           | `messaging-telegram` | device-pull | sqlite/snapshot                   | high 🔒 | telegram:users / chats / messages / dialogs                                                                                 |
| WhatsApp           | `messaging-whatsapp` | device-pull | sqlite/snapshot/adb-public-backup | high 🔒 | whatsapp:jid (contacts + chats); whatsapp:messages (text / media / time); whatsapp:call_log                                 |
| QQ（电脑版 NT）    | `qq-pc`              | device-pull | sqlite                            | high 🔒 | qq-pc:messages (time / type / sender / peer / best-effort text from nt_msg.db; raw row preserved)                           |
| 微信（手机）       | `wechat`             | device-pull | sqlite                            | high 🔒 | wechat:messages (text + group + 1-on-1 chats from EnMicroMsg.db); wechat:contacts (rcontact: nickname / alias / 备注名); we |
| 微信（电脑版）     | `wechat-pc`          | device-pull | sqlite                            | high 🔒 | wechat-pc:messages (StrTalker / StrContent / CreateTime / IsSender from MSG\*.db); wechat-pc:contacts (UserName / NickNam   |
| 企业微信（电脑版） | `wework-pc`          | device-pull | sqlite                            | high 🔒 | wework:messages (time / sender / peer / best-effort text; raw row preserved)                                                |

## 分类: 媒体/阅读（8）

| App      | 名称             | 底层模式    | 采集方式                   | 敏感度 | 数据字段（摘要）                                                                                               |
| -------- | ---------------- | ----------- | -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 喜马拉雅 | `audio-ximalaya` | web-api     | snapshot/custom-cookie-api | low    | ximalaya:play (声音标题 / 主播 / 专辑); ximalaya:favorite (收藏的声音); ximalaya:subscribe (订阅专辑名 / 集数) |
| 酷狗音乐 | `music-kugou`    | web-api     | snapshot/custom-cookie-api | low    | kugou:play (歌名 / 歌手 / 专辑); kugou:favorite (收藏的歌); kugou:playlist (歌单名 / 曲目数)                   |
| QQ音乐   | `music-qq`       | web-api     | snapshot/custom-cookie-api | low    | qqmusic:play (歌名 / 歌手 / 专辑); qqmusic:favorite (收藏的歌); qqmusic:playlist (歌单名 / 曲目数)             |
| 番茄小说 | `reading-fanqie` | file-import | snapshot                   | low    | fanqie:read (书名 / 作者 / 分类 / 进度); fanqie:favourite (收藏的书)                                           |
| 七猫小说 | `reading-qimao`  | file-import | snapshot                   | low    | qimao:read (书名 / 作者 / 分类 / 进度); qimao:favourite (收藏的书)                                             |
| 爱奇艺   | `video-iqiyi`    | web-api     | snapshot/custom-cookie-api | low    | iqiyi:watch (title / category / episode / channel); iqiyi:favourite (title / category)                         |
| 腾讯视频 | `video-tencent`  | web-api     | snapshot/custom-cookie-api | low    | tencent-video:watch (title / category / episode / channel); tencent-video:favourite (title / category)         |
| 西瓜视频 | `video-xigua`    | web-api     | snapshot/custom-cookie-api | low    | xigua:watch (title / category / episode / channel); xigua:favourite (title / category)                         |

## 分类: 招聘（1）

| App       | 名称           | 底层模式 | 采集方式                   | 敏感度 | 数据字段（摘要）                                                                                                      |
| --------- | -------------- | -------- | -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| BOSS 直聘 | `recruit-boss` | web-api  | snapshot/custom-cookie-api | medium | boss:chat (jobTitle / company / hrName / salary / city); boss:application (jobTitle / company / status / deliverTime) |

## 分类: 政务（3）

| App        | 名称          | 底层模式    | 采集方式 | 敏感度  | 数据字段（摘要）                                                                                                        |
| ---------- | ------------- | ----------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| 交管12123  | `gov-12123`   | file-import | snapshot | high 🔒 | 12123:violation (time / location / reason / fine / points); 12123:license (status / cumulativePoints / validUntil)      |
| i厦门      | `gov-ixiamen` | file-import | snapshot | high 🔒 | ixiamen:service (serviceName / category / handledTime / status / dept)                                                  |
| 个人所得税 | `gov-tax`     | file-import | snapshot | high 🔒 | tax:income (period / incomeType / amount / withheld / payer); tax:declaration (year / declType / status / settleAmount) |

## 分类: 教育/学习（2）

| App          | 名称                  | 底层模式 | 采集方式        | 敏感度 | 数据字段（摘要）                                                                                    |
| ------------ | --------------------- | -------- | --------------- | ------ | --------------------------------------------------------------------------------------------------- |
| 华为教育中心 | `edu-huawei-learning` | web-api  | snapshot/cookie | medium | huawei-learning:profile (uid / nickname); huawei-learning:study_session (course / start / duration) |
| 作业帮       | `edu-zuoyebang`       | web-api  | snapshot/cookie | medium | zuoyebang:profile (uid / nickname / grade); zuoyebang:study_session (subject / start / duration)    |

## 分类: 文档/云盘（4）

| App        | 名称                | 底层模式 | 采集方式                   | 敏感度 | 数据字段（摘要）                                             |
| ---------- | ------------------- | -------- | -------------------------- | ------ | ------------------------------------------------------------ |
| 百度网盘   | `doc-baidu-netdisk` | web-api  | snapshot/custom-cookie-api | medium | baidu-netdisk:document (title / docType / createdTime / url) |
| 扫描全能王 | `doc-camscanner`    | web-api  | snapshot/custom-cookie-api | medium | camscanner:document (title / docType / createdTime / url)    |
| 腾讯文档   | `doc-tencent-docs`  | web-api  | snapshot/custom-cookie-api | medium | tencent-docs:document (title / docType / createdTime / url)  |
| WPS 云文档 | `doc-wps`           | web-api  | snapshot/custom-cookie-api | medium | wps:document (title / docType / createdTime / url)           |

## 分类: 本地/系统（9）

| App                | 名称                     | 底层模式    | 采集方式                                                                                                       | 敏感度 | 数据字段（摘要）                                                                                                         |
| ------------------ | ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| MIUI/AOSP 浏览历史 | `browser-history-aosp`   | file-import | file-import/aosp-browser-history-sqlite/aosp-browser-bookmarks-sqlite                                          | high   | history:url,title,visitTimeMs,visitCount; bookmarks:url,name                                                             |
| Chrome 浏览历史    | `browser-history-chrome` | file-import | chrome-history-sqlite/chrome-bookmarks-json                                                                    | high   | visits:url,title,visitTimeMs,transition,visitDurationMs,hidden; bookmarks:url,name,dateAddedMs,folderPath                |
| Edge 浏览历史      | `browser-history-edge`   | file-import | edge-history-sqlite/edge-bookmarks-json                                                                        | high   | visits:url,title,visitTimeMs,transition,visitDurationMs,hidden; bookmarks:url,name,dateAddedMs,folderPath                |
| Git 提交记录       | `git-activity`           | file-import | git-log-local                                                                                                  | high   | commits:sha,authoredAtMs,authorName,authorEmail,subject,repoName                                                         |
| 本地文件           | `local-files`            | file-import | local-file-walk                                                                                                | high   | files:path,name,ext,size,mtimeMs,root                                                                                    |
| 命令行历史         | `shell-history`          | file-import | shell-history-files                                                                                            | high   | commands:shell,value,sourceIndex,snapshotTs                                                                              |
| Android 系统数据   | `system-data-android`    | device-pull | snapshot/adb/android-content-provider/android-package-manager/android-sms/android-call-log/android-media-files | high   | contacts:displayName,phones,emails,starred,organization,jobTitle,photoUri; installed_apps:packageName,label,versionName, |
| VS Code            | `vscode`                 | file-import | vscode-workspace-storage/vscode-globalstorage-sqlite                                                           | high   | workspaces:hash,folderUri,folderPath,lastOpenedMs; terminal-commands:command,shellType,sourceIndex,snapshotTs; terminal- |
| Windows 最近使用   | `win-recent`             | file-import | win-recent-shortcuts                                                                                           | high   | recent:name,mtimeMs,size,lnkPath                                                                                         |

## 分类: 游戏（2）

| App      | 名称                  | 底层模式 | 采集方式            | 敏感度 | 数据字段（摘要）                                                                                  |
| -------- | --------------------- | -------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| 原神     | `game-genshin`        | web-api  | snapshot/cookie     | medium | genshin:profile (uid / nickname / level / avatar); genshin:play_session (start / duration / mode) |
| 王者荣耀 | `game-honor-of-kings` | web-api  | snapshot/camp-token | medium | hok:profile (uid / nickname / level / rank / avatar); hok:play_session (start / duration / mode)  |

## 分类: 社交/内容（10）

| App      | 名称                 | 底层模式    | 采集方式                   | 敏感度 | 数据字段（摘要）                                                                                                         |
| -------- | -------------------- | ----------- | -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| 哔哩哔哩 | `social-bilibili`    | device-pull | snapshot/sqlite            | medium | bilibili:history (avid / bvid / title / view_at / duration / uploader); bilibili:favourite (folder / video / save_time / |
| CSDN     | `social-csdn`        | web-api     | snapshot/custom-cookie-api | medium | csdn:article (title / viewCount / collectCount); csdn:favourite (title / url / source); csdn:follow (username / name)    |
| 懂车帝   | `social-dongchedi`   | web-api     | snapshot/custom-cookie-api | low    | dongchedi:favourite (title / contentType / url); dongchedi:follow (name / followType)                                    |
| 豆瓣     | `social-douban`      | web-api     | snapshot/custom-cookie-api | medium | douban:interest (subjectType / title / status / myRating / comment); douban:review (title / subjectTitle / rating); doub |
| 抖音     | `social-douyin`      | device-pull | snapshot/sqlite            | medium | douyin:profile (sec_user_id / nickname / signature / counts); douyin:history (aweme_id / title / author / view_time); do |
| 快手     | `social-kuaishou`    | device-pull | snapshot/sqlite            | medium | kuaishou:profile (user_id / user_name / kuaishou_id / headurl / sex / city); kuaishou:photo_history (photo_id / caption  |
| 今日头条 | `social-toutiao`     | device-pull | snapshot/sqlite            | high   | toutiao:profile (user_id / screen_name / avatar / mobile / following / followers); toutiao:read_history (item_id / title |
| 微博     | `social-weibo`       | device-pull | snapshot/sqlite            | medium | weibo:posts (text / created_at / reposts_count / comments_count / likes); weibo:favourite (mid / text / author); weibo:f |
| 小红书   | `social-xiaohongshu` | device-pull | snapshot/sqlite            | medium | xhs:notes (own posts, title / desc / type / engagement counts); xhs:liked (notes the user liked); xhs:follow (followed u |
| 知乎     | `social-zhihu`       | web-api     | snapshot/custom-cookie-api | medium | zhihu:answer (questionTitle / excerpt / voteupCount); zhihu:favourite (title / url / collectionName); zhihu:follow (memb |

## 分类: 购物/电商（8）

| App      | 名称                 | 底层模式 | 采集方式                   | 敏感度 | 数据字段（摘要）                                                        |
| -------- | -------------------- | -------- | -------------------------- | ------ | ----------------------------------------------------------------------- |
| 大众点评 | `shopping-dianping`  | web-api  | snapshot/custom-cookie-api | high   | dianping:orderId / poiName / deals / totalPrice / address               |
| 饿了么   | `shopping-eleme`     | web-api  | snapshot/custom-cookie-api | high   | eleme:orderId / restaurantName / dishes / totalAmount / deliveryAddress |
| 京东     | `shopping-jd`        | web-api  | snapshot/custom-cookie-api | high   | jd:orderId / venderName / productList / orderTotalPrice / address       |
| 美团     | `shopping-meituan`   | web-api  | snapshot/custom-cookie-api | high   | meituan:orderId / poiName / dishes / totalPrice / deliveryAddress       |
| 拼多多   | `shopping-pinduoduo` | web-api  | snapshot/custom-cookie-api | high   | pinduoduo:order_sn / mall_name / goods_list / order_amount / address    |
| 淘宝     | `shopping-taobao`    | web-api  | snapshot/custom-cookie-api | high   | taobao:bizOrderId / sellerNick / items / payTime / actualFee / address  |
| 唯品会   | `shopping-vipshop`   | web-api  | snapshot/custom-cookie-api | high   | vipshop:orderSn / brandName / goods / amount / deliveryAddress          |
| 闲鱼     | `shopping-xianyu`    | web-api  | snapshot/custom-cookie-api | high   | xianyu:orderId / side / itemTitle / counterparty / amount / address     |

## 分类: 邮件（1）

| App          | 名称         | 底层模式 | 采集方式 | 敏感度 | 数据字段（摘要）                                                                                                         |
| ------------ | ------------ | -------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| 邮箱（IMAP） | `email-imap` | web-api  | snapshot | high   | email:headers (from/to/subject/date/messageId); email:flags + uid + internalDate; email:body (text + html, capped to ~8k |

## 分类: 金融/支付（7）

| App        | 名称             | 底层模式    | 采集方式        | 敏感度  | 数据字段（摘要）                                                                                                        |
| ---------- | ---------------- | ----------- | --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| 支付宝账单 | `alipay-bill`    | file-import | file-import     | high    | alipay:txId, createdAt, paidAt, counterparty, itemName, amount, direction, status, note                                 |
| 交通银行   | `bank-bankcomm`  | file-import | snapshot        | high 🔒 | bankcomm:transaction (time / amount / direction / counterparty / balance); bankcomm:card (billMonth / statementAmount / |
| 中国银行   | `bank-boc`       | file-import | snapshot        | high 🔒 | boc:transaction (time / amount / direction / counterparty / balance); boc:card (billMonth / statementAmount / status)   |
| 民生银行   | `bank-cmbc`      | file-import | snapshot        | high 🔒 | cmbc:transaction (time / amount / direction / counterparty / balance); cmbc:card (billMonth / statementAmount / status) |
| 工商银行   | `bank-icbc`      | file-import | snapshot        | high 🔒 | icbc:transaction (time / amount / direction / counterparty / balance); icbc:card (billMonth / statementAmount / status) |
| 支付宝     | `finance-alipay` | web-api     | snapshot/cookie | high    | alipay:profile (uid / nickname); alipay:order (merchant / amount / direction / time)                                    |
| 数字人民币 | `finance-dcep`   | file-import | snapshot        | high 🔒 | dcep:transaction (time / amount / direction / counterparty / walletType)                                                |
